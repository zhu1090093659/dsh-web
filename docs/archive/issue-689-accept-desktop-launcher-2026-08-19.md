# Issue #689 接受记录：dsh-desktop-launcher 收录（2026-08-19）

一次新插件收录的验收快照。目标仓库：zhu1090093659/dsh-web-ui。

## 背景

Issue #689（suyicon）提案收录 dsh-desktop-launcher（桌面一键启动 + Web GUI
一键关机）；PR #692 曾因「新插件需先在 Issue 获维护者确认」被分类关闭
（not planned）。2026-08-19 维护者决定接受，本记录为接受过程的验证快照。

## 合并内容（accept/desktop-launcher → main）

- cherry-pick 作者功能提交 0db53615f（保留作者署名）：
  packages/dsh-desktop-launcher（host/client 双半区、31 测试、中英 README 三件套）
- 集成提交（维护者补齐）：
  - scripts/sync-shared.mjs：dsh-desktop-launcher 纳入 SETTINGS_CONSUMERS 与
    loopback / mount-once 副本清单；同步刷新其 settings-form.ts 副本（作者副本
    为旧版共享源，已由生成器修正）
  - packages/dsh-web-ui-all/aggregate.yml：patchFrom + deps 加入，重生成
    cordis.patch.yml（行 id web-ui-desktop-launcher）与 package.json
  - packages/dsh-web-ui-settings/src/allowlist.ts：desktop-launcher 命名空间
    加入 FAMILY_NAMESPACES 与别名表
  - docs/publish-prep.md：包清单加行
  - 版本 0.2.0 → 0.2.3（与全家桶统一版本对齐）
  - scripts/sync-shared.test.mjs 副本计数 52→57、22→25、30→32
  - 移除包内多余的 ISSUE_TEMPLATE.md（issue 草稿快照，非仓库惯例文件）

## 验证证据（worktree /tmp/dsh-web-ui-dl，macOS）

- pnpm typecheck：全仓通过；pnpm test：全仓通过（新插件 5 文件 31 测试全绿）
- pnpm test:scripts：135 全绿（含 sync-shared 新计数断言）
- pnpm aggregate:check / sync-shared:check / docs:check / runtime-deps:check：通过
- 关键 API 核实：ctx.appExit 为 @deepseek-ai/dsh-cmdline 真实提供的 bounded exit
  （本地 dsh 安装 grep 佐证）；共享 loopback 围栏（socket + Host + sec-fetch-site
  + Origin 四重校验）与 README 安全模型声称一致
- 无 emoji；tsdown 用共享预设 shared/tsdown.client.ts；tsconfig 不指向 DSH 源码

## 环境备注

- 审查子代理（3 路并行）超时未返回，由主 agent 直接完成审查（见上）
- worktree pnpm install 会重跑 prepare，重新生成 dsh-skins shim 版本
  （0.2.2→0.2.3）与 skin-center/lib/index.js（原子写）——均为 main 上预存在的
  陈旧生成物，与本次无关，未纳入本次合并
