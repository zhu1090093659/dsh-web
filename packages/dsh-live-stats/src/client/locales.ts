/**
 * The `live-stats` namespace dictionaries: copy for the plugin settings card
 * (the `settings.plugin.item` seat) that edits the token-estimator parameters.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'settings.title': '实时令牌估算',
  'settings.description': '生成吞吐量与令牌估算参数。',
  'settings.enabled': '启用实时统计',
  'settings.enabledHint': '关闭后停止统计令牌估算与生成吞吐。',
  'settings.charsPerToken': '每令牌字符数',
  'settings.charsPerTokenHint': '约多少个文本字符折算为 1 个令牌；支持小数。',
  'settings.blockOverhead': '内容块开销（令牌）',
  'settings.blockOverheadHint': '每个内容块固定的框架令牌数。',
  'settings.roleOverhead': '消息角色开销（令牌）',
  'settings.roleOverheadHint': '每条消息或助手响应固定的框架令牌数。',
  'settings.overridden': '已覆盖',
  'settings.reset': '恢复默认',
  'settings.notExposed': '当前 DSH 版本未向设置页暴露本插件的配置命名空间，表单不可用。可编辑 ~/.dsh/settings.yaml 直接配置，或为 dsh-host-apiproxy 的 WEB_SETTINGS_NAMESPACES 白名单补充本命名空间后重启。',
  'settings.readOnly': '当前部署的设置只读。',
  'settings.inherit': '继承',
  'settings.on': '开',
  'settings.off': '关',
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.discard': '放弃',
  'settings.unsaved': '未保存',
  'settings.saveFailed': '部署未接受这些值，已保留供你修改。',
  'settings.invalidNumber': '请输入数字，留空则使用默认值。',
} satisfies Record<string, string>

/** The live-stats key union. */
export type SettingsCardKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'settings.title': 'Live token estimation',
  'settings.description': 'Generation throughput and token estimation parameters.',
  'settings.enabled': 'Enable live stats',
  'settings.enabledHint': 'When off, token estimation and throughput tracking stop.',
  'settings.charsPerToken': 'Characters per token',
  'settings.charsPerTokenHint': 'Roughly how many text characters one token represents; a decimal is allowed.',
  'settings.blockOverhead': 'Block overhead (tokens)',
  'settings.blockOverheadHint': 'Fixed framing tokens assigned to each content block.',
  'settings.roleOverhead': 'Role overhead (tokens)',
  'settings.roleOverheadHint': 'Fixed framing tokens assigned to each message or assistant response.',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset to default',
  'settings.notExposed': 'This DSH version does not expose this plugin\'s settings namespace to the configuration page, so the form is unavailable. Edit ~/.dsh/settings.yaml directly, or add the namespace to dsh-host-apiproxy\'s WEB_SETTINGS_NAMESPACES allowlist and restart.',
  'settings.readOnly': 'This deployment stores settings read-only.',
  'settings.inherit': 'Inherit',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.expand': 'Show settings',
  'settings.collapse': 'Hide settings',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.discard': 'Discard',
  'settings.unsaved': 'Unsaved',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
  'settings.invalidNumber': 'Enter a number, or leave blank to use the default.',
} satisfies Record<SettingsCardKey, string>
