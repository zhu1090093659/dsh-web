# Agent Note: GitHub Issues as Task Board work items with controlled write-back

Status: implemented

有界的入站关闭/重开扩展归 [GitHub remote close cycles](2026-10-31-task-board-github-remote-close.zh.md) 所有；它部分替代本 Note 此前只由本地决定列的选择，Issue 发现、标签、凭据与 PR 生命周期仍归本 Note。

## Problem

外部研发团队通常在 GitHub Issues 上追踪需求与可交付物，但此前使用本地 DSH 智能体执行这些任务需要在不同浏览器标签页间手动复制 Prompt 文本并同步状态。若在 GitHub 与自主智能体之间引入无约束的双向同步，将带来严重的安全与稳定性风险：不可信的外部 Issue 文本可能实施 Prompt 注入或提权会话权限，API 限流或网络故障可能导致正在运行的本地智能体执行中断，而不加控制的标签同步可能会覆盖用户的自有标签或导致意外关闭 Issue。

## Decision

在 DSH 任务看板中实现基于 Host 端的 GitHub Issue 同步机制，作为可选的外部提供方扩展（`packages/dsh-task-board-github`），数据载于看板不透明的 `TaskRecord.integrations` 容器中扩展自持的 `github` 键下：

- **入站发现**：两条通道任一命中即选中 issue——带配置的包含标签（默认 `dsh`），或被指派给该仓库配置的登录（`@me` 解析为宿主认证的账号）。选中的 issue 物化为本地任务卡片，或通过不可变身份三元组 `{ owner, repository, issueNumber }` 与既有卡片对齐；两条通道都不再命中时停用对应卡片。
- **本地权威状态机**：既有的五列看板状态机保持唯一权威。`running`（进行中）状态始终为 Host 本地状态。GitHub 状态标签（`dsh:state:*`）是对外状态投影，而非第二状态机。
- **受控回写**：回写操作仅严格增删 DSH 所属的状态与阶段标签（`dsh:state:*`、`dsh:phase:pr`）。无关的用户标签（如 `bug`、`security`、`priority:high` 以及包含标签本身）绝对不修改或删除。
- **执行不可变性**：远程 Issue 标题和正文仅在任务首次开启执行前刷新本地 Prompt 和描述。一旦执行尝试开始，远程变更仅作为只读元数据（`remoteTitle`、`remoteBody`）存储，不重写历史执行 Prompt。
- **模板化执行 Prompt**：卡片的 Prompt 不再是 issue 正文。`src/core/prompt.ts` 以 issue 快照与仓库配置为输入、以纯函数生成它：头部写明 issue（引用、链接、仓库自有标签，DSH 自管标签与纳入标签不列出）；固定的执行要求段（先读仓库的 agent 协作说明、在基于 `baseBranch` 的 `issue-<编号>` 分支上实现、运行仓库要求的检查、经 `task_board_github_get` + `task_board_github_comment` 回帖、PR 合并前不得关闭 issue、无需改动时回帖说明后结束而不是制造改动）；issue 正文原样放在最后，包在声明其为不可信内容的 `ISSUE 原文 开始` / `ISSUE 原文 结束` 之内。Prompt 依赖的所有分隔符——这对包裹以及看板自己的 `来源声明` 一对——在 issue 文本与模型文本中都会被化解，二者都无法提前闭合包裹或伪造看板声明。模板与看板 runner 自己的前言一样用中文书写，文件头带 `i18n-allow:` 标记：它是面向 agent 的文本，不是界面文案。
- **手动修改在同步中保留**：扩展保存 `promptHash`，即它最近一次生成的 Prompt 的指纹；同步时只有卡片 Prompt 仍与该指纹一致才重新生成。被人改过的 Prompt 不带指纹，之后每次同步都保留原样。模板出现之前同步的卡片没有指纹：当且仅当其 Prompt 仍等于旧投影复制的原始正文（或标题）时视为未改动，因此这些卡片在下次同步时采用模板，改过的卡片保留文本。
- **可选的 AI 分析，只作为一段**：任务详情席位经看板泛化的 extension-action 通道派发 `analyze`（以及 `clear-analysis`、`move-backlog`）。宿主向可选的 `llm` 服务（按次解析、绝不 inject，经 `prepareCall`，公共 `stream` 作为回退）请求一个四字段 JSON：目标、步骤、完成标准、`needsCodeChange`。issue 以分隔的数据块交给模型且其闭合标签被化解；回复经防御性提取，并由与存储载荷同一个归一化函数重新限界；失败带类型（`no-model`、`model-error`、`parse-failed`、`timeout`）。模型路由依次为：请求所选模型、仓库的 `analysisModel`、卡片钉住的模型、经可选网关 `session/modelCatalog` 读到的宿主默认模型。调用在后台运行，因为它会超过看板 15 秒的 action 通道：校验是同步的（未关联、已冻结、手动修改且未 `overwrite`、已在进行、无分析器），进度与结果写入卡片载荷（先 `analysisPendingSince`，再 `analysis` 或 `analysisError`），提供方启动时发现的进行中标记会被清除，因为它背后的请求随上一个宿主进程一起消失了。存储的分析带 `sourceHash`，即其依据的 issue 标题与正文的指纹；模板只在指纹仍匹配时以「模型生成、未经审查、与原文冲突以原文为准」的横幅渲染它，因此 issue 一改，旧分析无需调用模型就从 Prompt 中移除。卡片开始执行之后才返回的结果只留档，不改 Prompt（看板的内容门禁拒绝该补丁）。
- **无损停用**：移除包含标签仅将本地任务标记为停用并在活动看板中隐藏，保留所有历史执行记录。重新添加标签后通过相同身份恢复。
- **Host 端凭据与出站 HTTPS**：所有 GitHub API 请求均在 Host 端通过出站 HTTPS 发起（`api.github.com`）。Token 从 Host 环境变量或 profile patch 解析，绝不暴露给浏览器或智能体。
- **PR 完整生命周期与安全关闭**：自动创建 PR（默认关闭）或手动创建（`task_board_github_create_pr`）会先校验远程分支存在，再创建 PR、记录 PR 元数据并打上 `dsh:phase:pr` 标签。PR 合并后更新状态为 merged、清除 phase 标签、打上 done 标签，并在配置允许时关闭 Issue；未合入关闭的 PR 绝不关闭 Issue。
- **代理是配置，不只是环境变量**：两个 volatile 键——`proxyMode`（默认 `auto`，或 `custom` / `direct`）与 `proxyUrl`（仅 `custom` 读取）——驱动传输，在设置卡的「网络代理」小节里经同一批 loopback-only 配置路由可编辑，并被计入提供方的挂载键，因此一次修改会到达下一个请求，而不必等重启。`auto` 作为默认值，是因为它不需要配置就是对的。检测是一次带缓存、不抛异常的探测：Windows 用 `execFileSync('reg', ['query', ...])`、macOS 用 `scutil --proxy`，解析函数接收 stdout 字符串，因此解析本身可测而不必真去起进程；结果记忆 30 秒，因为探测是同步的、就压在请求路径上；任何失败都读作「没有系统代理」。解析出的形态就是平台自己的形态，不是自创的：`ProxyServer` 的逐协议列表按 https 优先读取，两个解析器都把「只有 SOCKS」的配置报成 `socks5://`，好让解析层说清它说不出的是什么。`GET /api/task-board-github/status` 与 `GET .../proxy` 返回 `{ mode, url, effective, source }`——解析出的 URL 与来源，绝不含凭据——`PUT .../proxy` 在一次带版本号的批量写入里存下两个字段。
- **故障隔离**：GitHub 网络或接口错误仅在任务元数据中记录 `lastSyncError`，绝不中断或使本地正在执行的任务失败。
- **智能体工具与界面**：扩展经看板的 `registerTool` 能力提供七个受限工具，因此随「看板总开关 × 扩展 enabled」一起收放：五个同步工具（`task_board_github_list`、`task_board_github_get`、`task_board_github_refresh`、`task_board_github_create_pr`、`task_board_github_link_pr`）加两个配置工具——`task_board_github_setup`（凭据状态、存入、清除，以及一次真实连接测试）与 `task_board_github_repositories`（列出、添加、移除、修改仓库）。其浏览器半区遵循同一门禁：在任务详情中渲染 `data-dsh-part="github-integration"` 区域并渲染紧凑的 `#<issueNumber>` 卡片徽章，二者分别注册进看板声明的两个子席位（`task-board.detail.section`、`task-board.card.decoration`）。配置块（`data-dsh-part="github-settings"`）在扩展自己的设置卡中渲染，紧邻决定其行为的开关，且不占看板席位：它经本扩展自己的 loopback-only 配置路由访问宿主，人在界面上做的配置与模型通过两个配置工具做的配置走的是同一条路径。

