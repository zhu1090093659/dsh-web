/** `mermaid` client namespace dictionaries (figure chrome + settings card copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'figure.source': '查看源码',
  'figure.hide': '收起源码',
  'figure.error': 'Mermaid 渲染失败：{error}',
  'card.title': 'Mermaid 图表',
  'card.description': '在助手消息中把 mermaid 代码围栏渲染为 SVG 图表。',
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.notExposed': '当前部署未暴露此命名空间，无法在此编辑。',
  'settings.unsaved': '有未保存的修改',
  'settings.readOnly': '当前部署的设置为只读。',
  'settings.saveFailed': '保存失败，请重试。',
  'settings.discard': '放弃修改',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.overridden': '已覆盖',
  'settings.reset': '重置',
  'settings.inherit': '继承',
  'settings.on': '开',
  'settings.off': '关',
  'settings.invalidNumber': '需要有效的数字',
  'settings.enabled': '启用图表渲染',
  'settings.enabledHint': '关闭后助手消息中的 mermaid 围栏保持为普通代码块。',
  'field.theme': '图表主题',
  'field.theme.hint': 'auto 跟随界面明暗；其余为 Mermaid 内置主题。',
  'field.theme.auto': '自动（跟随界面）',
  'field.theme.default': 'Default',
  'field.theme.dark': 'Dark',
  'field.theme.neutral': 'Neutral',
  'field.theme.forest': 'Forest',
} satisfies Record<string, string>

/** The mermaid client namespace key union. */
export type MermaidClientKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'figure.source': 'Show source',
  'figure.hide': 'Hide source',
  'figure.error': 'Mermaid render failed: {error}',
  'card.title': 'Mermaid diagrams',
  'card.description': 'Renders mermaid diagram fences in assistant messages as SVG figures.',
  'settings.expand': 'Expand settings',
  'settings.collapse': 'Collapse settings',
  'settings.notExposed': 'This deployment does not expose the namespace; it cannot be edited here.',
  'settings.unsaved': 'Unsaved changes',
  'settings.readOnly': 'Settings are read-only in this deployment.',
  'settings.saveFailed': 'Save failed; try again.',
  'settings.discard': 'Discard',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset',
  'settings.inherit': 'Inherit',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.invalidNumber': 'A valid number is required',
  'settings.enabled': 'Enable diagram rendering',
  'settings.enabledHint': 'While off, mermaid fences in assistant messages stay plain code blocks.',
  'field.theme': 'Diagram theme',
  'field.theme.hint': 'auto follows the interface brightness; the rest are Mermaid built-in themes.',
  'field.theme.auto': 'Auto (follow interface)',
  'field.theme.default': 'Default',
  'field.theme.dark': 'Dark',
  'field.theme.neutral': 'Neutral',
  'field.theme.forest': 'Forest',
} satisfies Record<string, string>

/** The two dictionaries, keyed by language. */
export const dictionaries: Record<string, Record<MermaidClientKey, string>> = { zh, en }

/** Current UI language, mirrored from the shell (defaults to zh). */
let currentLanguage: string = 'zh'

/** Switch the client copy language. */
export function setLanguage(language: string): void {
  currentLanguage = language
}

/** Format a `{name}` template with values. */
function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{([a-zA-Z0-9]+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/** Translate one key; falls back to the zh dictionary for unknown keys. */
export function t(key: MermaidClientKey, params?: Record<string, string | number>): string {
  const dict = dictionaries[currentLanguage] ?? dictionaries.zh
  const value = (dict[key] ?? dictionaries.zh[key]) as string | undefined
  return value === undefined ? key : params === undefined ? value : format(value, params)
}
