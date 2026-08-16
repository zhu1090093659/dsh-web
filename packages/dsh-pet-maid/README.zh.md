# dsh-pet-maid — 女仆鲸鱼娘宠物插件

[English](README.md) | 中文

> 一只 Clawd 风格的女仆鲸鱼娘，陪你在 DeepSeek Harness 里工作。

她会跟着整个 DSH 生态的状态切换姿态——思考、干活（按并发会话数分级）、出错、庆祝、入睡；目光会跟随你的鼠标，单击会跳起来，双击会挥手，拖到右边缘还会收成迷你形态探出头。你也可以摸头、喂小鱼干，看着她从幼鲸慢慢长成你的深海羁绊。

功能形态参考 [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) 桌面宠物，以 DSH 官方插件形态实现（cordis bundle：host 半区 + client 半区单包），状态由 DSH 公开会话事件原生驱动。

## 功能

| 功能 | 说明 |
|---|---|
| 状态动画 | DSH 会话事件 → 12 种姿态：`thinking` 思考、`tool` 干活、`done` 跳跃庆祝、`failed` 出错、无会话 `idle` 呼吸待机、闲置入睡 `sleeping` |
| 工作分级 | 按并发会话数 1–4 级，多会话并行时显示「并行工作 ×N」徽标 |
| 眼部跟随 | 空闲时目光跟随鼠标（最大偏移 4px，可关） |
| 入睡/惊醒 | 60 秒无操作入睡（静态帧），鼠标移动即惊醒 |
| 点击互动 | 单击跳跃 + 亲密度 +1（10s 冷却）；双击挥手 |
| 迷你模式 | 拖到右边缘（≤24px）收进迷你形态，悬停探出，点击弹出（可关） |
| 摸头互动 | 单击女仆鲸鱼娘 → 气泡反馈 + 亲密度 +1 |
| 喂食 | 悬浮面板「喂食」→ 消耗 1 条小鱼干 + 亲密度 +5（30s 冷却） |
| 饲料经济 | 小鱼干库存（上限 20）：工作每 3 回合 +1 条、每 30 分钟 +1 条 |
| 亲密度 | 每完成一个回合 +1；4 个等级：幼鲸 → 伙伴 → 挚友 → 深海羁绊（100 点封顶） |
| 自定义命名 | 悬浮面板「改名」→ 1–20 字符，持久化，召唤按钮/面板同步显示 |
| 拖动 | 按住拖动重新摆放，位置持久化 |
| 隐藏/召唤 | 悬浮面板「隐藏」；隐藏后输入选择行出现「召唤{名字}」按钮 |
| 状态气泡 | 工作时显示模型当前状态短语 |

## 动画演示

图集为 8 列 × 9 行（192×208 单元），下方预览为**内置兜底图集**（未安装本地女仆主题时的鲸鱼）；安装本地 Maid-DeepSeek-Whale 主题后自动切换为女仆鲸鱼：

| idle 待机 | waiting 等待 | running 干活 | jumping 庆祝 |
|---|---|---|---|
| ![idle](assets/whale/previews/idle.gif) | ![waiting](assets/whale/previews/waiting.gif) | ![running](assets/whale/previews/running.gif) | ![jumping](assets/whale/previews/jumping.gif) |

| waving 挥手 | review 复盘 | failed 失败 | 左右移动 |
|---|---|---|---|
| ![waving](assets/whale/previews/waving.gif) | ![review](assets/whale/previews/review.gif) | ![failed](assets/whale/previews/failed.gif) | ![running-left](assets/whale/previews/running-left.gif) ![running-right](assets/whale/previews/running-right.gif) |

## 架构

