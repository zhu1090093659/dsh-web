import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseNumstat, parseNameStatus, addedLinesFromDiff,
  checkSize, checkForbiddenFiles, checkSecrets, checkEmoji,
  checkWorkflowChanges, checkLockfile, checkTemplate, checkCommits,
  checkSkinChanges, checkCopyright, checkSkinPreviews, judgeVisualMetrics,
  finalVerdict, parseArgs, fmtBytes, DEFAULT_MAX_ADDED,
} from "./pr-review.mjs"

// ---------------------------------------------------------------- parseNumstat

test(`parseNumstat 解析常规行与二进制行`, () => {
  const stat = parseNumstat(`10\t20\ta.ts\n-\t-\tb.png\n0\t3\tc.ts`)
  assert.equal(stat.files.length, 3)
  assert.equal(stat.files[0].added, 10)
  assert.equal(stat.files[0].deleted, 20)
  assert.equal(stat.files[0].binary, false)
  assert.equal(stat.files[1].binary, true)
  assert.equal(stat.files[1].added, 0)
  assert.equal(stat.totalAdded, 10)
  assert.equal(stat.totalDeleted, 23)
})

test(`parseNumstat 忽略空行与无效行`, () => {
  const stat = parseNumstat(`\n\t\t\n  garbage`)
  assert.equal(stat.files.length, 0)
})

// ---------------------------------------------------------------- parseNameStatus

test(`parseNameStatus 解析 A/M/D`, () => {
  const out = parseNameStatus(`A\tnew.ts\nM\told.ts\nD\tgone.ts`)
  assert.deepEqual(out, [
    { status: `A`, path: `new.ts` },
    { status: `M`, path: `old.ts` },
    { status: `D`, path: `gone.ts` },
  ])
})

// ---------------------------------------------------------------- checkSize

test(`规模上限：恰好等于上限通过，超过拒绝`, () => {
  assert.equal(checkSize({ totalAdded: 10000, totalDeleted: 100 }).length, 0)
  assert.equal(checkSize({ totalAdded: 10001, totalDeleted: 100 }).length, 1)
  const f = checkSize({ totalAdded: 10001, totalDeleted: 100 })
  assert.equal(f[0].severity, `reject`)
  assert.equal(f[0].rule, `size`)
})

test(`删除同样受上限约束`, () => {
  const f = checkSize({ totalAdded: 10, totalDeleted: 10001 })
  assert.equal(f.length, 1)
  assert.match(f[0].message, /删除/)
})

test(`自定义上限生效`, () => {
  assert.equal(checkSize({ totalAdded: 50, totalDeleted: 0 }, 100, 100).length, 0)
  assert.equal(checkSize({ totalAdded: 150, totalDeleted: 0 }, 100, 100).length, 1)
})

// ---------------------------------------------------------------- checkForbiddenFiles

test(`禁止路径：node_modules 与密钥文件拒绝`, () => {
  const f = checkForbiddenFiles([
    { path: `.pnpm-store/v11/files/01/abc`, binary: false },
    { path: `packages/x/node_modules/pkg/index.js`, binary: false },
    { path: `config/.env`, binary: false },
    { path: `keys/id_rsa`, binary: false },
  ])
  assert.equal(f.length, 4)
  assert.ok(f.every((x) => x.severity === `reject`))
})

test(`非白名单二进制拒绝，白名单二进制放行`, () => {
  const f = checkForbiddenFiles([
    { path: `assets/evil.exe`, binary: true },
    { path: `assets/ok.png`, binary: true },
  ])
  assert.equal(f.length, 1)
  assert.equal(f[0].rule, `binary`)
  assert.match(f[0].message, /evil\.exe/)
})

