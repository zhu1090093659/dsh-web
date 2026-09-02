#!/usr/bin/env bash
# DSH 宿主升级后的验收检查：检测 profile 与宿主 CLI 的 cohort 错位 + 认证栅栏状态，
# 并打印人工冒烟清单。宿主每次升级（npm global 代际更替）后必须跑一次。
#
# 用法：scripts/dsh-upgrade-check.sh [profile ...]
#   无参数 = 扫描 ~/.dsh/profiles/ 下所有带 node_modules 的 profile。
# 退出码：0 = 无 FAIL；1 = 存在 FAIL（cohort 错位会直接导致运行期崩溃，先修再用）。
#
# 背景（2026-09-01 α2→α3 升级事故群）：
#   - profile 影子拷贝 dsh-tools@α2 与宿主 α3 模块级 Symbol 互不相认 →
#     每次工具调用崩 reading 'prepare'（本脚本 FAIL 类）。
#   - 旧宿主缺 settings.installSection → OKX 路由死；缺 connection.requestRejection
#     → 桥 400/裸奔（本脚本「栅栏」项 + 人工清单覆盖）。

set -uo pipefail

HOST_PKG_ROOT="$(npm root -g 2>/dev/null)/@deepseek-ai/dsh/node_modules/@deepseek-ai"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

echo "== 宿主 =="
echo "dsh --version: $(dsh --version 2>/dev/null || echo 'dsh 不可用')"
echo "host pkg root: $HOST_PKG_ROOT"
[ -d "$HOST_PKG_ROOT" ] || echo "  WARN: 宿主包根不存在，版本对照将跳过"

fail=0
warn=0

# 对照某个 profile 的 @deepseek-ai 包与宿主版本/物化状态
check_profile() {
  local profile="$1"
  local nm="$DSH_HOME/profiles/$profile/node_modules"
  [ -d "$nm" ] || { echo "-- $profile: 无 node_modules，跳过"; return; }
  echo "-- profile: $profile"

  # 收集本 profile 内所有 @deepseek-ai/<pkg> 包根（含嵌套 node_modules），逐个对照宿主。
  # 注意 -type l：symlink 到宿主的包根不是 -type d，漏掉会误报「无包」。
  while IFS= read -r shadow; do
    local rel="${shadow#"$nm"/}"       # 形如 @deepseek-ai/dsh-tools 或 pkg/node_modules/@deepseek-ai/dsh-tools
    local pkgname="$(basename "$shadow")"
    case "$pkgname" in
      dsh-*|cosmokit|schemastery) ;;   # 与宿主 CLI 树可能重叠的词汇
      *) continue ;;
    esac
    local host_pkg="$HOST_PKG_ROOT/$pkgname"
    if [ ! -d "$host_pkg" ]; then
      echo "   INFO ${rel}：宿主树无此包（独立插件，跳过版本对照）"
      continue
    fi
    if [ -L "$shadow" ]; then
      # symlink：确认指向宿主
      local target="$(readlink "$shadow")"
      case "$target" in
        /opt/homebrew/*|*"/opt/homebrew/"*) echo "   OK   ${rel} → 宿主 symlink" ;;
        *) echo "   WARN ${rel} → symlink 指向非宿主路径：$target"; warn=$((warn+1)) ;;
      esac
      continue
    fi
    # 实体拷贝：对照版本
    local v_prof v_host
    v_prof="$(node -p "require('$shadow/package.json').version" 2>/dev/null || echo '?')"
    v_host="$(node -p "require('$host_pkg/package.json').version" 2>/dev/null || echo '?')"
    if [ "$v_prof" != "$v_host" ]; then
      echo "   FAIL ${rel}：版本错位 profile=${v_prof} vs host=${v_host}（运行期模块实例割裂，必崩类）"
      fail=$((fail+1))
    else
      echo "   WARN ${rel}：实体拷贝（同版本 ${v_prof}，当前可用；模块级状态跨拷贝仍是隐患，建议 symlink 归一）"
      warn=$((warn+1))
    fi
  done < <(find "$nm" \( -type d -o -type l \) 2>/dev/null | grep -E "/@deepseek-ai/[^/]+$" | sort -u)
}

echo
echo "== profile cohort 对照 =="
if [ "$#" -gt 0 ]; then
  for p in "$@"; do check_profile "$p"; done
else
  for d in "$DSH_HOME"/profiles/*/; do
    [ -d "$d/node_modules" ] && check_profile "$(basename "$d")"
  done
fi

echo
echo "== 认证栅栏（可选：DSH_CHECK_PORT=<端口> 检查运行中实例）=="
# 用法示例：DSH_CHECK_PORT=3081 scripts/dsh-upgrade-check.sh
if [ -n "${DSH_CHECK_PORT:-}" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$DSH_CHECK_PORT/dshtrading/api/markets" --max-time 5)"
  case "$code" in
    401|403) echo "   OK   :$DSH_CHECK_PORT 未认证请求被拒（${code}），栅栏在位" ;;
    200)     echo "   FAIL :$DSH_CHECK_PORT 未认证可读行情桥（200）——栅栏被删/失效（c3aebb5 类回归）"; fail=$((fail+1)) ;;
    *)       echo "   INFO :$DSH_CHECK_PORT 无实例或不可达（${code}）" ;;
  esac
else
  echo "   跳过（设 DSH_CHECK_PORT=<端口> 可对运行中实例检查未认证应答必须为 401/403）"
fi

echo
echo "== 人工冒烟清单（每次升级后逐项过，覆盖脚本测不到的 LLM/交互面）=="
cat <<'CHECKLIST'
  1. 工具调用：新会话发「用终端工具执行 ls <cwd>」——崩 reading 'prepare' = cohort 错位
  2. 市场数据：trading UI 切市场/切交易所（settings installSection 路径）；行情桥 curl 带 cookie
  3. 会话持久化：发消息 → 重启实例 → 会话列表与消息还在（persistence/jsonl 完好）
  4. SessionRail：新会话按钮、会话折叠（UI 服务名/交互回归）
  5. 认证栅栏：未带 cookie 的 API 请求应 401/403，绝不 200
CHECKLIST

if [ "$fail" -gt 0 ]; then
  echo "FAIL: $fail 项 FAIL——先修复再使用（trading-web 见 scripts/refresh-trading-web-profile.sh）"
  exit 1
fi
[ "$warn" -gt 0 ] && echo "WARN: $warn 项 WARN（当前可用，属同类隐患，建议择机归一）"
echo "OK: 无 FAIL"
