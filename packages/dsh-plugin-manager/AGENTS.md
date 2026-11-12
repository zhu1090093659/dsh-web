# AGENTS.md — dsh-plugin-manager

DSH web GUI plugin dsh-plugin-manager. 包级规则：只写本包特有约定，不重复根 AGENTS.md 与
packages/AGENTS.md 的全局/包级规则。

## 本包要点

- 本包向官方「插件」面板（`main` 面板 id `plugins`）声明的 `plugins.detail.section` 席位贡献
  一个「检查更新」区块（id `family-update-check`，order 30），只渲染在已安装组合包的页面上；
  它不注册 `settings.plugins.tab`，也不拥有自己的设置分区——组合包的安装/卸载仍由官方页面负责，
  本包补齐官方页面没有的 registry 更新检查、DSH 运行时兼容门禁、内置插件启停开关与 Agent 预设展示。
  该席位是官方 list 槽，类型由官方页面运行时声明；本包在 `PluginUpdatePatch.tsx` 内以同形
  `declare module` 重新声明（跨包禁止 value import，与家族卡片复用
  `plugins.bundle.config` 的做法一致）。宿主交付的 `PluginPageSubject`（`bundle` / `row` /
  `item`）是契约观察，不是 import。
- **行 id 不与官方行重叠，`name` 保持恰好等于包名**：本包独立安装的行 id 是
  `ui-plugin-manager-update-check`；官方 `@deepseek-ai/dsh-web-app` 的 `ui-plugin-manager`
  归官方插件页（唯一注册 `sidebar.panellist` 的半区），两行必须并存——loader 同 id 后来者胜
  且不报错，重叠时侧栏「插件」入口与整个插件管理页静默消失（#1794）。行的 `name` 必须恰好是
  `@linxin666/dsh-client-ui-plugin-manager`：`dsh-client-modules` 只把浏览器半区挂在说明符等于
  包名的那一行上，改成家族子路径只挂 host 半区。host 半区的 cordis 插件名（`src/index.ts`）与
  行 id 同名，`LOCKED_ENTRY_IDS` 同时收录该独立行 id 与家族行 `web-ui-plugin-manager`；本包
  不变量由 `tests/bundle-row-id.spec.ts` 固定。聚合侧的家族行 id 与子路径 `plugin-manager` 由聚合
  清单的 `familyIds:` 映射钉住，不随本包独立行改名（见 dsh-web-all/AGENTS.md）。
- **列表级工具条只能插进官方页面的 chrome**：官方「插件」页的扩展点包括
  `plugins.detail.*`、`plugins.item`、`plugins.bundle.config`、`plugins.row.config`、
  `plugins.bundle.activation`，以及 0.2.1 起承载整页内容的 `plugins.tab`；后者会把批量更新藏到
  另一个 tab，不能替代「已安装」标题旁的即时检查/pending 计数。因此工具条仍由
  `plugin-toolbar-mount.tsx` 直接插进 `[data-plugin-panel] [data-plugin-group="bundles"]`
  的标题元素，并用共享的 `body-mutations.ts`（sync-shared 副本，勿手改）自查位；
  容器自持 React root，不做 DOM 改写。页面重绘/切走时容器自动挪位或摘除，重复 apply 通过
  `TOOLBAR_MOUNT_SELECTOR` 去重。
- **底部内置插件分组只能继续用 DOM 挂载**：官方「插件」页未提供列表底部扩展槽位（既有扩展点仅覆盖
  `plugins.detail.*`、`plugins.item`、`plugins.bundle.config`、`plugins.row.config`、
  `plugins.bundle.activation` 与 `plugins.tab`），因此「内置插件」分组与检查更新工具条一样，
  只能直接插入官方页面 DOM（独立 React root），并在页面重绘与切换面板时自动复位或摘除。
- **内置插件启停只走官方远端，不自建白名单**：内置插件行的启停开关必须调用官方 `pluginManager` 远端的
  `setPluginEnabled`，写入 profile 补丁层并热应用（带 HMR 的 profile 无需重启）。只读状态严格沿用官方
  manager 判定（`management-required` 与 `unaddressable` 锁）并显示锁原因，前端与 host 不得自建启停白名单；
  操作被接受后界面重新读取 Loader 确认状态（不相信返回值），失败按官方返回的 `error.code` 展示文案。
  下方「Agent 预设」区块因组合决定行状态而保持只读，不提供开关。
- **设置页内置插件入口由顶层裸行下线**：`cordis.patch.yml` 中包含顶层裸行 `- id: ui-settings-plugins` +
  `disabled: true`，聚合层在 `@deepseek-ai/dsh-web-app` 之后应用因此覆盖生效，下线原设置分区；
  相关管理收拢至官方插件页，禁用本包即可恢复原设置分区。
- **批量更新策略放 core，不放 host**：`src/core/updates.ts` 是唯一策略源——只更新第三方
  （非 `@deepseek-ai/`）且 `compatible !== false` 的行；官方包随 DSH 本体升级，绝不批量改写。
  单页区块（`plugins.detail.section`）仍可对官方包做单包更新，那是用户逐条确认的动作。
