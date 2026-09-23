# Agent Note: PR 维护轮 2026-09-11（第二轮）— 两个皮肤侧 PR 合入，三个登记退回，一个批准等 CI

Status: implemented

## Problem

当日第二轮 `zhu1090093659/dsh-web` 维护，覆盖分配给维护者账号的全部九个开放 PR：五个等待首次或复审（#1489 冰晶公主皮肤、#1484 whalechan-harness 皮肤、#1476 blue-fantasy 可读性后续、#1488 bwm-friend 插件登记、#1479 voice-talk 插件登记），一个反馈更新复审（#1467 dsh-thread-tools，作者已回应早间评审），三个仍卡在作者侧（#1399、#1321、#1318）。插件登记必须完成实用性 / 稳定性 / 兼容性三项证据分析并附本地实测；视觉改动必须真的看截图，而不是只确认截图存在。

## Decision

#1489 与 #1476 评审通过，以合并提交合入 `dev`（`08d5869c`、`b890a796`）。#1488 与 #1484 已批准，合入被必需 CI / rebase 阻塞。#1479 与 #1467 退回修改。三个作者阻塞的登记保持原状。

#1489 冰晶公主 — 独立 worktree 门禁全绿（`market-build --check`、`skin-center:check`、`i18n:check`、`docs:check`、`dsh-skin validate` PASS，无哈希后缀选择器）。两张预览图已核；明暗两态逐像素一致是明示的设计（暗色专用皮肤，与 #1464 同例）。Apache-2.0 与背景立绘 attribution 均在 `skin.json` 声明。已合入。

#1476 blue-fantasy 后续 — 同一门禁全绿，validate PASS，含 #1468 以来既有的四条 hash 选择器 warning。八项改动各带取舍说明，还记录了两条未采纳的实验。两张证据截图已核：插画上的文字可读性明显改善。记录一条非阻塞观察：亮色主题下代码块与回合状态 / 页脚几行仍偏淡。已合入。

#1488 bwm-friend — 三项审查均有实证。隔离 `DSH_HOME` 挂载探测（当前宿主线 dsh 0.1.5-rc.1，插件显式锁定 npm 0.6.0）：启动干净，`/bwm-friend/health` 返回 `{"ok":true,"version":"0.6.0"}`，原生根路径不受影响，companion 页面完整带样式渲染。代码级边界核查：宿主端从 `~/.dsh/.credentials.yaml` 读取的 `DEEPSEEK_API_KEY` 只发往 api.deepseek.com；语音只在配置了 `XIAOMI_MIMO_API_KEY` 后发小米 MiMo；云登录 / 更新路径（BWM_AUTH_BASE / BWM_UPDATE_URL）未配置时休眠。cordis patch 纯 insert。已批准——但必需 CI 抓到一个我本地门禁漏掉的契约失败：`scripts/market-layout.test.mjs`（plugins.json 契约）要求每个已分类条目带 `subcategory`，bwm-friend 条目没有。已在 PR 上留言给出一行修复建议（建议 `"subcategory": "chat"`），检查全绿之前合入保持阻塞。

#1484 whalechan-harness — 同一套皮肤门禁全绿；validate PASS 带两条 hash 选择器 warning（既有先例）。预览已核：干净克制的蓝色系设计，角色以角落水印存在；CC BY-NC-SA 4.0 与 NOTICE 声明完整。已批准，但其 CI 跑出 `packages/dsh-ssh` ProxyCommand EPIPE 既有失败（分支早于 12:36 的 dev 修复）与一个旧基线的 task-board 断言；已请作者 rebase 到 `origin/dev` 后重跑 CI 再合入。

#1479 voice-talk — 退回。硬性启动不兼容：插件（登记叙述的 0.1.1 与当前 latest 0.2.0 都一样）在模块顶层从 `@deepseek-ai/dsh-settings` 导入 `installSettingsSection` / `settingsNamespace`，而 0.1.5-rc.1 宿主 SDK 没有这两个导出，加载失败导致**整个 profile 启动中止**，不只是该插件不可用。声明的 peer 范围 `^0.1.0-rc.7`（<0.2）覆盖当前线，声明超出实际。索引侧工作干净（community-index OK、market-build 重新生成零漂移），凭据边界也干净（密钥留在宿主侧、只发往 DashScope / 讯飞的 websocket 端点）。上游在 PR 叙述停在 0.1.1 之后又发了 0.2.0——条目没有版本字段，工坊会装最新版；已向作者指出。

