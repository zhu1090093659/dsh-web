/**
 * One-shot model dispatch for the board's Host half.
 *
 * The board makes one one-shot model call: the "parse pasted text" action
 * (`host-ai.ts`). It calls the official `llm` service, and it must call it
 * the way the official agent loop does.
 *
 * The runtime exposes two entry points with the same name shape. The public
 * `stream(options)` is a single-argument convenience method, and it is an
 * ordinary instance property — any plugin may overwrite it. The registration
 * bound path `prepareCall(config)` returns a one-shot handle whose
 * `stream(request)` reaches the adapter through the runtime's internal
 * dispatch instead, and `ctx.on('llm/stream')` remains the supported seam every
 * extension is expected to register on.
 *
 * A third-party provider plugin that patched `llm.stream` with the waterfall
 * listener signature `(options, next)` broke every caller that used the public
 * method: `llm.stream(options)` invoked the listener with `next === undefined`,
 * so the guard's `for await (const chunk of next())` raised
 * `TypeError: next(...) is not a function or its return value is not async
 * iterable`. The agent loop was unaffected because it already dispatches
 * through `prepareCall(...).stream(...)`; the board's one-shot call was not,
 * and the parse action failed with that TypeError until it dispatched the same
 * way.
 *
 * Dispatching through the prepared call fixes that at the owner: the board no
 * longer depends on a mutable instance property that a plugin may legitimately
 * replace, and a plugin that registers on `llm/stream` is still invoked. The
 * public method remains the fallback for a runtime that exposes no
 * `prepareCall` at all, so an older or proxied service keeps working.
 */
import { ReasoningEffortId, type GenerateOptions, type LlmCallConfig, type LlmRuntime, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** The request fields the board adds around a call config. */
export type OneShotRequest = Pick<GenerateOptions, 'messages' | 'signal'> & Pick<GenerateOptions, 'system'>

/**
 * The call config as this board's own domain types carry it.
 *
 * The parse route's `reasoningEffort` and the catalog's effort ids are plain
 * strings, while the SDK brands them nominally; the single crossing is branded
 * here so no caller repeats the assertion.
 */
export interface OneShotCallConfig {
  provider: string
  model: string
  reasoningEffort?: string
  temperature?: number
  maxTokens?: number
}

/** The runtime shape this dispatch looks for beyond the public interface. */
type PreparedRuntime = LlmRuntime & { prepareCall?: LlmRuntime['prepareCall'] }

/**
 * Open one one-shot model stream on the registration-bound dispatch path.
 *
 * The call-config fields must travel inside `config` (not the request): the
 * prepared handle refuses a request whose config fields differ from the ones it
 * resolved, so the request carries only messages, signal, and the optional
 * one-shot system prompt.
 * @param llm - the Host's llm service.
 * @param config - provider/model route plus the caller's sampling controls.
 * @param request - the assembled messages and cancellation for this call.
 * @returns the chunk stream, including any registered `llm/stream` listener.
 */
export async function openOneShotStream(
  llm: LlmRuntime,
  config: OneShotCallConfig,
  request: OneShotRequest,
): Promise<AsyncIterable<StreamChunk>> {
  const call: LlmCallConfig = {
    provider: config.provider,
    model: config.model,
    ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(config.reasoningEffort) }),
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
  }
  const runtime = llm as PreparedRuntime
  if (typeof runtime.prepareCall !== 'function') {
    return llm.stream({ ...call, ...request } as GenerateOptions)
  }
  const prepared = await runtime.prepareCall(call, request.signal)
  return prepared.stream({ ...prepared.config, ...request })
}
