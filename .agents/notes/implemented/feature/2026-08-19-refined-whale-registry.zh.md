# Agent Note: Refined whale registry integration

Status: implemented

## Problem

宠物注册表此前只暴露一个 whale-girl 立绘变体，精修版立绘在宠物设置选择器中没有可到达的条目。

## Decision

将精修版 whale-girl 立绘作为 `@linxin666/dsh-pet` 的内置条目 `whale-girl-refined` 发布。既有 `whale-girl` 条目保持默认，并在选择器中标注为原始变体。

## Constraints

- 宠物选择保持在既有 registry 与 `pet` 设置命名空间内。
- 本次贡献不新增第二个宿主服务、浏览器挂载、持久化文件、API 族或 profile patch 写入器。
- 既有的 loopback 路由围栏与 `mountOnce` 所有权仍是唯一的安全与生命周期路径。
- 单独安装 `@linxin666/dsh-pet` 即同时提供两个变体；设置选择器的列表来自 `/api/pet/pets`。

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->

## Source record

精修版图集是基于 whale-girl 设计方向的 AI 辅助衍生作品。其 DreamSkin 参考来源、原项目链接与历史来源记录见包 README 配对文档。
