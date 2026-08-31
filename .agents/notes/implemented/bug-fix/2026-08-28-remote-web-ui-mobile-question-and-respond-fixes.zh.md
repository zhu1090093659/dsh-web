# Agent Note: 修复 dsh-remote-web-ui 移动端提问选项渲染与 respond 提交协议

Status: implemented

## Problem

在 @linxin666/dsh-remote-web-ui 移动端（/m/ 页面）中存在两处导致用户交互阻断的缺陷（Issue #1251）：

1. **弱网/兜底轮询下提问选项不渲染**：
   - 手机端 QuestionPanel 依赖扁平的 PendingQuestionItem[] 结构（包含 options 字段）。
   - 在弱网或 SSE 断线触发的 1.5s 轮询兜底中，etchPending 返回的是带有外层 pcId 包装的 PendingQuestionGroup[]（即 { rpcId, questions: [...] }）。
   - ChatView.tsx 直接将嵌套数组传入 setPendingQuestions，导致 q.options 变为 undefined，单选/多选选项区域从 UI 上完全消失。
2. **移动端审批与提问提交协议不匹配（Agent 挂起不解冻）**：
   - 手机端点击审批或提交回答时，发送的载荷为业务载荷（{ sessionId, type: 'approval', approvalId, outcome } 或 { sessionId, type: 'question', answers }）。
   - Host 端 MOBILE_RESPOND_METHOD 原实现直接读取 payload.rpcId 和 payload.response（均为 undefined），导致 piProxy.respond 因未找到匹配项返回 
ot-pending，宿主挂起项从未 resolve，Agent 陷入永久等待。

## Decision

- **展开轮询待决问题**：在 ChatView.tsx 的轮询回包处理中，通过 state.questions.flatMap(group => group.questions) 统一将嵌套结构展开为扁平的 PendingQuestionItem[]，并在 src/mobile/api.ts 中修正 PendingState 的类型契约（区分 PendingQuestionGroup 与 PendingQuestionItem）。
- **Host 侧适配与协议翻译**：
  - 在 src/mobile-api.ts 的 MOBILE_RESPOND_METHOD 分支中，根据 	ype（pproval / question）从 pendingTracker 反查该会话下对应 pprovalId 或包含对应问题 ID 的挂起帧 pcId。
  - 将移动端业务载荷封装为符合 @deepseek-ai/dsh-host-apiproxy 规范的 ApprovalResponsePayload（{ sessionId, approvalId, outcome }）与 QuestionResponsePayload（{ sessionId, answer: { answers } }）。
  - 若无挂起项，安全返回 { accepted: false, reason: 'not-pending' }；若传入传统直传载荷，保持透传兼容。
- **自动化测试防护**：在 	ests/mobile-api.spec.ts 中补充审批翻译、提问翻译及挂起未命中等用例，确保回归防护。

## Alternatives considered

- **修改 PendingTracker 直接返回扁平结构**：否决——pcId 是 Host 侧多路复用与请求生命周期的事实源，若在 tracker 层面抹除 pcId 会破坏其他需要精确定位具体 RPC 请求的场景。

## Consequences

移动端用户在任何网络状况下（无论是 SSE 实时推送还是定时轮询兜底）均能正常看到完整的单选/多选提问选项；提交审批决策与问题答案后能够正确 resolve 宿主端 Promise，Agent 可以无缝继续生成回复。
