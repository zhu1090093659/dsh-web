# Agent Note: 评审后按描述符修正 0.1.2 线契约

Status: implemented

## Problem

对 0.1.2-alpha.1 迁移的一次以缺陷为先的审查（证据归档于 docs/archive/2026-09-remote-web-ui-sdk-0.1.2-review-notes.md）证明：多个调用点编码了生成的描述符表中并不存在的线契约，而测试替身共享了同样的错误假设，因此所有门禁在静默坏死的路径上全绿：session/list 以 {request} 调用，但其唯一参数的线键是 _request（task-board 结算循环坏死、手机端会话列表坏死）；directoryPicker/list 被发送 {request: body}，但它声明的是一个扁平可选 path（手机端目录浏览坏死）；业务错误码从 error.code 读取，但 TypertRemoteFailure 把错误码放在 error.failure 上（paired-model-catalog 以 502 应答而非 409/422）；CardForm.save() 把 scope.mutate 的 resolve 当作成功，但 0.1.2 的 scope 在拒绝时会先恢复重载再 resolve（被拒绝的保存丢弃了用户草稿）；git-graph 假定 ISessions.create 会导航，但只有 open() 负责选中（worktree 会话被不可见地创建）；手机端历史分页因 beforeSeq 从不前进而重复同一页。

## Decision

所有被修复的调用点现在都按描述符线布局组装网关参数，测试替身编码同一份描述符表，使漂移在测试中失败：dsh-task-board 与 dsh-remote-web-ui 通过 invokeWireArgs() 助手路由调用（session/list -> { _request }，directoryPicker/list -> 扁平可选 path，agentPresets/list 与 session/modelCatalog -> {}，其余 -> { request }），测试替身（packages/dsh-remote-web-ui/tests/wire-gateway.ts 与 task-board host-runner 的假网关）像网关的 assertExactArguments 一样拒绝多键/缺键。remote-web-ui 的 BFF 先从 error.failure 提取业务失败，再回退 error.code；paired-model-catalog 按真实线码映射（settings-conflict -> 409，settings-rejected -> 422），不再依赖消息正则。CardForm.save() 保留单次原子 mutate，但在其结算后逐条读回快照判定（set：用户层持有该值；unset：字段消失；任一未落地则整体失败并保留草稿），同时仍然捕获桥接 scope 的拒绝异常。git-graph 对 create() 返回的 SessionId 调用 open()。手机端 sessionHistory 通过把 beforeSeq 推进到已累积的最旧 seq 向后翻页，按 seq 去重、升序应答，并透传开场 projections 基线；session.list 行重新携带 projections，session/models 把目录的 default 映射为 current。

## Alternatives considered

运行时读取 SDK 包内的描述符表来决定参数布局被否决：描述符是 SDK 的生成产物，运行时读取会把插件启动耦合到 inject 契约刻意隐藏的 SDK 内部；转写常量加描述符忠实的测试替身能在测试期抓住漂移。用 revision 递增启发式判定 secret 写入被否决：dsh-settings 只在原始 section 变化时递增 revision，重复输入相同 secret 会把成功误报为失败；secret 的 set 按结算判定（已在代码注释记录）。恢复逐字段 set/unset 写入而非读回判定被否决：那会放弃 0.1.2 mutate 契约提供的原子跨字段校验。

## Consequences

线契约漂移在两个网关消费包中现在都是测试失败事件；task-board 新增的诊断会在吞掉网关异常前输出日志，不再静默。仅含 secret set 的保存批次仍无法感知 Host 拒绝，因为 Host 在所有线视图层剥离 role('secret') 字段且快照不暴露 secrets sidecar；根治需要上游 SDK 改动。手机端修复在重建产物被服务（重启 DSH）后才生效。完整审查证据见 docs/archive/2026-09-remote-web-ui-sdk-0.1.2-review-notes.md。