使这套集成成为扩展而非内联功能的看板侧契约——`taskBoard` 提供方服务、三个子席位、能力面、不透明的 `TaskRecord.integrations` 容器与三态开关——由[任务看板外部提供方扩展契约](../architecture/2026-09-30-task-board-extension-contract.md)持有。该契约部分替代本记录：GitHub 端点相关决策仍归本记录，而本记录曾记载的依赖方向与存储层耦合由该契约取代。

## Architecture and Host-Side Security

所有 GitHub API 交互集中在扩展包 host 半区的 `GitHubApiClient` 与 `GitHubSyncService`（`packages/dsh-task-board-github/src/host/`）。扩展不 import 看板的任何模块：它在自己的 `src/core/contract.ts` 中同形重述提供方契约，并在运行时解析看板的 `taskBoard` 服务。凭据由宿主按固定顺序解析——先 DSH 凭据库（`ctx.credentials`，即 Models 页写入 API Key 的那个库），再 `tokenEnv` 指定的环境变量，最后 `GH_TOKEN`；令牌只经 `src/host/credentials.ts` 写入：设置卡与 `task_board_github_setup` 把令牌一次性 POST 到本扩展的 loopback-only 配置路由，由宿主存入，任何响应、快照或工具结果都不携带它的值。令牌绝不进入前端可观测的存储、设置命名空间，也不跨越 WebSocket/SSE 边界或进入模型可见载荷。远端不可变身份由扩展自己索引——启动时从看板已有卡片建立、并随看板上报的删除而清理；所有任务读写都经能力面（`tasks.*`、`integration.*`），只读发布状态随看板快照的 `extensions` 映射下发，看板始终是内容、列与事件的唯一权威。扩展行自己持有配置（`tokenEnv`、`repositories`）与两个开关（`enabled`、`announceToAgent`）；四个键都标记为 volatile，这正是设置卡、两个配置工具与 profile patch 都能经 `ctx.settings.mutate` 写入、且无需重挂载插件行就能到达运行中提供方的原因。不可信的 Issue 内容隔离在只读字符串元数据字段中，绝不隐式变更权限、工作区、交接包或 promptPrefix；它只在上文所述的模板化来源包裹之内进入执行 Prompt。

