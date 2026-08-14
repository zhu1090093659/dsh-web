/**
 * Provider-owned request-retry policy configuration and resolution.
 *
 * Adapters expose one resolved policy per registered provider route; the
 * optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
 *
 * @module @deepseek-ai/dsh-llm/retry-policy
 */
import z from '@deepseek-ai/schemastery';
/** Bounded exponential backoff with symmetric jitter around each local delay. */
export interface BackoffConfig {
    /** Initial local exponential-backoff delay in milliseconds (default 500). */
    initialDelayMs?: number;
    /** Maximum locally scheduled or accepted provider delay in milliseconds (default 10000). */
    maxDelayMs?: number;
    /** Symmetric random multiplier range around one (default 0.1). */
    jitterRatio?: number;
}
/** Current bounded transient retry behavior for one provider route. */
export interface NormalRetryPolicyConfig {
    /** Retry only configured transient failure codes. */
    mode: 'normal';
    /** Maximum eligible retries after the first request (default 2). */
    maxRetries?: number;
    /** Stable failure codes eligible for this policy. */
    retryableCodes?: string[];
    /** Local exponential-backoff and jitter configuration. */
    backoff?: BackoffConfig;
}
/** Unbounded retry behavior for every model-request failure on one provider route. */
export interface AlwaysRetryPolicyConfig {
    /** Retry every model-request failure until success, cancellation, or disposal. */
    mode: 'always';
    /** Local exponential-backoff and jitter configuration. */
    backoff?: BackoffConfig;
}
/** Provider-owned model-request retry policy configuration. */
export type RetryPolicyConfig = NormalRetryPolicyConfig | AlwaysRetryPolicyConfig;
/** Fully resolved backoff shared by both retry modes. */
export interface ResolvedRetryBackoff {
    readonly initialDelayMs: number;
    readonly maxDelayMs: number;
    readonly jitterRatio: number;
}
/** Fully resolved bounded transient retry policy. */
export interface ResolvedNormalRetryPolicy extends ResolvedRetryBackoff {
    readonly mode: 'normal';
    readonly maxRetries: number;
    readonly retryableCodes: readonly string[];
}
/** Fully resolved unbounded retry policy. */
export interface ResolvedAlwaysRetryPolicy extends ResolvedRetryBackoff {
    readonly mode: 'always';
}
/** Immutable provider policy captured when its adapter route is registered. */
export type ResolvedRetryPolicy = ResolvedNormalRetryPolicy | ResolvedAlwaysRetryPolicy;
/** Cordis schema embedded by each concrete provider configuration. */
export declare const RetryPolicySchema: z<RetryPolicyConfig>;
/**
 * Validate, default, and detach one provider-owned retry policy.
 * @param config - optional provider configuration; omission selects normal defaults.
 * @param path - diagnostic path naming the provider config that owns the value.
 * @returns an immutable policy safe to capture in provider registration state.
 */
export declare function resolveRetryPolicy(config: RetryPolicyConfig | undefined, path: string): ResolvedRetryPolicy;
//# sourceMappingURL=retry-policy.d.ts.map