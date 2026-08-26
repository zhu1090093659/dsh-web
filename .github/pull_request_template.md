> 提 PR 前请阅读 [CONTRIBUTING.md](../CONTRIBUTING.md) 与 [AGENTS.md](../AGENTS.md)；
> 提交信息用 Conventional Commits（`type(scope): subject`），禁止 emoji。
> 本仓库只接受三类内容贡献：插件申请（社区插件索引登记）、皮肤增加（新皮肤收录）、宠物增加（新宠物收录）。新皮肤收录进本仓库部署的 dsh-market.com 服务器（Workshop），按需安装，默认安装不带；无背景图、仅简单改色且样式存在问题的低质皮肤 PR 不予接受。其余改动（修复 / 增强 / 全新功能 / 文档 / 测试 / 维护）不接受直接 PR，请先提 Issue 讨论；仓库所有者、机器人与拥有写权限的协作者（维护者）不受此限制，可直接提交任意改动。
> 仅文档类 PR（标题以 `docs:` 开头或勾选「仅文档」）不接受，会被自动关闭；文档改动请先提 Issue 讨论（仓库所有者、机器人与拥有写权限的协作者不受此限制）。
## 摘要（Summary）

<!-- 用一两句话说明改了什么、为什么改。 -->

## 涉及包（Affected Packages）

<!-- 勾选本次改动涉及的包；仅脚本改动（维护类）可全部不勾选并说明。 -->

- [ ] 任务看板 `packages/dsh-task-board`
- [ ] Git 图谱 `packages/dsh-git-graph`
- [ ] 右侧面板 `packages/dsh-aionui-panel`
- [ ] 远程 Web UI `packages/dsh-remote-web-ui`
- [ ] SSH 远程运维 `packages/dsh-ssh`
- [ ] 宠物 `packages/dsh-pet`
- [ ] 皮肤 / 皮肤中心 `packages/dsh-skins` / `packages/skins`
- [ ] 聚合包 / 设置 `packages/dsh-web-all` / `packages/dsh-web-settings`
- [ ] 其他（请说明）

## PR 类别（PR Category）

<!-- 必填。勾选本 PR 最贴近的类别（可多选），用于机器人按类别自动分派给协作者。注意：本仓库只接受三类内容贡献——新皮肤收录勾「皮肤 / 皮肤中心」、插件申请勾「社区插件索引」、新宠物收录勾「插件功能」类别（该类别括号内含宠物项），并在下方 PR 类型中勾选对应内容类型。只勾选「壁纸 / 渲染器」类别的 PR 不接受，会被自动关闭（Wallpaper Engine / WebGL / 渲染器相关问题请提 Issue）；其余类别（插件功能中的功能改动、维护 / 其他）不在接受范围，会被自动关闭，请改提 Issue；仓库所有者与拥有写权限的协作者（维护者）不受此限制。 -->

- [ ] 壁纸 / 渲染器（Wallpaper Engine / WebGL / 背景场景）
- [ ] 皮肤 / 皮肤中心（新皮肤收录、皮肤样式）
- [ ] 插件功能（任务看板 / Git 图谱 / 右侧面板 / 远程 Web UI / SSH / 宠物 / 设置 / 聚合包）
- [ ] 社区插件索引
- [ ] 维护 / 其他

## PR 类型（PR Type）

<!-- 勾选所有适用的类别。 -->

- [ ] 面向用户的功能或行为变更
- [ ] Bug 修复
- [ ] 视觉修复（UI / 视觉类问题的修复）
- [ ] 增强 / 优化（现有功能的改进、性能 / 体验优化）
- [ ] 新皮肤收录（内容贡献，欢迎直接提交，无需先提 issue）
- [ ] 新宠物收录（内容贡献，欢迎直接提交，无需先提 issue）
- [ ] 维护 / 重构

<!-- 仅文档类 PR 不接受，会被自动关闭；文档改动请先提 Issue 讨论。 -->

## 最新代码确认（Latest Codebase Confirmation）

- [ ] 我已基于最新 `dev` 分支开发，或在提交前已 rebase / 合并最新 `dev`。

同步命令：

<!-- 示例：git fetch origin && git rebase origin/dev -->

## 测试证据与上游同步（Test Evidence & Upstream Sync）

