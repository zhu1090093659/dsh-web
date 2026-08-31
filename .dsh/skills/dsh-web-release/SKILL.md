---
name: dsh-web-release
description: Release and publish the dsh-web monorepo (DSH Web GUI plugin family + skin collection) — bump all packages to one unified version, commit and tag (tags are cut from main after dev integration; dev is the integration branch), push the vX.Y.Z tag that triggers the GitHub Actions publish pipeline, and verify the npm publish + GitHub Release. Defaults an unspecified target to the next patch after the previous published release. Covers automatic-upgrade compatibility audits, migration and rollback fixes, post-release verification, and bad-version recovery. Use when the user asks to 发布/发版/release/bump 版本/publish a new version of dsh-web or any @linxin666/dsh-* package.
whenToUse: The user wants to release dsh-web (发布新版、发个版本、release、tag、publish @linxin666/dsh-* 包), audit or repair automatic-upgrade compatibility, build or change the release pipeline (release 管线、CI 发布), or recover from a bad published version (坏包、回滚、deprecate). Not for routine commits, skin development (see dsh-web-skin-developer skill), or CI-only changes without a release.
---

# dsh-web 发布（release / publish）

本技能固化 dsh-web 全家桶的完整发版流程：全仓统一版本 → 提交 → 打 tag → 推送触发
GitHub Actions 发布管线（构建/测试/npm 发布/GitHub Release）→ 发布后验证。

## 仓库事实（先读，决定每一步怎么做）

- 仓库：zhu1090093659/dsh-web（**PUBLIC**），本机路径 /Users/zcl/code/dsh-web。
- 全家桶由 `scripts/lib/family-packages.mjs` 非递归遍历 `packages/` 与 `packages/skins/` 得到；当前工作树为 19 个家族包（`packages/*` 18 个 + `packages/skins/skin-center` 1 个），`@linxin666/dsh-client-ui-skin-center` 也是独立发布包。版本与包数量以 `node scripts/verify-version.mjs X.Y.Z` 的输出为准，不在技能中手抄固定数量。
  全部发布到 npm scope `@linxin666`，registry 固定 registry.npmjs.org。
- **版本策略：全仓统一版本**（tag vX.Y.Z = 每个 package.json 的 version，由管线强制校验）。
- **未指定具体版本号时**：不追问版本号；以远端最新且已发布的正式 `vX.Y.Z` tag 为上一版本，
  默认目标为下一个补丁版本 `X.Y.(Z+1)`。用户明确给出版本号，或明确要求 major/minor/prerelease
  变更时，按该要求执行；远端 tag 与 npm 已发布版本不一致时，按下方失败恢复规则处理，不自行猜测。
- npm 不允许重复发布同一版本号：已发布过的版本号（如 0.1.3/0.1.4/0.1.5）不可重发，
  只能 bump 到下一个版本。
- 发布通道：npm 发布全部由 GitHub Actions 管线完成，使用仓库 secret `NPM_TOKEN`
  （npm automation token，@linxin666 scope）；本机 npm 登录态不固定（无登录态时
  `npm whoami` 401 属正常；本机当前以 linxin666 登录），发版不依赖本机登录态。
- **npm 通道已恢复（2026-08-31 起）**：release.yml 的 workflow env
  `NPM_PUBLISH_ENABLED: 'true'`；发布管线执行完整门禁、版本校验后运行
  `pnpm -r publish --tag latest` 与 legacy 双发（均以该开关门控），并在挂载
  冒烟之后运行 npm-strict 的 registry 断言。开关曾因家族跟踪未上 npm 的
  `@deepseek-ai/*` alpha cohort 而被暂停（决策记录
  `.agents/notes/implemented/process/2026-08-28-pause-release-npm-publish-unstable-dsh-alpha.md`，
  恢复记录
  `.agents/notes/implemented/process/2026-08-30-restore-npm-publish-alpha.2.md`）。
  若将来 cohort 再次无法从 registry 解析，把开关改回 `'false'`，tag 推送即退回
  GitHub-Release-only（此时 mount smoke 的 auto 模式以 workspace 打包的 file:
  tarball 验证本 tag 构建）。
- 根 package.json 是 private（不发布）；`pnpm -r publish` 自动跳过。
- **分支模型**：`dev` 是开发分支（集成分支），本地开发与远程 PR 统一以
  `dev` 为目标（远端默认分支）；`main` 是稳定分支（发布分支），只接收
  `dev` 上测试通过后合入的代码，发版 tag 一律从 `main` 打。`dev` /
  `main` 均已启用分支保护（要求 PR + CI 全绿；管理员可绕过，维护者直推
  仍可用，功能改动仍须先经 `dev`）。
