/**
 * Standalone import runner: built as lib/better-session-import.mjs next to
 * the node half and used two ways — spawned by the host half (so hundreds of
 * log decodes never block the server event loop) and imported directly by the
 * maintenance CLI. Options arrive via DSH_IMPORT_OPTIONS when spawned; the
 * JSON summary lands on stdout and a non-zero exit surfaces failed sessions.
 * @module better-session-manager/import-worker-entry
 */
import { runImport } from './migration-run.ts'

export {
  backupStore,
  discoverLegacySessions,
  runImport,
} from './migration-run.ts'

export {
  decodeZstdLog,
  encodeSessionLog,
  parseSessionLog,
  zstdFrameEnd,
} from './legacy-log.ts'

export {
  eventDimensions,
  ForeignStoreError,
  insertSession,
  isPersistedEvent,
  openStore,
  projectPersistedEvents,
  SCHEMA_VERSION,
  SQLITE_APPLICATION_ID,
} from './migration-core.ts'

export {
  applyManagedBlock,
  BLOCK_BEGIN,
  BLOCK_END,
  deriveMountState,
  ENABLE_BLOCK_BODY,
  HARNESS_ROW_ID,
  hasDisabledOverride,
  MANAGED_INSERT_IDS,
  OVERRIDE_TARGET_IDS,
} from './profile-blocks.ts'

const spawnedOptions = process.env.DSH_IMPORT_OPTIONS

if (spawnedOptions !== undefined) {
  try {
    const options = JSON.parse(spawnedOptions) as {
      sessionsDir: string
      dbPath: string
      apply?: boolean
      createStore?: boolean
      includeEmpty?: boolean
      projectFilter?: string
      limit?: number
    }
    const summary = runImport({
      sessionsDir: options.sessionsDir,
      dbPath: options.dbPath,
      apply: options.apply === true,
      createStore: options.createStore === true,
      includeEmpty: options.includeEmpty === true,
      projectFilter: options.projectFilter,
      limit: options.limit !== undefined ? Number(options.limit) : undefined,
    })
    process.stdout.write(JSON.stringify(summary) + '\n')
    if (summary.failed > 0) process.exitCode = 1
  } catch (error) {
    console.error(`[better-session-import] ${(error as Error).message}`)
    process.exitCode = 1
  }
}
