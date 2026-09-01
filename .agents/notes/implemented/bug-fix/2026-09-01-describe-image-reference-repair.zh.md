# Agent Note：describe-image 引用转录纠错与注册表回退

Status: implemented

## Problem

纯文本模型调用 `describe_image` 时，把会话消息里的长百分号编码附件引用转录进工具参数。转录不是逐字节精确的：可能在边界处多写或漏写一个结构字符，最坏情况下会整体重建引用。两种失效形态都会让 `describe-image` 即使图片已正确上传也 fail-closed 报 `image is not a valid attachment reference` —— 路径 id 完好、其 sha256 内容寻址字节就在附件存储里。

会话回溯中观察到两种真实形态：

- 损坏的 JSON ref：闭合花括号前多了一个冒号（`"name":"image.png":}`），百分号解码合法但 JSON 非法，`parseImageAttachmentRef` 抛错。
- 重建的 ref：模型把整个 JSON 换成逗号分隔的 token 串（`sha256:...,s,1367,931,image`），`parseImageAttachmentRef` 无法收窄。

## Decision

`dsh-tool-describe-image` 现在容忍单次转录毛刺形态而不放松校验；只有引用真正无法恢复时才降级到路径 id 注册表：

- `parseImageAttachmentRef`（`src/attachment-reference.ts`）在严格 `JSON.parse` 失败后经由 `repairImageRefJson` 重试，只移除无歧义的结构噪声 —— 闭合花括号/方括号前的孤立冒号、双逗号、闭合定界符前的尾逗号、以及逗号前的冒号。每个候选都用 `JSON.parse` 重新校验，随后通过与之前完全相同的完整字段校验（非空 attachmentId、图片 media type、正的字节/宽/高安全整数），所以畸形形态绝不会被当作"已修复"放行。任何规则都修不了的输入仍抛 `ATTACHMENT_REF_GUIDANCE`。
- `parseMarkdownAttachmentReference` 在嵌入 ref 严格+纠错解析失败、或 ref 的 attachmentId 与权威路径 id 不一致时不再抛错，返回 legacy `{ attachmentId }` 形态，让 `vision-client.ts` 走 `ref ?? attachmentRefById(id)` 查注册表。
- `serveRawImage`（`src/attach-routes.ts`）在序列化 ref 解析失败或与路径 id 不一致时不再立即 404，落到 `ref ??= attachmentRefById(id)`。路径 id 被当作权威锚点 —— 注册表以同一个内容寻址 id 为键，因此刚上传过的图片即便 ref 损坏/过期也能解析到正确图片。

`decodeURIComponent` 失败路径（拿不到可用 id）与空 id 路径仍然是硬失败：没有可安全回退的目标。

## Alternatives considered

- **保持 fail-closed 并展示引导信息。** 这是之前的行为，也是观测到的失效形态。它安全但对真实问题不友好：模型无法可靠重转录一条 350 字符的编码引用，单纯重试常常再次失败。
- **一律回退路径 id 注册表、丢弃 ref 元数据。** 在重建 ref 场景下正确，但会丢弃让工具在宿主重启后（短命注册表已驱逐该 id）仍能工作的持久元数据。修复 JSON 能让最常见的单字符毛刺保留这份持久性。
- **机器转录引用而非信任模型。** 超出范围；插件在调用时没有通道看到原始会话文本。

## Consequences

- 模型多写/漏写单个边界字符时，现在能成功拿到图片而不是硬错误；`[image attachment ...]` 与 `ref=` 的持久性保证在修复路径上保留。
- 整体重建的 ref 现在只在 id 仍处于进程注册表（有界 FIFO，容量 128）时成功，否则仍然 fail-closed。这是诚实的上限：重建不保留任何持久元数据，路径 id 在没有存储时无法重新补元数据。
- 对真正畸形或对抗性输入，校验严格性不变：每个修复候选必须通过同样的字段检查，修复不了的输入仍然抛错。
- 改动限于一个包内的三个函数；不触碰 DSH 源码、配置或挂载点。

## Testing

直接针对上游 `src/` 源验证（Node 26 `--experimental-strip-types`，无需私有 cohort tarball）：

- `parseImageAttachmentRef`：合法往返不变；孤立冒号、双逗号、尾逗号形态都修复成相同 ref；不可修复的垃圾与非对象 JSON 仍抛 `ATTACHMENT_REF_GUIDANCE`。
- `parseMarkdownAttachmentReference`：合法 Markdown 返回完整 ref；损坏 Markdown 修复出完整 ref；路径 id 不一致与 legacy 无 ref 都无抛错返回 `{ attachmentId }`；畸形 `%` id 仍抛错。
- 注册表函数（`registerAttachmentRef` / `attachmentRefById`）对照已安装 v0.3.10 副本确认。
- 同样断言已加入包的 vitest 套件（`tests/vision-cache.spec.ts`、`tests/attach-routes.spec.ts`），让永久门禁覆盖新行为。本机无法跑完整 `pnpm test`：这台机器解析不了其 devDependencies 所需的私有 `@deepseek-ai/*` cohort tarball。