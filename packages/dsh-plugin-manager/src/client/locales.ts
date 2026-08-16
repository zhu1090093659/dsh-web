/**
 * The `plugin-manager` locale dictionaries for the Manage tab inside the
 * Plugins settings section.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tab': '插件列表',
  'title': '插件启停',
  'description': '列出当前已加载的全部插件，可随时启用或停用；切换即时生效并写入 ~/.dsh/cordis.patch.yml，重启后保持。',
  'loading': '正在读取插件清单…',
  'loadFailed': '读取插件清单失败',
  'retry': '重试',
  'search': '搜索插件',
  'empty': '没有已加载的插件。',
  'emptySearch': '没有匹配的插件。',
  'enabled': '已启用',
  'disabled': '已停用',
  'pending': '等待加载',
  'loadingPhase': '加载中',
  'active': '运行中',
  'failed': '加载失败',
  'unloading': '卸载中',
  'unobserved': '未观测',
  'toggleEnable': '启用 {name}',
  'toggleDisable': '停用 {name}',
  'toggling': '切换中',
  'protected': '受保护',
  'official': '官方',
  'officialNote': '官方插件，谨慎停用',
  'entryId': '条目',
  'toggleFailed': '操作失败：',
  'resultAppliedPersisted': '{name}：已即时生效并持久化。',
  'resultAppliedOnly': '{name}：已即时生效，但未持久化（重启后恢复原状）。',
  'resultDeferred': '{name}：已记录，重启后生效。',
} satisfies Record<string, string>

/** Key union for this namespace. */
export type PluginManagerKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'tab': 'Plugin List',
  'title': 'Plugin Enable/Disable',
  'description': 'Lists every loaded plugin and toggles it on or off; switches apply immediately and are written to ~/.dsh/cordis.patch.yml so they survive restart.',
  'loading': 'Loading plugin inventory...',
  'loadFailed': 'Failed to load the plugin inventory',
  'retry': 'Retry',
  'search': 'Search plugins',
  'empty': 'No plugins loaded.',
  'emptySearch': 'No matching plugins.',
  'enabled': 'Enabled',
  'disabled': 'Disabled',
  'pending': 'Pending',
  'loadingPhase': 'Loading',
  'active': 'Active',
  'failed': 'Failed',
  'unloading': 'Unloading',
  'unobserved': 'Unobserved',
  'toggleEnable': 'Enable {name}',
  'toggleDisable': 'Disable {name}',
  'toggling': 'Toggling',
  'protected': 'Protected',
  'official': 'Official',
  'officialNote': 'Official plugin, disable with care',
  'entryId': 'Entry',
  'toggleFailed': 'Operation failed: ',
  'resultAppliedPersisted': '{name}: applied live and persisted.',
  'resultAppliedOnly': '{name}: applied live but not persisted (restored after restart).',
  'resultDeferred': '{name}: recorded, takes effect after restart.',
} satisfies Record<PluginManagerKey, string>