- **重启四态，禁止臆造命令行**：`src/host/restart.ts` 判定并回传实际模式——`relaunch`
  （终端启动：detached helper 等旧进程退出后重放本进程自身的 execPath + argv，剔除
  `--inspect*`）、`shell`（打包桌面**且**外壳声明了重启保证：只退出，由外壳重新拉起）、
  `systemd`（宿主从自身的 `/proc/self/cgroup` + `INVOCATION_ID` 认出所属 systemd 用户 unit，请
  systemd 执行 `systemctl --user restart <unit>`，由 systemd 停旧起新）、`manual`
  （无终端且非 systemd 用户服务，或桌面壳未声明保证：不退出，界面提示手动重启）。检测只认
  「可证明」的 systemd 用户服务：`INVOCATION_ID` 存在、cgroup 末段是 `*.service`、路径在
  `/user.slice/` 下、`$XDG_RUNTIME_DIR/systemd/private` 存在；system scope 与其它受监督启动一律维持
  `manual`。顺序约束：systemd 模式下必须先应答 202 再发重启请求（systemd 的 stop job 在请求入队即开始），
  失败只写 `$DSH_HOME/logs/plugin-manager-restart.log`，宿主继续服务。判定是纯函数
  `planRestart`，执行是 `performRestart`（helper 起不来时降级为 `manual` 而不是让进程白白
  退出）。新增重启路径前先确认宿主真的能重启，不要把「重启」做成静默失败。
- **重启路由必须按方法区分**：`GET /api/plugin-manager/restart` 只读方案（无副作用），wire
  形状为 `{ restart: { mode, unit? } }`，确认面板对 systemd 会写明将要重启的 unit 名；`POST`
  才执行，应答 `{ restart: { mode } }`，其他方法 405。缺了这道守卫时，一个普通 GET（浏览器预取、
  直接输入 URL、误探测）就能停掉正在运行的宿主并弹出桌面外壳的崩溃恢复对话框（2026-09-30 实证）。
  界面必须先读方案再确认：确认面板写的后果必须与 `POST` 实际产生的后果一致。
- **桌面壳未声明重启保证时不得退出**：打包桌面没有给 Web GUI 任何重启通道（preload 只暴露
  `dshDesktop.updates.status/open/subscribe`，IPC 里没有「请壳重启宿主」，`app.relaunch()`
  只能由外壳自己的恢复对话框触发），官方壳对宿主退出只做 `fail("dsh desktop host stopped")`
  并显示错误页——自己退出等于把应用变成死窗口。因此桌面端只在壳导出
  `DSH_SHELL_RESTARTS_HOST=1`（壳自己宣告会把退出的宿主重新拉起）时才走 `shell`，否则
  `planRestart` 返回 `manual`：进程继续服务，重启面板如实写「当前进程无法自动重启，请手动
  重启 DSH。」、给出手动替代（退出 DeepSeek Harness 后重新打开），并只渲染「取消」——这条路
  不会发出 `POST`，所以没有确认按钮。
- **双通道纪律**：运行时探测官方 `/plugin-installer` 通道，存在（DSHCode / 1.0.4
  checkout web）则全部走官方 RPC（单一写入器 = 官方安装器）；不存在（npm 发布的官方
  web）则走本包 host 半区的 loopback HTTP 网关——安装/卸载 spawn 官方 `dsh plugin`
  CLI（仍是唯一写入器），启停写 profile patch 的 `disabled` 覆盖行。
- **应用自有 profile 的更新走官方进程内管理器**：打包桌面启动（`facts.desktop`）里 CLI
  拒绝写该 profile（`dsh plugin --profile desktop …` 直接报错），更新必须经宿主挂载的
  官方 `pluginManager` 服务（`ctx.get('pluginManager')`，契约观察不 import）；其余运行时
  CLI 仍是唯一写入器，两条路径共用同一任务表、状态轮询与版本核对。
- **单条更新只调官方 `updateBundle`，不再自己拼两阶段**：0.2.2-rc.1 起官方管理器自带
  `updateBundle(name, version, { requestId })`——先核验目标（存在、声明 bundle、接受当前 DSH），
  `hmr` 挂载时先移除再安装并沿用原有勾选，安装失败或取消时自己把移除的版本装回。因此
  `runNativeUpdate()` 只剩一次官方调用加两道官方没覆盖的守卫，`installBundle` 后的
  `already-installed` 分支、自建回滚与 `replaceInstalled`/`removeForReplacement` 一并删除；
  运行时没有 `updateBundle`（低于 0.2.2-rc.1）时明确报「没有 updateBundle」而不是退回旧路径。
  `package.json` 的 `dsh.engines.dsh` / peer 下限就是这条前提。见
  [记录](../../.agents/notes/implemented/bug-fix/2026-10-18-plugin-manager-official-update-bundle.md)。
