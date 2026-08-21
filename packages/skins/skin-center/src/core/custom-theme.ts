/** Versioned user theme derived from the official stock theme. */

export const SKIN_CUSTOM_THEME_NS = 'skin-custom-theme'
export const CUSTOM_THEME_VERSION = 1 as const

export interface CustomThemeProfile {
  accent: string
  background: string
  foreground: string
  contrast: number
}

export interface CustomThemeConfig {
  version: number
  applied: boolean
  light: CustomThemeProfile
  dark: CustomThemeProfile
}

export const CUSTOM_THEME_DEFAULTS: Readonly<CustomThemeConfig> = {
  version: CUSTOM_THEME_VERSION,
  applied: false,
  light: {
    accent: '#4d6bfe',
    background: '#f7f8fa',
    foreground: '#262626',
    contrast: 50,
  },
  dark: {
    accent: '#7c91ff',
    background: '#171719',
    foreground: '#f3f3f3',
    contrast: 50,
  },
}

/** The complete token surface this feature may emit. */
export const CUSTOM_THEME_ALLOWED_TOKENS = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-multi-select',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-skeleton',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-brand-primary',
  '--dsw-alias-brand-primary-invert',
  '--dsw-alias-brand-text',
  '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-hover-accent',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-code-block-banner',
  '--dsw-alias-markdown-inline-code',
  '--dsw-alias-scrollbar-bg-l1',
  '--dsw-alias-scrollbar-hover-l1',
  '--dsw-alias-toast-bg',
  '--dsw-alias-tooltip-bg',
  '--dsw-specific-bubble',
  '--dsw-specific-bubble-highlight',
  '--dsw-specific-input-major',
  '--dsw-specific-menu',
  '--dsw-specific-selector',
  '--dsw-specific-sidebar-fill',
  '--dsw-specific-sidebar-nav-item-active',
  '--dsw-specific-sidebar-nav-item-active-accent',
  '--dsw-specific-sidebar-nav-item-hover',
] as const

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback
}

