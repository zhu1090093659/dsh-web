# dsh-skill-explorer · DeepSeek Harness (DSH) Skill 技能与工具资源可视化浏览器

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-client-ui-skill-explorer?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.2-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>DeepSeek Harness（DSH）官方 Web GUI 与桌面客户端专属技能中心与 Skill 管理面板</strong><br>
  <em>按来源层级浏览 · 一键启闭模型调用 · 可视化新建/编辑 SKILL.md · 安全回收站 · 零侵入管理</em>
</p>

DSH Web GUI 与官方桌面客户端的**技能中心**：按来源分级浏览已加载的全部 skill，启用/禁用模型调用，创建新技能，删除技能（移入可恢复的回收站）。

## 功能

- 侧边栏「技能中心」一行（位于 shell 自己的面板列表，与插件、定时、任务看板
  并列），打开的是**原生中栏页面**，带页签栏。该行负责打开面板，打开任意会话
  （或新建对话）即让中栏回到会话正文，与官方插件页、定时任务页一致；页面自身
  不再提供「返回会话」控件。
- **技能 tab**：按来源分级展示（系统内置 / 项目 `.dsh/skills` / 项目
  `.agents/skills` / 自定义目录 / 用户 `~/.dsh/skills` / 用户
  `~/.agents/skills` / 运行时注册），顶部搜索框按技能名或描述即时过滤
  （名称命中排在前面，Esc 清空），并与工作区选择叠加生效；
  每行显示描述、适用场景、可调用标记、启用/禁用开关（改写 SKILL.md
  frontmatter 的 `disable-model-invocation`，模型目录热刷新；插件提供的文件
  没有这条可写路径，其开关改由面板自己的存储记录）、编辑入口与删除按钮
  （文件移入 `.trash`，可恢复）；加载进行中隐藏刷新按钮。
- **创建 tab**：表单创建新技能，可写入用户根（`~/.dsh/skills`）或项目根
  （`.dsh/skills`），生成标准 SKILL.md。
- **编辑 tab**：从行内编辑入口打开，先经宿主读取该技能（列表只带元数据），
  再就地改写描述、适用场景与正文；技能名、位置与启用状态保持不变。
- 数据来自按官方 dsh-skill-filesystem 根约定的文件系统扫描，并与
  `ctx.skills` 注册表（bundled / runtime 条目）合并。扫描既读本插件自己的
  `customSkillDirs`，也读每一条在用的 `skill-filesystem` loader 行的同名
  配置，因此官方文档推荐的配法（写在 profile patch 的 provider 行上）同样可管理。
  本插件不改变 skill 的加载/注入语义——纯 GUI 管理层。
- 写路由无法操作的技能会按它实际的本地形态打标，而不是静默缺失控件：
  插件 provider 报告了真实指令文件（官方 `SkillSummary.path`）的技能显示为
  **「由插件提供」**——文件确实存在，只是不在本面板扫描的技能根目录下；
  只有完全没有文件的注册项才显示为 **「无本地文件」**。两者都不带可写路径，
  因此都不会出现必然 404 的编辑/删除控件。**「由插件提供」**的行带有启用/
  禁用开关（#1854）：文件属于 provider，因此宿主把开关记在面板自己的存储里，
  该行显示为已停用（见「已知限制」）；只有**「无本地文件」**的行完全没有开关。
- 只有官方 provider 会加载的技能才被列出：SKILL.md 必须声明非空的 `name`
  与 `description`，且 name 满足官方技能名文法。被官方 provider 丢弃的文件
  在面板里同样不出现，面板不会展示模型收不到的技能。
- 同名技能按官方来源 rank 决出胜者（项目 `.dsh/skills` 100、项目
  `.agents/skills` 200、运行时 250、自定义目录 300、用户 `~/.dsh/skills`
  400、用户 `~/.agents/skills` 500、内置 600），因此面板所示与模型所得是
  同一个技能。

## 安装

### 从 npm（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-skill-explorer@latest
```

### 从仓库（开发）

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-skill-explorer
```

安装后重启 `dsh web`，侧边栏出现「技能中心」入口。

