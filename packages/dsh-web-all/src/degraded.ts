/**
 * Degradation ledger for the dsh-web-all shell. One record per family plugin
 * that failed to import, start, or lost its fiber after activation. The shell
 * writes it; doctor and the plugin manager read it to surface "this plugin is
 * degraded, the rest of the Web is healthy" instead of relying on log scraping.
 */
export interface DegradedRecord {
  /** Real plugin package name from the shell row config. */
  plugin: string
  /** Where the failure happened: module import, plugin shape, or fiber start. */
  stage: 'import' | 'shape' | 'start'
  /** Failure message (stack when available). */
  message: string
  /** ISO timestamp of the most recent failure for this plugin. */
  at: string
}

const degraded = new Map<string, DegradedRecord>()

/** Record (or refresh) one plugin's degraded state. Errors are logged here once. */
export function recordDegraded(plugin: string, stage: DegradedRecord['stage'], error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(`[dsh-web-all] plugin degraded (${stage}): ${plugin}\n${message}`)
  degraded.set(plugin, { plugin, stage, message, at: new Date().toISOString() })
}

/** Clear one plugin's degraded record (successful start after a retry/HMR reload). */
export function clearDegraded(plugin: string): void {
  degraded.delete(plugin)
}

/** Snapshot of all currently degraded plugins. */
export function listDegraded(): DegradedRecord[] {
  return [...degraded.values()]
}