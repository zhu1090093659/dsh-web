/**
 * One bounded live benchmark run: a real DeepSeek session driven through the
 * profile's own composition, with the evaluated preset supplied as an ISOLATED
 * registry declaration.
 *
 * Isolation rules this script follows:
 * - The harness home stays the real one, so credentials, settings, and the model
 *   route resolve exactly as they do for a user session. Nothing is copied or read
 *   by this script.
 * - The evaluated preset is materialized into a temporary directory and declared
 *   to the run's own agent-preset registry from the variant patch, so an installed
 *   preset cannot shadow it and no installed preset is edited. (Presets stopped
 *   being discovered from a configured root at 0.1.7-alpha.1: a preset is an
 *   ordinary registry declaration now, so there is no roster `roots` config to
 *   aim at.)
 * - Session persistence is redirected into the run directory, so real session
 *   history is never appended to.
 *
 * The candidate matrix follows the LiangShen V4.1 Flash improvement plan,
 * minus the retired 'both' presentation arm (the SDK dropped the mode, so the
 * shipped default IS the ptc wire): B (current persona + shipped 'ptc'
 * presentation), P (candidate persona + shipped 'ptc' presentation), N
 * (candidate persona + native presentation throughout), and M (the official
 * bundle's Minimal preset as an external reference). Persona wording and tool
 * presentation vary independently, and a run records the baseline it ran
 * against so an aggregated report can attribute a difference to one factor.
 *
 * Usage:
 *   node tools/benchmark-live-run.mjs --variant B [--timeout 300000] [--keep]
 *   node tools/benchmark-live-run.mjs --tasks tools/tasks/liangshen-v41-flash.json --groups B,P,N,M --repeat 3 --max-sessions 60 --budget-cny 10 --prices tools/prices/deepseek-flash.json --out .benchmark-results
 *
 * Cost is CNY: DeepSeek bills in CNY, and the published row the route prices at
 * is quoted in CNY per million tokens (cache hit / cache miss / output) off-peak,
 * doubled while peaking. A run reads an explicit price book, so the budget gate
 * and the report's cost column share one source of truth instead of a conversion
 * factor living in a reader's head.
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
const PRESET_SOURCE = join(PACKAGE_ROOT, 'presets', 'liangshen')
const DRIVER = join(HERE, 'benchmark-driver.mjs').replace(/\\/g, '/')

/** Fixed route every variant runs on, so the comparison isolates the preset. */
export const FIXED_ROUTE = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }

/**
 * Parse 'provider/model[/reasoning-effort]' into a route. The default stays
 * FIXED_ROUTE so an aggregated comparison reads one route per report; a probe
 * run may instead name the route the operator actually uses, which is the
 * only way its behaviour says anything about that operator's sessions.
 */
export function parseRoute(spec) {
  const parts = String(spec).split('/')
  if (parts.length < 2 || parts[0] === '' || parts[1] === '') {
    throw new Error('benchmark: --route wants provider/model[/reasoning-effort]')
  }
  return {
    provider: parts[0],
    model: parts[1],
    reasoningEffort: parts[2] !== undefined && parts[2] !== '' ? parts[2] : FIXED_ROUTE.reasoningEffort,
  }
}

/** The two turns the protocol smoke check uses: an anchored exploration, then a promoted mutation. */
export const DEFAULT_TURNS = [
  'List the files in the current directory with the shell, then reply DONE and stop.',
  'Create a file named hello.txt whose only content is OK, then reply DONE and stop.',
]

/**
 * The candidate persona for groups P/N. It keeps the identity line and replaces
 * the shipped discipline: no ban on reasoning through concrete implementation, a
 * loop exits by changing method or using a tool instead of stopping, and PDCA is
 * expressed as inspect, smallest sufficient change, verify.
 */
export const CANDIDATE_PERSONA = [
  'You are a helpful software engineer assistant.',
  '',
  'Understand the task and inspect relevant files before making changes.',
  'Make the smallest change that satisfies the requirements and workspace instructions.',
  'Reason as deeply as needed, avoiding repetition without new evidence.',
  'Use tools to test uncertain assumptions and verify the result.',
  'Preserve existing comments and explain non-obvious behavior where necessary.',
  'Finish when the requested outcome is verified; report remaining limitations.',
].join('\n')

/**
 * Variant definitions: what changes in the evaluated preset copy. `persona` picks
 * the prompt wording, `presentation` the wire presentation (`null` keeps the
 * shipped default), and `official` selects the bundle's Minimal preset
 * untouched.
 */
export const LIVE_VARIANTS = {
  B: {
    persona: 'current',
    presentation: null,
    note: "baseline: shipped persona, shipped 'ptc' presentation",
  },
  P: {
    persona: 'candidate',
    presentation: null,
    note: "candidate persona, shipped 'ptc' presentation",
  },
  N: {
    persona: 'candidate',
    presentation: 'native',
    note: 'candidate persona, native roster throughout',
  },
  M: {
    persona: 'minimal',
    presentation: null,
    official: true,
    note: 'external reference: the official Minimal preset, official configuration',
  },
}

