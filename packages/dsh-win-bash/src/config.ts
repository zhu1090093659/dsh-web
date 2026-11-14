/**
 * Plugin configuration: the win_bash tool's budgets and description.
 *
 * Every field is optional in the profile patch and defaulted here, so a row
 * with no config block still mounts a working tool. The schema is also the
 * settings page: the Host renders one form per profile entry from this same
 * Config, which is why the defaults are stated in the field comments as well
 * as in the schema.
 * @module @linxin666/dsh-win-bash/config
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_MAX_STDERR_BYTES, DEFAULT_MAX_STDOUT_BYTES } from './shell.ts'

/** Whole-call deadline floor, in milliseconds. */
export const TIMEOUT_MIN_MS = 1000

/** Whole-call deadline ceiling, in milliseconds. */
export const TIMEOUT_MAX_MS = 3_600_000

/** Default whole-call deadline, matching the host's own persistent shell. */
export const DEFAULT_TIMEOUT_MS = 300_000

/** Visible stdout budget floor, in bytes. */
export const STDOUT_MIN_BYTES = 1024

/** Visible stdout budget ceiling, in bytes. */
export const STDOUT_MAX_BYTES = 1024 * 1024

/** Visible stderr budget floor, in bytes. */
export const STDERR_MIN_BYTES = 1024

/** Visible stderr budget ceiling, in bytes. */
export const STDERR_MAX_BYTES = 512 * 1024

/**
 * Model-facing tool description. Active voice; states the shell preference and
 * the persistence guarantee, so a model knows which shell to reach for before
 * it knows anything else about this tool.
 *
 * The preference is a TRUNCATION CONTRACT, not a flourish: a preset that
 * curates its catalog caps each uncurated line at 200 characters, so whatever
 * sentence states which shell to use must fit in that window. The first
 * sentence therefore carries it alone, and the qualification that follows
 * explains the ladder without restating it.
 */
export const DEFAULT_DESCRIPTION = [
  "Run a command in this session's persistent pinned bash shell, the shell to use for command work on Windows: prefer it over pwsh.",
  "pwsh stays the only other shell here: use it for Windows-native work (cmdlets, the registry, services) and as the fallback when a command is not bash; where this plugin replaces it, it is withdrawn from this session's tool surface while win_bash serves it, which hides it rather than forbidding it.",
  'The working directory, exported variables, functions and shell history persist across win_bash calls in this session;',
  'each call is a foreground command with bounded stdout and stderr and a real exit code.',
  'Long output is kept as its TAIL and the result says it was truncated, naming the file holding the complete stream when one exists.',
  'Set run_in_background to start the command in its own process and return a job id at once: collect that job with job_output and stop it with job_kill.',
  'Use this instead of PowerShell when the command is bash or Unix syntax (pipes, $VAR, globs, single quotes, here-documents).',
  'It runs only in a danger-full-access session: in a restricted session it refuses the call rather than confining the shell, because the pinned MSYS2 bash cannot start under a restricted token. Use the host bash/pwsh tools there.',
].join(' ')

/**
 * Whether win_bash may run a command as a background job, by default.
 *
 * The shipped setting is true, matching the host's own bash tool. The flag is
 * one half of a pair: the background surface is only advertised when this is
 * true AND the deployment composes a job registry, because a tool that
 * advertises a capability its deployment cannot honour teaches the model
 * something false about the session.
 */
export const DEFAULT_ENABLE_RUN_IN_BACKGROUND = true

/**
 * Whether the host's pwsh tool is withdrawn from a session this plugin serves,
 * by default.
 *
 * The shipped setting is true: with win_bash registered the session's command
 * work belongs to bash, and leaving pwsh on the wire beside it is what makes a
 * model pick the shell it already knows. The withdrawal is visibility only (a
 * deliberate pwsh call still runs), so false is the escape hatch for an
 * operator who wants both shells listed.
 */
export const DEFAULT_REPLACE_PWSH = true

/** Config shape a profile row may supply; every field is optional. */
export interface WinBashConfigInput {
  /** Whole-call deadline in milliseconds. */
  timeoutMs?: number
  /** Visible stdout byte budget. */
  maxStdoutBytes?: number
  /** Visible stderr byte budget. */
  maxStderrBytes?: number
  /** Model-facing tool description override. */
  description?: string
  /** Whether the host's pwsh tool is hidden while win_bash is registered. */
  replacePwsh?: boolean
  /** Whether run_in_background is available (also requires a job registry). */
  enableRunInBackground?: boolean
}

