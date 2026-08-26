#!/usr/bin/env node
/**
 * pr-review - 本地批量审核远程 PR 的 CLI 工具。
 *
 * 针对 dsh-web（及同类仓库）的外部 PR 审核：硬性规则 + worktree 构建验证。
 * 规则来源：PR 模板（.github/pull_request_template.md）、AGENTS.md、ci.yml、
 * pr-contribution-rules.yml。规则与仓库文档冲突时以文档为准。
 *
 * 用法：
 *   node scripts/pr-review.mjs 94 117              # 审核指定 PR（可多个）
 *   node scripts/pr-review.mjs --open              # 审核全部 open PR（一次多个）
 *   node scripts/pr-review.mjs --open --skip-build # 只做静态检查，不构建
 *   node scripts/pr-review.mjs 94 --json           # JSON 输出
 *
 * 选项：
 *   --repo owner/repo      目标仓库（默认从 git remote 推断）
 *   --include-draft        包含 draft PR（默认跳过）
 *   --skip-build           跳过 worktree 构建验证（只做静态检查）
 *   --workdir <path>       worktree 工作区根目录（默认 ~/remote-e2e，e2e 验证同区）
 *   --cleanup              清理工作区全部 worktree 与遗留 refs 后退出
 *
 * worktree 建在 ~/remote-e2e/pr-<N>（同 head 复用，跑完保留便于排查），
 * e2e 验证产物同区存放；定期用 --cleanup 或手动 rm -rf ~/remote-e2e 清理
 * （工具启动时会自动 prune 已失效的 worktree 记录）。
 *
 * 皮肤 PR 额外：生成亮/暗预览截图（~/remote-e2e/e2e-<pr>/previews/），
 * 像素指标自动判定过曝（太闪）与对比度不足（看不清），截图供视觉模型复核；
 * 提醒作者声明贡献者版权，并检查新皮肤是否提供 preview/{light,dark}.jpg 预览图。
 *   --concurrency N        并行审核数（默认 2）
 *   --max-added N          新增行上限，超过即拒绝（默认 10000）
 *   --max-deleted N        删除行上限，超过即拒绝（默认 10000）
 *   --max-file-bytes N     新增文本文件大小上限（默认 1048576）
 *   --json                 JSON 输出
 *   --no-color             禁用颜色
 *   -h, --help             显示帮助
 *
 * verdict 语义：
 *   REJECT  命中硬性规则（规模 / 密钥 / CI 文件 / 禁止路径 / emoji / 模板必填缺失）
 *   FAIL    构建或门禁失败（等价于 CI 变红）
 *   WARN    无硬性问题但有警告（提交信息不规范、PR 冲突、lockfile 变更等）
 *   PASS    静态检查与构建门禁全部通过
 *   SKIP    draft / 已合并 / 已关闭（--include-draft 之外的 draft）
 *   ERROR   无法获取 PR 信息
 *
 * 退出码：存在 REJECT / FAIL / ERROR 时为 1，否则为 0。
 *
 * 硬性限制说明（本工具核心诉求）：
 *   外部 PR 新增或删除超过 10000 行直接拒绝，不做构建验证。AI 时代常见
 *   把 pnpm 缓存（node_modules / .pnpm 等）整体提交的行为，此类变更破坏性
 *   太大，由规模阈值与禁止路径规则双重拦截。
 */

import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), `..`)

// ---------------------------------------------------------------- 常量与规则

export const DEFAULT_MAX_ADDED = 10000
export const DEFAULT_MAX_DELETED = 10000
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024
export const DEFAULT_CONCURRENCY = 2

/** worktree 与 e2e 验证工作区根目录（定期用 --cleanup 清理）。 */
export const DEFAULT_WORKTREE_ROOT = join(homedir(), `remote-e2e`)

/** 与 ci.yml 的 emoji 检查完全一致的码点范围（U+1F000-1FAFF / 2600-27BF / 2B00-2BFF / 区域指示符 / FE0F / ZWJ）。 */
export const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\uFE0F\u200D]/u
/** exec 循环用（带 g，lastIndex 自动推进）。 */
export const EMOJI_GLOBAL_RE = new RegExp(EMOJI_RE.source, 'gu')

/** Conventional Commits（仓库允许的 type 集合）。 */
export const CONVENTIONAL_COMMIT_RE = /^(feat|fix|chore|docs|test|refactor|perf)(\([^)]+\))?!?: .+/

/** 已知纯文本模型（不支持图像输入）：视觉修复类 PR 禁用。 */
export const TEXT_ONLY_MODEL_RES = [
  /^deepseek$/i,
  /deepseek[-_ ]?(chat|reasoner|r1|v3|v2|v1)/i,
  /gpt[-_ ]?3(\.5)?([-_ ]turbo)?/i,
  /llama[-_ ]?(2|3)/i,
  /glm[-_ ]?(3|4)/i,
  /moonshot|kimi/i,
  /doubao|\u8c46\u5305/i,
  /ernie|\u6587\u5fc3/i,
  /mistral/i,
]

/** 新增二进制文件白名单（对齐 ci.yml emoji 检查的 skip_suffixes + 常见文档）。 */
export const ALLOWED_BINARY_EXT = new Set([
  `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`,
  `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`,
  `.pdf`, `.zip`, `.gz`,
])

/** 新增文件禁止路径：依赖目录 / 缓存 / 构建中间产物 / 密钥类。 */
export const FORBIDDEN_PATH_RES = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.pnpm(\/|$)/,
  /(^|\/)\.pnpm-store(\/|$)/,
  /(^|\/)pnpm-store(\/|$)/,
  /(^|\/)\.yarn(\/|$)/,
  /(^|\/)\.cache(\/|$)/,
  /(^|\/)__pycache__(\/|$)/,
  /(^|\/)\.pytest_cache(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)\.turbo(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.nuxt(\/|$)/,
  /\.tsbuildinfo$/,
  /\.pyc$/,
  /\.DS_Store$/,
  /(^|\/)\.env(\.|$)/,
  /\.pem$/, /\.key$/, /\.p12$/, /\.pfx$/, /\.jks$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)id_rsa$/, /(^|\/)id_ed25519$/, /(^|\/)id_ecdsa$/,
  /(^|\/)secrets(\/|$)/,
  /(^|\/)credentials(\/|$)/,
]

/** 密钥模式：命中新增行即拒绝（测试目录内命中降级为警告，避免 fixture 误拒）。 */
export const SECRET_RES = [
  { re: /AKIA[0-9A-Z]{16}/, name: `AWS access key` },
  { re: /ghp_[A-Za-z0-9]{36}/, name: `GitHub personal access token` },
  { re: /github_pat_[A-Za-z0-9_]{22,}/, name: `GitHub fine-grained token` },
  { re: /gho_[A-Za-z0-9]{36}/, name: `GitHub OAuth token` },
  { re: /ghu_[A-Za-z0-9]{36}/, name: `GitHub user token` },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, name: `Slack token` },
  { re: /sk-[A-Za-z0-9]{20,}/, name: `API key (OpenAI style)` },
  { re: /AIza[0-9A-Za-z_-]{35}/, name: `Google API key` },
  { re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, name: `private key` },
]

