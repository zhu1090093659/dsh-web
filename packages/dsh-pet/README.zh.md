# dsh-pet — 多宠物伴侣插件

[English](README.md) | 中文

> 一个注册表驱动的桌面伴侣：内置鲸鱼娘，也接受你放入的任何宠物。

模型思考时你在等待，你的宠物在游动。它跟随官方会话活动，在等待、思考、调用工具、整理回复、庆祝完成、报告失败时切换动画；你还可以摸摸它的头、喂它小鱼干，看着亲密度一点点成长。宠物是注册表条目而不是代码：每只宠物只需一份 `pet.json` manifest 加一张图集，宿主启动时自动发现。

从 Codex 桌面应用的宠物功能重新实现，采用官方 DSH 插件形态（cordis bundle：host 半区 + client 半区，一个包）。

## 功能

| 功能 | 说明 |
|---|---|
| 多宠物注册表 | 宿主扫描内置 `assets/`、hatch-pet 自定义宠物目录和组合配置条目；每只宠物 = manifest + 图集 |
| 设置中选择宠物 | 插件设置卡片列出所有已注册宠物；切换即持久化，精灵立即更换 |
| 每只宠物独立命名 | 在悬浮面板改名；每只宠物保存自己的名字（按宠物 id 存储，旧版平铺名字自动迁移） |
| 状态动画 | 官方会话活动 → 9 态动画：`thinking → running`、`tool → running-right`、`review → review`、`waiting → waiting`、`done → jumping`、`failed → failed` |
| 状态轮换 | 每个场景按一条 ≥5 个 GIF 的序列连续轮换（如 `thinking`：running → running-right → running → running-left → running → waiting → running），每段播完自身完整时长后切换到下一个，整条序列循环播放 |
| 摸头互动 | 点击宠物 → 气泡反馈 + 亲密度 +1（10s 冷却） |
| 喂食 | 悬浮面板 喂食 → 消耗 1 条小鱼干 + 亲密度 +5（30s 冷却） |
| 小鱼干经济 | 库存（上限 20）：每工作 3 轮 +1，每 30 分钟 +1 |
| 亲密度 | 每完成一轮 +1；4 级：幼鲸 → 伙伴 → 挚友 → 深海羁绊（上限 100） |
| 拖动 | 按住拖动宠物换位置；位置持久化 |
| 隐藏/召唤 | 悬浮面板 隐藏；隐藏后出现 召唤{name} 按钮 |
| 状态气泡 | 显示当前会话阶段或工具名；瞬时互动反馈临时优先 |
| 多会话活动 | 宠物是宿主全局的：最近一次有意义事件驱动显示，每个会话完成的轮次都计入亲密度与小鱼干 |

## 宠物契约

一只宠物 = 一个目录 + 一份 `pet.json` manifest + 一张图集。除此之外什么都不需要——不用改任何宿主或客户端代码。

```jsonc
{
  "id": "whale-girl",                     // 唯一的小写 kebab id
  "displayName": "鲸鱼娘",                 // 显示在设置选择器与面板上
  "description": "一只软萌治愈的鲸鱼娘。",     // 可选
  "spritesheetPath": "spritesheet.webp",   // 图集，相对 manifest 所在目录
  "cell": { "width": 192, "height": 208 }, // 可选；默认 Codex 契约
  "columns": 8,                            // 可选；默认 8
  "frames": [6, 8, 8, 4, 5, 8, 6, 6, 6],   // 可选的每行帧数
  "tracks": {                              // 可选的每轨节奏覆盖
    "idle": { "durations": [400, 400, 500, 400, 400, 500] }
  }
}
```

- 图集是 8 列 × 9 行网格（默认 192×208 单元格）；行序固定：0 idle、1 running-right、2 running-left、3 waving、4 jumping、5 failed、6 waiting、7 running、8 review。未使用的格子保持全透明。
- `frames` 记录每行用到的列数（缺省按 hatch-pet 契约表 `[6, 8, 8, 4, 5, 8, 6, 6, 6]`）；`tracks` 按动画覆盖每帧时长（按该行帧数循环补足）、`loop` 与 `fallback`（默认：全部循环；`jumping` 与 `failed` 停在最后一帧后回到 `idle`）。

宠物的来源（后注册的来源在同 id 冲突时覆盖前者）：

1. **内置**：本包 `assets/<dir>/pet.json`。
2. **自定义宠物**：`${CODEX_HOME:-~/.codex}/pets/<pet>/pet.json` —— hatch-pet 流水线把产物放在这里，孵化的宠物无需任何接线即可出现在选择器里。
3. **组合注入**：嵌入应用通过 `PetConfig.pets` 传入的 manifest 条目。

注册表在宿主启动时构建一次；新增或修改宠物后重启 `dsh web` 生效。

## 动画预览