出网传输属于 `GitHubApiClient`：`src/host/proxy.ts` 按插件配置（`proxyMode` / `proxyUrl`）解析每一个目标实际要用的代理，而不是只看环境变量；`NO_PROXY`（点名主机覆盖其子域，条目可带 `:端口`）对三种来源都生效，并用 `node:http` / `node:https` / `node:tls` 的 `CONNECT` 请求为 `https` 目标建隧道，因为本包不自带 HTTP 栈依赖。三种模式就是全部：`direct` 永不代理；`custom` 连配置的那条 URL（缺协议自动补 `http://`，空串不算决定，回落到 `auto`）；`auto` 先读常规环境变量，再读操作系统自己的代理——Windows 经 `reg query` 读注册表、macOS 用 `scutil --proxy`、其余平台没有。本传输说不出的代理协议（实际只有 `socks`）不会被抛出，而是作为解析结果上的原因返回：请求改为直连。`GitHubApiClient` 由这次解析构造（`proxyClientOptions`），绝不留给它自己再读一遍环境，因此 `direct` 能压过继承来的 `HTTPS_PROXY`，而检测到的系统代理能在没有任何变量点名它时被用上。传输层失败对幂等方法（`GET`、`HEAD`、`PUT`、`PATCH`、`DELETE`）会用新连接重试一次，之后以 `GitHubTransportError` 抛出，携带端点与传输原因，因此卡片的 `lastSyncError` 会说明坏在哪，而不是 undici 那句干巴巴的 `fetch failed`。`POST` 只尝试一次：传输失败并不能证明请求没到，重发评论或建 PR 会把同一件事写两遍。超时与 API 拒绝同样永不重试：前者已经用满 30 秒上限，后者是 GitHub 已经回答了这个问题。新存入的凭据经 `reloadCredential()` 立刻作用到已挂载的客户端，并丢弃为 `@me` 规则缓存的登录名；否则客户端会继续用上一轮读到的旧 token，操作员换完 token 后立刻发起的写入会带着已失效的凭据，直到下一轮轮询或重启。

