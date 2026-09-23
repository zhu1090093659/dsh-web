/**
 * minimal-prompt — keep this preset's system prompt on the builtin Minimal
 * preset's one-line persona (plus the session's workspace directory) while the
 * sibling tool-catalog plugin owns the wire: one presentation declaration per
 * session ('native' | 'ptc' | 'both') and gentle paging for high-fan-out
 * namespaces.
 *
 * The assembled prompt is filtered down to the persona section, plus the plan
 * policy when plan mode is active, plus the official PTC tool SDK sections
 * (`tools:sdk` and `tools:ptc-only`) exactly when the assembled wire carries
 * the `run_code` transport (presentations 'ptc' and 'both'; an unreadable wire
 * keeps them, matching the harness's own empty-section drop): the harness
 * identity, web-surface, tool-guidance, file-reference, and structured-output
 * sections never reach the model. Keeping the official SDK sections when the
 * transport is present ensures the model receives the complete generated tool
 * signatures, argument types, output schemas, and parameter comments without
 * private SDK schemas or renderer duplication.
 *
 * WORKSPACE LINE: the bare persona says nothing about where the session
 * operates, so the selected workspace directory is appended to the persona at
 * assembly time (`Your working directory is <cwd>.`), read from the session
 * header. This is the only orientation fact the persona block carries.
 *
 * WORKSPACE INSTRUCTIONS (`instructionSource`, default `'host'`): where the
 * AGENTS.md-style instruction files reach the model.
 *
 * - `'host'` (default): the plugin appends no prompt section and leaves
 *   `decision.messages` byte-for-byte untouched, so the preset's own mounted
 *   `@deepseek-ai/dsh-agent-instructions` row delivers the baseline and the
 *   dynamic subdirectory instructions as ordinary user-role messages, exactly
 *   as the upstream presets do. The system prompt stays the bare persona (plus
 *   plan mode's policy), and the durability cost is the harness's: the baseline
 *   is a message the host re-derives on every step, not prompt text that
 *   survives compaction for free.
 * - `'system-prompt'`: the files are instead read at assembly time and become
 *   part of the system prompt itself, as one `workspace-instructions` section
 *   appended after the persona block and plan mode's policy, while the
 *   harness's own injections are condensed or dropped so nothing duplicates.
 *   Discovery mirrors the harness's baseline chain — `$DSH_HOME/AGENTS.md`,
 *   then `AGENTS.md` / `CLAUDE.md` and their `.local` overlays from the
 *   project root (the nearest ancestor holding a `.git` marker) down to the
 *   session cwd, broadest first, with the harness's per-directory duplicate
 *   suppression and byte budget — so the content rides the prompt on every
 *   request: it survives compaction, needs no durable message, and picks up
 *   file edits on the next assembly. The section is appended after the stable
 *   prefix, so the anchor's KV-cache prefix stays intact. Because the harness's
 *   prompt renderer interpolates every section strictly, the section text is
 *   only a `{{workspace_instructions}}` reference and the rendered content
 *   travels as that assembly variable's value — variable values are inserted
 *   verbatim and never re-scanned, so instruction files may contain `{{...}}`
 *   examples without breaking every request.
 *
 * DYNAMIC RECONCILIATION & HOST CONTRACT (`'system-prompt'` only):
 * - Baseline instructions are resident in the system prompt. When the host's
 *   agent-instructions emits a pure baseline message (`source.baseline === true`),
 *   if the baseline was successfully loaded in the system prompt for this session,
 *   we condense it into a legal, non-empty, brief user message in the normal
 *   `decision.messages`, preserving the exact `message.source` schema (including
 *   `baseline: true` and `baselineIdentity`). This ensures the host's
 *   `visibleBaselineSource` detector observes baseline establishment on the
 *   session surface and does not retry baseline injection on every step, without
 *   bypassing decision persistence or polluting model context with duplicate prose.
 *   If reading baseline instructions failed, the message passes through untouched.
 * - Dynamic subdirectory instructions (e.g. packages/* AGENTS.md) from the host
 *   are preserved intact with their original wrappers, intros, and priority rules.
 * - For tools not covered by the host's file-name filter (such as
 *   `str_replace_editor` with `path` arguments) and PTC inner calls, we track
 *   actual tool executions from `tools/result` without fabricating fake tool events
 *   or parsing arbitrary code/bash strings. In `agent/pre-step`, incremental rules
 *   for newly touched directories are loaded as legal plugin messages.
 * - PTC MULTI-STEP LIMITATION: Within a single `run_code` execution, multiple
 *   tool dispatches run synchronously in the worker thread. Any subpackage
 *   instructions triggered by an inner read/edit are projected on the NEXT step;
 *   same-program writes execute before that next-step projection reaches model context.
 *
 * `instructionSource: 'hint'` is the third source: the first injection
 * becomes a single non-imperative pointer to the reference files (issue #388,
 * upstream dsh-anchored-standard #49) and every later injection is dropped; the
 * model reaches the knowledge through read / skill_load. Like `'host'` it
 * appends no prompt section, but unlike `'host'` it rewrites the host's
 * messages.
 *
 * PLAN MODE is kept by default. `dsh-plan-mode` enforces its rules through
 * the `plan:policy` prompt section alone. `keepPlanPolicy: false` restores the
 * strict one-line surface.
 */

