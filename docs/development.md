# 开发流程（development）

dsh-web 是 DeepSeek Harness Web 的插件 monorepo（皮肤以「皮肤」插件的资产包形式存在）。本文定义
贡献者日常流程；仓库规则见根 [AGENTS.md](../AGENTS.md)，包级规则见
[packages/AGENTS.md](../packages/AGENTS.md)，文档标准见 [AGENTS.md](AGENTS.md)。

## 环境准备

- Node.js >= 22 与 pnpm 11；
- 依赖解析官方 NPM SDK（registry.npmjs.org）。仍使用私有 scope 认证时需
  `NPM_TOKEN` 环境变量（真实令牌只放环境变量，勿提交）；token 配置放
  用户级 `~/.npmrc`，项目 `.npmrc` 只留 scope 映射（见
[plugins.md](plugins.md)）。

## 分支模型

- `dev`：开发分支（集成分支），本地开发与远程 PR 的统一目标；提交 /
  提 PR 前先 `git fetch origin && git rebase origin/dev` 同步上游最新代码。
- `main`：稳定分支，只接收从 `dev` 合入且测试通过的代码；`dev` 上
  验证通过后由维护者合入 `main`（发布 tag 仍从 `main` 打）。

## 日常循环

```sh
pnpm install
pnpm -r build          # 全仓构建
pnpm typecheck        # 全仓类型检查
pnpm test             # 全仓单测
pnpm docs:check       # 文档一致性（链接 / README / i18n 配对）
```

改动提交前至少跑 `pnpm typecheck && pnpm test && pnpm docs:check`；CI 会
全量跑所有门禁（typecheck / build / test / aggregate / market /
skin-center / docs / emoji）。

## 常见任务

### 审核远程 PR

维护者可用 `node scripts/pr-review.mjs` 本地批量审核外部 PR（一次多个，
如 `--open` 审核全部 open PR）：先做静态硬性检查（规模上限新增/删除各
1 万行直接拒绝、禁止提交依赖缓存与密钥、emoji 扫描、PR 模板必填项、
密钥扫描、CI 文件保护），再在工作区 worktree 上按 CI 门禁序列构建验证
（install/typecheck/market/skin-center/community/build/test/
test:scripts/aggregate/docs）。worktree 与 e2e 验证统一放在
`~/remote-e2e`（同 head 复用，跑完保留便于排查），定期用
`pnpm pr:review --cleanup` 或手动 `rm -rf ~/remote-e2e` 清理。

外部 PR 的模板硬检查含「测试证据与上游同步」与「视觉修复要求」：贡献者
必须提供自己本地测试的证据，并附上同步上游最新 `dev` 分支后重新测试
通过的证据；文本类改动可不附截图，视觉修复 / 用户可见变更必须附截图，
且视觉修复必须使用支持图像输入的多模态模型完成（纯文本模型如
deepseek-chat / deepseek-reasoner / gpt-3.5 直接拒绝）。缺失即 REJECT；
`.github/workflows/pr-contribution-rules.yml` 在 CI 侧同步拦截（评论 + 挂红）。

皮肤 PR 额外自动做视觉验证：生成亮/暗预览截图（
`~/remote-e2e/e2e-<pr>/previews/`），像素指标分析自动判定过曝
（太闪）与对比度不足（看不清），截图供视觉模型复核；同时提醒
作者声明贡献者版权（模板「贡献者版权声明」节），并检查新皮肤
是否提供 `preview/{light,dark}.png`（市场清单自动派生，缺图即警告）。
用法与 verdict 语义见脚本头部注释；`pnpm pr:review --help` 查看全部选项。

### 修改 shared 运行时模块

shared/ 是 settings 卡片、轮询护栏、DSH_HOME 解析等跨包模块的唯一事实源；各包内的
同名文件是 scripts/sync-shared.mjs 生成的同步副本。改 shared 源后运行
node scripts/sync-shared.mjs 并把副本一并提交；pnpm test:scripts 的 drift 门禁防止副本漂移。

### 新增插件包

```sh
node scripts/dsh-plugin-new <name>   # 生成 packages/<name>/ 骨架
```

然后按 [plugins.md](plugins.md) 把包注册进聚合包（aggregate.yml 的
`patchFrom` 与 `deps`），跑 `node scripts/aggregate.mjs` 重新生成聚合包。
新包必须自带 README 三件套（`README.md` + `README.zh.md` +
`README.i18n.yaml`）与测试。

### 新增皮肤

```sh
node scripts/dsh-skin-new          # 生成 packages/skins/skin-center/skins/<id>/ 纯资产骨架
node scripts/capture-previews <id>  # 重拍 preview/{light,dark}.png
pnpm market:build                # 刷新市场产物（market/dist）
node scripts/skins-montage.mjs    # 重排根 README 皮肤一览图（docs/images/skins-montage.png）
```

皮肤启用互斥由 `dsh-skin use` 管理（客户端原子切换，不改 cordis.patch.yml）；皮肤资产全部内置在皮肤中心包，不单独发 npm 包。

### 本地验证（挂载进 dsh web）

```sh
node scripts/link-profile.mjs      # 把全家桶链接进 web profile
dsh plugin --profile web add link:<仓库绝对路径>/packages/dsh-web-all
dsh web                            # 重启后侧边栏出现插件入口
```

## 发布

发布流程见 [publish-prep.md](publish-prep.md) 与 .github/workflows/
release.yml：推送 vX.Y.Z tag 触发发布，tag 是版本唯一来源，
`scripts/verify-version.mjs` 在发布前校验每个包版本与 tag 一致。

## 文档纪律

- 任何改动触及 README / AGENTS.md / docs/ 描述的行为时，同 PR 更新文档；
- 改包 README 任一侧后，同步另一侧并 `pnpm docs:write-pair <包名>`；
- 一次性记录（任务交接、验证快照）放 `docs/archive/`，不进长期文档目录。
