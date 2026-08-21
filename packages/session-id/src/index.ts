/**
 * Host loader entry for the session-id plugin — runs in the DSH host process.
 *
 * This is a pure browser plugin: it only renders the sidebar-foot trigger and
 * the session-id panel from data already served by the host (the sessions list
 * RPC). The host half intentionally has no behavior; the actual UI lives in
 * the browser half (src/client).
 */
import type { Context } from '@deepseek-ai/cordis'

/** Apply the host half (no-op for a pure browser plugin). */
export function apply(_ctx: Context): void {
  // Intentionally empty: this plugin has no host behavior.
}
