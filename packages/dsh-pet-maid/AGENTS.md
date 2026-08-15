# AGENTS.md — dsh-pet-maid

dsh Web GUI 的女仆鲸鱼娘宠物插件：Clawd 风格状态机（12 姿态 + 并发会话
4 级工作分级）+ 交互（眼部跟随 / 入睡惊醒 / 单击跳跃 / 双击挥手 / mini
模式），状态由 DSH 公开会话事件原生驱动，图集运行时解析。

## 素材许可纪律（本包最重的红线）

- **女仆鲸鱼原画（Maid-DeepSeek-Whale，作者 DeaDumB）不随包分发**——无再
  分发许可，运行时从 `~/.codex/pets/maid-deepseek-whale` 或 `assetDir`
  配置加载；`assets/whale/` 只放仓库内 Apache-2.0 兜底素材。
- 新增任何第三方素材前必须查证许可；不确定就不加，走运行时加载路径。
- 包内 LICENSE 与 package.json 的 license 字段必须一致（当前 Apache-2.0）。

## 图集契约

- 8 列 × 9 行 192×208 单元（1536×1872），行序：0 idle / 1 running-right /
  2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running /
  8 review；`thinking` / `sleeping` / `attention` 别名第 8 / 0 / 4 行。
- 换图集只改 `src/client/spritesheet.ts` 的 `TRACKS` 与 `assets/whale/pet.json`
  的 `frames`；行序契约与 dsh-pet 一致，新增行需同步客户端 9 行假设。

## 状态机纪律

- 宿主 `PetService` 只消费 DSH 公开会话事件（`session/created` /
  `session/event` / `session/disposed`），不读投影存储、不装第二个监听器。
- `state.ts` 保持纯函数 + 时钟注入；本地姿态（跳跃/挥手/入睡）只存在于
  客户端 `MaidPet` 的 `resolvePose`，宿主不感知。
- 新交互优先做成纯函数（可单测），再接入组件。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-pet-maid test   # state / resolvePose / affinity / treats / persist / service
pnpm --filter @linxin666/dsh-pet-maid typecheck
pnpm --filter @linxin666/dsh-pet-maid build
pnpm docs:write-pair dsh-pet-maid             # 改 README 后重录配对
```

禁止 emoji（含文案与提交信息）；改 README 必须同步中英两侧。
