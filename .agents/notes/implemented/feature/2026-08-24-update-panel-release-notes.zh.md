# Agent Note: 可读的更新发布说明

Status: implemented

## Problem

remote-web-ui 的自动更新面板会把所有 registry 管理的家族组件显示成一长串 `@linxin666/dsh-*` 包名和版本行。技术上准确，但用户难以判断是否开始升级；项目本身已经发布按功能/修复/其他分组的中英 GitHub Release 说明。

## Decision

更新状态现在携带从目标 GitHub Release（`zhu1090093659/dsh-web`）获取的结构化说明，解析为「新增功能 / 修复 / 其他改动」三组。面板默认展示这些分组，并把精确的组件版本列表放进一个折叠的 details 块，供需要核对版本映射的用户查看。registry 失败时仍然回退到包列表；host 端缓存 GitHub 响应十分钟，避免侧边栏静默探测和面板打开时重复请求 GitHub API。

## Alternatives considered

- 只保留包列表：否决，只有版本号不能说明本次改了什么。
- 直接渲染 Markdown 原文：否决，面板不引入 Markdown 渲染器，使用纯文本条目。
- 只在面板打开时才获取说明：否决，会导致状态接口再拆一层；host 缓存已经限制重复请求。

## Consequences

- 默认升级体验改为说明优先；组件版本仍隔着一次点击可用于排查。
- GitHub 不可达或 Release 尚未发布时，面板回退到原有包列表。
- 更新流程、pnpm 复核和仅 loopback 安全围栏保持不变。