- 仓库禁 emoji（所有文件含提交信息与 tag 信息）；CI 会校验。

## 0. 发版前检查（本地全绿才允许打 tag）

### 0.1 自动升级兼容性审计（发布硬门禁）

在修改版本号、合并到 `main`、创建或推送 tag 之前，先按第 1 节确定 `PREVIOUS_VERSION` 与 `TARGET_VERSION`，再完成本审计；全新安装成功不能替代存量用户自动升级成功。

自动升级至少要覆盖两条真实路径：plugin-manager 的 `check-updates` → `update` 路径，以及 Doctor 启动 DSH 前的自动迁移路径；如果某种启动方式绕过迁移器，必须明确标为不支持，并在 release notes 写出恢复方式，不能默认为兼容。

以 `PREVIOUS_TAG..HEAD` 的实际 diff、目标 npm tarball 和当前 profile 格式为依据，逐项检查以下兼容面：

- 包身份与加载契约：npm `name`、`exports`、`dsh.bundle` / `cordis.patch.yml`、`dsh.client`、浏览器 loader id、聚合包 self row、旧包别名和迁移元数据。
- 用户 profile 与写入文件：`$DSH_HOME/profiles/*/package.json`、`pnpm-lock.yaml`、`dsh.profile.bundles`、`cordis.patch.yml`、`disabled` 覆盖行、bundle 顺序和官方 CLI 写入行为。
- 持久化与线协议：设置 section id、API path、请求头、localStorage / 配置 key、IPC / wire shape、schema 默认值、旧字段读取和新字段写入。已经持久化或上线路径中的标识符默认视为冻结，除非有可验证的映射。
- 宿主与 SDK 契约：`@deepseek-ai/*` 公共 API、服务注入、模块表、DSH 最低版本、Node 版本、CLI 参数、进程启动和退出语义。包声明的 `dsh.engines.dsh` 下限必须不高于发布验证所使用的 DSH 版本；CI 固定版本低于声明下限时阻断发布。plugin-manager 与 Doctor 的 DSH 兼容判定必须一致，或在支持矩阵中明确差异与限制。
- 自动迁移入口：分别验证 plugin-manager 的更新任务、Doctor 启动前迁移和直接 `dsh web`；直接入口若绕过 Doctor 迁移，必须补齐迁移或在 release notes 给出明确的不支持声明和人工恢复步骤。两条自动迁移路径的安装顺序、目标版本、回滚结果必须一致，不能只在一条路径修复。
- 跨平台生命周期：macOS、Linux、Windows 的路径、权限、临时文件、备份、服务启动方式和崩溃恢复；不要只用当前 macOS 环境的路径或进程假设。
- 生成与发布产物：共享源与同步副本、`lib/`、aggregate manifest、market / skin 产物、npm 包内文件白名单；不能只检查源码而漏掉实际 tarball。

对每个变化记录 `旧标识 → 新标识`、唯一迁移 owner、读取旧值和写入新值的顺序、备份位置、回滚动作、幂等条件和验证断言；没有变化的持久化标识符也要明确写为 frozen，不要凭猜测重命名。

将每个变更归类为：无需迁移的向后兼容、带确定性迁移的兼容变更、或必须阻断自动升级的不兼容变更。带迁移的变更必须满足：目标资源先可用、只有官方写入器修改 profile、旧数据在目标安装并通过启动 / dump-config 预检前不删除、迁移可重复执行、失败能恢复备份、失败后不会留下双挂载 / 重复 row / 半写配置。

当前 `@linxin666/dsh-web-ui-all` → `@linxin666/dsh-web-all` 过渡以 `shared/host/legacy-migration.ts` 和对应 Agent Note 为迁移映射的事实源；只有在过渡窗口仍有效且目标包已从 registry 验证可读时才双发布旧名，窗口结束后停止旧包发布并执行 deprecate，不要无条件重复发布已占用版本，也不要手工改写当前包替代迁移测试。

### 0.2 自动升级验证矩阵

使用隔离的临时 `DSH_HOME` 和官方 CLI，禁止把当前用户 profile 或运行中的 DSH 服务当作测试夹具。至少验证：

