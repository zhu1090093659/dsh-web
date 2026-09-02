# Agent Note：2026-09-01 维护巡检（解锁 CI、合入两个 PR、阻塞一个）

Status: implemented

## Problem

对 `zhu1090093659/dsh-web` 的例行 PR 维护巡检发现八个开放 PR，全部分配给
`zhu1090093659`。其中五个已有维护者 `CHANGES_REQUESTED` 评审且无新提交
（#1334、#1333、#1318、#1306、#1144），只需只读确认；三个未经评审的
（#1329 社区条目更新、#1324 新宠物、#1321 社区条目登记）需要评审。同时
所有合并闸门被冻结：自提交 `c681332b` 起 `dev` 的 CI 一直红，CI 的 Node
22.23.2 上 `dsh-session-archive` 测试失败，而本机 Node 24/25 通过。

## Decision

- **CI 根因与修复（733712b66，a04ff87a6）**：vitest 4 用当前进程的
  `module.builtinModules` 构造 vite 的 external 列表；Node 22.23.2 上
  `node:sqlite` 可加载但不在该列表里，vite 8 的 jsdom（client）环境尝试
  打包它时直接报错。四个 host 侧 session-archive spec 改用文件级
  `// @vitest-environment node` 覆盖（`dsh-perf` 已有模式），janitor 的
  projcache 清洗写入改为 await，使"删除成功"必然意味着清洗已落盘。在
  便携版 Node v22.23.2 下验证：全套 77/77 连续三次，janitor spec 10 次
  （await 修复前约每两次失败一次）。
- **第二个 CI 断点（7b0cbc709）**：此前 SDK cohort 提交在
  `.dsh/skills/dsh-sdk-upgrade/scripts/profile-cohort-check.sh` 的输出
  字符串里留下 emoji，触发无 emoji 门禁。替换为普通 WARN/FAIL/OK 前缀。
- **#1329（dsh-auto-memory 描述更新）：通过并合入（rebase，admin）。**
  rebase 后 head 的 CI 只挂在 market-dist 时效检查（
  `manifest/plugins.json`）上，属维护者侧缺口而非作者错误；直接在 dev 上
  重新生成 manifest（d78c1e791）后合入。符合既定的"小问题维护者直接修"
  政策。
- **#1324（starry-doll sprite2d 宠物）：通过并合入（48eebf003）**。v2
  manifest 契约、registry 测试断言、README 双语三件套与 sidecar hash、
  market/dist 资产全部核对一致。
- **#1321（dsh-memory 条目登记）：CHANGES_REQUESTED**。阻塞点：npm 上
  已存在 `dsh-memory` 包（bbnopromo，无关的 SQLite FTS5 记忆插件），而
  商店安装路径会回退到条目 id，一键安装会装到错误的包；另外 PR 模板不
  完整（贡献证据检查失败）。已留言说明两点。
- **只读确认**：#1334、#1333、#1318、#1306、#1144 仍在等作者响应（维护者
  评审已在、无新提交）；按不重复评审规则未做任何动作。

## Consequences

- `dev` CI 恢复绿色（48eebf003 的运行：success），合并闸门对所有后续 PR
  恢复可用。
- 社区条目提交若改动 `community.json`，必须随附重新生成的
  `market/dist/manifest/plugins.json`；时效检查会强制执行，琐碎改动可由
  维护者代为生成。
- 评审条目时必须把 `npm` 名与真实 registry 核对——`install-source.ts` 的
  id/repo 回退会让包名冲突变成用户可见的安装事故。

## Alternatives considered

- **放着 CI 红，只按内容判断 PR**：否决；ruleset 要求必需检查全绿，所有
  社区 PR 会一直被卡。
- **把 CI 的 Node 固定到 `builtinModules` 含 `sqlite` 的版本**：否决，改
  用显式的文件级测试环境；CI 的 `node-version: 22` 刻意保持宽泛。
- **把 manifest 再生成提交推到贡献者 fork，让 PR head 先变绿再合**：
  否决；推 fork 只用一次性 remote，而维护者直接合入政策已覆盖琐碎的
  dist 再生成，无需多一轮往返。