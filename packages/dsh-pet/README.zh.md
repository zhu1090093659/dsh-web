# dsh-pet — 多宠物伴侣插件

[English](README.md) | 中文

> 一个注册表驱动的网页与桌面伴侣：内置鲸鱼娘，也接受你放入的任何宠物。

模型思考时你在等待，你的宠物在游动。它跟随官方会话活动，在等待、思考、调用工具、整理回复、庆祝完成、报告失败时切换动画；你还可以摸摸它的头、喂它小鱼干，看着亲密度一点点成长。宠物是注册表条目而不是代码：每只宠物只需一份 `pet.json` manifest 加一张图集，宿主启动时自动发现。

从 Codex 桌面应用的宠物功能重新实现，采用官方 DSH 插件形态（cordis bundle：host 半区 + client 半区，一个包）。

## 功能

| 功能 | 说明 |
|---|---|
| 多宠物注册表 | 宿主扫描内置 `assets/`、hatch-pet 自定义宠物目录和组合配置条目；每只宠物 = manifest + 图集 |
| 设置中选择宠物 | 插件设置卡片列出所有已注册宠物；切换即持久化，精灵立即更换 |
| 每只宠物独立命名 | 在悬浮面板改名；每只宠物保存自己的名字（按宠物 id 存储，旧版平铺名字自动迁移） |
| 状态动画 | 官方会话活动 → manifest 定义的 9 态轨道序列；每条轨道播完自身完整时长后切换，整条序列循环 |
| 摸头互动 | 点击宠物 → 气泡反馈 + 亲密度 +1（10s 冷却） |
| 喂食 | 悬浮面板 喂食 → 消耗 1 条小鱼干 + 亲密度 +5（30s 冷却） |
| 小鱼干经济 | 库存（上限 20）：每工作 30 轮 +1，每 300 分钟（5 小时）+1 —— 获取难度为原来的 10 倍 |
| 亲密度 | 每完成一轮 +1；9 级：幼鲸 → 伙伴 → 挚友 → 深海羁绊 → 心有灵犀 → 传说羁绊 → 神话羁绊 → 永恒之契 → 鲸生共渡（上限 999,999,999） |
| 拖动 | 按住拖动宠物换位置；位置持久化 |
| 隐藏/召唤 | 悬浮面板位于宠物下方（下方空间不足时上移到状态气泡之上）并提供 隐藏；隐藏后出现 召唤{name} 按钮 |
| 妙语库 | 内置默认妙语库（每类事件 10 句）+ 宠物自定义台词；成功文案按持久化成功次数轮换，冷却文案按持久化拒绝次数轮换 |
| 状态气泡 | 默认只有最近活动的顶层会话说话——多会话并行时，其余会话收进主气泡右上角的 +N 角标，不再叠出一长列；悬停气泡（触屏点按角标）即可向上展开所有会话的气泡，点击任一气泡跳转到对应会话；子代理会话借由其发起会话体现，不占用独立气泡；瞬时互动反馈临时优先。气泡文案按场景准备了大量轮换词库（等待 / 思考 / 整理 / 完成 / 失败……），工具调用按工具族映射俏皮文案并带上真实参数（如 跑跑 npm test），同一场景持续数秒会自动换一种说法 |
| 碎碎念 | 模型流式输出期间，宠物会偶尔借自己的气泡说出内心独白——新鲜的碎碎念会接管展示会话的气泡并以「」引号标记——与状态气泡共用同一片 DeepSeek 蓝黑玻璃，气泡栈内颜色统一不再色差——不再叠出第二只气泡——由模型输出里的关键词触发对应心境（报错、测试全绿、做计划、打胜仗……），输出量累积也会换来日常碎碎念；有冷却节制，数秒后气泡恢复状态文案 |
| 多会话活动 | 宠物是宿主全局的：最近一次有意义事件驱动精灵动画，同时每个活动的顶层会话用自己的气泡报告各自状态；每个会话（含子代理）完成的轮次都计入亲密度与小鱼干 |
| 网页与桌面共存 | 网页宠物保持可用，同时可选启动受管 Electron 桌面宠物；两种表现的可见性和生命周期开关互不干扰 |
| 共享伴侣数据 | 网页与桌面互动都调用同一个宿主持有的 `PetService`，模型选择、命名、亲密度、小鱼干、冷却、会话气泡和轮次奖励只有一个事实来源 |
| 受管桌面生命周期 | 桌面宠物默认关闭；启用后随带 WebServer 的 DSH Host 启停，从托盘退出还会把持久化开关同步写回关闭 |
| 按需安装 Electron | 安装插件本身不会下载 Electron。首次启用会弹出确认框，可选官方源、npmmirror 或自定义 HTTPS 镜像，并提供进度、取消和重试；固定校验和的运行环境就绪后才持久化桌面开关 |
| 桌面交互适配 | 大小限制在 100%–200%，避免角色裁剪；控件朝屏幕可用空间展开，状态与碎碎念气泡覆盖显示而不扩大窗口，位置、可见性、锁定和置顶偏好均会保存 |

