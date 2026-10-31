# dsh-task-board-github · DeepSeek Harness (DSH) 任务看板 GitHub Issues 与 PR 自动化同步扩展

[English](README.md) | 中文

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-task-board-github?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.3-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>DeepSeek Harness（DSH）任务看板 GitHub Issues 双向同步与自动化 PR 交付扩展</strong><br>
  <em>Issue 自动转卡片 · 双向状态标签流转 · 自动创建 PR · 智能体交付流水线 · 7 大 Agent 工具</em>
</p>

面向 DeepSeek Harness (DSH) Web GUI 与官方桌面客户端任务看板（`@linxin666/dsh-task-board`）的官方外部数据提供方扩展。它无缝打通 GitHub Issues 与 DSH 智能体会话流转：自动将配置仓库中指定标签或指派给认证账号的 Issue 同步为看板卡片，驱动 AI Agent 自动编码排查并创建 Pull Request，同时双向同步标签状态。扩展支持可视化开关与凭据管理，通过 `cordis.patch.yml` 与 profile 机制热插拔挂载，零侵入修改 DSH 源码。

## 功能

- **把 GitHub Issues 作为看板的外部来源**：每个已配置仓库中被选中的 issue 都会成为看板卡片；列流转、执行与调度仍由看板负责。
- **有边界的远端关闭同步**：关闭的 issue 直接以已完成建卡，也会把既有的非运行、未归档卡片移入已完成，但不伪造执行记录。运行中的卡片绝不被打断：关闭等待本次执行结算，只有结算后列未再次被改动时才在后续同步中完成迁移。Issue 重开时只把自动完成的卡片移回待办；本地把卡片移出已完成会覆盖当前关闭周期，直到 issue 重开后再次关闭。归档卡片保持不变，这条入站规则绝不会关闭或重开远端 issue。
- **按仓库配置**：owner、repository、纳入标签、可选的纳入指派账号、是否连无指派的 issue 一起收、自管标签前缀、每个看板列对应的 GitHub 标签、Pull Request 阶段标签、轮询间隔、是否允许创建 PR、草稿策略、合并后是否关闭 issue 以及 PR 目标分支。
- **三种上板方式**：issue 带纳入标签、被指派给该仓库配置的登录（`@me` 表示宿主认证的账号），**或**属于「收无指派」仓库且完全没人指派，任一命中即上板；所有通道都不再命中时卡片被停用，但保留全部执行历史。
- **无指派通道**：`includeUnassigned: true` 只认「一个指派人都没有」的 issue，永远不会收走指派给他人的 issue；它适合那种从不指派、只用标签管理 issue 的仓库。
- **受控回写**：只增删 DSH 自有的状态与阶段标签；仓库自有标签（含纳入标签本身）绝不修改。
- **执行不可变**：远程标题与正文只在卡片开始执行之前刷新卡片内容。这一判定由看板自己的内容门禁裁定，扩展不再保留第二套“哪些卡片已冻结”的判定。
- **模板化执行 Prompt，而不是原样转发 issue 正文**：同步来的卡片使用模板生成的 Prompt：写明 issue（仓库、编号、链接、仓库自有标签），固定工作流（先读仓库的 agent 协作说明、在基于 `baseBranch` 的 `issue-<编号>` 分支上实现、运行仓库要求的检查、用 `task_board_github_comment` 回帖、PR 合并前不得关闭 issue、issue 无需改动时回帖说明后结束而不是制造改动），并把 issue 正文原样附在来源声明里，issue 文本无法提前闭合该声明。在任务详情里被手动修改过的 Prompt，之后的同步一律保留；未改动的 Prompt 会跟随 issue 更新，直到卡片开始执行。
- **可选的 AI 分析**：任务详情席位可以请模型（所选的 `provider/model`，否则依次为仓库的 `analysisModel`、卡片钉住的模型、宿主默认模型）生成结构化分析——目标、步骤、完成标准，以及是否需要改代码。它只作为 Prompt 中标明「模型生成、未经人工审查」的一段，绝不取代原样附上的 issue 正文；分析在宿主后台运行，按其依据的 issue 内容缓存，issue 一变就从 Prompt 中移除；卡片已冻结时拒绝，Prompt 被手动修改过时需显式确认覆盖。判断「无需改代码」时提供一键移到待规划。
- **无损停用**：issue 不再被选中（标签被移除、且不再指派给配置的登录）时，卡片从活动看板隐藏并保留全部执行记录；重新命中任一通道即恢复同一张卡片。
- **九个模型可见工具**：七个同步与回写工具（`task_board_github_list`、`task_board_github_get`、`task_board_github_refresh`、`task_board_github_create_pr`、`task_board_github_link_pr`、`task_board_github_comment`、`task_board_github_close_issue`）加两个配置工具（`task_board_github_setup`、`task_board_github_repositories`），经看板的 `registerTool` 能力登记，因此随「看板总开关 × 本扩展开关」一起收放。
- **回写 issue**：`task_board_github_comment` 在 issue 上发一条 Markdown 评论（正文非空且不超过 16000 字符，超长直接拒绝而不是截断成模型没写过的样子）。`task_board_github_close_issue` 关闭 issue，但**只在卡片关联的 PR 已合并时**才放行——本地跑通不等于改动已被评审，这条护栏与「PR 合并自动关闭」共用同一个判据，两条路径不会对「工作是否落地」产生分歧。
- **自动识别工作区**：同步建卡时按**仓库名**匹配本机工作区目录名（大小写不敏感，`.`/`_`/`-` 视为同一分隔符，POSIX 与 Windows 路径都认），匹配到就把 `workspaceId` 钉在卡片上——多项目并行时 issue 不会被丢进「最近使用」的那个仓库。**匹配不上就不钉**：相似名字（`dsh-web` vs `dsh-web-old`）、子串、以及同一个项目存在两份检出时都判为未匹配，卡片退回看板自己的继承规则，绝不猜。宿主不提供工作区注册表时本项整体不生效。
- **两个看板席位**：任务详情中的 issue / 标签 / Pull Request 区域，以及卡片 meta 行内的 `#<issueNumber>` 徽章（Issue 地址为 http(s) 时是在新标签页打开 Issue 的链接，点击不会同时打开任务详情）。仓库与凭据摘要改在本扩展自己的设置卡中渲染，紧邻决定其行为的开关。
- **一个开关门禁两侧**：默认开启。关闭后即停止轮询、停止回写、解除事件订阅与工具登记、清空已发布摘要并撤下全部席位——无需重挂载插件行，也不触碰已存储的卡片。
- **登记面归看板所有，且与加载顺序无关**：扩展向看板的提供方席位登记，且不 import 看板内部实现，因此可作为独立包构建、发布与加载。两侧半区都经 cordis 依赖作用域等待看板的提供方服务，因此看板先于或后于本插件行激活都可以：服务一被提供，席位与 provider 登记就出现；服务撤走即自动释放。
- **凭据只在 Host 侧处理**：令牌由宿主解析——先查 DSH 凭据库（与 Models 页存 API Key 是同一处），再查 `tokenEnv` 指定的环境变量，最后查 `GH_TOKEN`。设置卡与配置工具只写入一次，任何响应、快照或工具结果都不携带令牌值。远端 issue 文本只作为卡片内容与提供方元数据存储，绝不进入权限、工作区身份或 `promptPrefix`。