test(`超大文本文件拒绝，超大媒体文件警告`, () => {
  const f = checkForbiddenFiles([
    { path: `big.ts`, binary: false },
    { path: `big.png`, binary: true },
  ], { "big.ts": 2 * 1024 * 1024, "big.png": 8 * 1024 * 1024 })
  assert.equal(f.length, 2)
  assert.equal(f[0].severity, `reject`)
  assert.equal(f[0].rule, `large-file`)
  assert.equal(f[1].severity, `warn`)
})

// ---------------------------------------------------------------- addedLinesFromDiff

test(`diff 新增行提取：文件与行号正确`, () => {
  const diff = [
    `diff --git a/a.ts b/a.ts`,
    `--- a/a.ts`,
    `+++ b/a.ts`,
    `@@ -1,2 +1,3 @@`,
    `+line1`,
    `+line2`,
    `diff --git a/b.ts b/b.ts`,
    `@@ -5 +5,2 @@`,
    `+line5`,
  ].join(`\n`)
  const out = addedLinesFromDiff(diff)
  assert.deepEqual(out, [
    { path: `a.ts`, line: 1, text: `line1` },
    { path: `a.ts`, line: 2, text: `line2` },
    { path: `b.ts`, line: 5, text: `line5` },
  ])
})

test(`diff 新增行提取：忽略 '\\ No newline at end of file' 标记`, () => {
  const diff = [
    `diff --git a/f.txt b/f.txt`,
    `--- a/f.txt`,
    `+++ b/f.txt`,
    `@@ -1 +1 @@`,
    `-old`,
    `\\ No newline at end of file`,
    `+new`,
  ].join(`\n`)
  const out = addedLinesFromDiff(diff)
  assert.deepEqual(out, [{ path: `f.txt`, line: 1, text: `new` }])
})

// ---------------------------------------------------------------- checkSecrets

test(`密钥扫描：命中拒绝，测试目录降级警告`, () => {
  const diff = [
    `diff --git a/src/api.ts b/src/api.ts`,
    `@@ -1 +1 @@`,
    `+token = ` + `ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`,
    `diff --git a/tests/fixture.ts b/tests/fixture.ts`,
    `@@ -1 +1 @@`,
    `+const key = ` + `AKIAABCDEFGHIJKLMNOP`,
  ].join(`\n`)
  const f = checkSecrets(diff)
  assert.equal(f.length, 2)
  assert.equal(f[0].severity, `reject`)
  assert.equal(f[1].severity, `warn`)
})

test(`私钥块命中`, () => {
  const diff = `diff --git a/k b/k\n@@ -1 +1 @@\n+-----BEGIN RSA PRIVATE KEY-----`
  const f = checkSecrets(diff)
  assert.equal(f.length, 1)
  assert.match(f[0].message, /private key/)
})

// ---------------------------------------------------------------- checkEmoji

test(`emoji 扫描：命中拒绝`, () => {
  const diff = `diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n+hello ` + `\u{1F600}` + ` world`
  const f = checkEmoji(diff)
  assert.equal(f.length, 1)
  assert.equal(f[0].severity, `reject`)
  assert.match(f[0].message, /U\+1F600/)
})

test(`emoji 扫描：纯文本通过`, () => {
  const diff = `diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n+plain text`
  assert.equal(checkEmoji(diff).length, 0)
})

// ---------------------------------------------------------------- 工作流与 lockfile

test(`修改 CI 工作流拒绝`, () => {
  const f = checkWorkflowChanges([
    { status: `M`, path: `.github/workflows/ci.yml` },
    { status: `M`, path: `src/index.ts` },
  ])
  assert.equal(f.length, 1)
  assert.equal(f[0].rule, `ci-files`)
})

test(`lockfile 变更提示`, () => {
  const f = checkLockfile([
    { status: `M`, path: `pnpm-lock.yaml` },
    { status: `M`, path: `README.md` },
  ])
  assert.equal(f.length, 1)
  assert.equal(f[0].severity, `info`)
})

// ---------------------------------------------------------------- checkTemplate

