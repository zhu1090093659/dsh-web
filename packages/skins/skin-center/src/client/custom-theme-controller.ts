import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_CUSTOM_THEME,
  customThemeCss,
  validateCustomThemeProfile,
  type CustomThemeConfig,
  type CustomThemeProfile,
} from './custom-theme.ts'

export interface BaseSkinState {
  active: string | null
  trying: string | null
  previewing: boolean
}

export interface CustomThemeState {
  scheme: 'light' | 'dark'
  profile: CustomThemeProfile
  applied: boolean
  previewing: boolean
  visible: boolean
}

export interface CustomThemeScope extends SettingsScope<CustomThemeConfig> {
  getSnapshot(): SettingsScopeSnapshot<CustomThemeConfig>
}

const FIELD = {
  light: { accent: 'lightAccent', background: 'lightBackground', foreground: 'lightForeground', contrast: 'lightContrast' },
  dark: { accent: 'darkAccent', background: 'darkBackground', foreground: 'darkForeground', contrast: 'darkContrast' },
} as const

/**
 * The Host settings section is the source of truth whenever it has a user
 * layer. This small browser cache only bridges an already-running Host that
 * has not yet loaded the new settings namespace, so Apply still survives a
 * page refresh before the next DSH restart.
 */
const BROWSER_FALLBACK_KEY = 'dsh-skin-custom-theme:v1'

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function hasCustomThemeUserValue(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  return [
    'lightAccent', 'lightBackground', 'lightForeground', 'lightContrast',
    'darkAccent', 'darkBackground', 'darkForeground', 'darkContrast', 'applied',
  ].some(key => hasOwn(value, key))
}

function profileFromConfig(value: CustomThemeConfig | undefined, scheme: 'light' | 'dark'): CustomThemeProfile {
  const fallback = DEFAULT_CUSTOM_THEME[scheme]
  const fields = FIELD[scheme]
  return validateCustomThemeProfile({
    accent: value?.[fields.accent],
    background: value?.[fields.background],
    foreground: value?.[fields.foreground],
    contrast: value?.[fields.contrast],
  }, fallback)
}

export class CustomThemeController {
  private schemeValue: 'light' | 'dark' = 'light'
  private profileValue: CustomThemeProfile = { ...DEFAULT_CUSTOM_THEME.light }
  private appliedValue = false
  private configValue: CustomThemeConfig = {}
  private previewingValue = false
  private officialPreviewValue = false
  private baseState: BaseSkinState = { active: null, trying: null, previewing: false }
  private readonly listeners = new Set<() => void>()
  private readonly style: HTMLStyleElement
  private readonly unsubscribeScope: () => void
  private disposed = false
  private stateSnapshot: CustomThemeState

  constructor(private readonly scope: CustomThemeScope, private readonly doc: Document = document) {
    this.style = doc.createElement('style')
    this.style.dataset.dshCustomTheme = ''
    doc.head.appendChild(this.style)
    this.read()
    this.stateSnapshot = this.snapshot()
    this.render()
    this.unsubscribeScope = scope.subscribe(() => {
      this.read()
      this.render()
      this.publish()
    })
  }

  getState = (): CustomThemeState => this.stateSnapshot
  profile = (): CustomThemeProfile => this.profileValue
  scheme = (): 'light' | 'dark' => this.schemeValue
  applied = (): boolean => this.appliedValue
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setScheme(scheme: 'light' | 'dark'): void {
    if (scheme === this.schemeValue) return
    this.schemeValue = scheme
    this.read()
    this.render()
    this.publish()
  }

  set(key: keyof CustomThemeProfile, value: string | number): void {
    const next = validateCustomThemeProfile({ ...this.profileValue, [key]: value }, this.profileValue)
    this.profileValue = next
    const field = FIELD[this.schemeValue][key]
    this.configValue = { ...this.configValue, [field]: next[key] }
    this.writeBrowserFallback()
    this.render()
    this.publish()
    void this.scope.set(field, next[key] as never)
  }

  resetCurrent(): void {
    const defaults = DEFAULT_CUSTOM_THEME[this.schemeValue]
    this.profileValue = { ...defaults }
    const fields = FIELD[this.schemeValue]
    for (const key of Object.keys(fields) as Array<keyof CustomThemeProfile>) {
      this.configValue = { ...this.configValue, [fields[key]]: defaults[key] }
    }
    this.writeBrowserFallback()
    this.render()
    this.publish()
    for (const key of Object.keys(fields) as Array<keyof CustomThemeProfile>) {
      void this.scope.set(fields[key], defaults[key] as never)
    }
  }

