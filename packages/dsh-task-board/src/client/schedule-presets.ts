/**
 * Shared scheduled-run presets for the schedule editors (the new-task dialog
 * and the task detail panel): cron expression → locale label.
 */
import type { TaskBoardKey } from './locales.ts'

/** Common scheduled-run presets (cron → locale label). */
export const SCHEDULE_PRESETS: ReadonlyArray<{ cron: string; label: TaskBoardKey }> = [
  { cron: '0 9 * * *', label: 'detail.schedule.preset.daily9' },
  { cron: '0 * * * *', label: 'detail.schedule.preset.hourly' },
  { cron: '*/10 * * * *', label: 'detail.schedule.preset.tenMin' },
  { cron: '0 9 * * 1', label: 'detail.schedule.preset.weeklyMon9' },
]
