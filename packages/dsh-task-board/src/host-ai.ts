/**
 * One-shot model parse behind the board's "parse pasted text" action
 * (issue #1540).
 *
 * The browser half never talks to a model: it posts the pasted text and the
 * route the user picked to the Host, which calls the injected `llm` service
 * once and answers with the three draft fields the new-task form accepts. The
 * reply is untrusted text, so extraction is defensive: code fences are
 * stripped, the first JSON object wins, and an unusable reply falls back to
 * the user's own words instead of an empty form.
 */
import { createUserMessage, type GenerateOptions, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { TaskBoardParseDraft, TaskBoardParseRequest } from './protocol.ts'

/** How long one parse may take before the Host gives up on the model. */
export const TASK_PARSE_TIMEOUT_MS = 45_000
/** Largest pasted text one parse accepts (bytes). */
export const TASK_PARSE_MAX_INPUT = 16 * 1024
/** Longest title the form is willing to receive from a model. */
const TASK_PARSE_TITLE_LIMIT = 120

export type TaskParseFailureCode = 'no-model' | 'model-error' | 'parse-failed' | 'timeout'

/** Typed parse failure; the route maps the code onto a status and a body. */
export class TaskParseError extends Error {
  constructor(readonly code: TaskParseFailureCode, message: string) {
    super(message)
    this.name = 'TaskParseError'
  }
}

const SYSTEM_PROMPT = [
  'You turn one pasted note into a task for a kanban board.',
  'Reply with a single JSON object and nothing else, with exactly these keys:',
  '{"title": string, "description": string, "prompt": string}',
  '- title: one line, at most 80 characters, in the language of the note.',
  '- description: what the task is and the context the note carries, as plain text.',
  '- prompt: the instruction an agent should execute, keeping every fact that matters.',
].join('\n')

/** Split a qualified `provider/model` route the same way the runner does. */
export function splitModelRoute(qualified: string | undefined): { provider: string; model: string } | undefined {
  const raw = qualified?.trim() ?? ''
  if (raw === '') return undefined
  const slash = raw.indexOf('/')
  if (slash <= 0 || slash === raw.length - 1) return undefined
  const provider = raw.slice(0, slash).trim()
  const model = raw.slice(slash + 1).trim()
  if (provider === '' || model === '') return undefined
  return { provider, model }
}

/** Trim one model-provided field to a single-line, bounded string. */
function field(value: unknown, limit?: number): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return limit === undefined || text.length <= limit ? text : text.slice(0, limit).trim()
}

/** First non-empty line of the pasted text, used when the model omits a title. */
function firstLine(source: string): string {
  const line = source.split(/\r?\n/).map(entry => entry.trim()).find(entry => entry !== '') ?? ''
  return line.length <= TASK_PARSE_TITLE_LIMIT ? line : line.slice(0, TASK_PARSE_TITLE_LIMIT).trim()
}

/**
 * Read the draft out of a model reply. Fences and surrounding prose are
 * tolerated; anything unusable returns undefined so the caller can decide
 * between a typed failure and a fallback.
 * @param reply - raw model text.
 */
export function extractTaskParseReply(reply: string): Partial<TaskBoardParseDraft> | undefined {
  const withoutFences = reply.replace(/```[a-zA-Z]*\s*/g, '')
  const start = withoutFences.indexOf('{')
  const end = withoutFences.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  let payload: unknown
  try {
    payload = JSON.parse(withoutFences.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as { title?: unknown; description?: unknown; prompt?: string }
  const draft: Partial<TaskBoardParseDraft> = {
    title: field(record.title, TASK_PARSE_TITLE_LIMIT),
    description: field(record.description),
    prompt: field(record.prompt),
  }
  return draft.title === '' && draft.description === '' && draft.prompt === '' ? undefined : draft
}

/**
 * Fill the three form fields, falling back to the pasted text so a weak model
 * reply never loses what the user actually wrote.
 * @param reply - raw model text.
 * @param source - the text the user pasted.
 */
export function draftFromReply(reply: string, source: string): TaskBoardParseDraft {
  const parsed = extractTaskParseReply(reply)
  return {
    title: parsed?.title !== undefined && parsed.title !== '' ? parsed.title : firstLine(source),
    description: parsed?.description ?? '',
    prompt: parsed?.prompt !== undefined && parsed.prompt !== '' ? parsed.prompt : source.trim(),
  }
}

/**
 * Parse one pasted text through the injected `llm` service.
 * @param llm - the Host's llm service.
 * @param request - pasted text plus the qualified model route.
 * @param signal - caller cancellation (client disconnect); combined with the timeout.
 * @returns the draft fields.
 * @throws TaskParseError with a code the route maps onto a status.
 */
export async function parseTaskDraft(
  llm: LlmRuntime,
  request: TaskBoardParseRequest,
  signal?: AbortSignal,
): Promise<TaskBoardParseDraft> {
  const text = request.text.trim()
  if (text === '') throw new TaskParseError('parse-failed', 'there is nothing to parse')
  const route = splitModelRoute(request.model)
  if (route === undefined) throw new TaskParseError('no-model', 'no model route was selected for parsing')
  const timeout = new AbortController()
  const timer = setTimeout(() => { timeout.abort() }, TASK_PARSE_TIMEOUT_MS)
  const abortFromCaller = (): void => { timeout.abort() }
  signal?.addEventListener('abort', abortFromCaller, { once: true })
  try {
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      system: SYSTEM_PROMPT,
      messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })],
      signal: timeout.signal,
    }
    let reply = ''
    for await (const chunk of llm.stream(options)) {
      if (chunk.type === 'text-delta') reply += chunk.text
    }
    return draftFromReply(reply, text)
  } catch (error) {
    if (error instanceof TaskParseError) throw error
    if (timeout.signal.aborted) {
      throw new TaskParseError('timeout', `the model did not answer within ${TASK_PARSE_TIMEOUT_MS / 1_000}s`)
    }
    throw new TaskParseError('model-error', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}