- 全新安装：目标版本能安装、加载、渲染，所有 bundle row / client loader / 设置 section 正常。
- 上一正式版本 → 目标版本：保留真实旧 profile、配置、启停状态、bundle 顺序和已安装扩展，执行用户会触发的自动升级路径，重启或执行 `--dump-config` 后确认数据和功能仍在。
- 仍受支持的最旧版本以及每一个 legacy mapping：验证旧字段、旧包名、旧路径和旧锁文件都能到达目标状态；一次跨多个版本的升级不能只测逐级升级。
- 失败与重试：注入目标不可用、安装成功但验证失败、旧包移除失败、进程中断和重复执行，确认旧状态可恢复、不会出现新旧包同时挂载，第二次执行是安全 no-op。
- 真实用户入口：分别验证 plugin-manager 更新按钮、Doctor 启动前迁移和任何 direct CLI 启动入口；入口行为不一致时阻断发布或明确限制。
- 跨平台：凡涉及路径、权限、服务、spawn、临时文件或锁的变更，至少在 macOS / Linux / Windows 各验证一次；不能以单平台单元测试代替。

发布前至少执行以下门禁，并把针对本次迁移的测试文件和证据一并纳入提交：

```sh
pnpm sync-shared:check
pnpm typecheck
pnpm test
pnpm test:scripts
pnpm aggregate:check
pnpm runtime-deps:check
```

如果缺少旧 profile fixture、失败注入或跨平台验证，不能用“测试暂缺”放行 tag；先补测试 / 修复迁移，或把该版本明确降级为不支持自动升级并提供可执行的人工恢复步骤。

### 0.3 兼容性阻断条件

出现以下任一情况，立即停止版本 bump、tag 和 npm publish：持久化或线协议标识符发生变化但没有映射；迁移不是幂等事务或没有备份 / 回滚；目标包尚未验证可用就删除旧包；更新路径与启动路径的迁移语义不一致；升级后出现双挂载、重复 row、配置丢失或锁文件半写；只验证了 fresh install；或失败后只能依赖手工编辑 profile 才能恢复。

兼容性修复完成后必须同步更新行为测试、对应 Agent Note 和双语 release notes；不要通过改成 major 版本、跳过自动升级检查或先发布后观察来绕过阻断条件。

```sh
cd /Users/zcl/code/dsh-web
git checkout dev                   # 本地工作分支以 dev 为基线（远端默认分支）
git fetch origin && git rebase origin/dev   # 先同步上游最新 dev
git status --short                 # 明确本次要提交的内容，无意外文件
pnpm test                          # 全仓测试
pnpm test:scripts                  # 脚本测试（link-profile 等）
pnpm runtime-deps:check             # 发布包运行时依赖安全门禁
node scripts/aggregate.mjs --check # 聚合清单与磁盘一致（改过 aggregate.yml 时必须先重跑生成）
pnpm market:check                   # market/dist 与已提交产物一致
pnpm skin-center:check              # 皮肤目录契约（涉及皮肤时必跑）
git log --oneline -5               # 确认包含本次全部改动、无未推送提交
```

发版前提：待发布的全部改动先合入 `dev` 并在 `dev` 上全绿；发版时把
`dev` 合入 `main`（见第 2 节），tag 从 `main` 打。

皮肤相关变更（skin.json / skin.css / 皮肤资产）额外跑：

```sh
pnpm skin-center:check     # 皮肤目录契约门禁
```

**版本 bump 后必须重建产物并同步市场资产**（版本信息影响 bundle 内容）：

```sh
pnpm build             # 全仓重建 lib 产物（含新版本号）
pnpm market:build      # 重新生成 market/dist（manifest.js/styles.js 内嵌产物内容）
pnpm market:check      # 必须通过；产物与市场资产要同一次构建一起提交
```

## 1. 版本 bump（全仓统一）

### 选择目标版本

1. 用户明确给出 `X.Y.Z`，或明确要求 major/minor/prerelease 变更时，以该要求为准，并确认目标版本未在 npm 发布过。
2. 用户没有指定具体版本号时，直接运行以下命令得出默认目标，不向用户追问：

```sh
PREVIOUS_TAG="$(
  git ls-remote --tags --refs --sort=-version:refname origin 'v*' \
    | awk '$2 ~ /^refs\/tags\/v[0-9]+\.[0-9]+\.[0-9]+$/ { sub("refs/tags/", "", $2); print $2; exit }'
)"
test -n "$PREVIOUS_TAG" || { echo "No previous release tag"; exit 1; }

PREVIOUS_VERSION="${PREVIOUS_TAG#v}"
test "$(npm view "@linxin666/dsh-web-all@$PREVIOUS_VERSION" version)" = "$PREVIOUS_VERSION" \
  || { echo "Remote tag and npm publication disagree"; exit 1; }

IFS=. read -r MAJOR MINOR PATCH <<EOF
$PREVIOUS_VERSION
EOF
TARGET_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
printf 'Previous release: %s; default target: %s\n' "$PREVIOUS_VERSION" "$TARGET_VERSION"
```

