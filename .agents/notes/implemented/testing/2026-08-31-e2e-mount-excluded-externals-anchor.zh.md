# Agent Note：e2e 挂载冒烟仍断言被排除的外部插件挂载

Status: implemented

## Problem

v0.3.9 发布管线跑完了 tag 触发的 `build, test, gated npm publish` job 的全部门禁，并把整个家族发布到 npm。下游 `verify-release` job 的挂载冒烟通道（`scripts/e2e-mount.sh` + `tests/e2e/mount.e2e.ts`）失败，导致 GitHub Release 没创建：冒烟在等待 `[data-dsh-better-sidebar]` 时超时。

这条断言已过时。alpha.2 cohort 移除了 `dsh-better-sidebar` 与 `@mlgbnb/dsh-archive-manager` 硬依赖的 `@deepseek-ai/dsh-client-runtime` 面，两者因此从 `dsh-web-all` 聚合中排除（见 [sdk-cohort 0.1.2-alpha.2 upgrade](../architecture/2026-08-30-sdk-cohort-0.1.2-alpha.2-upgrade.md) 及其 "exclude alpha.2-incompatible external plugins" 提交）。`scripts/aggregate.test.mjs` 在同一个变更里已同步改为断言这两个**不得**挂载（`cordis.patch.yml` 里不得出现 `web-ui-better-sidebar` / `web-ui-archive-manager` 行），但 e2e 挂载冒烟被漏掉了：它仍要求 better-sidebar 的宿主 div 出现，与它本该冒烟验证的排除自相矛盾。npm 内容是对的，只有冒烟的「启动证明」错了。

## Decision

把 `tests/e2e/mount.e2e.ts` 改写为断言排除后的启动契约，而不是被删除的挂载：

- 启动证明锚在 `[data-dsh-frame]`——官方宿主帧，shell 总会渲染（被 dsh-web 多个插件 CSS 引用、也被聚合 shim 引用）且对 cohort 稳定、不依赖任何外部插件；
- 断言 `[data-dsh-better-sidebar]` **缺席**（count 0），而非出现；
- 保留无崩溃条 / 无 pageerror / 无插件控制台错误断言（`dsh-better-sidebar` / `archive-manager` 的崩溃前缀模式仍作为反向守卫有用）。

测试同时注明 `@morlay/better-session` 保留但默认关闭，因此没有任何 e2e 断言要求它挂载。

## Alternatives considered

- 锚在 `[data-dsh-plugin]`：拒绝——该属性只由特定插件面发出（例如 remote-web-ui 的抑制键），并非 shell/家族根，聚合应用上不出现，等待会超时。
- 保留 better-sidebar 挂载断言并重新加入插件：拒绝——会撤销刻意为之的 alpha.2 排除；该排除是为了避免 loader 启动中止。
- 锚在页面标题 / `body`：拒绝——更弱，不是 DOM 挂载契约。

## 后续：改锚点没有让 CI 转绿；真正的阻塞是 token URL 被截断

`[data-dsh-frame]` 改写修掉了过时断言，但 dev CI 持续失败（连续八次运行，15:34-01:36 UTC）——仍是 30 秒超时，只是改等帧选择器。这些运行的页面快照显示的是浏览器认证 401 页（`dsh web authentication required; reopen the URL printed by dsh web.`），不是应用：alpha.2 的 `dsh web` 打印带 token 的根 URL（`dsh web: http://127.0.0.1:PORT/?token=<launch-token> (LAN: ...)`），而 `scripts/e2e-mount.sh` 用 `grep -oE 'dsh web: http://127\.0\.0\.1:[0-9]+'` 解析——静默丢掉了 `?token=` 段，于是 Playwright 撞上认证门，帧永不挂载。两个独立原因曾被合并成一个：断言过时 AND alpha.2 harness 开始给根 URL 加浏览器认证门。

下方 Testing 段原本声称认证门只是本地干扰（alpha.1 源码检出），CI 全局 `alpha.2` CLI 不提供它。这是错的：固定 `@deepseek-ai/dsh@0.1.2-alpha.2` 的每一次 CI 运行（提交 `8b0191fea`，自 15:47 UTC 起——包括改写后的全部运行）都显示认证页。本地复现并没有被干扰；它复现的就是 CI 撞上的同一道门。促成改写的 15:34 UTC 那次运行通过，是因为当时 CLI 还 pin 在 rc.2，打印的是裸 URL。

修复在 `scripts/e2e-mount.sh`：解析到下一个 token 边界（`[^ )]*`），让完整 token URL 存活——本地 `bash scripts/e2e-mount.sh` 现通过（家族启动冒烟 510 ms，此前 30 秒超时）。`tests/e2e/mount.e2e.ts` 同时增加了对认证页文本的 5 秒快速失败，未来再出现无 token URL 时会报出针对性信息而非空等帧超时。教训：harness 升级改变打印 URL 形状或给根路径加门时，启动标记与 URL 解析都属于冒烟契约；「修复」后 dev CI 仍红，说明诊断并不完整。

第二次后续（2026-08-31）：上游发布 `dsh-better-sidebar@0.18.0-alpha.0`（peer 均 `^0.1.2-alpha.2`，`dsh.client.inject` 已改用 `@deepseek-ai/dsh-client-modules`），聚合按其精确 pin 重新加入——见 [re-add-better-sidebar-alpha2](../architecture/2026-08-31-readd-better-sidebar-alpha2.md)——本 lane 断言随之改回：帧挂载后 `[data-dsh-better-sidebar]` 必须 attach（count 1），`[data-dsh-archive-manager]` 保持缺席（1.0.7 仍为上游最新）。崩溃条模式与认证门快速失败保留。

## Consequences

- 挂载冒烟现在证明的是「聚合干净启动且被排除的外部插件缺席」，而非「better-sidebar 存在」，与已发布行为一致。
- 启动锚 `[data-dsh-frame]` 必须保持 cohort 稳定；若官方宿主帧属性将来变化，下次发布会响亮失败（一次漂移触发，而非静默通过）。
- `v0.3.9` 本身以修正后的 npm 内容发布；GitHub Release 在冒烟修复后手动创建，因为 tag 管线的 `verify-release` job 无法在已推送、已发布的 tag 下对改动后的树重跑。

## Testing

- 修复前的本地复现被一个环境认证门干扰：本地 `dsh` shim 跑 `dsh-v0.1.2-alpha.1` 源码检出，其 `dsh web` 在全新 scratch home 上会弹出 harness 浏览器认证栏（CI 的全局 `@deepseek-ai/dsh@0.1.2-alpha.2` 不会，依据是原本跑过的冒烟），于是本地页面显示「authentication required」而非应用。
- `scripts/aggregate.test.mjs` 依旧通过（断言排除）；新锚下 `docs:check` 通过。
- 修复在 `dev`/`main`（`e1b13cbe7`）；下次发布的挂载冒烟将在 CI（权威环境）验证它。
