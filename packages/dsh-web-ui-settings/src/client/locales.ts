/**
 * The `web-ui-plugins` locale dictionaries for the group card.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': 'Web UI 插件',
  'description': '统一管理 dsh-web-ui 全家桶插件的启用与配置。',
} satisfies Record<string, string>

/** Key union for this namespace. */
export type WebUIPluginsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Web UI Plugins',
  'description': 'Enable and configure the dsh-web-ui family plugins from one place.',
} satisfies Record<WebUIPluginsKey, string>

