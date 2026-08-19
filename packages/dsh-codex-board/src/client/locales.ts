/**
 * Codex-board copy: zh-first dictionaries with an English fallback, selected
 * by the document language through the dsh locale service.
 */

/** Dictionary namespace this package registers. */
export const NS = 'codex-board'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'board.title': '任务',
  'board.count': '{completed}/{total}',
  'board.ratio': '{percent}%',
  'board.collapse': '折叠看板',
  'board.expand': '展开看板',
  'board.empty': '暂无任务',
  'board.status.pending': '待办',
  'board.status.in_progress': '进行中',
  'board.status.completed': '已完成',
  'board.sr.status': '状态：{status}',
  'board.sr.progress': '已完成 {completed} 项，共 {total} 项',
  'board.active': '当前任务',
  'board.reset': '重置位置',
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'board.title': 'Tasks',
  'board.count': '{completed}/{total}',
  'board.ratio': '{percent}%',
  'board.collapse': 'Collapse board',
  'board.expand': 'Expand board',
  'board.empty': 'No tasks yet',
  'board.status.pending': 'Pending',
  'board.status.in_progress': 'In progress',
  'board.status.completed': 'Completed',
  'board.sr.status': 'Status: {status}',
  'board.sr.progress': '{completed} of {total} tasks completed',
  'board.active': 'Active task',
  'board.reset': 'Reset position',
}

/** Locale key set for typing. */
export type CodexBoardKey = keyof typeof zh