function makeBody(overrides = {}) {
  const parts = [
    `## 摘要（Summary）`,
    `添加测试功能`,
    `## 涉及包（Affected Packages）`,
    `- [x] 任务看板 packages/dsh-task-board`,
    `## PR 类别（PR Category）`,
    `- [x] 插件功能（任务看板 / Git 图谱 / 右侧面板 / 远程 Web UI / SSH / 宠物 / 设置 / 聚合包）`,
    `## PR 类型（PR Type）`,
    `- [x] 面向用户的功能或行为变更`,
    ...(overrides.visual ? [`- [x] 视觉修复（UI / 视觉类问题的修复）`] : []),
    `## 最新代码确认（Latest Codebase Confirmation）`,
    `- [x] 我已基于最新 \`dev\` 分支开发，或在提交前已 rebase / 合并最新 \`dev\`。`,
    `## 测试证据与上游同步（Test Evidence & Upstream Sync）`,
    `- [x] 我提供了自己本地测试的证据（执行的命令 / 测试结果 / 运行截图）。`,
    `- [x] 我已同步上游最新 \`dev\` 分支（\`git fetch origin && git rebase origin/dev\`），并附上同步后重新测试通过的证据（视觉 / 用户可见变更附截图）。`,
    ...(overrides.visual ? [
      `## 视觉修复要求（Visual Fix Requirements）`,
      `- [x] 我提供了修复完成后的截图（完成态或修复前后对比）。`,
      `- [x] 修复使用的 AI 模型支持图像输入（多模态模型）；未使用 AI 编码时此项视为满足。`,
    ] : []),
    `## AI 编码披露（AI Coding Disclosure）`,
    `- [x] 部分 AI 辅助：AI 帮助编写或修改了部分编程改动。`,
    `使用的 AI 模型：DeepSeek`,
    `使用的编码 Agent 工具：DSH`,
    `## 本地验证（Local Validation）`,
    `执行的命令：pnpm build`,
    `结果摘要：通过`,
    `## 用户可见变更证据（Local Feature Evidence）`,
    `证据：`,
    `![screenshot](https://github.com/user-attachments/assets/abc123)`,
  ].join(`\n`)
  return { ...overrides, body: overrides.body ?? parts }
}

test(`完整模板通过`, () => {
  const pr = makeBody({ author: { login: `someone` } })
  assert.equal(checkTemplate(pr, `owner`).length, 0)
})

test(`摘要为空拒绝`, () => {
  const pr = makeBody({ author: { login: `someone` }, body: `` })
  const f = checkTemplate(pr, `owner`)
  assert.ok(f.some((x) => x.message.includes(`摘要`)))
})

test(`PR 类别未勾选拒绝`, () => {
  // 真实场景：贡献者保留模板选项但未勾选（`- [ ]`），而非删除整行。
  const body = makeBody({ author: { login: `someone` } }).body
    .replace(/^\- \[x\] 插件功能/m, `- [ ] 插件功能`)
  const f = checkTemplate({ body, author: { login: `someone` } }, `owner`)
  assert.ok(f.some((x) => x.message.includes(`PR 类别`)))
})

test(`AI 披露未勾选拒绝`, () => {
  let body = makeBody().body
  body = body.replace(/^\- \[x\] 部分 AI 辅助.*$/m, ``)
  body = body.replace(/^使用的 AI 模型：.*$/m, ``)
  const pr = { body, author: { login: `someone` } }
  const f = checkTemplate(pr, `owner`)
  assert.ok(f.some((x) => x.message.includes(`AI 编码披露`)))
})

test(`声明 AI 但模型为空拒绝`, () => {
  const body = makeBody().body.replace(/^使用的 AI 模型：.*$/m, `使用的 AI 模型：`)
  const pr = { body, author: { login: `someone` } }
  const f = checkTemplate(pr, `owner`)
  assert.ok(f.some((x) => x.message.includes(`AI 模型`)))
})

