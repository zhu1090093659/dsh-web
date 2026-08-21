/**
 * Locale dictionaries for the session-id plugin. `zh` is the key-set source of
 * truth; `en` keeps a full key-for-key mirror (packages/AGENTS.md bilingual
 * rules). Registered through ctx.locale.register(NS, { zh, en }).
 */

/** Simplified Chinese dictionary (key-set source of truth). */
export const zh = {
  'entry.label': '会话 ID',
  'panel.title': '会话 ID',
  'panel.empty': '暂无会话',
  'panel.noMatches': '无匹配会话',
  'panel.search.placeholder': '搜索标题或 ID…',
  'panel.search.aria': '搜索会话',
  'panel.close': '关闭',
  'panel.copy': '复制',
  'panel.copied': '已复制',
  'panel.copyFailed': '复制失败，请重试',
  'panel.current': '当前',
  'panel.updatedAt': '更新于 {t}',
  'panel.time.now': '刚刚',
  'panel.time.minutes': '{n} 分钟前',
  'panel.time.hours': '{n} 小时前',
  'panel.time.days': '{n} 天前',
}

/** The session-id namespace key union. */
export type SessionIdKey = keyof typeof zh

/** English dictionary, key-for-key complete against zh. */
export const en: Record<SessionIdKey, string> = {
  'entry.label': 'Session ID',
  'panel.title': 'Session IDs',
  'panel.empty': 'No sessions',
  'panel.noMatches': 'No matching sessions',
  'panel.search.placeholder': 'Search title or ID…',
  'panel.search.aria': 'Search sessions',
  'panel.close': 'Close',
  'panel.copy': 'Copy',
  'panel.copied': 'Copied',
  'panel.copyFailed': 'Copy failed, retry',
  'panel.current': 'Current',
  'panel.updatedAt': 'Updated {t}',
  'panel.time.now': 'just now',
  'panel.time.minutes': '{n}m ago',
  'panel.time.hours': '{n}h ago',
  'panel.time.days': '{n}d ago',
}