const TEST_PATH_RE = /(^|\/)(test|tests|__tests__|fixtures?)(\/|$)|(\.test|\.spec)\.[a-z0-9]+$/i

/** CI 门禁序列（对齐 ci.yml，一致性检查在 build 前跑，避免本机路径嵌入 bundle）。 */
const BUILD_STEPS = [
  [`install`, `pnpm`, [`install`, `--frozen-lockfile`, `--ignore-scripts`], 20 * 60 * 1000],
  [`typecheck`, `pnpm`, [`typecheck`], 10 * 60 * 1000],
  [`skin-center:check`, `pnpm`, [`skin-center:check`], 10 * 60 * 1000],
  [`community:check`, `pnpm`, [`community:check`], 10 * 60 * 1000],
  [`build`, `pnpm`, [`build`], 20 * 60 * 1000],
  [`test`, `pnpm`, [`test`], 15 * 60 * 1000],
  [`test:scripts`, `pnpm`, [`test:scripts`], 10 * 60 * 1000],
  [`aggregate:check`, `pnpm`, [`aggregate:check`], 10 * 60 * 1000],
  [`docs:check`, `pnpm`, [`docs:check`], 10 * 60 * 1000],
]

// ---------------------------------------------------------------- 纯函数（可测）

/** 解析 git diff --numstat 输出。二进制行（-  -）不计入行数。 */
export function parseNumstat(text) {
  const files = []
  let totalAdded = 0
  let totalDeleted = 0
  for (const line of String(text).split(`\n`)) {
    if (!line.trim()) continue
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.*)$/)
    if (!m) continue
    const binary = m[1] === `-` || m[2] === `-`
    const added = binary ? 0 : Number(m[1])
    const deleted = binary ? 0 : Number(m[2])
    files.push({ path: m[3], added, deleted, binary })
    totalAdded += added
    totalDeleted += deleted
  }
  return { files, totalAdded, totalDeleted }
}

/** 解析 git diff --name-status 输出（A/M/D 与路径）。 */
export function parseNameStatus(text) {
  const out = []
  for (const line of String(text).split(`\n`)) {
    if (!line.trim()) continue
    const m = line.match(/^([AMD])\t(.+)$/)
    if (!m) continue
    out.push({ status: m[1], path: m[2] })
  }
  return out
}

/** 规模硬性检查：新增或删除超过上限即拒绝。 */
export function checkSize(stat, maxAdded = DEFAULT_MAX_ADDED, maxDeleted = DEFAULT_MAX_DELETED) {
  const findings = []
  if (stat.totalAdded > maxAdded) {
    findings.push({
      severity: `reject`, rule: `size`,
      message: `新增 ` + stat.totalAdded.toLocaleString(`en-US`) + ` 行超过上限 ` + maxAdded.toLocaleString(`en-US`) + ` 行，破坏性变更直接拒绝`,
    })
  }
  if (stat.totalDeleted > maxDeleted) {
    findings.push({
      severity: `reject`, rule: `size`,
      message: `删除 ` + stat.totalDeleted.toLocaleString(`en-US`) + ` 行超过上限 ` + maxDeleted.toLocaleString(`en-US`) + ` 行，破坏性变更直接拒绝`,
    })
  }
  return findings
}

/**
 * 新增文件硬性检查：禁止路径 / 非白名单二进制 / 超大文本文件。
 * addedFiles: [{path, binary}]（diff-filter=A 的 numstat）；sizes: {path: bytes}。
 */
export function checkForbiddenFiles(addedFiles, sizes = {}, maxFileBytes = DEFAULT_MAX_FILE_BYTES) {
  const findings = []
  for (const file of addedFiles) {
    const { path, binary } = file
    const size = sizes[path] ?? 0
    const dot = path.lastIndexOf(`.`)
    const ext = dot === -1 ? `` : path.slice(dot).toLowerCase()
    if (FORBIDDEN_PATH_RES.some((re) => re.test(path))) {
      findings.push({ severity: `reject`, rule: `forbidden-path`, message: `新增文件命中禁止路径: ` + path })
      continue
    }
    if (binary && !ALLOWED_BINARY_EXT.has(ext)) {
      findings.push({ severity: `reject`, rule: `binary`, message: `新增非白名单二进制文件: ` + path + `（` + fmtBytes(size) + `）` })
      continue
    }
    if (!binary && size > maxFileBytes) {
      findings.push({ severity: `reject`, rule: `large-file`, message: `新增文本文件过大: ` + path + `（` + fmtBytes(size) + ` > ` + fmtBytes(maxFileBytes) + `）` })
    } else if (binary && size > maxFileBytes * 5) {
      findings.push({ severity: `warn`, rule: `large-file`, message: `新增媒体文件偏大: ` + path + `（` + fmtBytes(size) + `）` })
    }
  }
  return findings
}

/** 从 unified=0 的 diff 文本提取所有新增行（带文件与行号）。 */
export function addedLinesFromDiff(text) {
  const out = []
  let file = ``
  let newLine = 0
  for (const line of String(text).split(`\n`)) {
    if (line.startsWith(`diff --git `)) {
      const m = line.match(/diff --git a\/(.*) b\//)
      file = m ? m[1] : ``
      newLine = 0
    } else if (line.startsWith(`@@`)) {
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      newLine = m ? Number(m[1]) - 1 : 0
    } else if (line.startsWith(`+`) && !line.startsWith(`+++`)) {
      newLine += 1
      out.push({ path: file, line: newLine, text: line.slice(1) })
    } else if (!line.startsWith(`-`) && !line.startsWith(`\\`)) {
      newLine += 1
    }
  }
  return out
}

/** 密钥扫描：命中新增行即拒绝；测试目录内的命中降级为警告（防 fixture 误拒）。调用方可传入预解析的新增行避免重复解析 diff。 */
export function checkSecrets(diffText, addedLines) {
  const findings = []
  for (const { path, line, text } of addedLines ?? addedLinesFromDiff(diffText)) {
    const isTest = TEST_PATH_RE.test(path)
    for (const { re, name } of SECRET_RES) {
      if (re.test(text)) {
        findings.push({
          severity: isTest ? `warn` : `reject`, rule: `secret`,
          message: `新增行疑似密钥（` + name + `）: ` + path + `:` + line,
        })
        break
      }
    }
  }
  return findings
}

/** emoji 扫描：与 ci.yml 相同码点范围，命中新增行即拒绝。 */
export function checkEmoji(diffText, addedLines) {
  const findings = []
  // matchAll 复用模块级正则（不改动其 lastIndex），不再逐行 new RegExp。
  for (const { path, line, text } of addedLines ?? addedLinesFromDiff(diffText)) {
    for (const m of text.matchAll(EMOJI_GLOBAL_RE)) {
      findings.push({
        severity: `reject`, rule: `emoji`,
        message: `新增行含 emoji 字符 U+` + m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, `0`) + `: ` + path + `:` + line,
      })
    }
  }
  return findings
}

