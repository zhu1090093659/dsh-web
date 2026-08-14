/**
 * Locale dictionaries for the beyond-workscope card (zh default, en mirror).
 * zh is the key source; en is enforced to mirror every key.
 */

export const zh = {
  'card.title': '越界授权请求',
  'card.badge': '工作区之外',
  'card.kind.grant': '授权',
  'card.kind.workspace': '工作区',
  'card.workspace.hint': '注册为工作区后，可在 GUI 工作区列表切换，新建会话即以该目录为工作区',
  'card.scope.read': '只读',
  'card.scope.write': '读写',
  'card.reason.label': '原因',
  'card.by': '由',
  'card.expires': '{s} 秒后自动拒绝',
  'card.expiresSoon': '即将超时！',
  'card.approve': '允许',
  'card.deny': '拒绝',
  'card.manage': '授权管理',
  'card.manage.open': '查看管理',
  'card.manage.close': '收起',
  'card.manage.active': '活跃授权',
  'card.manage.empty': '当前没有活跃授权',
  'card.manage.revoke': '撤销',
  'card.manage.workspaces': '已注册工作区',
  'card.manage.workspaces.empty': '暂无注册的工作区',
  'card.manage.removeWorkspace': '移除',
  'card.manage.audit': '最近审计',
  'card.manage.audit.empty': '暂无审计记录',
  'card.error.load': '加载失败',
  'card.offline': '连接中…',
  'card.unknown': '未知',
}

/** The dictionary shape (zh is the source of truth). */
export type BeyondKey = typeof zh

/** English mirror — every key enforced at compile time. */
export const en: Record<keyof BeyondKey, string> = {
  'card.title': 'Beyond-workscope grant',
  'card.badge': 'outside workspace',
  'card.kind.grant': 'grant',
  'card.kind.workspace': 'workspace',
  'card.workspace.hint': 'After registration, switch to it in the GUI workspace list — new conversations there run with this directory as their workspace',
  'card.scope.read': 'read',
  'card.scope.write': 'read+write',
  'card.reason.label': 'Reason',
  'card.by': 'by',
  'card.expires': 'auto-denies in {s}s',
  'card.expiresSoon': 'expiring!',
  'card.approve': 'Allow',
  'card.deny': 'Deny',
  'card.manage': 'Grant manager',
  'card.manage.open': 'Manage',
  'card.manage.close': 'Collapse',
  'card.manage.active': 'Active grants',
  'card.manage.empty': 'No active grants',
  'card.manage.revoke': 'Revoke',
  'card.manage.workspaces': 'Registered workspaces',
  'card.manage.workspaces.empty': 'No registered workspaces',
  'card.manage.removeWorkspace': 'Remove',
  'card.manage.audit': 'Recent audit',
  'card.manage.audit.empty': 'No audit entries',
  'card.error.load': 'Load failed',
  'card.offline': 'connecting…',
  'card.unknown': 'unknown',
}
