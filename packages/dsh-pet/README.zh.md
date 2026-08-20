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
| 语音包与面板 DIY | 宠物目录 voice.json + 全局 $DSH_HOME/pets/.voice.json 覆盖气泡全部文案与悬浮面板（按钮标签/统计格式/按钮显隐）；合并优先级 宠物自带 > 全局 > 内置，坏包警告不拒载 |

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

### 清单 v2（宠物中心，#623）

宠物目录的 `pet.json` 在 v2 中显式声明渲染器：

- `petManifestVersion: 2`（缺省 = v1，按 `sprite2d` 兼容读并给出迁移提示）；
- `renderer`：`"sprite2d"`（上文图集契约）或 `"live2d"`；
- `license`（v2 必填）：资产授权标识——社区宠物必须携带来源声明；
- 渲染器专属块：`sprite2d`（spritesheetPath/cell/columns/atlasRows/frames/tracks）或 `live2d`（model/motions/expressions/hitAreas/scale/translate）。

校验纪律：结构 fail-closed（未知字段或未知渲染器直接拒载并给出诊断），sequences/remarks 内容维持 warn-and-drop。机器可读 schema 见 `contracts/pet-manifest-v2.schema.json`，权威校验器为 `src/manifest-v2.ts`。迁移 v1 清单：`node scripts/dsh-pet-migrate-v2.mjs <dir> --write`（默认 dry-run；保留 `pet.json.v1.bak`）。

宠物的来源（后注册的来源在同 id 冲突时覆盖前者）：

1. **内置**：本包 `assets/<dir>/pet.json`。
2. **legacy 自定义宠物**：`${CODEX_HOME:-~/.codex}/pets/<pet>/pet.json` —— hatch-pet 流水线把产物放在这里，孵化的宠物无需任何接线即可出现在选择器里。
3. **宠物中心用户目录**：`$DSH_HOME/pets/<id>/`——推荐安放位（见下方 CLI）。
4. **组合注入**：嵌入应用通过 `PetConfig.pets` 传入的 manifest 条目。

用 CLI 校验并安装宠物目录（零构建、零发布）：

```sh
node scripts/dsh-pet validate <dir>           # 清单 + 资产 + Live2D 引用闭包 + voice.json
node scripts/dsh-pet install <dir>            # 校验通过后拷入 $DSH_HOME/pets/<id>/
node scripts/dsh-pet install <dir> --force    # 覆盖同名已安装宠物
```

非法条目永不覆盖可用宠物：它们被跳过并在设置（宠物栏目）给出诊断。注册表在宿主启动时构建一次；新增或修改宠物后重启 `dsh web` 生效。

## 语音包与面板定制（voice.json，宠物中心 M4，#677）

气泡里的状态/工具/碎碎念文案与悬浮面板的按钮/统计文案，都可以被一只宠物（或你本人）整体替换——宠物不再只能换图，还能换「话」与「面板」。载体是宠物目录内的可选 voice.json（随宠物分发），以及全局覆盖文件 $DSH_HOME/pets/.voice.json（不改宠物目录即可换词）。

```jsonc
{
  "voicePackVersion": 1,              // 可选；缺省视为 1
  "status": {                          // 状态池：键 = 场景 id，逐键覆盖内置池
    "done": ["搞定收工～", "交差！下一位"]
  },
  "tools": {                           // 工具池：键 = 工具族；允许 {tool} / {hint}
    "shell": ["跑跑 {hint}", "敲回车！{hint}"]
  },
  "toolRemaining": ["后台还有 {n} 位小助手"],   // 允许 {n}
  "whispers": {                        // 碎碎念：按节替换（非逐条合并）
    "generic": ["冲了冲了", "稳"],      // 环境池；显式空数组 = 静音
    "rules": [                         // 关键词规则（有序；给出即整体替换内置规则）
      { "keywords": ["测试通过"], "pool": ["全绿！"] }
    ]
  },
  "panel": {                           // 悬浮面板（每槽未声明时回落插件 i18n 文案）
    "labels": { "feed": "投喂", "hide": "藏起来", "rename": "起名字", "confirm": "好的" },
    "stats": { "rank": "好感 {rank}", "treats": "鱼干 ×{n}", "points": "{points} 分" },
    "actions": ["feed", "rename", "hide"]  // 子集（按规范顺序）；省略 = 全部；[] = 只显示统计行
  }
}
```

- 合并优先级（逐槽）：宠物自带 voice.json > 全局 .voice.json > 内置文案。status/tools 逐键合并、whispers 按节替换、panel 逐槽合并，任何层缺失的槽位回落下一层。
- 占位符白名单：tools 允许 {tool} / {hint}；toolRemaining 允许 {n}；panel.stats 允许 {rank} / {n} / {points}；status、碎碎念与面板标签不允许任何占位符（含非法占位符的行被警告丢弃）。
- 上限（warn-and-drop）：每池 64 行以内、每行 160 字符以内；规则 32 条以内、每规则关键词 16 条以内（40 字符以内）；面板标签 40 以内、统计 80 字符以内。
- 坏包不影响宠物：voice.json 不是合法 JSON 或根不是对象 → 警告并整体忽略；其余问题逐槽警告丢弃。诊断显示在设置 → 宠物目录诊断。node scripts/dsh-pet validate <dir> 会把结构错误判为安装失败、内容问题列为警告。
- 语义细节：status/tools 的空池回落内置文案（场景行始终有话说）；whispers 的显式空数组是静音（关掉该通道）；面板 actions 为空数组 = 三个按钮全部隐藏；未覆盖的按钮/统计继续使用插件双语字典。

