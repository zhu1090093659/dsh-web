/**
 * What every agent adapter consumes and produces.
 *
 * An adapter is a pure function pair: one maps a run's facts onto the command
 * line the remote launcher runs, the other reads the agent's output stream for
 * the session id and the final summary. Neither touches the network, the
 * filesystem or the clock, so both are snapshot-testable and a new agent CLI is
 * one module plus one row in the dispatch table.
 *
 * @module dsh-task-board-ssh/core/adapters/types
 */
import type { SshAgentKind } from '../target.ts'

/** Everything one adapter needs about the run it is building a command for. */
export interface SshAgentRunInput {
  /** Agent CLI kind; selects the adapter. */
  agent: SshAgentKind
  /** Absolute remote path of the prompt file the caller wrote. */
  promptFile: string
  /** Absolute remote directory the launcher changes into first. */
  cwd: string
  /** Session to continue; absent builds the start command, present the resume command. */
  resumeSessionId?: string
}

/** One command line, fully quoted, plus the file it reads its prompt from. */
export interface SshAgentCommand {
  /** Single-line POSIX command, every word already quoted. */
  command: string
  /** Absolute remote file redirected into the command's stdin, when it reads one. */
  stdinFile?: string
}

/**
 * What one run is worth, as the agent reported it.
 *
 * `ok: false` carries the agent's own failure text verbatim, because the card
 * shows it; the caller bounds it before storing.
 */
export type SshAgentOutcome = { ok: true; text: string } | { ok: false; error: string }

/** What a reader found in one output stream; both members are absent when it found neither. */
export interface SshAgentOutput {
  /** Session id the agent reported, usable as `resumeSessionId` later. */
  sessionId?: string
  /** Final summary, or the agent's own failure. */
  outcome?: SshAgentOutcome
}

/** User-supplied command templates of a custom agent. */
export interface SshCustomTemplates {
  /** Start template; must reference `{prompt_file}`. */
  command: string
  /** Resume template; absent degrades a follow-up to a fresh run. */
  resumeCommand?: string
}

/** One line of newline-delimited JSON, as an object. */
export type JsonLine = Record<string, unknown>

/**
 * Read newline-delimited JSON without throwing.
 *
 * Agents interleave progress notes and warnings with their event stream, and a
 * truncated final line is normal when a run is killed mid-write, so a line that
 * is not a JSON object is skipped instead of failing the read.
 * @param output - the whole captured stream.
 * @returns every line that parsed to an object, in order.
 */
export function readJsonLines(output: string): JsonLine[] {
  const events: JsonLine[] = []
  for (const line of output.split('\n')) {
    const text = line.trim()
    if (text.length === 0 || !text.startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) events.push(parsed as JsonLine)
    } catch {
      // A partial or non-JSON line is not an event; the caller sees the others.
    }
  }
  return events
}

/**
 * Read one string field off an arbitrary JSON value without a cast.
 * @param value - container to read.
 * @param key - field name.
 * @returns the string, or undefined when the field is absent or not a string.
 */
export function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}
