# Agent Note: PR maintenance run 2026-09-13 (sixth pass) — two stale registrations closed on the seven-day inactivity rule

Status: implemented

## Problem

`zhu1090093659/dsh-web` 第六次维护巡检，距第五次数小时。本次范围参数：关闭超过七天没有新的提交或回复的 PR。候选集：运行开始时全部十个开放 PR，均分配给维护者账号；不扫描 Issue。陈旧判定取权威时间戳——作者提交、issue 评论、评审提交、评审内联评论——不用会被机器人与标签事件扭曲的 `updatedAt`。一个数据怪癖很关键：REST 评审列表返回 `submittedAt: null`，评审年龄改由 GraphQL timeline 取得；运行前全场最新的活动就是维护者自己在 #1321 上的 2026-09-01T10:41Z 评审，因此所有候选在 2026-09-06T06:23Z 界线之前早已完全沉默。

## Decision

十个 PR 中两个命中条件，各附一条说明后关闭；其余八个一周内都有提交或回复，保持不动。

#1318（dsh-git-badge 登记）：最后一次任何形式的活动是 2026-08-31T23:53Z 维护者的 CHANGES_REQUESTED——实用性与兼容性两轴通过，稳定性因缺少 CI workflow 与测试被阻塞（这是一个执行 git 命令、暴露本地 HTTP/SSE 路由的安全敏感插件）。失败运行日志核实红灯的 `CI checks` 正是作者此前在 dev 上举证的 `dsh-git-graph` sourcemap ENOENT 与 `dsh-doctor` bomb-render 失败；plugin-mount 与贡献证据检查均通过。关闭留言记录了该状态与重开路径。

#1321（dsh-memory 登记）：作者最后一次活动 2026-08-31T14:36Z；维护者两条评审（2026-08-31T23:55Z、2026-09-01T10:41Z）阻塞在 npm 发布产物与仓库源码不一致、`dsh-memory` npm 包名与 bbnopromo 的无关包撞名，以及贡献证据检查未通过。关闭留言记录了缺证据状态与重开路径。

两个条目都不在 `origin/dev` 的 `community.json` 里（58 条），关闭不删除任何已登记能力。两个 PR 都没有协作者正式 review——现存评审全部来自维护者账号自身——「已审查不重复审查」规则不适用。两者都是社区插件登记（强制三轴类型）；三轴结论已于 08-31/09-01 留档，本次的决定是不活跃关闭，不是二次准入。

## Alternatives considered

等 stale-assignment 工作流的 14 天转移被否：本次指令定了七天规则，且两个 PR 本就分配给 owner 账号，转移不会改变任何事。不留评论直接关闭被否：评论规范要求每次关闭说明检查状态与重开路径。关闭前重跑三轴准入被否：轴结论已留档，且关闭可重开。替陈旧的作者分支补测试、CI、npm 改名、重生成 dist 被否：登记 PR 归作者所有是既定准则。

## Consequences

#1318 与 #1321 已关闭；作者推上所要求的更新后可重开，或重新提交。dev 自身今天的 CI 运行全绿，rebase 后 #1318 的红灯也应随之消除。八个开放 PR（#1399、#1467、#1479、#1488、#1502、#1514、#1516、#1519）带入下一轮。`dsh-memory` npm 撞名仍是未来登记同名插件时的既存事实。

## Testing

经 `gh pr view` 核验关闭（state CLOSED，closedAt 2026-09-13T06:28Z），两个 PR 各有一条维护者评论。陈旧判定取自 GraphQL timeline（提交、评论、评审提交），与 `gh pr checks` 交叉核对；#1318 的失败归因读自失败运行日志；dev CI 状态来自 `gh run list --workflow CI --branch dev`；索引成员关系核对新 fetch 的 `origin/dev` 上的 `community.json`。