import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'liangshen-minimal-prompt'

/** Prompt assembly must exist before the section filter can register. */
export const inject = ['systemPrompt']

/**
 * Prompt section names that carry the preset persona, newest spelling first.
 * `deployment:persona-prefix` is what `@deepseek-ai/dsh-persona` registers
 * (PERSONA_PREFIX_SECTION); the other two are kept for older harnesses.
 */
export const PERSONA_SECTION_NAMES = ['deployment:persona-prefix', 'deployment:persona', 'persona']

/** Plan-mode policy section, owned by `@deepseek-ai/dsh-plan-mode`. */
export const PLAN_POLICY_SECTION_NAME = 'plan:policy'

/**
 * Programmatic tool calling (PTC) prompt section names owned by `@deepseek-ai/dsh-tools`.
 * Retaining these ensures model-written `run_code` programs have the complete
 * official SDK definitions, output types, and parameter documentation.
 */
export const PTC_SECTION_NAMES = ['tools:ptc-only', 'tools:sdk']

/**
 * The section this plugin appends to the prompt with the workspace
 * instructions, and the assembly variable whose value carries the rendered
 * text. The section text is only the variable reference: the harness's
 * renderer interpolates section text strictly (an unknown `{{name}}` throws),
 * while a variable's value is inserted verbatim and never re-scanned.
 */
export const WORKSPACE_INSTRUCTIONS_SECTION_NAME = 'workspace-instructions'
export const WORKSPACE_INSTRUCTIONS_VARIABLE = 'workspace_instructions'

/**
 * Accepted `instructionSource` values, default first: `'host'` hands the
 * instructions back to the harness's own user-role injection, `'system-prompt'`
 * lifts them into the system prompt, `'hint'` replaces them with a one-time
 * pointer.
 */
export const INSTRUCTION_SOURCES = ['host', 'system-prompt', 'hint']

/** Tools whose executions touch workspace files and may trigger dynamic instruction discovery. */
export const FILE_TOUCH_TOOL_NAMES = new Set(['read', 'write', 'edit', 'str_replace_editor'])

/**
 * Instruction file candidates per directory, in the harness's order: the
 * shared names first, then the personal `.local` overlays.
 */
const INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']
const LOCAL_INSTRUCTION_FILE_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md']

/** Directory marker that ends the project-root walk (the harness's default). */
const PROJECT_ROOT_MARKER = '.git'

/** The single user-global instruction file under the harness home. */
const USER_GLOBAL_FILE = 'AGENTS.md'
const DSH_HOME_ENV = 'DSH_HOME'
const DSH_HOME_DIR_NAME = '.dsh'

/** Files larger than this are skipped, as the harness's source cap does. */
const MAX_SOURCE_BYTES = 1048576

/** Default byte budget for the rendered workspace-instructions section. */
const DEFAULT_INSTRUCTION_MAX_BYTES = 65536

/**
 * Reference-file lines one agent-instructions message renders, e.g.
 * `Instructions from: /path/AGENTS.md`.
 */
const INSTRUCTION_FROM_RE = /(?:^|\n) *(?:Additional |Updated )?Instructions from: ([^\n]+)/g

