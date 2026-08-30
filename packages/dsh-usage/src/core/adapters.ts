/**
 * Provider adapters: one entry per provider family this plugin can query for
 * a pay-as-you-go balance or a coding-plan quota. Adapters are pure — they
 * build an HTTP probe from a resolved credential and parse the response — so
 * the service stays transport-only and every endpoint detail lives here.
 *
 * All probes run host-side (Node fetch); API keys never reach the browser.
 * @module @linxin666/dsh-usage/core/adapters
 */

import type { PlanWindowView } from './types.ts'

/** One HTTP probe the service executes verbatim. */
export interface ProbeSpec {
  url: string
  headers: Record<string, string>
}

/** Inputs an adapter may use to build a probe. */
export interface AdapterProbeContext {
  /** Resolved credential value: a raw API key, or an OAuth access token for the oauth-aware adapters. */
  apiKey: string
  /** Provider account id riding a dedicated header, when the credential carries one (Codex). */
  accountId?: string
}

/** A parsed balance fact. */
export interface BalanceParse {
  currency: string
  totalBalance: string
}

/** A parsed plan-quota fact. */
export interface PlanParse {
  planName?: string
  windows: PlanWindowView[]
}

/** One provider family's probing capability. */
export interface ProviderAdapter {
  /** Provider route keys this adapter serves. */
  ids: readonly string[]
  /** Fallback display name when the LLM runtime has none. */
  displayName: string
  balance?: {
    build(context: AdapterProbeContext): ProbeSpec
    parse(status: number, body: unknown): BalanceParse | undefined
  }
  plan?: {
    build(context: AdapterProbeContext): ProbeSpec
    parse(status: number, body: unknown): PlanParse | undefined
  }
}

/** Parse a string/number into a finite number, else undefined. */
function toNum(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** Read a string field that must be a non-empty string. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Format a number to a fixed 2-decimal display string. */
function money(value: number): string {
  return value.toFixed(2)
}

/** Millisecond epoch or ISO string → normalized ISO 8601, else undefined. */
function toIso(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value < 1e12 ? value * 1000 : value
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  const text = str(value)
  if (text === undefined) return undefined
  // Epoch instants also arrive as strings ("1756428000"); route them through
  // the numeric branch instead of letting Date() reject them.
  if (/^\d+$/.test(text)) return toIso(Number(text))
  const date = new Date(text)
  // The contract is "normalized ISO 8601, else undefined": returning the raw
  // text would render as "Invalid Date" downstream.
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Used-percent helper guarding zero/absent limits. */
function usedPercent(used: unknown, limit: unknown): number | undefined {
  const usedNum = toNum(used)
  const limitNum = toNum(limit)
  if (usedNum === undefined || limitNum === undefined || limitNum <= 0) return undefined
  return Math.max(0, Math.min(100, (usedNum / limitNum) * 100))
}

function bearer(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` }
}

/**
 * The official pay-as-you-go balance. `deepseek` is the configurable-catalog
 * route key; `deepseek-official` is the live provider route the llm-deepseek
 * adapter registers (sessions and agent-default-model carry it), so both ids
 * must resolve here or the current provider would never be probed.
 */
const DEEPSEEK: ProviderAdapter = {
  ids: ['deepseek', 'deepseek-official'],
  displayName: 'DeepSeek',
  balance: {
    build: ({ apiKey }) => ({ url: 'https://api.deepseek.com/user/balance', headers: bearer(apiKey) }),
    parse: (status, body) => {
      if (status !== 200 || typeof body !== 'object' || body === null) return undefined
      const infos = (body as Record<string, unknown>).balance_infos
      if (!Array.isArray(infos) || infos.length === 0) return undefined
      const first = infos[0]
      if (typeof first !== 'object' || first === null) return undefined
      const currency = str((first as Record<string, unknown>).currency)
      const total = str((first as Record<string, unknown>).total_balance)
      if (currency === undefined || total === undefined) return undefined
      return { currency, totalBalance: total }
    },
  },
}

/** Moonshot pay-as-you-go balance; CN bills in CNY, international in USD. */
function moonshotBalance(host: string, currency: string, ids: readonly string[]): ProviderAdapter {
  return {
    ids,
    displayName: 'Moonshot AI',
    balance: {
      build: ({ apiKey }) => ({ url: `https://${host}/v1/users/me/balance`, headers: bearer(apiKey) }),
      parse: (status, body) => {
        if (status !== 200 || typeof body !== 'object' || body === null) return undefined
        const data = (body as Record<string, unknown>).data
        if (typeof data !== 'object' || data === null) return undefined
        const available = toNum((data as Record<string, unknown>).available_balance)
        if (available === undefined) return undefined
        return { currency, totalBalance: money(available) }
      },
    },
  }
}