精灵图是由 [hatch-pet](https://github.com/dsh2026) 流水线生成的 8 列 × 9 行图集（192×208 单元格）；各状态预览：

| idle | waiting | running | jumping |
|---|---|---|---|
| ![idle](assets/whale/previews/idle.gif) | ![waiting](assets/whale/previews/waiting.gif) | ![running](assets/whale/previews/running.gif) | ![jumping](assets/whale/previews/jumping.gif) |

| waving | review | failed | 左右移动 |
|---|---|---|---|
| ![waving](assets/whale/previews/waving.gif) | ![review](assets/whale/previews/review.gif) | ![failed](assets/whale/previews/failed.gif) | ![running-left](assets/whale/previews/running-left.gif) ![running-right](assets/whale/previews/running-right.gif) |

## 架构

```text
dsh-pet/
|-- src/
|   |-- index.ts             # host 半区：插件入口（构建注册表、设置区、路由）
|   |-- registry.ts          # 多宠物契约：manifest 扫描 + 归一化（内置 + 自定义宠物）
|   |-- service.ts           # PetService：宠物选择 + 状态机 + 亲密度 + 配置
|   |-- state.ts             # 宠物状态机：会话活动投影 → 9 态动画
|   |-- affinity.ts          # 亲密度账本（纯函数 + 冷却）
|   |-- treats.ts            # 小鱼干库存账本
|   |-- persist.ts           # 持久化（$DSH_HOME/pet.json：选择 + 每宠物名字，原子写入）
|   |-- routes.ts            # /api/pet/* JSON API + /pet/<id>/* 静态资源路由
|   `-- client/             # 浏览器半区
|       |-- index.ts         # 全局挂载（createRoot → body）+ 注册表拉取 + 轮询 + 接线
|       |-- PetDockEntry.tsx # 全局浮层入口（document.body，始终显示）
|       |-- PetSprite.tsx    # 由定义驱动的浮层精灵（portal + rAF + 拖动）
|       |-- PetSettingsCard.tsx # 设置卡片：宠物选择器 + 显示布局
|       |-- spritesheet.ts   # 图集几何辅助 + 轨道裁剪
|       `-- pet.module.css
|-- assets/whale/            # 内置鲸鱼娘（pet.json + spritesheet.webp + 预览）
`-- cordis.patch.yml         # bundle 补丁：插入宠物插件行
```

### 数据流

```text
官方会话事件（turn/step/chunk/tool）----\
                                                    > PetService（宿主）<-- 注册表（内置 + 自定义宠物）
可选兼容 activity/status ------------------/
                                                              | /api/pet/* JSON
全局 React 根（createRoot → document.body）<-- 2s 轮询 -- pet-client（浏览器）
                                                              |
                                       PetSprite 浮层（portal + rAF）
```

- **状态来源**：宿主把官方 `turn/start`、`step/start`、`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`turn/end` 事件投影为 waiting/thinking/tool/review/done/failed 状态。可选兼容 `activity/status` 事件仍作为输入。
- **注册表**：宿主把每份 manifest 归一化为完整渲染定义（几何、每行帧数、每轨时长），经 `/api/pet/pets` 下发；浏览器半区用该定义渲染任意条目，不携带任何宠物专属代码。
- **选择与命名**：`petId` 存于设置命名空间；每只宠物的名字存于 `pet.json` 的 `names`，通过悬浮面板对当前宠物改名编辑。旧版安装的平铺 `name` 自动迁移到鲸鱼娘名下。
- **多会话语义**：API 与浏览器挂载都是宿主全局的，不暴露前台会话身份，最近一次有意义事件赢得显示；每个会话完成的轮次仍独立计奖，销毁非当前会话不会重置可见状态。
- **挂载点**：`document.body`（全局 React 根，始终显示：无会话 / 新会话 / 会话中都可见——旧挂载点 `conversation.composer.dock` 只在活动会话里渲染，新会话里宠物消失）；组件内部用 `createPortal` 渲染全局浮层。
- **渲染**：CSS 精灵（background-position）逐帧动画；帧时长来自下发定义里的轨道表。
- **通信**：浏览器 ↔ 宿主走同源 `/api/pet/*` JSON 端点（state/pets/interact/set-visible/set-config/set-name/set-pet）；每只宠物的图集从 `/pet/<id>/<spritesheetPath>` 加载——插件自给自足地提供自己的 API 与资源（与 dsh-remote-web-ui 的 `/api/pair` 同一模式）。

## 安装

安装聚合全家桶 `@linxin666/dsh-web-ui-all`（全部插件与皮肤一次到位），或单独安装本插件：

```sh
### 从 npm 安装（推荐）
dsh plugin --profile web add @linxin666/dsh-pet

### 从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-pet

```

安装后**重启 `dsh web`**——你选择的宠物出现在界面右下角。link 模式下改代码后 `pnpm build` 并刷新页面即可，无需重装。

## 开发

```sh
pnpm build        # tsc -b（类型+声明）&& tsdown（node 半区 + 浏览器 bundle）
pnpm test         # vitest 单元/组件测试（注册表 / 事件投影 / 状态 / UI / 账本）
pnpm prepare      # 仅转译构建（不做类型检查，供消费者安装）
pnpm typecheck    # 仅类型检查
```

浏览器 bundle 走 `window.__ModuleLoader__.load` 契约；React/cordis 等从 loader 模块表解析（external）；CSS Modules 由 lightningcss 以内联 `<style data-plugin>` 编译进 bundle。

## 精灵图与动画轨道校准

内置鲸鱼娘图集由 hatch-pet 流水线生成，9 态 × 8 列：`assets/whale/spritesheet.webp`（1536×1872，8 列 × 9 行，192×208 单元格）+ `assets/whale/pet.json`。每行的帧数与节奏就写在该 manifest 的 `frames` 与 `tracks` 字段里——鲸鱼娘带着自己更慢的治愈系时长，未覆盖的宠物沿用 hatch-pet 契约节奏。重做美术因此只需修改 `assets/whale/pet.json`（行序契约：0 idle / 1 running-right / 2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running / 8 review）。

## 许可证

[BSD-3-Clause](LICENSE)