test(`外部贡献者 PR 无测试截图拒绝；仓库所有者豁免`, () => {
  const noEvidence = makeBody({ author: { login: `someone` } }).body
    .replace(/^\!\[screenshot\].*$/m, ``)
  const f1 = checkTemplate({ body: noEvidence, author: { login: `someone` } }, `owner`)
  assert.ok(f1.some((x) => x.message.includes(`证据`)))
  const f2 = checkTemplate({ body: noEvidence, author: { login: `owner` } }, `owner`)
  assert.ok(!f2.some((x) => x.message.includes(`证据`)))
})

test(`外部贡献者 PR 未勾选自测证据 / 上游同步项拒绝；所有者豁免`, () => {
  let body = makeBody({ author: { login: `someone` } }).body
  body = body.replace(/^\- \[x\] 我提供了自己本地测试的证据.*$/m, ``)
  const f1 = checkTemplate({ body, author: { login: `someone` } }, `owner`)
  assert.ok(f1.some((x) => x.message.includes(`自测证据`)))
  body = body.replace(/^\- \[x\] 我已同步上游最新.*$/m, ``)
  const f2 = checkTemplate({ body, author: { login: `someone` } }, `owner`)
  assert.ok(f2.some((x) => x.message.includes(`上游同步`)))
  const f3 = checkTemplate({ body, author: { login: `owner` } }, `owner`)
  assert.ok(!f3.some((x) => x.message.includes(`上游同步`)))
})

test(`视觉修复 PR：未勾选完成截图 / 多模态声明拒绝`, () => {
  let body = makeBody({ author: { login: `someone` }, visual: true }).body
  body = body.replace(/^\- \[x\] 我提供了修复完成后的截图.*$/m, ``)
  const f1 = checkTemplate({ body, author: { login: `someone` } }, `owner`)
  assert.ok(f1.some((x) => x.message.includes(`完成截图`)))
  body = body.replace(/^\- \[x\] 修复使用的 AI 模型支持图像输入.*$/m, ``)
  const f2 = checkTemplate({ body, author: { login: `someone` } }, `owner`)
  assert.ok(f2.some((x) => x.message.includes(`多模态`)))
})

test(`视觉修复 PR：纯文本模型拒绝，多模态模型通过，所有者豁免`, () => {
  const makeVisual = (model) => makeBody({ author: { login: `someone` }, visual: true }).body
    .replace(/^使用的 AI 模型：.*$/m, `使用的 AI 模型：` + model)
  const f1 = checkTemplate({ body: makeVisual(`deepseek-chat`), author: { login: `someone` } }, `owner`)
  assert.ok(f1.some((x) => x.message.includes(`多模态`)))
  const f2 = checkTemplate({ body: makeVisual(`DeepSeek-VL2`), author: { login: `someone` } }, `owner`)
  assert.ok(!f2.some((x) => x.message.includes(`多模态`)))
  const f3 = checkTemplate({ body: makeVisual(`deepseek-chat`), author: { login: `owner` } }, `owner`)
  assert.ok(!f3.some((x) => x.message.includes(`多模态`)))
})

test(`文本类改动可不附截图`, () => {
  let body = makeBody({ author: { login: `someone` } }).body
  body = body
    .replace(/^\- \[x\] 面向用户的功能或行为变更.*$/m, `- [x] 维护 / 重构`)
    .replace(/^\!\[screenshot\].*$/m, ``)
  const f = checkTemplate({ body, author: { login: `someone` } }, `owner`)
  assert.ok(!f.some((x) => x.message.includes(`证据`)))
})

test(`本地验证为空拒绝`, () => {
  const body = makeBody().body
    .replace(/^执行的命令：.*$/m, `执行的命令：`)
    .replace(/^结果摘要：.*$/m, `结果摘要：`)
  const pr = { body, author: { login: `someone` } }
  const f = checkTemplate(pr, `owner`)
  assert.ok(f.some((x) => x.message.includes(`本地验证`)))
})