## 配置

聚合安装和单独安装共用 `pet` 设置命名空间。网页设置卡编辑通用字段与桌面开关；桌面设置抽屉通过鉴权宿主桥回写自身的界面偏好。

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `enabled` | `true` | 宠物活动与表现路由的总开关 |
| `petId` | 注册表默认值 | 选中的宠物模型；已移除的 id 会回退到注册表默认值 |
| `visible` | `true` | 网页宠物可见性 |
| `size` | `160` | 网页精灵高度，单位 px（`32`–`512`） |
| `right` | `24` | 网页宠物距视口右边缘的内缩 |
| `bottom` | `20` | 网页宠物距视口底边的内缩 |
| `desktopEnabled` | `false` | 受管桌面宠物生命周期开关 |
| `desktopVisible` | `true` | 桌面表现保持启用时的窗口可见性 |
| `desktopAlwaysOnTop` | `true` | 让桌面窗口保持在普通窗口上方 |
| `desktopLocked` | `false` | 禁止用指针拖动桌面窗口 |
| `desktopScale` | `1` | 桌面缩放（`1`–`2`，即 100%–200%） |

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
  "spriteVersionNumber": 1,                // 可选；2 表示 11 行 v2 图集（9 行动画行 + 2 行视线跟随行）
  "frames": [6, 8, 8, 4, 5, 8, 6, 6, 6],   // 可选的每行帧数
  "tracks": {                              // 可选的每轨节奏覆盖
    "idle": { "durations": [400, 400, 500, 400, 400, 500] }
  },
  "sequences": {                           // 可选的每场景轨道序列（每条至少 5 项）
    "thinking": ["running", "running-right", "running", "running-left", "waiting"]
  },
  "remarks": {                             // 可选妙语（每个槽位一行或多行）
    "pet": "摸摸水獭的头～",
    "feed": ["小鱼干真香", "再来一条～"]
  }
}
```

- 图集是 8 列 × 9 行网格（默认 192×208 单元格）；行序固定：0 idle、1 running-right、2 running-left、3 waving、4 jumping、5 failed、6 waiting、7 running、8 review。未使用的格子保持全透明。v2（Codex）图集在 manifest 里声明 `"spriteVersionNumber": 2`，共 11 行——同样的 9 行动画行外加末尾 2 行视线跟随行；插件渲染这 9 行动画行、忽略视线行。
- 可选 remarks 块覆盖宠物在 pet（摸头）/ petCooldown / feed（喂食）/ feedCooldown / noTreats（缺粮）事件上的气泡台词。每个槽位接受一句或一组台词；声明过的槽位只替换该槽位的内置默认池。成功与冷却池使用对应的持久化成功或拒绝次数，noTreats 则独立轮询。社区贡献就是这样给自家宠物配上专属妙语的。
- `frames` 记录每行用到的列数（缺省按 hatch-pet 契约表 `[6, 8, 8, 4, 5, 8, 6, 6, 6]`）；`tracks` 按动画覆盖每帧时长（按该行帧数循环补足）、`loop` 与 `fallback`（默认：全部循环；`jumping` 与 `failed` 停在最后一帧后回到 `idle`）。
- `sequences` 可选地把活动场景（`idle` / `waiting` / `thinking` / `tool` / `review` / `done` / `failed`）映射到至少 5 条动画轨道。每项按 `tracks` 中的时长播完所有帧后进入下一项，整条序列循环；未声明的场景保持标准单轨播放。

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
|   |-- core/                # 与渲染器无关的活动、意图和叙述契约
|   |-- presentation/        # 表现解析器、控制器和生产协调器
|   |-- adapters/standalone/ # 显式运行环境安装器、启动器与 Standalone 适配器
|   |-- remarks.ts           # 妙语库：内置默认池 + 每宠物覆盖 + 计数选取
|   |-- affinity.ts          # 亲密度账本（纯函数 + 冷却）
|   |-- treats.ts            # 小鱼干库存账本
|   |-- persist.ts           # 持久化（$DSH_HOME/pet.json：选择 + 名字 + 互动计数）
|   |-- routes.ts            # /api/pet/* JSON API + /pet/<id>/* 静态资源路由
|   `-- client/             # 浏览器半区
|       |-- index.ts         # 全局挂载（createRoot → body）+ 注册表拉取 + 轮询 + 接线
|       |-- PetDockEntry.tsx # 全局浮层入口（document.body，始终显示）
|       |-- PetSprite.tsx    # 由定义驱动的浮层精灵（portal + rAF + 拖动）
|       |-- PetSettingsCard.tsx # 设置卡片：宠物选择器 + 显示布局
|       |-- sequences.ts     # 完整轨道场景序列计时
|       |-- spritesheet.ts   # 图集几何辅助 + 轨道裁剪
|       `-- pet.module.css
|-- desktop/                 # 可选的受管 Electron 表现宿主
|-- assets/whale/            # 内置鲸鱼娘（pet.json + spritesheet.webp + 预览）
`-- cordis.patch.yml         # bundle 补丁：插入宠物插件行
```

### 数据流

```text
官方会话事件（turn/step/chunk/tool）----\
                                                    > PetService（宿主）<-- 注册表（内置 + 自定义宠物）