/** 外部 PR 修改 CI 工作流 / 脚本：供应链提权风险，直接拒绝。 */
export function checkWorkflowChanges(changes) {
  const findings = []
  for (const c of changes) {
    if (c.path.startsWith(`.github/workflows/`) || c.path.startsWith(`.github/scripts/`)) {
      findings.push({ severity: `reject`, rule: `ci-files`, message: `外部 PR 修改 CI 文件: ` + c.path })
    }
  }
  return findings
}

/** lockfile / 依赖清单变更：提示人工核对新增依赖。 */
export function checkLockfile(changes) {
  const touched = changes.filter((c) => c.path === `pnpm-lock.yaml` || c.path === `package.json`)
  return touched.map((c) => ({
    severity: `info`, rule: `lockfile`,
    message: `` + c.path + ` 有变更，请人工核对新增 / 升级的依赖`,
  }))
}

/** 皮肤变更识别：返回 { isSkin, skinIds }。仅源码类变更触发（README/preview/文档不算）。
    v2 布局（issue #506）：皮肤事实源是 skin-center 包内的资产目录。 */
export function checkSkinChanges(changes) {
  const ids = new Set()
  const SKIP_RE = /(README(\.zh)?\.md|README\.i18n\.yaml|preview\/|^docs\/)/i
  for (const c of changes) {
    if (SKIP_RE.test(c.path)) continue
    const m = c.path.match(/^packages\/skins\/skin-center\/skins\/([^/]+)\//)
    if (m) ids.add(m[1])
  }
  return { isSkin: ids.size > 0, skinIds: [...ids] }
}

/** 皮肤 PR 版权提醒：外部贡献者未在模板「贡献者版权声明」节声明时提示（warn）。 */
export function checkCopyright(prInfo, isSkin, repoOwner) {
  if (!isSkin) return []
  const isRepoOwner = prInfo.author && prInfo.author.login === repoOwner
  if (isRepoOwner) return []
  const section = readSection(prInfo.body || ``, `贡献者版权声明（Contributor Copyright）`)
  if (section && section.trim()) return []
  return [{
    severity: `warn`, rule: `copyright`,
    message: `皮肤 PR 请提醒作者在 PR 模板「贡献者版权声明（Contributor Copyright）」节声明贡献者版权（在 README 版权表追加一行）`,
  }]
}
/** 新皮肤市场预览检查：缺 preview/{light,dark}.jpg 即警告（市场清单由 market-build 自动派生，无需手改产物）。 */
export function checkSkinPreviews(changes, skinIds) {
  if (!skinIds.length) return []
  const findings = []
  for (const id of skinIds) {
    const isNew = changes.some((c) => c.status === `A` &&
      c.path.startsWith(`packages/skins/skin-center/skins/` + id + `/`))
    if (!isNew) continue
    for (const mode of [`light`, `dark`]) {
      const hasPreview = changes.some((c) =>
        c.path === `packages/skins/skin-center/skins/` + id + `/preview/` + mode + `.jpg`)
      if (!hasPreview) {
        findings.push({ severity: `warn`, rule: `preview`, message: `新皮肤 ` + id + ` 未提供 ` + mode + ` 预览图：请运行 node scripts/capture-previews ` + id + ` 并提交 preview/` + mode + `.jpg` })
      }
    }
  }
  return findings
}
/** 视觉指标阈值判定：过曝（太闪）/ 对比度不足（看不清）。返回 warn findings。 */
export function judgeVisualMetrics(metrics) {
  const findings = []
  for (const m of metrics || []) {
    const name = m.file || `?`
    if (m.avgLuma > 215) {
      findings.push({ severity: `warn`, rule: `visual`, message: name + ` 亮度过高（avgLuma ` + m.avgLuma + `），可能太闪` })
    }
    if (m.hiPct > 40) {
      findings.push({ severity: `warn`, rule: `visual`, message: name + ` 有 ` + m.hiPct + `% 像素接近纯白，可能过曝` })
    }
    if (m.stdLuma < 20) {
      findings.push({ severity: `warn`, rule: `visual`, message: name + ` 对比度过低（std ` + m.stdLuma + `），可能看不清` })
    }
  }
  return findings
}
/** 提取 PR body 中某个 ## 小节的内容（去除 HTML 注释）。 */
export function readSection(body, label) {
  const escaped = label.replace(/[.*+?^${{}()|[\]\\]/g, `\\$&`)
  const pattern = new RegExp(`(?:^|\\n)##\\s+` + escaped + `\\s*\\n+([\\s\\S]*?)(?=\\n##\\s+|$)`, `i`)
  const match = String(body || ``).match(pattern)
  return match ? match[1].replace(/<!--[\s\S]*?-->/g, ``).trim() : ``
}

function isBlank(value) {
  const normalized = String(value).replace(/\s+/g, ` `).trim().toLowerCase()
  return normalized === `` || normalized === `no response` || normalized === `_no response_`
}

function hasCheckedLine(value, label) {
  return String(value).split(`\n`).some((line) => /^-\s*\[[xX]\]/.test(line) && line.includes(label))
}

function hasAnyCheckedBox(value) {
  return /^-\s*\[[xX]\]\s+\S+/m.test(String(value))
}

function hasEvidence(value) {
  return /!\[[^\]]*]\([^)]+\)/i.test(String(value))
    || /https?:\/\/\S*(?:github\.com\/user-attachments\/assets\/|github\.com\/[^)\s]+\/assets\/|githubusercontent\.com\/|[./][^)\s]+\.(?:png|jpe?g|gif|webp|mp4|mov|webm))(?:[?#]\S*)?/i.test(String(value))
}

/** 模板内既有的字段标签（readField 的合法边界；正文里的普通冒号行不算边界）。 */
const FIELD_LABELS = new Set([
  `执行的命令`, `结果摘要`, `使用的 AI 模型`, `使用的编码 Agent 工具`,
])

/** 读取小节内某字段（label 行之后第一个非空非注释行，或行内冒号后的内容）。 */
function readField(section, label) {
  const cleaned = String(section).replace(/<!--[\s\S]*?-->/g, ``)
  const lines = cleaned.split(`\n`)
  const idx = lines.findIndex((l) => l.includes(label))
  if (idx === -1) return ``
  // 优先取 label 行内冒号后的内容；否则收集后续内容直到下一个「已知字段标签」行。
  // 与 pr-contribution-rules.yml 的 readValidationPart 语义对齐：值允许代码围栏 /
  // 列表 / 多行；只有模板里既有字段标签才算边界——"- xxx：yyy" 列表行与
  // "全部通过：typecheck 全绿" 这类冒号正文行都曾被误判为下一个字段，
  // 导致按模板填写的 PR 被误拒。
  const inline = lines[idx].split(/[：:]/).slice(1).join(``).trim()
  if (inline) return inline
  const out = []
  let inFence = false
  for (const line of lines.slice(idx + 1)) {
    const t = line.trim()
    if (t.startsWith("```")) { inFence = !inFence; continue }
    if (!inFence && !/^[-*#>`!]/.test(t)) {
      const m = t.match(/^([^：:]{1,24})[：:]\s*(\S.*)?$/)
      if (m && FIELD_LABELS.has(m[1].trim())) break
    }
    out.push(line)
  }
  return out.join(`\n`).trim()
}

/**
 * PR 模板合规检查：对齐 pr-contribution-rules.yml 的规则，另补充
 * 摘要非空与 AI 编码披露必填（模板标注必填，CI 未查）。
 * prInfo: gh pr view 的 JSON（含 body / author.login）；repoOwner: 仓库 owner。
 */
export function checkTemplate(prInfo, repoOwner) {
  const body = prInfo.body || ``
  const findings = []
  const summary = readSection(body, `摘要（Summary）`)
  const prType = readSection(body, `PR 类型（PR Type）`)
  const prCategory = readSection(body, `PR 类别（PR Category）`)
  const latest = readSection(body, `最新代码确认（Latest Codebase Confirmation）`)
  const evidenceRules = readSection(body, `测试证据与上游同步（Test Evidence & Upstream Sync）`)
  const visualRules = readSection(body, `视觉修复要求（Visual Fix Requirements）`)
  const validation = readSection(body, `本地验证（Local Validation）`)
  const evidence = readSection(body, `用户可见变更证据（Local Feature Evidence）`)
  const packages = readSection(body, `涉及包（Affected Packages）`)

  if (isBlank(summary)) {
    findings.push({ severity: `reject`, rule: `template`, message: `PR 摘要（Summary）为空` })
  }
  if (!hasAnyCheckedBox(prType)) {
    findings.push({ severity: `reject`, rule: `template`, message: `PR 类型（PR Type）未勾选任何一项` })
  }
  if (!hasAnyCheckedBox(prCategory)) {
    findings.push({ severity: `reject`, rule: `template`, message: `PR 类别（PR Category）未勾选任何一项` })
  }
  if (!hasCheckedLine(latest, `我已基于最新`)) {
    findings.push({ severity: `reject`, rule: `template`, message: `最新代码确认（Latest Codebase Confirmation）未勾选（须基于最新 dev 分支）` })
  }
  const validationCommands = readField(validation, `执行的命令`)
  const validationSummary = readField(validation, `结果摘要`)
  if (isBlank(validationCommands) || isBlank(validationSummary)) {
    findings.push({ severity: `reject`, rule: `template`, message: `本地验证（Local Validation）的执行的命令与结果摘要未填写` })
  }

  // AI 编码披露（模板必填；CI 未查，本地补上）
  const ai = readSection(body, `AI 编码披露（AI Coding Disclosure）`)
  const fullyAI = hasCheckedLine(ai, `完全 AI 编码`)
  const partialAI = hasCheckedLine(ai, `部分 AI 辅助`)
  const noAI = hasCheckedLine(ai, `未使用 AI 编码辅助`)
  if (!fullyAI && !partialAI && !noAI) {
    findings.push({ severity: `reject`, rule: `template`, message: `AI 编码披露（AI Coding Disclosure）未勾选任何一项（模板必填）` })
  } else if ((fullyAI || partialAI) && !noAI) {
    const model = readField(ai, `使用的 AI 模型`)
    if (isBlank(model) || /^(n\/a|无)$/i.test(model)) {
      findings.push({ severity: `reject`, rule: `template`, message: `声明使用 AI 编码但未填写使用的 AI 模型` })
    }
  }

  const isRepoOwner = prInfo.author && prInfo.author.login === repoOwner
  if (!isRepoOwner) {
    // 贡献者 PR 证据门槛（模板「测试证据与上游同步」必填）：自测证据 +
    // 同步上游最新 dev 分支后重新测试通过的证据，缺失即拒绝。
    if (!hasCheckedLine(evidenceRules, `我提供了自己本地测试的证据`)) {
      findings.push({ severity: `reject`, rule: `template`, message: `贡献者 PR 必须勾选「测试证据与上游同步」的自测证据项（提供自己本地测试的证据）` })
    }
    if (!hasCheckedLine(evidenceRules, `我已同步上游最新`)) {
      findings.push({ severity: `reject`, rule: `template`, message: `贡献者 PR 必须勾选「测试证据与上游同步」的上游同步项（同步 dev 最新代码并附重测证据）` })
    }
    const userFacing = hasCheckedLine(prType, `面向用户的功能或行为变更`)
    const visualFix = hasCheckedLine(prType, `视觉修复`)
    if ((visualFix || userFacing) && !hasEvidence(evidence)) {
      findings.push({ severity: `reject`, rule: `template`, message: `视觉修复 / 用户可见变更的 PR 必须附带截图或视频证据（视觉修复还需完成态或修复前后对比截图）` })
    }
    if (visualFix) {
      if (!hasCheckedLine(visualRules, `我提供了修复完成后的截图`)) {
        findings.push({ severity: `reject`, rule: `template`, message: `视觉修复 PR 必须勾选「视觉修复要求」的完成截图项（提供修复完成后的截图）` })
      }
      const aiUsed = fullyAI || partialAI
      if (aiUsed && !hasCheckedLine(visualRules, `修复使用的 AI 模型支持图像输入`)) {
        findings.push({ severity: `reject`, rule: `template`, message: `视觉修复必须使用支持图像输入的多模态 AI 模型完成（「视觉修复要求」节勾选并填写模型名）` })
      }
      if (aiUsed) {
        const model = readField(ai, `使用的 AI 模型`)
        if (isBlank(model) || TEXT_ONLY_MODEL_RES.some((re) => re.test(model))) {
          findings.push({ severity: `reject`, rule: `template`, message: `视觉修复使用的 AI 模型必须是多模态模型（支持图像输入）；纯文本模型（如 deepseek-chat / deepseek-reasoner / gpt-3.5）修复的视觉类 PR 不接受` })
        }
      }
    }
  }

  if (packages && !hasAnyCheckedBox(packages)) {
    findings.push({ severity: `warn`, rule: `template`, message: `涉及包（Affected Packages）未勾选（仅文档 / 脚本改动请说明）` })
  }
  return findings
}

/** 提交信息检查：Conventional Commits（warn）+ emoji（reject）。 */
export function checkCommits(commits) {
  const findings = []
  for (const commit of commits || []) {
    const headline = (commit.messageHeadline || ``).trim()
    if (!headline) continue
    if (!CONVENTIONAL_COMMIT_RE.test(headline)) {
      findings.push({ severity: `warn`, rule: `commit-message`, message: `提交信息不符合 Conventional Commits: ` + headline })
    }
    if (EMOJI_RE.test(headline)) {
      findings.push({ severity: `reject`, rule: `emoji`, message: `提交信息含 emoji: ` + headline })
    }
  }
  return findings
}

/** 汇总 verdict：reject 优先，其次构建失败，其次 warn。 */
export function finalVerdict(findings, buildResult) {
  if (findings.some((f) => f.severity === `reject`)) return `REJECT`
  if (buildResult && buildResult.failures.length > 0) return `FAIL`
  if (findings.some((f) => f.severity === `warn`)) return `WARN`
  return `PASS`
}

export function fmtBytes(bytes) {
  if (!bytes) return `0 B`
  const units = [`B`, `KB`, `MB`, `GB`]
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `` + (v >= 100 ? Math.round(v) : v.toFixed(1)) + ` ` + units[i]
}

// ---------------------------------------------------------------- 执行层

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: `utf8`,
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  })
  if (res.error) throw res.error
  return { status: res.status, stdout: res.stdout || ``, stderr: res.stderr || `` }
}