/** Build the exact cmd.exe argument vector for a trusted .cmd shim. */
function windowsCmdShimArgs(binary, args) {
  const unsafe = /[&|<>"'`%!\n\r\0]/
  if (/["%\n\r\0]/.test(binary) || args.some((arg) => unsafe.test(arg))) {
    throw new Error('benchmark: unsafe Windows command argument')
  }
  const commandLine = '""' + binary + '" ' + args.map((arg) => '"' + arg + '"').join(' ') + '"'
  return ['/d', '/s', '/c', commandLine]
}

/** Spawn one process, capturing output, with a hard timeout. */
function spawnCaptured(command, args, options, timeoutMs) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolveResult({ code: null, stdout, stderr: stderr + String(error), timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolveResult({ code, stdout, stderr, timedOut })
    })
  })
}

/**
 * The official Minimal preset's declaration file: the `dsh-web-app` bundle
 * patch that inserts the `@deepseek-ai/dsh-agent-preset` row for `minimal`.
 * Resolved from the harness install the run actually spawns, because the
 * benchmark drives whatever `dsh` this machine launched with credentials.
 * @returns the absolute path of the official patch file.
 * @throws when that harness cannot be located or ships no such preset.
 */
export function officialMinimalPresetPatch() {
  const relative = join('@deepseek-ai', 'dsh-web-app', 'presets', 'minimal.patch.yml')
  const tried = []
  for (const shim of dshCommands()) {
    try {
      // The `dsh` shim is the only handle on the harness install: resolve the
      // CLI package beside it, then the bundle package inside that install.
      // alpha.2 note: createRequire derives module paths from the literal
      // filename without resolving symlinks, so from the PATH shim
      // (/opt/homebrew/bin/dsh) the lookup walks bin/node_modules and never
      // reaches the install tree; realpath first lands inside the package.
      const fromShim = createRequire(realpathSync(shim))
      const cliPackage = fromShim.resolve('@deepseek-ai/dsh/package.json')
      const patch = createRequire(cliPackage).resolve(relative)
      if (existsSync(patch)) return patch
    } catch (error) {
      tried.push(`${shim}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error('benchmark: the official Minimal preset is unavailable'
    + (tried.length === 0 ? ' (no dsh command on PATH)' : `; tried ${tried.join(' | ')}`))
}

/** Whether any `dsh` command is on PATH (the preset reference tests gate on it). */
export function harnessInstallAvailable() {
  return dshCommands().length > 0
}

/** Every `dsh` command the platform's PATH lookup reports. */
function dshCommands() {
  try {
    return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['dsh'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line !== '')
  } catch {
    return []
  }
}

/**
 * Content hash of every file under one preset directory, so a run records the
 * exact evaluated source instead of a path that a later edit could change.
 */
export function hashTree(dir) {
  const files = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) files.push(full)
    }
  }
  walk(dir)
  files.sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(relative(dir, file).split(sep).join('/'))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * Replace the persona block scalar with candidate wording, matching only the
 * `prefix: |-` scalar and leaving every other composition row untouched.
 */
export function replacePersonaPrefix(text, persona) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^\s*prefix: \|-\s*$/.test(line))
  if (start < 0) throw new Error('benchmark: the preset composition carries no persona prefix scalar to vary')
  const bodyIndent = lines[start].match(/^(\s*)/)[1] + '  '
  let end = start + 1
  while (end < lines.length) {
    const line = lines[end]
    if (line.trim() === '' || line.startsWith(bodyIndent)) { end += 1; continue }
    break
  }
  let blockEnd = end
  while (blockEnd > start + 1 && lines[blockEnd - 1].trim() === '') blockEnd -= 1
  const replacement = persona.split('\n').map((line) => bodyIndent + line)
  return [...lines.slice(0, start + 1), ...replacement, ...lines.slice(blockEnd)].join('\n')
}

/**
 * Absolutize the relative module names of one composition.
 *
 * A declared preset's rows resolve a relative `name` against the DECLARING
 * loader's base, not against the directory the row list came from, so the
 * variant patch inlines the composition with every `./x.mjs` already resolved
 * to the materialized copy's file URL. The scan is block-scalar aware: the
 * persona prefix is prose, and a line inside it that happens to read
 * `name: ./something` is content, not a row.
 */
export function absolutizeModuleNames(text, baseDir) {
  const base = pathToFileURL(baseDir + sep).href
  const out = []
  /** Indentation of the block scalar currently open, if any. */
  let blockScalarIndent
  for (const line of text.split('\n')) {
    const body = line.trim()
    if (blockScalarIndent !== undefined) {
      // Content keeps the scalar open; blank lines belong to it too, and a line
      // at or above the owning key's indentation closes it.
      if (body === '' || line.length - line.trimStart().length > blockScalarIndent) {
        out.push(line)
        continue
      }
      blockScalarIndent = undefined
    }
    if (/^\s*[\w-]+:\s*[|>][-+]?\s*$/.test(line)) {
      blockScalarIndent = line.length - line.trimStart().length
      out.push(line)
      continue
    }
    const match = /^(\s*)name: (\.\.?\/[^\s'"]+)$/.exec(line)
    out.push(match === null ? line : `${match[1]}name: ${new URL(match[2], base).href}`)
  }
  return out.join('\n')
}

/** Indent one composition block so it can sit under a `plugins:` key. */
export function inlineComposition(text, baseDir, indent) {
  const pad = ' '.repeat(indent)
  return absolutizeModuleNames(text, baseDir)
    .split('\n')
    .map(line => (line.trim() === '' ? '' : pad + line))
    .join('\n')
}

/**
 * Copy the evaluated preset into the run directory and apply the variant's
 * configuration change.
 *
 * The non-official variants get the bundled preset tree with their persona and
 * presentation applied; the official reference gets the harness bundle's own
 * Minimal preset patch, copied so the run records the exact bytes it evaluated.
 */
export function materializePreset(root, variantId, variant) {
  const target = join(root, variantId)
  if (variant.official === true) {
    mkdirSync(target, { recursive: true })
    cpSync(officialMinimalPresetPatch(), join(target, 'minimal.patch.yml'))
    return target
  }
  cpSync(PRESET_SOURCE, target, { recursive: true })
  const composition = join(target, 'agent.cordis.yml')
  if (variant.presentation !== null && variant.presentation !== undefined) {
    const text = readFileSync(composition, 'utf8')
    // Anchor on the config line: the composition also NAMES the presentation key
    // inside its prose, and rewriting a comment would leave the real surface alone.
    const pattern = /^(\s*)presentation: '[^']*'/m
    if (!pattern.test(text)) throw new Error('benchmark: the preset composition carries no presentation line to vary')
    const replaced = text.replace(pattern, `$1presentation: '${variant.presentation}'`)
    writeFileSync(composition, replaced)
  }
  if (variant.persona === 'candidate') {
    const text = readFileSync(composition, 'utf8')
    writeFileSync(composition, replacePersonaPrefix(text, CANDIDATE_PERSONA))
  }
  return target
}

/** Every session log under one root, newest last. */
function sessionLogs(root) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.jsonl')) found.push(full)
    }
  }
  if (existsSync(root)) walk(root)
  return found.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
}

/** A non-negative safe integer token count, or undefined for anything else. */
function countOf(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * Provider-reported token totals across one session's attempts, reading the usage
 * chunks the harness records on assistant messages. One event contributes its
 * stream usage or its message usage, never both, so an attempt is not double-counted.
 */
export function summarizeUsage(events) {
  const totals = {
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
  const add = (usage) => {
    if (usage === null || typeof usage !== 'object') return false
    const input = countOf(usage.inputTokens)
    const output = countOf(usage.outputTokens)
    if (input === undefined && output === undefined) return false
    totals.attempts += 1
    totals.inputTokens += input ?? 0
    totals.outputTokens += output ?? 0
    totals.cacheReadTokens += countOf(usage.cacheReadTokens) ?? 0
    totals.cacheWriteTokens += countOf(usage.cacheWriteTokens) ?? 0
    totals.reasoningTokens += countOf(usage.reasoningTokens) ?? 0
    totals.totalTokens += countOf(usage.totalTokens) ?? ((input ?? 0) + (output ?? 0))
    return true
  }
  for (const event of events) {
    if (event?.type !== 'assistant/message' && event?.type !== 'assistant/attempt') continue
    let seen = false
    if (Array.isArray(event.data?.stream)) {
      for (const chunk of event.data.stream) {
        if (chunk?.type === 'usage' && add(chunk.usage)) seen = true
      }
    }
    if (!seen && !add(event.data?.message?.usage)) add(event.data?.usage)
  }
  return { ...totals, uncachedInputTokens: totals.inputTokens }
}

/**
 * The tool names that mutate a workspace. The first one in a session's call order
 * marks the moment the model stopped inspecting and started writing; how many
 * inspections precede it is the "did it verify before acting" guardrail.
 */
const WRITE_TOOL_NAMES = new Set(['write', 'edit', 'str_replace_editor', 'apply_patch'])

/**
 * A provider transport failure recorded as a tool result: the workspace never
 * reached the destination, so the call is evidence about the network rather than
 * about the model's behaviour. Reading a fact the workspace cannot fetch must
 * stay distinguishable from a model that guessed instead of looking.
 */
function isTransportFailure(event) {
  const code = event?.data?.error?.code
  return typeof code === 'string' && code.startsWith('WEB_')
}

/**
 * Read one session log into the evidence the comparison actually needs.
 *
 * The durable shapes this reads are the ones the harness writes:
 * `request/header` carries `data.header.{config,tools}` (the real route and the
 * exact wire surface of that request), `system/message` carries
 * `data.message.content[].text` (the assembled system prompt of that turn), and
 * `assistant/message` carries the provider usage chunks.
 */
export function summarizeSession(logPath) {
  const lines = readFileSync(logPath, 'utf8').split('\n').filter((line) => line.trim() !== '')
  const events = lines.map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)

  const requests = events.filter((event) => event.type === 'request/header').map((event) => {
    const header = event.data?.header ?? {}
    const config = header.config ?? {}
    return {
      seq: event.seq,
      provider: config.provider,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      tools: Array.isArray(header.tools) ? header.tools.map((tool) => tool?.name).filter(Boolean) : [],
    }
  })

  const prompts = events.filter((event) => event.type === 'system/message').map((event) => {
    const blocks = Array.isArray(event.data?.message?.content) ? event.data.message.content : []
    const text = blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('\n')
    return {
      turn: event.data?.turn,
      step: event.data?.step,
      chars: text.length,
      carriesPersona: text.includes('You are a helpful software engineer assistant.'),
      carriesWorkspaceLine: text.includes('Your working directory is '),
      carriesWorkspaceInstructions: text.includes('Instructions from:'),
      carriesSdkSection: text.includes('declare const tools') || text.includes('ToolArgsMap'),
      carriesPtcRule: text.includes('run_code'),
    }
  })

  const toolCallsByName = {}
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const toolName = event.data?.name
    if (typeof toolName === 'string' && toolName !== '') {
      toolCallsByName[toolName] = (toolCallsByName[toolName] ?? 0) + 1
    }
  }

  // Model-issued research calls, counted per call name so a run reports how much
  // it verified rather than only what it produced, plus the plain "did it look
  // before it wrote" guardrail we-need measured (30 -> 6 inspections).
  const researchCallsByName = {}
  for (const name of ['web_search', 'web_fetch']) {
    researchCallsByName[name] = toolCallsByName[name] ?? 0
  }
  const callOrder = events.filter((event) => event.type === 'tool/call').map((event) => event.data?.name)
  const firstWriteIndex = callOrder.findIndex((name) => WRITE_TOOL_NAMES.has(name))
  const inspectionsBeforeFirstWrite = firstWriteIndex === -1 ? callOrder.length : firstWriteIndex

  const toolFailureCodes = {}
  for (const event of events) {
    if (event.type !== 'tool/result' || event.data?.error === undefined) continue
    const code = event.data.error.code ?? event.data.error.name ?? 'unknown'
    toolFailureCodes[code] = (toolFailureCodes[code] ?? 0) + 1
  }

  const toolResults = events.filter((event) => event.type === 'tool/result')
  const transportFailures = toolResults.filter(isTransportFailure).length

  return {
    requests,
    prompts,
    usage: summarizeUsage(events),
    ptcDispatches: events.filter((event) => event.type === 'tool/ptc-dispatch').length,
    toolCalls: events.filter((event) => event.type === 'tool/call').length,
    toolCallsByName,
    toolErrors: toolResults.filter((event) => event.data?.error !== undefined).length,
    // Transport failures are a subset of tool errors: subtract them to get the
    // failures the model itself caused.
    modelToolErrors: toolResults.filter((event) => event.data?.error !== undefined && !isTransportFailure(event)).length,
    transportFailures,
    toolFailureCodes,
    researchCalls: researchCallsByName.web_search + researchCallsByName.web_fetch,
    researchCallsByName,
    firstWriteIndex,
    inspectionsBeforeFirstWrite,
    approvalsAsked: events.filter((event) => event.type === 'approval/asked').length,
    humanInterventions: toolCallsByName.ask_user_question ?? 0,
  }
}

const EMPTY_EVIDENCE = {
  requests: [],
  prompts: [],
  usage: {
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    uncachedInputTokens: 0,
  },
  ptcDispatches: 0,
  toolCalls: 0,
  toolCallsByName: {},
  toolErrors: 0,
  modelToolErrors: 0,
  transportFailures: 0,
  toolFailureCodes: {},
  researchCalls: 0,
  researchCallsByName: { web_search: 0, web_fetch: 0 },
  firstWriteIndex: -1,
  inspectionsBeforeFirstWrite: 0,
  approvalsAsked: 0,
  humanInterventions: 0,
}

/** One git fact for the baseline record, or null when git is unavailable. */
function gitValue(args) {
  try {
    return execFileSync('git', args, { cwd: PACKAGE_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/**
 * The version token in a command's output, or null. The `dsh` shim is a
 * Windows command script, so spawning it wraps the arguments in a second quoting
 * layer and cmd.exe answers with its own "is not recognized" text on stderr; a
 * bare "first non-empty line" would record that error text as the baseline's
 * harness version. Only a version triple is accepted, and only the triple is
 * returned, so a program prefix cannot make two identical installs compare
 * unequal in the report's baseline identity.
 */
export function versionLine(text) {
  const match = String(text ?? '').match(/\bv?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)
  return match === null ? null : match[0]
}

/**
 * The version of the CLI package the `dsh` command on PATH belongs to. It is
 * the fallback that keeps a baseline honest on hosts where spawning the shim
 * cannot answer, and the same resolution walk `officialMinimalPresetPatch`
 * uses: realpath first, because createRequire derives module paths from the
 * literal filename and the PATH shim sits outside the install tree.
 */
function shimPackageVersion() {
  for (const shim of dshCommands()) {
    try {
      const fromShim = createRequire(realpathSync(shim))
      const manifest = readFileSync(fromShim.resolve('@deepseek-ai/dsh/package.json'), 'utf8')
      const version = JSON.parse(manifest).version
      if (typeof version === 'string' && version !== '') return version
    } catch {
      // A stale PATH entry must not hide a resolvable install further down.
    }
  }
  return null
}

/** The installed CLI version, read without touching the running DSH service. */
async function dshVersion() {
  const spec = process.platform === 'win32'
    ? { command: 'cmd.exe', args: windowsCmdShimArgs('dsh', ['--version']), windowsVerbatimArguments: true }
    : { command: 'dsh', args: ['--version'] }
  try {
    const result = await spawnCaptured(spec.command, spec.args, {}, 15000)
    const line = versionLine(result.stdout) ?? versionLine(result.stderr)
    if (line !== null) return line
  } catch {
    // Fall through to the package the shim resolves to.
  }
  return shimPackageVersion()
}

/**
 * The reproducible environment a comparison is only valid within: repository
 * commit, shipped preset source, DSH version, route, platform, and the limits the
 * suite was allowed to spend.
 */
export async function collectBaseline() {
  return {
    recordedAt: new Date().toISOString(),
    repository: { commit: gitValue(['rev-parse', 'HEAD']), dirty: gitValue(['status', '--porcelain']) },
    presetSource: PRESET_SOURCE,
    presetSourceHash: hashTree(PRESET_SOURCE),
    dshVersion: await dshVersion(),
    route: { ...FIXED_ROUTE },
    platform: process.platform,
    node: process.version,
  }
}

/** Load a task corpus file (`{ version, tasks: [...] }`). */
export function loadTaskFile(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(parsed?.tasks) || parsed.tasks.length === 0) {
    throw new Error(`benchmark: ${path} carries no tasks array`)
  }
  const base = dirname(resolve(path))
  for (const task of parsed.tasks) {
    if (typeof task?.id !== 'string' || !Array.isArray(task?.turns) || typeof task?.check !== 'string') {
      throw new Error(`benchmark: task ${JSON.stringify(task?.id)} needs an id, turns, and a check`)
    }
    // A task seeds either inline files or a directory (and support files) that
    // already lives in the repository: a behaviour probe is a small program,
    // and inlining it into JSON would make it unreadable and unreviewable.
    if (task.from !== undefined) {
      const list = Array.isArray(task.from) ? task.from : [task.from]
      if (list.some((entry) => typeof entry !== 'string' || entry === '')) {
        throw new Error(`benchmark: task ${JSON.stringify(task.id)} has a from entry that is not a path`)
      }
      Object.defineProperty(task, '__fromPaths', {
        value: list.map((entry) => resolve(base, entry)),
        enumerable: false,
      })
    }
  }
  return parsed
}

/** The task corpus revision a report is only valid within. */
export function taskRevision(corpus) {
  if (corpus === undefined) return null
  return {
    id: corpus.id ?? null,
    version: corpus.version ?? null,
    tasks: corpus.tasks.length,
    hash: createHash('sha256').update(JSON.stringify(corpus.tasks)).digest('hex'),
  }
}

/** Write a task's seed files into a fresh workspace. */
function writeTaskFiles(workspace, files) {
  for (const [name, content] of Object.entries(files ?? {})) {
    const target = join(workspace, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, String(content), 'utf8')
  }
}

/**
 * Seed a task workspace: its inline files first, then every `from` path. A
 * directory is copied by its contents, a file by its name, so a probe's
 * simulator and the shared module it imports land side by side.
 */
export function materializeTask(workspace, task) {
  writeTaskFiles(workspace, task.files)
  for (const source of task.__fromPaths ?? []) {
    const info = statSync(source, { throwIfNoEntry: false })
    if (info === undefined) {
      throw new Error(`benchmark: task ${JSON.stringify(task.id)} from ${source} does not exist`)
    }
    if (info.isDirectory()) cpSync(source, workspace, { recursive: true })
    else cpSync(source, join(workspace, basename(source)))
  }
}

/**
 * Read a probe's behavioural numbers: the same program shape as a check, but
 * it prints one JSON object and is allowed to fail while still reporting.
 */
export async function evaluateMetrics(workspace, metrics, timeoutMs = 60000) {
  const result = await spawnCaptured(
    process.execPath,
    ['--input-type=module', '-e', metrics],
    { cwd: workspace },
    timeoutMs,
  )
  const lines = result.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  const last = lines.at(-1)
  if (last === undefined) return { error: 'metrics produced no output' }
  try {
    const parsed = JSON.parse(last)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'metrics must print one JSON object' }
    }
    return parsed
  } catch {
    return { error: 'metrics output was not JSON: ' + last.slice(0, 120) }
  }
}

/**
 * Run one task's acceptance check in the workspace. The check is a Node module
 * body, so a task never depends on a platform shell's quoting rules.
 */
export async function evaluateCheck(workspace, check, timeoutMs = 120000) {
  const result = await spawnCaptured(
    process.execPath,
    ['--input-type=module', '-e', check],
    { cwd: workspace },
    timeoutMs,
  )
  return {
    passed: result.code === 0 && !result.timedOut,
    exitCode: result.code,
    timedOut: result.timedOut,
    stderrTail: result.stderr.split('\n').filter((line) => line.trim() !== '').slice(-6).join('\n'),
  }
}

/** Whether a value is a usable per-million price rate. */
function isRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** The key a price table is read by for one route. */
export function routePriceKey(route) {
  return route.provider + '/' + route.model
}

/**
 * The route-keyed rate table a price book carries: either the book's `prices`
 * object, or the book itself when a caller passes a table directly.
 */
export function resolvePriceTable(book) {
  if (book === null || book === undefined) return undefined
  return typeof book === 'object' && typeof book.prices === 'object' && book.prices !== null ? book.prices : book
}

/** The price entry a route resolves to, keyed "provider/model" or by bare model. */
export function routePrices(prices, route) {
  if (prices === null || prices === undefined) return undefined
  return prices[routePriceKey(route)] ?? prices[route.model]
}

/**
 * Validate a price entry before a run spends anything. A missing or non-numeric
 * rate would otherwise silently price every run at zero and disable a budget stop.
 */
export function assertPriceEntry(entry, routeKey) {
  for (const key of ['input', 'output']) {
    if (!isRate(entry?.[key])) {
      throw new Error('benchmark: the price entry for ' + routeKey + ' needs a finite non-negative ' + key + ' rate per million tokens')
    }
  }
  for (const key of ['cacheRead', 'cacheWrite']) {
    if (entry[key] !== undefined && !isRate(entry[key])) {
      throw new Error('benchmark: the price entry for ' + routeKey + ' has a non-finite ' + key + ' rate')
    }
  }
}

/**
 * Estimated cost, in the price book's own currency, for one run's usage under an
 * optional per-million rate table. Cache writes bill at the cache-miss rate when
 * the book names none, which is how the published DeepSeek rows read.
 */
export function priceRun(usage, prices, route) {
  const entry = routePrices(prices, route)
  if (entry === undefined) return null
  assertPriceEntry(entry, routePriceKey(route))
  const cost = (tokens, perMillion) => ((countOf(tokens) ?? 0) / 1_000_000) * perMillion
  return cost(usage.uncachedInputTokens, entry.input)
    + cost(usage.outputTokens, entry.output)
    + cost(usage.cacheReadTokens, entry.cacheRead ?? entry.input)
    + cost(usage.cacheWriteTokens, entry.cacheWrite ?? entry.input)
}

/** Build the variant patch that redirects persistence and selects the isolated preset. */
export function buildPatch({ variantId, variant, presetDir, runDir, turns, route = FIXED_ROUTE }) {
  const presetId = variant.official === true ? OFFICIAL_PRESET_ID : variantId
  const lines = [
    '# The startup row stays MOUNTED: it publishes the headlessStartup provider',
    '# that sandbox-policy and the agent-plane rows inject, and disabling it (as',
    '# this runner did before DSH 0.2.1) leaves every dependent row waiting for a',
    '# service that can no longer appear, so the preset never mounts. Only the',
    '# runner row is disabled: it is what would execute the task itself, and this',
    '# patch replaces it with the benchmark driver below.',
    '- id: headless-runner',
    '  disabled: true',
    '',
    '# DSH 0.2.1 disables the managed credential store in the headless bundle,',
    '# which turns every request into an immediate authentication failure and',
    '# records a session that never reached a model. This run resolves',
    '# credentials the way an interactive session does, so the row is re-enabled',
    '# here rather than replaced.',
    '- id: credentials',
    '  disabled: false',
    '',
    '- id: session-persistence-jsonl',
    '  config:',
    `    root: ${JSON.stringify(join(runDir, 'sessions').replace(/\\/g, '/'))}`,
    '    compression: none',
    '',
    '- id: agent-default-model',
    '  config:',
    '    provider: ' + route.provider,
    '    model: ' + route.model,
    '    reasoningEffort: ' + (route.reasoningEffort ?? FIXED_ROUTE.reasoningEffort),
    '',
    '# The preset roster. The headless profile mounts neither the registry nor a',
    '# preset, so the variant supplies both: `default` names the evaluated preset',
    '# for the session this run creates, and mode selection stays off so no picker',
    '# or default-preset write can move a run off the evaluated arm.',
    '- insert:',
    '    - id: agent-preset-registry',
    "      name: '@deepseek-ai/dsh-agent-preset-registry'",
    '      config:',
    `        default: ${JSON.stringify(presetId)}`,
    '        modeSelectionEnabled: false',
  ]
  if (variant.official !== true) {
    lines.push(
      '',
      '# The evaluated preset as an ordinary declaration: its rows are the',
      '# materialized composition, with every relative module name already',
      '# resolved to that copy so the registry mounts exactly this tree.',
      '- insert:',
      `    - id: preset-${variantId}`,
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      `        id: ${JSON.stringify(presetId)}`,
      '        order: 1',
      '        plugins:',
      inlineComposition(readFileSync(join(presetDir, 'agent.cordis.yml'), 'utf8'), presetDir, 10),
    )
  }
  lines.push(
    '',
    '- insert:',
    '    - id: benchmark-driver',
    `      name: ${JSON.stringify(DRIVER)}`,
    '      config:',
    `        preset: ${JSON.stringify(presetId)}`,
    '        turns:',
    ...(turns ?? DEFAULT_TURNS).map((turn) => `          - ${JSON.stringify(turn)}`),
    '',
  )
  return lines.join('\n')
}

/**
 * The official Minimal preset's own id: the harness bundle declares it, so the
 * variant patch only selects it rather than declaring a second preset.
 */
export const OFFICIAL_PRESET_ID = 'minimal'

/**
 * The reference variant's overlay: the harness bundle's own Minimal preset
 * patch, copied into the run directory so the run records the exact bytes.
 */
function officialPresetPatchPath(presetDir) {
  return join(presetDir, 'minimal.patch.yml')
}

/**
 * Run one variant through one turn list in an isolated preset root, optionally
 * seeded with a task corpus entry and graded by its acceptance check.
 */
export async function runLiveCase(options) {
  const variantId = options.variant
  const variant = LIVE_VARIANTS[variantId]
  if (variant === undefined) throw new Error(`benchmark: unknown variant "${variantId}"`)

  const runDir = mkdtempSync(join(tmpdir(), `dsh-bench-${variantId}-`))
  try {
    const presetRoot = join(runDir, 'presets')
    mkdirSync(presetRoot, { recursive: true })
    const presetDir = materializePreset(presetRoot, variantId, variant)

    const workspace = join(runDir, 'workspace')
    mkdirSync(workspace, { recursive: true })
    if (options.task !== undefined) materializeTask(workspace, options.task)

    const route = options.route ?? FIXED_ROUTE
    const turns = options.turns ?? options.task?.turns ?? DEFAULT_TURNS
    const patch = buildPatch({ variantId, variant, presetDir, runDir, turns, route })

    const patchPath = join(runDir, 'variant.patch.yml')
    writeFileSync(patchPath, patch, 'utf8')

    // The reference variant evaluates the harness's own preset row, so its
    // declaration rides a second overlay instead of the variant patch.
    const overlays = ['--patch', patchPath]
    if (variant.official === true) {
      overlays.push('--patch', officialPresetPatchPath(presetDir))
    }
    const args = ['--profile', 'headless', ...overlays, 'run the configured turns']
    const spec = process.platform === 'win32'
      ? { command: 'cmd.exe', args: windowsCmdShimArgs('dsh', args), windowsVerbatimArguments: true }
      : { command: 'dsh', args }
    const started = Date.now()
    const child = await spawnCaptured(
      spec.command,
      spec.args,
      {
        cwd: workspace,
        env: { ...process.env },
        ...(spec.windowsVerbatimArguments === true ? { windowsVerbatimArguments: true } : {}),
      },
      options.timeoutMs ?? 300000,
    )

    const outcomePath = join(workspace, 'benchmark-driver-outcome.json')
    const outcome = existsSync(outcomePath) ? JSON.parse(readFileSync(outcomePath, 'utf8')) : undefined
    const logs = sessionLogs(join(runDir, 'sessions'))
    const evidence = logs.length > 0 ? summarizeSession(logs.at(-1)) : EMPTY_EVIDENCE
    const check = options.task === undefined
      ? undefined
      : await evaluateCheck(workspace, options.task.check, options.timeoutMs ?? 120000)
    // The behavioural numbers ride beside the pass/fail verdict: a probe can
    // pass on the score while the habit it exists to expose is still there.
    const behaviour = options.task?.metrics === undefined
      ? null
      : await evaluateMetrics(workspace, options.task.metrics)

    return {
      variant: variantId,
      note: variant.note,
      taskId: options.task?.id ?? null,
      category: options.task?.category ?? null,
      repetition: options.repetition ?? 1,
      runDir: options.keep === true ? runDir : undefined,
      presetDir: options.keep === true ? presetDir : undefined,
      variantPresetHash: hashTree(presetDir),
      turns,
      patch,
      exitCode: child.code,
      timedOut: child.timedOut,
      passed: check === undefined ? null : check.passed === true && child.code === 0 && !child.timedOut,
      check,
      behaviour,
      route,
      durationMs: Date.now() - started,
      outcome,
      stderrTail: child.stderr.split('\n').filter((line) => line.trim() !== '').slice(-12).join('\n'),
      ...evidence,
      workspaceFiles: existsSync(workspace) ? readdirSync(workspace) : [],
    }
  } finally {
    if (options.keep !== true) rmSync(runDir, { recursive: true, force: true })
  }
}

/** Backward-compatible single-run entry point used by the smoke invocation. */
export async function runLiveVariant(options) {
  return runLiveCase(options)
}

/**
/**
 * The ordered run plan: every group inside each task and repetition. A group-major
 * walk would let a session or cost limit exhaust the first groups and leave the
 * rest with zero sessions, so the plan keeps each task's arms together and lets a
 * truncated run still support a paired comparison.
 */
export function suitePlan(groups, tasks, repeat) {
  const plan = []
  for (const task of tasks) {
    for (let repetition = 1; repetition <= repeat; repetition += 1) {
      for (const group of groups) plan.push({ group, task, repetition })
    }
  }
  return plan
}

/**
 * Run the staged matrix over a task corpus: every group, task, and repetition in
 * order, stopping at the session or cost limit instead of expanding on its own.
 */
export async function runLiveSuite(options) {
  const outDir = options.outDir ?? '.benchmark-results'
  mkdirSync(outDir, { recursive: true })
  const groups = options.groups ?? Object.keys(LIVE_VARIANTS)
  const corpus = options.tasks
  const repeat = options.repeat ?? 3
  const maxSessions = options.maxSessions ?? Number.POSITIVE_INFINITY
  const budget = options.budgetCny ?? Number.POSITIVE_INFINITY
  const timeoutMs = options.timeoutMs ?? 300000
  const prices = resolvePriceTable(options.prices) ?? null

  const route = options.route ?? FIXED_ROUTE
  const routeKey = routePriceKey(route)
  const routePrice = routePrices(prices, route)
  // A budget gate that cannot price a run would silently never trigger, which is
  // exactly the unbounded spend the plan forbids; validate instead of pretending.
  if (routePrice !== undefined) assertPriceEntry(routePrice, routeKey)
  if (Number.isFinite(budget) && routePrice === undefined) {
    throw new Error('benchmark: --budget-cny needs a price entry for ' + routeKey + '; pass --prices <file>')
  }
  if (!Number.isFinite(maxSessions) && !Number.isFinite(budget)) {
    process.stderr.write('benchmark: no --max-sessions or --budget-cny bound was given; the matrix will run to the end of the corpus\n')
  }

  const baseline = await collectBaseline()
  baseline.taskRevision = taskRevision(corpus)
  baseline.route = route
  baseline.suite = {
    groups,
    repeat,
    maxSessions: Number.isFinite(maxSessions) ? maxSessions : null,
    budgetCny: Number.isFinite(budget) ? budget : null,
    priced: routePrice !== undefined,
  }

  const runs = []
  let sessions = 0
  let estimatedCostCny = 0
  let stopReason = 'completed'

  for (const group of groups) {
    if (LIVE_VARIANTS[group] === undefined) throw new Error('benchmark: unknown variant "' + group + '"')
  }

  outer: for (const step of suitePlan(groups, corpus.tasks, repeat)) {
    const group = step.group
    const task = step.task
    const repetition = step.repetition
    if (sessions >= maxSessions) { stopReason = 'session-limit'; break outer }
    if (estimatedCostCny >= budget) { stopReason = 'budget-limit'; break outer }
    const run = await runLiveCase({
      variant: group,
      task,
      turns: task.turns,
      repetition,
      timeoutMs,
      route,
      keep: options.keep === true,
    })
    sessions += 1
    const costCny = priceRun(run.usage, prices, route)
    if (costCny !== null) estimatedCostCny += costCny
    const record = { baseline, costCny, ...run }
    const file = join(outDir, 'live-' + group + '-' + task.id + '-r' + repetition + '.json')
    writeFileSync(file, JSON.stringify(record, null, 2))
    runs.push({ file, group, taskId: task.id, repetition, passed: run.passed, costCny })
    process.stdout.write(group + ' ' + task.id + ' r' + repetition + ': ' + (run.passed === true ? 'pass' : run.passed === false ? 'fail' : 'n/a') + ' in ' + run.durationMs + 'ms' + (costCny === null ? '' : ' CNY ' + costCny.toFixed(4)) + '\n')
  }

  const suite = {
    baseline,
    stopReason,
    sessions,
    // Cost is recorded in the price book's currency; the book is CNY.
    estimatedCostCny: prices === null ? null : estimatedCostCny,
    runs,
  }
  writeFileSync(join(outDir, 'suite.json'), JSON.stringify(suite, null, 2))
  return suite
}

const isMain = process.argv[1] !== undefined
  && (await import('node:url')).pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  const args = process.argv.slice(2)
  const read = (flag, fallback) => {
    const index = args.indexOf(flag)
    return index === -1 ? fallback : args[index + 1]
  }
  const outDir = read('--out', '.benchmark-results')
  const timeoutMs = Number(read('--timeout', '300000'))

  const routeSpec = read('--route', undefined)
  // Named apart from the per-run 'route' read further down, which is the route
  // a run actually reported rather than the one it was asked for.
  const selectedRoute = routeSpec === undefined ? FIXED_ROUTE : parseRoute(routeSpec)

  if (args.includes('--tasks')) {
    const corpus = loadTaskFile(read('--tasks'))
    const pricesPath = read('--prices', undefined)
    const suite = await runLiveSuite({
      tasks: corpus,
      route: selectedRoute,
      groups: read('--groups', undefined)?.split(',').map((entry) => entry.trim()).filter(Boolean),
      repeat: Number(read('--repeat', '3')),
      maxSessions: Number(read('--max-sessions', '0')) > 0 ? Number(read('--max-sessions', '0')) : Number.POSITIVE_INFINITY,
      budgetCny: Number(read('--budget-cny', '0')) > 0 ? Number(read('--budget-cny', '0')) : Number.POSITIVE_INFINITY,
      timeoutMs,
      prices: pricesPath === undefined ? null : JSON.parse(readFileSync(pricesPath, 'utf8')),
      keep: args.includes('--keep'),
      outDir,
    })
    console.log(`suite: ${suite.sessions} session(s), stop ${suite.stopReason}`)
    console.log(`aggregate with: node tools/benchmark-report.mjs ${outDir}`)
  } else {
    const variant = read('--variant', 'B')
    const report = await runLiveCase({ variant, timeoutMs, route: selectedRoute, keep: args.includes('--keep') })
    mkdirSync(outDir, { recursive: true })
    const outFile = join(outDir, `live-${variant}.json`)
    writeFileSync(outFile, JSON.stringify({ baseline: await collectBaseline(), ...report }, null, 2))

    const route = report.requests[0]
    console.log(`variant ${report.variant}: ${report.note}`)
    console.log(`  exit ${report.exitCode} in ${report.durationMs}ms   route ${route?.provider ?? '?'}/${route?.model ?? '?'}/${route?.reasoningEffort ?? '?'}`)
    for (const request of report.requests) {
      console.log(`  request seq ${request.seq}: ${request.tools.length} tool(s) [${request.tools.join(', ')}]`)
    }
    for (const prompt of report.prompts) {
      console.log(`  prompt turn ${prompt.turn}.${prompt.step}: ${prompt.chars} chars  persona=${prompt.carriesPersona} cwdLine=${prompt.carriesWorkspaceLine} instructions=${prompt.carriesWorkspaceInstructions} sdk=${prompt.carriesSdkSection} ptcRule=${prompt.carriesPtcRule}`)
    }
    console.log(`  tool calls ${report.toolCalls}, ptc dispatches ${report.ptcDispatches}, workspace ${JSON.stringify(report.workspaceFiles)}`)
    console.log(`  tokens ${report.usage.totalTokens} (input ${report.usage.uncachedInputTokens}, output ${report.usage.outputTokens}, cacheRead ${report.usage.cacheReadTokens})`)
    console.log(`  report ${outFile}`)
  }
}