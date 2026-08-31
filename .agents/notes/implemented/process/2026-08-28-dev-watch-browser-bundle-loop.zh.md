# dev:watch —— monorepo 开发流的浏览器 bundle 监听重建

状态：已实现
日期：2026-08-28

## 决策

`pnpm dev:watch`（scripts/dev-watch.mjs）为每个同时具备 `src/client/index.ts` 与 `tsdown.config.ts` 的包（当前 15 个）各起一个 `tsdown --watch`，让 Web GUI 服务的每个浏览器 bundle 在源码编辑后自动重建。

## 理由

- `dsh web` 宿主会对自己服务的 `lib/client.js` 做 stat 轮询并自行广播 `rebuilt` 帧（harness 自己的 `scripts/dev-web.ts` 文档记录的就是这套机制），所以任何重写这些 bundle 的进程都会触发 GUI 重载。monorepo 只需保证自己的 bundle 持续重建，链接进来的插件不需要 harness 侧 watcher。
- tsdown 直接从 `src/` 打包，`tsdown --watch` 单独即可刷新浏览器产物；`tsc -b` 仍是类型门禁，经 `pnpm typecheck` / `pnpm build` 在提交前运行，不进循环。
- 根目录直接跑 `tsdown --watch` 不可行：没有根配置会报 "No input files"——按包各起 watcher 是这里唯一被支持的形态。

## 影响

- 迭代闭环：一个终端跑 `pnpm dev:watch`，改客户端源码，bundle 落地后 GUI 自行重载。host 半区（`src/index.ts`）改动仍需重启 DSH 服务，交付报告照旧标注。
- watcher 重写的是与 `pnpm build` 相同的已提交 `lib/` 产物；输出字节稳定，干净的工作树不会被弄脏。
- 回滚：删除脚本与根 package.json 的 `dev:watch` 条目。

## 验证

- 2026-08-28：15 个 watcher 全部启动、零报错；touch `packages/dsh-session-id/src/client/index.ts` 触发 "Rebuilt in 26ms" 重建；全量重建后 `git status` 保持干净。
