# 贡献指南（Contributing）

欢迎为 dsh-web（DSH Web GUI 插件与皮肤全家桶）贡献代码。本文件是贡献者的
入口；仓库的全部规则与机制以 [AGENTS.md](AGENTS.md)（及其分层指令）为准，
冲突时以 AGENTS.md 为准。

## 分支与合入流程

- `dev` 是开发分支（集成分支）：本地开发与远程 PR 统一以 `dev` 为
  目标分支；`dev` 上测试通过后，由维护者合入 `main`。
- PR 打开后由 `.github/workflows/auto-assign-pr-reviewers.yml` 按 PR 描述中
  勾选的「PR 类别」自动分派：把对应协作者设为负责人并请求其审查，未命中任何
  类别时交给 `defaultRoute` 兜底；Wallpaper Engine / WebGL / 渲染器代码在
  [dsh-skins](https://github.com/zhu1090093659/dsh-skins) 仓，本仓只保留其
  Issue 类别。路由规则见 [PR_TRIAGE.md](PR_TRIAGE.md)。
- 合并门禁：`dev` / `main` 要求 4 个必需检查全绿（`CI checks`、`plugin-mount`、`Validate PR contribution evidence`、`guard-agent-notes`），**不要求人工审批**；
  具有 write 权限的协作者检查通过后即可自行合并（含自己的 PR），无需等待
  维护者审批。
- `main` 是稳定分支：只接收从 `dev` 合入且测试通过的代码。
- 提 PR 一律以 `dev` 为 base，不要以 `main` 为 base。

## PR 范围：内容贡献全部在独立仓

### 临时开放期（2026-10-27 起）

- 这是一段临时窗口：标准政策不因此改变，开放期结束后行为回到标准政策。
- 开放期内：除四类内容贡献外，外部 PR 不再被自动关闭，可直接提交；纯文档 PR 同样接收。
- 证据要求照旧：模板必填项与 `pr-contribution-rules.yml` 仍会校验，缺证据时评论要求补充，不关闭 PR。
- 恢复方式：把 `.github/workflows/reject-non-content-pr.yml` 与 `.github/workflows/reject-docs-pr.yml` 顶部的 `ACCEPT_EXTERNAL_PRS` 改回 `'false'`，行为与临时开放期之前完全一致。

### 标准政策

本仓库对外部贡献者**不再接受**任何直接 PR。四类内容贡献都在各自的独立仓提交
（下表），其余改动请先提 Issue 讨论；插件功能、文档、测试、维护等范围内的 PR 同样
不接受直接提交。

- **插件申请（社区插件索引登记）**：第三方插件由作者在自己的仓库按官方
  cordis bundle 标准实现，然后向
  [dsh-community-plugins](https://github.com/zhu1090093659/dsh-community-plugins)
  仓提交索引登记——在该仓根目录的 `community.json` 追加条目，运行
  `pnpm community:check` 校验后随该仓 PR 提交；
- **皮肤增加（新皮肤收录）**：新皮肤作为纯资产提交到
  [dsh-skins](https://github.com/zhu1090093659/dsh-skins) 仓的 `skins/<id>/`，
  收录到我们部署的 dsh-market.com 服务器（Workshop 商店）供用户按需安装——
  **默认安装不带**：skin-center npm 包只随附 `blue-fantasy`，新皮肤由用户经
  Workshop 按需安装到 `$DSH_HOME/skins/<id>/`。**低质皮肤 PR 不予接受**（没有
  背景图、仅简单改色且样式存在明显问题，如暗色缺失、对比度不足、布局
  错位），请完善样式并附亮 / 暗试穿截图后再提交；
- **宠物增加（新宠物收录）**：按宠物契约在
  [dsh-pet](https://github.com/zhu1090093659/dsh-pet) 仓的 `assets/<id>/` 新增
  （`pet.json` manifest + 图集，可选语音包 / 预览 / 装饰），随该仓 PR 提交。
- **预设增加（agent 预设收录）**：按
  [dsh-presets](https://github.com/zhu1090093659/dsh-presets) 仓的
  [presets README](https://github.com/zhu1090093659/dsh-presets/blob/main/presets/README.md)
  发布格式新增 `presets/<id>/`（`preset.yml` + `agent.cordis.yml`）并登记
  `catalog.json`，收录到我们部署的 dsh-market.com 服务器（Workshop）供用户按需
  安装——**默认安装不带**。预设是代码：composition 可挂载 npm 插件、加载预设
  目录内文件、执行 `!!js` 表达式，启用后运行在 DSH 宿主进程内，评审重点审核
  composition 实际加载内容与用途。

按上述类别向本仓提交的 PR 会被
`.github/workflows/reject-non-content-pr.yml` 关闭并重定向到对应独立仓；其余
范围外的 PR 同样被自动关闭（仅文档类 PR 由 `reject-docs-pr.yml` 处理）；仓库
所有者、机器人与拥有写权限的协作者（维护者）的 PR 不受此限制。

## 开发前置

- Node.js >= 22 与 pnpm 11；
- 插件只基于官方 NPM SDK（`@deepseek-ai/*`），**禁止修改 DSH 源码**、禁止
  tsconfig 指向任何 DSH 源码 checkout；
- 认证：token 放用户级 `~/.npmrc`，项目 `.npmrc` 只留 scope 映射（详见
  [docs/plugins.md](docs/plugins.md)）。

## 快速开始

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
git checkout dev                                 # 开发基线：dev 分支
git fetch origin && git rebase origin/dev        # 提交 / 提 PR 前同步最新 dev
pnpm install
pnpm -r build
pnpm typecheck && pnpm test && pnpm docs:check   # 提交前必过
```

四个卫星仓（`dsh-skins` / `dsh-pet` / `dsh-community-plugins` / `dsh-presets`）以 git submodule 挂在 `satellites/`，市场构建按各自的 gitlink 固定提交拉取内容。默认不需要检出：要就地改卫星仓内容时才 `git submodule update --init satellites/<仓名>`。该命令把工作树停在 gitlink 固定的提交上（detached HEAD），要提交改动先切到该仓的默认分支：`git -C satellites/<仓名> checkout main`。检出停在该固定提交时 `pnpm market:fetch` 直接复制该工作树；检出离开固定提交（切了分支，或提交了自己的改动）时，默认运行会明确提示并仍按固定提交构建，`pnpm market:fetch --local` 才读取该工作树——这样构建出的 `market/dist` 来自未固定内容，不得提交。

**卫星仓的改动必须在卫星仓提交。** `satellites/<仓名>` 是独立的 git 仓库，
在本仓写下的文件改动不会被本仓的 `git add` 收走：只 `git add` 本仓会把它们的
工作树留在 dirty 状态（`git status` 显示 `m satellites/<仓名>`），下次检出/清理
就可能丢失。改完卫星仓（含随源码一起重新生成的 `lib/`）后：

1. 在卫星仓提交：`git -C satellites/<仓名> add -A && git -C satellites/<仓名> commit`；
2. **把该提交推到卫星仓的远程**：`git -C satellites/<仓名> push origin main`；
3. 回到本仓把新的 gitlink 一起提交：`git add satellites/<仓名> && git commit`。

三步缺一不可——只提交卫星仓，本仓仍指向旧提交，其他检出与市场构建读到的还是改动前的
内容；只提交 gitlink 则根本不成立（卫星仓的提交才是被固定的对象）。漏掉第 2 步最隐蔽：
本地检出的工作树停在该提交上，`pnpm market:fetch` 直接复制它、构建照常成功，但拉取内容时
的 tarball 回退只按 SHA 寻址该提交，于是只存在于本地的提交让每一个全新克隆与 CI 的
`pnpm market:fetch` 得到 `HTTP 404`——移动钉扎的那一次运行成功，掩盖了后续所有运行的失败。
卫星仓内改动的验收与门禁在该仓自己的 CI 跑（见该仓 `AGENTS.md`）。

推送钩子 [scripts/git-pre-push-gitlinks.sh](scripts/git-pre-push-gitlinks.sh) 在这种推送发生前拦下它并打印修复命令，安装方式与取舍见 [gitlink 推送守卫](.agents/notes/implemented/process/2026-10-20-gitlink-push-guard.md)。

**卫星仓的 `main` 受分支规则集保护**：只有仓库所有者与拥有 write 权限的协作者可以直接 push，其他贡献者必须对该仓的 `main` 开 PR，由该仓 CI 作业转绿后合入。规则集始终要求 PR、禁止强推与删除，且不要求人工审批；豁免名单与决策见 [卫星分支推送策略 Note](.agents/notes/implemented/process/2026-10-04-satellite-main-branch-push-policy.md)。

**桌面宿主读到的是哪份卫星副本**：全家桶聚合包按 semver 声明这四个卫星包
（`^0.4.6`），`pnpm install` 因此把聚合包 `node_modules/@linxin666` 下的符号链接指到
pnpm store 的已发布 tarball。桌面宿主解析聚合 patch 行贡献的外部行时从聚合包自身的
node_modules 出发——仅提交卫星仓并重启，GUI 加载的仍是发布版旧代码。在本地检出开发
卫星内容后重跑 `node scripts/link-profile.mjs`：它会把这些 store 链接改指到本地卫星
（仅当该卫星已构建 `lib/` 且版本满足声明的范围），随后重启 DSH 生效。

## 提交规范

提交信息格式 `type(scope): subject`，type 用 `feat` / `fix` / `chore` /
`docs` / `test` / `refactor` / `perf`，scope 是包名或主题，关联 issue 时
subject 末尾追加 `(#123)`。示例：`fix(task-board,ssh): hide composer under
active panel (#76 #87)`。提交信息禁止 emoji（全仓规则）。

## 提 PR 前检查清单

1. **门禁全绿**：`pnpm typecheck` / `pnpm test` / `pnpm test:scripts` /
   `pnpm docs:check`；涉及聚合包或市场时另跑
   `pnpm aggregate:check` / `pnpm market:check`。
2. **文档同步**：改包 README 必须同 PR 维护中英双语三件套（`README.md` +
   `README.zh.md` + `README.i18n.yaml`），改完任一侧后重录配对记录：

```sh
pnpm docs:write-pair <包目录名>   # 如 dsh-ssh 或 dsh-usage
```

3. **无 emoji**：代码、注释、文档、提交信息均不得出现 emoji（CI 有全树
   检查）。
4. **一次性记录**（任务交接、验证快照）放 `docs/archive/`，不进长期文档目录。
5. **按模板填 PR**：摘要、涉及包、**PR 类别（必填，决定自动分派给哪位
   协作者）**、类型、最新代码确认、AI 编码披露、仓库规范检查、本地验证结果；**测试证据与上游同步必填**：提供自己本地测试
   的证据，并附上同步上游最新 `dev` 分支（`git fetch origin && git
   rebase origin/dev`）后重新测试通过的证据。文本类改动可不附截图；
   **视觉修复 / 用户可见变更必须附截图**（视觉修复还需完成态或修复前后
   对比截图），且视觉修复必须使用支持图像输入的多模态 AI 模型完成——
   使用纯文本模型（如 deepseek-chat / deepseek-reasoner / gpt-3.5）修复
   的视觉类 PR 不予接受。缺少上述证据的 PR 不予接受。
6. **AI 编码披露**：使用 AI 编码时在 PR 模板中如实披露模型与工具。

## 四类内容贡献怎么做

### 插件申请（社区插件索引登记）

插件在贡献者自己的仓库实现（官方 cordis bundle 标准：`dsh.bundle.patch`
指向 `cordis.patch.yml`、`dsh.client` 浏览器半区、仅基于
`@deepseek-ai/*` NPM SDK，不修改 DSH 源码），然后向
[dsh-community-plugins](https://github.com/zhu1090093659/dsh-community-plugins)
仓提交索引登记：在该仓根目录的 `community.json` 追加条目，运行
`pnpm community:check` 校验后随该仓 PR 提交。

### 皮肤增加（新皮肤收录）

在 [dsh-skins](https://github.com/zhu1090093659/dsh-skins) 仓用
`node scripts/dsh-skin-new.cjs <id>` 生成纯资产骨架（无 package.json），
`node scripts/dsh-skin.cjs` 校验后按皮肤契约完善（skin.json v2、
skin.css token 重映射，可选 patches.css / hooks.mjs / assets/），按该仓
README 生成 `preview/{light,dark}.png`，`pnpm skin-center:check` 通过后随
该仓 PR 提交。皮肤收录到我们部署的 dsh-market.com 服务器（Workshop）供
用户按需安装，默认安装不带（见上文 PR 范围）。

### 宠物增加（新宠物收录）

宠物已迁至独立仓 [dsh-pet](https://github.com/zhu1090093659/dsh-pet)：按该仓 README 的宠物契约
在 `assets/<id>/` 下新增（`pet.json` v2 + 8 列 × 9 行图集，
可选 `previews/`、`voice.json` 与状态装饰），在该仓补齐该 manifest 的归一化
测试与构建产物，同步维护该仓 README 中英三件套，运行该仓的
`pnpm test` 与 `pnpm typecheck` 后随该仓 PR 提交。

### 预设增加（agent 预设收录）

预设已迁至独立仓 [dsh-presets](https://github.com/zhu1090093659/dsh-presets)：
按该仓 CONTRIBUTING 把 `presets/_template/` 复制为 `presets/<id>/`（目录名即
预设 id，匹配 `^[a-z0-9][a-z0-9-]*$`，官方内置 id 保留），编辑 `preset.yml`
（展示文案，单行标量）与 `agent.cordis.yml`（composition，service 行置于带
isolate realm 的 group 内），在 `catalog.json` 登记条目（id / author / version
必填），运行该仓的 `pnpm preset:check` 与 `pnpm test` 后随该仓 PR 提交。市场
构建按 submodule 钉扎读取该仓的 `presets/`，因此预设在该仓合并后，还要由维护者
移动本仓 `satellites/dsh-presets` 的 gitlink 并重建 `market/dist` 才到达
dsh-market.com。预设启用后运行在 DSH 宿主进程内，PR 描述需说明 composition
挂载了什么、为什么。

### 范围边界

新增内置插件包 / 全新功能不属于内容贡献：仅接受 Issue，确认后由维护者
实现（`node scripts/dsh-plugin-new <name>` 等脚手架命令供维护者使用）。
内部新增 / 删除包或改皮肤清单时，同步更新
[docs/publish-prep.md](docs/publish-prep.md) 的发布清单快照。

## 文档体系

仓库采用分层指令（渐进式上下文），写代码 / 写文档前按需阅读：

| 文件 | 内容 | 何时读 |
| --- | --- | --- |
| [AGENTS.md](AGENTS.md) | 布局、命令、全局约定、开发与贡献流程 | 每个会话 |
| [packages/AGENTS.md](packages/AGENTS.md) | 包级规则：SDK 约束、bundle 形态、测试纪律 | 改 packages/ 前 |
| [docs/AGENTS.md](docs/AGENTS.md) | 文档标准：结构分层、写作规则、i18n 配对 | 写文档前 |
| 各包 `AGENTS.md` | 该包特有规则（如 dsh-ssh 安全模型） | 改对应包前 |
| [docs/architecture.md](docs/architecture.md) | 架构总览与运行时全景 | 了解整体架构时 |
| [docs/plugins.md](docs/plugins.md) | 新插件入桶规范与脚手架 | 新增或改造插件时 |
| [docs/development.md](docs/development.md) | 日常开发与发布流程 | 需要细节时 |
| [docs/i18n.md](docs/i18n.md) | 双语文档配对契约 | 改 README 时 |

## 发布

发布由维护者推送 `vX.Y.Z` tag 触发（`.github/workflows/release.yml`），tag 是
版本唯一来源；`scripts/verify-version.mjs` 校验每个包版本与 tag 一致。
贡献者无需关心发布，但新增包时必须保证包版本与仓库版本节奏一致。

## Issue 与讨论

- Bug / 功能请求用 [Issue 模板](.github/ISSUE_TEMPLATE/standard_issue.yml) 提交，
  Bug 用「Bug 报告」表单（自动附加 `bug` 标签），需附截图、冒烟测试与引用代码；
- 社区交流见根 README 的「社区」小节；
- 提 Issue 前先按标签检索（`bug` / `enhancement` / `question` /
  `good first issue` / `duplicate`）并搜索关键词，确认没有重复再提交；
- 标签体系、分类标准与关闭流程见 [ISSUE_TRIAGE.md](ISSUE_TRIAGE.md)；
- 已解决、重复或已回答的 Issue 会被维护者关闭并附说明，如需继续跟进请
  在评论区说明或重开。