`TARGET_VERSION` 即后续命令中的 `X.Y.Z`。如果没有可确认的上一正式发布，或远端 tag 和 npm
记录不一致，不编造版本号；先按下方失败恢复规则处理。

```sh
find packages -name package.json -not -path '*/node_modules/*' \
  -exec sed -i '' 's/"version": "[0-9][^"]*"/"version": "X.Y.Z"/' {} +
find packages -name package.json -not -path '*/node_modules/*' \
  -exec grep -H '"version"' {} \; | grep -v '"version": "X.Y.Z"'   # 必须无输出
```

pnpm-lock.yaml 不记录包版本，无需改动；聚合包依赖用 workspace:*，发布时由 pnpm 自动替换为
实际版本，无需手工改依赖链。

## 2. 提交与 tag

发版提交与 tag 在 `main` 上执行（tag 从 `main` 打）；打 tag 前先确保
`main` 已包含全部待发布内容（= `dev`，含版本 bump 前的一切功能改动）：

```sh
git checkout main && git pull origin main
git merge --ff-only dev            # dev 已全绿，main 应能快进（非快进说明 main 有独有提交，先核对再合）
git push origin main               # 分支保护允许管理员直推；非管理员走 PR：dev -> main
```

提交按两类拆分（保持历史可读）：

```sh
# 修复/功能改动（含构建产物 lib/*.js 与聚合重生成的 cordis.patch.yml）
git add <修复文件...>
git commit -m "fix(...): <改动摘要>"

# 双语 notes（v0.2.6 起强制，中文默认 + English 折叠）：先跑脚本出草稿（两视图条目相同，
# 均为原始提交主题），再由维护者（AI）逐条翻译——默认视图译成中文、English 折叠视图
# 译成英文，存 docs/release-notes/vX.Y.Z.md（管线优先用该文件）
node scripts/release-notes.mjs "vX.Y.Z" > /tmp/notes-draft.md
# 维护者翻译后写入 docs/release-notes/vX.Y.Z.md；对已发布版本用
#   gh release edit "vX.Y.Z" --notes-file docs/release-notes/vX.Y.Z.md 校正

# 发版提交：全部家族 package.json 版本 bump + 发布相关变更（管线、skill、AGENTS.md、.agents/notes/）
# + docs/release-notes/vX.Y.Z.md
git add packages/**/package.json .github/workflows/release.yml .dsh/skills/ AGENTS.md .agents/notes/ docs/release-notes/
git commit -m "chore(release): bump to X.Y.Z"

git tag "vX.Y.Z"                    # tag 命名固定 v 前缀；tag 即版本事实源
git push origin main
git push origin "vX.Y.Z"            # 推送 tag 即触发发布管线（唯一发布开关）

# 发布后把 main 合回 dev（版本 bump 与 notes 提交也进入 dev），保持双分支一致
git checkout dev && git merge main && git push origin dev
```

## 3. 发布管线（tag 触发，.github/workflows/release.yml）

推送 v* tag 后 GitHub Actions 自动执行，顺序：

1. actionlint + pnpm install（frozen lockfile，checkout 用 fetch-depth: 0 取全量历史）；
2. 全量 gate：typecheck / build / test / test:scripts / aggregate --check，并按变更范围执行 `market:check`、`skin-center:check`；`runtime-deps:check` 是发布前的运行时依赖安全门禁；
3. **版本一致性校验**：运行 `node scripts/verify-version.mjs X.Y.Z`，由 `scripts/lib/family-packages.mjs` 遍历 `packages/` 与 `packages/skins/` 的全部家族包并逐一比对 tag 版本；数量以脚本输出为准，不手抄固定数字；
4. **生成 release notes**：优先使用已提交的 `docs/release-notes/$TAG.md`（v0.2.6 起维护者在发版提交中附带中文默认 + English 折叠的双语版，管线直接采用）；文件缺失时兜底跑 `node scripts/release-notes.mjs $TAG` 生成双视图草稿（把上一 tag 以来的**全部**常规提交——含合并进来的分支提交，不能只走 --first-parent，v0.1.15 曾因此漏掉整条 perf/refactor 分支——分组为新功能 / 修复 / 其他改动并链接 issue，中文默认视图与 English 折叠视图条目相同、均为原始提交主题）。发布前执行，失败即中止，不触碰 npm；
5. `pnpm -r publish --no-git-checks --access public`（NPM_TOKEN 写入 ~/.npmrc，拓扑序发布，workspace:* 自动转真实版本；private 包由 pnpm 自动跳过——若某 private 包被聚合依赖引用，先解除引用或改为公开，否则全家桶安装 404）；
6. 仅当仍处于迁移双发窗口、目标包已从 registry 验证可读且旧包该版本尚未占用时，运行 `node scripts/publish-legacy-aggregate.mjs <tag版本>` 发布旧聚合包 `@linxin666/dsh-web-ui-all`；脚本必须有窗口计数 / 跳过已发布版本的保护。窗口结束后不得继续发布旧包，改为执行一次 `npm deprecate @linxin666/dsh-web-ui-all "迁移到 @linxin666/dsh-web-all；详见该版本 Release notes"` 并核对 deprecation 元数据；
7. `gh release create --notes-file` 创建 GitHub Release（notes 即第 4 步生成的内容）；Release 只保留 GitHub 自动源码归档，不附 npm tarball（与官方 DSH 一致，v0.2.4 起约定）。