/** Kimi For Coding quota: top-level `usage` is the weekly summary, `limits[]` the per-window rows. */
const KIMI_CODING: ProviderAdapter = {
  ids: ['kimi-coding'],
  displayName: 'Kimi For Coding',
  plan: {
    build: ({ apiKey }) => ({ url: 'https://api.kimi.com/coding/v1/usages', headers: bearer(apiKey) }),
    parse: (status, body) => {
      if (status !== 200 || typeof body !== 'object' || body === null) return undefined
      const root = body as Record<string, unknown>
      const windows: PlanWindowView[] = []
      const limits = root.limits
      if (Array.isArray(limits)) {
        for (const entry of limits) {
          if (typeof entry !== 'object' || entry === null) continue
          const detail = (entry as Record<string, unknown>).detail
          const window = (entry as Record<string, unknown>).window
          if (typeof detail !== 'object' || detail === null) continue
          const row = detail as Record<string, unknown>
          const duration = typeof window === 'object' && window !== null ? toNum((window as Record<string, unknown>).duration) : undefined
          const unit = typeof window === 'object' && window !== null ? str((window as Record<string, unknown>).timeUnit) : undefined
          const key = duration === 300 && unit === 'TIME_UNIT_MINUTE' ? '5h' : duration !== undefined ? `w-${duration}` : 'window'
          const percent = usedPercent(row.used, row.limit)
          windows.push({ key, name: str(row.name), percent, resetsAt: toIso(row.resetTime) })
        }
      }
      const usage = root.usage
      if (typeof usage === 'object' && usage !== null) {
        const weekly = usage as Record<string, unknown>
        windows.push({
          key: 'week',
          name: 'Weekly',
          percent: usedPercent(weekly.used, weekly.limit),
          resetsAt: toIso(weekly.resetTime),
        })
      }
      if (windows.length === 0) return undefined
      const user = root.user
      const membership = typeof user === 'object' && user !== null ? (user as Record<string, unknown>).membership : undefined
      const planName = typeof membership === 'object' && membership !== null ? str((membership as Record<string, unknown>).level) : undefined
      return { planName, windows }
    },
  },
}

/** GLM Coding Plan quota; auth is the RAW key without a Bearer prefix. */
function glmPlan(host: string, ids: readonly string[]): ProviderAdapter {
  return {
    ids,
    displayName: 'GLM Coding Plan',
    plan: {
      build: ({ apiKey }) => ({
        url: `https://${host}/api/monitor/usage/quota/limit`,
        headers: { authorization: apiKey, 'accept-language': 'en-US,en' },
      }),
      parse: (status, body) => {
        if (status !== 200 || typeof body !== 'object' || body === null) return undefined
        const root = body as Record<string, unknown>
        if (root.success !== true) return undefined
        const data = root.data
        if (typeof data !== 'object' || data === null) return undefined
        const limits = (data as Record<string, unknown>).limits
        if (!Array.isArray(limits)) return undefined
        const windows: PlanWindowView[] = []
        for (const entry of limits) {
          if (typeof entry !== 'object' || entry === null) continue
          const row = entry as Record<string, unknown>
          const unit = toNum(row.unit)
          const percent = toNum(row.percentage)
          windows.push({
            key: unit === 3 ? '5h' : unit === 6 ? 'week' : unit !== undefined ? `unit-${unit}` : 'window',
            percent: percent === undefined ? undefined : Math.max(0, Math.min(100, percent)),
            resetsAt: toIso(row.nextResetTime),
          })
        }
        if (windows.length === 0) return undefined
        return { planName: str((data as Record<string, unknown>).level), windows }
      },
    },
  }
}

/** OpenCode Go quota: percent-only rolling/weekly/monthly windows. */
const OPENCODE_GO: ProviderAdapter = {
  ids: ['opencode-go'],
  displayName: 'OpenCode Go',
  plan: {
    build: ({ apiKey }) => ({ url: 'https://opencode.ai/zen/go/v1/usage', headers: bearer(apiKey) }),
    parse: (status, body) => {
      if (status !== 200 || typeof body !== 'object' || body === null) return undefined
      const usage = (body as Record<string, unknown>).usage
      if (typeof usage !== 'object' || usage === null) return undefined
      const windows: PlanWindowView[] = []
      const keys: Array<[string, string]> = [['rolling', '5h'], ['weekly', 'week'], ['monthly', 'month']]
      for (const [field, key] of keys) {
        const entry = (usage as Record<string, unknown>)[field]
        if (typeof entry !== 'object' || entry === null) continue
        const row = entry as Record<string, unknown>
        const percent = toNum(row.percent)
        windows.push({
          key,
          percent: percent === undefined ? undefined : Math.max(0, Math.min(100, percent)),
          // percent 0 resetsAt is a placeholder (now + window); drop it.
          resetsAt: percent === 0 ? undefined : toIso(row.resetsAt),
        })
      }
      if (windows.length === 0) return undefined
      return { windows }
    },
  },
}

