# Agent Note: PR 维护运行 2026-09-15（第八次）——五单合并、两单首审、一次批量审计

Status: implemented

## Problem

`zhu1090093659/dsh-web` 的第八次维护运行，距第七次两天。默认范围：分配给维护者账号的十二个开放 PR，不扫描 Issue。本轮要回答：作者阻塞的 PR 有没有动静；评审后补交的两位作者是否逐项落实了反馈；五个从未审查的登记 PR（四个插件登记加 Binary Veil 皮肤）能否通过各自的强制审查。

## Decision

五单合并、两单首审（CHANGES_REQUESTED）、五个作者阻塞 PR 只读复核、六个首次贡献者工作流运行获批准。

每次合并都在独立工作树上先并入当时的最新 `origin/dev` 验证后再推送：

- #1514（dsh-whale-girl 挂件），合并提交 1507ba0a7。作者的重放逐项落实了第六次评审的两条阻塞项；重生成的 `market/dist` 与声称的差异完全一致（plugins.json +12 行、其余 manifest 日期戳归零），`market-build --check` 在合并树通过。
- #1519（dsh-desktop-shell），a71e699f0。审计覆盖了上游新版本而非沿用旧结论：npm `dsh-desktop-shell@1.1.1` 与 `v1.1.1` 标签逐字节一致；`readPreferences` 里 `raw?.autostart === true` 使登录自启缺省归为关闭；`cleanupInstall` 删除全部自建快捷方式与启动器目录；随包 `assets/SHA256SUMS.txt` 六个预编译产物本地校验全过——第七次的预编译来源关注点就此关闭。
- #1542（dsh-delete-session），4bcb27306。插件删除用户会话数据，审查不止于读源码：在 `/tmp` 用 mock cordis 上下文驱动真实 `deleteSession` 做沙箱实测——只删两个 workspace 里的目标会话目录、兄弟会话与无关文件原样保留、穿越 id 返回 400、非回环 403、未知会话 404。本地推送竞态（验证期间 dev 前进到 d35099d0b）这样解决：rebase 尝试把历史拉直后，在新基点上重新构造合并提交——被重写的 PR head sha 永远不会被 GitHub 标记为 MERGED，所以必须保持合并提交形态。
- #1539（dsh-quick-ask），a3704c3c6。该 PR 把条目插在数组开头、全体 rank 后移，GitHub 的合并预览树因此拼出两个 dist 世代、其 `market-build --check` 失败，而 PR 头自身是干净的——属于维护者侧重建的情形，不是作者缺陷。
- #1575（dsh-plugin-kit 九条登记），970c64ea8。九包审计由三路并行只读调查覆盖克隆的 monorepo，叠加机械核对（npm 版本对齐、无安装期脚本、lib/ 已提交、依赖白名单、kit 的四重回环栅栏覆盖每条路由、客户端全同源、lib/src 抽查一致）。两个发现公开记录为不阻塞跟进项：tty 的 `GET /config` 明文回读已存 SSH 密码（姊妹包 docker 已脱敏为 `passwordSet`）；rss 抓取用户配置的订阅 URL 缺 http/https 白名单、内网拦截与响应大小上限。

首审：#1576（Binary Veil 皮肤）CHANGES_REQUESTED 只有一条——92.4 MB 的 mp4（现有最大皮肤的 11.5 倍，给入库的 `market/dist` 与 git 历史带来约 190 MB）；包括 `decoration-layers.ts` 的视频 `backgroundMedia` 消费路径在内的全部契约门都验证通过。#1577（dsh-stalled-turn-continue）三轴全过（含本地实跑上游测试），CHANGES_REQUESTED 只因作者勾了用户可见变更类型却未附证据工作流要求的截图。

五个延续的作者阻塞 PR（#1399、#1467、#1479、#1488、#1526）评审后均无新提交，维持原状、原评审继续有效。卡在首次贡献者门禁的 `action_required` 工作流运行已为 #1514、#1519、#1539、#1575、#1577 批准。

community.json 与市场清单现在载有 73 个插件。本轮合并的 diff 都没有触碰需要通知协作者的 Wallpaper Engine 域文件。

## Alternatives considered

以明文密码回读为由阻塞 tty 收录被否决：该暴露面与宿主自身 API 处在同一回环加同源栅栏之内，超出本地信任基线有限；直接拒绝会丢弃一个完成度很高的九包贡献，公开记录跟进项同样能促成修复而不付出这个代价。

让 #1539 作者因 CI 在合并预览树失败而 rebase 被否决：对首部插入来说这个失败是定义性的（任何两个 dist 世代的文本拼接都是陈旧的），PR 自身树是干净的，rebuild-on-merge 规则本就把拼接陈旧划给维护者。

接受 #1542 的拉直历史被否决：GitHub 只在 PR 确切 head sha 进入基分支时标记 MERGED，重写后的解析提交会让 PR 永远开着；改为在新基点上重建合并提交。

## Consequences

origin/dev 载有 1507ba0a7、a71e699f0、4bcb27306、a3704c3c6、970c64ea8；创意工坊插件清单从 63 条增至 73 条。仍有七个开放 PR：两个等作者（#1576 资产重编码、#1577 证据截图）、五个维持作者阻塞。存续关注项：tty 的密码回读与 /local-fs 披露、rss 出站抓取加固、两个上游仓库都不到一周、以及 community.json 尾部仍是每次登记 PR 都会撞上的双追加活冲突点——除非条目不再落在数组末尾。

## Testing

每次合并推送前都在专属工作树过闸：pnpm typecheck、test、docs:check、i18n:check、libs:check、aggregate:check、market:check、community-index --check 在最终合并树上全部通过。#1542 的沙箱实测端到端跑了删除路径（4/4 断言）。#1575 的审计证据以 file:line 形式留在 PR 评审线程。各工作树在集成后回收。
