# Agent Note: 2026-09-21 PR 维护运行（第十八轮）——合入 dsh-genui 包名修复与 dsh-mcptoon 登记，三份变更请求

Status: implemented

## Problem

`zhu1090093659/dsh-web` 的第十八轮维护，接续[第十七轮](2026-09-20-pr-maintenance-seventeenth-pass.md)。默认范围：分配给维护者账号 `zhu1090093659` 的开放 PR，不扫描 Issue。范围内共 11 个 PR：4 个是上一轮之后新增的（#1662 dsh-mcptoon 登记、#1659 claude 皮肤、#1658 dsh-model-priority 登记、#1657 dsh-genui 包名修复），#1607 推送了回应第三次变更请求的新提交，另有 6 个延续项（#1626、#1603、#1526、#1488、#1479、#1399）仍停在无人回应的变更请求上。它们当中没有任何一条协作者正式 review——全部正式 review 都来自当前认证的维护者账号本身，所以「协作者已审查」的跳过规则不适用。

## Decision

两个 PR 合入，三个 PR 附上具体可验证的变更请求退回，六个确认仍被作者阻塞。

- #1657（社区索引里的 `dsh-genui` 包名，作者 PerryLink）以 `523f92d9c` 合入。索引里仍写着 `@omdsh-dev/dsh-genui`，而该 npm scope 已整体下架：旧名在注册表返回 404，`@changfenhuang/dsh-genui` 返回 200（latest 0.11.0），其 `repository` 指向条目本就登记的 `omdsh-dev/dsh-genui` 仓库。改完两份索引文件里不再有任何 `@omdsh-dev/` 包名。
- #1662（登记 `dsh-mcptoon`，作者 activeing123）批准并以 `63ad1c8aa` 合入。实用性：它把 mcptoon 挂成一条 stdio MCP 服务，让工具发现走压缩视图而不是每轮支付上游完整的 JSON schema，索引里没有同形态的条目。稳定性：上游仓库公开、未归档、Apache-2.0，5 次提交，最近推送 2026-09-16，带 `test/manifest.test.mjs` 与一条绿灯的 `ci.yml`；`lib/` 入库且 `dsh.bundle.patch` 指向包内 `cordis.patch.yml`。兼容性：补丁只插入一条 `@deepseek-ai/dsh-mcp-client` 条目，纯 host 半区（作者主动说明未声明 `dsh.client`），`tools/dev` 是合法枚举组合，id 与 npm 名都不冲突。另记一条不阻塞的建议：包把 `@deepseek-ai/dsh-mcp-client ^0.1.1-rc.2` 声明为硬依赖，而该 SDK 没有发布过正式版本，这个范围只会解析到那一版旧预发布，宿主当前 cohort 是 0.1.5-rc.x——补丁按包名从 profile 取模块，嵌套副本用不上，应放进 `devDependencies` 或改成 peer 范围。
- #1607（红猪、最后流亡、白蛇三套皮肤，作者 binlecode）再次请求修改。作者确实删掉了 6 个商业 MP3 与播放器代码，也把只有壁纸底图的证据换成了六张 1440x900 亮暗界面截图，所以两项既有阻塞复核后关闭；但这次删除本身成了阻塞点。三套皮肤的 `hooks.mjs` 都引用了文件里已不存在的标识符：`porco-rosso` 第 636 行调用 `applyCardTheme()`、第 645 行调用 `setTrack(0, false)`，两者都没有定义；`last-exile` 第 609 行调用未定义的 `applyCardTheme()`；`white-snake` 第 871 行定义了 `applyCardTheme`，但函数体给 `disc`、`discCore`、`tagBadge`、`title`、`subtitle`、`playIcon`、`nextBtn`、`volBtn`、`volSlider` 赋值，这九个标识符一个都没声明。由于每个 `applyTheme()` 的第一句都是 `applyCardTheme()`，实际执行每个 hook 分别复现出 `ReferenceError: setTrack is not defined`（porco-rosso，`apply()` 从此中断，含侧栏挂载在内的后续逻辑都没跑）、`ReferenceError: applyCardTheme is not defined`（last-exile）与 `ReferenceError: disc is not defined`（white-snake，发生在主题回调里）。皮肤控制器会捕获 hook 错误并保持静态皮肤生效，所以界面看起来正常，而壁纸切换浮层、昼夜联动与侧栏挂载实际是坏的。
- #1659（claude 皮肤，作者 aklnaaw）请求修改。皮肤本身通过评审——两张 1440x900 预览我都看过，亮暗两态完整一致、做了完整的 token 重映射而非简单改色——但有两处阻塞。其一，提交的市场产物是旧的：在 PR head 上 `node scripts/market-build --check` 退出码 1，因为 `market/dist/assets/skins/claude/preview/{light,dark}.jpg` 是重拍前的文件（30,197 与 31,205 字节，而包内是 46,145 与 45,130），重拍发生在最后一次市场构建之后；重新生成只改动了 `claude.zip` 与这两张预览，之后校验转绿。其二，目录自托管了 Inter、Newsreader、JetBrains Mono 四份 woff2（SIL OFL 1.1，要求版权声明与许可证随文件分发），但权利人、许可名称与出处都没有落进仓库记录，PR 描述只写了皮肤版权归作者；仓库对这类第三方素材的惯例是 README 的 `Source and copyright` 一节，`island-life` 对其 Animal Crossing 致敬就是这么写的，缺失的 Anthropic 商标与非官方声明也应写在那里。
- #1658（登记 `dsh-model-priority`，作者 mengge237）因一处安全问题请求修改。插件给所有响应都加了 `Access-Control-Allow-Origin: *`，但它的路由是直接注册在 `ctx.webServer` 上的，而宿主只对 `client-connection` 通道和首页做鉴权：`dsh-host-webserver` 匹配到路由后直接交给插件 handler。实测也一致——不带 token 请求 `curl http://127.0.0.1:3080/git/branches` 返回 405，说明请求进到了插件 handler 而不是被 401 拒绝。于是用户访问的任意网页都能读到插件自己的本地接口：`/dsh-model-priority/proxy-status` 会在 `proxyBaseFor` 里回显本机代理 token，`/dsh-model-priority/settings-order` 与 `/proxy-enable` 会改写 `~/.dsh/settings.yaml`。变更请求要求去掉通配跨域头、不再回显 token，并给改写 settings 的路由加校验。另附两条不阻塞的说明：描述仍说面板挂在 `dsh-better-sidebar` 上，而代码自 2026-09-10 改版起用的是官方槽位 `settings.models.provider-card`；上游仓库是 PR 当天新建的单提交仓库，没有 CI、tag 或 npm 发布。
- 六个延续项（#1626、#1603、#1526、#1488、#1479、#1399）仍被作者阻塞：每个 head SHA 仍等于其最近一次 review 所针对的提交，没有新工作可评审，既有变更请求继续有效。#1399 仍是草稿。