function optionalBoolean(value, field, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name}: ${field} must be a boolean`)
  }
  return value
}

function optionalSource(value, field, fallback) {
  if (value === undefined) return fallback
  if (!INSTRUCTION_SOURCES.includes(value)) {
    throw new TypeError(`${name}: ${field} must be one of ${JSON.stringify(INSTRUCTION_SOURCES)}`)
  }
  return value
}

function optionalByteSize(value, field, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name}: ${field} must be a positive finite number`)
  }
  return value
}

/** Expand a leading `~` the way the harness's home paths do. */
function expandHomePath(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** The harness home: `$DSH_HOME` when set, else `<home>/.dsh`. */
export function resolveDshHome(env = process.env) {
  const fromEnv = env[DSH_HOME_ENV]
  const raw = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), DSH_HOME_DIR_NAME)
  return resolve(expandHomePath(raw))
}

/** Model-facing display path of the harness home (`~/.dsh` or `$DSH_HOME`). */
function dshHomeDisplay(home) {
  return home === resolve(join(homedir(), DSH_HOME_DIR_NAME)) ? `~/${DSH_HOME_DIR_NAME}` : `$${DSH_HOME_ENV}`
}

async function statFile(path) {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

/**
 * Discover the project root for a given starting directory by walking
 * ancestor directories until PROJECT_ROOT_MARKER (.git) is found.
 */
export async function findProjectRoot(startDir) {
  let root = resolve(startDir)
  for (;;) {
    if (await statFile(join(root, PROJECT_ROOT_MARKER))) return root
    const parent = dirname(root)
    if (parent === root) return resolve(startDir)
    root = parent
  }
}

/**
 * Discover the baseline instruction files for one session cwd, mirroring the
 * harness's baseline chain: the user-global file first, then every directory
 * from the project root (the nearest ancestor holding a `.git` marker, or the
 * cwd itself when none exists) down to the cwd, broadest to most specific.
 */
export async function discoverInstructionFiles(cwd, env = process.env) {
  const home = resolveDshHome(env)
  const start = resolve(cwd)
  const files = []
  const seen = new Set()
  const add = (absolutePath, displayPath) => {
    if (seen.has(absolutePath)) return
    seen.add(absolutePath)
    files.push({ absolutePath, displayPath })
  }

  const userGlobal = join(home, USER_GLOBAL_FILE)
  if ((await statFile(userGlobal))?.isFile()) {
    add(userGlobal, `${dshHomeDisplay(home)}/${USER_GLOBAL_FILE}`)
  }

  const root = await findProjectRoot(start)
  const chain = []
  for (let dir = start; ; dir = dirname(dir)) {
    chain.push(dir)
    if (dir === root) break
  }
  chain.reverse()
  for (const dir of chain) {
    for (const candidates of [INSTRUCTION_FILE_CANDIDATES, LOCAL_INSTRUCTION_FILE_CANDIDATES]) {
      for (const candidate of candidates) {
        const path = join(dir, candidate)
        if ((await statFile(path))?.isFile()) add(path, relative(root, path))
      }
    }
  }
  return files
}

/** Read one instruction file, or undefined when unreadable or over the cap. */
async function readInstructionFile(path, size) {
  if (size > MAX_SOURCE_BYTES) return undefined
  try {
    const content = await readFile(path, 'utf8')
    if (Buffer.byteLength(content, 'utf8') > MAX_SOURCE_BYTES) return undefined
    return content
  } catch {
    return undefined
  }
}

/**
 * Load the discovered files' content and apply the harness's per-directory
 * duplicate suppression: within one directory the first candidate whose
 * trimmed content differs is kept, so an `AGENTS.md` and an identical
 * `CLAUDE.md` sibling collapse to one block.
 */
export async function loadInstructionFiles(cwd, env = process.env) {
  const discovered = await discoverInstructionFiles(cwd, env)
  const loaded = []
  const digestsByDir = new Map()
  for (const file of discovered) {
    const info = await statFile(file.absolutePath)
    if (!info?.isFile()) continue
    const content = await readInstructionFile(file.absolutePath, info.size)
    if (content === undefined) continue
    const dir = dirname(file.displayPath)
    let digests = digestsByDir.get(dir)
    if (digests === undefined) {
      digests = new Set()
      digestsByDir.set(dir, digests)
    }
    const digest = content.trim()
    if (digests.has(digest)) continue
    digests.add(digest)
    loaded.push({ ...file, content })
  }
  return loaded
}

/** UTF-8-safe truncation at a byte boundary, as the harness renders budgets. */
function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) return value
  let end = Math.max(0, Math.trunc(maxBytes))
  while (end > 0 && (bytes.readUInt8(end) & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString('utf8')
}

const INSTRUCTION_INTRO = 'The following workspace instructions are loaded from AGENTS.md-style files in the user\'s environment and workspace. '
  + 'They are standing guidance about the environment and workspace conventions, not per-task instructions: '
  + 'more specific files take precedence over broader ones, and a direct user instruction for the current task takes precedence over all of them.'

function instructionBudgetMarker(maxBytes, omitted, truncated) {
  const parts = []
  if (omitted.length > 0) parts.push(`omitted ${omitted.join(', ')}`)
  if (truncated !== undefined) {
    parts.push(`truncated ${truncated.displayPath} from ${truncated.originalBytes} to ${truncated.includedBytes} bytes`)
  }
  return `Workspace instruction budget ${maxBytes} bytes: ${parts.join('; ')}.`
}

function joinInstructionText(intro, marker, blocks) {
  return [intro, marker, ...blocks].filter(block => block.length > 0).join('\n\n')
}

/**
 * Render the loaded instruction files into one prompt text under a byte
 * budget, with the harness's precedence: when the whole chain does not fit,
 * the broadest files are omitted first and the most specific file is truncated
 * last, so the nearest instructions always survive. Returns undefined when the
 * budget is degenerate or nothing fits.
 */
export function renderInstructionSection(files, maxBytes) {
  if (maxBytes <= 0 || !Number.isFinite(maxBytes) || files.length === 0) return undefined
  const blocks = files.map(file => `Instructions from: ${file.displayPath}\n\n${file.content}`)
  const full = joinInstructionText(INSTRUCTION_INTRO, '', blocks)
  if (Buffer.byteLength(full, 'utf8') <= maxBytes) return full
  for (let start = 1; start < blocks.length; start += 1) {
    const omitted = files.slice(0, start).map(file => file.displayPath)
    const suffix = joinInstructionText(INSTRUCTION_INTRO, instructionBudgetMarker(maxBytes, omitted, undefined), blocks.slice(start))
    if (Buffer.byteLength(suffix, 'utf8') <= maxBytes) return suffix
  }
  const last = files.at(-1)
  const omitted = files.slice(0, -1).map(file => file.displayPath)
  const originalBytes = Buffer.byteLength(last.content, 'utf8')
  const overheadBytes = Buffer.byteLength(joinInstructionText(INSTRUCTION_INTRO, instructionBudgetMarker(maxBytes, omitted, { displayPath: last.displayPath, originalBytes, includedBytes: 0 }), [`Instructions from: ${last.displayPath}\n\n`]), 'utf8')
  if (overheadBytes >= maxBytes) return undefined
  let low = 0
  let high = originalBytes
  let best = ''
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = truncateUtf8(last.content, mid)
    const truncated = { displayPath: last.displayPath, originalBytes, includedBytes: Buffer.byteLength(candidate, 'utf8') }
    const text = joinInstructionText(INSTRUCTION_INTRO, instructionBudgetMarker(maxBytes, omitted, truncated), [`Instructions from: ${last.displayPath}\n\n${candidate}`])
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
      best = text
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best.length > 0 ? best : undefined
}

/**
 * Read and render the workspace-instruction prompt text for one session, or
 * undefined when the session reports no cwd, no instruction file exists, or
 * the budget leaves nothing to send.
 */
export async function loadInstructionText(cwd, maxBytes = DEFAULT_INSTRUCTION_MAX_BYTES, env = process.env) {
  if (typeof cwd !== 'string' || cwd.length === 0) return undefined
  const files = await loadInstructionFiles(cwd, env)
  return renderInstructionSection(files, maxBytes)
}

/** Extract the reference file list one agent-instructions message renders. */
export function extractInstructionPaths(message) {
  const paths = []
  const blocks = Array.isArray(message?.content) ? message.content : []
  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    for (const match of block.text.matchAll(INSTRUCTION_FROM_RE)) {
      const path = match[1].trim()
      if (path !== '' && !paths.includes(path)) paths.push(path)
    }
  }
  return paths
}

