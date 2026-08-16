/**
 * Bounded recovery policy for failed model requests.
 *
 * This policy deliberately covers only transient provider failures. Tool
 * execution is not replayed here because replaying a tool can duplicate an
 * external side effect; the agent loop remains the owner of tool recovery.
 */

/** Stable failure facts supplied by the agent/request-error event. */
export interface RetryFailure {
  code: string
}

/** Configuration for one bounded retry controller. */
export interface RetryConfig {
  /** Maximum retries after the initial model request. */
  maxRetries: number
  /** First local backoff delay in milliseconds. */
  initialDelayMs: number
  /** Upper bound for local backoff in milliseconds. */
  maxDelayMs: number
  /** Symmetric jitter ratio around the exponential delay. */
  jitterRatio: number
}

/** The issue's default: five recoverable attempts after the first request. */
export const DEFAULT_RETRY_CONFIG: RetryConfig = Object.freeze({
  maxRetries: 5,
  initialDelayMs: 500,
  maxDelayMs: 10_000,
  jitterRatio: 0.1,
})

/** Failure classes that are normally safe to retry without changing input. */
const RETRYABLE_FAILURE_CODES = new Set([
  'EMPTY_RESPONSE',
  'RATE_LIMIT',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
])

/** Whether one provider failure is safe for automatic model-request recovery. */
export function isRetryableFailure(failure: RetryFailure): boolean {
  return RETRYABLE_FAILURE_CODES.has(failure.code)
}

/** Calculate bounded exponential backoff with symmetric jitter. */
export function retryDelay(retry: number, config: RetryConfig, random = Math.random): number {
  const exponent = Math.min(Math.max(retry - 1, 0), 30)
  const exponential = Math.min(config.initialDelayMs * 2 ** exponent, config.maxDelayMs)
  const jitter = 1 - config.jitterRatio + 2 * config.jitterRatio * random()
  return Math.min(Math.max(0, exponential * jitter), config.maxDelayMs)
}

/** Wait for a retry delay, resolving false when the request is cancelled. */
export function waitForRetry(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise(resolve => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
