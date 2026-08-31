/**
 * Host loader entry for the dsh-i18n plugin — runs in the DSH host process.
 *
 * This is a pure browser plugin: it only extends the Web GUI's locale catalog
 * with the Русский language and registers the ru dictionaries for the family
 * plugin namespaces. The host half intentionally has no behavior; the
 * registration lives in the browser half (src/client).
 */
import type { Context } from '@deepseek-ai/cordis'

/** Apply the host half (no-op for a pure browser plugin). */
export function apply(_ctx: Context): void {
  // Intentionally empty: this plugin has no host behavior.
}
