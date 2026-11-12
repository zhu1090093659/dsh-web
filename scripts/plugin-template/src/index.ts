/**
 * Host loader entry for the __NAME__ plugin — runs in the DSH host process.
 *
 * The host half is a cordis plugin loaded from the profile composition via
 * the row in cordis.patch.yml (id ui-__NAME__). Most GUI plugins have no host
 * behavior beyond a system-prompt announcement: see task-board's src/index.ts,
 * which registers a SystemPrompt.section so every agent knows the plugin
 * exists. The actual UI lives in the browser half (src/client.ts).
 */
import type { Context } from '@deepseek-ai/cordis'

/** Apply the host half. */
export function apply(_ctx: Context): void {
  // TODO(__NAME__): host-side behavior, e.g.
  //   _ctx.systemPrompt.section({ name: 'plugin:__NAME__', order: 200, text: '...' })
  // A pure browser plugin needs nothing here.
}