function runOk(cmd, args, opts = {}) {
  const res = run(cmd, args, opts)
  if (res.status !== 0) {
    const tail = (res.stderr || res.stdout || ``).trim().split(`\n`).slice(-5).join(`\n`)
    throw new Error(`` + cmd + ` ` + args.join(` `) + ` 失败（exit ` + res.status + `）: ` + tail)
  }
  return res.stdout
}

function findRepoRoot(start) {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, `.git`))) return dir
    const parent = resolve(dir, `..`)
    if (parent === dir) throw new Error(`未找到 git 仓库根目录`)
    dir = parent
  }
}

function inferRepoFromRemote(repoRoot) {
  const out = runOk(`git`, [`remote`, `get-url`, `origin`], { cwd: repoRoot }).trim()
  const m = out.match(/(?:github\.com[:/])([^\s/]+)\/([^\s/]+?)(?:\.git)?$/)
  if (!m) throw new Error(`无法从 remote 推断仓库: ` + out)
  return `` + m[1] + `/` + m[2]
}

function gh(args, opts = {}) {
  return runOk(`gh`, args, opts)
}

function ghJson(args) {
  return JSON.parse(gh(args))
}

/** 获取 PR 基本信息（gh pr view --json）。 */
async function fetchPrInfo(repo, number) {
  return ghJson([
    `pr`, `view`, String(number), `--repo`, repo, `--json`,
    `number,title,url,state,isDraft,mergeable,author,baseRefName,headRefName,headRefOid,body,commits,createdAt`,
  ])
}

