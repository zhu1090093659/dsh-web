# Agent Note: 家族自更新成为独立插件行

Status: implemented

> 本决策的一部分已被取代：聚合不再挂载该行、也不再依赖该包——见[家族聚合退役自更新行](2026-11-01-retire-dsh-update-from-aggregate.zh.md)。包本身、行 id `update`、host/browser 分层与桌面/网页席位划分按本记录不变。

## 问题

dsh-web 家族的自更新面——侧栏下载触发器、其面板与 `/api/update` 路由——原先装在 `dsh-remote-web-ui` 里。侧栏底部每个插件行渲染自己的触发器，于是更新入口的生命周期就是远程访问插件的生命周期：关闭远程访问（`enabled: false`）或禁用 `web-ui-remote-web-ui` 行，更新触发器一起消失。这并不需要任何「放弃自更新」的意图——为安全关闭远程访问的 profile 会失去界面内唯一更新家族的途径。

## 决策

- **该能力拥有自己的包与行。** `packages/dsh-update`（`@linxin666/dsh-update`）声明行 id `update`；profile 装了这个包就挂载该行，聚合包不再携带 `web-ui-update` 行（[家族聚合退役自更新行](2026-11-01-retire-dsh-update-from-aggregate.zh.md)）。
- **host 半区随功能一起迁出。** `update.ts`（registry 探测、profile 锚定、带核对的 `pnpm update --latest`）与 `update-routes.ts`（`/api/update/status`、`/api/update/run`）落在该包；其入口把两条精确路由挂在共享的 `isLoopbackRequest` 栅栏之后。回退锚点包改为本包（`SELF_PACKAGE = '@linxin666/dsh-update'`），`@linxin666/dsh-web-all` 仍是首选锚点。
- **browser 半区自行注册席位。** 触发器与面板注册进官方 `sidebar.footer.action` 槽，entry id 为 `update`，使用新的 `update` 字典命名空间，DOM 上打 `data-dsh-plugin="update"`（`entry` / `panel` 部件）。
- **`dsh-remote-web-ui` 只保留与该路径相关的通道事实。** `/api/update/` 仍留在它的门控通道表（改写前缀与物理本地清单）里：不论由哪个包提供，配对远程都不能到达该端点。
- **桌面外壳不挂席位。** `shouldMountUpdateSeat`（src/client/page-target.ts）在应用交付页面——桌面外壳的 `dsh-app://app/`——拒绝挂载：该应用自带更新器，那里侧栏席位只保留手机远程触发器。判定命名的是**网页侧**（`WEB_PAGE_SCHEMES`），与配对围栏在 `dsh-remote-web-ui/src/remote-channel-rules.ts` 的分类一致；两份清单描述同一事实，必须一起改。
- **席位几何保持在原处。** 宽栏底栏行与栏轨堆叠规则仍留在 `dsh-remote-web-ui` 的 CSS module——它们是席位容器的规则，所有占据者共享。该插件被禁用时，更新触发器回落到官方 shell 自带的堆叠脚部：依然渲染可用，只是失去共用行的最优布局。

## 测试

- 迁出的测试随功能走：`packages/dsh-update/tests/update.spec.ts`（63）、`tests/update-entry.spec.tsx`（11），以及在新家钉住触发器形状家族（#1035）的 `tests/footer-trigger-css.spec.ts`。
- 新增 `packages/dsh-update/tests/update-routes.spec.ts`（6）在真实 loopback HTTP 服务上跑两条路由：status/run 的 JSON 契约、405 方法门、非回环 Host 拒绝与跨站拒绝——每条都断言注入的接缝未被执行。
- `pnpm i18n:check` 覆盖迁出的 42 键 `update` 命名空间；ru 字典移至 `packages/dsh-i18n/src/client/ru/update.ts`，审计包清单同步加行。

## 备选方案

- 在同一个包里只给远程设置加开关、保留更新席位挂载：否决——行自身的禁用开关仍会把更新触发器带走，而名为 `dsh-remote-web-ui` 的包持有家族更新器会让两个能力同属一个属主。
- 同一个包出两行：否决——客户端模块扫描器对每个包只解析一份 `dsh.client` 面，两行会加载同一个客户端半区，无法分别开关。
- 把席位几何移进新包或聚合 compat 层：否决——它是官方席位的布局，所有占据者共享；单一属主加 shell 自带回落才符合「一个事实一个家」。

## 后果

- 关闭远程访问（设置或整行）保留更新触发器；禁用 `dsh-update` 保留远程访问。每行在插件管理里各自开关。
- 该行只属于 `@linxin666/dsh-update`：profile 只有装了这个包才有 `update` 行；聚合包的 `web-ui-update` 挂载已退役（[家族聚合退役自更新行](2026-11-01-retire-dsh-update-from-aggregate.zh.md)）。
- 在缺少 `@linxin666/dsh-web-all` 时，单独安装的 `dsh-update` 以自己的包清单为锚点。
- ru 字典、同步清单（console-output/http/loopback/mount-once/telemetry/vitest.setup 副本）与 i18n 审计包清单都新增了对应的消费者行。
- dsh-skins 仓的语义属性契约表需要补 `update` 插件行及其 `entry`/`panel` 部件；该表属该仓所有，因此是跨仓后续项。
