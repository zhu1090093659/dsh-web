# Agent Note: 根 README 的 DSH 兼容版本徽章

Status: implemented

## Problem

根 README 的徽章行只展示生态自身的指标（release、stars、forks、npm、users、license），从未说明插件家族兼容哪个 DeepSeek Harness（DSH）版本。用户想知道当前 dsh-web 能否跑在自己的 DSH 上，只能去读包元数据（聚合包的 `dsh.engines.dsh` 下限）或发布说明，而生态话题里其他插件早已展示各自的 DSH 版本徽章。

## Decision

根 README 双语对（README.md、README.en.md）在同一个居中徽章行新增一枚静态 shields.io 徽章，内容为 `DSH | 0.1.2-alpha.1`（slate 色标签段、indigo 色数值段、flat-square），链接到 npm 包 `@deepseek-ai/dsh`，位置在 users 徽章与 license 徽章之间。展示值是当前 SDK cohort 经过验证的最新 DSH 版本：与 pnpm-workspace.yaml、shared/package.json 及各包 devDependencies 钉住的 cohort 一致——自 0.1.2-alpha.1 源码构建预览起，该值可以领先 npm registry（`@deepseek-ai/dsh` 的 latest 在 cohort 发布前保持 0.1.1-rc.2）。该版本号在 SDK cohort 升级流程内手动随升级更新——该流程本就要对整个家族对照目标版本重新验证。徽章只做展示，不是机器校验的契约：packages/dsh-web-all/package.json 的 `dsh.engines.dsh` 仍是机器可读的兼容下限。

## Alternatives considered

- 在 dsh-market worker 上加动态端点、从已发布的 npm tarball 读 `dsh.engines.dsh`：被否决；为一个只在 SDK cohort 变化时才会变动的值引入 worker 路由、测试、部署与 tarball 解析，而 npm 徽章端点 Note 已确立「公开静态值够用时不加活动部件」的先例。若手动更新被证明不可靠，可在同一 worker 上用端点取代本决策。
- 实时「支持版 vs 最新 DSH」比对徽章（最新版落在支持区间内显示绿色，否则红色）：被否决；更强信号伴随持续的 correctness 风险——上游每次在 dsh-web 完成验证升级前发新版，徽章都会在仓库零改动的情况下变红，且同样需要端点基础设施。
- 用 GitHub Action 或 gist 定时更新的 shields 静态徽章：被否决，理由同 npm 徽章端点 Note——纯静态 URL 就能解决的事不引入第二个活动部件。

## Consequences

- 徽章行在两种语言下一眼可见 DSH 兼容版本；该值相对 cohort 升级最多滞后一次手动修改，README 双语对按 i18n 契约同改。
- 若上游 DSH 新版先于升级流程发布，徽章表现为低估兼容性（显示旧的已验证版本）而非宣称未验证的支持；设计上不存在红色状态。
- 验证：shields 返回徽章 HTTP 200，渲染标签 DSH 与数值 0.1.2--alpha.1（2026-08-29 随 cohort 升级复核）；npm registry 上 `@deepseek-ai/dsh` 最新版在预览 cohort 发布前保持 0.1.1-rc.2。
- 相关：[npm 徽章端点](../feature/2026-08-24-npm-badge-endpoint.zh.md)（徽章基础设施先例及其「不加活动部件」理由）、[banner 社交预览刷新](2026-08-24-banner-social-refresh.zh.md)（根 README 徽章行的归属规则）。
