/**
 * dsh-usage locale dictionaries (zh/en). The zh dictionary is the key source;
 * `en` mirrors its full key set (packages/AGENTS.md bilingual discipline).
 * @module @linxin666/dsh-usage/client/locales
 */

/** Dictionary namespace this package registers. */
export const NS = 'dsh-web-ui-usage'

/** Chinese copy. */
export const zh = {
  'usage.title': '使用统计',
  'usage.tab.usage': '用量',
  'usage.tab.plans': '个人套餐',
  'usage.tab.bank': 'Token 银行',
  'usage.refresh': '刷新',
  'usage.refreshing': '刷新中…',
  'usage.updated': '更新于 {time}',
  'usage.loading': '正在读取用量…',
  'usage.error': '加载失败：{error}',
  'usage.disabled': '已停用，打开开关继续统计。',
  'usage.current': '当前',
  'usage.today': '今日用量',
  'usage.today.cost': '今日消费（估算）',
  'usage.day.label': '查看日期',
  'usage.day.today': '今日',
  'usage.day.title': '{date} 用量',
  'usage.day.cost': '当日消费（估算）',
  'usage.day.empty': '该日没有用量记录',
  'usage.day.loading': '正在加载该日用量…',
  'usage.day.error': '该日用量加载失败：{error}',
  'usage.peak.on': 'DeepSeek 高峰时段：计价 ×2，{time} 结束',
  'usage.peak.off': 'DeepSeek 空闲时段：计价为高峰一半，{time} 进入高峰',
  'usage.peak.tag.on': '高峰',
  'usage.peak.tag.off': '空闲',
  'usage.peak.ends': '{time} 结束',
  'usage.peak.starts': '{time} 进入高峰',
  'usage.calls': '{n} 次调用',
  'usage.tokens.total': '总 tokens',
  'usage.tokens.input': '输入',
  'usage.tokens.output': '输出',
  'usage.tokens.cacheRead': '缓存读',
  'usage.tokens.cacheWrite': '缓存写',
  'usage.trend': '近 30 天',
  'usage.noData': '还没有用量，插件启用后开始统计。',
  'usage.balance': '余额',
  'usage.balance.unsupported': '不支持查询余额',
  'usage.balance.noCredential': '未配置凭据',
  'usage.balance.noneConfigured': '还没有配置提供方',
  'usage.oauth': 'OAuth 凭据，不查余额',
  'usage.plan.reset': '{date} 重置',
  'usage.plan.noPlan': '没有读到套餐数据',
  'usage.plan.noneConfigured': '没有配置套餐类提供方，例如 Kimi、GLM、OpenCode Go、MiniMax、Codex 订阅。',
  'usage.plan.windows.5h': '5 小时',
  'usage.plan.windows.week': '每周',
  'usage.plan.windows.month': '每月',
  'usage.provider.error': '查询失败：{error}',
  'usage.provider.openai-codex.name': 'Codex (ChatGPT 订阅)',
  'usage.errorListSeparator': '；',
  'usage.config.title': '设置',
  'usage.config.pollIntervalSec': '轮询间隔（秒）',
  'usage.config.spendCurrency': '货币',
  'usage.config.cnyPerUsd': '汇率',
  'usage.bank.title': '鲸元券',
  'usage.bank.hint': '每用掉 100 万 tokens 铸造 1 鲸元，可以保存或分享这张票券。',
  'usage.bank.noUsage': '暂无用量数据',
  'usage.bank.minted': '累计铸造 {minted} 鲸元（{tokens} tokens）',
  'usage.bank.spend.observed': '官方余额实测花费 {cost}（自 {since} 起）',
  'usage.bank.spend.estimated': '消费估算：约 {cost}',
  'usage.bank.window': '统计窗口 {from} ~ {to}',
  'usage.bank.windowAll': '全部保留期',
  'usage.bank.save': '保存图片',
  'usage.bank.share': '分享',
  'usage.bank.drawError': '票券生成失败：{error}',
  'usage.foot.cost': '今日消费',
  'usage.foot.noData': '今日暂无用量',
  'usage.foot.open': '打开使用统计设置',
  'usage.foot.collapse': '收起用量卡片',
  'usage.foot.expand': '展开用量卡片',
  'usage.description': '各提供方的用量、余额与套餐额度。',
  'usage.config.pollIntervalHint': '多久查一次余额与套餐。',
  'usage.config.spendCurrencyHint': '消费金额用这种货币显示。',
  'usage.config.cnyPerUsdHint': '1 美元折合多少人民币。',
  'settings.collapse': '收起',
  'settings.expand': '展开',
  'settings.notExposed': '这个版本的 DSH 没有开放使用统计的设置。',
  'settings.readOnly': '设置只读。',
  'settings.saveFailed': '没有保存成功。',
  'settings.inherit': '默认',
  'settings.overridden': '已修改',
  'settings.reset': '恢复默认',
  'settings.invalidNumber': '填一个数字，留空用默认值。',
}

