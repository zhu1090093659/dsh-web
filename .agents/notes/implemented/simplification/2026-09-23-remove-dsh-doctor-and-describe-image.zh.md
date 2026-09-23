# Agent Note: 从家族中移除 dsh-doctor 与 dsh-tool-describe-image

Status: implemented

## 问题

dsh-doctor（诊断设置面板）与 dsh-tool-describe-image（图像描述工具插件）对本仓库已无用处，所有者指示将它们从插件家族中直接移除而非继续维护。保留它们意味着每次 cohort 升级、构建、i18n 审计、sync-shared 清单与发布都要拖着两个完整包——包括 dsh-i18n 里各一本 ru 词典、dsh-web-settings 里各一个设置白名单命名空间、`scripts/sync-shared.mjs` 里的共享客户端拷贝目标，以及挂载冒烟必须记账的聚合行。这次移除与 0.1.7-alpha.2 宿主兼容修复落在同一变更里，因为聚合包残留的 `retire:` 块（目标是 alpha.2 宿主已不再挂载的 `web-ui-settings-unarchive-sessions` 行）每次启动都会报 patch-not-found 警告，既然要动聚合文件就一并完成全量清扫。

## 决策

两个包从工作区删除（`packages/dsh-doctor/`、`packages/dsh-tool-describe-image/`），`packages/dsh-web-all/aggregate.yml` 删掉它们的 `patchFrom`/`deps` 行与 `inactive` 条目。聚合包为每个被移除的 id 保留一个 tombstone 空壳导出（`describe-image`、`doctor`，均指向 `./lib/shells/shell.js`），让 patch 文件里仍带挂载行的旧 profile 退化为惰性插件，而不是在模块解析时以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 崩溃。残留的 `retire:` 块整体删除而非改指，因为 alpha.2 宿主已不再挂载它目标的行；`scripts/aggregate.test.mjs` 现在断言聚合不得声明未经证实的 retire 目标，并钉住移除契约（patch 不含 `web-ui-doctor` / `web-ui-describe-image` 行、deps 不含两包、两个 tombstone 必须在场）。

引用清扫覆盖：`scripts/sync-shared.mjs`（SETTINGS_CONSUMERS 与各包拷贝目标）、`scripts/i18n-audit.mjs`（两行包条目）、两份 sync/i18n 基线 JSON、`.github/labeler.yml`（`area/tools` 标签与 doctor 行）、dsh-i18n（`ru/doctor.ts`、`ru/tool-describe-image.ts`、`ru/index.ts`、两份 README 表格）、dsh-web-settings（白名单命名空间与别名，客户端插件清单改为「task-board、remote-web-ui、pet」）、dsh-plugin-manager 测试夹具、skin-center semantic-attrs 契约（删 doctor 锚点，plugin 组计数 15 改 13）、`docs/publish-prep.md`（19 个包）、`docs/plugins.md`、`docs/architecture.md`（17 个子包）以及两份根 README。

刻意不动：`desktop/runtime/profile-web` 钉的是已发布的 `@linxin666/dsh-web-all@0.3.19`，其中仍含这两个包——改那个 pin 会破坏它的 `minimumReleaseAgeExclude` 对账，桌面运行时在自己的升级之前继续发布它钉住的内容。`market/worker/src/npm-badge.js` 的 FAMILY_PACKAGES 保留两个 id，因为那张表是「曾经发布过」的累计注册表，不是当前成员名单。归档、发布说明与历史 Agent Note 不重写。

## 已考虑的替代方案

- 保留两包但在聚合中 inactive：否决——inactive 不会移除构建、测试、i18n 与审计税，且所有者的指示就是移除。
- 删包但不留 tombstone 空壳：否决——任何在本次变更前打过 patch 的 profile 启动时会在模块解析失败；空壳只要两行就让移除对存量安装安全。
- 把 `retire:` 块改指到某个 alpha.2 行：否决——不存在替代行，unarchive-sessions 面在上游就是没了。

## 后果

家族从 21 个包缩到 19 个（聚合 17 个子包）。sync-shared 拷贝条目从 132 降到 113（mount-once 宿主半区 17 到 16），计数钉在 `scripts/sync-shared.test.mjs`。dsh-web-settings 不再接受 `doctor` / `describe-image` 命名空间；仍挂载这两个 id 的 profile 会显示一张空壳卡。旧 profile 不做迁移——tombstone 让迁移失去必要。本变更修改了 `cordis.patch.yml`，需要用户重启 DSH 服务后才生效。

## 测试

移除提交在隔离工作树上通过完整门禁序列：`pnpm typecheck`、`pnpm build`、`pnpm sync-shared:check`、`pnpm skin-center:check`、`pnpm community:check`、`pnpm libs:check`（四个提交 lib 的包已重录指纹）、`pnpm aggregate:check`、`pnpm runtime-deps:check`、`pnpm emoji:check`、`pnpm i18n:check`、`pnpm docs:check`（dsh-web-all、dsh-web-settings、dsh-i18n 的 README 配对已重录）、`pnpm test:scripts`（347/347，含重新计数的 sync-shared 清单测试）、`pnpm market:check`、`pnpm test:standards`（基线已向下收紧）、`pnpm test:desktop` 以及工作区全量 `pnpm test`。e2e 挂载冒烟在全本地 tarball 模式下对真实 0.1.7-alpha.2 宿主通过，且被移除插件确认缺席（[plugin-mount-smoke-local-tarballs](../testing/2026-09-23-plugin-mount-smoke-local-tarballs.md)）。唯一的红是 dsh-ssh 真实 sshd 的 sftp 测试在这台 macOS 主机上报 `All configured authentication methods failed`——本机 sshd 环境限制，CI ubuntu 上是绿的，不是本变更引入的回归。
