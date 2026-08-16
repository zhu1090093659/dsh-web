# dsh-shutdown 一键关机插件交付说明

一次性记录（2026-08，会话内实现），不是长期文档。

## 交付内容

- 新插件包 `packages/dsh-shutdown`（npm 包 `@linxin666/dsh-client-ui-shutdown`，版本 0.1.18）：
  - host 半区：loopback-only 的 `POST /api/dsh-shutdown` 路由（`src/routes.ts`），
    响应写回后经 `ctx.appExit`（launcher bounded exit）请求退出，缺失时回退
    `process.exit(0)`（`src/index.ts`）；settings 命名空间 + 系统提示词播报。
  - client 半区：侧边栏底部 `sidebar.footer.action` 槽位的关机样式按钮
    （Windows power 图标），点击弹确认框，确认后 POST 退出路由；设置卡
    （enabled / confirmShutdown / announceToAgent）。
  - 测试：`tests/shutdown-route.spec.ts`（围栏/方法/延迟退出）、
    `tests/shutdown-entry.spec.tsx`（确认框/取消/确认/失败重试/免确认）。
- 聚合注册：`packages/dsh-web-ui-all/aggregate.yml`（patchFrom + deps）、
  `cordis.patch.yml`、`package.json` dependencies 已同步（手工按
  aggregate.mjs 生成格式维护）。
- 文档：包 README 三件套（中英 + i18n 哈希）、根 README 中英、docs/publish-prep.md
  行、docs/archive 本文件。

## 本环境未能执行的验证（重要）

当前会话沙箱为 Windows 且 bash 工具不可用（terminal inspection unsupported），
无法运行 `pnpm install` / `pnpm build` / `pnpm test` / `pnpm typecheck` /
`node scripts/aggregate.mjs --check` / `pnpm docs:check`。以下步骤必须在
可执行 shell 的环境补齐：

1. `pnpm install`（更新 pnpm-lock.yaml：新增 workspace 包 + devDep
   `@deepseek-ai/dsh-cmdline@^0.1.0-rc.5`；当前锁文件未含本包，CI
   frozen-lockfile 会红）。
2. `pnpm --filter @linxin666/dsh-client-ui-shutdown typecheck`
3. `pnpm --filter @linxin666/dsh-client-ui-shutdown test`
4. `pnpm --filter @linxin666/dsh-client-ui-shutdown build`
5. `node scripts/aggregate.mjs --check`（手工改动应无漂移）
6. `pnpm docs:check`（README.i18n.yaml 哈希已用 git blob hash 手工记录）

## 本地挂载验证（按技能的重启约定）

当前 GUI 正跑在 3080，禁止结束该进程；另起测试实例：

```sh
node scripts/link-profile.mjs          # 让子包走本地代码
dsh plugin --profile web add link:<repo>/packages/dsh-shutdown
dsh web --port 3090                    # 测试实例
```

预期结果：侧边栏底部设置按钮旁出现关机样式按钮；点击弹确认框；确认后
3090 实例进程退出（浏览器标签随之失效）。主实例（3080）是否重启由用户决定。

## 备注

- 工作树当前处于一次 origin/main 合并且未完成：AGENTS.md、
  docs/publish-prep.md、dsh-aionui-panel、dsh-web-ui-settings、
  dsh-web-ui-all README、scripts/sync-shared.* 等文件带有冲突标记，且
  全家族版本已由合并方升到 0.1.18（本包已对齐）。这些冲突不属于本任务，
  需由用户/维护者先完成合并解析，再跑门禁。
