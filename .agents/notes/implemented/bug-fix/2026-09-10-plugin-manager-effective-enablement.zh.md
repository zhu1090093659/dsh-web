# Agent Note: 插件管理开关显示下次启动的真实生效状态

Status: implemented

## Problem

Issue #1453：npm web 运行时上，插件管理把聚合包按需开启的家族行（`web-ui-ssh`、`web-ui-describe-image`、`web-ui-liangshen`、`web-ui-skill-explorer`、`web-ui-doctor`）显示为"已开启"，而 `dsh web --dump-config` 显示 `disabled: true`，loader 实际从未挂载它们。

列表只从 profile patch 推导每行状态（`rowEnabled.get(id) ?? true`），而 `insertRowsOf` 只读 bundle 的 `insert` 条目，聚合包结尾的裸 `{ id, disabled: true }` 行从未进入模型。写入侧有对应的缺陷：开启行时删除用户覆盖行，只等于恢复"用户没有意见"——当 bundle 层本身就停用该行时，家族仍然关闭，开关永远打不开。

## Decision

- `rowDefaultEnabledOf(patchText)` 读取 bundle patch 自己声明的启停：insert 条目自身的 `disabled` 键，随后按文件顺序应用顶层裸 `{ id, disabled }` 行（loader 的 later-wins 语义）。任何行都未提及的 id 保持缺省，表示"该层没有意见"，而不是"启用"。
- `buildPluginRow` 对包级行与每个聚合子行都用 `用户行 ?? bundle 默认 ?? 启用` 解析，与 loader 的组合方式一致。
- `claimedEntryRowsOf` 与 `findRowOwner` 携带 `baseEnabled`；`setRowEnabled` 接收该参数，当 bundle 层停用该行时写入或保留显式 `{ id, name, disabled: false }` 用户行，而不是删除覆盖行。bundle 层本就启用时，开启仍然删除覆盖行，不留陈旧行。

## Testing

- `tests/rows.spec.ts`：`rowDefaultEnabledOf` 能读出聚合形状 patch 结尾的按需开启行、识别 insert 条目自身的 `disabled`、按 later-wins 应用后续行、对未声明 id 保持缺省、对空与畸形输入容错；`setRowEnabled` 对被 bundle 停用的行写入显式 `disabled: false`，并把已有的用户停用翻转为它且不产生重复行。
- `tests/set-enabled.spec.ts`：自带 `web-ui-ssh` disabled 的聚合 profile，经真实 list 路由把该子行（以及包级行）报告为停用，兄弟行保持启用；行级开启写入 `disabled: false` 且响应报告该子行启用；包级开启同样写出显式覆盖行。
- `pnpm --filter @linxin666/dsh-client-ui-plugin-manager test`（17 个文件、204 个用例）、`typecheck`、`build` 通过；更新 README 配对后 `pnpm docs:check` 与 `pnpm i18n:check` 通过。

## Alternatives considered

- 用 `dsh --dump-config` 读组合树来生成列表。否决：每次列列表都要起 CLI，而且它仍然无法告诉写入侧该持久化什么；管理器只能组合自己拥有的层。
- 开启时一律写显式 `disabled: false` 而不是只对被 bundle 停用的行。否决：会为每次拨动留下行、改变现有测试钉住的行为，而在没有下层停用时毫无收益。
- 把 `!!js` 表达式的 `disabled` 值当作停用。否决：离线无法求值，管理器没有意见；聚合生成器为按需开启行只产出字面 `true`。
- 把列表扩展到全部依赖而不只是 `dsh.profile.bundles` 中的项。否决：那是另一个准确性缺口，不是本报告缺陷。

## Consequences

- 对管理器能写的两层（所装 bundle 的 patch 与 profile patch），开关位置与下次启动实际加载一致；显式用户行始终优先于 bundle 默认值。
- `$DSH_HOME/cordis.patch.yml` 或 `--patch` 覆盖层停用某行时仍优先于管理器写入的 profile patch，因此这些层上的列表仍可能偏乐观。
- 声明了 bundle 但不在 `dsh.profile.bundles` 里的依赖仍会列出 loader 从不组合的行；本次修复不建模该情形。
