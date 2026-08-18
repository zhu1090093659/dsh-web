# 任务交接：聚合包 id 命名空间 + host 防重（2026-08-17）

> 本文件记录「聚合包与独立插件包共存」修复的验证快照。背景：`dsh web` 启动报
> `duplicate loader entry id: describe-image`——web profile 同时装了
> `dsh-web-ui-all`（聚合包，汇总了 describe-image 行）与独立包
> `dsh-tool-describe-image`（自身也是 describe-image 行）。

## 根因与修复

- loader 的 EntryGroup 要求行 id 唯一；聚合包逐字复制子包行 id 导致双源安装必崩。
- 修复一（聚合包命名空间）：`scripts/aggregate.mjs` 生成时把子行 id 统一改为
  `web-ui-*`（剥掉子包 `ui-` 前缀后加 `web-ui-`），并加唯一性校验；
  生成产物 dsh-web-ui-all / dsh-skins 的 patch 已重生成。
- 修复二（host 防重）：新共享模块 `shared/host/mount-once.ts`（sync-shared 同步到
  12 个家族插件），同一包名双源加载时第二个 host apply 为空操作；浏览器半区由
  官方 client 模块系统按包名去重，无需处理。cordis `ctx.effect` 语义是「立即执行、
  返回值作 disposer」，防重的释放必须走返回的 disposer（初版误写在回调体内，
  导致标记被立即清除，双实例仍二次注册路由；实证定位后修正）。
- 文档：根 README FAQ、聚合包 README、docs/plugins.md、packages/AGENTS.md 同步。

## 验证证据

- 双源共存：web profile 同时保留聚合包 + 独立 describe-image，`dsh web` 启动成功
  （日志 `dsh web: http://127.0.0.1:3080`），HTTP 200；未修复前依次崩在
  `duplicate loader entry id` 与 `webserver: duplicate prefix route "/describe-image"`。
- 单一聚合安装：`dsh --profile web --dump-config` 中 describe-image 行唯一，
  `web-ui-remote-web-ui` 配置行重新带上 `autoTunnel: true`。
- 门禁：`pnpm typecheck` / `pnpm test` / `pnpm test:scripts` / `pnpm docs:check` /
  `pnpm aggregate:check` / `pnpm skin-center:check` / `pnpm gallery:check` /
  `pnpm community:check` 全绿。
- profile 迁移：`~/.dsh/profiles/web/cordis.patch.yml` 的 `remote-web-ui` 配置行
  改为 `web-ui-remote-web-ui`（patch overlay 按 id 匹配，聚合来源必须用新 id）。

## 注意事项

- 用户 profile 保持「聚合包单一安装」：独立 describe-image 已移除（备份
  `package.json.bak-describe-image-dedup-20260816233100`）。
- 工作树中存在并行会话的版本号提升（0.1.18 → 0.1.20，22 个 package.json，
  23:40 写入），与本次改动无关，提交时需与本次文件分离或先确认归属。
