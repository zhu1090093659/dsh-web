# Agent Note: aggregate row config seeding (patches section), ssh ships disabled in the family bundle

Status: implemented

Supersession check：没有活跃 Note 拥有聚合清单段或按捆绑包的默认策略；aionui 默认关闭先例原本只写在 aggregate.yml 注释里，随该包移除而消失（见[移除 dsh-aionui-panel](../simplification/2026-08-28-remove-dsh-aionui-panel.zh.md)）；compat shim 与家族扇出机制归 web-all 包文档。

## Problem

维护者要求：低频插件对全新安装默认关闭，同时所有已安装用户保持现状。两种形状被排除：

- 纯声明式配置无法区分人群：boot 层每次启动都从 profile bundle 列表重建条目树（`~/.dsh/profiles/web/cordis.yml` 是空根加补丁；不存在按用户的解析产物文件）。任何行内值都会作用到所有从未改过该设置的人。
- 运行期首启判定需要新的宿主侧代码与使用痕迹启发式且会误判（从没打开过宠物的老用户看起来就像「新人」）。

与此同时官方接缝早已定义了行级 config 的含义：`dsh-app-boot` 的 `applyEntryPatches` 对已插入行按键应用非 insert 补丁；`dsh-settings` 的 `installSettingsSection(ns, schema, entry)` 只把该 entry 当 `base`——注册的 settings 作用域一旦有值即胜出。所以行内携带 `config:` 等于「从未动过该插件设置的用户」的播种默认，永远不会盖过动过的人。

## Decision

- `scripts/aggregate.mjs` 新增清单 `patches:` 段（单行 JSON flow mapping）。每个条目渲染在全部 insert 块之后，形如裸补丁行（`- id: <命名空间 id>` + `config: {...}`），指向本聚合自身的行；id 不匹配任何既有行、或与另一覆写重复时生成器报错。清单条目同时不再跨段渗透（未知段守卫重置解析，段顺序不再影响结果）。
- `@linxin666/dsh-web-all` 为 `web-ui-ssh` 播种 `enabled: false`：新装全家桶默认关闭 SSH（多数用户低频），在设置里打开一次即持久，改过 SSH 设置的老用户升级后保持原样。pet 经明确决策不动；独立包分发零变化。
- README 双语补充选择性默认说明；包 AGENTS 记录新清单段。

## Alternatives considered

- **独立包 schema 默认翻转**：否——会同样作用于独立的 dsh-ssh 安装者，超出「仅全家桶」范围。
- **运行期首启人群判定**：见上——复杂、会误判、新增持久状态。
- **经子包 patch 写行内 `enabled:false`**：否——子 patch 在已发布的 dsh-ssh 包内，独立语义会被同等改变。
- **什么都不做／仅文档化**：否——维护者明确选择行为式播种。

## Consequences

- 从未碰过 SSH 设置的现有全家桶用户在下次升级时 SSH 会变为关闭——已被维护者接受并需要公告；恢复只是设置里一次点击。
- 新装用户看到更少的表面但不损失任何能力（SSH 仍可开启）。
- 未来为其他行播种默认只需各一行清单；机制在生成期强制目标存在、唯一与对象形态校验。
- 验证期间观察到一处与本变更无关的既有门禁失败：`test:scripts` 的 market-build 干净 checkout 用例在本变更之前就已失败（定向 stash 隔离验证）；另行跟踪。

## Testing

- 重新生成产物核验：覆写渲染在最末（`# config override for web-ui-ssh`），`node scripts/aggregate.mjs --check` 与 `pnpm aggregate:check` 通过；配对重录后 `pnpm docs:check` 通过。上游事实对照本机安装的 rc.2 bundle 核实（applyEntryPatches 的 insert 索引与 installSettingsSection 的 base 回退语义）。
