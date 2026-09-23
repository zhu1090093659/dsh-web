# Agent Note: 2026-09-13 issue 批次——七项经核实的修复

状态：已实现 (implemented)

## 问题背景

2026-09-12 一天内 issue 追踪新增 13 条。核查以 `dev`（`d56328c7`）为基线逐条读取报告引用的源码位置，而不是直接采信报告结论：其中 2 条已由维护者修复（#1500、#1501），1 条无法触发，1 条需要 GUI 证据，1 条属功能请求，其余 7 条为真实且可达的缺陷。本记录覆盖这 7 项修复，每项都限定在拥有该缺陷的包内。

## 技术决策

1. 会话归档大小排序（#1503）：`core/selection.ts` 对缺失的 `sizeBytes` 采用与时间字段一致的语义——两个方向都排在最后——不再用 `-1` 顶替（原实现使未知大小升序排最前、降序排最后）。
2. 会话归档跳过清单（#1504）：`core/cascade.ts` 的 `planDelete` 用 `skippedIds` 集合保证每个 id 只登记一次；被直接选中且自身受保护的会话保留自身原因，而不是被更粗的 `family-protected` 抢先登记。重复项此前会虚高确认弹窗的跳过数量、在结果列表里重复出现，并因 store 按 id 去重而让批处理进度条读不到 `total`。
3. 宠物饰物计时（#1506）：`client/PetSprite.tsx` 在追赶循环每推进一帧后重新读取 `decoration.durations[index]`，使扣减与下一次调度都基于落点帧自身的时长。内置鲸鱼饰物各帧时长相同，但饰物契约与解析层允许逐帧 `durations` 数组。
4. 自动隔离（#1507）：`client/auto-isolation.ts` 增加按目标的工作中集合，在首个流程路由期间吸收第二次 `startSession`（侧栏按钮没有 disabled 态，官方 `startSession` 也是即发即忘）；回滚时先通过可选的 `workspaces.delete` 撤销工作区注册，再删除 worktree 目录，避免启动失败后留下指向已删除路径的工作区条目。
5. describe-image 孤儿附件（#1508）：`client/send-hook.ts` 先读取全部文件再统一上传，本地读取失败会直接回退到原始发送、宿主侧不留任何已存对象。上传失败仍可能残留此前已成功的上传：官方附件服务没有删除接口，也从不回收未引用对象。
6. 冰晶公主气泡（#1515）：该皮肤在两个主题块都改为深色气泡（`--dsw-alias-tooltip-bg: #1d315a`、`--dsw-alias-tooltip-fg: #eaf3ff`）。官方 Tooltip 的文字固定为静态白 `--dsw-static-neutral-bluish-00`，浅色底会让所有提示不可读，而皮肤自设的 `-fg` token 并不生效。
7. 远程访问指引文案（#1517）：`status.lanRequiredHint` 改为指向局域网开关真实所在的界面（设置 → Web 插件 → 远程访问），zh、en 同步、ru 镜像，不再声称配对面板内有设置卡片。
8. 折叠轨与设置弹窗（#1510）：官方设置面板内联渲染在侧栏底部，而聚合包的窄屏收起规则会把该底部整块 `display: none !important`，同时收起态的侧栏还会施加 `pointer-events: none`。响应式外壳现在只把「确实含有已打开对话框」的侧栏子树恢复（`:has([role="dialog"], [aria-modal="true"])` + `display: flex !important` 与 `pointer-events: auto`）；没有对话框时折叠轨行为完全不变。

拥有其中部分决策的记录已在同一次变更中更新：[会话归档管理器](../feature/2026-08-31-session-archive-manager.md)（删除计划规则）、[git worktree 并行会话](../feature/2026-08-26-git-worktree-parallel-sessions.md)（自动隔离），以及[能力缓存失效记录](2026-08-25-native-image-capability-cache-invalidation.md)（#1509）。

## 否决的备选方案

- 冰晶公主气泡改走 `patches.css`：用 `[role="tooltip"]` 颜色覆盖（若干浅色皮肤的做法）同样可行，但把修复留在 token 层可使皮肤保持纯 token 资产，也与报告者的建议一致。
- 在发送钩子里删除孤儿附件：附件服务没有删除接口且刻意不做回收，钩子只能避免产生它们。
- 把第二次 `startSession` 去抖到官方路径：那样会在主检出里再开一个会话，比丢弃重复点击更糟。
- 为 `createSequenceTimeline` 增加零时长防护（#1505）：现有全部调用链都不可达——`registry.ts` 会拒绝序列少于 5 段动画、轨道时长非正的宠物。记为纯防御性编码，未修改。

## 暂缓项

- #1498（任务栏闪烁 + 音频提醒）：属功能增强，社区插件 `dsh-notifier` 已覆盖大部分；任务栏闪烁需要 Electron 外壳而非 Web 插件。
- #1510 的窄视口 GUI 验证：机制已由源码证明（官方侧栏快照显示承载 `sidebar.settings` 槽位与设置浮层的 `.footArea` 正是被收起规则隐藏的非首个子节点，浮层本身是 `position: fixed` 且带 `role="dialog"`），外壳契约也有单测覆盖，但本检出无法驱动真机/窄屏 GUI，仍需报告者在设备上确认。

## 影响与收益

每项修复都带一条在旧代码上会失败的回归测试：未知大小排最后且跳过清单不重复、追赶跨越不等长帧、双击只建一个 worktree 且回滚会注销注册、本地读取失败后零次上传、在途能力判定不会被回填、气泡对固定白字的对比度、以及局域网文案里的设置路径。

## 验证结论

`pnpm --filter @linxin666/dsh-session-archive test`（86 项通过）、`pnpm --filter @linxin666/dsh-pet test`（512 项通过）、`pnpm --filter @linxin666/dsh-client-ui-git-graph test`（151 项通过）、`pnpm --filter @linxin666/dsh-tool-describe-image test`（388 项通过）、`pnpm --filter @linxin666/dsh-remote-web-ui test`（358 项通过、1 跳过）、`pnpm --filter @linxin666/dsh-client-ui-skin-center test`（638 项通过），以及仓库门禁 `pnpm typecheck`、`pnpm test`、`pnpm i18n:check`、`pnpm aggregate:check`、`pnpm skin-center:check`、`pnpm market:check`、`pnpm libs:check`。