/** MiniMax coding-plan remains: remaining-percent semantics, `general` model entry. */
function minimaxPlan(host: string, ids: readonly string[]): ProviderAdapter {
  return {
    ids,
    displayName: 'MiniMax Coding Plan',
    plan: {
      build: ({ apiKey }) => ({ url: `https://${host}/v1/api/openplatform/coding_plan/remains`, headers: bearer(apiKey) }),
      parse: (status, body) => {
        if (status !== 200 || typeof body !== 'object' || body === null) return undefined
        const remains = (body as Record<string, unknown>).model_remains
        if (!Array.isArray(remains)) return undefined
        const general = remains.find((entry) => typeof entry === 'object' && entry !== null
          && (entry as Record<string, unknown>).model_name === 'general')
        if (typeof general !== 'object' || general === null) return undefined
        const row = general as Record<string, unknown>
        const windows: PlanWindowView[] = []
        const intervalRemaining = toNum(row.current_interval_remaining_percent)
        if (intervalRemaining !== undefined) {
          windows.push({ key: '5h', percent: Math.max(0, Math.min(100, 100 - intervalRemaining)), resetsAt: toIso(row.end_time) })
        }
        if (row.current_weekly_status === 1) {
          const weeklyRemaining = toNum(row.current_weekly_remaining_percent)
          if (weeklyRemaining !== undefined) {
            windows.push({ key: 'week', percent: Math.max(0, Math.min(100, 100 - weeklyRemaining)), resetsAt: toIso(row.weekly_end_time) })
          }
        }
        if (windows.length === 0) return undefined
        return { windows }
      },
    },
  }
}

const OPENROUTER: ProviderAdapter = {
  ids: ['openrouter'],
  displayName: 'OpenRouter',
  balance: {
    build: ({ apiKey }) => ({ url: 'https://openrouter.ai/api/v1/credits', headers: bearer(apiKey) }),
    parse: (status, body) => {
      if (status !== 200 || typeof body !== 'object' || body === null) return undefined
      const data = (body as Record<string, unknown>).data
      if (typeof data !== 'object' || data === null) return undefined
      const credits = toNum((data as Record<string, unknown>).total_credits)
      const used = toNum((data as Record<string, unknown>).total_usage) ?? 0
      if (credits === undefined) return undefined
      return { currency: 'USD', totalBalance: money(credits - used) }
    },
  },
}

function siliconFlow(host: string, ids: readonly string[], currency: string): ProviderAdapter {
  return {
    ids,
    displayName: 'SiliconFlow',
    balance: {
      build: ({ apiKey }) => ({ url: `https://${host}/v1/user/info`, headers: bearer(apiKey) }),
      parse: (status, body) => {
        if (status !== 200 || typeof body !== 'object' || body === null) return undefined
        const data = (body as Record<string, unknown>).data
        if (typeof data !== 'object' || data === null) return undefined
        const total = str((data as Record<string, unknown>).totalBalance)
        if (total === undefined) return undefined
        return { currency, totalBalance: total }
      },
    },
  }
}

const ZENMUX: ProviderAdapter = {
  ids: ['zenmux'],
  displayName: 'ZenMux',
  balance: {
    build: ({ apiKey }) => ({ url: 'https://zenmux.ai/api/v1/management/payg/balance', headers: bearer(apiKey) }),
    parse: (status, body) => {
      if (status !== 200 || typeof body !== 'object' || body === null) return undefined
      const data = (body as Record<string, unknown>).data
      if (typeof data !== 'object' || data === null) return undefined
      const credits = toNum((data as Record<string, unknown>).total_credits)
      if (credits === undefined) return undefined
      return { currency: 'USD', totalBalance: money(credits) }
    },
  },
}

/**
 * OpenAI Codex (ChatGPT subscription) quota over the OAuth access token the
 * pi-ai grant stores — the one plan adapter whose credential is an OAuth
 * token rather than an API key. A 401 here means the stored access token has
 * expired; it refreshes when the harness next runs a Codex request, so the
 * error line tells the user to use Codex once and refresh.
 */