可选兼容 activity/status ------------------/
                                          |                         |
                               /api/pet/* JSON            鉴权回环 SSE
                                          |                         |
                             pet-client（浏览器）             Electron 桌面宠物
                                  |
                    PetSprite 浮层（portal + rAF）
```

- **状态来源**：宿主把官方 `turn/start`、`step/start`、`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`turn/end` 事件投影为 waiting/thinking/tool/review/done/failed 状态。可选兼容 `activity/status` 事件仍作为输入。
- **注册表**：宿主把每份 manifest 归一化为完整渲染定义（几何、每行帧数、每轨时长），经 `/api/pet/pets` 下发；浏览器半区用该定义渲染任意条目，不携带任何宠物专属代码。
- **选择与命名**：`petId` 存于设置命名空间；每只宠物的名字存于 `pet.json` 的 `names`，通过悬浮面板对当前宠物改名编辑。旧版安装的平铺 `name` 自动迁移到鲸鱼娘名下。
- **多会话语义**：API 与浏览器挂载都是宿主全局的，不暴露前台会话身份。并行会话各自保留投影状态：最近一次有意义事件驱动精灵动画，同时每个活动的顶层会话在独立气泡里报告自己的阶段（state 视图的 sessions 列表，最多保留最近 12 个）。子代理会话仍参与动画、计奖与单一显示气泡，但不占独立气泡位——N 个对话不会变成"N + 子代理数"的气泡堆。每个会话完成的轮次仍独立计奖；销毁会话移除它的气泡，销毁当前显示会话则回退到最近仍在活动的会话。
- **挂载点**：`document.body`（全局 React 根，始终显示：无会话 / 新会话 / 会话中都可见——旧挂载点 `conversation.composer.dock` 只在活动会话里渲染，新会话里宠物消失）；组件内部用 `createPortal` 渲染全局浮层。
- **渲染**：CSS 精灵（background-position）逐帧动画；帧时长和可选场景序列来自下发定义。悬浮面板锚定在宠物下方，间隙由指针桥接覆盖；当视口下方空间不足时，面板翻转到宠物上方并抬升到状态气泡栈之上，两者互不遮挡。
- **通信**：浏览器 ↔ 宿主走同源 `/api/pet/*` JSON 端点，每只宠物的图集从 `/pet/<id>/<spritesheetPath>` 加载。单独安装时，主设置 scope 不可用才回退到仅限回环地址的 `/api/pet/settings`；`/api/pet/runtime` 向设置弹窗提供状态、显式安装与取消。受管子进程使用令牌鉴权的 `/api/pet/native/*` 状态、互动与 SSE 路由，不直接读写 `pet.json`。
- **表现隔离**：`visible` 只控制网页宠物，`desktopEnabled` 控制受管 Electron 生命周期。桌面可见性、大小、锁定和置顶保持独立，因此隐藏任一表现不会隐藏另一端。

## 安装

安装聚合全家桶 `@linxin666/dsh-web-ui-all`（全部插件与皮肤一次到位），或单独安装本插件：

```sh
### 从 npm 安装（推荐）
dsh plugin --profile web add @linxin666/dsh-pet@latest

### 从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-pet

```

安装后**重启 `dsh web`**——网页宠物出现在界面右下角。安装插件本身不会下载 Electron。要使用桌面宠物，请进入**设置 → 宠物**，启用桌面宠物、选择下载源并确认首次安装；固定版本的运行环境保存在 `$DSH_HOME/cache/dsh-pet/electron` 下，取消或失败不会影响网页宠物。link 模式下改代码后运行 `pnpm build` 并刷新页面即可，无需重装。

## 开发

```sh
pnpm build          # 宿主/网页 bundle + 受管 Electron 表现
pnpm test           # Host/Web 测试，再运行 Electron 主进程/渲染器测试
pnpm desktop:dev    # 以开发模式运行 Electron 表现
pnpm desktop:smoke  # 有时限的真实 Electron 冒烟测试
pnpm typecheck      # 宿主、网页、测试与桌面端类型检查
```

`electron` 只作为源码开发依赖，不是随插件安装的运行时载荷。最终用户只有在设置弹窗中明确确认后才会下载它。

浏览器 bundle 走 `window.__ModuleLoader__.load` 契约；React/cordis 等从 loader 模块表解析（external）；CSS Modules 由 lightningcss 以内联 `<style data-plugin>` 编译进 bundle。

## 安全模型

- 网页设置与运行环境控制路由只接受直接回环、同站请求；它们只暴露 `pet` 命名空间，并只允许白名单内的单字段变更。
- 每次 WebServer 挂载都会为原生桥生成新的 256 位 bearer token。令牌与来源通过子进程环境而非命令行参数传递；状态变化走鉴权回环 SSE。
- Electron 只在用户明确确认后开始下载。官方源、npmmirror 与自定义 HTTPS 镜像最终都解析到按版本和 SHA-256 固定的平台产物，校验通过后才接受解压结果。
- Electron 进程只消费宿主 API，并仅保存原生窗口与模型偏好；亲密度、小鱼干、名字和会话活动仍由 `PetService` 持有。

## 已知限制

- 受管桌面表现需要交互式 Windows、macOS 或 Linux 会话，以及带 WebServer 的 DSH Host。CI、容器、无界面会话和没有网页桥的 Host 会保留宠物核心，但不会启动 Electron。
- 首次 Electron 下载体积较大，速度取决于所选镜像。关闭或刷新网页不会启动第二次安装；重新打开弹窗会接回宿主持有的进度。
- 嵌入式桌面宿主契约可供后续 Provider 使用，但本包当前只随附受管 Standalone 表现。修改自定义宠物注册表后仍需重启 DSH Host。

## 精灵图与动画轨道校准

内置鲸鱼娘图集由 hatch-pet 流水线生成，9 态 × 8 列：`assets/whale/spritesheet.webp`（1536×1872，8 列 × 9 行，192×208 单元格）+ `assets/whale/pet.json`。每行的帧数、节奏与场景轮换写在该 manifest 的 `frames`、`tracks` 与 `sequences` 字段里；未覆盖的宠物沿用 hatch-pet 契约节奏和标准单轨场景映射。重做美术因此只需修改 `assets/whale/pet.json`（行序契约：0 idle / 1 running-right / 2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running / 8 review）。

## 许可证

[BSD-3-Clause](LICENSE)
