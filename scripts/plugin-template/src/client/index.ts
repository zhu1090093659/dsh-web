/**
 * Browser-half entry for the __NAME__ plugin — runs inside the dsh web GUI.
 *
 * The GUI loads this half from the bundle at /plugins/ui-__NAME__/client.js
 * through window.__ModuleLoader__; the plugin context exposes the client
 * runtime services (sessions, workspaces, ui slots, ...). For a full example
 * of DOM injection, runtime wiring and React views, see task-board's
 * src/client/index.ts, or the skins in the dsh-skins repository.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Apply the browser half. */
export function apply(_ctx: Context): void {
  // TODO(__NAME__): browser-side behavior — runtime service wiring, DOM
  // slots, React views. A bare skeleton does nothing.
}
