# Agent Note: PR maintenance run 2026-09-15 (ninth pass) — one merge, one first review, six authors still blocked

Status: implemented

## Problem

`zhu1090093659/dsh-web` 的第九次维护巡检，距第八次数小时。默认范围：分配给维护者账号的八个开放 PR，不扫描 Issue。本轮要回答三个问题：#1577 在评审后的新提交是否解决了证据阻塞项；从未评审过的三皮肤投稿 #1582 能否通过强制评审；六个等作者的 PR 有没有动静。

## Decision

合入一个 PR，发布一个首轮评审（CHANGES_REQUESTED），六个等作者的 PR 只读复核维持原状，批准四个首次贡献者的 workflow 运行。

- #1577（dsh-stalled-turn-continue）以 0c282b026 合入。阻塞项是贡献证据检查；作者在 04:45 编辑了 PR 描述，检查复跑转绿，兑现第八轮「绿了就合入」的承诺。评审之后推的两个提交只是上游同步合并与一次 community.json 格式修正——用 `origin/dev...head` 的 diff 核实（25 行插入：一条登记 + 重新生成的清单，上游格式保持原样）。PR head 已包含到 #1575 为止的全部 dev 提交，所以在专用 worktree 上的试合并很干净：community-index OK（74 entries）、`market-build --check` exit 0。随后分支策略拦下了合并，因为 head 上的必需 CI 运行卡在首次贡献者门槛的 `action_required`；批准 CI 与 agent-notes-guard 两个运行让所有必需检查如实出结果，合入没有动用管理员旁路。
- #1582（hive-maw / ember-fall / astral-choir 三皮肤）以两项 CHANGES_REQUESTED 评审。阻塞项：astral-choir 的两张预览图是同一张截图的逐字节拷贝（各 87,902 字节），内容是贡献者与自己编码助手讨论「怎么处理这批截图」的对话——根本不是皮肤试穿图，第三套皮肤没有任何视觉证据，PR 描述里第三张「试穿图」实际把这段对话公开了。第二项：在合并树上跑 `market-build --check` 报告 46 个 `market/dist` 路径过期（三套 `assets/skins/` 拷贝、`manifest/skins.json`、`sitemap.xml`、`tryon-assets/skins/*`），描述里「已提交市场产物」与实际 diff 不符。其余全部在合并树上验证通过：`dsh-skin validate` 三套 PASS、catalog 检查 OK（38 skins）、每套 skin.css 覆盖 97/97 个非字体官方 token、CTA 的 fill/hover/dimmed/label-foreground 按主题块成对声明、patches 白名单干净（无 `rgb()`/`hsl()`/`color-mix`、无 `:global`、无哈希类名）、无性能规则违例、emoji 扫描干净、双语 README 与 CC0 LICENSE 齐全；虫巢与余烬的实拍图清晰可读，三套边缘语言确实互不相同。另有一条非阻塞意见：三套皮肤的 light.jpg 与 dark.jpg 都是同一个文件，而所有已收录皮肤（observatory、cyber-night、tokyo-night）都是两张不同实拍——light 那张的意义正是证明浅色系统下同样呈现完整暗色壳。

六个在途等作者的 PR（#1576、#1526、#1488、#1479、#1467、#1399）在既有评审之后没有新提交也没有回复，全部维持等作者状态。#1582 同样有两个卡在 `action_required` 的 workflow 运行，已批准，作者准备修改期间检查可以照常跑。

community.json 与市场清单现在带 74 个插件。本轮评审的 diff 都没有触及需要通知协作者的 Wallpaper Engine 域文件。

## Alternatives considered

立刻替 #1582 重新生成 `market/dist` 并推到贡献者 fork 被否决：作者确实在 PR 里请维护者代跑这一步，但在 astral-choir 预览图替换之前执行，会把错图烘进入库的市场产物——重建推迟到阻塞项解决之后。

#1577 被基础分支策略拦下时用 `--admin` 强合被否决：拦截原因是首次贡献者的 workflow 门槛而不是检查失败，批准卡住的两个运行就能得到完全诚实的绿，而不是教大家无视 ruleset。

对六个等作者的 PR 重新评审被否决：既有评审之后没有任何提交或回复，对相同的树再审一遍只会复述已经写下的意见。

## Consequences

origin/dev 带 0c282b026；工坊插件清单从 73 涨到 74。还有七个开放 PR：#1582 等作者补真实的 astral-choir 截图（之后按评审承诺由维护者侧跑 `market-build`），六个仍然等作者（#1576 视频重编码、#1526 npm 字段与 CI/lib、#1488 subcategory、#1479 宿主线适配、#1467 engines 声明、#1399 rebase/LICENSE/llm-pi-ai 来源）。错图替换之前，贡献者的会话侧栏会一直公开可见。本地收尾：`maint-pr-1577` 试合并分支已删除——它的树哈希与 origin/dev 逐字节一致（`git branch -d` 因 GitHub 自己的合并提交遮挡祖先关系而拒绝），删除走的是先验证等价再清理的路径。

## Testing

#1577 在从当时最新 `origin/dev` 合出的专用 worktree 上把关：试合并树上 community-index OK（74 entries）、`market-build --check` exit 0；批准的 workflow 跑完后 PR head 上的仓库必需 CI 检查全绿，并在 origin/dev 上确认了合并提交 0c282b026。#1582 的证据来自合并后的 worktree：`dsh-skin validate`（3 次 PASS）、skin-center catalog 检查、逐皮肤对照 `contracts/official-tokens-v1.json` 的 token 覆盖（97/97）、白名单与性能 grep、emoji 扫描，以及 `market-build --check`——它报出的 46 条过期路径就是记录在案的问题。本轮没有跑完整仓库闸门（typecheck / test / docs:check / i18n:check）——#1582 尚未合入，完整闸门留到那次合并前执行。
