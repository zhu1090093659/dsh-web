/**
 * Locate a Playwright Chromium executable for the headless capture backend.
 * Pure filesystem probing with injectable base paths (tests use temp dirs).
 * @module @linxin666/dsh-page-annotate/screenshot/resolve-chromium
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Candidate executable names per platform inside a revision dir. */
const CANDIDATES: ReadonlyArray<readonly string[]> = [
  ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
  ['chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
  ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ['chrome-linux', 'chrome'],
  ['chrome-win', 'chrome.exe'],
]

/** The default Playwright browsers cache directory for this OS. */
export function defaultBrowsersPath(platform = process.platform, home = process.env.HOME): string | undefined {
  if (platform === 'darwin') return home === undefined ? undefined : join(home, 'Library', 'Caches', 'ms-playwright')
  if (platform === 'linux') return process.env.XDG_CACHE_HOME === undefined
    ? (home === undefined ? undefined : join(home, '.cache', 'ms-playwright'))
    : join(process.env.XDG_CACHE_HOME, 'ms-playwright')
  if (platform === 'win32') return process.env.LOCALAPPDATA === undefined
    ? undefined
    : join(process.env.LOCALAPPDATA, 'ms-playwright')
  return undefined
}

/** List revision directories (chromium-*) inside a browsers cache root. */
export function listRevisionDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => revisionOf(a) - revisionOf(b))
  } catch {
    return []
  }
}

function revisionOf(name: string): number {
  const match = /^chromium-(\d+)$/.exec(name)
  return match === null ? 0 : Number(match[1])
}

/** Find the executable inside one revision dir, or undefined. */
export function executableInRevision(root: string, revision: string): string | undefined {
  for (const parts of CANDIDATES) {
    const candidate = join(root, revision, ...parts)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Resolve a usable Chromium executable path.
 * Priority: DSH_PAGE_ANNOTATE_CHROMIUM env, PLAYWRIGHT_BROWSERS_PATH env,
 * then the default ms-playwright cache (preferring the newest revision).
 */
export function resolveChromiumExecutable(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.DSH_PAGE_ANNOTATE_CHROMIUM
  if (typeof explicit === 'string' && explicit !== '' && existsSync(explicit)) return explicit
  const root = typeof env.PLAYWRIGHT_BROWSERS_PATH === 'string' && env.PLAYWRIGHT_BROWSERS_PATH !== ''
    ? env.PLAYWRIGHT_BROWSERS_PATH
    : defaultBrowsersPath()
  if (root === undefined) return undefined
  const revisions = listRevisionDirs(root)
  for (let i = revisions.length - 1; i >= 0; i -= 1) {
    const executable = executableInRevision(root, revisions[i])
    if (executable !== undefined) return executable
  }
  return undefined
}