<!-- 必填。缺少下列任一证据的 PR 不予接受；文本类改动可不附截图，但必须提供测试证据。 -->

- [ ] 我提供了自己本地测试的证据（执行的命令 / 测试结果 / 运行截图）。
- [ ] 我已同步上游最新 `dev` 分支（`git fetch origin && git rebase origin/dev`），并附上同步后重新测试通过的证据（视觉 / 用户可见变更附截图）。

## 视觉修复要求（Visual Fix Requirements）

<!-- 仅当 PR 类型勾选了「视觉修复」时必填；纯文本类改动可跳过本节。 -->

- [ ] 我提供了修复完成后的截图（完成态或修复前后对比）。
- [ ] 修复使用的 AI 模型支持图像输入（多模态模型）；未使用 AI 编码时此项视为满足。

<!-- 使用纯文本模型（如 deepseek-chat / deepseek-reasoner / gpt-3.5 等不支持图像输入的模型）进行视觉修复的 PR 不接受；使用的多模态模型请在「AI 编码披露」节填写。 -->

## AI 编码披露（AI Coding Disclosure）

<!-- 必填。勾选一项，且模型 / 工具字段不得留空。 -->

- [ ] 完全 AI 编码：全部编程改动由 AI 产出，并由贡献者接受 / 审查。
- [ ] 部分 AI 辅助：AI 帮助编写或修改了部分编程改动。
- [ ] 未使用 AI 编码辅助。

使用的 AI 模型：

<!-- 使用 AI 时必填；未使用 AI 时填 N/A。示例：DeepSeek、GPT-5、Claude Sonnet 4。 -->

使用的编码 Agent 工具：

<!-- 使用 AI 时必填；未使用 AI 时填 N/A。示例：DeepSeek Harness、Codex、Claude Code、Cursor。 -->

## 仓库规范检查（Repo Rules）

<!-- 本仓库硬性规范，请逐项确认。 -->

- [ ] 未修改 DSH 官方源码，仅基于官方 NPM SDK（`@deepseek-ai/*`）开发。
- [ ] 未新增指向 DSH 源码 checkout 的 tsconfig `extends` / `paths` / `references`。
- [ ] 新增包目录以 `dsh-` 前缀命名（如 `packages/dsh-xxx`）。
- [ ] 所有新增 / 修改文件不含任何 emoji 字符。
- [ ] 改动包 README 时同步维护中英双语三件套（`README.md` / `README.zh.md` / `README.i18n.yaml`）并运行 `pnpm docs:check`。

## 贡献者版权声明（Contributor Copyright）

<!-- 可选。若本 PR 贡献的是插件或皮肤，可在项目 README 末尾「来源与版权」的版权表中追加一行声明你自己的版权（包 / 来源 / 版权三列，格式参考表中现有行）；不声明则维持现有版权归属。 -->

## 新皮肤收录（New Skin）

<!-- 仅当本 PR 新增皮肤时必填；其余改动可跳过本节。新皮肤属于内容贡献，欢迎直接提交（无需先提 issue）；但没有任何背景图、仅简单改色且样式存在明显问题（如暗色缺失、对比度不足、布局错位）的低质皮肤 PR 不予接受。皮肤收录进本仓库部署的 dsh-market.com 服务器（Workshop），用户按需安装到 `$DSH_HOME/skins/<id>/`，默认安装（skin-center npm 包）不带新皮肤。 -->

- [ ] 纯资产目录契约：`packages/skins/skin-center/skins/<name>/` 只含 skin.json + skin.css（+ 可选 patches.css / hooks.mjs / assets/），无 package.json 与构建文件；`node scripts/dsh-skin validate` 通过；纯呈现层约束满足（不注入服务、不发事件、不触及模型请求）。
- [ ] `skin.json` 符合 v2 清单（contracts/skin-manifest-v2.schema.json：skinManifestVersion / id / name / nameEn / version / author / contributes，另含 tagline / description / tags / accent / preview / order）。
- [ ] `pnpm skin-center:check` 通过（新皮肤出现在设置 → 皮肤中心）；已重跑 `pnpm market:build` 并提交市场产物（`market/dist`）。
- [ ] 已用 `node scripts/capture-previews` 重拍并提交 `preview/{light,dark}.png`。
- [ ] README 中英双语、LICENSE 与贡献者版权声明齐全；PR 描述附市场试穿截图（亮 / 暗）。
- [ ] 非低质皮肤：亮 / 暗双态样式完整（无暗色缺失、对比度不足、布局错位），不是无背景图、仅简单改色的低质皮肤（此类 PR 不予接受）。

