# Agent Note：AutoSettingsPanel 的 settings 订阅在 useSyncExternalStore 前先绑定原型方法

状态：implemented

## 问题

v0.3.11 重启后，会话归档设置分区一渲染，DSH web 控制台就记录槽位崩溃：

```
TypeError: Cannot read properties of undefined (reading 'store')
    at getSnapshot (client.js:998)        <- 官方 dsh-client-ui-settings bundle
    at useSyncExternalStore (frontend bundle)
    at AutoSettingsPanel (AutoSettings.tsx:76)
slot entry crashed in 'settings.section'
```

根因：`AutoSettings.tsx` 把 `props.settings.subscribe` 和
`props.settings.getSnapshot` 以裸引用传给 `useSyncExternalStore`。settings
属性是官方 `SettingsScope` 实例，其 `subscribe`/`getSnapshot` 是读取
`this.store` 的原型方法；React 以裸函数形式调用这两个回调，`this` 为
`undefined`，首次 `getSnapshot()` 即抛错。该行是 2026-08-31 的“checkbox
订阅修复”引入的，随 v0.3.11 发布时未做渲染验证，因此所有安装首次渲染该
分区必崩。

## 决策

`AutoSettingsPanel` 现在用 `useMemo` 把两个方法绑定到 scope
（`settings.subscribe.bind(settings)`），钩子标识跨渲染保持稳定（scope
对象本身按 entry 保持稳定，不会反复退订重订）。

对仓库内全部 `useSyncExternalStore` 调用点（doctor、market、pet、
session-id、session-archive、ssh、usage）做了审计：其余 store 全部是闭包
式（`createSnapshotStore` 实例或箭头方法对象字面量），未绑定也安全；settings
scope 是唯一以回调形式传入的原型方法表面。

回归测试（`tests/auto-settings.spec.tsx`）用刻意做成原型方法形态的 scope
假体渲染面板，并用前提守卫断言该假体的脱离调用确实会崩——钉住绑定所保护的
官方 scope 语义。

## 后果

- 分区正常渲染，checkbox 保持响应（2026-08-31 修复的原始目标得以保留，
  且不再崩溃）。
- 重建后的 `lib/client.js` 经 link profile 按请求 serve，修复刷新页面即
  生效，无需重启宿主。
- 同一次启动控制台还暴露了与本题无关的第三方
  `@eddyskywalker/dsh-chatgpt-subscription@0.1.36` 未捕获错误（其
  `codex-subscription-quota` entry inject 调用
  `ctx.modelDirectories.directoryFor()`，alpha.3 宿主更严格的 inject 作用
  域守卫拒绝未声明的 `remote.session` 读取）。该插件不属于本仓库；处置方式
  是从 live profile 移除其 bundle 行并重启，或等上游发布兼容 alpha.3 的版本。
  此处仅记录诊断结论。

## 验证

- `pnpm vitest run tests/auto-settings.spec.tsx`：2 项通过。
- 包级 `pnpm test`：9 个文件、79 项测试通过；`pnpm typecheck` 干净。
- 仓库级 `pnpm typecheck`：全部包 Done。
- `tsdown` 重建 `lib/client.js`（被 serve 的 bundle）完成。