/** 列出 open PR。 */
function listOpenPrs(repo) {
  return ghJson([`pr`, `list`, `--repo`, repo, `--state`, `open`, `--json`, `number,isDraft`])
}

/** 解析 CLI 参数。 */
export function parseArgs(argv) {
  const opts = {
    prs: [], open: false, includeDraft: false, skipBuild: false, cleanup: false,
    worktreeRoot: null,
    concurrency: DEFAULT_CONCURRENCY, maxAdded: DEFAULT_MAX_ADDED, maxDeleted: DEFAULT_MAX_DELETED,
    maxFileBytes: DEFAULT_MAX_FILE_BYTES, json: false, color: true, repo: null, help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => { i += 1; return argv[i] }
    if (/^\d+$/.test(a)) opts.prs.push(Number(a))
    else if (a === `--open`) opts.open = true
    else if (a === `--include-draft`) opts.includeDraft = true
    else if (a === `--skip-build`) opts.skipBuild = true
    else if (a === `--cleanup`) opts.cleanup = true
    else if (a === `--workdir`) opts.worktreeRoot = next()
    else if (a === `--json`) opts.json = true
    else if (a === `--no-color`) opts.color = false
    else if (a === `-h` || a === `--help`) opts.help = true
    else if (a === `--repo`) opts.repo = next()
    else if (a === `--concurrency`) opts.concurrency = Number(next()) || DEFAULT_CONCURRENCY
    else if (a === `--max-added`) opts.maxAdded = Number(next()) || DEFAULT_MAX_ADDED
    else if (a === `--max-deleted`) opts.maxDeleted = Number(next()) || DEFAULT_MAX_DELETED
    else if (a === `--max-file-bytes`) opts.maxFileBytes = Number(next()) || DEFAULT_MAX_FILE_BYTES
    else throw new Error(`未知参数: ` + a + `（用 --help 查看用法）`)
  }
  if (!opts.help && !opts.cleanup && !opts.prs.length && !opts.open) throw new Error(`需要指定 PR 编号或 --open（--cleanup 模式除外）`)
  return opts
}

/** 简单并发池。 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = cursor
      cursor += 1
      if (idx >= items.length) return
      results[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return results
}

function runGit(repoRoot, args) {
  return runOk(`git`, args, { cwd: repoRoot })
}

/** 在指定目录（worktree）内执行 git。 */
function runGitIn(workdir, args) {
  return runOk(`git`, args, { cwd: workdir })
}

/** 收集一个 PR 的 diff 数据（numstat / name-status / 新增文件 / 全文 diff / 文件大小）。
 * 规模超限时不生成全文 diff（避免超大 PR 的输出与扫描开销）。
 */
export function collectPrDiff(repoRoot, prInfo, maxAdded = DEFAULT_MAX_ADDED, maxDeleted = DEFAULT_MAX_DELETED) {
  const base = `origin/` + prInfo.baseRefName
  const head = `refs/pr-review/` + prInfo.number + `/head`
  const range = `` + base + `...` + head
  const numstat = parseNumstat(runGit(repoRoot, [`diff`, `--numstat`, range]))
  const allChanges = parseNameStatus(runGit(repoRoot, [`diff`, `--name-status`, range]))
  const addedStat = parseNumstat(runGit(repoRoot, [`diff`, `--numstat`, `--diff-filter=A`, range]))
  const overLimit = numstat.totalAdded > maxAdded || numstat.totalDeleted > maxDeleted
  let diffText = ``
  if (!overLimit) diffText = runGit(repoRoot, [`diff`, `--unified=0`, range])
  const sizes = {}
  if (addedStat.files.length) {
    // 不传路径参数（新增文件过多会超出 ARG_MAX），全量列出后按需取
    const wanted = new Set(addedStat.files.map((f) => f.path))
    const ls = runGit(repoRoot, [`ls-tree`, `-r`, `-l`, head])
    for (const line of ls.split(`\n`)) {
      if (!line.trim()) continue
      const tab = line.indexOf(`\t`)
      if (tab === -1) continue
      const path = line.slice(tab + 1)
      if (!wanted.has(path)) continue
      const meta = line.slice(0, tab).split(/\s+/)
      sizes[path] = Number(meta[3] || 0)
    }
  }
  return {
    stat: numstat,
    addedFiles: addedStat.files,
    allChanges,
    diffText,
    sizes,
  }
}