const OPENAI_CODEX: ProviderAdapter = {
  ids: ['openai-codex'],
  displayName: 'Codex (ChatGPT 订阅)',
  plan: {
    build: ({ apiKey, accountId }) => ({
      url: 'https://chatgpt.com/backend-api/wham/usage',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'user-agent': 'codex-cli',
        accept: 'application/json',
        ...(accountId !== undefined ? { 'chatgpt-account-id': accountId } : {}),
      },
    }),
    parse: (status, body) => {
      if (status !== 200 || typeof body !== 'object' || body === null) return undefined
      const rateLimit = (body as Record<string, unknown>).rate_limit
      if (typeof rateLimit !== 'object' || rateLimit === null) return undefined
      const windows: PlanWindowView[] = []
      const rows = (rateLimit as Record<string, unknown>).primary_window !== undefined || (rateLimit as Record<string, unknown>).secondary_window !== undefined
        ? [(rateLimit as Record<string, unknown>).primary_window, (rateLimit as Record<string, unknown>).secondary_window]
        : []
      for (const entry of rows) {
        if (typeof entry !== 'object' || entry === null) continue
        const row = entry as Record<string, unknown>
        const percent = toNum(row.used_percent)
        if (percent === undefined) continue
        const seconds = toNum(row.limit_window_seconds)
        windows.push({
          key: codexWindowKey(seconds),
          percent: Math.max(0, Math.min(100, percent)),
          // reset_at is unix seconds; toIso scales sub-millisecond-epoch values.
          resetsAt: toIso(row.reset_at),
        })
      }
      if (windows.length === 0) return undefined
      return { windows }
    },
  },
}

/** Map a Codex window length in seconds onto the shared window key vocabulary. */
function codexWindowKey(seconds: number | undefined): string {
  if (seconds === undefined) return 'window'
  if (seconds === 18000) return '5h'
  if (seconds === 604800) return 'week'
  if (seconds === 2_592_000) return 'month'
  const hours = seconds / 3600
  return hours >= 24 ? `${Math.round(hours / 24)}_day` : `${Math.round(hours)}_hour`
}

/**
 * The adapter registry, in no particular order. Route keys come from the
 * pi-ai provider catalog plus the routes this deployment observed in user
 * configuration (`zenmux`).
 */
export const PROVIDER_ADAPTERS: readonly ProviderAdapter[] = [
  DEEPSEEK,
  moonshotBalance('api.moonshot.cn', 'CNY', ['moonshotai-cn']),
  moonshotBalance('api.moonshot.ai', 'USD', ['moonshotai']),
  KIMI_CODING,
  glmPlan('open.bigmodel.cn', ['zai-coding-cn']),
  glmPlan('api.z.ai', ['zai-coding']),
  OPENCODE_GO,
  minimaxPlan('api.minimaxi.com', ['minimax-cn']),
  minimaxPlan('api.minimax.io', ['minimax']),
  OPENAI_CODEX,
  OPENROUTER,
  siliconFlow('api.siliconflow.cn', ['siliconflow', 'siliconflow-cn'], 'CNY'),
  siliconFlow('api.siliconflow.com', ['siliconflow-intl'], 'USD'),
  ZENMUX,
]

/** Find the adapter serving a provider route key, if any. */
export function adapterFor(provider: string): ProviderAdapter | undefined {
  return PROVIDER_ADAPTERS.find((adapter) => adapter.ids.includes(provider))
}

/**
 * Whether a provider route belongs to the official DeepSeek family: the only
 * family with a spend price book and a settings-section-owned env credential
 * (llm-deepseek) rather than a pi-ai profile. Drives the env fallback in
 * credential resolution and the fold-time cost stamping.
 */
export function isDeepSeekProviderRoute(provider: string): boolean {
  return adapterFor(provider) === DEEPSEEK
}

/**
 * Best-effort human message from a provider error body, for the per-provider
 * error line. Never throws; truncated to one short sentence.
 */
export function providerErrorMessage(status: number, body: unknown): string {
  let message: string | undefined
  if (typeof body === 'object' && body !== null) {
    const root = body as Record<string, unknown>
    const nested = typeof root.error === 'object' && root.error !== null ? (root.error as Record<string, unknown>) : undefined
    message = str(root.message) ?? str(root.msg) ?? (nested !== undefined ? str(nested.message) : undefined)
  }
  const detail = message === undefined ? '' : `: ${message.slice(0, 120)}`
  return `HTTP ${status}${detail}`
}