#1467 dsh-thread-tools（反馈更新）— 早间的三个阻塞全部核实解决：npm 字段已删（经已提交的 `lib/` 走 git 安装）、稳定性证据补齐（免凭据 npm test、GitHub Actions、v0.1.0 tag 与 release）、模板补齐且检查全绿。worktree 复验：community-index OK（59 entries）、索引单测 9/9、market-build 重新生成零漂移。卡在 action_required 的 CI run 已由维护者批准。作者"红灯是既有 ssh flake"的申诉已核实（dev 上 `fix(ssh)` run 34599812650 已修）。剩余阻塞：`dsh.engines.dsh >=0.1.2-rc.1 <0.2` 在语义上覆盖了 0.1.5 线，而该包自己的 llms.txt 明确不 claim 0.1.5；宿主不强制这个字段，当前线用户会把插件装进它不支持的宿主。已请作者二选一：适配 0.1.5 线（首选），或把声明收窄到实际验证过的线。

#1399、#1321、#1318 自 changes-requested 评审后无作者提交或回复，保持原状。

另记录一条对后续探测有用的工具链发现：pnpm 默认的 minimum-release-age 门会让新发布版本在约一天内解析不到——dist-tags.latest 已是 0.6.0 时，`dsh plugin add dsh-plugin-bwm-friend` 在 CLI 内置 pnpm 11.9 与 shell pnpm 11.26（缓存均已刷新）上都解析到 0.3.1；`--config.minimum-release-age=0` 可恢复解析当前版。这是环境行为而非包缺陷；探测时应显式锁定被评审的版本。

## Alternatives considered

用管理员权限越过失败必需检查合入 #1488 被否决：ruleset 要求检查全绿，维护规则禁止在任何必需门失败时合并；对活跃作者而言一行修复成本极低。直接向贡献者 fork 推送 subcategory 修复被否决：作者数小时前刚推送，一条评论即可在会话中送达，代推过于侵入。以亮色主题偏淡阻塞 #1476 被否决：每个被改元素都比已合入基线更可读，观察记录下来留给后续即可。以 CI 失败阻塞 #1484 时先做了归因——两处失败均为既有问题且 dev 已修复——但必需检查不绿禁止合入，因此 rebase 是必经路径。以明暗像素一致阻塞 #1489 被否决：PR 明示了意图，暗色设计就是产品本体，且 #1464 已开先例。

## Consequences

`dev` 带上 blue-fantasy 可读性后续（`b890a796`）与冰晶公主皮肤（`08d5869c`；目录 33 个仓库皮肤）。四个 PR 等作者动作后继续：#1488（一行 subcategory）、#1484（rebase 到当前 dev）、#1467（engines 声明如实化）、#1479（适配 0.1.5 线）。三个登记仍卡作者侧。早间 pass 记录为开放缺口的 ssh EPIPE flake 已由 `e92a7f56` 在 dev 上关闭。本仓库的登记评审今后必须把 `node --test scripts/market-layout.test.mjs` 与 community-index、market-build 并列执行——只跑 community-index 不覆盖 subcategory 契约。

## Testing

每个 PR 使用独立 detached worktree，node_modules 从主检出软链。皮肤（#1489、#1484、#1476）：`node scripts/market-build --check`、`node scripts/skin-center-catalog-check --check`、`node scripts/i18n-audit.mjs --check`、`node scripts/verify-docs.mjs`、`node scripts/dsh-skin validate <dir>`，并直接查看预览 / 证据图。登记（#1488、#1479、#1467）：`node scripts/community-index`、`node scripts/community-index --check`、`node scripts/market-build`（重新生成必须零漂移）、`node --test scripts/community-index.test.mjs`；#1488 另用 `scripts/market-layout.test.mjs` 复现了 CI 失败。#1488 的挂载探测在隔离 `DSH_HOME` 下以 `dsh --profile <probe> --port 3791 --host 127.0.0.1 --no-open` 启动插件 0.6.0，随后 curl 核对 `/bwm-friend/health`（200，version 0.6.0）、原生根路径（无 token 401 / 带 token 303），并无头截图 companion 页面；验证完成后探测进程已停止。#1479 的探测在当前宿主线上复现了启动中止。#1489、#1484、#1467、#1488 分支上卡在 action_required 的 workflow run 均已批准，使完整门禁得以运行。