/** 静态审核：纯数据 -> findings。规模超限直接拒绝，不做内容扫描与模板检查。 */
export function staticReview(prInfo, diff, opts, repoOwner) {
  const sizeFindings = checkSize(diff.stat, opts.maxAdded, opts.maxDeleted)
  const skin = checkSkinChanges(diff.allChanges)
  if (sizeFindings.some((f) => f.severity === `reject`)) {
    return [...sizeFindings, ...checkForbiddenFiles(diff.addedFiles, diff.sizes, opts.maxFileBytes)]
  }
  // addedLinesFromDiff 解析一次，密钥与 emoji 扫描共享。
  const addedLines = addedLinesFromDiff(diff.diffText)
  return [
    ...sizeFindings,
    ...checkForbiddenFiles(diff.addedFiles, diff.sizes, opts.maxFileBytes),
    ...checkSecrets(diff.diffText, addedLines),
    ...checkEmoji(diff.diffText, addedLines),
    ...checkWorkflowChanges(diff.allChanges),
    ...checkLockfile(diff.allChanges),
    ...checkTemplate(prInfo, repoOwner),
    ...checkCommits(prInfo.commits),
    ...checkCopyright(prInfo, skin.isSkin, repoOwner),
    ...checkSkinPreviews(diff.allChanges, skin.skinIds),
  ]
}

