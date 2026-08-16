# AGENTS.md — dsh-shutdown

DSH Web GUI 的一键关机插件（UI 类插件）：侧边栏底部「设置」旁一个关机样式
按钮，点击弹出确认框，确认后请求宿主进程退出。

## 退出语义（本包最重要的纪律）

- 退出走宿主进程的 `ctx.appExit`（dsh launcher 提供的 bounded exit：先回收
  插件树再退出进程）；`appExit` 缺失时（手建树/测试）回退 `process.exit(0)`。
- `/api/dsh-shutdown` 路由**仅限 loopback**（复制 dsh-ssh 的围栏），拒绝
  LAN/跨源请求——它能终止宿主进程，绝不能暴露到局域网。
- 退出会终止 dsh web 进程：正在运行的会话、任务与未保存状态可能中断，按钮
  必须先经确认框（`confirmShutdown` 可关闭确认，默认开启）。

## 代码分区

- host 面：`src/index.ts`（settings + 系统提示词 + 路由注册）、`src/routes.ts`
  （loopback 围栏 + 退出路由，注入式可测）。
- client 面：`src/client/ShutdownEntry.tsx`（侧边栏按钮 + 确认弹窗）、
  `src/client/ShutdownSettingsCard.tsx`（设置卡）。
- 共享常量（路由路径）在 `src/core/shutdown.ts`，两侧引用同一事实源。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-shutdown typecheck
pnpm --filter @linxin666/dsh-client-ui-shutdown test
pnpm --filter @linxin666/dsh-client-ui-shutdown build
```