后台轮询使用独立的受限定时器（`HostTimerFace`），与现有的 5 秒会话名册心跳解耦，避免 API 配额耗尽并隔离外部网络抖动。

配置路由按源点绝对路径寻址：`GITHUB_SETUP_API_PREFIX` 是 `/api/task-board-github`，因为宿主 web 服务器以原始请求路径名作为路由键，而请求路径名总是从源点根开始。注册键缺少前导斜杠就永远无法匹配任何请求，设置卡于是对一个其实已挂载的部署报出「无法访问本机 Host 配置接口：the Host refused the request (404)」。浏览器半区以文档相对形式调用同一条路由（`GITHUB_SETUP_API_PREFIX.slice(1)`），因此部署在子路径下的界面仍会相对自己的入口目录解析它；`tests/setup-routes.spec.ts` 断言两侧指向同一条路径。

扩展的配置面就是看板自己的设置卡，而不是它自有的卡片：它注册进看板声明并渲染的 `task-board.settings.section` 席位，于是提供方就在它所配置的看板的同一处配置。两条规则保证它始终可达：该区块**不**由扩展自己的总开关门禁——总开关就住在区块里，被开关门禁的区块永远无法把它重新打开；扩展关闭时以说明文案取代仓库/凭据表单。另一个是注册跟随席位的**声明**生命周期（`slots.inject`）而不是一次性注册：看板卡片在插件卡席位之间迁移时会重新声明该席位（启动后家族分组才加载是常态），而重新声明会释放该席位内已登记的全部条目——一次性注册会被静默丢弃，区块从此不再渲染，且没有任何报错。

## Alternatives considered

曾考虑在 GitHub Issue 状态与任务看板列之间实现直接双向镜像（在 GitHub 变更状态直接驱动本地卡片移动，反之亦然）。该方案被否决，因为 DSH 本地任务执行对应真实的智能体运行时会话：外部标签变动不得随意中断或触发本地实际进程，且 GitHub 状态无法表达会话启动、队友生成等本地瞬态过程。

曾考虑将 GitHub 标签直接存储为卡片上的原生 `TaskTag` 对象。该方案被否决，因为 `TaskTag` 具有 8 标签上限且可能向智能体注入执行指令（`promptPrefix`）。将不可信的远程标签当作 prompt prefix 会使外部人员可通过添加 GitHub 标签操纵智能体执行行为，且大型标签集会超出 8 标签上限门禁。

