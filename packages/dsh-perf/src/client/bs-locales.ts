/**
 * Locale strings for the Better Session section (zh source of truth, en
 * mirror). The section renders inside the dsh-perf settings card, so its
 * copy registers into the same dsh-perf dictionary under "bsm."-prefixed
 * keys instead of owning a locale namespace.
 * Copy declares the external origin and carries the storage-switch warnings;
 * see packages/dsh-web-all README for the long-form pros/cons.
 * @module @linxin666/dsh-perf/client/bs-locales
 */

const zh = {
  'settings.title': 'Better Session（分支式会话编辑）',
  'settings.description': '第三方外部插件 @morlay/better-session：就地编辑历史消息并重新生成、失败回合一键重试，支持回退与 fork。本节负责它的启用开关与旧会话迁移。',
  'settings.sourcePrefix': '本功能由外部第三方插件',
  'settings.sourceSuffix': '提供，非本仓库出品；许可证为 MIT。',
  'state.inactive': '未启用（官方 jsonl 存储）',
  'state.enabled': '已启用（SQLite 存储）',
  'state.enabledBundle': '已启用（聚合层直接挂载）',
  'state.unknown': '状态未知：未找到聚合清单，请从仓库 checkout 或安装目录访问。',
  'field.upstream': '上游项目',
  'action.enable': '启用并自动迁移',
  'action.disable': '停用并切回 jsonl',
  'action.working': '处理中…',
  'warn.enableTitle': '确认启用 Better Session？',
  'warn.enableBody': '将执行以下动作：1) 自动把旧的 jsonl 会话导入 SQLite 库（自动备份现有库）；2) 切换持久层到 SQLite——此后新会话只写入 SQLite，jsonl 不再有新内容；3) 立即生效无需重启宿主，但已打开的页面建议刷新一次。迁移期间产生的会话不会被包含，可在稍后重跑导入补齐。',
  'warn.disableTitle': '确认停用 Better Session？',
  'warn.disableBody': '切换回 jsonl 存储后，启用期间创建的 SQLite 会话将不在列表中显示（数据保留在库文件中）。',
  'notice.done': '完成：已导入 {imported} 个会话，失败 {failed} 个。页面刷新后生效。',
  'notice.disabled': '已停用，持久层回到官方 jsonl。页面刷新后生效。',
  'notice.failed': '操作失败：{error}',
  'label.migrating': '正在迁移旧会话…（过程中请勿关闭 DSH）',
  'label.storeCount': '当前 SQLite 库：{sessions} 会话 / {events} 事件',
  'label.legacyCount': '旧 jsonl 会话：共 {total} 个（跨 {projects} 个项目）',
  'dialog.confirm': '确认执行',
  'dialog.cancel': '取消',
} as const

export type BsmRawKey = keyof typeof zh

/** Runtime keys carry the "bsm." prefix inside the shared dsh-perf dictionary. */
export type BetterSessionKey = `bsm.${BsmRawKey & string}`

const en: Record<BsmRawKey, string> = {
  'settings.title': 'Better Session (branching session editing)',
  'settings.description': 'Third-party external plugin @morlay/better-session: edit past messages in place, retry failed turns, rewind and fork. This section owns its enable switch and the legacy session migration.',
  'settings.sourcePrefix': 'Provided by the external third-party plugin ',
  'settings.sourceSuffix': ' — not authored in this repository; MIT licensed.',
  'state.inactive': 'Inactive (stock jsonl storage)',
  'state.enabled': 'Enabled (SQLite storage)',
  'state.enabledBundle': 'Enabled (mounted by the bundle)',
  'state.unknown': 'Posture unknown: aggregate artifact not reachable; open from a repo checkout or installed tree.',
  'field.upstream': 'Upstream project',
  'action.enable': 'Enable with automatic migration',
  'action.disable': 'Disable and return to jsonl',
  'action.working': 'Working…',
  'warn.enableTitle': 'Enable Better Session?',
  'warn.enableBody': 'This will: 1) import legacy jsonl sessions into the SQLite store (existing store auto-backed up); 2) switch persistence to SQLite — new sessions land there and jsonl stops growing; 3) apply live without a host restart, though open tabs should refresh once. Sessions created during the import are not included; rerun the import later to catch up.',
  'warn.disableTitle': 'Disable Better Session?',
  'warn.disableBody': 'After switching back to jsonl, sessions created under SQLite disappear from the list (their data stays in the store file).',
  'notice.done': 'Done: imported {imported} sessions, {failed} failed. Refresh this page to see the switch.',
  'notice.disabled': 'Disabled; persistence is back on stock jsonl. Refresh this page to see the switch.',
  'notice.failed': 'Operation failed: {error}',
  'label.migrating': 'Migrating legacy sessions… (keep DSH running)',
  'label.storeCount': 'SQLite store: {sessions} sessions / {events} events',
  'label.legacyCount': 'Legacy jsonl sessions: {total} across {projects} projects',
  'dialog.confirm': 'Confirm',
  'dialog.cancel': 'Cancel',
}

const prefixDict = (dict: Record<BsmRawKey, string>): Record<BetterSessionKey, string> =>
  Object.fromEntries(Object.entries(dict).map(([key, value]) => [`bsm.${key}`, value])) as Record<BetterSessionKey, string>

export const dictionaries: Record<'zh' | 'en', Record<BetterSessionKey, string>> = {
  zh: prefixDict(zh),
  en: prefixDict(en),
}
