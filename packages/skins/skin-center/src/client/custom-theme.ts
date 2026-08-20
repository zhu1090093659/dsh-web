export const CUSTOM_THEME_ID = 'custom-theme'
export const SKIN_CUSTOM_THEME_NS = 'skin-custom-theme'

export interface CustomThemeProfile {
  accent: string
  background: string
  foreground: string
  contrast: number
}

export interface CustomThemeConfig {
  lightAccent?: string
  lightBackground?: string
  lightForeground?: string
  lightContrast?: number
  darkAccent?: string
  darkBackground?: string
  darkForeground?: string
  darkContrast?: number
  applied?: boolean
}

export const DEFAULT_CUSTOM_THEME: Record<'light' | 'dark', CustomThemeProfile> = {
  light: { accent: '#4f6faf', background: '#f7f9fc', foreground: '#1b2533', contrast: 50 },
  dark: { accent: '#86a7ff', background: '#162235', foreground: '#e7edf7', contrast: 50 },
}

const HEX = /^#[0-9a-f]{6}$/i

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function parseHex(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ]
}

function toHex(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
}

/** Mix a source color into a target color by a percentage. */
function mix(source: string, target: string, amount: number): string {
  const [sr, sg, sb] = parseHex(source)
  const [tr, tg, tb] = parseHex(target)
  const ratio = clamp(amount, 0, 100) / 100
  return `#${toHex(sr + (tr - sr) * ratio)}${toHex(sg + (tg - sg) * ratio)}${toHex(sb + (tb - sb) * ratio)}`
}