function contrast(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeProfile(value: unknown, fallback: Readonly<CustomThemeProfile>): CustomThemeProfile {
  const source = record(value)
  return {
    accent: color(source.accent, fallback.accent),
    background: color(source.background, fallback.background),
    foreground: color(source.foreground, fallback.foreground),
    contrast: contrast(source.contrast, fallback.contrast),
  }
}

/** Normalize untrusted settings data into the current contract version. */
export function normalizeCustomThemeConfig(value: unknown): CustomThemeConfig {
  const source = record(value)
  if (source.version !== undefined && source.version !== CUSTOM_THEME_VERSION) {
    return {
      version: CUSTOM_THEME_VERSION,
      applied: false,
      light: { ...CUSTOM_THEME_DEFAULTS.light },
      dark: { ...CUSTOM_THEME_DEFAULTS.dark },
    }
  }
  return {
    version: CUSTOM_THEME_VERSION,
    applied: source.applied === true,
    light: normalizeProfile(source.light, CUSTOM_THEME_DEFAULTS.light),
    dark: normalizeProfile(source.dark, CUSTOM_THEME_DEFAULTS.dark),
  }
}

function mix(a: string, aPercent: number, b: string): string {
  return `color-mix(in srgb, ${a} ${aPercent}%, ${b})`
}

function declarations(profile: CustomThemeProfile): Array<[typeof CUSTOM_THEME_ALLOWED_TOKENS[number], string]> {
  const { accent, background, foreground } = profile
  const depth1 = 2 + Math.round(profile.contrast * 0.12)
  const depth2 = depth1 + 4
  const depth3 = depth2 + 4
  const border = 12 + Math.round(profile.contrast * 0.18)
  const mutedText = 60 + Math.round(profile.contrast * 0.2)
  return [
    ['--dsw-alias-bg-base', background],
    ['--dsw-alias-bg-layer-1', mix(background, 100 - depth1, foreground)],
    ['--dsw-alias-bg-layer-2', mix(background, 100 - depth2, foreground)],
    ['--dsw-alias-bg-layer-3', mix(background, 100 - depth3, foreground)],
    ['--dsw-alias-bg-multi-select', mix(background, 84, accent)],
    ['--dsw-alias-bg-overlay', mix(background, 90 - Math.round(profile.contrast * 0.08), foreground)],
    ['--dsw-alias-bg-skeleton', mix(background, 82, foreground)],
    ['--dsw-alias-border-l1', mix(background, 100 - border, foreground)],
    ['--dsw-alias-border-l2', mix(background, 100 - Math.max(8, border - 5), foreground)],
    ['--dsw-alias-border-l3', mix(background, 100 - Math.max(5, border - 9), foreground)],
    ['--dsw-alias-border-l4', mix(background, 96, foreground)],
    ['--dsw-alias-brand-primary', accent],
    ['--dsw-alias-brand-primary-invert', background],
    ['--dsw-alias-brand-text', accent],
    ['--dsw-alias-button-primary-dimmed', mix(accent, 48, background)],
    ['--dsw-alias-button-primary-fill', accent],
    ['--dsw-alias-button-primary-hover', mix(accent, 82, foreground)],
    ['--dsw-alias-interactive-bg-active', mix(background, 78, accent)],
    ['--dsw-alias-interactive-bg-hover', mix(background, 100 - depth2, foreground)],
    ['--dsw-alias-interactive-bg-hover-accent', mix(background, 84, accent)],
    ['--dsw-alias-label-dimmed', mix(foreground, 42, background)],
    ['--dsw-alias-label-primary', foreground],
    ['--dsw-alias-label-primary-foreground', foreground],
    ['--dsw-alias-label-secondary', mix(foreground, mutedText, background)],
    ['--dsw-alias-label-tertiary', mix(foreground, Math.max(45, mutedText - 18), background)],
    ['--dsw-alias-markdown-code-block', mix(background, 100 - depth2, foreground)],
    ['--dsw-alias-markdown-code-block-banner', mix(background, 100 - depth3, foreground)],
    ['--dsw-alias-markdown-inline-code', mix(background, 86, accent)],
    ['--dsw-alias-scrollbar-bg-l1', mix(background, 94, foreground)],
    ['--dsw-alias-scrollbar-hover-l1', mix(background, 76, foreground)],
    ['--dsw-alias-toast-bg', mix(background, 100 - depth3, foreground)],
    ['--dsw-alias-tooltip-bg', mix(background, 28, foreground)],
    ['--dsw-specific-bubble', mix(background, 92, accent)],
    ['--dsw-specific-bubble-highlight', mix(background, 82, accent)],
    ['--dsw-specific-input-major', mix(background, 100 - depth1, foreground)],
    ['--dsw-specific-menu', mix(background, 100 - depth1, foreground)],
    ['--dsw-specific-selector', mix(background, 100 - depth2, foreground)],
    ['--dsw-specific-sidebar-fill', mix(background, 100 - depth1, foreground)],
    ['--dsw-specific-sidebar-nav-item-active', mix(background, 86, accent)],
    ['--dsw-specific-sidebar-nav-item-active-accent', accent],
    ['--dsw-specific-sidebar-nav-item-hover', mix(background, 100 - depth2, foreground)],
  ]
}

function block(selector: string, profile: CustomThemeProfile): string {
  const body = declarations(profile).map(([name, value]) => `  ${name}: ${value};`).join('\n')
  return `${selector} {\n${body}\n}`
}

/** Build stock-only CSS from normalized, fixed token declarations. */
export function buildCustomThemeCss(value: unknown): string {
  const config = normalizeCustomThemeConfig(value)
  return [
    block('html[data-dsh-custom-theme]:not([data-dsh-skin]) body', config.light),
    block('html[data-dsh-custom-theme]:not([data-dsh-skin]) body[data-ds-dark-theme]', config.dark),
  ].join('\n\n')
}