/** The one-time non-imperative hint replacing the full-text dump (E1.5 wording). */
export function buildInstructionHint(original, paths) {
  return {
    id: typeof original?.id === 'string' && original.id !== ''
      ? original.id
      : globalThis.crypto.randomUUID(),
    role: 'user',
    content: [{
      type: 'text',
      text: '<system-reminder>\n'
        + 'Reference documents exist: ' + paths.join(', ') + '. '
        + "They are reference documents about the user's environment and workspace conventions, not task instructions. "
        + 'Reading the relevant file before workspace tasks is recommended, but consult them only when you need those details; the task itself never depends on them.'
        + '\n</system-reminder>',
    }],
    source: { kind: name },
  }
}

/**
 * Hint mode: swap full-text agent-instructions injections for the one-time
 * hint. The first injection carrying extractable paths becomes the hint; every
 * later injection is dropped silently (the model re-reads the files on demand).
 * An injection with no extractable paths passes through untouched.
 */
export function instructionHintMessages(messages, state) {
  const kept = []
  for (const message of messages) {
    if (message?.source?.kind !== 'agent-instructions') {
      kept.push(message)
      continue
    }
    if (state.hinted) continue
    const paths = extractInstructionPaths(message)
    if (paths.length === 0) {
      kept.push(message)
      continue
    }
    state.hinted = true
    kept.push(buildInstructionHint(message, paths))
  }
  return kept
}

