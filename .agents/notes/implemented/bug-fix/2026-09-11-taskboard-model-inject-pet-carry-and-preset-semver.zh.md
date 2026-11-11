# Agent Note: 任务看板远程模型注入、模型行展示、宠物收益余量保留与预设更新 SemVer 严格比较修复

Status: implemented

## Problem

### 1. 任务看板执行设置模型下拉仅有“宿主默认”且报 remote.session 未注入异常 (Issue #1486)
在 `dsh-task-board` 中，前端 `inject` 声明仅包含 `'remote'`，未声明子命名空间 `'remote.session'`。当尝试对接或访问 `ctx.remote.session` 时，Cordis 代理抛出 `cannot get property "remote.session" without inject` 导致调用中断。同时，原模型抓取逻辑仅依赖遗留 connection RPC，未对接 DSH 0.1.5-rc.1 官方生成的 `remote.session.modelCatalog()` 接口，且原组键解析读取 `g.provider`，与官方返回的 `g.id` 不匹配，导致模型下拉列表为空，仅能显示“宿主默认”。

### 2. 宠物被动收益与睡眠恢复因高频轮询被抹平 (Issue #1478)
在 `dsh-pet` 的 `settleGameplay` 逻辑中，每次按 `elapsedMs / intervalMs` 计算 ticks 增量，并在结尾执行 `state.settledAt = now`。前端 HUD 每 2 秒轮询一次，导致不足一格（如 60 秒或 30 秒）的时间余量在每次轮询时被直接清零丢弃，挂机收益和睡眠体力恢复长时间不累积。

### 3. 预设中心版本比较使用裸字符串判断 (Issue #1477)
在 `dsh-preset-center` 中，`hasUpdate` 使用 `record.version !== row.assetVersion`。当本地存在更新的先行构建版本，或版本格式字符串不等时，会被错误判定为“有更新”，诱导用户更新回退至旧版本。

### 4. 任务看板模型下拉无法区分不同提供方的同名模型 (Issue #1981)
一个部署可以让多个提供方发布同一个模型名，而每一对都是不同的路由（`provider/model`）。看板的模型下拉只渲染模型名，因此当名册同时含有 `acme/shared` 与 `beta/shared` 时会给出两行完全相同的“Shared”，使用者无法判断卡片究竟会钉住哪条路由。同样的盲点还出现在折叠的执行摘要里——它同样只回显模型名；以及看板设置卡的“新建卡片默认模型”选项里，它把提供方放在模型前面（“acme · Shared”），同一件事因此有第三种写法。扁平发现回退路径产生的行根本没有提供方，而名册无法描述的路由必须如实说明，不能被安上一个杜撰的提供方。

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

### 4. 统一模型展示形式：模型名在前，提供方在后
- `packages/dsh-task-board/src/client/board/model-options.ts` 拥有 `modelDisplayLabel`：先模型名，后发布它的提供方，以“ · ”连接。没有提供方的行保留裸模型名；自身没有名字的行显示其合格路由中的模型部分，因此提供方不会被打印两次。
- `modelChoiceRows` 经由该唯一格式化器渲染，因此设置卡的“新建卡片默认模型”选项与各执行目标下拉展示同一种形式。
- 新建对话框的模型下拉、其中的 AI 解析模型下拉、任务详情页的模型下拉、折叠的执行摘要，以及设置卡的新建卡片默认模型下拉（含原已移除的裁判模型下拉），全部从该共享格式化器读取标签。
- 提供方一律以路由自身的 group id 命名——也就是下拉实际存储的那个标记——因此设置卡下拉与各执行下拉对同一个提供方的称呼完全一致。
- 各下拉的取值仍为合格 `provider/model` 路由，钉住值不受影响，思考档位的推导逻辑也不变：改变的只是展示形式。
- 扁平发现回退路径产生的行（无提供方）保留其裸模型名；名册无法描述的路由在摘要中保留其自身路由文本——展示绝不为无法解析的路由杜撰提供方。

## Alternatives considered

- **让每个下拉各自格式化自己的标签。** 改动最省，但这正是让同一件事出现三种写法的漂移来源；下一个模型下拉会挑出第四种。只有唯一共享格式化器才能让各下拉无法互相矛盾。
- **提供方在前（“provider · model”）。** 设置卡的默认模型选项本来就是这种顺序。它和“model · provider”一样能区分同名模型，但读起来以提供方为主体、模型为限定词，而使用者认得的是名字；要求的形式把名字放在前面。
- **把合格路由（“provider/model”）直接作为标签。** 毫无歧义，却把模型名藏在提供方后面，一份模型较多的名册会读成一堵路由墙。展示保留名字，并在旁边加上提供方。
- **给没有提供方的行留一个空的提供方位置（“name · ”）。** 这能让标签形状保持单一，却暗示部署从未发布过的提供方。这类行保留其裸名字。
- **从路由字符串里解析出未知路由的提供方并显示。** 路由文本对部署已不再提供的模型是一个如实的身份，猜测其构成会把推导结果当作已发布的事实呈现。摘要保留路由本身。

## Consequences

- 看板提供的每一个模型行现在都是同一种展示形式：模型名在前，提供方在后。两个提供方发布同一个模型名时，在每个下拉里都肉眼可辨。
- 各下拉的取值、钉住值与思考档位行为不变；钉住的名册无法描述的路由的卡片仍然显示那条路由。
- 设置卡的默认模型选项标签顺序改变（“alpha · Fast”变为“Fast · alpha”）；存储的取值与之前是同一条路由。
- 新建对话框折叠后的执行摘要现在在模型旁标出提供方，因此折叠区域不会隐藏自己持有的是哪个提供方的模型。
- 没有提供方的行（扁平发现回退路径）与未知的钉住路由保留其如实的形式：裸模型名，以及路由文本。

## Testing

决策 4（模型展示形式）的验证：

- `pnpm --filter @linxin666/dsh-client-ui-task-board test`：108 个测试文件全部通过（1298 个用例中 1297 passed、1 skipped），含模型展示形式套件。
- `pnpm --filter @linxin666/dsh-client-ui-task-board typecheck`：0 错误。
- `pnpm --filter @linxin666/dsh-client-ui-task-board build`：host 与 client 两份 bundle 均构建成功。
- `pnpm docs:check`、`pnpm i18n:check`、`pnpm emoji:check` 与 `node scripts/test-standards.mjs`：通过。

决策 1 至 3 落地时记录的验证：

- `pnpm --filter @linxin666/dsh-pet test`：41 个测试文件全部通过（493 passed）。
- `pnpm --filter @linxin666/dsh-client-ui-preset-center test`：4 个测试文件全部通过（33 passed）。
- `pnpm typecheck`：全仓 22 个包 0 错误全部通过。
- `pnpm test`：全仓测试套件通过。
- `pnpm docs:check && pnpm i18n:check && pnpm test:scripts`：通过。
