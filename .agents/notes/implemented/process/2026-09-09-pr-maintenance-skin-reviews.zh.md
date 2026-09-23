# Agent Note: PR maintenance run 2026-09-09 — skin contribution reviews

Status: implemented

## Problem

分配给维护者账号的两个皮肤 PR 一直无人评审但 CI 全绿：#1420（blue-throated-bee-eater 选中行装饰与 token 精修）和 #1429（带可执行 hooks 的新皮肤 blueprint）。两者都交付用户可见的视觉资产，而 #1429 还附带皮肤 hooks——其受审身份登记在两份已提交的登记表中，所以仅凭 CI 无法下结论。与此同时，三个社区插件登记（#1399、#1321、#1318）仍在旧的 changes-requested 评审下等待作者。本次运行需要对每个 PR 给出带本地证据的结论，并沉淀「hooks 皮肤评审在 CI 之外必须检查什么」的持久结论。

## Decision

2026-09-09 对两个皮肤 PR 各提交一份 changes-requested 评审；三个登记复核后确认仍在等作者，无新决策。

#1420 卡在它自己的授权声明上：`NOTICE` 第 21 行写了 `selected-bee-scene.svg`，而这个文件在整个仓库里并不存在；真正新增的装饰资产 `selected-flower.svg` 反而未被登记。该文件会打进市场 zip，dist 副本也带着同样的文字。`skin.css` 第 179 行沿用同一份过期文案，描述「a small bee diving in to land on it」，而 SVG 自身注释明确写着「No bee」。`README.zh.md` 第 15 行把「从草地长出」的语义在同一句里重复了两遍。已核实不阻塞的部分：草地边与花朵在亮暗两态下都不遮挡文字（preview 已目检）；info token 补齐修复了隐形「推荐」徽章，暗色 tooltip 是有意的反色（四张真机证据截图都已查看）；`market/src/preview.html` 的相对 url 重写正确跳过协议相对、根路径、data 与 #fragment；「New Session」按钮在 dev 上渲染完全相同，属既有表现不属本 PR。

#1429 卡在一份与受审源码登记矛盾的已提交构建产物上：`packages/skins/skin-center/lib/index.js` 登记 blueprint 的 `hooksSha256` 为 `e61df689...`，而实际 `hooks.mjs` 的哈希是 `4f6c7db5...`，即 `packages/skins/skin-center/src/reviewed-hooks.generated.ts` 所记录的值。对两份登记表做哈希集合对比，已有 29 个皮肤条目全部一致，唯独 blueprint 不同——说明 hooks 文件在最后一次包构建之后又改过，lib 是旧产物。宿主以构建产物运行，`src/provenance.ts` 的 `verifyReviewedLegacyHooks` 查询的正是这份内嵌登记表，因此没有 provenance 文件的旧式安装会通不过 blueprint 的身份校验。评审要求先重建 skin-center 包（`pnpm --filter @linxin666/dsh-client-ui-skin-center build`），再跑 `node scripts/skin-hooks-registry.mjs --check`，然后才进入复审。其余部分已核实无问题：hooks 生命周期通过 `ctx.onCleanup` 释放全部定时器、监听器和品牌行 MutationObserver，页面隐藏时暂停时钟，pointermove 做 rAF 节流加 passive，品牌位逐字还原，body 背景与 style 属性恢复原状；两层 HUD 均为 `pointer-events: none`、z-index 40/41；order 5 无冲突；不放 README/LICENSE 与 miku、blue-fantasy 的目录约定一致；亮暗两态 preview 已目检。

登记表一致性检查——对每个被改动的皮肤比对 `lib/index.js` 与 `src/reviewed-hooks.generated.ts` 的哈希——自此列入 hooks 皮肤评审清单：任何在最后一次包构建之后又改 `hooks.mjs` 的 PR 都会重新引入这种漂移，而且没有 CI 门禁能兜住它。

#1399、#1321、#1318 自 2026-08-31 与 2026-09-07 的评审后没有作者的新提交或回复；#1399 与 #1318 还与 dev 存在冲突，#1321 的 CI 为红。按 [PR maintenance run 2026-09-07](2026-09-07-pr-maintenance-community-and-pets.md) 的既有记录继续搁置，不做仓库侧动作。

## Alternatives considered

批准 #1429 并让作者后续再修 lib 被否决：过期哈希正是「已提交产物必须一致」这条纪律要防的事，合并一个自相矛盾的登记会让旧式安装在下一次包构建前一直过不了身份校验。直接向 #1420 的 fork 推送 NOTICE 与注释修正被否决：这些是作者应当提供的内容，不是机械性冲突解决。再次否决关闭三个搁置中的登记：阻塞项仍然具体、可行动。#1429 上「CI 绿即可跳过本地验证」被否决：`ci.yml` 不跑 `market:check`，dist 新鲜度与登记表哈希必须在本地核实。

## Consequences

#1420 与 #1429 各自只差作者一次更新即可进入复审，两人都拿到了精确、可核对的修改清单。此后的 hooks 皮肤评审包含 lib 与 src 登记表的哈希对比；动过 NOTICE 类文档的皮肤 PR 必须重新生成 market dist 副本。三个社区登记保持开放、等待作者，仓库侧无待办。

## Testing

在两个 PR head 的 detached worktree 中：`node scripts/dsh-skin validate`（blueprint PASS）、`node scripts/skin-hooks-registry.mjs --check`（OK）、`node scripts/market-build --check`（dist 最新，1644 个文件；tryon 哈希清单通过）、`hooks.mjs` 与两份登记表的 sha256 对比，以及证明 blueprint 是唯一 lib 与 src 漂移项的哈希集合 diff。目检覆盖 bee-eater 亮暗两态 preview、四张 token 证据截图、blueprint 亮暗两态 preview。两个 PR head 的 CI（typecheck、skin-center:check、测试套件、docs:check）均为绿。
