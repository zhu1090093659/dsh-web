import * as os from 'node:os'
import * as path from 'node:path'
import * as vite from 'vite'

const isWindows = os.platform() == 'win32'

export type NormalizedPath = string & { __normalized: true }

export const normalize = (p: string): NormalizedPath => {
  let output = vite.normalizePath(p)
  // Normalize the drive letter casing on Windows to upper case,
  if (isWindows && output[1] === ':') {
    output = output[0].toUpperCase() + output.substring(1)
  }
  return output as NormalizedPath
}

export const parse: (p: NormalizedPath) => {
  root: NormalizedPath
} = path.parse as any

export const resolve = isWindows
  ? (...paths: string[]) => normalize(path.win32.resolve(...paths))
  : (path.posix.resolve as (...paths: string[]) => NormalizedPath)

export const isAbsolute = isWindows
  ? path.win32.isAbsolute
  : path.posix.isAbsolute

/** Only call this on normalized paths */
export const join = path.posix.join as (
  ...paths: NormalizedPath[]
) => NormalizedPath

/** Only call this on normalized paths */
export const relative = path.posix.relative as (
  from: NormalizedPath,
  to: NormalizedPath
) => NormalizedPath

/** Only call this on normalized paths */
export const basename = path.posix.basename as (
  path: NormalizedPath,
  suffix?: string
) => NormalizedPath

/** Only call this on normalized paths */
export const dirname = path.dirname as (p: NormalizedPath) => NormalizedPath

export const relativeImportRE = /^\.\.?(\/|$)/