## 安装

安装聚合包或单独安装本包，然后重启 `dsh web`：

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board-github@latest
```

本地开发：

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board-github
```

## 在界面里配置

打开 Web GUI 设置页，在 Web 插件里找到 **任务看板** 卡片：**GitHub Issues 同步** 区块就渲染在它内部——本扩展是这块看板的提供方，配置自然与看板同处一处。关闭该区块的总开关会隐藏仓库与凭据表单（区块本身保留，随时可以重新打开）；常规配置全部在区块里完成，不用改 profile patch，也不用重启：

1. **粘贴 GitHub Token** 并保存。令牌只发给本机宿主一次，存进 DSH 凭据库（与 Models 页存 API Key 是同一处），浏览器不会读回；一个只有仓库读权限（contents / issues / pull requests）的 fine-grained token 就够用。如果不想把令牌放进凭据库，也可以改用环境变量：`tokenEnv` 指定的变量名（默认 `GITHUB_TOKEN`）或 `GH_TOKEN`；卡片会显示当前用的是哪种来源，以及凭据库是否可写。
2. **添加要同步的仓库**：输入 `owner/repo`，或直接粘贴 GitHub 链接 / SSH 远程地址，并可顺便指定该仓库使用的纳入标签与纳入指派账号。issue 带该标签、被指派给该登录，**或**（当该行打开「收无指派」时）一个指派人都没有时，就会成为看板卡片——在指派栏填 `@me` 即可跟随你自己的指派，不必再给 issue 打标签；对从不指派的仓库，点该行的「收无指派」按钮即可连未分配的 issue 一起收。
3. **测试连接**：卡片会报告认证到的账号，并逐个仓库给出是否可达、有多少个带纳入标签的 open issue。
4. **按需选择网络代理**：机器不能直连 GitHub 时，用「网络代理」小节在三种模式之间切换，`custom` 模式下还会出现地址输入框。下面那一行会说明请求实际会连哪条代理、来源是什么，所以「自动模式找到了系统代理」会明确写出来，而不是静默直连。详见[网络代理](#网络代理)。

也可以把这件事交给 agent：`task_board_github_setup` 负责存取/清除凭据并跑连接测试，`task_board_github_repositories` 负责列出、添加、移除与修改仓库。注意：作为工具参数传入的令牌会成为该次会话记录的一部分，能打开设置卡时优先用设置卡。

## 配置

| 键 | 默认值 | 行为 |
| --- | --- | --- |
| `enabled` | `true` | 扩展总开关；设置卡就地写入该字段，两侧半区即时跟随。 |
| `announceToAgent` | `false` | 需要时开启：开启后扩展向 agent 系统提示注入自身公告。 |
| `tokenEnv` | `GITHUB_TOKEN` | 令牌解析所用的凭据引用名：凭据库里的存储名，或存放它的环境变量名。 |
| `proxyMode` | `auto` | 宿主访问 GitHub 的方式：`auto` 跟随常规代理环境变量、再读系统代理，`custom` 固定使用 `proxyUrl`，`direct` 永不代理。详见[网络代理](#网络代理)。 |
| `proxyUrl` | `''` | 自定义代理地址，仅 `custom` 模式读取；缺协议会自动补 `http://`。 |
| `repositories` | `[]` | 需要同步的仓库，每项含 `owner`、`repository`、`inclusionLabel`、`assignee`（`@me` 表示本机账号）、`includeUnassigned`（是否连无人指派的 issue 一起收）、`managedLabelPrefix`、`stateLabels`、`prPhaseLabel`、`pollingIntervalMs`、`prCreationEnabled`、`draftPrPolicy`、`closeIssueOnMerge`、`baseBranch` 与 `analysisModel`（AI issue 分析使用的 `provider/model`；留空则依次回退到卡片钉住的模型与宿主默认模型）。 |

这些键都是 volatile 字段，这正是设置卡、配置工具与 profile patch 都能写入它们的原因：保存后的改动无需重挂载插件行就能到达正在运行的提供方。卡片自身渲染凭据状态、仓库列表与连接测试，数据来自本扩展自己的宿主路由，而这些路由只服务 loopback 请求。运行中的提供方仍会把只读摘要（已配置仓库与凭据有无）发布到看板状态通道，卡片在宿主路由不可达时回退到它。

## 网络代理

宿主访问 `api.github.com` 时走三种模式之一。设置卡里有一节「网络代理」，两个键都在那里就地写入；profile patch 也可以直接声明：

| 模式 | 行为 |
| --- | --- |
| `auto`（默认） | 先读 `HTTPS_PROXY` / `https_proxy` / `ALL_PROXY` / `all_proxy`（`http://` 基址用 `HTTP_PROXY` / `http_proxy`），再读操作系统自己的代理（Windows 经 `reg query` 读注册表，macOS 用 `scutil --proxy`），两者都没有时直连。 |
| `custom` | 始终连 `proxyUrl`。缺协议自动补 `http://`，所以直接把 `127.0.0.1:7890` 填进去即可；`proxyUrl` 为空不构成决定，该模式回落到 `auto`。 |
| `direct` | 永不代理，即使环境变量或系统代理点名了一条。 |

`NO_PROXY` / `no_proxy` 对三种模式都生效，可逐条带 `:端口`。只支持 `http` 与 `https` 代理：填 `socks://` 会带原因被拒、请求改为直连，因为本扩展的传输就是 `node:http` 上的 `CONNECT` 隧道，而 SOCKS 代理需要另一套握手。卡片会显示请求实际会连的代理及其来源（`环境变量`、`系统代理`、`自定义`），所以「自动模式读到了系统代理」是看得见的，而不是靠猜。

```yaml
- id: web-ui-task-board-github
  name: '@linxin666/dsh-client-ui-task-board-github'
  config:
    proxyMode: auto    # auto | custom | direct
    proxyUrl: ''       # 仅 custom 读取，例如 http://127.0.0.1:7890
```

两个键都是 volatile 字段，因此在卡片里改动会作用于下一个请求，无需重启。系统代理探测结果缓存 30 秒，任何失败都读作「没有系统代理」：探测可以丢掉代理，但绝不丢掉请求。

## 从看板行迁移

迁移之前，GitHub 相关设置位于任务看板自己的插件行上，键名为 `githubTokenEnv` 与 `githubRepositories`。任务看板已不再声明它们：仍携带这两个键的 profile 不会报错（看板 schema 对未知键透传），但取值会静默失效，因为已经没有代码读取它们。

请把两个键移到本扩展行并改名：

```yaml
- id: web-ui-task-board-github
  name: '@linxin666/dsh-client-ui-task-board-github'
  config:
    tokenEnv: GITHUB_TOKEN        # 原为看板行的 githubTokenEnv
    repositories:                  # 原为看板行的 githubRepositories
      - owner: deepseek-ai
        repository: dsh
        inclusionLabel: dsh
        prCreationEnabled: true
```

开关默认值（`enabled: true`、`announceToAgent: false`）两行一致。

## 已知限制

- 每条仓库配置必须同时给出 `owner` 与 `repository`；无效条目会让该行激活失败，而不是静默跳过该仓库。
- 扩展只在任务看板已安装且启用时才产生贡献；单独使用时它只配置 GitHub 访问，别无其它行为。
- 关闭扩展不会删除此前同步到看板的卡片，因为账本归看板所有。
- 轮询间隔为 `0` 的仓库只按需同步（手动刷新、列变化或执行结算），不会挂定时器。
- **同步停滞现在会自己暴露。** 每一次对 GitHub 的请求都有 30 秒上限（`GitHubTimeoutError`），一次挂起的请求不再能把整轮同步永久卡死；重入保护是一个时间戳而不是布尔量，一轮超过一个轮询间隔还没结束会被判定为卡死并由下一轮接管，而不是让之后每一次轮询都在第一行直接返回。后台轮询的任何失败与每轮收集到的错误都会写入宿主日志（`[dsh-task-board-github] ...`），**不再被 `.catch(() => {})` 静默吞掉**。设置卡顶部会显示「后台同步」一行：最近一次成功同步的时间、停滞多久、以及上轮的错误条数；超过三个轮询间隔没有成功同步即标为「已停」。
- **经代理访问 GitHub 是一项配置，传输层会照做。** `proxyMode` 决定三种方式之一：跟随环境变量与系统代理（`auto`，默认）、固定一条 URL（`custom`，也接受不带协议的 `127.0.0.1:7890`）、永不代理（`direct`）；`NO_PROXY` / `no_proxy` 对三者都生效并支持逐条 `:端口`，`https` 目标用 `CONNECT` 建隧道。只支持 `http` / `https` 代理，因此「只有 SOCKS」的配置会解析成直连并给出点名该协议的原因。详见[网络代理](#网络代理)。传输层失败（DNS、TCP、TLS 或被代理拒绝）对幂等请求（`GET`、`HEAD`、`PUT`、`PATCH`、`DELETE`）会用新连接重试一次，之后抛出 `GitHubTransportError`，报出端点与具体原因，而不是 undici 那句干巴巴的 `fetch failed`。`POST` 只发一次：连接可能在 GitHub 已经接受写入之后、答复读到之前断掉，重发会把同一条评论贴两遍。若希望宿主全部请求都走代理，也可以用 Node 自带的 `NODE_USE_ENV_PROXY=1`，本插件不依赖它。
- 列表调用取 `state=all&per_page=100` 的**第一页**，不翻页。仓库的 issue 超过 100 条时，只有最新的 100 条参与判定；更早的 issue 只有在被单条补拉（且仍符合纳入条件）时才会被看到。

## 构建与测试

需要 Node 22.19 或更高版本与官方 NPM SDK 包；不使用任何 DSH 源码 checkout。

```sh
pnpm --filter @linxin666/dsh-client-ui-task-board-github typecheck
pnpm --filter @linxin666/dsh-client-ui-task-board-github test
pnpm --filter @linxin666/dsh-client-ui-task-board-github build
```