function rgba(color: string, alpha: number): string {
  const [r, g, b] = parseHex(color)
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(2)})`
}

function luminance(color: string): number {
  const [r, g, b] = parseHex(color)
  const channel = (value: number): number => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Clamp the UI value to a CSS-safe contrast factor around the neutral 50. */
export function contrastScale(value: number): number {
  const safe = Number.isFinite(value) ? clamp(Math.round(value), 0, 100) : 50
  return 0.8 + safe / 100 * 0.4
}

export function validateCustomThemeProfile(
  input: Partial<CustomThemeProfile>,
  fallback: CustomThemeProfile,
): CustomThemeProfile {
  const color = (value: unknown, defaultValue: string): string =>
    typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : defaultValue
  const contrast = typeof input.contrast === 'number' && Number.isFinite(input.contrast)
    ? Math.round(clamp(input.contrast, 0, 100))
    : fallback.contrast
  return {
    accent: color(input.accent, fallback.accent),
    background: color(input.background, fallback.background),
    foreground: color(input.foreground, fallback.foreground),
    contrast,
  }
}

/**
 * Generate only plugin-owned, fixed selectors. All colors have been validated
 * before this function is called; no user CSS or selector can enter the result.
 */
export function customThemeCss(profile: CustomThemeProfile): string {
  const { accent, background, foreground } = profile
  const contrast = contrastScale(profile.contrast)
  const darkSurface = luminance(background) < 0.45
  const contrastDelta = (contrast - 1) * 100
  const surfaceBase = darkSurface ? 12 : 0
  const darken = clamp(surfaceBase - contrastDelta * 0.5, 0, 52)
  const lighten = clamp((contrast - 1) * 100 + (darkSurface ? 0 : 8), 0, 32)
  const layer1 = mix(background, foreground, darken)
  const layer2 = mix(background, foreground, darkSurface ? darken + 8 : darken)
  const layer3 = mix(background, foreground, darkSurface ? darken + 16 : darken)
  const elevated = mix(background, foreground, darkSurface ? darken + 22 : 6 + darken)
  const primary = mix(foreground, background, 0)
  const secondary = mix(foreground, background, clamp(32 / contrast, 0, 48))
  const tertiary = mix(foreground, background, clamp(55 / contrast, 0, 72))
  const accentHover = mix(accent, '#ffffff', 18 + lighten)
  const accentSoft = mix(accent, background, 78 - lighten)
  const border = rgba(foreground, 0.18 + (contrast - 0.8) * 0.2)
  const borderStrong = rgba(foreground, 0.32 + (contrast - 0.8) * 0.2)
  const error = mix('#ef4444', foreground, 14)
  const success = mix('#22c55e', foreground, 14)
  const warning = mix('#f59e0b', foreground, 12)

  const tokens = `
    --dsw-alias-bg-base: ${background};
    --dsw-alias-bg-layer-1: ${layer1};
    --dsw-alias-bg-layer-2: ${layer2};
    --dsw-alias-bg-layer-3: ${layer3};
    --dsw-alias-bg-overlay: ${rgba(layer3, 0.92)};
    --dsw-alias-bg-mask-1: ${rgba(background, 0.64)};
    --dsw-alias-bg-mask-2: ${rgba(background, 0.48)};
    --dsw-alias-bg-mask-3: ${rgba(background, 0.32)};
    --dsw-alias-bg-mask-photo: ${rgba(background, 0.88)};
    --dsw-alias-bg-module-platform: ${elevated};
    --dsw-alias-bg-multi-select: ${layer3};
    --dsw-alias-bg-skeleton: ${mix(background, foreground, 10)};
    --dsw-alias-border-inverted: ${border};
    --dsw-alias-border-inverted2: ${borderStrong};
    --dsw-alias-border-l1: ${rgba(foreground, 0.12)};
    --dsw-alias-border-l2: ${rgba(foreground, 0.2)};
    --dsw-alias-border-l2-darkmode-thin: ${rgba(foreground, 0.12)};
    --dsw-alias-border-l3: ${rgba(foreground, 0.3)};
    --dsw-alias-border-l4: ${rgba(foreground, 0.42)};
    --dsw-alias-label-primary: ${primary};
    --dsw-alias-label-secondary: ${secondary};
    --dsw-alias-label-tertiary: ${tertiary};
    --dsw-alias-label-dimmed: ${mix(foreground, background, 68)};
    --dsw-alias-label-primary-dimmed: ${mix(foreground, background, 36)};
    --dsw-alias-label-caption: ${mix(foreground, background, 58)};
    --dsw-alias-label-primary-bluish: ${foreground};
    --dsw-alias-label-primary-foreground: ${foreground};
    --dsw-alias-label-primary-inverted: ${layer3};
    --dsw-alias-brand-primary: ${accent};
    --dsw-alias-brand-text: ${accent};
    --dsw-alias-brand-primary-invert: ${mix(accent, foreground, 22)};
    --dsw-alias-brand-primary-new-colorprimary-new-color: ${accent};
    --dsw-alias-button-contrast-fill: ${foreground};
    --dsw-alias-button-elevated-fill: ${layer3};
    --dsw-alias-button-floating-fill: ${elevated};
    --dsw-alias-button-floating-hover: ${accentHover};
    --dsw-alias-button-primary-fill: ${accent};
    --dsw-alias-button-primary-hover: ${accentHover};
    --dsw-alias-button-primary-dimmed: ${accentSoft};
    --dsw-alias-button-ghost-active-border: ${mix(accent, foreground, 26)};
    --dsw-alias-button-ghost-active-fill: ${accentSoft};
    --dsw-alias-button-ghost-active-hover: ${mix(accent, background, 68)};
    --dsw-alias-button-info-fill: ${accent};
    --dsw-alias-button-info-hover: ${accentHover};
    --dsw-alias-button-tool-bar-fill: ${rgba(foreground, 0.08)};
    --dsw-alias-button-tool-bar-fill-invisible: ${rgba(foreground, 0.18)};
    --dsw-alias-button-tool-bar-hover: ${rgba(accent, 0.14)};
    --dsw-alias-interactive-bg-active: ${rgba(accent, 0.2)};
    --dsw-alias-interactive-bg-hover: ${rgba(accent, 0.12)};
    --dsw-alias-interactive-bg-hover-accent: ${rgba(accent, 0.2)};
    --dsw-alias-interactive-bg-hover-solid: ${layer2};
    --dsw-alias-markdown-citation: ${accent};
    --dsw-alias-markdown-code-block: ${layer1};
    --dsw-alias-markdown-code-block-banner: ${layer2};
    --dsw-alias-markdown-code-segment-selected: ${accentSoft};
    --dsw-alias-markdown-code-segment-unselected: ${layer1};
    --dsw-alias-markdown-inline-code: ${layer2};
    --dsw-alias-markdown-placeholder: ${layer2};
    --dsw-alias-markdown-tag: ${layer2};
    --dsw-alias-state-business-primary: ${accent};
    --dsw-alias-state-business-tertiary: ${accentSoft};
    --dsw-alias-state-error-primary: ${error};
    --dsw-alias-state-error-secondary: ${mix(error, background, 72)};
    --dsw-alias-state-success-primary: ${success};
    --dsw-alias-state-success-secondary: ${mix(success, background, 72)};
    --dsw-alias-state-success-tertiary: ${mix(success, background, 20)};
    --dsw-alias-state-warn-label: ${warning};
    --dsw-alias-state-warn-primary: ${warning};
    --dsw-alias-state-warn-secondary: ${mix(warning, background, 72)};
    --dsw-alias-state-warn-tertiary: ${mix(warning, background, 20)};
    --dsw-alias-tooltip-bg: ${elevated};
    --dsw-alias-toast-bg: ${layer3};
    --dsw-hovercard-bg: ${layer3};
    --dsw-specific-bubble: ${layer2};
    --dsw-specific-bubble-highlight: ${layer3};
    --dsw-specific-input-major: ${elevated};
    --dsw-specific-login-input: ${background};
    --dsw-specific-menu: ${layer3};
    --dsw-specific-selector: ${elevated};
    --dsw-specific-sidebar-fill: ${background};
    --dsw-specific-sidebar-nav-item-active: ${accentSoft};
    --dsw-specific-sidebar-nav-item-active-accent: ${accent};
    --dsw-specific-sidebar-nav-item-hover: ${rgba(accent, 0.12)};
    --dsw-specific-tip: ${elevated};
    --dsh-custom-theme-contrast: ${contrast.toFixed(2)};
  `

  return `:root[data-dsh-custom-theme] { ${tokens} }
:root[data-dsh-custom-theme] body { ${tokens} }`
}
