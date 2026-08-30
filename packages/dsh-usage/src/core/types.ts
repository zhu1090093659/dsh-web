/**
 * Wire-facing view types shared by the dsh-usage host service, its HTTP
 * routes, and the browser section. Everything here crosses the wire as JSON
 * and must stay provider-agnostic: provider quirks are normalized inside the
 * core adapters, never here.
 * @module @linxin666/dsh-usage/core/types
 */

/** One disjoint token bucket total, aggregated over calls (billed input = input + cacheRead + cacheWrite). */
export interface UsageTokenTotals {
  /** Uncached input tokens. */
  inputTokens: number
  /** Output tokens (reasoning included). */
  outputTokens: number
  /** Cache read tokens. */
  cacheReadTokens: number
  /** Cache write tokens. */
  cacheWriteTokens: number
  /** Reasoning tokens, when the provider reported them. */
  reasoningTokens: number
  /** Provider calls that reported usage. */
  calls: number
  /**
   * Spend estimate stamped at fold time, in the priced provider's billing
   * currency (currently DeepSeek official only, CNY); every other provider
   * stays 0 = unpriced, so the sum is never a mixed-currency total. Persisted
   * buckets recorded before a price-book change keep the old pricing.
   */
  cost: number
}

/** A zeroed totals bucket. */
export function emptyTotals(): UsageTokenTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, calls: 0, cost: 0 }
}

/** Add `right` into `left` in place. */
export function addTotals(left: UsageTokenTotals, right: Readonly<UsageTokenTotals>): UsageTokenTotals {
  left.inputTokens += right.inputTokens
  left.outputTokens += right.outputTokens
  left.cacheReadTokens += right.cacheReadTokens
  left.cacheWriteTokens += right.cacheWriteTokens
  left.reasoningTokens += right.reasoningTokens
  left.calls += right.calls
  left.cost += right.cost
  return left
}

/** On-disk usage ledger: per local day, per provider route, per model. */
export interface UsageLedgerDocument {
  version: 1
  /** Local-date key `YYYY-MM-DD` → per-provider per-model totals. */
  days: Record<string, Record<string, Record<string, UsageTokenTotals>>>
}

/** One provider row of the day summary the overview serves. */
export interface UsageProviderSummary {
  provider: string
  totals: UsageTokenTotals
  /** Per-model breakdown, heaviest by total tokens first, capped by the route. */
  models: Array<{ model: string; totals: UsageTokenTotals }>
}

/** One day row of the trend the overview serves. */
export interface UsageDaySummary {
  date: string
  totals: UsageTokenTotals
}

/** A balance fact normalized from a provider probe. */
export interface BalanceView {
  /** ISO 4217 code the provider bills in (`CNY`, `USD`, ...). */
  currency: string
  /** Spendable total formatted for display (no currency symbol). */
  totalBalance: string
  /** Epoch ms of the successful probe. */
  updatedAt: number
}

/** One quota window of a coding plan. */
export interface PlanWindowView {
  /** Stable window key the UI localizes (`5h`, `week`, `month`, provider strings otherwise). */
  key: string
  /** Provider-supplied window name, when it sends one. */
  name?: string
  /** Used percent 0-100, when computable. */
  percent?: number
  /** ISO 8601 reset instant, when the provider reports one. */
  resetsAt?: string
}

/** A coding-plan quota fact normalized from a provider probe. */
export interface PlanView {
  /** Plan tier name, when the provider reports one. */
  planName?: string
  windows: PlanWindowView[]
  updatedAt: number
}

/** How the credential backing one provider route was resolved. */
export type CredentialKind = 'api-key' | 'env' | 'oauth' | 'none'

/** One provider row of the overview snapshot. */
export interface ProviderSnapshotView {
  /** Provider route key (`deepseek`, `kimi-coding`, custom routes, ...). */
  provider: string
  /** Display name from the LLM runtime, else the adapter's, else the route key. */
  displayName: string
  credential: CredentialKind
  /** Whether any balance/plan adapter exists for this route. */
  supported: boolean
  /** A balance adapter exists for this route (the Usage tab's balance card). */
  balanceSupported?: boolean
  /** A coding-plan adapter exists for this route — the Plans tab lists these only. */
  planSupported?: boolean
  balance?: BalanceView
  plan?: PlanView
  /** Last probe failure, cleared on the next success. */
  error?: string
  updatedAt?: number
}

/** The overview the browser section renders. */
export interface UsageOverviewView {
  updatedAt: number
  providers: ProviderSnapshotView[]
  /** The provider the pet bubble and the header highlight; `source` says how it was picked. */
  current: {
    provider?: string
    model?: string
    /** `live` — last request seen this boot; `default` — the agent default model. */
    source: 'live' | 'default'
  }
  usage: {
    today: { date: string; totals: UsageTokenTotals; providers: UsageProviderSummary[] }
    /** Last N local days ascending, including today. */
    days: UsageDaySummary[]
    /**
     * The same window aggregated per provider and model — the trend card's
     * bar-chart data. Optional so an older host document still renders.
     */
    range?: {
      from: string
      to: string
      totals: UsageTokenTotals
      providers: UsageProviderSummary[]
    }
  }
}

/**
 * Host-side snapshot state: the wire view plus one error slot per probed
 * fact. A probe half only clears its own slot, so a plan success can no
 * longer mask a failing balance probe (and vice versa); the overview
 * collapses them into the single wire `error` line, balance first.
 */
export interface ProviderSnapshotState extends ProviderSnapshotView {
  /** Last balance-probe failure; cleared on the next balance success. */
  balanceError?: string
  /** Last plan-probe failure; cleared on the next plan success. */
  planError?: string
}
