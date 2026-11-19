/**
 * The custom adapter: a user-written command template.
 *
 * The three placeholders are the whole contract. `{prompt_file}` (required) is
 * the remote prompt file, `{cwd}` is the run's working directory and
 * `{session}` is the session to continue; each is replaced by one quoted word,
 * so a template can never splice a path or a session id into the remote shell.
 * The template's own words stay exactly as the deployment wrote them: they are
 * the operator's command, not a value this package injects.
 * No output is parsed: a command this package does not know cannot have its
 * summary or its session id read, so a custom run records its exit code and its
 * log and nothing else.
 *
 * @module dsh-task-board-ssh/core/adapters/custom
 */
import { shellQuote } from '../shell.ts'
import type { SshAgentCommand, SshAgentRunInput, SshCustomTemplates } from './types.ts'

/** Placeholders a template may carry. */
export const CUSTOM_PLACEHOLDERS = ['prompt_file', 'cwd', 'session'] as const

/** One placeholder name. */
export type CustomPlaceholder = (typeof CUSTOM_PLACEHOLDERS)[number]

/** Placeholder pattern: a braced lower-case name. */
const PLACEHOLDER_RE = /\{([a-z_]+)\}/g

/**
 * Check one template before a run depends on it.
 * @param template - the template text.
 * @returns the reason it cannot be used, or undefined when it can.
 */
export function validateCustomTemplate(template: string): string | undefined {
  if (template.trim().length === 0) return 'the template must not be empty'
  if (template.length > 2_048) return 'the template must be at most 2048 characters'
  if (template.includes('\u0000')) return 'the template must not contain a NUL byte'
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const name = match[1]
    if (!(CUSTOM_PLACEHOLDERS as readonly string[]).includes(name)) {
      return `unknown placeholder {${name}} (accepted: ${CUSTOM_PLACEHOLDERS.map(p => `{${p}}`).join(', ')})`
    }
  }
  if (!template.includes('{prompt_file}')) return 'the start template must reference {prompt_file}'
  return undefined
}

/** Replace every placeholder with its quoted value. */
function substitute(template: string, values: Record<CustomPlaceholder, string>): string {
  return template.replace(PLACEHOLDER_RE, (_match, name: string) => shellQuote(values[name as CustomPlaceholder] ?? ''))
}

/**
 * Build a custom agent's command line for one run.
 *
 * The start template is used when `resumeSessionId` is absent. A resume without
 * a resume template is a fresh run carrying the earlier summary, which is the
 * documented degradation, so the start template answers it.
 * @param input - run facts.
 * @param templates - the user's templates.
 * @returns the quoted command line.
 * @throws RangeError when a template fails {@link validateCustomTemplate}.
 */
export function customAgentCommand(input: SshAgentRunInput, templates: SshCustomTemplates): SshAgentCommand {
  const startProblem = validateCustomTemplate(templates.command)
  if (startProblem !== undefined) throw new RangeError(`custom agent start template: ${startProblem}`)
  const resumeTemplate = input.resumeSessionId !== undefined ? templates.resumeCommand : undefined
  if (resumeTemplate !== undefined) {
    const resumeProblem = validateCustomTemplate(resumeTemplate)
    if (resumeProblem !== undefined) throw new RangeError(`custom agent resume template: ${resumeProblem}`)
  }
  const template = input.resumeSessionId !== undefined && resumeTemplate !== undefined ? resumeTemplate : templates.command
  return {
    command: substitute(template, {
      prompt_file: input.promptFile,
      cwd: input.cwd,
      session: input.resumeSessionId ?? '',
    }),
  }
}

/**
 * Whether a custom agent can continue a session.
 * @param templates - the user's templates.
 * @returns true when a resume template is present.
 */
export function customResumeSupported(templates: SshCustomTemplates): boolean {
  return templates.resumeCommand !== undefined && templates.resumeCommand.trim().length > 0
}