  tryOn(): void {
    this.previewingValue = true
    this.officialPreviewValue = false
    this.render()
    this.publish()
  }

  exitTryOn(): void {
    this.previewingValue = false
    this.render()
    this.publish()
  }

  apply(): void {
    this.appliedValue = true
    this.configValue = { ...this.configValue, applied: true }
    this.writeBrowserFallback()
    this.previewingValue = false
    this.officialPreviewValue = false
    this.render()
    this.publish()
    void this.scope.set('applied', true)
  }

  clearApplied(): void {
    this.appliedValue = false
    this.configValue = { ...this.configValue, applied: false }
    this.writeBrowserFallback()
    this.previewingValue = false
    this.officialPreviewValue = false
    this.render()
    this.publish()
    void this.scope.set('applied', false)
  }

  /** Synchronize with the existing SkinController without changing it. */
  setBaseSkinState(state: BaseSkinState): void {
    this.baseState = state
    if (state.active !== null && state.previewing) this.previewingValue = false
    this.officialPreviewValue = state.active === null && state.previewing && !this.previewingValue
    this.render()
    this.publish()
  }

  /** Mark the existing official card's preview as active without changing applied config. */
  setOfficialPreview(value: boolean): void {
    this.officialPreviewValue = value
    this.render()
    this.publish()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeScope()
    this.style.remove()
    delete this.doc.documentElement.dataset.dshCustomTheme
    this.listeners.clear()
  }

  private read(): void {
    const snapshot = this.scope.getSnapshot()
    const scopeValue = snapshot.value ?? {}
    const fallback = this.readBrowserFallback()
    this.configValue = hasCustomThemeUserValue(snapshot.user)
      ? scopeValue
      : { ...scopeValue, ...fallback }
    if (hasCustomThemeUserValue(snapshot.user)) this.writeBrowserFallback()
    this.profileValue = profileFromConfig(this.configValue, this.schemeValue)
    this.appliedValue = this.configValue.applied === true
  }

  private readBrowserFallback(): CustomThemeConfig {
    try {
      const raw = this.doc.defaultView?.localStorage.getItem(BROWSER_FALLBACK_KEY)
      if (raw === null || raw === undefined) return {}
      const value: unknown = JSON.parse(raw)
      if (value === null || typeof value !== 'object') return {}
      const source = value as Record<string, unknown>
      return {
        lightAccent: typeof source.lightAccent === 'string' ? source.lightAccent : undefined,
        lightBackground: typeof source.lightBackground === 'string' ? source.lightBackground : undefined,
        lightForeground: typeof source.lightForeground === 'string' ? source.lightForeground : undefined,
        lightContrast: typeof source.lightContrast === 'number' ? source.lightContrast : undefined,
        darkAccent: typeof source.darkAccent === 'string' ? source.darkAccent : undefined,
        darkBackground: typeof source.darkBackground === 'string' ? source.darkBackground : undefined,
        darkForeground: typeof source.darkForeground === 'string' ? source.darkForeground : undefined,
        darkContrast: typeof source.darkContrast === 'number' ? source.darkContrast : undefined,
        applied: typeof source.applied === 'boolean' ? source.applied : undefined,
      }
    } catch {
      return {}
    }
  }

  private writeBrowserFallback(): void {
    try {
      this.doc.defaultView?.localStorage.setItem(BROWSER_FALLBACK_KEY, JSON.stringify(this.configValue))
    } catch {
      // Private browsing or quota failures must not affect the live theme.
    }
  }

  private isOfficialBase(): boolean {
    return this.baseState.active === null
  }

  private shouldShow(): boolean {
    return this.isOfficialBase() && !this.officialPreviewValue && (this.appliedValue || this.previewingValue)
  }

  private render(): void {
    if (this.disposed) return
    if (!this.shouldShow()) {
      this.style.textContent = ''
      delete this.doc.documentElement.dataset.dshCustomTheme
    } else {
      this.style.textContent = customThemeCss(this.profileValue)
      this.doc.documentElement.dataset.dshCustomTheme = ''
    }
    this.stateSnapshot = this.snapshot()
  }

  private snapshot(): CustomThemeState {
    return {
      scheme: this.schemeValue,
      profile: { ...this.profileValue },
      applied: this.appliedValue,
      previewing: this.previewingValue,
      visible: this.shouldShow(),
    }
  }

  private publish(): void {
    this.stateSnapshot = this.snapshot()
    for (const listener of this.listeners) listener()
  }
}