## 路由

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/api/dsh-skill-explorer/list` | GET | 分级技能列表 |
| `/api/dsh-skill-explorer/read` | GET | 单个技能的可编辑字段与正文（`?name=&path=`） |
| `/api/dsh-skill-explorer/set-enabled` | POST | 启用/禁用（改写 frontmatter） |
| `/api/dsh-skill-explorer/set-provider-enabled` | POST | 启用/禁用插件提供的技能（记入面板自己的存储） |
| `/api/dsh-skill-explorer/create` | POST | 创建技能（user/project 根） |
| `/api/dsh-skill-explorer/update` | POST | 原地修改已有技能（名称与位置不变） |
| `/api/dsh-skill-explorer/delete` | POST | 删除（移入 .trash） |
| `/api/dsh-skill-explorer/health` | GET | 健康检查 |

## 安全模型

- 全部 `/api/dsh-skill-explorer/*` 路由默认仅限 loopback（插件家族共享围栏：
  loopback 套接字 + Host 头 + 浏览器同源标记）：未配对的局域网客户端在任何
  技能文件访问前即收到 `403 forbidden: loopback-only`。同时装了
  `dsh-remote-web-ui` 时，有效的已配对设备 cookie 是额外放行路径（与
  `api/gate` 检查同一枚 cookie）；未配对与已撤销设备仍 403。技能中心不硬依赖
  远程插件。
- 写路由仅把面板展示的路径作为身份声明；执行修改前，最新文件系统扫描必须解析到
  同名且路径完全一致的技能。任意路径与过期的同名回退都会被拒绝，因此项目技能
  消失后，尚未执行的操作不会改到同名的用户级或自定义技能。read 路由走同一套
  解析，因此也无法用来读取任意路径。该解析所用扫描按与 list 路由完全相同的顺序
  确定工作区（显式覆盖、活动会话工作区、进程 cwd），因此写操作不会重新扫描到与
  面板展示不同的项目根。
- update 路由原地改写已有 SKILL.md，不改技能名与位置，并原样保留当前的
  `disable-model-invocation` 值，因此编辑不会静默把已禁用的技能重新启用。
  与删除同理，链接技能在该路由上被拒绝（见下）。
- 插件技能开关路由把每条记录以 `(provider, 技能名)` 组合写入
  `$DSH_HOME/dsh-skill-explorer/provider-toggles.json`（临时文件 + fsync +
  rename 原子落盘；损坏、异构或超限的文档降级为「什么都没停用」）。该路由
  既不接收也不写入路径：客户端只发送身份，不发送位置。停用要求最新一次收集
  仍能把该组合解析为 `provider-file` 行，因此存储里只可能出现面板确实展示过
  的身份；启用只做删除记录，故无条件放行——插件卸载后残留的记录仍可清除。
  两个方向都是幂等的，重复点击或重试不会堆出重复记录。
- 技能内容是用户自写的 markdown；创建表单限制内容 64KB，编辑路由同样执行
  该上限。
- 面板用文本节点渲染技能描述（无 HTML 注入）。
- 扫描跟随符号链接：skill 根里的符号链接目录 / `.md` 单文件链接会被当作
  普通技能列出。链接属于用户的挂载意图，因此不校验链接目标是否落在某个
  skill 根内；项目根（可能来自 clone 的仓库）里的符号链接被视为该项目内容，
  其指向目录中的 `SKILL.md` 会被读取并展示——这是预期信任边界。链接技能可
  列表、可启用/禁用（改写目标自身的 frontmatter），但**不可删除、也不可编辑**：
  删除会把链接目标的 `SKILL.md` 移出原位、越出当前 skill 根，原地改写同样会
  越出该根，因此对链接技能隐藏删除与编辑按钮，并在 delete / update 路由上
  拒绝（400）。写操作仍受 loopback 围栏与「仅信任最新
  扫描路径」约束。

## 已知限制

- 项目技能跟随面板显示的 workspace：list 路由接受显式 `?cwd=` 覆盖，
  创建表单会发送当前显示的 workspace；项目根为该 workspace 最近的
  `.git` 祖先。写路由解析与 list 路由相同的 workspace，因此即使宿主进程 cwd
  在别处，项目技能仍可管理。
- frontmatter 解析为零依赖轻量实现（块标量、布尔、input 嵌套块）；不支持的
  生僻 YAML 特性以官方 dsh-skill-filesystem 提供方为准。
- 面板覆盖它扫描的文件系统根，加上 `ctx.skills` 注册表的全局层（bundled 与
  runtime 条目）。配在 host 平面 `skill-filesystem` 行上的 `customSkillDirs`
  会被扫描，因为宿主会读取该行配置；仅通过**某个 agent preset 自己的**
  `customSkillDirs` 或 preset 作用域提供方到达 agent 的技能不在此覆盖范围内，
  因为面板读取注册表时不带 viewing scope。因此面板里没有的技能，不一定模型也没有：
  会话能加载什么，以官方 `skill` 工具目录为准。
- **「由插件提供」**行的开关是**仅本面板生效**的视图决定：它改变的是本面板
  列出的可调用状态，宿主注册表照旧加载该技能，模型仍会收到它。要真正让这类
  技能不再进入模型，需要在它的 provider 获取它的位置（插件配置或随包文件）
  移除或停用它。
- 链接技能不可删除、不可编辑（见安全模型）；启用/禁用对链接技能正常（改写目标
  `SKILL.md` frontmatter）。目录型与「单文件」链接都能正常列出；「单文件」
  符号链接（指向单个 `.md`）在原子改写（rename）时会被替换为一个普通文件
  （链接不再保留），目标文件本身不受影响。

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：仅含一个 localStorage 随机 ID 与本包名，无其他数据。服务端只存储该 ID 的加盐哈希，不存 IP，且只暴露聚合计数。完整契约见 [docs/telemetry.md](../../docs/telemetry.md)。

## License

BSD-3-Clause。