- **官方 `updateBundle` 之外的守卫只有两条**（issue #1905）：① 官方移除会把该包从
  `dsh.profile.bundles` 删掉、重装再追加到末尾，而该数组就是 loader 套用 patch 的层级顺序，
  所以 `restoreBundleIndex()` 必须在更新落地后把包放回原位（成功与失败回滚都要）；② 官方守卫是
  先取消勾选并 reload、**之后**才判定行是否仍有活跃 fiber，因此 `applyNativeUpdate()` 针对这个
  已落盘状态重试一次，第二次仍被拒才用 `setBundleEnabled` 还原选择状态并在错误里点名重启。
  不要把这条重试改成「直接报错」或「循环重试」。
- **批量更新是 host 侧对单条官方原语的串行，不是一个新写入器**：`updateAll()` 只起一个任务，
  按给定顺序逐条跑 `updateBundle`（非应用自有 profile 时逐条跑 CLI），`job.results` 每行带
  `phase` / `targetVersion` / `landed` / `error` / `restartRequired`，`job.current` 是在跑的那行。
  一条被拒**不终止**整批：官方与 CLI 的单条写入本身就带原子性。路由 `POST /api/plugin-manager/updates`
  先按单条同一套规则解析每个 id（`planUpdate()`），解析不了的行以该行错误进任务而不是让请求失败；
  批量任务收尾一律 `done`，失败事实在各行上。见
  [记录](../../.agents/notes/implemented/bug-fix/2026-10-18-plugin-manager-official-update-bundle.md)。
- **官方管理器 resolve 不等于成功**：它的 `change()` 包装器把失败折叠进返回值
  （`application: 'failed'` / `'cancelled'`，附 `error.code` / `error.diagnostic`），而不是
  抛错。原生安装/更新/卸载必须先经 `nativeManagerFailure()` 读该判定再重读 profile，
  否则会把 pnpm 已经拒绝的运行报成「官方插件管理器报告成功，但…未生效」，把真实原因
  （例如 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`）藏起来。判定形状见
  [更新路径记录](../../.agents/notes/implemented/bug-fix/2026-09-26-plugin-manager-app-owned-update-path.md)。
- **CLI 是 Node 脚本时不能用 shebang 直接 spawn**：GUI 启动的宿主（桌面应用）PATH 里没有
  `node`，`#!/usr/bin/env node` 会在 CLI 启动前以 `env: node: No such file or directory`
  （退出码 127）失败。用 CLI 旁的 `node`（npm-global/homebrew 布局），否则用
  `process.execPath` 执行脚本，并把 CLI 所在目录放到子进程 PATH 首位——`dsh plugin`
  转发的 pnpm 就在那里。
- 网关安全：所有 `/api/plugin-manager/*` 路由必须经 `isLoopbackRequest` 门禁；
  set-enabled 写文件走备份 + tmp + rename；不改其它写入器的行（insert 格式行内层
  `disabled` 除外，见 `src/host/rows.ts`）。
- 目录分区：`src/index.ts` host 半区（网关挂载）；`src/host/` 网关实现（profile
  解析、行编辑、CLI 作业、路由）；`src/client/` browser 半区（更新区块 UI、槽位注册、
  双通道封装）；`src/core/` 两侧共享纯逻辑（wire 解析、层 diff、冲突行形状）。
- **启动 profile 解析**：桌面端启动器通过 `runProfile({ profile: 'desktop' })` 启动，
  既不传 `--profile` 也不导出 `DSH_PROFILE`，因此 `resolveProfile()` 除 argv 与环境外
  还必须读宿主发布的 `profileContext`（可选 `ctx.get`）以及启动器 argv 里位置参数携带的
  profile 目录（Electron 会剥掉 exec 开关，故桌面宿主 argv 形如
  `[execPath, dsh-desktop-host/lib/index.js, <dsh>, <profileDir>, …]`）。优先级为显式
  `--profile`、已发布 profile、argv 启动目录、`DSH_PROFILE`、`web` 子命令、桌面端
  持久化选择，别无来源时保持休眠（不猜测 profile）。已发布事实按外来输入处理：名称做
  穿越校验，`dir` 必须为绝对且
  无穿越的路径，`patchPath` 只在等于该 profile 自己的 `cordis.patch.yml` 时接受
  （它是写入目标）；`desktop` 只由启动器事实决定，不由 profile 名称推断。详见
  [Agent Note](../../.agents/notes/implemented/bug-fix/2026-09-26-plugin-manager-desktop-launch-profile.md)。
- wire 形状镜像官方 `ui-settings-plugin-installer` 的协议（DSH 源码 checkout），是
  契约观察而非 import；形状变化时更新 `src/core/protocol.ts` 与测试。
- 已随「插件管理」Tab 移除的能力（`src/core/repair.ts`、修复会话、安装冲突 UI、
  安全模式横幅、只读清单与子插件展开）不要再以 client UI 形式加回：host 侧的冲突 / notice
  台账（`GatewayJob.conflicts` / `notices`）保留为可观测事实，但没有渲染方。
- 共享件副本：`src/mount-once.ts`、`src/host/loopback.ts`、`src/host/dsh-home.ts`、
  `src/client/body-mutations.ts` 由 `scripts/sync-shared.mjs` 生成，禁止手改。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-client-ui-plugin-manager typecheck
pnpm --filter @linxin666/dsh-client-ui-plugin-manager test
pnpm --filter @linxin666/dsh-client-ui-plugin-manager build
```
