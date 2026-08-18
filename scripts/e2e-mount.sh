#!/usr/bin/env bash
# =============================================================================
# dsh-web-ui 聚合包挂载冒烟编排（CI + 本地）：
#
#   1. `pnpm pack` 打出聚合包 tarball（workspace:* 依赖被 pnpm 改写为真实
#      版本号，与发布产物一致）；
#   2. 用官方 CLI 把 tarball 真实挂载进一个全新 scratch profile
#      （`dsh plugin --profile web add file:<tarball>`，与用户安装路径一致）；
#   3. 启动真实 `dsh web`（keyless，--port 0 取 OS 分配端口）；
#   4. 运行 tests/e2e 无头渲染 lane（Playwright Chromium）：断言 better-
#      sidebar 挂载、无崩溃标记（aionui-panel 已停止支持，不再断言）。
#
# 用法：
#   bash scripts/e2e-mount.sh
#
# 环境变量（均可省略）：
#   DSH_CMD             dsh 命令；缺省 PATH 上的 `dsh`，回退 npx 拉官方包
#   WEB_UI_ALL_DIR      聚合包目录；缺省 packages/dsh-web-ui-all
#   BETTER_SIDEBAR_TGZ  本地 better-sidebar tarball；给出时把聚合包 tarball
#                       里的 dsh-better-sidebar 依赖改写为 file:<该 tarball>
#                       （用于 dsh-better-sidebar@0.13.0 尚未发版前的本地
#                       联调；CI 不设此变量，走 npm 已发布版本）
#   FAMILY_TGZS_DIR     本地家族 tarball 目录；给出时把聚合包 tarball 里全部
#                       @linxin666/* 依赖改写为 file:<目录内同名 tarball>
#                       （验证仓库当前构建，而非 npm 已发布版本；与本地
#                       全 tarball 安装流程一致。CI 不设此变量）
#   PORT                固定端口（默认 0 = OS 分配，从日志解析 URL）
#   DSH_HOME_BASE       覆盖 scratch 根目录（默认 mktemp -d）
#   KEEP_HOME           非空时保留 scratch home（调试用）
#
# 退出码 = playwright 的退出码；服务器与 scratch 目录由 trap 兜底清理。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DSH_CMD="${DSH_CMD:-dsh}"
PORT="${PORT:-0}"
WEB_UI_ALL_DIR="${WEB_UI_ALL_DIR:-$ROOT/packages/dsh-web-ui-all}"
BETTER_SIDEBAR_TGZ="${BETTER_SIDEBAR_TGZ:-}"
FAMILY_TGZS_DIR="${FAMILY_TGZS_DIR:-}"

say()  { printf '\033[32m[e2e-mount]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[e2e-mount]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[e2e-mount]\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "未找到 node（DSH 运行需要 Node.js >= 20）"
command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm（dsh plugin 转发给 pnpm）"

# dsh CLI 解析：PATH 上的 dsh 优先，否则 npx 拉官方包
if ! command -v "$DSH_CMD" >/dev/null 2>&1; then
  if command -v npx >/dev/null 2>&1; then
    say "PATH 上无 $DSH_CMD，回退 npx -y --package @deepseek-ai/dsh"
    DSH_CMD="npx -y --package @deepseek-ai/dsh dsh"
  else
    die "未找到 $DSH_CMD 或 npx；请先安装 DSH CLI（npm i -g @deepseek-ai/dsh）或用 DSH_CMD 指定"
  fi
fi

[ -f "$WEB_UI_ALL_DIR/package.json" ] || die "聚合包目录不存在：$WEB_UI_ALL_DIR"

# scratch home（每次全新，绝不触碰真实 ~/.dsh）
SCRATCH="${DSH_HOME_BASE:-$(mktemp -d /tmp/dsh-web-ui-e2e.XXXXXX)}"
export DSH_HOME="$SCRATCH/home"
WORKSPACE_DIR="$SCRATCH/workspace"
LOG_DIR="$SCRATCH"
WEB_LOG="$LOG_DIR/web.log"
mkdir -p "$DSH_HOME/profiles/web" "$WORKSPACE_DIR"
say "scratch home: ${DSH_HOME}（DSH_HOME=${DSH_HOME}）"

SERVER_PID=""
cleanup() {
  local code=$?
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -z "${KEEP_HOME:-}" ]; then
    rm -rf "$SCRATCH"
  else
    warn "KEEP_HOME 已设置，保留 $SCRATCH"
  fi
  exit "$code"
}
trap cleanup EXIT

