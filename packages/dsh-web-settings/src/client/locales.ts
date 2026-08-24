/**
 * The `web-ui-plugins` locale dictionaries for the group card.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': 'Web UI 插件',
  'description': '统一管理 dsh-web 全家桶插件的启用与配置。',
  'releaseNotesTitle': '版本说明',
  'releaseNotesDescription': '最新版本的详细更新内容。',
  'new': '新增',
  'improved': '改进',
  'fixed': '修复',
  'highlights': '重点内容',
  'ack': '知道了',
  'dontAutoShow': '不再自动弹出更新介绍',
} satisfies Record<string, string>

/** Key union for this namespace. */
export type WebUIPluginsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Web UI Plugins',
  'description': 'Enable and configure the dsh-web family plugins from one place.',
  'releaseNotesTitle': 'Version Notes',
  'releaseNotesDescription': 'The latest release, in detail.',
  'new': 'New',
  'improved': 'Improved',
  'fixed': 'Fixed',
  'highlights': 'Highlights',
  'ack': 'Got it',
  'dontAutoShow': "Don't auto-popup update notes",
} satisfies Record<WebUIPluginsKey, string>
