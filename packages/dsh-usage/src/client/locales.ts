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
  'usage.loading': '正在加载用量数据…',
  'usage.error': '加载失败：{error}',
  'usage.disabled': '插件已停用：勾选下方「启用插件」即可恢复统计。',
  'usage.current': '当前',
  'usage.today': '今日用量',
  'usage.today.cost': '今日消费（估算）',
  'usage.peak.on': 'DeepSeek 高峰时段：计价 ×2，{time} 结束',
  'usage.peak.off': 'DeepSeek 空闲时段：计价为高峰一半，{time} 进入高峰',
  'usage.calls': '{n} 次调用',
  'usage.tokens.total': '总 tokens',
  'usage.tokens.input': '输入',
  'usage.tokens.output': '输出',
  'usage.tokens.cacheRead': '缓存读',
  'usage.tokens.cacheWrite': '缓存写',
  'usage.trend': '近 30 天',
  'usage.noData': '暂无用量数据（统计自插件启用起）',
  'usage.balance': '余额',
  'usage.balance.unsupported': '暂不支持余额查询',
  'usage.balance.noCredential': '未配置凭据',
  'usage.balance.noneConfigured': '没有已配置的提供方',
  'usage.oauth': 'OAuth 凭据，不做余额查询',
  'usage.plan.reset': '{date} 重置',
  'usage.plan.noPlan': '未检测到套餐数据',
  'usage.plan.noneConfigured': '没有已配置的套餐类 provider（如 Kimi、GLM、OpenCode Go、MiniMax、Codex 订阅）',
  'usage.plan.windows.5h': '5 小时',
  'usage.plan.windows.week': '每周',
  'usage.plan.windows.month': '每月',
  'usage.provider.error': '查询失败：{error}',
  'usage.errorListSeparator': '；',
  'usage.config.title': '设置',
  'usage.config.enabled': '启用插件',
  'usage.config.pollIntervalSec': '轮询间隔（秒）',
  'usage.config.saveFailed': '保存失败：设置未被接受。',
  'usage.bank.title': '鲸元券',
  'usage.bank.hint': '官方 API 每消耗 100 万 tokens 铸造 1 鲸元；保存或分享这张票券。',
  'usage.bank.noUsage': '暂无 DeepSeek 官方用量数据（统计自插件启用起）',
  'usage.bank.minted': '累计铸造 {minted} 鲸元（{tokens} tokens）',
  'usage.bank.spend.observed': '官方余额实测花费 ¥{cost}（自 {since} 起）',
  'usage.bank.spend.estimated': '消费估算：约 ¥{cost}',
  'usage.bank.window': '统计窗口 {from} ~ {to}',
  'usage.bank.save': '保存图片',
  'usage.bank.share': '分享',
  'usage.bank.drawError': '票券生成失败：{error}',
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
  'usage.loading': 'Loading usage data…',
  'usage.error': 'Failed to load: {error}',
  'usage.disabled': 'Plugin disabled. Tick "Enable plugin" below to resume statistics.',
  'usage.current': 'Current',
  'usage.today': 'Today',
  'usage.today.cost': 'Today spend (estimated)',
  'usage.peak.on': 'DeepSeek peak hours: 2x pricing, ends {time}',
  'usage.peak.off': 'DeepSeek off-peak: half of peak pricing, peak returns {time}',
  'usage.calls': '{n} calls',
  'usage.tokens.total': 'Total tokens',
  'usage.tokens.input': 'Input',
  'usage.tokens.output': 'Output',
  'usage.tokens.cacheRead': 'Cache read',
  'usage.tokens.cacheWrite': 'Cache write',
  'usage.trend': 'Last 30 days',
  'usage.noData': 'No usage data yet (counting starts when the plugin is enabled)',
  'usage.balance': 'Balance',
  'usage.balance.unsupported': 'Balance query not supported',
  'usage.balance.noCredential': 'No credential configured',
  'usage.balance.noneConfigured': 'No providers configured',
  'usage.oauth': 'OAuth credential, no balance query',
  'usage.plan.reset': 'resets {date}',
  'usage.plan.noPlan': 'No plan data detected',
  'usage.plan.noneConfigured': 'No plan-capable provider configured (such as Kimi, GLM, OpenCode Go, MiniMax, Codex subscription)',
  'usage.plan.windows.5h': '5 hours',
  'usage.plan.windows.week': 'Weekly',
  'usage.plan.windows.month': 'Monthly',
  'usage.provider.error': 'Query failed: {error}',
  'usage.errorListSeparator': '; ',
  'usage.config.title': 'Settings',
  'usage.config.enabled': 'Enable plugin',
  'usage.config.pollIntervalSec': 'Poll interval (seconds)',
  'usage.config.saveFailed': 'Save failed: the deployment did not accept the setting.',
  'usage.bank.title': 'Whale-yuan voucher',
  'usage.bank.hint': 'Every 1,000,000 tokens spent on the official API mint one whale yuan; save or share the note.',
  'usage.bank.noUsage': 'No official DeepSeek usage yet (counting starts when the plugin is enabled)',
  'usage.bank.minted': 'Minted {minted} whale yuan ({tokens} tokens)',
  'usage.bank.spend.observed': 'Spent ¥{cost} observed on the official balance (watching since {since})',
  'usage.bank.spend.estimated': 'Estimated spend: about ¥{cost}',
  'usage.bank.window': 'Window {from} - {to}',
  'usage.bank.save': 'Save image',
  'usage.bank.share': 'Share',
  'usage.bank.drawError': 'Failed to render the voucher: {error}',
}

export type UsageKey = keyof typeof zh

/**
 * Active dictionary, picked by the document language at call time. The
 * section resolves its copy the same tiny way the pet's DOM-injected surface
 * does (the settings section has no framework locale seat of its own).
 */
export function dictionary(): Record<UsageKey, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
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
