# dsh-pet — 鲸鱼娘宠物插件

![version](https://img.shields.io/badge/version-0.1.0-4f8ef7) ![license](https://img.shields.io/badge/license-BSD--3--Clause-9b59b6) ![platform](https://img.shields.io/badge/platform-DSH%20Web-00c2a8) ![language](https://img.shields.io/badge/language-TypeScript-3178c6)

> 一只软萌治愈的鲸鱼娘，陪你在 DeepSeek Harness 里工作。

模型思考的时候你在等，她在游。她会跟着模型的工作状态切换动画——干活、等待、思考、庆祝完成；你还可以摸头、喂小鱼干，看着她从幼鲸慢慢长成你的深海羁绊。

复刻自 Codex 桌面版的宠物功能，以 DSH 官方插件形态实现（cordis bundle：host 半区 + client 半区单包）。

## 功能

| 功能 | 说明 |
|---|---|
| 状态动画 | 模型状态 → 鲸鱼娘动画：`thinking/tool → 工作`、`waiting → 等待`、`done → 跳跃庆祝`、空闲 `idle` 呼吸待机 |
| 摸头互动 | 点击鲸鱼娘 → 气泡反馈 + 亲密度 +1（10s 冷却） |
| 喂食 | 悬浮面板「喂食」→ 消耗 1 条小鱼干 + 亲密度 +5（30s 冷却） |
| 饲料经济 | 小鱼干库存（上限 20）：工作每 3 回合 +1 条、每 30 分钟 +1 条；库存不足会提示「多陪鲸鱼娘工作一会儿」 |
| 亲密度 | 每完成一个回合 +1；4 个等级：幼鲸 → 伙伴 → 挚友 → 深海羁绊（100 点封顶） |
| 自定义命名 | 悬浮面板「改名」→ 1–20 字符，持久化，召唤按钮/面板同步显示 |
| 拖动 | 按住鲸鱼娘拖动重新摆放，位置持久化 |
| 隐藏/召唤 | 悬浮面板「隐藏」；隐藏后输入选择行出现「召唤{名字}」按钮 |
| 状态气泡 | 工作时显示模型当前状态短语 |

## 动画演示

素材为 8 列 × 9 行图集（192×208 单元），由 [hatch-pet](https://github.com/dsh2026) 流水线生成，以下为各状态动画预览：

| idle 待机 | waiting 等待 | running 干活 | jumping 庆祝 |
|---|---|---|---|
| ![idle](assets/whale/previews/idle.gif) | ![waiting](assets/whale/previews/waiting.gif) | ![running](assets/whale/previews/running.gif) | ![jumping](assets/whale/previews/jumping.gif) |

| waving 挥手 | review 复盘 | failed 失败 | 左右移动 |
|---|---|---|---|
| ![waving](assets/whale/previews/waving.gif) | ![review](assets/whale/previews/review.gif) | ![failed](assets/whale/previews/failed.gif) | ![running-left](assets/whale/previews/running-left.gif) ![running-right](assets/whale/previews/running-right.gif) |

## 架构

```
dsh-pet/
|-- src/
|   |-- index.ts        # host 半区：插件入口（cordis apply，注册路由）
|   |-- service.ts      # PetService：宠物状态机 + 亲密度 + 配置（HTTP API 服务面）
|   |-- state.ts        # 宠物状态机：activity/status phase → 9 状态动画
|   |-- affinity.ts     # 亲密度账本（纯函数 + 冷却）
|   |-- treats.ts       # 小鱼干库存账本
|   |-- persist.ts      # 持久化（$DSH_HOME/pet.json，原子写入）
|   |-- routes.ts       # /api/pet/* JSON API + /pet/whale/* 素材静态路由
|   `-- client/         # 浏览器半区
|       |-- index.ts    # 全局挂载（createRoot → body）+ 轮询（800ms）+ 交互接线（fetch）
|       |-- PetDockEntry.tsx  # 全局浮层入口（document.body，无会话/新会话/会话中全程显示）
|       |-- WhalePet.tsx      # 浮层组件（portal + rAF 帧动画 + 拖动）
|       |-- spritesheet.ts    # 图集几何 + 每状态动画轨道（帧/时长）
|       `-- pet.module.css
|-- assets/whale/       # 鲸鱼娘素材（pet.json + spritesheet.webp + 动画预览）
`-- cordis.patch.yml    # bundle patch：插入 pet 插件行
```

### 数据流

```
activity/status session 事件（原 working-activity 插件发布） --> PetService（host）
                                                              | /api/pet/* JSON
global React root（createRoot → document.body） <-- 轮询 800ms -- pet-client（浏览器）
                                                              |
                                                   WhalePet 浮层（portal + rAF）
```

- **状态源**：监听 `activity/status` 会话事件（phase: idle/waiting/thinking/tool/done + 状态短语），由 host 半区消费；该事件曾由 working-activity 插件发布，插件已从本仓库移除，未安装时宠物只随会话生命周期变化。
- **挂载点**：`document.body`（全局 React root，无会话/新会话/会话中全程显示——旧挂载点 `conversation.composer.dock` 只在活跃会话渲染，导致新会话界面看不到宠物），组件内部 `createPortal` 渲染全局浮层。
- **渲染**：CSS sprite（background-position）逐帧动画，帧时长来自 `spritesheet.ts` 的轨道定义。
- **通信**：浏览器 ↔ host 走同源 `/api/pet/*` JSON 端点（state/interact/set-visible/set-config），图集从 `/pet/whale/spritesheet.webp` 加载——RPC 域与 `/plugins/` 静态服务都是平台注册的，插件自足地提供自己的 API 与素材（与 dsh-remote-web-ui 的 `/api/pair` 同一模式）。

## 安装

推荐直接安装全家桶聚合包 `@linxin666/dsh-web-ui-all`（一个包装齐全部功能插件与皮肤），或单独安装本插件：

```sh
# 推荐：直接从 npm 安装
dsh plugin --profile web add @linxin666/dsh-pet

# 或从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-pet

```

安装后**重启 `dsh web`**，鲸鱼娘出现在界面右下角即生效。link 模式下改代码后重新 `pnpm build` 并刷新页面即可，无需重装。

## 开发

```sh
pnpm build        # tsc -b（类型+声明）&& tsdown（node 半区 + 浏览器 bundle）
pnpm test         # vitest 单元测试（affinity / treats / persist / state）
pnpm prepare      # 仅转译构建（无类型检查，供消费者安装）
pnpm typecheck    # 仅类型检查
```

浏览器 bundle 走 `window.__ModuleLoader__.load` 契约，React/cordis 等由 loader 模块表解析（external）；CSS Modules 由 lightningcss 内联为 `<style data-plugin>`。

## 素材与动画轨道校准

鲸鱼娘图集由 hatch-pet 流水线按 9 状态 × 8 列生成：`assets/whale/spritesheet.webp`（1536×1872，8 列 × 9 行 192×208 单元）+ `assets/whale/pet.json`。每行实际帧数与节奏在 `src/client/spritesheet.ts` 的 `TRACKS` 中定义。若素材重做导致帧数变化，只需更新该表（行序契约：0 idle / 1 running-right / 2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running / 8 review）。

## License

[BSD-3-Clause](LICENSE)
