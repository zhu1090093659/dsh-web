import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

import {
  CUSTOM_THEME_DEFAULTS,
  buildCustomThemeCss,
  normalizeCustomThemeConfig,
  type CustomThemeConfig,
  type CustomThemeProfile,
} from '../core/custom-theme.ts'

export type CustomThemeScheme = 'light' | 'dark'

export interface CustomThemeState {
  applied: boolean
  previewing: boolean
  visible: boolean
  writeError: string | null
}

export interface CustomThemeControllerOptions {
  doc?: Document
}

type CustomThemeField = keyof CustomThemeConfig & string

interface PendingWrite {
  field: CustomThemeField
  value: CustomThemeConfig[CustomThemeField]
  resolve(): void
  reject(error: unknown): void
}

/** Owns the custom-theme settings snapshot and its inert-by-default style. */
export class CustomThemeController {
  private readonly scope: SettingsScope<CustomThemeConfig>
  private readonly doc: Document
  private readonly style: HTMLStyleElement
  private readonly unsubscribe: () => void
  private readonly listeners = new Set<() => void>()
  private config: CustomThemeConfig
  private previewingValue = false
  private suspended = false
  private state: CustomThemeState
  private disposed = false
  private readonly writeQueue: PendingWrite[] = []
  private pendingWrites = 0
  private drainingWrites = false

  constructor(scope: SettingsScope<CustomThemeConfig>, options: CustomThemeControllerOptions = {}) {
    this.scope = scope
    this.doc = options.doc ?? document
    this.config = normalizeCustomThemeConfig(scope.getSnapshot().value)
    this.style = this.doc.createElement('style')
    this.style.dataset.dshCustomThemeStyle = ''
    this.doc.head.appendChild(this.style)
    this.state = { applied: this.config.applied, previewing: false, visible: false, writeError: null }
    this.syncDom()
    this.unsubscribe = scope.subscribe(() => {
      if (this.disposed || this.pendingWrites > 0) return
      this.syncFromScope()
    })
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getState = (): CustomThemeState => this.state

  profile(scheme: CustomThemeScheme): CustomThemeProfile {
    return { ...this.config[scheme] }
  }

  setProfileValue(
    scheme: CustomThemeScheme,
    key: keyof CustomThemeProfile,
    value: string | number,
  ): void {
    const next = normalizeCustomThemeConfig({
      ...this.config,
      [scheme]: { ...this.config[scheme], [key]: value },
    })
    this.config = next
    this.clearWriteError()
    this.syncDom()
    this.publish()
    void this.queueWrite(scheme, { ...next[scheme] }).catch(error => { this.setWriteError(error) })
  }

  reset(scheme: CustomThemeScheme): void {
    const profile = { ...CUSTOM_THEME_DEFAULTS[scheme] }
    this.config = { ...this.config, [scheme]: profile }
    this.clearWriteError()
    this.syncDom()
    this.publish()
    void this.queueWrite(scheme, profile).catch(error => { this.setWriteError(error) })
  }

  tryOn(): void {
    this.previewingValue = true
    this.suspended = false
    this.syncDom()
    this.publish()
  }

  exitTryOn(): void {
    this.previewingValue = false
    this.suspended = false
    this.syncDom()
    this.publish()
  }

  async apply(): Promise<void> {
    this.config = { ...this.config, applied: true }
    this.previewingValue = false
    this.suspended = false
    this.syncDom()
    this.publish()
    await this.queueWrite('applied', true)
    if (!this.config.applied) throw new Error('custom theme activation was not persisted')
  }

  async deactivate(): Promise<void> {
    this.config = { ...this.config, applied: false }
    this.previewingValue = false
    this.suspended = false
    this.syncDom()
    this.publish()
    await this.queueWrite('applied', false)
    if (this.config.applied) throw new Error('custom theme deactivation was not persisted')
  }

  suspend(): void {
    if (this.suspended) return
    this.suspended = true
    this.syncDom()
    this.publish()
  }

  resume(): void {
    if (!this.suspended) return
    this.suspended = false
    this.syncDom()
    this.publish()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.listeners.clear()
    this.style.remove()
    this.doc.documentElement.removeAttribute('data-dsh-custom-theme')
  }

  private syncDom(): void {
    this.style.textContent = buildCustomThemeCss(this.config)
    const visible = (this.config.applied || this.previewingValue) && !this.suspended
    if (visible) this.doc.documentElement.setAttribute('data-dsh-custom-theme', 'true')
    else this.doc.documentElement.removeAttribute('data-dsh-custom-theme')
    this.state = {
      applied: this.config.applied,
      previewing: this.previewingValue,
      visible,
      writeError: this.state.writeError,
    }
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }

  private syncFromScope(): void {
    this.config = normalizeCustomThemeConfig(this.scope.getSnapshot().value)
    this.syncDom()
    this.publish()
  }

  private clearWriteError(): void {
    if (this.state.writeError === null) return
    this.state = { ...this.state, writeError: null }
  }

  private setWriteError(error: unknown): void {
    this.state = {
      ...this.state,
      writeError: error instanceof Error ? error.message : String(error),
    }
    this.publish()
  }

  private queueWrite<K extends CustomThemeField>(field: K, value: CustomThemeConfig[K]): Promise<void> {
    this.pendingWrites += 1
    const pending = new Promise<void>((resolve, reject) => {
      this.writeQueue.push({
        field,
        value,
        resolve,
        reject,
      } as PendingWrite)
    })
    void this.drainWrites()
    return pending
  }

  private async drainWrites(): Promise<void> {
    if (this.drainingWrites) return
    this.drainingWrites = true
    const settled: Array<
      { write: PendingWrite; ok: true }
      | { write: PendingWrite; ok: false; error: unknown }
    > = []
    while (this.writeQueue.length > 0) {
      const write = this.writeQueue.shift()
      if (write === undefined) break
      try {
        await this.scope.set(write.field, write.value)
      } catch (error) {
        settled.push({ write, ok: false, error })
        continue
      } finally {
        this.pendingWrites -= 1
      }
      settled.push({ write, ok: true })
    }
    this.drainingWrites = false
    if (!this.disposed) this.syncFromScope()
    const failure = settled.find(result => !result.ok)
    if (!this.disposed && failure !== undefined && !failure.ok) {
      this.setWriteError(failure.error)
    }
    for (const result of settled) {
      if (result.ok) result.write.resolve()
      else result.write.reject(result.error)
    }
  }
}
