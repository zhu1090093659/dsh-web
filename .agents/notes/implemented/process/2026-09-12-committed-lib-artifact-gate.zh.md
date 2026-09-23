# Agent Note: 已提交 lib 产物的门禁

Status: implemented

## Problem

四个包把构建产物提交进 git（`dsh-market`、`dsh-preset-center`、`dsh-web-all`、`skins/skin-center`），
它们的 `package.json` `main`/`exports`/`files` 都指向这些字节：不重新构建就直接加载包的使用方，拿到的
正是仓库里的内容。这样的产物滞后于源码已经发生过两次：

- skin-center 的 `lib/index.js` 携带 maid-atelier 旧的 `hooksSha256`，而
  `src/reviewed-hooks.generated.ts` 已记录新值，导致 pre-provenance 创意工坊安装的 reviewed 兜底
  永远无法匹配（2026-09-11 手工修复）。
- 聚合包内联每个子插件的 `src/client`；子包改动而未重建聚合时，宿主是新的、页面仍是旧的——这正是该包
  自己的 AGENTS.md 记录的 2026-09-09"重启后界面没变化"事故。

此前没有任何门禁覆盖这一类：`skin-center:check` 校验生成的源码注册表与皮肤目录，`aggregate:check`
校验聚合清单，`runtime-deps:check` 只证明裸导入可解析。

## Decision

`scripts/lib-artifact-check.mjs` 为每个被 git 跟踪 `lib/` 的包记录一份**源码输入**指纹：该包自己的
`src/`，聚合包另外加上 `aggregate.yml` 中列出的每个包的 `src/`。测试文件被排除，因为它们不会进入
bundle，改测试不应要求重建。指纹存放在 `scripts/lib-artifact-fingerprints.json`；`--check` 把记录值与
工作树比较，漂移即失败并给出重建指引。

接线：根脚本新增 `pnpm libs:check`（门禁）与 `pnpm libs:write`（构建后记录），CI 步骤置于 **Build
之前**——构建会让工作树变成刚重建的状态，从而掩盖过期的提交——根 AGENTS.md 写明"重建并记录"的规则。

为什么不与全新构建比对字节：构建会把 checkout 的绝对路径写进 bundle（CSS module 哈希），重建字节逐机器
不同。CI 工作流注释已记录这一约束，这也正是本门禁选择对源码取指纹而非对产物取指纹的原因。

## Verification

- `pnpm libs:check`：四个提交产物的包全部通过。
- `pnpm test:scripts`：280 条测试通过，其中 6 条新增，覆盖 bundle 源码过滤、与顺序无关的指纹、聚合输入
  解析。
- 本次会话涉及的产物已重建并带上修复——聚合 bundle 含新的 `usage.disabled` 文案与宠物的
  `workTickWindowMs` 闸门——指纹在同一次提交中重新记录。
- `pnpm docs:check` 与 `pnpm i18n:check` 在 AGENTS.md 更新后通过。

## Alternatives considered

用"构建后 `git diff --exit-code`"比对工作树被否决：绝对路径嵌入使重建字节与机器相关，凡是与生成该提交
的机器不同的 runner 都会失败。

把指纹存进各包 `lib/` 被否决：那会把构建簿记发布进每个 npm 包，`files: ["lib"]` 会把它送到用户手里。

让 `pnpm build` 顺带写入指纹被否决：CI 在 Build 之前跑检查、Build 之后写指纹，等于让门禁永远通过——
这恰恰是它最不能做的事。

只做 skin-center 的定向校验（比对 bundle 内嵌的 reviewed-hooks 表与生成的注册表）被否决：覆盖面太窄，
聚合包内联子插件源码的漂移仍无人看守，而那是同一失败类的另一半。

## Consequences

任何改动某包 `src/`（含子插件客户端源码）却未重建相应产物的提交现在会让 CI 失败，代价是贡献者多跑一次
`pnpm build && pnpm libs:write`。指纹只能证明"记录的那次构建之后源码没有再移动"，不能证明产物编译正确，
后者仍由 Build 步骤保证。皮肤资产与 `market/dist` 不在本门禁范围内：它们各自的检查
（`skin-hooks:check`、`market:check`）已经覆盖。
