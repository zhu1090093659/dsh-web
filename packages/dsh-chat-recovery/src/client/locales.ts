/**
 * chat-recovery UI copy. The zh dictionary is the key source; the en side
 * must carry the exact same key set (typed against it below).
 */

export const zh = {
  'edit.button': '编辑',
  'edit.hint': '保存后从此消息之前的位置创建分支并重新生成，原会话历史保留。',
  'edit.cancel': '取消',
  'edit.save': '保存并重新生成',
  'edit.saving': '正在创建分支…',
  'edit.failed': '保存失败：{reason}',
  'retry.button': '重试',
  'retry.cancel': '取消重试',
  'retry.retryNow': '立即重试',
  'retry.waiting': '自动重试 {attempt}/{max}，约 {seconds}s 后',
  'retry.running': '自动重试 {attempt}/{max} 进行中…',
  'retry.manualRunning': '正在重试…',
  'retry.failed': '重试未通过：{reason}',
  'retry.exhausted': '已重试 {max} 次仍失败：{reason}',
  'retry.manualRetry': '手动重试',
  'retry.forkHint': '重试会从失败消息之前创建新的会话分支，后续尝试在该分支内重跑；原会话保持不变，失败的分支会保留在会话列表中。',
} as const

export type ChatRecoveryKey = keyof typeof zh

export const en: Record<ChatRecoveryKey, string> = {
  'edit.button': 'Edit',
  'edit.hint': 'Saving forks a new branch from before this message and regenerates; the original conversation is preserved.',
  'edit.cancel': 'Cancel',
  'edit.save': 'Save and regenerate',
  'edit.saving': 'Creating branch…',
  'edit.failed': 'Save failed: {reason}',
  'retry.button': 'Retry',
  'retry.cancel': 'Cancel retry',
  'retry.retryNow': 'Retry now',
  'retry.waiting': 'Auto-retry {attempt}/{max} in about {seconds}s',
  'retry.running': 'Auto-retry {attempt}/{max} in progress…',
  'retry.manualRunning': 'Retrying…',
  'retry.failed': 'Retry failed: {reason}',
  'retry.exhausted': 'Still failing after {max} retries: {reason}',
  'retry.manualRetry': 'Retry manually',
  'retry.forkHint': 'Retry forks a new session from before the failed message and keeps retrying inside it; the original stays untouched and failed forks remain in the session list.',
}