/** Config shape the plugin runs with; every field resolved. */
export interface WinBashConfig {
  /** Whole-call deadline in milliseconds. */
  timeoutMs: number
  /** Visible stdout byte budget. */
  maxStdoutBytes: number
  /** Visible stderr byte budget. */
  maxStderrBytes: number
  /** Model-facing tool description. */
  description: string
  /** Whether the host's pwsh tool is hidden while win_bash is registered. */
  replacePwsh: boolean
  /** Whether run_in_background is available (also requires a job registry). */
  enableRunInBackground: boolean
}

/** Runtime configuration schema for the win_bash tool. */
export const Config: z<WinBashConfigInput, WinBashConfig> = z.object({
  timeoutMs: z.number().min(TIMEOUT_MIN_MS).max(TIMEOUT_MAX_MS).default(DEFAULT_TIMEOUT_MS),
  maxStdoutBytes: z.number().min(STDOUT_MIN_BYTES).max(STDOUT_MAX_BYTES).default(DEFAULT_MAX_STDOUT_BYTES),
  maxStderrBytes: z.number().min(STDERR_MIN_BYTES).max(STDERR_MAX_BYTES).default(DEFAULT_MAX_STDERR_BYTES),
  description: z.string().default(DEFAULT_DESCRIPTION),
  replacePwsh: z.boolean().default(DEFAULT_REPLACE_PWSH),
  enableRunInBackground: z.boolean().default(DEFAULT_ENABLE_RUN_IN_BACKGROUND),
})

/** The values an omitted field takes. */
export const CONFIG_DEFAULTS: WinBashConfig = {
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxStdoutBytes: DEFAULT_MAX_STDOUT_BYTES,
  maxStderrBytes: DEFAULT_MAX_STDERR_BYTES,
  description: DEFAULT_DESCRIPTION,
  replacePwsh: DEFAULT_REPLACE_PWSH,
  enableRunInBackground: DEFAULT_ENABLE_RUN_IN_BACKGROUND,
}

/** One rejected configuration field. */
export interface ConfigViolation {
  /** Field name. */
  readonly field: string
  /** Why the value cannot be used. */
  readonly message: string
}

/**
 * Resolve a raw config object into the running configuration.
 *
 * The Host validates the row through {@link Config} before apply runs, so this
 * is the second gate: it exists because tests and hand-built contexts call the
 * plugin's apply directly, and because a bounded integer is a contract the
 * shell's budgets depend on (a NaN budget would make every output look
 * truncated).
 * @param input - the raw config, or undefined.
 * @returns the resolved configuration.
 * @throws when a supplied value is outside its contract.
 */
export function resolveConfig(input: WinBashConfigInput | undefined): WinBashConfig {
  const resolved: WinBashConfig = { ...CONFIG_DEFAULTS, ...input }
  const violations = validateConfig(resolved)
  if (violations.length > 0) {
    throw new Error(
      'win_bash config rejected: '
      + violations.map(v => v.field + ': ' + v.message).join('; '),
    )
  }
  return resolved
}

/**
 * Check every field of a resolved configuration.
 * @param config - the candidate configuration.
 * @returns one entry per rejected field; empty means accepted.
 */
export function validateConfig(config: WinBashConfig): ConfigViolation[] {
  const violations: ConfigViolation[] = []
  const bounded = (field: 'timeoutMs' | 'maxStdoutBytes' | 'maxStderrBytes', min: number, max: number): void => {
    const value = config[field]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      violations.push({ field, message: 'must be an integer between ' + min.toString() + ' and ' + max.toString() })
    }
  }
  bounded('timeoutMs', TIMEOUT_MIN_MS, TIMEOUT_MAX_MS)
  bounded('maxStdoutBytes', STDOUT_MIN_BYTES, STDOUT_MAX_BYTES)
  bounded('maxStderrBytes', STDERR_MIN_BYTES, STDERR_MAX_BYTES)
  if (typeof config.description !== 'string' || config.description.trim() === '') {
    violations.push({ field: 'description', message: 'must be a non-empty string' })
  }
  if (typeof config.replacePwsh !== 'boolean') {
    violations.push({ field: 'replacePwsh', message: 'must be a boolean' })
  }
  if (typeof config.enableRunInBackground !== 'boolean') {
    violations.push({ field: 'enableRunInBackground', message: 'must be a boolean' })
  }
  return violations
}
