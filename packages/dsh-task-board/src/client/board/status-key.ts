import type { TaskStatus } from '../../core/tasks.ts'
import type { TaskBoardKey } from '../locales.ts'

/** Task status → locale key (board column titles and the detail badge). */
export const STATUS_KEY: Record<TaskStatus, TaskBoardKey> = {
  backlog: 'board.status.backlog',
  todo: 'board.status.todo',
  running: 'board.status.running',
  done: 'board.status.done',
  failed: 'board.status.failed',
}
