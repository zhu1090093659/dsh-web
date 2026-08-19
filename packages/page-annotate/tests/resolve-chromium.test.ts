import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultBrowsersPath, executableInRevision, listRevisionDirs, resolveChromiumExecutable } from '../src/screenshot/resolve-chromium.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'page-annotate-chromium-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeRevision(revision: string): void {
  const exe = join(root, `chromium-${revision}`, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS')
  mkdirSync(exe, { recursive: true })
  writeFileSync(join(exe, 'Google Chrome for Testing'), '')
}

describe('resolveChromiumExecutable', () => {
  it('prefers the explicit env path', () => {
    const explicit = join(root, 'custom-chrome')
    writeFileSync(explicit, '')
    const env = { DSH_PAGE_ANNOTATE_CHROMIUM: explicit, HOME: '/nonexistent' }
    expect(resolveChromiumExecutable(env)).toBe(explicit)
  })

  it('scans the ms-playwright cache and picks the newest revision', () => {
    makeRevision('1208')
    makeRevision('1228')
    const env = { PLAYWRIGHT_BROWSERS_PATH: root, HOME: '/nonexistent' }
    const resolved = resolveChromiumExecutable(env)
    expect(resolved).toContain('chromium-1228')
    expect(resolved).toContain('Google Chrome for Testing')
  })

  it('returns undefined when nothing is installed', () => {
    expect(resolveChromiumExecutable({ PLAYWRIGHT_BROWSERS_PATH: root, HOME: '/nonexistent' })).toBeUndefined()
  })
})

describe('listRevisionDirs / executableInRevision', () => {
  it('lists only chromium-* dirs sorted by revision', () => {
    makeRevision('1210')
    makeRevision('1200')
    expect(listRevisionDirs(root)).toEqual(['chromium-1200', 'chromium-1210'])
  })

  it('finds the executable inside a revision dir', () => {
    makeRevision('1228')
    expect(executableInRevision(root, 'chromium-1228')).toContain('Google Chrome for Testing')
  })
})

describe('defaultBrowsersPath', () => {
  it('uses the mac cache layout', () => {
    expect(defaultBrowsersPath('darwin', '/Users/x')).toBe('/Users/x/Library/Caches/ms-playwright')
  })
})
