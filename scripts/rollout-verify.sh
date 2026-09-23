#!/usr/bin/env bash
# =============================================================================
# dsh-web 群体上线验收（cohort rollout acceptance）：
#
#   宿主 CLI 升级 + 仓库 install 之后跑一次，把「SDK 领先宿主」与「profile
#   shadow copy 割裂」两类升级事故挡在使用之前。检查项：
#
#     1. 宿主版本满足家族宿主底线（dsh.engines.dsh，取自插件脚手架）；
#     2. 根 lockfile 的全部 @deepseek-ai/dsh-* 解析在底线指名的群体版本上；
#     3. profile 群体对照（发现 dsh-sdk-upgrade 技能脚本时委托执行，
#        含可选的运行实例认证栅栏探测）；
#     4. 未认证 API 请求必须 401/403（alpha.2 起根路径即浏览器认证栅栏；
#        探测端口取 DSH_WEB_PORT，默认 3080，设为空串跳过）。
#
#   用法：bash scripts/rollout-verify.sh [--skip-profiles]
#   退出码 0 = 全部通过。人工冒烟清单（真实 LLM 工具调用、市场数据、
#   SessionRail 交互）不在本脚本范围，见 profile-cohort-check.sh 的输出。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKIP_PROFILES=0
[ "${1:-}" = "--skip-profiles" ] && SKIP_PROFILES=1
# The node -e probes resolve relative specifiers against the cwd.
cd "$ROOT"

say()  { printf '[rollout-verify] %s\n' "$*"; }
fail() { printf '[rollout-verify] FAIL %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node not found"
command -v dsh >/dev/null 2>&1 || fail "dsh CLI not on PATH"

FLOOR="$(node -e 'import("./scripts/lib/rollout-verify.mjs").then(m => console.log(m.readDshFloor("scripts/plugin-template/package.json")))' 2>/dev/null || true)"
[ -n "$FLOOR" ] || fail "cannot read the dsh.engines.dsh floor from scripts/plugin-template/package.json"

HOST_VERSION="$(dsh --version)"
say "host dsh --version: ${HOST_VERSION}; floor: ${FLOOR}"
node -e 'import("./scripts/lib/rollout-verify.mjs").then(m => { if (!m.satisfiesFloor(process.argv[1], process.argv[2])) process.exit(1); })' "$HOST_VERSION" "$FLOOR" \
  || fail "host ${HOST_VERSION} does not satisfy the declared floor ${FLOOR} - upgrade the host CLI first"
say "PASS host version satisfies the floor"

VIOLATIONS="$(node -e 'import("./scripts/lib/rollout-verify.mjs").then(m => { const v = m.lockfileCohortViolations(require("node:fs").readFileSync("pnpm-lock.yaml", "utf8"), process.argv[1]); for (const [k, ver] of v) console.error(`${k} @ ${ver}`); process.exit(v.length ? 1 : 0); })' "$FLOOR" 2>&1)" \
  || fail "lockfile cohort drift (expected ${FLOOR#>=}):
${VIOLATIONS}"
say "PASS root lockfile resolves the family at ${FLOOR#>=}"

PROFILE_SCRIPT="$HOME/.agents/skills/dsh-sdk-upgrade/scripts/profile-cohort-check.sh"
if [ "$SKIP_PROFILES" -eq 1 ]; then
  say "SKIP profile cohort check (--skip-profiles)"
elif [ -f "$PROFILE_SCRIPT" ]; then
  say "delegating profile cohort check to the dsh-sdk-upgrade skill script"
  DSH_CHECK_PORT="${DSH_WEB_PORT:-}" bash "$PROFILE_SCRIPT" || fail "profile cohort check reported failures - repair or re-point shadow copies before use"
else
  say "WARN profile cohort check script not found at ${PROFILE_SCRIPT}; skipping"
fi

if [ -n "${DSH_WEB_PORT:-}" ]; then
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${DSH_WEB_PORT}/")"
  case "$CODE" in
    401 | 403) say "PASS auth fence on :${DSH_WEB_PORT} (unauthenticated ${CODE})" ;;
    000) say "WARN no reachable instance on :${DSH_WEB_PORT}; fence unverified" ;;
    *) fail "auth fence regression on :${DSH_WEB_PORT}: unauthenticated root returned ${CODE} (must be 401/403)" ;;
  esac
else
  say "SKIP auth fence probe (DSH_WEB_PORT unset)"
fi

say "rollout acceptance OK"
