# Agent Note: Team collaboration extension for the task board

Status: implemented

## Problem

DSH 任务看板是单机、单写入者的 Host 账本，没有「人」这个概念。remote-bridge（[remote bridge protocol v1](../architecture/2026-10-16-remote-bridge-protocol-v1.zh.md)）的每台配对设备对应一条公钥记录，所有调用都以同一个 owner peer 的身份发出；看板只有执行记录上的 `initiatedBy`，没有负责人。在 2 到 5 人的小团队里，每个人都有自己的 DSH 和 Agent，但缺少一个共享的协作面，让 human team 和 Agent team 能互相分派、求助、审阅。参考对象是 Linear。

## Decision

团队协作为任务看板提供多 Host 共享的外部协作面，核心实现包含云端中枢、Host 插件、移动入口与看板契约扩展：

1. **拓扑与部署**：多台 Host 接入云端中枢 team-hub。team-hub 是一个 Go 服务加一个 SQLite 文件，监听 loopback、由终止 TLS 的反向代理前置、由 systemd 保活，不依赖 Cloudflare。每个团队的实时 WebSocket 推送与串行写入由一个进程内 channel 承担，重放缓冲区在内存里，进程重启后客户端会重新同步。测试跑的是真进程：临时 SQLite 文件加临时 loopback 端口上的真 HTTP 监听。
2. **协议与契约样例**：通信协议规格固化在 `team-hub/PROTOCOL.md`（版本 1.0.0）。Host 侧的请求与响应样例存放于 `team-hub/contract/`，插件的假中枢与测试读同一批文件，任一侧的改动没有反映到样例里就会让测试变红。插件测试中将 hub 侧接口样例（如 `hub.bootstrap`）单列记录，Host 运行时永不调用它们。
3. **初始化引导端点**：提供 `POST /api/v1/bootstrap` 端点，仅在 `teams` 表为空时可用。端点比对 `X-Bootstrap-Token` 请求头与 Worker secret `BOOTSTRAP_TOKEN`，用于在全新部署的 hub 上按邮箱创建首个团队与管理员；一旦首个团队创建成功，端点立即自然失效（返回 409）。
4. **分权与看板扩展**：team-hub 是协作字段的权威（issue、负责人、包含 `in_review` 在内的协作状态、评论、活动流、待答问题）；执行卡片的 Host 是执行权威（会话、执行过程与执行判定；看板自动验收已于 [2026-11-11](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.zh.md) 移除）。扩展插件 `@linxin666/dsh-task-board-team`（`packages/dsh-task-board-team`）依照看板扩展契约（[task board extension contract](../architecture/2026-09-30-task-board-extension-contract.zh.md)）作为外部 provider 接入，看板核心列和账本结构保持不变。本地卡片通过 `integrations` 不透明载荷镜像 hub 上的 issue，执行结算后再回写到 hub。看板扩展契约（`TASK_BOARD_API_VERSION = 1`）新增两项可选能力：`followUp`（向卡片当前或最近执行会话投递后续消息）与 `rework`（复用会话重跑已执行卡片）。
5. **身份与凭据托管**：人类成员使用 GitHub OAuth 登录（Web 端与 iOS 端），管理员按 GitHub 用户名邀请成员；每台 Host 凭管理员签发的 Host Token 注册为执行节点。Host Token 保存在 `hostTokenRef`（默认 `DSH_TEAM_HUB_TOKEN`）指名的配置项中。当前部署环境无凭据服务（profile 中未挂载 `@deepseek-ai/dsh-credentials` provider），因此插件设置中的「粘贴 Host Token」呈只读状态，Host Token 只能来自 `hostTokenRef` 指名的环境变量。
6. **负责人与认领闸门**：负责人支持人类或 Agent。每个 Agent 成员（来自 dsh-agents 成员定义）绑定在某位人类成员的 Host 上，由该 Host 领取并附带租约执行。Host 离线时卡片在 hub 保持「等待执行节点」，绝不迁移给其他 Host。Host 设有前置认领闸门：没有可用运行工作区时不认领 issue，并只在状态中报告一条可见问题；生效工作区按「配置 `workspaceId` → agent 绑定的 `team.workspaceId` → 空」顺序解析。无工作区的镜像卡无法启动执行，会导致 hub 侧 issue 永久处于 `running` 状态。
7. **求助路由与权限围栏**：`ask_user_question` 类的决策问题以及「卡住、需要输入」的信号，经 hub 推送给卡片的人类负责人或审阅人；工具权限审批严格保留给执行该卡片的 Host 本机主人。多处可答时以首个回答为准。Host 侧通过接入进程内 approval 瀑布，仅认领与团队卡片关联会话中的「问题」，不认领工具权限审批。
8. **人审与返工循环**：本地执行自身判定成功后，hub 状态流转至 `in_review`，审阅人批准后才进入 Done；审阅打回时，评审评论作为返工指令，在同一个会话中通过 `rework` 重新执行（`reuseSession`）。本地看板列维持原有封闭集合，`in_review` 仅存在于 hub。
9. **评论与交互工具**：`@` 某个 Agent 的评论，作为后续消息经 `followUp` 投递进其执行会话；Agent 通过扩展契约注册的新工具 `team_comment` 发送评论。全部活动均记入 hub 活动流。
10. **移动端入口**：Whale App（Remote 工程）作为人类成员的主入口，提供收件箱、指派、评论、审阅与答题能力。App 直连 team-hub（HTTPS + WebSocket，GitHub 登录），推送由中枢自己调用 APNs 发出。原有经由 Tailscale 和 bridge 直连自身 Host 的通道保持运作，用于观察会话与审批权限。
11. **规划层非目标**：Project、Cycle、Triage、估点等规划层功能不纳入第一期范围，保持系统边界精简。

