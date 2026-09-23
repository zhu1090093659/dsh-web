# Agent Note: 退役插件与 v0.3.18 新功能之后的 README 准确性修订

Status: implemented

## Problem

随包发布的文档与插件集合在两个方向上漂移。退役成员仍带着“现役”文案：根 README 宣传着已退役 `dsh-perf` 提供的「性能观测与治理」能力，聚合包 README 推荐已退役的 `@linxin666/dsh-skins` 全家桶，furina 皮肤 README 安装一个从未存在过的单皮肤 npm 包，来源清单仍在致谢已移除的 `dsh-miku-pet` 包，语义属性契约仍枚举 `aionui-panel` 与 `miku-pet`。与此同时，新家族成员 `dsh-model-capabilities` 没有任何说明，任务看板的会话复用与 Skill 中心的搜索/工作区叠用也未提及，而 `README.en.md` 整节丢失了任务看板，英文读者找不到中文 README 开篇就讲的功能。

## Decision

- 根 README 双语对完整记录了 `dsh-model-capabilities`：功能插件章节（模型页能力编辑器 + 供应商停用/启用）、能力对比表一行、npm 包一览一行、单独安装示例，以及「是什么」摘要中的一句。
- 既有插件的新行为写在它自己的章节：任务看板章节写明可选的会话复用（仅当上一轮会话存在且空闲时复用，否则照常新建），Skill 中心条目写明与工作区选择器叠用的搜索框。
- 退役成员的文案直接删除而不是加注：性能观测能力行、根 README 与聚合包 README 里的 aionui-panel 移除说明、`dsh-skins` 安装命令、`dsh-miku-pet` 致谢条目全部移除；furina 皮肤 README 改为记录真实路径（皮肤中心是唯一加载器，皮肤从创意工坊装进 `$DSH_HOME/skins/<id>/`，`link:` 安装指向 `packages/skins/skin-center`）。
- 聚合包 README 不再手抄家族成员清单：只列要点并指向 `aggregate.yml` 作为完整清单，与本仓库其他位置「一个事实只有一个家」的规则一致。
- 语义属性契约删除两行已退役的 `data-dsh-plugin` 记录，标题计数随表更新（15 改 13）；`model-capabilities` 早在该插件自身的改动中登记。
- 宠物致谢清单现在覆盖包内随发的全部宠物资产：miku（涂山苏苏，MIT，角色按 Piapro 条款）、jyn（11726，MIT）、blue-throated-bee-eater（dsh-web，Apache-2.0）、starry-doll（Theater-ahyeon，CC BY-NC-SA 4.0）。
- `README.en.md` 补回任务看板章节，与中文 README 恢复标题、表格与列表的结构对齐（两侧均为 32 个标题、11 行能力表、18 行 npm 表、6 条宠物条目）。

## Alternatives considered

- 保留移除说明作为历史（「aionui 面板已彻底移除」）：否决——[docs/AGENTS.md](../../../../docs/AGENTS.md) 要求长期文档写当前状态，变更故事留在 commit、Agent Note 与归档里；当前 README 的读者只需要知道现在由谁提供。
- 把聚合包家族清单改写成完整枚举：否决——清单的真值由 `aggregate.yml` 生成，手抄枚举会在下一个插件加入时再次漂移。
- 因为契约是版本化文件就保留那两行：否决——已没有任何元素输出这些 id，适配器自身的映射表也从未包含它们，死枚举只会误导皮肤作者。
- 只改根 README：否决——同样的退役引用与新插件缺口也出现在聚合包 README 和经市场构建发给用户的 furina 皮肤 README 里。

## Consequences

- README 描述的插件集合与现状一致：新插件有说明，退役插件无描述，英文侧结构重新完整。
- 以后新增家族插件需要同时动三处：根 README 双语对、聚合包 README 双语对、语义属性表；聚合包的成员清单本身仍以 `aggregate.yml` 为准。
- 皮肤资产 README 不在 `pnpm docs:check` 的检查范围内（它只遍历包根），因此 furina 的安装说明依赖评审把关；市场构建会把它们复制进 `market/dist`，这也是重生成的资产必须随本次改动一起提交的原因。

## Testing

- 变更后的工作树通过 `pnpm docs:check`、`pnpm i18n:check`、`pnpm aggregate:check`、`pnpm skin-center:check`、`pnpm market:check`、`pnpm test:scripts`、`pnpm typecheck` 与 `pnpm test`。
- 两侧都改动后用 `pnpm docs:write-pair packages/dsh-web-all` 重新记录配对 sidecar；`pnpm market:build` 重生成 furina 的市场资产（`README.md`、`README.zh.md`、`furina.zip`），`pnpm market:check` 确认已提交的 dist 与构建一致。
- 根 README 双语对人工核对：32 个标题顺序一致，能力表 11 行、npm 表 18 行、宠物条目 6 条、代码块 6 个两侧相同；对两个文件的退役插件扫描无命中。