/** 在 ~/remote-e2e 工作区 worktree 上跑 CI 门禁序列（同 head 复用，跑完保留待定期清理）。 */
export function buildVerify(repoRoot, number, headRef, worktreeRoot) {
  const workdir = join(worktreeRoot, `pr-` + number)
  const results = { failures: [], logs: {}, workdir }
  mkdirSync(worktreeRoot, { recursive: true })
  try {
    const headSha = runGit(repoRoot, [`rev-parse`, headRef]).trim()
    const porcelain = runGit(repoRoot, [`worktree`, `list`, `--porcelain`])
    let cur = null
    let existingHead = null
    for (const line of porcelain.split(`\n`)) {
      if (line.startsWith(`worktree `)) cur = line.slice(9)
      else if (line.startsWith(`HEAD `) && cur === workdir) existingHead = line.slice(5)
    }
    if (existingHead === headSha) {
      results.reused = true
      // 上次构建会重建 bundle（嵌入本机路径），复用前恢复干净工作树（worktree 为专用临时目录）
      runGitIn(workdir, [`clean`, `-fdx`])
      runGitIn(workdir, [`reset`, `--hard`, `HEAD`])
    } else {
      if (existingHead) runGit(repoRoot, [`worktree`, `remove`, `--force`, workdir])
      runGit(repoRoot, [`worktree`, `add`, `--detach`, workdir, headRef])
    }
  } catch (e) {
    results.failures.push(`worktree`)
    results.logs.worktree = String(e.message)
    return results
  }
  try {
    for (const [name, cmd, args, timeoutMs] of BUILD_STEPS) {
      const res = run(cmd, args, { cwd: workdir, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
      const tail = (res.stdout + `\n` + res.stderr).trim().split(`\n`).slice(-30).join(`\n`)
      results.logs[name] = tail
      if (res.status !== 0 || res.signal) {
        results.failures.push(name)
        break
      }
    }
  } catch (e) {
    results.failures.push(`runner`)
    results.logs.runner = String(e.message)
  }
  return results
}

/** 皮肤视觉验证：在已构建的 worktree 里生成预览截图并复制到 e2e 工作区。 */
export function skinVisualVerify(repoRoot, number, skinIds, worktreeRoot, workdir) {
  const outDir = join(worktreeRoot, `e2e-` + number, `previews`)
  mkdirSync(outDir, { recursive: true })
  const previews = []
  try {
    const res = run(`node`, [`scripts/capture-previews`, ...skinIds], { cwd: workdir, timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 })
    if (res.status !== 0) {
      return { error: `预览截图失败: ` + res.stderr.trim().split(`\n`).slice(-3).join(` `), previews }
    }
    for (const id of skinIds) {
      for (const mode of [`light`, `dark`]) {
        const src = join(workdir, `packages`, `skins`, `skin-center`, `skins`, id, `preview`, mode + `.jpg`)
        if (existsSync(src)) {
          const dst = join(outDir, id + `-` + mode + `.png`)
          copyFileSync(src, dst)
          previews.push(dst)
        }
      }
    }
    if (!previews.length) return { error: `未找到预览截图（确认皮肤包已构建且含 lib/client.js）`, previews }
    // 像素指标分析：亮度（太闪）/ 对比度（看不清），结果写 metrics.json
    const metrics = analyzePixels(workdir, previews)
    writeFileSync(join(outDir, `metrics.json`), JSON.stringify(metrics, null, 2))
    return { previews, metrics, findings: judgeVisualMetrics(metrics) }
  } catch (e) {
    return { error: String(e.message), previews }
  }
}

/** 用 playwright 在页面里解码截图并统计亮度/对比度/饱和度指标。 */
function analyzePixels(workdir, previews) {
  const script = [
    "const { chromium } = require('playwright');",
    "const fs = require('fs');",
    "(async () => {",
    "  const b = await chromium.launch()",
    "  const page = await b.newPage()",
    "  await page.setContent('<html><body><img id=\"i\" style=\"display:none\"></body></html>')",
    "  const results = []",
    "  for (const p of process.argv.slice(2)) {",
    "    const b64 = fs.readFileSync(p).toString('base64')",
    "    const r = await page.evaluate(async (src) => {",
    "      const img = document.getElementById('i')",
    "      img.src = src",
    "      await img.decode().catch(() => {})",
    "      const c = document.createElement('canvas')",
    "      c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1",
    "      const ctx = c.getContext('2d')",
    "      ctx.drawImage(img, 0, 0)",
    "      let data",
    "      try { data = ctx.getImageData(0, 0, c.width, c.height).data } catch (e) { return { error: String(e).slice(0, 120) } }",
    "      let sum = 0, sumsq = 0, hi = 0, lo = 0, satSum = 0",
    "      const n = data.length / 4",
    "      for (let i = 0; i < data.length; i += 4) {",
    "        const rr = data[i], g = data[i + 1], bl = data[i + 2]",
    "        const y = 0.299 * rr + 0.587 * g + 0.114 * bl",
    "        sum += y; sumsq += y * y",
    "        if (y > 235) hi++",
    "        if (y < 20) lo++",
    "        const mx = Math.max(rr, g, bl), mn = Math.min(rr, g, bl)",
    "        satSum += mx === 0 ? 0 : (mx - mn) / mx",
    "      }",
    "      const avg = sum / n",
    "      return { w: c.width, h: c.height, avgLuma: Math.round(avg * 10) / 10, stdLuma: Math.round(Math.sqrt(sumsq / n - avg * avg) * 10) / 10, hiPct: Math.round(hi / n * 1000) / 10, loPct: Math.round(lo / n * 1000) / 10, satAvg: Math.round(satSum / n * 1000) / 10 }",
    "    }, 'data:image/png;base64,' + b64)",
    "    results.push({ file: p.split('/').pop(), ...r })",
    "  }",
    "  console.log('PIXRESULT' + JSON.stringify(results))",
    "  await b.close()",
    "})()",
  ].join(`\n`)
  try {
    const shotFile = join(workdir, `.pr-review-pixel-shot.cjs`)
    writeFileSync(shotFile, script)
    try {
      const res = run(`node`, [shotFile, ...previews], { cwd: workdir, timeout: 180 * 1000, maxBuffer: 16 * 1024 * 1024 })
      const m = res.stdout.match(/PIXRESULT(\[.*\])/)
      if (m) return JSON.parse(m[1])
    } finally {
      rmSync(shotFile, { force: true })
    }
  } catch { /* 指标分析失败不阻塞 */ }
  return []
}
/** 清理工作区：移除其下全部 worktree、删除目录与遗留 refs。返回移除数。 */
export function cleanupWorktrees(repoRoot, worktreeRoot) {
  const removed = []
  try {
    const porcelain = runGit(repoRoot, [`worktree`, `list`, `--porcelain`])
    let cur = null
    for (const line of porcelain.split(`\n`)) {
      if (line.startsWith(`worktree `)) cur = line.slice(9)
      else if (line === `` && cur) {
        if (cur === worktreeRoot || cur.startsWith(worktreeRoot + `/`)) removed.push(cur)
        cur = null
      }
    }
  } catch { /* 忽略 */ }
  for (const p of removed) {
    try { runGit(repoRoot, [`worktree`, `remove`, `--force`, p]) } catch { /* 忽略 */ }
  }
  rmSync(worktreeRoot, { recursive: true, force: true })
  try {
    const refs = runGit(repoRoot, [`for-each-ref`, `--format=%(refname)`, `refs/pr-review/`])
    for (const ref of refs.trim().split(`\n`)) {
      if (ref) runGit(repoRoot, [`update-ref`, `-d`, ref])
    }
  } catch { /* 无遗留 ref */ }
  return removed.length
}

/** 启动时清理上次残留：prune 失效 worktree，删除遗留 refs/pr-review/*。 */
function cleanupStale(repoRoot) {
  try { runGit(repoRoot, [`worktree`, `prune`]) } catch { /* 忽略 */ }
  try {
    const refs = runGit(repoRoot, [`for-each-ref`, `--format=%(refname)`, `refs/pr-review/`])
    for (const ref of refs.trim().split(`\n`)) {
      if (ref) runGit(repoRoot, [`update-ref`, `-d`, ref])
    }
  } catch { /* 无遗留 ref */ }
}

// ---------------------------------------------------------------- CLI

const HELP = `用法: node scripts/pr-review.mjs [选项] [PR编号...]

本地批量审核远程 PR：静态硬性规则 + 工作区 worktree 构建验证（对齐 CI 门禁）。

  PR编号...                 审核指定 PR（可多个）
  --open                    审核全部 open PR（一次多个）
  --repo owner/repo         目标仓库（默认从 git remote 推断）
  --include-draft           包含 draft PR（默认跳过）
  --skip-build              跳过 worktree 构建验证（只做静态检查）
  --workdir <path>          worktree 工作区根目录（默认 ~/remote-e2e，e2e 验证同区）
  --cleanup                 清理工作区全部 worktree 后退出（定期清理用）
  --concurrency N           并行审核数（默认 2）
  --max-added N             新增行上限，超过即拒绝（默认 10000）
  --max-deleted N           删除行上限，超过即拒绝（默认 10000）
  --max-file-bytes N        新增文本文件大小上限（默认 1048576）
  --json                    JSON 输出
  --no-color                禁用颜色
  -h, --help                显示帮助

verdict: REJECT(硬性规则) / FAIL(构建门禁) / WARN(有警告需人工) / PASS / SKIP / ERROR
退出码: 存在 REJECT/FAIL/ERROR 时为 1，否则 0。`

function colorize(color, code, text) {
  return color ? `\x1b[` + code + `m` + text + `\x1b[0m` : text
}

const VERDICT_STYLE = {
  REJECT: [`31`, `REJECT`],
  FAIL: [`31`, `FAIL`],
  ERROR: [`31`, `ERROR`],
  WARN: [`33`, `WARN`],
  PASS: [`32`, `PASS`],
  SKIP: [`90`, `SKIP`],
}

/** 单个 PR 的完整审核（fetch 之后）。 */
async function reviewPr(number, prInfo, ctx) {
  const { repoRoot, opts, repoOwner, worktreeRoot } = ctx
  try {
    if (prInfo.state !== `OPEN`) {
      return { number, verdict: `SKIP`, reason: `PR 状态为 ` + prInfo.state, title: prInfo.title }
    }
    if (prInfo.isDraft && !opts.includeDraft) {
      return { number, verdict: `SKIP`, reason: `draft PR（用 --include-draft 审核）`, title: prInfo.title }
    }
    const headRef = `refs/pr-review/` + number + `/head`
    const diff = collectPrDiff(repoRoot, prInfo, opts.maxAdded, opts.maxDeleted)
    const findings = staticReview(prInfo, diff, opts, repoOwner)
    const rejects = findings.filter((f) => f.severity === `reject`)
    let buildResult = null
    if (!rejects.length) {
      buildResult = opts.skipBuild
        ? { failures: [] }
        : buildVerify(repoRoot, number, headRef, opts.worktreeRoot || DEFAULT_WORKTREE_ROOT)
    }
    const skin = checkSkinChanges(diff.allChanges)
    let visual = null
    if (skin.isSkin && buildResult && buildResult.workdir) {
      visual = skinVisualVerify(repoRoot, number, skin.skinIds, worktreeRoot, buildResult.workdir)
      if (visual && visual.findings) findings.push(...visual.findings)
    }
    const verdict = finalVerdict(findings, buildResult)
    const result = {
      number, title: prInfo.title, url: prInfo.url,
      verdict, reason: ``,
      author: prInfo.author?.login || ``,
      isDraft: prInfo.isDraft, mergeable: prInfo.mergeable,
      baseRefName: prInfo.baseRefName,
      stats: {
        files: diff.stat.files.length,
        added: diff.stat.totalAdded,
        deleted: diff.stat.totalDeleted,
        newFiles: diff.addedFiles.length,
      },
      findings,
      build: buildResult ? { failures: buildResult.failures, workdir: buildResult.workdir || null, skipped: opts.skipBuild, reused: buildResult.reused || false } : null,
      visual,
    }
    if (verdict === `FAIL`) result.reason = `构建门禁失败: ` + buildResult.failures.join(`, `)
    return result
  } catch (e) {
    return { number, verdict: `ERROR`, reason: String(e.message), title: prInfo.title || ``, findings: [] }
  }
}

function formatHuman(results, opts) {
  const c = (code, text) => colorize(opts.color, code, text)
  const lines = []
  for (const r of results) {
    const [code, label] = VERDICT_STYLE[r.verdict] || [`0`, r.verdict]
    lines.push(c(code, `#` + r.number + ` ` + label.padEnd(6) + ` ` + (r.title || ``) + `（` + (r.author || `?`) + `）`))
    if (r.verdict === `ERROR` || r.verdict === `SKIP`) {
      lines.push(`  原因: ` + r.reason)
      lines.push(``)
      continue
    }
    lines.push(`  ` + r.stats.files + ` 个文件  +` + r.stats.added.toLocaleString(`en-US`) + `/-` + r.stats.deleted.toLocaleString(`en-US`) + ` 行（新增文件 ` + r.stats.newFiles + ` 个） mergeable=` + r.mergeable)
    if (r.verdict === `FAIL`) lines.push(`  原因: ` + r.reason)
    const ruleCounts = {}
    const ruleShown = {}
    for (const f of r.findings) ruleCounts[f.rule] = (ruleCounts[f.rule] || 0) + 1
    for (const f of r.findings) {
      const shown = ruleShown[f.rule] || 0
      if (shown >= 8) continue
      ruleShown[f.rule] = shown + 1
      const tag = f.severity === `reject` ? `拒绝` : f.severity === `warn` ? `警告` : `提示`
      const color = f.severity === `reject` ? `31` : f.severity === `warn` ? `33` : `90`
      lines.push(c(color, `  [` + tag + `] [` + f.rule + `] ` + f.message))
    }
    for (const [rule, total] of Object.entries(ruleCounts)) {
      if (total > 8) lines.push(`  ... [` + rule + `] 共 ` + total + ` 条命中，仅显示前 8 条（用 --json 看全部）`)
    }
    if (r.build && r.build.failures.length) {
      lines.push(c(`31`, `  [失败] 构建门禁: ` + r.build.failures.join(` -> `)))
    } else if (r.build && !r.build.skipped && r.verdict === `PASS`) {
      lines.push(c(`32`, `  [通过] worktree 构建与全部门禁通过`))
    }
    if (r.build && r.build.workdir && !r.build.skipped) lines.push(`  worktree: ` + r.build.workdir + (r.build.reused ? `（复用）` : ``))
    if (r.visual && r.visual.previews.length) {
      lines.push(`  [视觉] 皮肤预览截图 ` + r.visual.previews.length + ` 张（light/dark），像素指标与截图见 ` + (r.visual.metrics ? `metrics.json` : ``))
      if (r.visual.metrics && r.visual.metrics.length) {
        for (const m of r.visual.metrics) {
          lines.push(`         ` + m.file + `  avg=` + m.avgLuma + `  std=` + m.stdLuma + `  过曝=` + m.hiPct + `%  饱和度=` + m.satAvg)
        }
      }
      for (const p of r.visual.previews) lines.push(`         ` + p)
    }
    if (r.visual && r.visual.error) {
      lines.push(c(`33`, `  [视觉] ` + r.visual.error))
    }
    lines.push(``)
  }
  const summary = results.map((r) => {
    const [code, label] = VERDICT_STYLE[r.verdict] || [`0`, r.verdict]
    return `` + c(code, label.padEnd(6)) + ` #` + String(r.number).padStart(4) + ` ` + (r.title || ``).slice(0, 60)
  })
  lines.push(`-- 汇总 --`)
  lines.push(...summary)
  const counts = {}
  for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1
  lines.push(`共 ` + results.length + ` 个 PR: ` + Object.entries(counts).map(([k, v]) => `` + k + ` ` + v).join(`  `))
  return lines.join(`\n`)
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv)
  if (opts.help) {
    console.log(HELP)
    return 0
  }
  const cwd = env.PR_REVIEW_CWD || process.cwd()
  const repoRoot = findRepoRoot(cwd)
  const repo = opts.repo || inferRepoFromRemote(repoRoot)
  const repoOwner = repo.split(`/`)[0]
  const worktreeRoot = opts.worktreeRoot || DEFAULT_WORKTREE_ROOT
  cleanupStale(repoRoot)
  if (opts.cleanup) {
    const removed = cleanupWorktrees(repoRoot, worktreeRoot)
    console.log(`已清理工作区 ` + worktreeRoot + `（移除 ` + removed + ` 个 worktree）`)
    return 0
  }

  const all = opts.prs.length
    ? opts.prs.map((n) => ({ number: n }))
    : listOpenPrs(repo).map((p) => ({ number: p.number, isDraft: p.isDraft }))
  if (!all.length) {
    console.error(`没有可审核的 PR`)
    return 0
  }

  // 1. 并行获取 PR 信息
  const infos = await mapLimit(all, 8, async (p) => ({ p, info: await fetchPrInfo(repo, p.number) }))
  // 2. 串行 fetch：base 分支与各 PR head（git fetch 有 ref 锁，必须串行）
  const bases = [...new Set(infos.map(({ info }) => info.baseRefName))]
  for (const b of bases) {
    try { runGit(repoRoot, [`fetch`, `origin`, b]) } catch { /* base 可能已最新 */ }
  }
  for (const { p } of infos) {
    try {
      runGit(repoRoot, [`fetch`, `-f`, `origin`, `pull/` + p.number + `/head:refs/pr-review/` + p.number + `/head`])
    } catch (e) {
      console.error(`PR #` + p.number + ` head 获取失败: ` + e.message)
    }
  }
  // 3. 并发审核
  const results = await mapLimit(infos, opts.concurrency, async ({ p, info }) => reviewPr(p.number, info, { repoRoot, opts, repoOwner, worktreeRoot }))

  // 4. 输出
  if (opts.json) {
    console.log(JSON.stringify({ repo, results }, null, 2))
  } else {
    console.log(formatHuman(results, opts))
  }
  return results.some((r) => r.verdict === `REJECT` || r.verdict === `FAIL` || r.verdict === `ERROR`) ? 1 : 0
}

// 直接执行（测试 import 时不触发）
if (process.argv[1] && import.meta.url === `file://` + resolve(process.argv[1])) {
  main().then((code) => { process.exitCode = code })
    .catch((e) => { console.error(e.message); process.exitCode = 1 })
}