/** English mirror; every zh key present. */
export const en: Record<UsageKey, string> = {
  'usage.title': 'Usage Statistics',
  'usage.tab.usage': 'Usage',
  'usage.tab.plans': 'Plans',
  'usage.tab.bank': 'Token Bank',
  'usage.refresh': 'Refresh',
  'usage.refreshing': 'Refreshing…',
  'usage.updated': 'Updated {time}',
  'usage.loading': 'Reading usage…',
  'usage.error': 'Failed to load: {error}',
  'usage.disabled': 'Turned off; flip the switch to resume.',
  'usage.current': 'Current',
  'usage.today': 'Today',
  'usage.today.cost': 'Today spend (estimated)',
  'usage.day.label': 'Day',
  'usage.day.today': 'Today',
  'usage.day.title': 'Usage · {date}',
  'usage.day.cost': 'Day spend (estimated)',
  'usage.day.empty': 'No usage recorded on this day',
  'usage.day.loading': 'Loading that day…',
  'usage.day.error': 'Failed to load that day: {error}',
  'usage.peak.on': 'DeepSeek peak hours: 2x pricing, ends {time}',
  'usage.peak.off': 'DeepSeek off-peak: half of peak pricing, peak returns {time}',
  'usage.peak.tag.on': 'Peak',
  'usage.peak.tag.off': 'Off-peak',
  'usage.peak.ends': 'ends {time}',
  'usage.peak.starts': 'peak at {time}',
  'usage.calls': '{n} calls',
  'usage.tokens.total': 'Total tokens',
  'usage.tokens.input': 'Input',
  'usage.tokens.output': 'Output',
  'usage.tokens.cacheRead': 'Cache read',
  'usage.tokens.cacheWrite': 'Cache write',
  'usage.trend': 'Last 30 days',
  'usage.noData': 'No usage yet; counting starts once the plugin is on.',
  'usage.balance': 'Balance',
  'usage.balance.unsupported': 'No balance query',
  'usage.balance.noCredential': 'No credential configured',
  'usage.balance.noneConfigured': 'No providers configured',
  'usage.oauth': 'OAuth credential, no balance query',
  'usage.plan.reset': 'resets {date}',
  'usage.plan.noPlan': 'No plan data',
  'usage.plan.noneConfigured': 'No plan provider configured, such as Kimi, GLM, OpenCode Go, MiniMax or a Codex subscription.',
  'usage.plan.windows.5h': '5 hours',
  'usage.plan.windows.week': 'Weekly',
  'usage.plan.windows.month': 'Monthly',
  'usage.provider.error': 'Query failed: {error}',
  'usage.provider.openai-codex.name': 'Codex (ChatGPT)',
  'usage.errorListSeparator': '; ',
  'usage.config.title': 'Settings',
  'usage.config.pollIntervalSec': 'Poll interval (seconds)',
  'usage.config.spendCurrency': 'Currency',
  'usage.config.cnyPerUsd': 'Exchange rate',
  'usage.bank.title': 'Whale-yuan voucher',
  'usage.bank.hint': 'Every million tokens mints one whale yuan; save or share the note.',
  'usage.bank.noUsage': 'No usage data yet',
  'usage.bank.minted': 'Minted {minted} whale yuan ({tokens} tokens)',
  'usage.bank.spend.observed': 'Spent {cost} observed on the official balance (watching since {since})',
  'usage.bank.spend.estimated': 'Estimated spend: about {cost}',
  'usage.bank.window': 'Window {from} - {to}',
  'usage.bank.windowAll': 'All retained days',
  'usage.bank.save': 'Save image',
  'usage.bank.share': 'Share',
  'usage.bank.drawError': 'Failed to render the voucher: {error}',
  'usage.foot.cost': 'Today spend',
  'usage.foot.noData': 'No usage yet today',
  'usage.foot.open': 'Open usage statistics settings',
  'usage.foot.collapse': 'Collapse the usage card',
  'usage.foot.expand': 'Expand the usage card',
  'usage.description': 'Usage, balances and plan quotas for each provider.',
  'usage.config.pollIntervalHint': 'How often balances and plans are read.',
  'usage.config.spendCurrencyHint': 'Spend figures show in this currency.',
  'usage.config.cnyPerUsdHint': 'Yuan per US dollar.',
  'settings.collapse': 'Collapse',
  'settings.expand': 'Expand',
  'settings.notExposed': 'This DSH version does not open the usage settings.',
  'settings.readOnly': 'Settings are read-only.',
  'settings.saveFailed': 'Not saved.',
  'settings.inherit': 'Default',
  'settings.overridden': 'Changed',
  'settings.reset': 'Reset',
  'settings.invalidNumber': 'Enter a number, or leave it empty for the default.',
}

export type UsageKey = keyof typeof zh

const PROVIDER_NAME_KEYS: Readonly<Record<string, UsageKey>> = {
  'openai-codex': 'usage.provider.openai-codex.name',
}

/**
 * Active dictionary, picked by the document language at call time. The
 * section resolves its copy the same tiny way the pet's DOM-injected surface
 * does (the settings section has no framework locale seat of its own).
 */
export function dictionary(): Record<UsageKey, string> {
  // Chinese keeps the Chinese table; every other UI language falls back to English.
  const lang = (typeof document !== 'undefined' && document.documentElement.lang !== '' ? document.documentElement.lang : 'zh').toLowerCase()
  return lang.startsWith('zh') ? zh : en
}

/** Resolve a provider's display name through the active dictionary when it has a key. */
export function providerDisplayName(providerId: string, fallback: string): string {
  const key = PROVIDER_NAME_KEYS[providerId]
  return key === undefined ? fallback : t(key)
}

/** Translate a key with optional `{name}` template params; missing keys degrade to the key. */
export function t(key: string, params?: Record<string, unknown>): string {
  let text: string = (dictionary() as Record<string, string>)[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-usage UI copy. */
    'dsh-web-ui-usage': UsageKey
  }
}
