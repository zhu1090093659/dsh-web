/**
 * What an agent asks about a remote run before and while it runs: whether the
 * target can work at all (preflight), what the log says without its noise
 * (filtered log query), and what the agent did last (activity).
 *
 * Every command here is read-only and composed through `shellQuote`; none of it
 * touches the launcher script, so the remote side of a run is unchanged.
 *
 * @module dsh-task-board-ssh/host/inspect
 */
import { shellQuote } from '../core/shell.ts'
import type { SshAgentTarget, SshTarget } from '../core/target.ts'

/** Stable refusal codes a target check or a run can answer with. */
export const SSH_PREFLIGHT_CODES = ['host-unreachable', 'agent-missing', 'path-missing', 'permission-required'] as const

/** One stable preflight code. */
export type SshPreflightCode = (typeof SSH_PREFLIGHT_CODES)[number]

/** A target check that failed, in words the caller can act on. */
export interface SshPreflightFailure {
  code: SshPreflightCode
  message: string
  /** The next step, one sentence. */
  hint: string
}

/** Program a built-in agent kind starts on the host, or undefined when it is configured. */
export function agentProgram(agent: SshAgentTarget, override?: string): string | undefined {
  if (override !== undefined) return override
  switch (agent.kind) {
    case 'dsh': return 'dsh'
    case 'claude': return 'claude'
    case 'codex': return 'codex'
    default: {
      // A custom template starts with the program; a placeholder-led one has none to probe.
      const first = agent.command?.trim().split(/\s+/)[0]
      return first === undefined || first === '' || first.includes('{') || first.includes('$') ? undefined : first
    }
  }
}

/**
 * The single remote command one preflight runs: it always exits zero and prints
 * one `key=value` per fact, so a failed channel is told apart from a failed check.
 */
export function preflightCommand(target: SshTarget, program: string | undefined): string {
  const parts = ['echo reach=ok']
  if (program !== undefined) {
    parts.push(`if command -v ${shellQuote(program)} >/dev/null 2>&1; then echo agent=ok; else echo agent=missing; fi`)
  }
  if (target.workspace.kind === 'in-place') {
    const path = shellQuote(target.workspace.path)
    parts.push(`if [ -d ${path} ]; then echo path=ok; if [ -w ${path} ] && [ -x ${path} ]; then echo write=ok; else echo write=denied; fi; else echo path=missing; fi`)
  }
  return parts.join('; ')
}

/**
 * Read one preflight answer.
 * @param target - the checked target.
 * @param program - the probed program, if any.
 * @param result - what `exec` returned.
 * @returns the first failed check, or undefined when the target can work.
 */
export function readPreflight(
  target: SshTarget,
  program: string | undefined,
  result: { success: boolean; stdout: string; stderr: string; error?: string; timedOut?: boolean },
): SshPreflightFailure | undefined {
  const facts = new Map<string, string>()
  for (const line of result.stdout.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) facts.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  if (facts.get('reach') !== 'ok') {
    const why = result.error ?? (result.stderr.trim() || (result.timedOut === true ? 'the connection timed out' : 'no answer'))
    return {
      code: 'host-unreachable',
      message: `host "${target.host}" did not answer an ssh command: ${why.slice(0, 200)}`,
      hint: 'Check the alias and credentials in the dsh-ssh settings (or use task_board_ssh action "hosts" to list the aliases), then retry.',
    }
  }
  if (program !== undefined && facts.get('agent') !== 'ok') {
    return {
      code: 'agent-missing',
      message: `"${program}" is not on the PATH of host "${target.host}"`,
      hint: `Install ${program} there, or pick another agent (dsh, claude, codex, custom).`,
    }
  }
  if (target.workspace.kind === 'in-place') {
    if (facts.get('path') !== 'ok') {
      return {
        code: 'path-missing',
        message: `directory ${target.workspace.path} does not exist on host "${target.host}"; an in-place target never creates it`,
        hint: 'Create the directory on the host first, or use workspaceKind "git" to get a per-run worktree.',
      }
    }
    if (facts.get('write') !== 'ok') {
      return {
        code: 'permission-required',
        message: `directory ${target.workspace.path} on host "${target.host}" is not writable by the ssh user`,
        hint: 'Grant that user write access (or pick a directory it owns), then retry.',
      }
    }
  }
  return undefined
}

// --- filtered log ---------------------------------------------------------------

/** Longest line a filtered log returns, in bytes; longer ones are cut and marked. */
export const LOG_LINE_MAX_BYTES = 2_000

/** Default and ceiling of one log reply, in bytes. */
export const LOG_REPLY_DEFAULT_BYTES = 64 * 1024

/** Lines `tail` returns when the caller names neither `tail` nor `since`. */
export const LOG_TAIL_DEFAULT_LINES = 40

/**
 * awk program that drops what an agent never needs from a stream-json log:
 * every `system` event except `init` (thinking_tokens, hooks, status), rate
 * limit notices and partial stream deltas. It also cuts overlong lines.
 */
const NOISE_FILTER = [
  `/^\\{"type":"(stream_event|rate_limit_event)"/ {next}`,
  `/^\\{"type":"system","subtype":"init"/ {print; next}`,
  `/^\\{"type":"system"/ {next}`,
  `{ if (length($0) > ${String(LOG_LINE_MAX_BYTES)}) $0 = substr($0, 1, ${String(LOG_LINE_MAX_BYTES)}) " ...[line cut]"; print }`,
].join(' ')

