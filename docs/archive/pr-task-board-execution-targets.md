# PR 草稿：任务看板任务级执行目标（按仓库 PR 模板填写）

> 归档用途的一次性记录；正式提 PR 时把各节内容复制进 GitHub PR 描述（保持模板完整）。

## 摘要（Summary）

为任务看板（dsh-task-board）增加任务级执行目标：每个任务可钉住 工作区 /
模式（agent 预设）/ 权限（沙箱预设）三项设置，执行时由 ExecutionService
在发送 Prompt 前应用；留空回退运行时默认（最近工作区 / 部署预设 / 会话默认）。
钉不住的目标（工作区缺失、会话非空白、预设被锁、权限命令无人认领）在发
Prompt 前失败并把原因写进执行记录，任务不会悄悄按未要求的设置运行。
属于对现有插件执行能力的增强（不是新增包 / 全新插件），按 CONTRIBUTING 的
范围规则可直接提 PR。对应 Issue：#256「任务看板：任务级执行目标——工作区 /
模式 / 权限（#125 子集与延伸）」，提交信息 subject 末尾追加 (#256)。

## 范围合规说明（Scope Justification）

本 PR 按 CONTRIBUTING 的接受范围归类为「修复 + 增强 / 优化」，而非全新功能：

1. **正确性修复（bug fix）**：任务执行取「最近使用的工作区」（recentWorkspaceId），
   在多工作区切换场景下任务会在错误的项目目录里执行——这正是 #125 P1 记录的
   正确性问题。本 PR 让任务可钉住工作区、执行前校验存在性、失效即报错，修复
   「任务跑错目录」这一用户可感知的缺陷。
2. **现有能力的增强（enhancement）**：模式与权限不是新功能面，而是对既有
   「真实执行」能力的参数化——此前用户每次执行前都要先手动切换会话预设、
   手动改权限，本 PR 把这两步变成任务的可选配置；三项字段全部可选、缺省
   行为与现状完全一致，数据模型向后兼容（键 dsh.taskBoard.v1 与旧数据均不变）。
3. **边界克制**：不新增包、不改 DSH 源码、不新增存储通道、不引入新的运行时
   服务，全部复用官方 SDK 既有契约（workspaces.connectWorkspace /
   agentPresets.select / session.command）；#125 其余范围（台账 host 化、归档、
   Agent 入口）刻意不在本 PR 内。

## 涉及包（Affected Packages）

- [x] 任务看板 packages/dsh-task-board
- [ ] Git 图谱 packages/dsh-git-graph
- [ ] 右侧面板 packages/dsh-aionui-panel
- [ ] 远程 Web UI packages/dsh-remote-web-ui
- [ ] SSH 远程运维 packages/dsh-ssh
- [ ] 实时令牌统计 packages/dsh-live-stats
- [ ] 宠物 packages/dsh-pet
- [ ] 皮肤 / 皮肤中心 packages/dsh-skins / packages/skins
- [ ] 聚合包 / 设置 packages/dsh-web-ui-all / packages/dsh-web-ui-settings
- [ ] 其他（请说明）

## PR 类型（PR Type）

- [x] 面向用户的功能或行为变更
- [ ] Bug 修复
- [x] 增强 / 优化（现有功能的改进、性能 / 体验优化）
- [ ] 仅文档
- [ ] 维护 / 重构

## 最新代码确认（Latest Codebase Confirmation）

- [x] 我已基于最新 main 分支开发，或在提交前已 rebase / 合并最新 main。

同步命令：git fetch origin && git pull --ff-only（已执行：a7716d8 -> 3647a33，
工作区与 origin/main 一致）。关联 Issue：#256。

## AI 编码披露（AI Coding Disclosure）

- [x] 完全 AI 编码：全部编程改动由 AI 产出，并由贡献者接受 / 审查。

使用的 AI 模型：DeepSeek（deepseek-chat 系列）

使用的编码 Agent 工具：DeepSeek Harness

## 仓库规范检查（Repo Rules）

- [x] 未修改 DSH 官方源码，仅基于官方 NPM SDK（@deepseek-ai/*）开发。
- [x] 未新增指向 DSH 源码 checkout 的 tsconfig extends / paths / references。
- [x] 新增包目录以 dsh- 前缀命名（本次未新增包）。
- [x] 所有新增 / 修改文件不含任何 emoji 字符（按 ci.yml 同语义全树扫描通过）。
- [x] 改动包 README 时同步维护中英双语三件套（README.md / README.zh.md /
  README.i18n.yaml）并运行 pnpm docs:check（已通过，配对 hash 已重录）。

## 贡献者版权声明（Contributor Copyright）

N/A（未新增插件 / 皮肤，维持现有版权归属）。

## 社区插件索引登记（Community Plugin Index）

N/A。

## 本地验证（Local Validation）

执行的命令：

```bash
pnpm typecheck
pnpm gallery:check && pnpm skin-center:check && pnpm community:check
pnpm build
pnpm test
pnpm test:scripts
pnpm runtime-deps:check && pnpm aggregate:check
pnpm docs:check
# emoji 全树扫描（与 ci.yml 内嵌脚本同语义）
pnpm --filter @linxin666/dsh-client-ui-task-board test
```

结果摘要：

- typecheck / build / gallery:check / skin-center:check / community:check /
  runtime-deps:check / aggregate:check / docs:check：全部通过。
- pnpm test：dsh-task-board 153/153 通过；全仓仅 dsh-pet 1 例失败，为存量
  Windows 平台问题（registry.test.ts 的 codexPetsDir 用 POSIX 路径断言，
  Linux CI 不受影响，与本次改动无关，git 工作区未触及 dsh-pet）。
- pnpm test:scripts：81/83 通过；2 例失败均为存量 Windows 平台问题
  （dsh-skin use 的 symlink EPERM 需管理员权限；sync-shared.test.mjs 用
  /src/client/ 正斜杠过滤 Windows 反斜杠路径），Linux CI 不受影响，与本次
  改动无关。
- emoji 全树扫描：通过。

## 用户可见变更证据（Local Feature Evidence）

证据：待补——需在本机 GUI 完成一轮人工验证后附截图（仓库所有者自审 PR 无
硬性截图门禁，但按 CONTRIBUTING 要求补齐）。验证路径：

1. 本机 web profile 已 link 到本仓库（web-ui-all -> dsh-task-board），
   packages/dsh-task-board 已 pnpm build。
2. 重启 dsh web（host 半边播报文案变更需重启；client bundle 页面刷新加载）。
3. 看板 -> 新建任务：出现 工作区/模式/权限 三个下拉；钉住三项后执行；验证
   执行会话落在指定工作区、列表行显示指定预设、会话权限选择器显示指定权限；
   有效组合（如 完全访问）与失败场景（如钉住已删除的工作区）各截一张图。