曾考虑在浏览器前端使用用户提供的 Personal Access Token 直接调用 GitHub API。该方案被否决，因为在浏览器内存和前端包中暴露 Token 会造成安全泄漏隐患，且在关闭浏览器标签页时将无法执行后台轮询与定时任务联动。

曾考虑在本地任务执行成功后立即关闭 GitHub Issue。该方案被否决，因为本地代码生成或单测通过并不代表改动已评审或上线；行业规范流程是通过 PR 关联（"Fixes #123"），在 PR 合入后由平台原生关系或受控流程闭环。

把 issue 正文直接作为执行 Prompt 是原先的行为，现已被取代。正文说明了别人想要什么，却没有说明适用哪些仓库约定、如何回报、什么时候算完成，也没有说明这段文本不可信；每次执行都要重新摸索扩展自己的回写工具与「PR 合并后才能关闭」的护栏，而一个仅作通知的 issue 会武装一个目标，agent 随后会为推进它而制造改动。模板以确定方式承载这些事实，并原样保留正文，issue 里说的内容一字不丢。

曾考虑让模型生成整个执行 Prompt，该方案被否决。改写会把注入的文本洗成语气权威的指令，抹掉来源包裹要守住的边界；工作流规则（分支、回写、合并前不关闭）是硬性要求，生成器迟早会漏掉或改写；目标验收裁判读的是同一份 Prompt，模型编造的完成标准会让同一把可能有偏的尺子既出题又判卷；而没有模型的部署反正需要确定性的回退。因此模型只写一段有边界、有标注的内容，绝不取代原样附上的正文。

曾考虑在同步时自动生成分析，该方案被否决。默认每五分钟轮询一次，issue 每改一次就会重新消耗额度，各次输出也不稳定，而在后台变化的 Prompt 没有人审阅。改为在执行时生成同样被否决，因为操作者看不到 agent 实际收到了什么。分析是逐卡、显式触发的动作，结果按 issue 内容缓存，并在卡片运行之前展示。

曾考虑用布尔标记而不是 Prompt 指纹来追踪手动修改，该方案被否决。看板详情表单经看板自己的 update 动作修改 Prompt，没有任何提供方事件会报告它，因此标记永远不会被置位；把当前 Prompt 与生成时的指纹比较，可以在不改契约的前提下识别来自任何入口（表单、agent 工具、账本导入）的修改。

曾考虑把执行 Prompt 做成看板在启动时向提供方索取的运行时段落（新增契约能力），该方案被推迟。它能让模板变更触达尚未运行的卡片，并在执行时拉取最新评论，但需要契约版本升级、看板侧的包裹与截断规则以及一份契约 Agent Note；把组合好的 Prompt 存在卡片上可以保持契约不变，并让操作者在运行前读到确切文本。

曾考虑打包 `undici` 以取得 `ProxyAgent` 调度器，该方案被否决。客户端只收发 JSON——状态码、头部和小体积正文，从不流式传输——所以一条 `CONNECT` 隧道（`http://` 基址再加一条绝对形式请求）就是它需要的全部传输，而 `undici` 会给以单文件发布的宿主半区塞进一整套 HTTP 栈，且在解析不到该包的部署里仍然不可用。只依赖 `NODE_USE_ENV_PROXY` 也被否决，理由不同：它在进程启动时读取，运行中的宿主不重启无法采用，插件也无法为自己所在的进程设置它。选择「只重试一次」而不是无界退避，是因为一轮同步会发很多串行请求，卡死的连接不该把整轮成本成倍放大；一次新连接已经覆盖了实际观察到的失败——宿主空闲期间套接字坏死，下一个请求继承了它。

