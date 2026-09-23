# Agent Note: 使用统计区可恢复的停用态

Status: implemented

## Problem

用户从 `@linxin666/dsh-usage` 自己的设置区里关掉插件后，会把自己锁在外面。`enabled: false` 时宿主的
`rearm()` 会注销 `/api/dsh-usage/overview` 与 `/api/dsh-usage/refresh`，但浏览器半区仍按 10 秒轮询这条
已不存在的路由，每次都拿到 404。失败分支把这个状态替换成写死的 `usage.overview transport error`，
而 `UsageSectionCard` 开头就是 `if (ui.status === 'error') return <div .../>`——这个整面板 return 位于
设置行**之前**。启用开关就在那一行里，于是唯一的退路是手工编辑 `settings.yaml`（#1500，是 #1294 的
回归）。

## Decision

1. 设置行在所有非就绪状态下都照常渲染——停用、失败、加载中——状态行只是与它并列，不再替换它。因此
   启用开关始终可达，勾选它就是恢复路径。
2. `enabled` 直接取自卡片本来就持有的 settings scope（`settings.getSnapshot().value`），卡片同时订阅
   该 scope，使写入能触发重渲染。停用期间轮询 effect 在发出第一个请求前就返回，因此停用的插件完全
   没有后台流量。
3. 传输失败把自身消息写进 store（`usage /api/dsh-usage/overview failed: 404`），不再使用固定文案，
   于是"路由已注销"与"真实故障"可以区分。
4. 新增文案键 `usage.disabled`（包内 zh/en，`dsh-i18n` 镜像 ru）。

## Verification

- `pnpm --filter @linxin666/dsh-usage test`：8 个文件、102 条测试通过，其中三条为新增——停用态渲染
  提示且从不调用 `poll`；重新启用后调用一次；失败态保留复选框并显示真实消息。
- `pnpm --filter @linxin666/dsh-usage typecheck`：通过。
- `pnpm i18n:check`：通过（zh/en/ru 键集一致，注释外无 CJK）。

## Alternatives considered

让宿主通过新字段把 `enabled` 下发到浏览器半区被否决：卡片本来就持有 settings scope，该标志无需扩大
宿主面即可获得。

停用期间继续显示最后一次成功的快照被否决：宿主已注销路由，保留的文档只会变陈旧，展示过期余额比明确
说明插件已关闭更误导。

保留整面板错误、另加一个"重新启用"按钮被否决：造成该状态的开关就在同一面板里，为一个布尔值再放一个
控件只会带来漂移。

## Consequences

停用的插件既安静又能从 UI 恢复，错误行会给出真实故障。停用提示是三种语言的新用户可见文案。错误行仍
显示传输层自身的（英文、技术性）消息而不是本地化句子，因为可操作的信息是状态码本身，只有外层标签做了
本地化。