test(`本地验证值支持代码围栏与列表格式（不误判字段边界）`, () => {
  // 回归：readField 曾把 "- xxx：yyy" 这类列表行误判为下一个字段标签，
  // 导致按模板填写（代码围栏 + 列表格式）的 PR 被误拒。
  const body = makeBody().body
    .replace(`执行的命令：pnpm build`, `执行的命令：\n\n\u0060\u0060\u0060bash\npnpm install\npnpm --filter @linxin666/dsh-remote-web-ui test\n\u0060\u0060\u0060\n`)
    .replace(`结果摘要：通过`, `结果摘要：\n\n- typecheck：通过。\n- test：157/158 通过。`)
  const pr = { body, author: { login: `someone` } }
  const f = checkTemplate(pr, `owner`)
  assert.ok(!f.some((x) => x.message.includes(`本地验证`)))
})

test(`本地验证值不以冒号正文行误判字段边界`, () => {
  // 回归：readField 曾把 "全部通过：typecheck 全绿" 这类摘要正文行误判为
  // 下一个字段标签，导致结果摘要被读为空（GitHub 证据检查可正常解析）。
  const body = makeBody().body
    .replace(`执行的命令：pnpm build`, `执行的命令：\n\n\u0060\u0060\u0060bash\npnpm typecheck\npnpm test:scripts\n\u0060\u0060\u0060\n`)
    .replace(`结果摘要：通过`, `结果摘要：\n\n全部通过：typecheck 全绿；test:scripts 87/87。`)
  const pr = { body, author: { login: `someone` } }
  const f = checkTemplate(pr, `owner`)
  assert.ok(!f.some((x) => x.message.includes(`本地验证`)))
})

// ---------------------------------------------------------------- checkCommits

test(`提交信息检查`, () => {
  const f = checkCommits([
    { messageHeadline: `feat(ssh): add tunnel support` },
    { messageHeadline: `random commit message` },
  ])
  assert.equal(f.length, 1)
  assert.equal(f[0].severity, `warn`)
  const bad = checkCommits([{ messageHeadline: `feat: ok ` + `\u{1F600}` }])
  assert.ok(bad.some((x) => x.severity === `reject` && x.rule === `emoji`))
})

// ---------------------------------------------------------------- 皮肤识别与版权

test(`皮肤变更识别：源码类命中，README 与 skin-center 排除`, () => {
  const f1 = checkSkinChanges([
    { status: `A`, path: `packages/skins/skin-center/skins/xp/skin.css` },
    { status: `A`, path: `packages/skins/skin-center/skins/xp/skin.json` },
  ])
  assert.deepEqual(f1, { isSkin: true, skinIds: [`xp`] })
  const f2 = checkSkinChanges([
    { status: `M`, path: `packages/skins/skin-center/skins/xp/README.md` },
    { status: `M`, path: `packages/skins/skin-center/skins/xp/preview/light.jpg` },
    { status: `M`, path: `docs/development.md` },
  ])
  assert.deepEqual(f2, { isSkin: false, skinIds: [] })
  const f3 = checkSkinChanges([{ status: `M`, path: `packages/skins/skin-center/src/routes.ts` }])
  assert.equal(f3.isSkin, false)
})

