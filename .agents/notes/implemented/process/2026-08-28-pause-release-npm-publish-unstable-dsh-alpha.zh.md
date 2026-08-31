# Agent Note: 暂停发布管线的自动 npm 发布

Status: implemented

> 已在 `@deepseek-ai/*` 0.1.2-alpha.2 cohort 发布到 npm 的 `alpha` dist-tag 后被 [restore-npm-publish-alpha.2](2026-08-30-restore-npm-publish-alpha.2.md) 取代；本记录仅存档暂停决策及其设计。

## Problem

既有的 tag 驱动发布管线会在 vX.Y.Z tag 推送的瞬间把所有家族包发布到 npm。家族包构建依赖的 @deepseek-ai/* DSH alpha 组件群高度不稳定且未发布到 npm，推 tag 就会把依赖范围无法从 registry 解析的包发上去——对真实的 npm 使用者是一次坏发布，而且对该版本不可逆（已发布的版本无法重跑一次失败的发布）。同样的缺口让发布后的 npm 严格挂载冒烟在其持续期间失去意义：它会断言 registry 根本提供不了的解析能力。

## Decision

`.github/workflows/release.yml` 增加了工作流级环境开关 `NPM_PUBLISH_ENABLED`，当前取值 `'false'`。两个发布步骤——`pnpm -r publish` 与旧聚合包双发布——都通过 `if: env.NPM_PUBLISH_ENABLED == 'true'` 门控，暂停期间被跳过。tag 推送仍会校验每个包版本与 tag 一致、跑完整门禁（typecheck、构建、测试、脚本测试、aggregate、skin-center、运行时依赖检查）、生成发布说明、运行聚合包挂载冒烟——其 auto 改写会把每个未发布的家族依赖从 workspace 打成 file: tarball，因此冒烟验证的是该 tag 自身的构建——然后创建 GitHub Release。把开关改回 `'true'` 即可恢复发布步骤与 npm 严格 registry 断言，无需其他改动。

## Alternatives considered

直接删除发布步骤会丢掉整条通道：重新启用时要从 git 历史重建这些步骤（dist-tag 处理、NPM_TOKEN 接线、旧聚合包双发布规则）。改用仓库变量或 workflow_dispatch 输入而不是提交进文件的 env 开关，会牺牲可评审性与确定性：暂停/启用状态将保存在仓库设置或一次手工触发里而非被评审的文件中，且 tag 触发的运行无法接收 dispatch 输入。暂停期间跳过挂载冒烟会丢掉该 tag 仅剩的真实消费者验证；auto 模式让冒烟在没有 npm 的前提下依然有效。

## Consequences

tag 不再向 npm 发布任何内容：GitHub Release 成为翻转开关前唯一的发布产物，npm 使用者继续解析最后已发布的家族版本、拿不到暂停后的变更——关于已发布包的行为问题必须查已发布版本而不是仓库 HEAD。暂停通过发布提交生效：GitHub Actions 读取 tag 所指提交上的工作流文件，因此在本变更之前切出的 tag 仍会自动发布。重新启用的前提是家族依赖的 @deepseek-ai/* 组件群在真实安装路径中可解析；过早启用即使通道打开，发布的包也无法解析其 DSH 依赖。
