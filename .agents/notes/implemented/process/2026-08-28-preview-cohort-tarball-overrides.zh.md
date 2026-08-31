# Agent Note: preview SDK cohort via source-built tarball overrides

Status: implemented

## 问题

官方 `@deepseek-ai` SDK 队列 0.1.2-alpha.1 是有意不发 npm 的开发者预览版：registry 的 `latest`/`next` dist-tag 停留在 0.1.1-rc.2，所有 0.1.2-alpha.1 包名均 404。但该队列携带插件必须适配的破坏性变更（dsh-client-runtime 与 dsh-host-apiproxy 被删除，settings/session/workspace 客户端面重组为 api-*-controller 与 client-store，浏览器冻结模块表新增 dsh-client-store）。仓库此前无法以任何 npm 支持的方式对目标队列做类型检查、测试或构建。

## 决策

升级工作树的整个队列解析自一次性构建的 tarball：从官方源码 tag `deepseek-harness@dsh-v0.1.2-alpha.1`（commit cd5ef81）构建后逐包 `pnpm pack`，存放在仓库外的 `~/.dsh-cohorts/0.1.2-alpha.1/`，再由 `pnpm-workspace.yaml` 生成的 `overrides:` 块把每个 `@deepseek-ai/dsh-*` 名字钉到对应 tarball。清单区间写作 `^0.1.2-alpha.1`，队列发布到 npm 后删除 overrides 块即恢复常规 registry 解析。上游的两项删除在清单中如实落地：`dsh-client-runtime` 与 `dsh-host-apiproxy` 的 devDependencies 移除，`minimumReleaseAgeExclude` 钉到目标版本并删除两条死项。工具链钉在 `packageManager: pnpm@11.24.0`，因为 pnpm 11.9.0 在第三方 peer 存在时会错误解析 `file:` tarball 包的传递依赖（绕过 overrides 直查 registry 上不存在的版本）；11.24.0 对同一依赖树解析正确。`dsh-aionui-panel` 按维护者决定移除：其客户端依赖已删除的包无法构建，且右侧面板早已由 dsh-better-sidebar 接管；包目录、聚合成员与 README/publish-prep 行随本次迁移一并删除。

插件客户端代码对 `dsh-client-runtime/client` 的迁移：`ClientContext` 改为 cordis `Context` 的本地别名，settings scope 家族改从 `dsh-client-ui-settings/client` 导入，快照 store 引擎改从 `dsh-client-store` 导入（现已是平台模块，preset 的 RUNTIME_STORE_EXEMPTION 随之删除），sessions 改自 `dsh-api-session-controller/client`，workspaces 改自 `dsh-api-workspace-controller`，`ctx.slots` 合并点移至 `dsh-client-ui-renderer/client`。

## 备选方案

等待 npm 发布被否决：用户要求的适配工作面对一个没有发布日期的队列连类型检查都无法进行。把 TypeScript 指向 DSH 源码 checkout 或链接 harness 工作区 node_modules 被否决：它破坏 CI 解析、违反仓库的 SDK 边界规则，并把插件构建耦合到可变 checkout。用本地 registry 守护进程供包被否决：与静态 tarball 效果相同但运维更重。对聚合包中的第三方插件（dsh-better-sidebar 等）做剥 peer 重打包已测试并放弃：让它们留在 registry、以未满足 peer 告警的形态存在，保留 rc.2 时代行为且 diff 更小。

## 后果

所有清单、lockfile 与聚合产物现在描述一个只存在于一次性 store 的队列，CI 在队列发布或 CI 增加队列构建步骤之前无法通过。该分支当晚即已合入 `dev`，CI 现已能自行重建 store：[CI 重建预览 cohort tarball store](2026-08-29-ci-rebuilds-cohort-tarball-store.zh.md)。overrides 块是回到 registry 的唯一开关。aionui 面板从全家桶中整体消失。聚合中的第三方插件停留在 SDK peer 早于本队列的版本：安装时仅有 peer 告警，在其上游适配前运行期持续损坏——这是预览版的既有外部限制，不是本次引入的回归。
