/**
 * The frozen failure contract of the relay data plane, in one place: the code
 * table, the default human message of every code, and the answer itself --
 * {"ok":false,"code":"<code>","message":"<human>"} with content-type
 * application/json and x-relay-retryable: 1 on every code a retry can outlast.
 *
 * It sits outside both relay halves because they import each other: relay.js
 * reaches relay-bridge.js for the bridge door, so a builder living in either
 * one would have to be imported back across that edge. Nothing here imports
 * anything, so both halves can use it.
 *
 * connector-closed is the one code a stream, rather than a request, answers
 * with: the socket the stream was riding went away, so the answer is a 502 --
 * the request never reached anything -- and it is retryable, because the
 * connector reconnecting makes the identical request work.
 */

/** The frozen code table: the status each code answers. */
export const RELAY_FAILURE_STATUS = {
  'instance-offline': 503,
  'relay-storage-unavailable': 503,
  'connector-replaced': 503,
  'connector-closed': 502,
  'stream-stalled': 504,
  'invalid-registration': 502,
  'rate-limited': 429,
}

/**
 * The codes a client may retry unchanged: every transient condition, plus
 * rate-limited, whose window is a wait rather than a wrong request.
 * invalid-registration is not one of them, because asking again cannot repair
 * a row that does not describe a usable target.
 */
export const RELAY_FAILURE_RETRYABLE = new Set([
  'instance-offline',
  'relay-storage-unavailable',
  'connector-replaced',
  'connector-closed',
  'stream-stalled',
  'rate-limited',
])

/** The default human half of each code: what happened, not what to do. */
export const RELAY_FAILURE_MESSAGE = {
  'instance-offline': 'this instance is offline: its tunnel is not running',
  'relay-storage-unavailable': 'the relay registry is unavailable',
  'connector-replaced': 'the connector was replaced by a newer connection',
  'connector-closed': 'the connector closed the connection',
  'stream-stalled': 'the stream made no progress and was terminated',
  'invalid-registration': 'the registered target cannot be used',
  'rate-limited': 'too many registrations in this window',
}

/** The header that marks an answer a client may retry as-is. */
export const RELAY_RETRYABLE_HEADER = 'x-relay-retryable'

/**
 * Whether one value is a code of the frozen table.
 * @param code - anything a failure reason may carry.
 */
export function isRelayFailureCode(code) {
  return typeof code === 'string' && Object.hasOwn(RELAY_FAILURE_STATUS, code)
}

/**
 * One failure answer in the frozen shape.
 * @param code - a code of the frozen table.
 * @param options - message overrides the default human half; legacy also stamps
 * the pre-contract error field the plugin's registration client still reads
 * (packages/dsh-remote-bridge/src/host/relay-control.ts), which the App never
 * sees. A string there names that field (one answer was never the code: a
 * storage failure answered storage-unavailable), a boolean mirrors the code.
 * @returns the response, or undefined when the code is not one of the frozen
 * ones -- a caller that has an older answer for that case keeps it.
 */
export function relayFailure(code, { message, legacy = false } = {}) {
  if (!isRelayFailureCode(code)) return undefined
  const body = { ok: false, code, message: message || RELAY_FAILURE_MESSAGE[code] }
  if (legacy) body.error = typeof legacy === 'string' ? legacy : code
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  if (RELAY_FAILURE_RETRYABLE.has(code)) headers[RELAY_RETRYABLE_HEADER] = '1'
  return new Response(JSON.stringify(body), { status: RELAY_FAILURE_STATUS[code], headers })
}
