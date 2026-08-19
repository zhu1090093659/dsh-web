/**
 * Host loader entry for the codex-board plugin — runs in the DSH host process.
 *
 * The host half is a cordis plugin loaded from the profile composition via
 * the row in cordis.patch.yml (id ui-codex-board). It registers a
 * SystemPrompt section so every agent knows the floating board mirrors its
 * `todo_write` calls: keeping the todo list current keeps the board useful.
 * The actual UI lives in the browser half (src/client/index.ts).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Required services. */
export const inject = ['systemPrompt']

/** Apply the host half: announce the plugin in the system prompt. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'plugin:codex-board',
    order: 200,
    text: '本机已安装 dsh-codex-board 插件（DSH Web GUI 的 Codex 风格悬浮任务看板）：固定在右上角，实时镜像当前会话的 todo_write 任务列表（标题 完成数/总数 + 进度条，每行 pending/in_progress/completed 三态标记，可折叠）。请保持 todo 列表准确（任务状态随进度更新），让看板如实反映执行进度。用户提到「悬浮看板 / 任务进度 / codex 看板」时即指本插件。',
  })
}
