# Agent Note: PR maintenance run 2026-09-13 (fifth pass) — Observatory skin merged, three registrations and the bubble blur knob blocked on authors

Status: implemented

## Problem

第五次维护巡检，距第四次一天，目标仓库 `zhu1090093659/dsh-web`。默认范围：分配给维护者账号的十个开放 PR（Observatory #1518、气泡模糊 #1516、whale-girl #1514 是第四次八项之外的新成员），不扫描 Issue。第四次以两次合并、六个 PR 等作者收尾；本次要回答的是四个新 PR 能否过闸、以及被阻塞的作者是否有过动静。

## Decision

合并一个 PR，新留三份评审，六个 PR 继续等作者。

#1518（Observatory 皮肤，新皮肤收录，替代被机器人关闭的 #1511）：在 PR head 的独立 worktree 里完成核验——`dsh-skin validate` PASS、`market-build --check` 确认提交的 dist（含 zip hash manifest）与源一致、`skin-center:check` / `i18n:check` / `docs:check` 全过、CI 绿。内容审查确认：暗色专用 token 结构与 ice-princess 先例同构，`body::after` 地层在 `body[data-dsh-wallpaper-active]` 下让位，挂点全部走注册表校验且带惰性回退，品牌行 CJK `content` 串与 black-gold / ice-princess / phoebe-atelier 的既有做法一致。批准并以 merge commit 合入（6ce63031f）。

#1488（bwm-friend 登记）：此前的批准发生在 CI 出结果之前；必需的 `CI checks` 在 `scripts/market-layout.test.mjs` 的 plugins.json 契约上失败——条目设了 `category: "ui"` 但没有 `subcategory`，PR 自带重生成的 dist 也带着这个违规。评审改为 CHANGES_REQUESTED 并给出准确修复路径（从 `ui` 枚举补 `subcategory`，再重新生成 `market/dist`）。本次巡检还确认了一个长期存在的不一致：`scripts/community-index` 的 `pnpm community:check` 校验器允许分类条目省略 `subcategory`，而 market 产物契约要求必填——两个门口径不一，CI 是实际生效的那个。该不一致本身作为发现留档，未在本次处理。

#1516（气泡模糊滑杆，皮肤中心客户端）：实现端到端镜像现有 `bubbleOpacity` 旋钮（字段、钳制、apply/dispose 成对、测试、lib 与聚合包重建加指纹、en/zh 文案）。阻塞在一处跨皮肤后果：blue-fantasy 的用户气泡读 `blur(var(--dsh-skin-bubble-blur, 12px))`，其余用法全部回退 10px——控制器把变量写到 `body` 之后 12px 回退失效，默认观感漂移。CHANGES_REQUESTED 给出修复模式 `calc(var(--dsh-skin-bubble-blur, 10px) * 1.2)`，与同一条规则上方已有的 alpha 120% 补偿对齐。本次记录的通用规则：新增 body 级 CSS 变量的默认值必须等于皮肤侧的主导回退值，否则元素间的层级差会被静默抹平。

#1514（whale-girl 登记，第三方插件准入）：强制三轴审查在插件本体上全部通过——MIT、lib/ 已提交（`dsh plugin add` 免构建安装）、上游 16 个测试本地全过、维护活跃且有如实的回归回退记录、只注入官方服务（`webServer` / `credentials` / `timer` / `tokenMeter` / `sessions` / `agents`）、API key 只在服务端 resolve、web 档桥接用的 `apiServer.tapIndex` 经本机安装的 `@deepseek-ai/dsh-host-webserver` 类型确认为公开 API、路由全部在 `/dsh-whale-girl/*` 命名空间下、样式全 `.wg-` 前缀、外部请求仅限 DeepSeek 与 SiliconFlow 余额端点。PR 本身因两个登记契约缺口 CHANGES_REQUESTED：`market/dist` 未重新生成（条目到不了创意工坊商店，且所有人的 `pnpm market:check` 会挂）、`community.json` 末尾换行被去掉。非阻塞备注：诊断日志无限增长、卸载后 `DSH_HOME` 残留三个 `.whale-girl-*` 文件。

#1502（Miku 重设计）：内容批准——明暗两套预览渲染正确、三处 0.1.5 外壳回归修复属实（`_pane` 子串误命中改走 `[data-pane]`、`border-image` 长手加 `!important` 以在 important 简写下存活、发送按钮正圆交还 shell 只留 hover 边框）、背景改走 `contributes.backgroundMedia`，壁纸让位契约归引擎。对 `origin/dev` 做的只读 test merge 显示恰好一个冲突：`scripts/lib-artifact-fingerprints.json`——机械冲突，rebase 后 `pnpm build` + `pnpm libs:write` 即可解决。已按此指示批准；作者推送前合并保持阻塞。

延续的六个 PR 只读复查：#1479、#1467、#1399、#1321、#1318（全部 changes-requested）作者无动静，#1488 的状态见上。

## Alternatives considered

凭早前的批准直接合并 #1488 被否——ruleset 要求检查通过，而失败由 PR 自己的条目引起。向 fork 推一行 `subcategory` 修复被否：既定准则是 fork 推送只携带 rebase 更新、不替活跃作者分支改内容。合并 #1514 后自己补生成 `market/dist` 被否：登记 PR 归作者所有，明知不完整还合并会让所有本地检出的 `market:check` 在修复落地前一直挂。把 whale-girl 装进在用的 `DSH_HOME` 获取第一手运行证据被否：宿主服务共享且不得打扰，作者已在完全相同的版本上给出实机证据，源码级审查加上游测试足以覆盖准入问题。在本次巡检里顺手修掉 `subcategory` 双门不一致被否：那是超出维护范围的工具改动，需要自己的决策记录。

## Consequences

Observatory 皮肤已进 `origin/dev`。三项登记/旋钮（#1488、#1516、#1514）带着准确修复指引等作者，#1502 等机械 rebase；五项都保持分配阻塞。`subcategory` 双门不一致与「body 变量默认值必须匹配回退」规则分别留给未来的工具改动与未来的皮肤中心旋钮评审参考。最老的等作者 PR（#1318、#1321）已达十三天无动静。

## Testing

GitHub 状态经 `gh pr view` / `gh pr diff` / `gh run view`（评审、检查、合并状态、失败步骤日志）。独立 worktree 本地核验：#1518 跑了 `dsh-skin validate`、`market-build --check`、`skin-center-catalog-check --check`、`pnpm i18n:check`、`pnpm docs:check`；#1502 做了只读 `git merge --no-commit --no-ff origin/dev` 冲突探测（随即 abort）；#1514 克隆上游仓库并跑其 vitest 套件（16/16）。合并与评审在 GitHub 确认后，worktree 与临时克隆均已删除。