test(`版权提醒：外部贡献者皮肤 PR 未声明时 warn，已声明或仓库所有者豁免`, () => {
  const pr = { body: `## 摘要（Summary）\n测试`, author: { login: `someone` } }
  const f1 = checkCopyright(pr, true, `owner`)
  assert.equal(f1.length, 1)
  assert.equal(f1[0].severity, `warn`)
  assert.equal(f1[0].rule, `copyright`)
  const declared = { body: `## 贡献者版权声明（Contributor Copyright）\n- [x] 已声明\n| 包 | 来源 | 版权 |`, author: { login: `someone` } }
  assert.equal(checkCopyright(declared, true, `owner`).length, 0)
  assert.equal(checkCopyright(pr, false, `owner`).length, 0)
  assert.equal(checkCopyright(pr, true, `someone`).length, 0)
})
test(`市场预览：新皮肤缺 preview/{light,dark}.jpg 时警告，齐图或存量皮肤豁免`, () => {
  const base = [
    { status: `A`, path: `packages/skins/skin-center/skins/xp/skin.css` },
  ]
  const f1 = checkSkinPreviews(base, [`xp`])
  assert.equal(f1.length, 2)
  assert.ok(f1.every((x) => x.severity === `warn` && x.rule === `preview`))
  const complete = [
    { status: `A`, path: `packages/skins/skin-center/skins/xp/skin.css` },
    { status: `A`, path: `packages/skins/skin-center/skins/xp/preview/light.jpg` },
    { status: `A`, path: `packages/skins/skin-center/skins/xp/preview/dark.jpg` },
  ]
  assert.equal(checkSkinPreviews(complete, [`xp`]).length, 0)
  const modified = [{ status: `M`, path: `packages/skins/skin-center/skins/xp/skin.css` }]
  assert.equal(checkSkinPreviews(modified, [`xp`]).length, 0)
})
test(`视觉指标判定：过曝与对比度不足警告`, () => {
  const f1 = judgeVisualMetrics([
    { file: `xp-light.png`, avgLuma: 219.9, hiPct: 76.6, stdLuma: 60.3 },
  ])
  assert.equal(f1.length, 2)
  assert.ok(f1.every((x) => x.severity === `warn` && x.rule === `visual`))
  assert.ok(f1.some((x) => x.message.includes(`太闪`)))
  const ok = judgeVisualMetrics([{ file: `a-dark.png`, avgLuma: 55, hiPct: 3, stdLuma: 52 }])
  assert.equal(ok.length, 0)
  const lowContrast = judgeVisualMetrics([{ file: `b-light.png`, avgLuma: 120, hiPct: 1, stdLuma: 12 }])
  assert.equal(lowContrast.length, 1)
  assert.ok(lowContrast[0].message.includes(`看不清`))
  const overexposed = judgeVisualMetrics([{ file: `xp-light.jpg`, avgLuma: 250, hiPct: 95, stdLuma: 10 }])
  assert.ok(overexposed.some((x) => x.message.includes(`接近纯白`)))
})
// ---------------------------------------------------------------- finalVerdict

test(`verdict 优先级`, () => {
  assert.equal(finalVerdict([], { failures: [] }), `PASS`)
  assert.equal(finalVerdict([{ severity: `warn` }], { failures: [] }), `WARN`)
  assert.equal(finalVerdict([{ severity: `reject` }], { failures: [] }), `REJECT`)
  assert.equal(finalVerdict([], { failures: [`build`] }), `FAIL`)
  assert.equal(finalVerdict([{ severity: `reject` }], { failures: [`build`] }), `REJECT`)
  assert.equal(finalVerdict([], null), `PASS`)
})

// ---------------------------------------------------------------- parseArgs

test(`参数解析`, () => {
  const o = parseArgs([`94`, `117`, `--open`, `--skip-build`, `--json`, `--concurrency`, `4`])
  assert.deepEqual(o.prs, [94, 117])
  assert.equal(o.open, true)
  assert.equal(o.skipBuild, true)
  assert.equal(o.json, true)
  assert.equal(o.concurrency, 4)
  assert.equal(o.maxAdded, DEFAULT_MAX_ADDED)
  const c = parseArgs([`--cleanup`, `--workdir`, `/tmp/x`])
  assert.equal(c.cleanup, true)
  assert.equal(c.worktreeRoot, `/tmp/x`)
  const h = parseArgs([`--help`])
  assert.equal(h.help, true)
  assert.throws(() => parseArgs([`--bogus`]))
})

test(`fmtBytes`, () => {
  assert.equal(fmtBytes(0), `0 B`)
  assert.equal(fmtBytes(1024), `1.0 KB`)
  assert.match(fmtBytes(1024 * 1024), /MB/)
})
