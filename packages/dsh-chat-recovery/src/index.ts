/**
 * Host loader entry for the dsh-chat-recovery plugin — runs in the DSH host
 * process. The plugin is browser-only: the row in cordis.patch.yml mounts
 * this no-op half so the loader sees a real cordis plugin, while the actual
 * UI lives in the browser half (src/client).
 */
import type { Context } from '@deepseek-ai/cordis'

/** Apply the host half (no host behavior for this plugin). */
export function apply(_ctx: Context): void {}