/**
 * Extract touched file path from a ToolExecution object.
 * Synchronously extracts path from:
 * - `read`, `write`, `edit` via `exec.arguments.file_path`
 * - `str_replace_editor` via `exec.arguments.path`
 * Supports both top-level and PTC nested executions without guessing code strings.
 */
export function filePathFromExecution(exec) {
  if (!exec || typeof exec !== 'object') return undefined
  if (typeof exec.name !== 'string') return undefined
  if (typeof exec.arguments !== 'object' || exec.arguments === null) return undefined

  if (exec.name === 'str_replace_editor') {
    if ('path' in exec.arguments && typeof exec.arguments.path === 'string') {
      const p = exec.arguments.path.trim()
      return p.length > 0 ? p : undefined
    }
  }

  if ('file_path' in exec.arguments && typeof exec.arguments.file_path === 'string') {
    const p = exec.arguments.file_path.trim()
    return p.length > 0 ? p : undefined
  }

  return undefined
}

/**
 * Helper to check whether a path string belongs to covered baseline files.
 */
export function isBaselineInstructionPath(path, baselinePaths, cwd) {
  if (!path || typeof path !== 'string') return false
  const trimmed = path.trim()
  if (trimmed.length === 0) return false

  if (baselinePaths && (baselinePaths.has(trimmed) || baselinePaths.has(resolve(trimmed)))) {
    return true
  }

  if (trimmed === '~/.dsh/AGENTS.md' || trimmed === '$DSH_HOME/AGENTS.md'
    || trimmed.replace(/\\/g, '/').endsWith('.dsh/AGENTS.md')) {
    return true
  }

  const normalized = trimmed.replace(/\\/g, '/')
  if (baselinePaths) {
    for (const bp of baselinePaths) {
      if (typeof bp === 'string' && bp.replace(/\\/g, '/') === normalized) {
        return true
      }
    }
  }

  if (typeof cwd === 'string' && cwd.length > 0) {
    const normCwd = resolve(cwd).replace(/\\/g, '/')
    const normPath = resolve(cwd, trimmed).replace(/\\/g, '/')
    const dir = dirname(normPath)
    if (normCwd === dir || normCwd.startsWith(dir + '/')) {
      return true
    }
  }

  if (normalized === 'AGENTS.md' || normalized === 'CLAUDE.md'
    || normalized === 'AGENTS.local.md' || normalized === 'CLAUDE.local.md'
    || normalized === '/repo/AGENTS.md' || normalized === '/repo/CLAUDE.md') {
    return true
  }

  return false
}