## Live2D 宠物（renderer: live2d）

Live2D 宠物经 PixiJS/WebGL 渲染：MIT 许可的 pixi.js + untitled-pixi-live2d-engine 栈以按需加载的 vendor 分包随插件内置，纯 sprite 用户永不下载、永不解析它。**本插件永不内置、永不代下 Cubism Core 运行时**——Live2D 专有许可不允许再分发。启用 Live2D 宠物：

1. 自行从 Live2D 官方渠道获取 Cubism SDK for Web（你自行同意其许可），取得 `live2dcubismcore.min.js`；
2. 放到 `$DSH_HOME/pets/.runtime/live2dcubismcore.min.js`——插件把它连同自带的 vendor 分包一起提供给页面；
3. 安装 Live2D 宠物（含 `pet.json` v2、`renderer: "live2d"` 与模型文件的目录）。

core 缺失时，Live2D 宠物在渲染位置给出安装指引卡；sprite2d 宠物不受影响。法律提示：本插件属 Live2D 术语下的「可扩展性 APP」——你公开发布基于可加载用户模型的衍生作品时，可能不论规模都须与 Live2D 签订发行许可；发布前请自行评估义务。

Live2D 清单把七个活动相位映射到模型的动作组：

```json
{
  "petManifestVersion": 2,
  "id": "my-live2d-pet",
  "displayName": "My Live2D Pet",
  "license": "CC0-1.0",
  "renderer": "live2d",
  "live2d": {
    "model": "model/my-pet.model3.json",
    "motions": { "idle": "Idle", "thinking": "Think", "failed": "TapBody" },
    "hitAreas": ["Body"]
  }
}
```

- `model`：相对宠物目录的 `.model3.json` 路径。模型引用的一切文件（moc、贴图、动作、物理、姿态、表情）都必须放在目录内——宿主恰好只服务这个引用闭包。
- `motions`（必填，且必须含 `idle`）：相位 → 动作组。未映射的相位与模型缺失的组一律回退 `idle`；组内有多条动作时随机播放一条。官方 Cubism 示例模型只带 `Idle` 与 `TapBody` 两个组。
- `expressions`（可选）：相位 → 表情名，叠加在动作之上。
- `hitAreas`（可选）：点击落在列出的命中区时播放模型的 `TapBody` 组，播完回到当前相位的动作组。任何点击仍计入摸头——交互经济与 sprite2d 一样由 chrome 掌管。
- `scale` / `translate`（可选）：模型自动适配显示盒；`scale` 在适配结果上乘算（默认 1，范围 (0, 10]），`translate` 以中心为基准做像素偏移。

模型授权：Live2D 官方示例模型（Hiyori、Haru 等）仅供评估、禁止再分发——只发布你有权的模型（原创作品或宽松授权的模型）。

## 状态装饰（decoration.json，宠物中心 M5，#567）

宠物状态气泡里的文字之前可以有一个小的状态装饰（内置：喷水鲸鱼），由 ActivityPhase 流驱动换帧。装饰与宠物相互独立：独立描述符、独立 id、独立目录，换宠物不换装饰。入口资产只收 PNG/WebP 单行精灵条带（不收 SVG/CSS）；气泡自身的 role=status/aria-live（或会话气泡按钮语义）永远保留，装饰 aria-hidden；prefers-reduced-motion 时停在帧段首帧，资产加载失败只消失装饰、文字照常。

```jsonc
{
  "decorationManifestVersion": 1,
  "id": "whale",                     // 唯一小写 kebab id
  "displayName": "喷水鲸鱼",           // 可选
  "license": "MIT",                   // 必填：资产授权（社区装饰必须携带来源声明）
  "entry": "whale-frames.png",        // PNG/WebP 单行条带，相对本目录
  "cell": { "width": 64, "height": 48 },
  "columns": 4,                       // 条带帧数（1..16）
  "frameMs": 160,                     // 常量帧时长；或用 "durations": [..] 逐帧覆盖
  "loop": true,
  "phases": {                         // ActivityPhase 七态 -> 帧段（含端点）；"hide" = 不显示；缺省 = hide
    "idle": "hide",
    "waiting": { "from": 0, "to": 1 },
    "thinking": { "from": 0, "to": 3 },
    "done": { "from": 2, "to": 3 },
    "failed": { "from": 3, "to": 3 }
  }
}
```