## Alternatives considered

**共享单台 Host**：被拒，因为团队成员需要在各自机器上用各自的仓库、本地配置和 API Key 跑 Agent；单台共享 Host 无法满足不同成员的本地开发环境与专属配置需求。

**每台 Host 用 CRDT 复制完整账本**：被拒，因为这需要重构看板账本结构、编写复杂的冲突合并逻辑，会打破保证本地确定性一致性的单写入者不变量。

**在线 Host 池化抢单**：被拒，因为不同机器之间的执行环境（依赖、工具链、代码检出）差异巨大，且任务被任意在线节点抢占会导致 API 费用归属模糊。

**允许队友审批工具权限**：被拒，因为工具执行直接作用于本地机器及其沙箱环境与宿主访问；允许远端队友审批本地工具权限越过了本机执行的安全边界。

**邀请码加设备密钥的自建身份**：被拒，因为自建身份需要从零实现账户恢复、设备注销与多设备身份同步逻辑，不仅带来额外维护负担，安全性相比 GitHub OAuth 也没有优势。

**可自部署的 Node 服务**：被拒，因为同时维护 Node.js 服务端技术栈与边缘无服务器部署会带来双重运行时维护开销；统一到 Cloudflare Worker、D1 和 Durable Object 能保持运维脚手架单一。

**跳过 `in_review` 人工审阅直接进 Done（以及设计时曾讨论的人审与原自动验收二选一）**：设计时被拒，因为执行成功后的协作签收归人类审阅者拥有（看板独立的自动验收门已于 [2026-11-11](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.zh.md) 移除，现由执行自身的成功判定直接进入 `in_review` 待审）。

**评论只在人之间流转**：被拒，因为这会失去人与 Agent 协同的交互落点；把 `@` 评论作为后续消息投递给 Agent，并让 Agent 能够发评论，是人机协作闭环的核心。

## Consequences

- 端到端协作流落地：支持人类成员建卡、指派给远端 Agent、Host 带租约认领、本地镜像卡自动执行与判定写回、进入 `in_review` 待审、人工打回返工或批准进入 Done，全流程生命周期事件、提问与评论记入 hub 活动流。
- 权限与安全边界隔离：工具权限审批严格保留在执行 Host 本机，绝不跨机器或经 hub 发往远端成员；即便远端成员拥有审阅或提问回答权，也无法越权审批本地工具操作。
- 认领闸门保证执行可达性：缺少生效运行工作区时 Host 拒绝认领 issue 并上报明确问题，杜绝了无工作区镜像卡无法启动而导致 hub 侧 issue 永久挂起在 `running` 的异常状态。
- 凭据隔离与无凭据服务环境适配：Host Token 不在看板快照或摘要中暴露；在缺失 `@deepseek-ai/dsh-credentials` provider 时，设置面板保持只读，凭据完全依赖环境变量注入。
- 网络与部署边界固定：服务入口限定在 `workers.dev` 域名，避免与 `dsh-market.com` 通配路由冲突；本机 curl 探测需走本地代理，而 Host 的 Node 运行时正常直接访问。
- 上下文与载荷开销可控：`team_comment` 工具模式精炼，仅在发生 `@` 评论与决策求助时按条向会话追加后续消息；每张镜像卡仅在本地看板快照中增添一份不超过 64 KiB 的不透明 `integrations` 载荷。
- 离线韧性：Host 离线时对应卡片在 hub 呈现等待执行节点，不发生跨节点迁移抢单，等待原 Host 恢复上线。