# 步骤 1：打包聚合包（workspace:* 被 pnpm pack 改写为真实版本号）
say "打包聚合包：pnpm pack（${WEB_UI_ALL_DIR}）..."
TARBALL="$(cd "$WEB_UI_ALL_DIR" && pnpm pack --silent 2>/dev/null | tail -1)"
TARBALL="$(cd "$WEB_UI_ALL_DIR" && pwd)/$TARBALL"
[ -f "$TARBALL" ] || die "pnpm pack 未产出 tarball（${WEB_UI_ALL_DIR}）"
say "tarball: $TARBALL"

# 可选：把聚合包 tarball 的依赖改写为本地 tarball（发版前/仓库构建联调用）。
# FAMILY_TGZS_DIR 覆盖全部 @linxin666/* 依赖；BETTER_SIDEBAR_TGZ 覆盖
# dsh-better-sidebar 依赖。两者都不设时走 npm 已发布版本（CI 形态）。
if [ -n "$FAMILY_TGZS_DIR" ] || [ -n "$BETTER_SIDEBAR_TGZ" ]; then
  if [ -n "$FAMILY_TGZS_DIR" ]; then
    [ -d "$FAMILY_TGZS_DIR" ] || die "FAMILY_TGZS_DIR 不存在：$FAMILY_TGZS_DIR"
  fi
  if [ -n "$BETTER_SIDEBAR_TGZ" ]; then
    [ -f "$BETTER_SIDEBAR_TGZ" ] || die "BETTER_SIDEBAR_TGZ 不存在：$BETTER_SIDEBAR_TGZ"
    BETTER_SIDEBAR_TGZ="$(cd "$(dirname "$BETTER_SIDEBAR_TGZ")" && pwd)/$(basename "$BETTER_SIDEBAR_TGZ")"
  fi
  say "改写聚合包 tarball 依赖（FAMILY_TGZS_DIR=${FAMILY_TGZS_DIR:-无}，BETTER_SIDEBAR_TGZ=${BETTER_SIDEBAR_TGZ:-无}）"
  REWRITE_DIR="$SCRATCH/tarball-rewrite"
  mkdir -p "$REWRITE_DIR"
  tar -xzf "$TARBALL" -C "$REWRITE_DIR"
  PACKAGE_JSON="$REWRITE_DIR/package/package.json"
  node -e '
    const fs = require("fs")
    const { execSync } = require("child_process")
    const path = process.argv[1]
    const familyDir = process.argv[2] || ""
    const betterSidebarTgz = process.argv[3] || ""
    const pkg = JSON.parse(fs.readFileSync(path, "utf8"))
    if (!pkg.dependencies) { console.error("[e2e-mount] tarball package.json 没有 dependencies"); process.exit(1) }
    if (familyDir) {
      const byName = {}
      for (const f of fs.readdirSync(familyDir)) {
        if (!f.endsWith(".tgz")) continue
        const raw = execSync(`tar -xzf ${JSON.stringify(familyDir + "/" + f)} -O package/package.json`).toString()
        byName[JSON.parse(raw).name] = familyDir + "/" + f
      }
      for (const [key] of Object.entries(pkg.dependencies)) {
        if (!key.startsWith("@linxin666/")) continue
        if (!byName[key]) { console.error("[e2e-mount] 缺少本地 tarball：", key); process.exit(1) }
        pkg.dependencies[key] = "file:" + byName[key]
      }
    }
    if (betterSidebarTgz) {
      if (!("dsh-better-sidebar" in pkg.dependencies)) {
        console.error("[e2e-mount] tarball package.json 缺少 dsh-better-sidebar 依赖")
        process.exit(1)
      }
      pkg.dependencies["dsh-better-sidebar"] = "file:" + betterSidebarTgz
    }
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n")
  ' "$PACKAGE_JSON" "$FAMILY_TGZS_DIR" "$BETTER_SIDEBAR_TGZ"
  TARBALL="$SCRATCH/dsh-web-ui-all-rewritten.tgz"
  tar -czf "$TARBALL" -C "$REWRITE_DIR" package
  say "改写后 tarball: $TARBALL"
