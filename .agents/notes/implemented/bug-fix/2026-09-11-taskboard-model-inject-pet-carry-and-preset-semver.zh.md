# Agent Note: 任务看板远程模型注入、宠物收益余量保留与预设更新 SemVer 严格比较修复

Status: implemented

## Problem

### 1. 任务看板执行设置模型下拉仅有“宿主默认”且报 remote.session 未注入异常 (Issue #1486)
在 `dsh-task-board` 中，前端 `inject` 声明仅包含 `'remote'`，未声明子命名空间 `'remote.session'`。当尝试对接或访问 `ctx.remote.session` 时，Cordis 代理抛出 `cannot get property "remote.session" without inject` 导致调用中断。同时，原模型抓取逻辑仅依赖遗留 connection RPC，未对接 DSH 0.1.5-rc.1 官方生成的 `remote.session.modelCatalog()` 接口，且原组键解析读取 `g.provider`，与官方返回的 `g.id` 不匹配，导致模型下拉列表为空，仅能显示“宿主默认”。

### 2. 宠物被动收益与睡眠恢复因高频轮询被抹平 (Issue #1478)
在 `dsh-pet` 的 `settleGameplay` 逻辑中，每次按 `elapsedMs / intervalMs` 计算 ticks 增量，并在结尾执行 `state.settledAt = now`。前端 HUD 每 2 秒轮询一次，导致不足一格（如 60 秒或 30 秒）的时间余量在每次轮询时被直接清零丢弃，挂机收益和睡眠体力恢复长时间不累积。

### 3. 预设中心版本比较使用裸字符串判断 (Issue #1477)
在 `dsh-preset-center` 中，`hasUpdate` 使用 `record.version !== row.assetVersion`。当本地存在更新的先行构建版本，或版本格式字符串不等时，会被错误判定为“有更新”，诱导用户更新回退至旧版本。

## Decision

### 1. 任务看板模型发现与 Cordis 声明对齐
- 在 `packages/dsh-task-board/src/client/index.ts` 的 `inject` 声明中补充 `'remote.session'`。
- 重构 `pushModelOptions`，优先通过安全探测读取 `(remote as Partial<ClientRemote>).session.modelCatalog()`；遍历分组时使用 `g.id ?? g.provider` 拼接合格模型标识；在 `remote.session` 不可用时平滑降级至 connection RPC。
- 新增 `tests/model-options.spec.ts` 单元测试，确保 `inject` 声明受控。

### 2. 宠物结算引入余量相位累积
- 在 `PetGameplayState` 中增加可选字段 `incomeCarryMs?: number` 和 `restoreCarryMs?: number`。
- 在 `settleGameplay` 中，将未满一个 `intervalMs` 的时间余数保留在 carry 字段中顺延至下一次结算；在离开 `sleep` 模式时重置 `restoreCarryMs` 为 0。
- 在 `persist.ts` 中安全支持余量字段的持久化与反序列化，保持与存量旧存档的干净兼容。
- 在 `src/gameplay.test.ts` 中补充 2 秒间隔、连续 30 次轮询的累积结算测试用例。

### 3. 预设中心严格 SemVer 版本更新比较
- 在 `packages/dsh-preset-center/src/client/PresetPanel.tsx` 中引入标准轻量 `parseSemver` 与 `compareVersions` 算法。
- 将 `hasUpdate` 调整为 `compareVersions(record.version, row.assetVersion) > 0`，确保仅当工坊远程版本严格大于本地安装版本时才提示更新。
- 在 `tests/preset-panel.spec.tsx` 中增加完整版本比较与更新判定测试用例。

## Testing

- `pnpm --filter @linxin666/dsh-client-ui-task-board test`：37 个测试文件全部通过（337 passed）。
- `pnpm --filter @linxin666/dsh-pet test`：41 个测试文件全部通过（493 passed）。
- `pnpm --filter @linxin666/dsh-client-ui-preset-center test`：4 个测试文件全部通过（33 passed）。
- `pnpm typecheck`：全仓 22 个包 0 错误全部通过。
- `pnpm test`：全仓测试套件通过。
- `pnpm docs:check && pnpm i18n:check && pnpm test:scripts`：通过。