/** What one log query asks for. */
export interface SshLogQuery {
  /** Absolute path of the run's stdout log. */
  file: string
  /** Last N filtered lines (default 40). Ignored when `since` is given. */
  tail?: number
  /** First filtered line to return, 1-based: the `nextSince` of an earlier reply. */
  since?: number
  /** Skip the filter and read raw lines. */
  raw?: boolean
  /** Cap on the reply text, in bytes. */
  maxBytes?: number
  /** Count only: no text. */
  statsOnly?: boolean
}

/** Counts of one log, before any text is cost. */
export interface SshLogStats {
  /** Size of the raw log on the host. */
  rawBytes: number
  /** Lines the filter keeps. */
  lines: number
  /** Bytes the kept lines take. */
  bytes: number
}

/** The command that answers one log query, text after a `stats` line. */
export function logCommand(query: SshLogQuery): string {
  const file = shellQuote(query.file)
  const filter = query.raw === true ? 'cat' : `LC_ALL=C awk ${shellQuote(NOISE_FILTER)}`
  const count = `LC_ALL=C awk '{ l += 1; b += length($0) + 1 } END { printf "%d %d", l, b }'`
  const cap = Math.max(1, Math.min(Math.trunc(query.maxBytes ?? LOG_REPLY_DEFAULT_BYTES), 128 * 1024))
  const select = query.since !== undefined
    ? `tail -n +${String(Math.max(1, Math.trunc(query.since)))}`
    : `tail -n ${String(Math.max(1, Math.min(Math.trunc(query.tail ?? LOG_TAIL_DEFAULT_LINES), 2_000)))}`
  const body = query.statsOnly === true ? '' : `; ${filter} ${file} | ${select} | head -c ${String(cap + 1)}`
  return `if [ ! -f ${file} ]; then echo "stats none"; exit 0; fi; printf 'stats %s ' "$(wc -c < ${file} | tr -d ' ')"; ${filter} ${file} | ${count}; echo${body}`
}

/** One answered log query. */
export interface SshLogAnswer {
  stats: SshLogStats | undefined
  /** Filtered text, complete lines only, within the cap. */
  text: string
  /** Filtered lines in `text`. */
  lines: number
  /** Whether lines remain after `text`. */
  more: boolean
}

/**
 * Parse the answer of {@link logCommand}.
 * @param stdout - what the command printed.
 * @param query - the query it answered.
 * @returns stats and the complete lines that fit the cap.
 */
export function readLogAnswer(stdout: string, query: SshLogQuery): SshLogAnswer {
  const newline = stdout.indexOf('\n')
  const head = newline === -1 ? stdout : stdout.slice(0, newline)
  const rest = newline === -1 ? '' : stdout.slice(newline + 1)
  const match = /^stats (\d+) (\d+) (\d+)$/.exec(head.trim())
  const stats = match === null
    ? undefined
    : { rawBytes: Number(match[1]), lines: Number(match[2]), bytes: Number(match[3]) }
  const cap = Math.max(1, Math.min(Math.trunc(query.maxBytes ?? LOG_REPLY_DEFAULT_BYTES), 128 * 1024))
  let text = rest
  let cut = false
  if (new TextEncoder().encode(text).length > cap) {
    cut = true
    text = text.slice(0, text.lastIndexOf('\n') + 1)
    while (new TextEncoder().encode(text).length > cap) text = text.slice(0, text.slice(0, -1).lastIndexOf('\n') + 1)
  }
  const lines = text === '' ? 0 : text.split('\n').filter((line, index, all) => line !== '' || index < all.length - 1).length
  const firstLine = query.since ?? Math.max(1, (stats?.lines ?? 0) - Math.trunc(query.tail ?? LOG_TAIL_DEFAULT_LINES) + 1)
  const more = cut || (stats !== undefined && firstLine + lines - 1 < stats.lines)
  return { stats, text, lines, more }
}

/** First filtered line number a tail of `tail` lines starts at, given the totals. */
export function tailStart(stats: SshLogStats, tail: number): number {
  return Math.max(1, stats.lines - Math.max(1, tail) + 1)
}

// --- last activity --------------------------------------------------------------

/** The agent's last visible action: a tool call or a message. */
export interface SshActivity {
  /** `tool_use`, `assistant` or `result`. */
  kind: string
  /** Tool name for a tool call. */
  name?: string
  /** One line of what it was given or said. */
  detail: string
}

/** One short line out of a tool input. */
function inputLine(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const row = input as Record<string, unknown>
  for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'description', 'prompt']) {
    const value = row[key]
    if (typeof value === 'string' && value !== '') return value.replace(/\s+/g, ' ').slice(0, 160)
  }
  return JSON.stringify(row).slice(0, 160)
}

/**
 * The last tool call (or message) in a stretch of stream-json lines.
 * @param text - filtered log lines, oldest first.
 * @returns the last action, or undefined when none parses.
 */
export function lastActivity(text: string): SshActivity | undefined {
  const lines = text.split('\n').filter(line => line.trim() !== '')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let event: unknown
    try { event = JSON.parse(lines[index] as string) } catch { continue }
    if (typeof event !== 'object' || event === null) continue
    const row = event as Record<string, unknown>
    if (row.type === 'result') return { kind: 'result', detail: String(row.subtype ?? 'result') }
    if (row.type !== 'assistant') continue
    const message = row.message as { content?: unknown } | undefined
    if (!Array.isArray(message?.content)) continue
    for (let at = message.content.length - 1; at >= 0; at -= 1) {
      const block = message.content[at] as Record<string, unknown>
      if (block.type === 'tool_use') return { kind: 'tool_use', name: String(block.name ?? ''), detail: inputLine(block.input) }
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        return { kind: 'assistant', detail: block.text.trim().replace(/\s+/g, ' ').slice(0, 160) }
      }
    }
  }
  return undefined
}
