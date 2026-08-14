# @deepseek-ai/dsh-attachment

English | [中文](README.zh.md)

The durable attachment seam. `ctx.attachments` validates and atomically commits immutable image bytes, then returns a serializable `ImageAttachmentRef`; consumers never persist browser paths, object URLs, provider URLs, or base64 in session events.

Unsent composer images remain browser-owned temporary drafts. `validateImage` runs the same admission policy without persisting; batch writers validate every member first so a malformed member cannot strand earlier members as unreferenced objects. `saveImage` commits each accepted image before any model-visible session event is published, and `readImage` verifies the content-addressed object against its logged metadata. Callers may cancel `readImage`; implementations observe cancellation around backend and verification work and preserve it instead of translating it into a storage failure.

## Model Experience

Indirectly, through the role-neutral core `ImageBlock` and provider adapters that resolve its durable reference.

#### KV Cache effect

Adding an image changes the provider request and therefore invalidates the affected request suffix.

## Known Limitations and Deferred Work

- Version one accepts PNG, JPEG, WebP, and GIF only.
- Retention and garbage collection are deferred because resumed and forked sessions may share immutable objects.
- Generic files, audio, video, and persistent unsent drafts require separate lifecycle and provider contracts.
