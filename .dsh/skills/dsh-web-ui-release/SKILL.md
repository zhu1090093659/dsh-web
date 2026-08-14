---
name: dsh-web-ui-release
description: Release and publish the dsh-web-ui monorepo (DSH Web GUI plugin family + skin collection) — bump all packages to one unified version, commit and tag, push the vX.Y.Z tag that triggers the GitHub Actions publish pipeline, and verify the npm publish + GitHub Release. Covers post-release verification and bad-version recovery. Use when the user asks to 发布/发版/release/bump 版本/publish a new version of dsh-web-ui or any @linxin666/dsh-* package.
whenToUse: The user wants to release dsh-web-ui (发布新版、发个版本、release、tag、publish @linxin666/dsh-* 包), build or change the release pipeline (release 管线、CI 发布), or recover from a bad published version (坏包、回滚、deprecate). Not for routine commits, skin development (see skin-developer skill), or CI-only changes without a release.
---

# dsh-web-ui 发布（release / publish）

本技能固化 dsh-web-ui 全家桶的完整发版流程：全仓统一版本 → 提交 → 打 tag → 推送触发
GitHub Actions 发布管线（构建/测试/npm 发布/GitHub Release）→ 发布后验证。

## 仓库事实（先读，决定每一步怎么做）

- 仓库：zhu1090093659/dsh-web-ui（**PUBLIC**），本机路径 /Users/zcl/code/dsh-web-ui。
- 全家桶 20 个包：packages/dsh-*（10 个）+ packages/skins/*（10 个，含 skin-center）。
  全部发布到 npm scope `@linxin666`，registry 固定 registry.npmjs.org。
- **版本策略：全仓统一版本**（tag vX.Y.Z = 每个 package.json 的 version，由管线强制校验）。
- npm 不允许重复发布同一版本号：已发布过的版本号（如 0.1.3/0.1.4/0.1.5）不可重发，
  只能 bump 到下一个版本。
- 发布通道：本机通常没有 npm 登录态（`npm whoami` 401 属正常）；npm 发布全部由
  GitHub Actions 管线完成，使用仓库 secret `NPM_TOKEN`（npm automation token，@linxin666 scope）。
- 根 package.json 是 private（不发布）；`pnpm -r publish` 自动跳过。
- 仓库禁 emoji（所有文件含提交信息与 tag 信息）；CI 会校验。

## 0. 发版前检查（本地全绿才允许打 tag）

```sh
cd /Users/zcl/code/dsh-web-ui
git status --short                 # 明确本次要提交的内容，无意外文件
pnpm test                          # 全仓测试
pnpm test:scripts                  # 脚本测试（link-profile 等）
node scripts/aggregate.mjs --check # 聚合清单与磁盘一致（改过 aggregate.yml 时必须先重跑生成）
git log --oneline -5               # 确认包含本次全部改动、无未推送提交
```

皮肤相关变更（skin.json / 皮肤 bundle）额外跑：

```sh
node packages/dsh-skins/build.mjs  # 重生成 dsh-skins/skins/ 载体，git status 确认无意外增删
```

**版本 bump 后必须重建产物并同步 gallery 资产**（版本信息影响 bundle 内容）：

```sh
pnpm build                 # 全仓重建 lib 产物（含新版本号）
node scripts/gallery-build # 重新生成 gallery/（manifest.js/bundles.js 内嵌产物内容）
pnpm gallery:check         # 必须通过；产物与 gallery 资产要同一次构建一起提交
```

## 1. 版本 bump（全仓统一）

```sh
find packages -name package.json -not -path '*/node_modules/*' \
  -exec sed -i '' 's/"version": "[0-9][^"]*"/"version": "X.Y.Z"/' {} +
find packages -name package.json -not -path '*/node_modules/*' \
  -exec grep -H '"version"' {} \; | grep -v '"version": "X.Y.Z"'   # 必须无输出
```

pnpm-lock.yaml 不记录包版本，无需改动；聚合包依赖用 workspace:*，发布时由 pnpm 自动替换为
实际版本，无需手工改依赖链。

## 2. 提交与 tag

提交按两类拆分（保持历史可读）：

```sh
# 修复/功能改动（含构建产物 lib/*.js 与聚合重生成的 cordis.patch.yml）
git add <修复文件...>
git commit -m "fix(...): <改动摘要>"

# 发版提交：全部 20 个 package.json 版本 bump + 发布相关变更（管线、skill、AGENTS.md）
git add packages/**/package.json .github/workflows/release.yml .dsh/skills/ AGENTS.md
git commit -m "chore(release): bump to X.Y.Z"

git tag "vX.Y.Z"                    # tag 命名固定 v 前缀；tag 即版本事实源
git push origin main
git push origin "vX.Y.Z"            # 推送 tag 即触发发布管线（唯一发布开关）
```

## 3. 发布管线（tag 触发，.github/workflows/release.yml）

推送 v* tag 后 GitHub Actions 自动执行，顺序：

1. actionlint + pnpm install（frozen lockfile）；
2. 全量 gate：typecheck / build / test / test:scripts / aggregate --check；
3. **版本一致性校验**：tag 版本必须与全部 20 个包的 package.json version 完全一致，不一致直接失败（防止忘 bump 就发版）；
4. `pnpm -r publish --no-git-checks --access public`（NPM_TOKEN 写入 ~/.npmrc，拓扑序发布，workspace:* 自动转真实版本）；
5. `gh release create` 自动生成 GitHub Release（release notes 从提交自动生成）。

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
npm view @linxin666/dsh-web-ui-all version          # 期望 = X.Y.Z
npm view @linxin666/dsh-client-ui-skin-center version
gh release view "vX.Y.Z"                            # Release 已创建、notes 非空
gh run list --workflow=release.yml                  # 全部成功
git ls-remote --tags origin | grep "vX.Y.Z"         # tag 已在远端
```

## 5. 纪律

- tag 一旦推送且 npm 发布成功，同一版本号永不复用；补救只走「下一补丁版本」或 deprecate。
- 发版前必须本地全量测试通过；管线里的版本一致性校验是最后防线，不是唯一防线。
- 变更皮肤后先跑 build.mjs、变更聚合清单后先重跑 aggregate.mjs，再走本流程。
- **构建产物内嵌绝对路径**（CSS-module 类名哈希与 \0dsh-css region 标记），同一源码在不同
  checkout 路径下构建字节不同。因此 CI 的 gallery/skin-center 一致性检查是「提交完整性」语义
  （--ignore-scripts 安装 + 检查放在 Build 之前）：提交者必须把「产物 + gallery 资产」同一次
  构建一起提交；不要试图在 CI 里重新构建后做一致性比对。
- 提交信息、tag、Release 标题均禁 emoji（仓库硬性规则，CI 强制）。
- 本技能适用于 @linxin666/dsh-* 全家桶整体发版；单包 hotfix 也遵循同一流程（版本仍全仓统一）。
