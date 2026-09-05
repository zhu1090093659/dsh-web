# Agent Note: Doctor 子进程以 ELECTRON_RUN_AS_NODE 派生

Status: implemented

## Problem

Issue #1382：DSH Desktop 2.0.4/2.0.5 搭配 dsh-web-all 0.3.16 时，DSH 主窗口大约每半分钟被还原并抢一次焦点。报告者的进程日志显示每隔几秒就出现一个携带 `cli.mjs supervisor --parent-pid <pid>` 的新 `DSH Desktop.exe` 进程，`deployed.json` 持续报 "supervisor is not provisioned"，`reconcile.lock` 约每 25 秒刷新一次。关闭 doctor 插件后循环停止。

doctor 的 host 半部运行在桌面版内嵌的宿主进程里，此时 `process.execPath` 是桌面 GUI 二进制（Electron 可执行文件）。doctor 的 `defaultSpawnSupervisor` 以 `env: process.env` 直接 spawn 该二进制，于是在 Electron 宿主下拉起的是第二个 GUI 实例而非无头 Node 子进程：单实例锁拒绝它，主窗口经 `second-instance` 处理器被还原并抢焦点，子进程随即退出、永远无法应答 IPC。心跳失败路径随后再次 kick 自动对账器，对账器再次 spawn——焦点 stealing 循环就此形成，supervisor 永远处于未完成 provision 的状态。`ensureDoctor` 里的 capsule `provision` 子进程有同样的缺陷。

## Decision

`packages/dsh-doctor` 现在统一经 `nodeChildEnv()`（`host/ensure.ts`）派生 Node 子进程：展开宿主环境并强制 `ELECTRON_RUN_AS_NODE: '1'`：

- `defaultSpawnSupervisor` 以该环境 spawn supervisor 子进程；
- `ensureDoctor` 的 capsule `provision` 子进程经 spawn seam 的 `env` 选项获得同一环境。

真实 Node 二进制会忽略该变量，普通 `dsh web` 部署不受影响；Electron 二进制则会把子进程当纯 Node 运行——无窗口、不触碰单实例锁，supervisor 得以真正应答。

桌面壳侧的纵深防御：`desktop/src/runtime.cjs` 新增纯函数 `isProgrammaticLaunch(argv)`，`desktop/src/main.cjs` 对 argv 带编程式启动标记（`cli.mjs`、`supervisor`、`provision`、`--parent-pid`）的 `second-instance` 启动不再还原/聚焦主窗口。真实用户双击不带参数，行为不变。

## Testing

- `packages/dsh-doctor/tests/host-ensure.spec.ts` 覆盖 `nodeChildEnv`，断言 supervisor 子进程以 `ELECTRON_RUN_AS_NODE: '1'` 与 parent-pid 参数 spawn，并断言 provision spawn 收到相同环境。
- `desktop/tests/runtime.test.mjs` 覆盖 `isProgrammaticLaunch` 对用户启动与 doctor/CLI 子进程的区分。

## Alternatives considered

- 只修桌面壳的 `second-instance` 处理器：所有其他内嵌该插件的 Electron 宿主仍会复现同一 spawn 循环，且 supervisor 依旧死于单实例锁、永远无法完成 provision。
- 改为从 PATH 解析真实 Node 二进制而非 `process.execPath`：在不同打包布局下（桌面 runtime 目录、npm shim、PATH 极简的 GUI 启动器）都很脆弱，有 `ELECTRON_RUN_AS_NODE` 后并无必要。

## Consequences

- Doctor 子进程继承 `ELECTRON_RUN_AS_NODE=1`；supervisor 再派生的孙进程若本应把桌面 GUI 二进制当应用运行，也会被当成 Node 运行。现有子进程只 spawn 真实 `dsh` CLI 或系统工具，这正是期望行为。
- 壳侧守卫按 argv 子串匹配；编程式启动若改变参数拼写，需同步更新 `runtime.cjs` 的 `PROGRAMMATIC_LAUNCH_MARKERS`。
- 壳侧守卫要等下一次桌面打包才会到达用户；插件侧修复随正常 npm 发布生效，桌面宿主需重载 bundle。
