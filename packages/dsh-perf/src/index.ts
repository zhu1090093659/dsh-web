import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { mountOnce } from './mount-once.ts'
import { PerfMeter, type PerfMode, type PerfMeterOptions } from './host/perf-meter.ts'
import { makePerfStatsRoute } from './host/routes.ts'

export const name = 'dsh-perf'
export const inject = ['webServer']
export const PERF_SETTINGS_NAMESPACE = 'dsh-perf' as SettingsNamespace

export interface Config {
  enabled?: boolean
  mode?: string
  meterIntervalMs?: number
  statsWindowSeconds?: number
  /** 告警阈值预设: light(减轻)/standard(标准)/strict(严格)。 */
  alertPreset?: string
  /** HUD 检测面板(客户端消费, host schema 承载): 默认关闭。 */
  hudEnabled?: boolean
  /** 客户端消息渲染降载(P1 shadow)开关, 由 client 消费, host 只做 schema 承载。 */
  renderDegrade?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  mode: z.string().default('balanced'),
  meterIntervalMs: z.number().min(1000).max(60000).default(2000),
  statsWindowSeconds: z.number().min(10).max(3600).default(120),
  alertPreset: z.string().default('standard'),
  hudEnabled: z.boolean().default(false),
  renderDegrade: z.boolean().default(true),
})

export interface ResolvedConfig {
  enabled: boolean
  mode: PerfMode
  meterIntervalMs: number
  statsWindowSeconds: number
  maxActiveSessions: number
  maxEventsPerSec: number
  hudEnabled: boolean
  renderDegrade: boolean
}

/** 告警阈值预设: 轻/标准/严格 → 会话数与事件速率。 */
const ALERT_PRESETS: Readonly<Record<string, { sessions: number; eventsPerSec: number }>> = {
  light: { sessions: 10, eventsPerSec: 1000 },
  standard: { sessions: 5, eventsPerSec: 300 },
  strict: { sessions: 3, eventsPerSec: 150 },
}

export function resolveConfig(config?: Config): ResolvedConfig {
  return {
    enabled: config?.enabled ?? true,
    mode: config?.mode === 'off' || config?.mode === 'aggressive' || config?.mode === 'balanced' ? config.mode : 'balanced',
    meterIntervalMs: config?.meterIntervalMs ?? 2000,
    statsWindowSeconds: config?.statsWindowSeconds ?? 120,
    ...(() => {
      const preset = typeof config?.alertPreset === 'string' && config.alertPreset in ALERT_PRESETS ? config.alertPreset : 'standard'
      const mapped = ALERT_PRESETS[preset]
      return { maxActiveSessions: mapped.sessions, maxEventsPerSec: mapped.eventsPerSec }
    })(),
    hudEnabled: config?.hudEnabled ?? false,
    renderDegrade: config?.renderDegrade ?? true,
  }
}

/** 由 bundle patch 应用的持久化写批延迟: 覆盖整行时写死 500ms(balanced)。 */
export const BUNDLE_WRITE_BATCH_DELAY_MS = 500

/** 尽力从运行时读取 persistence 行实际生效的 writeBatchMaxDelayMs(只读, 不修改)。 */
function readAppliedBatchDelay(ctx: Context): number | undefined {
  try {
    const service = (ctx as unknown as { get?: (name: string) => unknown }).get?.('sessionPersistence')
    const config = (service as { config?: { writeBatchMaxDelayMs?: unknown } } | undefined)?.config
    return typeof config?.writeBatchMaxDelayMs === 'number' ? config.writeBatchMaxDelayMs : undefined
  } catch {
    return undefined
  }
}

export const apply = mountOnce('@linxin666/dsh-perf', (ctx: Context, config?: Config): void => {
  let source: () => Config = () => config ?? {}
  let meter: PerfMeter | undefined
  let disposeRoutes: (() => void) | undefined

  const rearm = (): void => {
    const value = resolveConfig(source())
    if (!value.enabled) {
      meter?.stop()
      meter = undefined
      disposeRoutes?.()
      disposeRoutes = undefined
      return
    }
    const options: PerfMeterOptions = {
      mode: value.mode,
      meterIntervalMs: value.meterIntervalMs,
      statsWindowSeconds: value.statsWindowSeconds,
      maxActiveSessions: value.maxActiveSessions,
      maxEventsPerSec: value.maxEventsPerSec,
      batchDelayMs: readAppliedBatchDelay(ctx) ?? BUNDLE_WRITE_BATCH_DELAY_MS,
    }
    if (meter === undefined) {
      meter = new PerfMeter(ctx, options)
      meter.start()
      disposeRoutes = ctx.webServer.register(makePerfStatsRoute(meter))
    } else {
      meter.applyOptions(options)
    }
  }

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, PERF_SETTINGS_NAMESPACE, Config, config ?? {}, {
      setSource: (next) => { source = next; rearm() },
      onChange: rearm,
    })
  })

  ctx.effect(() => {
    rearm()
    return () => {
      disposeRoutes?.()
      meter?.stop()
    }
  }, 'dsh-perf: runtime')
})