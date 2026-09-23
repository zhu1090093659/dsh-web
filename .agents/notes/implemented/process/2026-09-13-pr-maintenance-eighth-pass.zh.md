# Agent Note: PR maintenance run 2026-09-13 (eighth pass) — dual-plugin registration #1529 merged; seven registrations re-confirmed author-blocked

Status: implemented

## Problem

`zhu1090093659/dsh-web` 的第八轮维护，距第七轮数小时。默认范围：分配给维护者账号的 8 个开放 PR——此前各轮遗留的 7 个被作者阻塞的登记 PR，加上当天早晨新开的 #1529（PerryLink 登记 dsh-auto-review 与 dsh-permission-rules）——不扫描 Issue。本轮要回答：新的双插件登记是否通过强制三轴验收（实用性、稳定性、兼容性），以及遗留 PR 是否有进展。

## Decision

合并 1 个 PR（#1529），发出 1 份首次通过的 approve review，批准 2 条首次贡献者工作流，确认 7 个 PR 仍被作者阻塞。

#1529 以纯数据条目登记两个 security 类插件（community.json 加派生的 market/dist/manifest/plugins.json；rank 59/60）。实用性成立：dsh-auto-review 在 approval/request 应答链上挂第二模型复核，按工具粒度 ai/human/never 分流、默认失败关闭——与索引中已有的 dsh-approve-for-me 启发式自动放行是不同机制，且按上游 README 的瀑布位置说明可组合；dsh-permission-rules 在 tools/pre-execute 上加有序 allow/deny/ask 规则，并用仅绑定回环的本地代理管控 shell 子进程网络，索引中没有同类能力，网络模式映射官方沙箱预设而非替代。稳定性证据：npm 分别 24/34 个版本（8 月中旬起），GitHub release 与 npm 一一对应，上游 ci/compat/plugin-doctor/scorecard 全绿，本地实跑上游测试 291/291（dsh-auto-review）与 349 过加 1 跳过（dsh-permission-rules），tarball 随包发布预构建 lib/ 与 cordis.patch.yml、无 preinstall/postinstall 钩子，源码扫描未发现外联/遥测/凭证收集模式（vendor/ 是伴生插件兼容测试 fixture），依赖为官方 @deepseek-ai/* 加 react/yaml/zod/chokidar。兼容性证据：两包都满足 cordis bundle 标准（dsh.bundle.patch、web 半区 4 个官方 dsh-client-* 注入），patch 各只有一条 insert 行、命名空间独立、与现有条目无 id/name 冲突，security/policy 是合法分类对，工坊安装路径解析条目 npm 字段（`dsh plugin --profile web add <npm>`，packages/dsh-market/src/client/install-source.ts:24）指向真实发布的包——#1526 的失败模式不适用。review 中留了一条非阻塞提示：tsdown/typescript/@types/react 放在 dependencies 而非 devDependencies。approve review 提交后以 merge commit eaed6042f 合入。

仓库侧验证在 PR head 的专用 worktree 完成：community-index --check 通过（60 entries）；market-build --check 确认提交的 manifest 与从 community.json 重新派生的结果逐字节一致（2275 files）；community-index 加 market-layout 契约测试 18/18 通过。仓库自身 CI 在该 PR 上跑的 plugin-mount 任务通过，补上了本轮未在本机重跑的运行时挂载证据（运行中的 DSH 服务不得重启）。

7 个遗留 PR（#1399、#1467、#1479、#1488、#1514、#1519、#1526）只读复核：最新一轮 CHANGES_REQUESTED review 之后均无新提交、也无作者评论，各自维持原 review 继续等作者；#1399 另外仍处于 CONFLICTING 状态。

日常事务：PerryLink 是首次贡献者，#1529 的 CI 与 agent-notes-guard 两条运行卡在 action_required，已批准以便必需检查执行。

## Alternatives considered

以本机运行时挂载验证为阻塞项被否决：运行中的 DSH 服务不得中断或重启，而仓库自身 CI 对登记 PR 运行 plugin-mount 任务且在该 head 上为绿色，挂载面已在不打扰本地服务的前提下得到验证。

把 dependencies/devDependencies 放错位置当作阻塞项被否决：它只增加安装体积，无行为或安全影响，索引登记不以依赖卫生为门槛；已在 review 中记录，供作者上游修正。

## Consequences

origin/dev 带 eaed6042f；社区索引现展示 60 个插件，其中包含同一作者的两个 security/policy 条目，二者按设计可组合（permission-rules 的 ask 接缝可路由到 auto-review）。7 个登记 PR 继续开放且等作者，修复指引已在案。本轮把登记评审先例扩展到单 PR 双插件，并把 npm 路径安装检查（install-source.ts）记录为判别条件——npm 字段有效时不需要上游提交 lib/。

## Testing

PR head 94877e8ae（基线 origin/dev f5190be20）的 worktree：node scripts/community-index --check（OK，60 entries）；node scripts/market-build --check（dist up to date，2275 files）；node --test scripts/community-index.test.mjs scripts/market-layout.test.mjs（18/18）。上游临时克隆实跑：dsh-auto-review vitest 291/291，dsh-permission-rules vitest 349 过加 1 跳过。批准后 PR 检查全绿（含 CI 与 plugin-mount）；合并前 merge state 为 CLEAN。review 提交、工作流批准与合并均通过 gh pr view 与 API 确认。