## Alternatives considered

把 #1662 与 #1658 放进一次集成、靠重新生成派生清单化解两者共同的追加位置，被否决：#1658 本来就需要改代码，先合入干净的那个能让每个 PR 的验证保持独立。结果是 #1658 现在与 `dev` 冲突，已在该 PR 上说明。

把 model-priority 的跨域与 token 发现按第十七轮对 PerryLink 批次依赖问题的处理记为不阻塞建议，被否决：这是一条能触及用户 settings 文件与本地密钥的可利用路径，不是打包偏好，而修复只需去掉一个响应头。

因为 #1607 门禁全绿、作者也声称播放器已删干净就批准，被否决：`node --check`、`dsh-skin validate`、`skin-hooks-registry --check` 与 `market-build --check` 校验的是语法、清单与字节哈希，从不执行 hook，因此都看不见悬空引用。

接受 #1659 按作者原样给出的来源信息（只写皮肤版权、字体无归属），被否决：仓库对随包第三方素材的惯例是 README 的 `Source and copyright` 一节，且 OFL 要求版权声明与许可证随字体文件分发。

因为时间过去了就重新评审六个延续项，被否决：它们的 head 自上次评审起未变，对同一份代码再下一次结论只会改变 review 状态而不增加证据。

## Consequences

`origin/dev` 现在带有 `523f92d9c`（#1657）与 `63ad1c8aa`（#1662），本地 `dev` 已快进到 `63ad1c8aa`。社区索引从 117 条增至 118 条。#1658 的追加位置与已合入的 #1662 相撞，需要在改完代码后一并 rebase。仍有 9 个 PR 开放：三个带着新的变更请求，六个被作者阻塞。本次评审的改动没有触及 Wallpaper Engine / 渲染器路径，无需通知协作者。本轮 Note 提交按第十七轮的先例留在本地：被接受的 PR 提交都经 GitHub 进入了 `origin/dev`，而当前请求没有要求发布这条 Note。

## Testing

每个 PR 都在从 `origin/dev` 创建的独立 `wt` 工作树中验证，测试前先合入该 PR head。

- #1657（`maint-1657`）：`refs/pull/1657/head` 合并干净；`node scripts/community-index --check` OK（117 条）；`node scripts/market-build --check` dist 最新（3230 文件）；注册表对旧名 404、新名 200，并把其 `repository.url` 与条目 `repo` 做了比对。
- #1662（`maint-1662`）：合并干净；`node scripts/community-index --check` OK（118 条）；`node scripts/market-build --check` dist 最新（3230 文件）；上游仓库、许可、提交数、工作流、测试树、tarball 内容与 peer 范围通过 `gh api` 与 `npm view` 只读取证。
- #1659（`maint-1659`）：合并干净；`node scripts/dsh-skin validate packages/skins/skin-center/skins/claude` PASS；`node scripts/skin-center-catalog-check --check` OK（43 套）；`node scripts/market-build --check` 报 `market/dist stale — run scripts/market-build and commit: assets/skins/claude/preview/dark.jpg, assets/skins/claude/preview/light.jpg`；重跑 `node scripts/market-build` 只改动了 `claude.zip`、`preview/light.jpg` 与 `preview/dark.jpg`，之后校验退出码为 0。
- #1607（`maint-1607`）：`refs/pull/1607/head` 合并干净；porco-rosso、last-exile、white-snake 三套 `node scripts/dsh-skin validate` 均 PASS；`node scripts/skin-hooks-registry.mjs --check` OK；`node scripts/skin-center-catalog-check --check` OK（45 套）；`node scripts/market-build --check` dist 最新（3280 文件）；每个 `hooks.mjs` 在包内与 `market/dist` 副本的 sha256 相同，且与 `reviewed-hooks.generated.ts` 一致；再把每个 `hooks.mjs` 导入 jsdom 文档并调用 `apply(ctx)`，复现出三个 ReferenceError。
- #1658：只读检查上游仓库（`lib/index.js`、`lib/client.js`、`package.json`、`cordis.patch.yml` 与仓库元数据）、已安装 `@deepseek-ai` 包中宿主的路由注册实现，以及对运行中宿主的 `curl` 实测。
- 未验证：mcptoon 与 model-priority 两个插件都没有在本机挂载运行，运行时结论依据上游源码、测试与 CI；claude、porco-rosso、last-exile、white-snake 四套皮肤也没有在运行中的 GUI 里切换过，hooks 是通过桩化上下文而非真实皮肤控制器执行的。