关注与排障：

```sh
gh run watch                          # 跟踪最新 run
gh run list --workflow=release.yml    # 查历史
```

- 版本不一致失败 → 本地把漏掉的包 bump 到 tag 版本，amend/新提交后**删除远端 tag 重新推送**（npm 发布前失败无副作用）。
- `NPM_TOKEN` secret 缺失/过期 → 到仓库 Settings → Secrets and variables → Actions 更新后再重跑。
- 发布中途部分包已上 npm、部分失败（网络中断等）→ **不要重推同一 tag**：已发布的版本号不可重发；
  对已发且完好的包跳过重发（pnpm publish 对已存在版本会报错，可逐个对剩余包执行发布），
  或整体 bump 到下一个补丁版本重新发布。
- 发布的是坏包（内容错误但版本已占用）→ 用 `npm deprecate` 标记弃用并立即发下一个补丁版本，不尝试覆盖。

## 4. 发布后验证（必须逐项执行）

```sh
# NPM_PUBLISH_ENABLED='true'：期望 = X.Y.Z
npm view @linxin666/dsh-web-all version
npm view @linxin666/dsh-client-ui-skin-center version
# 仅在双发窗口内执行：
npm view @linxin666/dsh-web-ui-all version       # 期望 = X.Y.Z
# 窗口结束后：旧包版本应保持窗口末版本，且 deprecated 字段必须非空
npm view @linxin666/dsh-web-ui-all deprecated
gh release view "vX.Y.Z" --json body --jq .body    # Release 已创建；v0.2.6 起默认视图为中文、English 折叠视图为英文（逐条抽查）
gh run list --workflow=release.yml                  # 全部成功
git ls-remote --tags origin | grep "vX.Y.Z"         # tag 已在远端
```

## 5. 纪律

- tag 一旦推送且 npm 发布成功，同一版本号永不复用；补救只走「下一补丁版本」或 deprecate。
- 发版前必须本地全量测试通过；管线里的版本一致性校验是最后防线，不是唯一防线。
- 变更皮肤后先跑 build.mjs、变更聚合清单后先重跑 aggregate.mjs，再走本流程。
- **构建产物内嵌绝对路径**（CSS-module 类名哈希与 \0dsh-css region 标记），同一源码在不同
  checkout 路径下构建字节不同。因此 CI 的 market/skin-center 一致性检查是「提交完整性」语义
  （--ignore-scripts 安装 + 检查放在 Build 之前）：提交者必须把「产物 + 市场资产」同一次
  构建一起提交；不要试图在 CI 里重新构建后做一致性比对。
- 提交信息、tag、Release 标题均禁 emoji（仓库硬性规则，CI 强制）。
- **分支纪律**：功能改动一律先合入 `dev`（本地开发与远程 PR 的目标分支），
  `dev` 全绿后才合入 `main`；发版 tag 只从 `main` 打，发布后把 `main`
  合回 `dev`。分支保护下非管理员无法直推 `main` / `dev`，维护者直推
  仍可用（管理员绕过），但功能改动仍须先经 `dev`。
- **Release 更新说明必须中英双语、视图分离**（v0.2.6 起强制，用户约定）：默认视图为中文，
  English 折叠视图为英文，不再逐条 `EN / 中文` 混排。双语 notes 作为
  `docs/release-notes/vX.Y.Z.md` 随发版提交入库，管线优先使用；漏提交时脚本草稿兜底
  （两视图均为原始提交主题），但发布后必须立即用 `gh release edit` 校正为
  「中文默认 + English 折叠」双语，不得保留未翻译条目。
- 本技能适用于 @linxin666/dsh-* 全家桶整体发版；单包 hotfix 也遵循同一流程（版本仍全仓统一）。
