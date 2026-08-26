# Agent Note: 恢复旧版 Workshop 皮肤安装的 hooks

Status: implemented

## 问题

在安装器开始写入 `dsh-market.provenance.json` 之前由 Workshop 安装的皮肤，会在升级后继续保留于 `$DSH_HOME/skins/<id>/`，并覆盖仓库目录中的同 id 皮肤。hooks 信任门会正确拒绝缺少 provenance 的用户目录皮肤，但也因此禁用了这些历史安装中的已审查效果。Matrix 仍保留声明式深色配色，但其 `hooks.mjs` 请求返回 403，数字雨画布与强制深色生命周期都没有挂载。

## 决策

皮肤中心携带一份生成的 sha256 注册表，覆盖仓库中每个声明 hooks facet 的已审查皮肤。有效的官方市场 provenance 仍是首选信任路径。provenance 缺失或无效时，只有当用户目录皮肤的 id、声明入口路径、完整 `skin.json` 字节和 hooks 字节全部匹配同一个生成的已审查身份时，才允许恢复 hooks。该回退完全只读：不写 provenance、不下载内容，也不替换用户目录。`scripts/skin-hooks-registry.mjs --check` 与 `skin-center:check` 会在已审查 manifest 或 hook 改动后拒绝注册表漂移。

## 考虑过的替代方案

否决了自动从 dsh-market.com 强制重装缺少 provenance 的皮肤，因为它依赖网络并会静默替换本地文件。否决了仅凭仓库中存在同 id 就信任，因为手工投放目录可以复用该 id 并携带任意可执行 hooks。也否决了只校验 hook 哈希，因为被改写的 manifest 可以重新指向入口或改变声明契约；manifest 与入口字节必须共同匹配已审查身份。

## 影响

历史官方 Workshop 安装无需修改文件或访问网络即可恢复已审查的 hook 效果。改名、manifest 被修改或 hook 被篡改的目录仍然 fail-closed；声明式 CSS 与资产不属于该可执行身份，仍可保留本地定制。路由会在每次 hooks 请求时重新校验当前字节，因此缓存的 catalog 无法在篡改后延续信任。新的 Workshop 安装继续使用 provenance；维护者修改带 hooks 的皮肤后必须重新生成已审查注册表。Matrix 修复已在真实 GUI `http://127.0.0.1:3080` 验证：1440 x 900 的 fixed 画布以 0.1 透明度挂载，强制深色标记，并包含已渲染的绿色字符像素。