## 新宠物收录（New Pet）

<!-- 仅当本 PR 新增宠物时必填；其余改动可跳过本节。新宠物属于内容贡献，欢迎直接提交（无需先提 issue）；需满足宠物契约，否则条目会被跳过或拒绝。 -->

- [ ] 按宠物契约新增 `packages/dsh-pet/assets/<id>/`：`pet.json` 使用 v2 manifest（petManifestVersion / id 小写 kebab / displayName / license 必填 / renderer / sprite2d{} 或 live2d{} / sequences / remarks；未知顶层键 fail-closed 拒绝），资产路径全部为安全相对路径。
- [ ] 图集为 8 列 × 9 行（v2 可声明 11 行），行序固定（0 idle / 1 running-right / 2 running-left / 3 waving / 4 jumping / 5 failed / 6 waiting / 7 running / 8 review），未用格子全透明；`node scripts/dsh-pet validate <dir>` 通过。
- [ ] 在 `packages/dsh-pet/src/registry.test.ts` 增加该 manifest 的归一化断言；`pnpm --filter @linxin666/dsh-pet build` / `test` 与 `pnpm typecheck` 通过；提交重建的 `lib/`。
- [ ] 同步维护 dsh-pet README 中英三件套（`README.md` / `README.zh.md` / `README.i18n.yaml`）并重录配对（`pnpm docs:write-pair dsh-pet`）。
- [ ] README 动画预览与「许可证 / 版权」说明齐全；PR 描述附宠物实测截图（设置页「宠物」选择器出现新宠物、切换后动画正常）。

## 社区插件索引登记（Community Plugin Index）

<!-- 仅当本 PR 新增接入一个社区插件时必填；其余改动可跳过本节。新接入的社区插件对下述要求逐项确认。 -->

插件 GitHub 仓库链接：

<!-- 必填。提供插件源码的公开 GitHub 仓库链接，供协作者评审参考。 -->

插件详细说明：

<!-- 必填。提供插件的功能、用途、依赖、已知限制等详细说明，供协作者评审参考。 -->

- [ ] 已按 [docs/plugins.md](../docs/plugins.md) 的登记说明在 `packages/dsh-community-plugins/community.json` 追加条目，并运行 `node scripts/community-index` 重新生成注册表（提交生成的 `packages/dsh-community-plugins/src/client/generated/community.ts`）。
- [ ] 已确认插件与 dsh-web 插件体系兼容：遵循官方 cordis bundle 独立标准（package.json 声明 `dsh.bundle.patch` 指向 `cordis.patch.yml`、`dsh.client` 浏览器半区），类型仅基于官方 `@deepseek-ai/*` NPM SDK，未修改 DSH 源码；已在本仓库最新代码上验证插件可被 `dsh web` 挂载并正常运行。
- [ ] 承诺负责后续更新跟进：插件与 DSH / dsh-web 生态保持同步，生态升级导致不兼容时主动跟进修复；条目信息（description / npm 等）变动或插件停更时，及时更新索引登记或提交移除。

## 本地验证（Local Validation）

执行的命令：

```bash
# 示例：改动包目录内 pnpm build，涉及聚合包时跑 aggregate:check
pnpm build
```

结果摘要：

<!-- 失败也要写明。不要留空。 -->

## 用户可见变更证据（Local Feature Evidence）

<!--
面向用户的功能或行为变更必填。
附截图或短视频，展示：
- 本地加载的插件来自本 PR / 最新代码
- 功能已启用 / 配置（如适用）
- 成功使用并展示可见结果
- 涉及 agent 循环的功能展示后续 / 结果反馈
皮肤改动需同时展示换肤后的界面效果。
-->

证据：

<!-- 粘贴 GitHub 图片 / 视频附件、Markdown 图片或直接图片 / 视频链接。纯内部改动（无用户可见变更）可填 N/A。 -->