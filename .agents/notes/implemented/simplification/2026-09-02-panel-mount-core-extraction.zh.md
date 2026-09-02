# Agent Note: ssh 与 task-board 共用一个中栏面板挂载核心

Status: implemented

## Problem

dsh-ssh 的 `src/client/mount.tsx` 与 dsh-task-board 的 `src/client/board-mount.tsx` 各自维护一整套中栏单占接管生命周期——向会话中栏注入容器、互斥驱逐、重挂载韧性、侧边栏点击退出——两份拷贝约 130 行中有约 100 行仅差七个参数（面板树、视图 dataset 键、语义插件名、CSS 类、两个 html 激活属性、事件 detail 名、控制器开/关方法）。重复不是假设成本：同一行为修复落地过两次，还是以独立 issue 与提交的形式——rc.6 centerCol 回退分为 #243（ssh，61153871f）与 #107（task-board，2ea4f965a）；互斥与侧边栏点击退出为 c0a98c715（双文件）；SDK locale 路由为 170b3df31（双文件）；L2 语义属性为 d73bffc2a（双文件）。侧边栏入口一对文件早已把共享逻辑收进 `shared/client/sidebar-entry-core.ts`（synced copy），挂载这一对却始终没做同样处理。

## Decision

接管生命周期现在只存在于 `shared/client/panel-mount-core.ts` 一处：`mountCenterPanel(options)` 拥有中栏选择器、MutationObserver 重挂载、驱逐加激活序列、侧边栏点击退出监听与 disposer 清理顺序；`CenterPanelMountOptions` 契约承载七个按插件变化的参数，外加控制器 subscribe 与可选 locale 源。该文件加入 sync-shared 清单，生成两份同步副本（`packages/dsh-ssh/src/client/panel-mount-core.ts`、`packages/dsh-task-board/src/client/panel-mount-core.ts`）；sync-shared 测试的副本计数桶由 112→114（总数）、41→43（client）。两个包装层缩到只剩参数接线（各约 45 行），公开导出不变（`mountPanel` + `PANEL_VIEW_SELECTOR`、`mountBoard` + `BOARD_VIEW_SELECTOR`），消费方代码与测试零改动。重建的聚合客户端 bundle（`packages/dsh-web-all/lib/client.js`）按源内联，行为一致。

容器属性名保持为包装层传入的参数：它们被各包 CSS（`panel.module.css` / `board.module.css` 互相引用对方兄弟面板的 html 属性）、wallpaper-exclusive 皮肤补丁与语义属性契约钉死，本次提取刻意一个都不改。

## Testing

隔离 worktree 中两个包的测试套件零改动通过：dsh-ssh 20 文件 / 150 测试，dsh-task-board 33 文件 / 314 测试（+1 skip），其中 `mountPanel`（panel-shell，#506）与 `mountBoard`（board-view，#506/#1233）生命周期用例经提取后的核心驱动驱逐、重挂载与点击退出。工作区门禁全绿：`pnpm -r typecheck`（22 个工程）、全量 `pnpm -r test`、`node --test scripts/*.test.mjs` 238/238、`node scripts/sync-shared.mjs --check`、`node scripts/aggregate.mjs --check`、`verify-docs`、`i18n-audit --check`。

## Alternatives considered

- 保留重复，靠 review 保持两份同步：拒绝——上文四轮双落地历史说明 review 拦不住，下一个修复要么改两遍要么让两份漂移。
- 抽成被两个插件引用的运行时 npm 包：拒绝——按浏览器 bundle 纯度规则，客户端必须自包含；sync-shared 提交副本模式是仓库既有机制（settings 三件套与 sidebar-entry-core 同款）。
- 只参数化属性名、保留两份 `ensure`/observer 实现：拒绝——重挂载与互斥恰恰是被成对修复的那部分；半提取会让高风险的一半继续重复。

## Consequences

今后接管生命周期的行为修复只改 `shared/client/panel-mount-core.ts` 一处并跑一次 `node scripts/sync-shared.mjs`。第三个采用接管模式的面板新增一份生成副本加一个包装层即可，不再复制 100 行。原始提交行数略升（一份共享源加两份生成副本）——这是 sync-shared 模式的既定取舍：单一可编辑源，包自包含。行为、CSS 选择器、html 属性、事件名与语义属性契约全部不变；[重挂载韧性修复](../../bug-fix/2026-08-27-task-board-return-button-and-remount-resilience.zh.md) 现在由这一个核心承载。