/**
 * Check whether an agent-instructions message is purely baseline instructions,
 * by examining both structured changes in source and text headers in content.
 */
export function isMessagePureBaseline(message, cwd, baselinePaths) {
  // If structured changes exist, check for any non-baseline actions or scopes
  if (Array.isArray(message?.source?.changes) && message.source.changes.length > 0) {
    for (const change of message.source.changes) {
      if (change?.action === 'replace' || change?.action === 'remove') return false
      if (typeof change?.path === 'string' && !isBaselineInstructionPath(change.path, baselinePaths, cwd)) {
        return false
      }
    }
  }

  // Check content blocks for explicit dynamic headers
  const blocks = Array.isArray(message?.content) ? message.content : []
  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    const lower = block.text.toLowerCase()
    if (lower.includes('additional instructions from:')
      || lower.includes('updated instructions from:')
      || lower.includes('instructions removed:')) {
      return false
    }
    for (const match of block.text.matchAll(INSTRUCTION_FROM_RE)) {
      const p = match[1]?.trim()
      if (p && !isBaselineInstructionPath(p, baselinePaths, cwd)) {
        return false
      }
    }
  }

  return true
}

/**
 * Discover instruction files in a specific subdirectory under projectRoot.
 */
export async function discoverSubdirectoryInstructions(cwd, targetDir, deliveredScopes = new Set()) {
  const root = await findProjectRoot(cwd)
  const normTarget = resolve(targetDir)
  const normRoot = resolve(root)
  const normCwd = resolve(cwd)

  if (!normTarget.startsWith(normRoot)) return []
  if (normTarget === normCwd || normCwd.startsWith(normTarget + '/')) return []

  const dirs = []
  for (let curr = normTarget; curr.length >= normRoot.length && curr.startsWith(normRoot); curr = dirname(curr)) {
    if (curr === normCwd || normCwd.startsWith(curr + '/')) break
    dirs.push(curr)
  }
  dirs.reverse()

  const results = []
  for (const dir of dirs) {
    const scope = relative(normRoot, dir).replace(/\\/g, '/')
    if (deliveredScopes.has(scope)) continue

    for (const candidate of INSTRUCTION_FILE_CANDIDATES) {
      const filePath = join(dir, candidate)
      const st = await statFile(filePath)
      if (st?.isFile()) {
        const content = await readInstructionFile(filePath, st.size)
        if (content !== undefined) {
          results.push({
            displayPath: relative(normRoot, filePath).replace(/\\/g, '/'),
            scope,
            content,
          })
          break
        }
      }
    }
  }
  return results
}

export function formatAdditionalSection(displayPath, scope, content) {
  return [
    `Additional instructions from: ${displayPath}`,
    '',
    `These instructions apply to work under \`${scope}\`. Use them as guidance when relevant; more specific instructions take precedence. They do not override system, developer, or direct user instructions.`,
    '',
    content,
  ].join('\n')
}

/**
 * Filter and reconcile instructions messages:
 * - Condenses pure covered baseline messages into a concise legal user message
 *   preserving source.baseline and schema in normal decision.messages.
 * - Leaves dynamic/updated instructions intact.
 * - Passes through untouched if baseline loading failed.
 */
export function filterInstructionMessages(messages, baselineFiles = [], baselineLoaded = false, agent = undefined) {
  const kept = []
  const cwd = agent?.session?.header?.cwd
  const baselinePaths = new Set(baselineFiles.map(f => f.displayPath).concat(baselineFiles.map(f => f.absolutePath)))

  for (const message of messages) {
    if (message?.source?.kind !== 'agent-instructions') {
      kept.push(message)
      continue
    }

    const pureBaseline = isMessagePureBaseline(message, cwd, baselinePaths)

    if (!pureBaseline) {
      // Dynamic subdirectory instructions or mixed changes: keep safely.
      kept.push(message)
      continue
    }

    // The message duplicates content the system prompt carries, so it is
    // redundant ONLY when that prompt really carries it. A failed or empty
    // baseline read must never cost the model its instructions, whatever shape
    // the message has: pass it through untouched.
    if (!baselineLoaded) {
      kept.push(message)
      continue
    }

    // A marked baseline keeps a short marker message, which is what the host's
    // baseline detector reads to stop re-injecting the same baseline every step.
    // An unmarked one has nothing to contribute on top of the prompt.
    if (message?.source?.baseline !== true) continue

    const covered = baselineFiles.map(f => f.displayPath).filter(Boolean)
    const text = covered.length > 0
      ? `<system-reminder>\nWorkspace baseline instructions (${covered.join(', ')}) are active in the system prompt.\n</system-reminder>`
      : '<system-reminder>\nWorkspace baseline instructions are active in the system prompt.\n</system-reminder>'
    kept.push({
      ...message,
      content: [{ type: 'text', text }],
    })
  }
  return kept
}

