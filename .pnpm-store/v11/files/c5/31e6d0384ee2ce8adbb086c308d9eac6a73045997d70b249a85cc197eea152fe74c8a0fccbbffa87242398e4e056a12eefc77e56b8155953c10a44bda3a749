import { createWriteStream, statSync, writeFileSync } from 'node:fs'
import { debug } from './debug'

type ImportDetails = { importer: string | undefined; id: string }
type ConfigDetails = ImportDetails & { configPath: string }
type ResolveDetails = ConfigDetails & { resolvedId: string }
type NotFoundDetails = ConfigDetails & { candidates: string[] | null }

export type LogEvent =
  | ['emptyImporter', ImportDetails]
  | ['virtualImporter', ImportDetails]
  | ['unsupportedExtension', ImportDetails]
  | ['relativeId', ImportDetails]
  | ['virtualId', ImportDetails]
  | ['resolvedToDeclarationFile', ResolveDetails]
  | ['resolvedWithBaseUrl', ResolveDetails]
  | ['resolvedWithPaths', ResolveDetails]
  | ['resolvedFromCache', ResolveDetails]
  | ['notFound', NotFoundDetails]
  | ['configMismatch', ConfigDetails]

/**
 * This log file is dedicated to the resolution process. Other debug logs
 * will appear in the console if you set `DEBUG=vite-tsconfig-paths` in
 * your shell environment.
 */
export function createLogFile(logFilePath: string) {
  let mtime: number | undefined
  try {
    mtime = statSync(logFilePath).mtime.getTime()
  } catch {}

  // Clear the log file if it's older than 10 seconds.
  if (!mtime || Date.now() - mtime > 10_000) {
    debug('Clearing log file:', logFilePath)
    writeFileSync(logFilePath, '')
  }

  const logFile = createWriteStream(logFilePath, {
    flags: 'a',
    encoding: 'utf-8',
  })

  return {
    write(...event: LogEvent) {
      logFile.write(event[0] + ': ' + JSON.stringify(event[1]) + '\n')
    },
  }
}

export type LogFileWriter = ReturnType<typeof createLogFile>