fi

# 步骤 2：引导 scratch profile（web 模板；先写 pnpm-workspace.yaml 的
# allowBuilds / minimumReleaseAgeExclude，避免 pnpm 11 strict-dep-builds
# 拦截 node-pty/protobufjs/cloudflared 或拒绝 <24h 新版本——同 install.sh）
PROFILE_DIR="$DSH_HOME/profiles/web"
cat > "$PROFILE_DIR/package.json" <<EOF
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
    }
  }
}
EOF
printf '[]\n' > "$PROFILE_DIR/cordis.patch.yml"
cat > "$PROFILE_DIR/pnpm-workspace.yaml" <<'EOF'
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false

allowBuilds:
  node-pty: true
  protobufjs: true
  cloudflared: true
  cpu-features: true
  ssh2: true

minimumReleaseAgeExclude:
  - 'dsh-better-sidebar@0.13.0'
  - '@linxin666/*'
EOF

# 步骤 3：官方 CLI 安装 tarball + bundle 协调（真实挂载路径）
say "执行 dsh plugin --profile web add file:$TARBALL ..."
$DSH_CMD plugin --profile web add "file:$TARBALL"

# 步骤 4：校验挂载生效（dsh.profile.bundles 含聚合包）
if ! node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bundles = p.dsh?.profile?.bundles ?? [];
  process.exit(bundles.some(b => b === "@linxin666/dsh-web-ui-all") ? 0 : 1);
' "$PROFILE_DIR/package.json"; then
  warn "dsh-web-ui-all 未出现在 dsh.profile.bundles 中——挂载未注册"
  cat "$PROFILE_DIR/package.json"
  exit 1
fi
say "挂载已注册：dsh.profile.bundles 包含 @linxin666/dsh-web-ui-all"

# 步骤 5：启动 dsh web（--port 0 = OS 分配；keyless 可起）
say "启动 dsh web（port=${PORT}）..."
$DSH_CMD web --port "$PORT" > "$WEB_LOG" 2>&1 &
SERVER_PID=$!

URL=""
for _ in $(seq 1 150); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "=== dsh web 提前退出，日志尾部 ===" >&2
    tail -30 "$WEB_LOG" >&2 || true
    exit 1
  fi
  if URL="$(grep -oE 'dsh web: http://127\.0\.0\.1:[0-9]+' "$WEB_LOG" | head -1 | awk '{print $3}')" && [ -n "$URL" ]; then
    break
  fi
  sleep 1
done
[ -n "$URL" ] || { echo "=== 150s 内未等到 dsh web 就绪，日志尾部 ===" >&2; tail -40 "$WEB_LOG" >&2 || true; exit 1; }
say "dsh web 就绪：${URL}（pid ${SERVER_PID}）"

# 步骤 6：运行无头渲染 lane
say "运行 Playwright 无头渲染 lane..."
DSH_E2E_URL="$URL" DSH_E2E_WORKSPACE="$WORKSPACE_DIR" \
  pnpm exec playwright test

say "通过：聚合包挂载到真实 DSH 后无头渲染未崩溃，better-sidebar 挂载"