- 结构 fail-closed（未知字段、越界尺寸、非 PNG/WebP 入口直接拒载并进诊断），帧段内容 warn-and-drop。机器可读 schema 见 contracts/status-decoration-v1.schema.json，权威校验器为 src/decoration.ts。
- 来源：内置 assets/decorations/ + 用户目录 $DSH_HOME/pets/decorations/<id>/（同 id 覆盖内置）。资产经 /api/pet/decoration/<id>/<file> 路由，containment 与白名单与宠物资产同构。
- 开关：设置 → 宠物 → 状态装饰（默认开）。内置鲸鱼素材派生自 DeepSeek wordmark（MIT），完整声明见 THIRD_PARTY_NOTICES.md。
## 内置宠物

| 注册表 id | 选择器名称 | 来源 |
|---|---|---|
| `whale-girl` | 鲸鱼娘（原版） | 仓库原有的鲸鱼娘图集 |
| `whale-girl-refined` | 鲸鱼娘（精致版） | 以鲸鱼娘设计方向为基础，经 AI 辅助二次创作、修复和细节精修的衍生版本 |

精致版参考了 DreamSkin 的「DeepSeek-鲸鱼娘」主题。历史来源记录标注原主题作者为 `powerdog996`，并标注主题为 MIT：[DreamSkin](https://dreamskin.cc)、[仓库来源记录](https://github.com/zhu1090093659/dsh-web-ui/commit/87edd7ff4800dffd40bc93fb76e4ae450390facd)。此处用于记录素材来源与衍生关系；精致版不表述为原作者的官方作品，也不重新定义原始美术作品的授权范围。

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
|-- assets/whale/            # 内置原版鲸鱼娘（manifest + 图集 + 预览）
|-- assets/whale-refined/    # 内置精致版鲸鱼娘注册表变体
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
- **多会话语义**：API 与浏览器挂载都是宿主全局的，不暴露前台会话身份。并行会话各自保留投影状态：最近一次有意义事件驱动精灵动画，同时每个活动的顶层会话在独立气泡里报告自己的阶段（state 视图的 sessions 列表，最多保留最近 12 个）。子代理会话仍参与动画、计奖与单一显示气泡，但不占独立气泡位——N 个对话不会变成"N + 子代理数"的气泡堆。每个会话完成的轮次仍独立计奖；销毁会话移除它的气泡，销毁当前显示会话则回退到最近仍在活动的会话。
- **挂载点**：`document.body`（全局 React 根，始终显示：无会话 / 新会话 / 会话中都可见——旧挂载点 `conversation.composer.dock` 只在活动会话里渲染，新会话里宠物消失）；组件内部用 `createPortal` 渲染全局浮层。根容器随插件 fiber 生命周期走：fiber 销毁时卸载 React 根、移除容器并停止轮询与设置订阅；热重载或重复注入的新 bundle 接管页面级单挂载槽，页面始终只有一个 `[data-dsh-pet-root]`（issue #785）。
- **渲染**：CSS 精灵（background-position）逐帧动画；帧时长和可选场景序列来自下发定义。悬浮面板锚定在宠物下方，间隙由指针桥接覆盖；当视口下方空间不足时，面板翻转到宠物上方并抬升到状态气泡栈之上，两者互不遮挡。
- **通信**：浏览器 ↔ 宿主走同源 `/api/pet/*` JSON 端点（state/pets/interact/set-visible/set-config/set-name/set-pet）；每只宠物的图集从 `/pet/<id>/<spritesheetPath>` 加载——插件自给自足地提供自己的 API 与资源（与 dsh-remote-web-ui 的 `/api/pair` 同一模式）。

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

两套内置鲸鱼娘图集使用同一份 9 态 × 8 列契约：`assets/whale/` 是原版，`assets/whale-refined/` 是精致版。每张图集均为 1536×1872（8 列 × 9 行，192×208 单元格）。每行帧数、节奏与场景轮换写在各目录的 `pet.json` 中；未覆盖的宠物沿用 hatch-pet 契约节奏和标准单轨场景映射（行序：0 idle / 1 running-right / 2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running / 8 review）。

## 安全模型

- 全部 `/api/pet/*` 与 `/pet/<id>/*` 路由默认仅限 loopback（插件家族共享围栏：loopback 套接字 + Host 头 + 浏览器同源标记）：未配对的局域网客户端在任何宠物状态或图集下发前即收到 `403 forbidden: loopback-only`。同时装了 `dsh-remote-web-ui` 时，有效的已配对设备 cookie 是额外放行路径（与 `api/gate` 检查同一枚 cookie）；未配对与已撤销设备仍 403。宠物插件不硬依赖远程插件。
- 资产服务对宠物目录与目标文件双双做 `realpath` 解析；symlink 越界一律拒绝（403）。文件读入内存前按类限大小（清单 64 KB、图像 20 MB；超限 413）。
- Live2D 模型按闭包放行：仅清单、声明的主资产与 `.model3.json` 引用到的文件（引用先经穿越/绝对路径/URL 形态筛查）。
- 插件从不下载可执行文件，也从不内置 Live2D Cubism Core。
- 清单结构 fail-closed：未知字段或未知渲染器直接拒载，并在设置中给出诊断。

## 许可证

[BSD-3-Clause](LICENSE)