`auto` 去读操作系统代理（而不是只看环境变量）来自一次实际故障，而不是偏好：机器上配着系统代理（Windows 注册表的 `ProxyServer`，`127.0.0.1:7890`），而任何地方都没有 `HTTPS_PROXY`，于是每一次 GitHub 请求都走直连、在传输层失败，同时新起的 CLI 却工作正常。只读环境变量对桌面应用是错误的默认值：桌面上的代理通常在系统里配一次，不会被任何进程继承。

把探测结果缓存 30 秒而不是每个请求探测一次，是因为探测是一个同步子进程：一轮同步会发上百个串行请求，不缓存就会每请求起一个进程并同时阻塞事件循环。30 秒足够让一轮最多付一次探测成本，又短到打开系统代理的用户不必重启宿主。探测失败与「没有代理」按同样方式缓存，因为绝不能出现的产物是「请求路径知道了 reg 命令不存在」这件事。

只支持 `http` / `https` 代理而不加 SOCKS，是因为传输本身就是 `node:http` 上的 `CONNECT` 隧道与绝对形式请求，而 SOCKS 代理需要另一套握手，那意味着自己写（或打包）一个 SOCKS 客户端。因此「只有 SOCKS」的配置解析为「没有代理」并附上点名该协议的原因，这是诚实的做法，好过发起一次最终以晦涩传输错误失败的新连接。

## Consequences

- 研发团队可在 GitHub 上统一管理需求，同时无缝指派 DSH 智能体执行具体任务。
- 任务看板数据结构保持对非 GitHub 任务的完全向后兼容，无需账本 schema 迁移。
- GitHub 接口故障平滑降级为保留缓存状态并展示重试标记，不干扰正在运行的本地智能体。
- 凭据管理保持在服务端，需通过环境变量或 profile patch 部署，而非前端输入框。
- 卡片的 Prompt 现在比它来源的 issue 正文长数倍，措辞归 `src/core/prompt.ts` 所有；模板变更只会在卡片 Prompt 仍是生成版本时于下次同步触达它，永远不会触达已执行过的卡片。
- AI 分析消耗部署自己的模型额度，每次显式请求一次；没有模型服务的部署保留模板化 Prompt，并带原因拒绝请求。模型调用本身在 `tests/issue-analysis.spec.ts` 中针对注入的 `llm` 服务替身验证，而非真实模型。
- GitHub 流量跟随机器的代理配置——环境变量、操作系统自己的代理，或设置卡里钉住的一条 URL——并且设置卡会显示请求实际要连的那条代理，因为「自动模式找到了系统代理」否则是完全不可见的。系统代理是从操作系统读取并解析的，不是靠连它来检测：一条已启用但已失效的代理会被报成正在使用的代理，随后失败的传输才是点出它的地方。
- 传输失败会报出端点与原因而不是 `fetch failed`。重试是一次、250 毫秒后在一条新连接上，且只授予幂等方法；超时、API 拒绝、被中止的请求以及所有 `POST` 永不重复，因此一轮同步最多把在套接字层失败的幂等请求的传输成本翻倍，而写入永不会被静默重复。`CONNECT` 分支的覆盖到隧道请求（目标授权与拒绝）为止，不包含完成的 TLS 握手，因为测试是经本地代理跑明文 HTTP，而不是自建一套证书体系。
- 每个 GitHub 工具的返回值都是无损 JSON。宿主运行时会在模型看到成功值之前先做快照，并拒绝任何值为 undefined 的成员；而 JSON.stringify 只是静默丢弃这样的成员，因此仅用 JSON.stringify 自检的投影看起来健康，工具本身却不可用。故缺省的可选成员一律用条件展开省略，沿用 normalizeGitHubMetadata 既有的写法；githubTaskSummary 把远端一半委托给 githubIssueSummary，两个 PR 工具返回的 PR 元数据同样省略缺省的 draft、headBranch、baseBranch 与 mergedAt。tests/tool-output-json.spec.ts 对每个工具断言这条规则，这也正是 task_board_github_list 与 task_board_github_refresh 此前每次调用都直接失败的原因。
