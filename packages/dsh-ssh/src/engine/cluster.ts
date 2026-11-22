/**
 * Cluster execution: run one command concurrently across selected hosts; the
 * caller must provide at least one non-empty aliases / environment / tags filter.
 */

import type { ClusterResult } from '../protocol.ts'
import { execCommand, type PoolEngine } from './connection-pool.ts'

/** Target selector fields shared by cluster engine, routes, and agent tool. */
export interface ClusterSelector {
  aliases?: string[]
  environment?: string
  tags?: string[]
}

function normalizeStringList(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined
  return values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => value !== '')
}

/** Whether at least one trimmed non-empty cluster target filter is present. */
export function hasClusterSelector(options: ClusterSelector): boolean {
  const aliases = normalizeStringList(options.aliases)
  if (aliases !== undefined && aliases.length > 0) return true
  if (typeof options.environment === 'string' && options.environment.trim() !== '') return true
  const tags = normalizeStringList(options.tags)
  return tags !== undefined && tags.length > 0
}

interface ClusterOptions extends ClusterSelector {
  command: string
  timeoutMs?: number
  maxWorkers?: number
  /** Caller cancellation, forwarded to every host's command. */
  signal?: AbortSignal
}

/** Run one command against many hosts concurrently. */
export async function cluster(engine: PoolEngine, options: ClusterOptions): Promise<ClusterResult[]> {
  const aliases = normalizeStringList(options.aliases)
  const environment = typeof options.environment === 'string' && options.environment.trim() !== ''
    ? options.environment.trim()
    : undefined
  const tags = normalizeStringList(options.tags)
  if (!hasClusterSelector({ aliases, environment, tags })) {
    throw new Error('ssh_cluster requires aliases, environment, or tags to limit the target set')
  }

  let targets = engine.store.list()
  if (aliases !== undefined && aliases.length > 0) {
    targets = targets.filter(entry => aliases.includes(entry.alias))
  }
  if (environment !== undefined) {
    targets = targets.filter(entry => entry.environment === environment)
  }
  if (tags !== undefined && tags.length > 0) {
    // ALL semantics (matches the ssh_cluster tool description).
    targets = targets.filter(entry => tags.every(tag => entry.tags.includes(tag)))
  }
  if (targets.length === 0) return []
  if (options.maxWorkers !== undefined && (!Number.isInteger(options.maxWorkers) || options.maxWorkers < 1)) {
    throw new Error('maxWorkers must be a positive integer')
  }
  const workers = Math.min(engine.opts.defaultMaxWorkers, options.maxWorkers ?? engine.opts.defaultMaxWorkers, targets.length)
  const results: ClusterResult[] = []
  const queue = [...targets]
  const run = async (): Promise<void> => {
    while (queue.length > 0) {
      const entry = queue.shift()!
      try {
        const result = await execCommand(engine, entry.alias, options.command, options.timeoutMs, options.signal)
        results.push({
          alias: entry.alias,
          ok: result.success,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: result.durationMs,
          ...(result.error !== undefined ? { error: result.error } : {}),
        })
      } catch (error) {
        results.push({ alias: entry.alias, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, () => run()))
  return results
}