```
dsh-pet-maid/
|-- src/
|   |-- index.ts        # host 半区：插件入口（cordis apply，注册路由）
|   |-- service.ts      # PetService：状态机 + 会话计数分级 + 亲密度 + 配置（HTTP API 服务面）
|   |-- state.ts        # 状态机：会话事件 phase → 12 姿态动画 + 工作分级
|   |-- asset-source.ts # 图集解析：assetDir 覆盖 → 本地 Codex Pet 主题 → 内置兜底
|   |-- affinity.ts     # 亲密度账本（纯函数 + 冷却）
|   |-- treats.ts       # 小鱼干库存账本
|   |-- persist.ts      # 持久化（$DSH_HOME/pet-maid.json，原子写入）
|   |-- routes.ts       # /api/pet-maid/* JSON API + /pet/maid/* 素材静态路由
|   `-- client/         # 浏览器半区
|       |-- index.ts    # 全局挂载（createRoot → body）+ 轮询（800ms）+ 交互接线（fetch）
|       |-- PetDockEntry.tsx  # 全局浮层入口（document.body，无会话/新会话/会话中全程显示）
|       |-- MaidPet.tsx       # 浮层组件（portal + rAF 帧动画 + 拖动 + 眼部跟随/入睡/点击/迷你）
|       |-- spritesheet.ts    # 图集几何 + 每状态动画轨道（帧/时长）
|       `-- pet.module.css
|-- assets/whale/       # 内置兜底图集（pet.json + spritesheet.webp + 动画预览）
`-- cordis.patch.yml    # bundle patch：插入 pet-maid 插件行
```

### 数据流

```
session/created + session/event + session/disposed（DSH 公开会话事件） --> PetService（host）
                                                                      | /api/pet-maid/* JSON
global React root（createRoot → document.body） <-- 轮询 800ms -- pet-maid-client（浏览器）
                                                                      |
                                                           MaidPet 浮层（portal + rAF）
```

- **状态源**：原生订阅 DSH 公开会话事件——`session/created` 计数并发会话、`session/event` 的 `turn/start` / `step/start` / `tool/call` / `turn/end` 推导 phase（completed → done、其余 → failed）、`session/disposed` 减计数并归零回落 idle，无需任何额外插件。
- **素材解析**：图集来源按序解析——插件配置 `assetDir` 覆盖 → `~/.codex/pets/maid-deepseek-whale`（本地 Codex Pet 女仆主题）→ 包内 `assets/whale` 兜底。本地主题与兜底同为 8×9 图集（行序契约一致），`TRACKS` 无需变化。
- **挂载点**：`document.body`（全局 React root，无会话/新会话/会话中全程显示），组件内部 `createPortal` 渲染全局浮层。
- **渲染**：CSS sprite（background-position）逐帧动画，帧时长来自 `spritesheet.ts` 的轨道定义。
- **通信**：浏览器 ↔ host 走同源 `/api/pet-maid/*` JSON 端点（state/interact/set-visible/set-config/set-name），图集从 `/pet/maid/spritesheet.webp` 加载——RPC 域与 `/plugins/` 静态服务都是平台注册的，插件自足地提供自己的 API 与素材（与 dsh-remote-web-ui 的 `/api/pair` 同一模式）。

## 安装

推荐直接安装全家桶聚合包 `@linxin666/dsh-web-ui-all`（一个包装齐全部功能插件与皮肤），或单独安装本插件：

```sh
### 从 npm 安装（推荐）
dsh plugin --profile web add @linxin666/dsh-pet-maid

### 从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-pet-maid

```

安装后**重启 `dsh web`**，女仆鲸鱼娘出现在界面右下角即生效。link 模式下改代码后重新 `pnpm build` 并刷新页面即可，无需重装。

## 素材与许可

- **内置兜底图集**（`assets/whale/`）为仓库内鲸鱼素材，随包 Apache-2.0 分发；
- **女仆鲸鱼主题**（Maid-DeepSeek-Whale）是社区 Codex Pet（作者 DeaDumB，<https://codexpet.xyz/pets/community/maid-deepseek-whale/>），**不随本包分发**：安装到 `~/.codex/pets/maid-deepseek-whale` 后插件自动加载（或通过插件配置 `assetDir` 指向任意 Codex Pet 图集目录）。原画许可条款以其来源页声明为准。
- 精致版的设计方向参考了 DreamSkin 的「DeepSeek-鲸鱼娘」主题。原始项目：<https://dreamskin.cc>；历史来源记录：<https://github.com/zhu1090093659/dsh-web-ui/commit/87edd7ff4800dffd40bc93fb76e4ae450390facd>。
- DreamSkin 主题的历史记录标注作者为 **powerdog996**，并标注为 MIT。这里仅用于说明来源，不重新定义原始美术作品的授权范围；商用或公开再分发请以原始项目和素材条款为准。
- 精致版在上述基础上经过 AI 辅助创作、二次调整、细节精修和 dsh Web GUI 适配，不声称为原始主题作者的原始作品。

## 开发

```sh
pnpm build        # tsc -b（类型+声明）&& tsdown（node 半区 + 浏览器 bundle）
pnpm test         # vitest 单元测试（state / resolvePose / affinity / treats / persist / service）
pnpm prepare      # 仅转译构建（无类型检查，供消费者安装）
pnpm typecheck    # 仅类型检查
```

浏览器 bundle 走 `window.__ModuleLoader__.load` 契约，React/cordis 等由 loader 模块表解析（external）；CSS Modules 由 lightningcss 内联为 `<style data-plugin>`。

## 素材与动画轨道校准

图集为 8 列 × 9 行 192×208 单元（1536×1872），行序契约：0 idle / 1 running-right / 2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running / 8 review；`thinking` / `sleeping` / `attention` 分别别名第 8 / 0 / 4 行。每行实际帧数与节奏在 `src/client/spritesheet.ts` 的 `TRACKS` 中定义；换图集时只需更新该表与 `assets/whale/pet.json` 的 `frames` 字段。

## License

[Apache-2.0](LICENSE)
