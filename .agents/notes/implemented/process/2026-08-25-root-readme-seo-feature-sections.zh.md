# Agent Note: 根 README SEO 优化与特色功能章节

Status: implemented

## Problem

根 README 不再展示全家桶的两个标志性能力：救助模式（dsh-doctor）只剩「更多插件」里的一句话条目，且「默认关闭」的描述已过时（该插件自安装或升级起默认开启）；梁神模式（dsh-liangshen）则完全缺席——单独安装命令、npm 包清单与许可证归属表里都没有。入口文档也缺少用户真实检索的中英关键词（DeepSeek Harness Web GUI、task board、mobile remote、image understanding、rescue mode 等）。

## Decision

根 README 双语对在「功能插件」下（Git 图谱之后）新增梁神模式与救助模式两个独立章节，移除「更多插件」里的救助模式一句话条目，并在单独安装命令、npm 包清单与许可证归属表中补回 dsh-liangshen，同时把 Doctor 的默认值修正为「默认开启」。H1 与首段在两种语言中携带完整产品关键词，「功能插件」下每个 H3 标题带中英双语关键词括注；皮肤标题保持原样，因为顶部导航锚点指向它。

## Alternatives considered

- 同步扩展能力对比表：用户在本轮范围内不取，表格维持现状。
- 随新章节更新顶部标语 chips 行：用户在本轮范围内不取。
- 用闲置的宠物截图补鲸鱼娘宠物章节：用户不取；宠物仍经创意工坊被发现，见 [根 README 精简](../simplification/2026-08-24-root-readme-workshop-simplification.zh.md)。
- 把 dsh-session-id 写成全家桶能力：不取；该包不在聚合包内，根 README 不能把它呈现为全家桶能力。

## Consequences

- 部分取代 [根 README 精简](../simplification/2026-08-24-root-readme-workshop-simplification.zh.md)：其中梁神模式的移除被逆转（章节、安装命令、npm 清单行与许可证行回归），皮肤与宠物的目录精简仍然有效；两篇 note 保持交叉链接。
- 根 README 双语对仍在 packages/docs 三件套门禁之外手工配对；本次变更后已核对两侧标题数量与顺序一致。
- Doctor 的默认开启行为在功能章节、安装命令块与 npm 清单三处表述一致。

## Testing

`pnpm docs:check` 通过；diff 两侧 README 的标题列表，数量与顺序完全一致。
