# Agent Note: 脚本测试跳过未构建的 better-session 产物

Status: implemented

## Problem

`dsh-better-session` 维护 CLI 从 `packages/dsh-perf/lib/better-session-import.mjs` 加载核心——这是 dsh-perf 包被 gitignore 的构建产物。`scripts/dsh-better-session.test.mjs` 里有三个测试要经过该产物，而 deploy-market 一致性门禁在全新 checkout 上直接跑 `test:scripts`、没有构建步骤，于是报出三个 module-not-found 失败；ci.yml 之所以通过，是因为它的 Build 步骤先于测试，本地跑通过则是因为本机有构建产物。门禁自身最该暴露问题的场景反而完全失明。

## Decision

依赖产物的测试在 runner 产物缺失时显式 skip，原因里写明补救方式（`packages/dsh-perf/lib/better-session-import.mjs is a build artifact; run pnpm build first`）；parseArgv 测试不依赖产物，始终运行。因此免构建一致性门禁（deploy-market 以及任何全新 checkout 的 `test:scripts`）跑除产物依赖用例之外的完整套件，而 ci.yml 构建后仍全量覆盖它们。CLI 的 `loadCore()` 遇到缺失产物时也给出同样的可操作提示，而不是裸的 module-not-found 错误。

## Alternatives considered

- 把产物提交进 git：否决；`packages/dsh-perf/lib/` 之所以 gitignore，是因为 bundle 内嵌构建 checkout 的绝对路径（CSS-module 哈希与 `\0dsh-css` region 标记），提交的产物逐机器不可复现。
- 让 deploy-market 测试前先构建：否决；market 门禁的存在意义就是免构建校验已提交产物，在那里构建会拖慢部署通道，并重新引入已提交产物检查所要规避的逐 checkout 不确定性。
- 把解码/存储核心内联进脚本：否决；该核心按设计由 dsh-perf 设置卡共享（CLI 与 GUI 同一实现），内联等于分叉存储语义。

## Consequences

全新 checkout 不先构建就永远跑不到那三个产物依赖测试——skip 原因已写明——这意味着免构建通道里 `test:scripts` 变绿不再隐含 better-session 接线被实际执行；该覆盖由 ci.yml 构建后与本地运行承担。今后任何脚本测试若要 import 包构建产物，必须声明同样的 skip 模式，否则 deploy-market 门禁会退化回 module-not-found 失败。

## Testing

本地验证了两条路径：把产物移走后套件报告 1 pass / 3 skipped / 0 fail，skip 原因含补救方式；产物还原后完整 226 项脚本套件全部通过。修复推送后在 dev 上手动触发 deploy-market workflow，端到端成功完成。
