# Agent Note: 恢复 dsh-web-all 默认启用 dsh-ssh 并优化 404 错误提示

Status: implemented

## Problem

升级 @linxin666/dsh-web-all 至 0.3.6 后，存量老用户在 SSH 面板操作时报「HTTP 404: invalid JSON response」（Issue #1250）：
1. 0.3.6 全家桶通过 ggregate.yml 播种了 web-ui-ssh: enabled: false。老用户此前在 0.3.5 时代已配置主机并正常使用，但从未需要进入设置显式保存 enabled: true，因此升级后没有 settings 覆盖种子，导致后端路由不再注册。
2. 宿主路由未注册返回 404 纯文本时，前端 eadJson 尝试解析 JSON 抛出底层 invalid JSON response 异常，缺乏对插件禁用态的友好提示。

## Decision

- **移除全家桶禁用种子**：从 packages/dsh-web-all/aggregate.yml 中移除 patches: - {id: web-ui-ssh, config: {enabled: false}}，恢复全家桶默认启用 SSH 插件的规范行为，并通过 scripts/aggregate.mjs 重新生成 cordis.patch.yml。
- **宿主端存量主机数据保护**：在 packages/dsh-ssh/src/index.ts 中，当解析出的初始配置为 enabled: false 但尚未绑定显式用户设置且本地 ~/.dsh/dsh-ssh.json 已有主机数据时，自动保护性维持启用状态，确保老用户无感升级。
- **前端 404 友好提示**：在 packages/dsh-ssh/src/client/api.ts 的 eadJson 中，当收到 HTTP 404 时转换为清晰的国际化提示（“SSH 插件在宿主端未启用。请前往「设置 → Web 插件 → SSH」打开 enabled 开关。”），彻底消除了误导性的 invalid JSON response。

## Alternatives considered

- **仅在前端捕获 404 提示用户去设置开启**：否决——这会强制所有已配置主机的老用户升级后必须手动进设置点一次开关，破坏用户体验。

## Consequences

老用户升级全家桶后 SSH 功能完全恢复正常，无需任何手动介入；如果未来有用户主动在设置中关闭 SSH，前端也会给出清晰的设置指引。