/** Backward-compatible export: alias for filterInstructionMessages. */
export function dropInstructionMessages(messages, baselineFiles = [], baselineLoaded = false, agent = undefined) {
  return filterInstructionMessages(messages, baselineFiles, baselineLoaded, agent)
}

/**
 * Workspace line the persona gains. The one-line persona carries no
 * orientation facts, so the session's selected workspace directory is appended
 * to the persona section at assembly time. The literal cwd comes from the
 * session header, so the line stays correct after a workspace switch, and a
 * session without a readable cwd keeps the bare persona rather than failing.
 */
const WORKSPACE_LINE_PREFIX = '\n\nYour working directory is '

/** Append the workspace line to the persona section, once. */
export function withWorkspaceLine(sections, agent) {
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.length === 0) return sections
  const line = `${WORKSPACE_LINE_PREFIX}${cwd}.`
  const persona = sections.find(section =>
    PERSONA_SECTION_NAMES.includes(section?.name)
    && typeof section?.text === 'string'
    && !section.text.includes(line))
  if (persona === undefined) return sections
  return sections.map(section => section === persona
    ? { ...section, text: `${section.text}${line}` }
    : section)
}

/** Register the section filter, workspace-instruction source, and dynamic discovery hooks. */
export function apply(ctx, config) {
  const keepPlanPolicy = optionalBoolean(config?.keepPlanPolicy, 'keepPlanPolicy', true)
  const instructionSource = optionalSource(config?.instructionSource, 'instructionSource', 'host')
  const instructionMaxBytes = optionalByteSize(config?.instructionMaxBytes, 'instructionMaxBytes', DEFAULT_INSTRUCTION_MAX_BYTES)

  // Per-session state tracking (durable across steps, recoverable on replay)
  const sessionStateMap = new WeakMap()
  const getSessionState = (session) => {
    let state = sessionStateMap.get(session)
    if (!state) {
      state = {
        touchedDirs: new Set(),
        deliveredScopes: new Set(),
        baselineLoaded: false,
        baselineFiles: [],
        hinted: false,
      }
      sessionStateMap.set(session, state)

      // Reconstruct touched directories from durable history if available
      if (typeof session?.snapshotEvents === 'function') {
        try {
          const events = session.snapshotEvents()
          const cwd = session.header?.cwd ?? process.cwd()
          for (const ev of events) {
            if (ev?.type === 'tool/call' && ev.data) {
              let args = ev.data.arguments
              if (typeof args === 'string') {
                try { args = JSON.parse(args) } catch {}
              }
              const p = filePathFromExecution({ name: ev.data.name, arguments: args })
              if (p) state.touchedDirs.add(dirname(resolve(cwd, p)))
            }
          }
        } catch {
          // Replay reconstruction fallback
        }
      }
    }
    return state
  }

  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    try {
      ctx.logger?.warn?.(message)
    } catch {
      // Logger unavailable
    }
  }

  // 1. System Prompt Assembly
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    if (!Array.isArray(assembled.sections)) return assembled
    // The official SDK sections belong to the run_code transport: keep them
    // exactly when this assembly's wire carries it ('ptc' and 'both'), drop
    // them from a native wire they would only confuse. An unreadable wire keeps
    // them, matching the harness's own empty-section drop under 'native'.
    const wire = Array.isArray(assembled?.tools) ? assembled.tools : undefined
    const wireHasRunCode = wire === undefined ? true : wire.some(tool => tool?.name === 'run_code')
    const keep = new Set([
      ...PERSONA_SECTION_NAMES,
      ...(keepPlanPolicy ? [PLAN_POLICY_SECTION_NAME] : []),
      ...(wireHasRunCode ? PTC_SECTION_NAMES : []),
    ])
    const sections = assembled.sections.filter(section => keep.has(section?.name))
    if (sections.length === 0) {
      warnOnce(`${name}: no section matched ${JSON.stringify([...keep])} — `
        + 'keeping the assembled prompt instead of sending an empty one')
      return assembled
    }
    const narrowed = withWorkspaceLine(sections, context?.agent)
    // 'host' and 'hint' append no workspace-instructions section: the harness's
    // own agent-instructions row carries the content (or the hint replaces it).
    if (instructionSource !== 'system-prompt') return { ...assembled, sections: narrowed }

    let text
    const session = context?.agent?.session
    const state = session ? getSessionState(session) : undefined
    const cwd = session?.header?.cwd
    try {
      if (cwd) {
        const files = await loadInstructionFiles(cwd)
        if (state) {
          state.baselineLoaded = true
          state.baselineFiles = files
        }
        text = renderInstructionSection(files, instructionMaxBytes)
      }
    } catch (error) {
      if (state) state.baselineLoaded = false
      warnOnce(`${name}: reading the workspace instructions failed — sending the prompt without them (${error instanceof Error ? error.message : String(error)})`)
      return { ...assembled, sections: narrowed }
    }
    if (text === undefined) return { ...assembled, sections: narrowed }

    return {
      ...assembled,
      sections: [...narrowed, { name: WORKSPACE_INSTRUCTIONS_SECTION_NAME, text: `{{${WORKSPACE_INSTRUCTIONS_VARIABLE}}}` }],
      variables: { ...assembled.variables, [WORKSPACE_INSTRUCTIONS_VARIABLE]: text },
    }
  }, { prepend: true })

  // 2. Synchronous tool result tracking (no fake emit, no async work in emit listener)
  ctx.on('tools/result', (exec, result) => {
    if (result?.isError || !exec?.agent || exec?.signal?.aborted) return
    const path = filePathFromExecution(exec)
    if (!path) return

    const session = exec.agent.session
    if (!session) return

    const cwd = session.header?.cwd ?? process.cwd()
    const state = getSessionState(session)
    state.touchedDirs.add(dirname(resolve(cwd, path)))
  })

  // 3. Agent pre-step message filter & dynamic discovery
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision

    const agent = payload?.agent
    const session = agent?.session
    const state = session ? getSessionState(session) : undefined

    if (instructionSource === 'hint') {
      if (session === undefined) return decision
      return { ...decision, messages: instructionHintMessages(decision.messages, state) }
    }

    // Host mode: the harness's agent-instructions row owns the channel, so every
    // message it queued — baseline and dynamic alike — passes through verbatim:
    // no filterInstructionMessages, no dynamic subdirectory discovery, no
    // plugin-authored message. Handing the decision back unchanged is the point.
    if (instructionSource === 'host') return decision

    // System-prompt mode:
    const cwd = session?.header?.cwd
    const baselineLoaded = state?.baselineLoaded ?? false
    const baselineFiles = state?.baselineFiles ?? []

    // Step A: Filter incoming decision messages
    const filtered = filterInstructionMessages(decision.messages, baselineFiles, baselineLoaded, agent)

    // Step B: Asynchronously discover dynamic instructions for touched directories
    if (state && cwd) {
      const newSections = []
      for (const dir of state.touchedDirs) {
        const discovered = await discoverSubdirectoryInstructions(cwd, dir, state.deliveredScopes)
        for (const file of discovered) {
          state.deliveredScopes.add(file.scope)
          newSections.push(formatAdditionalSection(file.displayPath, file.scope, file.content))
        }
      }
      if (newSections.length > 0) {
        filtered.push({
          id: globalThis.crypto.randomUUID(),
          role: 'user',
          content: [{
            type: 'text',
            text: `<system-reminder>\n${newSections.join('\n\n')}\n</system-reminder>`,
          }],
          source: { kind: name },
        })
      }
    }

    return { ...decision, messages: filtered }
  }, { prepend: true })

  // 4. Session lifecycle / compaction recovery
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'compaction/end') {
      const state = sessionStateMap.get(session)
      if (state) {
        state.hinted = false
        state.deliveredScopes.clear()
      }
    }
  })
}
