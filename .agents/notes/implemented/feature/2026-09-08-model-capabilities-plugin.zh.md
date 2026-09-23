# Agent Note: 自定义 pi-ai 提供方的逐模型能力声明

Status: implemented

## Problem

Models 设置页上的自定义 DSH 提供方只能填模型 ID、显示名称、上下文窗口与最大输出，而官方 `llm-pi-ai` 设置命名空间一直承载的两个字段没有编辑入口：`models[].input`（适配器判断能否随请求携带图片附件时读取的模态）与 `models[].reasoningEfforts`（会话级 `reasoningEffort` 必须落入的档位字典）。手填的视觉模型因此永远收不到图片，手填的推理模型也永远不提供思考档位，而这两者本来都只是普通配置。

## Decision

- 新增 `packages/dsh-model-capabilities`（`@linxin666/dsh-client-ui-model-capabilities`，bundle 行 `ui-model-capabilities`）占位官方 `settings.models.provider-card` keyed 插槽的 `llm-pi-ai` key，该家族每张已保存的卡片获得可折叠的「模型能力」扩展区；另占位 `settings.models.footer`，列出路由仍未下线的存档提供方。
- 读写走官方 remote settings 线路（`remote.settings.describe` / `mutate`），目标是 `llm-pi-ai` 命名空间。保存是一次 `set` 路径操作，整体替换该提供方的 `models` 数组——settings 的路径遍历遇到数组会整体替换，无法按下标寻址单个模型；条目是结构开放对象，本插件不编辑的字段（id、name、contextWindow、compat 等）原样保留。
- 图片输入是显式声明（`["text","image"]` 或 `["text"]`）；未声明态如实展示为继承并保留，而不是隐藏。
- 推理是三态：不声明（继承）、`false`（声明无推理）、或 `off` 到 `max` 的显式档位字典，每档带发送值，且只有 `off` 可以留空（「支持，但发送时不带参数」）。编辑器在写入前拒绝「不含 off 以外档位」或「非 off 档位发送值为空」的字典，与适配器自身的接受规则一致，避免 host 事后拒绝。
- 提供方禁用/启用只用唯一被认可的缝：`unset llm-pi-ai.providers.<route>`，与官方「移除提供方」按钮同款写入。禁用先把用户层 profile 存档进本包自己的设置 entry——即 host 半区声明的 `Config`，由宿主按本行的 profile entry id（`ui-model-capabilities`，或聚合包的 `web-ui-model-capabilities`）提供服务，共享 mount-once 副本防双源重复注册——再 unset 该路由；启用原样恢复存档并清空它。这个顺序让最坏情况只是重复存档而不是丢 profile，启用遇路线已有更新配置时拒绝，两个命名空间都做 revision 围栏。
- 尊重组合层：base 层也声明的路由无法靠用户层 unset 下线，因此这类卡片不提供禁用开关，编排层即使被调用也以 `base-profile` 拒绝。
- 页脚只列出路由仍下线的存档条目：路由回来（重新添加，或部分启用只恢复了 profile 却没清掉存档）后条目自动隐藏，存档本身仍可恢复。
- 刷新按命名空间收窄：只有 `llm-pi-ai` 或存档命名空间的 `settings/document-updated` 才驱动界面，并发的 `describe` 合并为一次 wire 调用；未保存草稿在后台刷新后保留，并把写入围栏钉在草稿读取时的 revision，文档已变则冲突重读，既不静默丢弃编辑也不覆盖更新的状态。
- 文案在包内出 zh/en（`model-caps` 命名空间），ru 集中在 `dsh-i18n`；`scripts/i18n-audit.mjs` 已登记本包，聚合 bundle 登记该 child。

## Alternatives considered

- **能力表存本包命名空间、host 半区改写请求**：被否。会分裂事实源——适配器读的 `input` 与 `reasoningEfforts` 就在 `llm-pi-ai` 里；而且竞态与双写一致性要落到 host 半区。官方命名空间带这些字段，正是为「知道自身路由的部署」准备的。
- **视频 / PDF 模态复选框**：被否。pi-ai 的模态词表只有 `text | image`，更宽的声明无法端到端生效，UI 等于欺骗。
- **host 半区枚举内置目录**：v1 不做。路线直接服务内置目录且没有 `models` 数组时显示「先添加模型行」的指引而非编辑器，避免为枚举引入自定义 remote 面。
- **用 enabled 标志隐藏已禁用提供方**：被否。pi-ai 没有该字段；被认可的移除就是官方卡片同款 unset，存档保证 profile 可恢复。

## Consequences

- 自定义模型可以在 Models 页就地声明图片输入、推理档位与每档发送值；输入框按声明的档位提供思考选项，且只有声明了图片的模型才会被 DSH 提供图片附件。
- 禁用后提供方立即离开两个模型选择器，host 侧对它的委派以 `NO_ADAPTER` 失败关闭；配置在路由回来之前始终可从页脚恢复。
- `THINKING_LEVELS` 是适配器档位词表的本地副本，上游变化必须同步；不一致会以 host 侧拒绝并点名该档位的方式暴露。
- API 密钥留在凭据服务；存档只存配置。
- 安装本包需要重启 DSH：`dsh plugin --profile web add link:<repo>/packages/dsh-model-capabilities`，或安装聚合包。

## Testing

- `tests/capabilities.spec.ts`（25 项）覆盖视图读取、模式分类、档位归一化、校验、草稿更新与 op 构建。
- `tests/provider-toggle.spec.ts`（15 项）覆盖存档解析、四个 op 构建器、层判定谓词，以及带 revision 围栏的禁用/启用编排与全部失败分支。
- `tests/panel.spec.tsx`（7 项）与 `tests/toggle-ui.spec.tsx`（12 项）用假 remote face 挂载真实组件：整数组写入、三态编辑、冲突重载、只读姿态、禁用态、禁用/启用两段写入顺序、存档条目过滤、base 层守卫，以及后台刷新下草稿存活。
- 仓库门禁：`pnpm typecheck`、`pnpm test`、`pnpm docs:check`、`pnpm i18n:check`、`pnpm aggregate:check`、`pnpm test:scripts`、`pnpm sync-shared:check` 与 `pnpm runtime-deps:check`。
- 插槽落座与两个模型选择器的实机验证由维护者执行：本插件需要重启 DSH 才挂载。
