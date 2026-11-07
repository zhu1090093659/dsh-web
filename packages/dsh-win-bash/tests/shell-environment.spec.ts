/**
 * Environment regression coverage for issue #2028. MSYS must not infer a
 * non-ASCII Windows profile through the active ANSI code page.
 */
import { describe, expect, it } from 'vitest'
import { shellEnvironment } from '../src/shell.ts'

const NON_ASCII_HOME = 'C:\\Users\\测试用户'

describe('shell environment HOME', () => {
  it('user without an inherited HOME gets the non-ASCII Node home byte for byte', () => {
    // Given a host OS home with non-ASCII characters and an overlay with no HOME,
    const previousHome = process.env.HOME
    const previousProfile = process.env.USERPROFILE
    const base = { USERPROFILE: NON_ASCII_HOME, PATH: 'C:\\Windows' }
    try {
      process.env.HOME = NON_ASCII_HOME
      process.env.USERPROFILE = NON_ASCII_HOME
      // When the pinned shell's environment is built through the real homedir(),
      const env = shellEnvironment({ bin: 'C:\\payload\\usr\\bin' }, 'C:\\Temp\\shell', base)
      // Then HOME is the Unicode path supplied by Node, without an ANSI round trip.
      expect(env.HOME).toBe(NON_ASCII_HOME)
      expect(Buffer.from(env.HOME!, 'utf8')).toEqual(Buffer.from(NON_ASCII_HOME, 'utf8'))
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = previousProfile
    }
  })

  it('user with an explicit HOME keeps that exact value', () => {
    // Given an explicit home that differs from the account profile,
    const base = { HOME: 'D:\\profiles\\既有配置', USERPROFILE: NON_ASCII_HOME }
    // When the pinned shell's environment is built,
    const env = shellEnvironment({ bin: 'C:\\payload\\usr\\bin' }, 'C:\\Temp\\shell', base)
    // Then the caller's existing choice wins over the OS fallback.
    expect(env.HOME).toBe(base.HOME)
  })

  it('user adding HOME keeps the existing payload and private-temp environment', () => {
    // Given the normal payload and private temp inputs,
    const runtime = { bin: 'C:\\payload\\usr\\bin' }
    const temp = 'C:\\Temp\\shell'
    const base = { HOME: NON_ASCII_HOME, PATH: 'C:\\Windows' }
    // When the pinned shell's environment is built,
    const env = shellEnvironment(runtime, temp, base)
    // Then the unrelated environment guarantees are unchanged.
    expect(env.PATH).toBe(runtime.bin + (process.platform === 'win32' ? ';' : ':') + base.PATH)
    expect(env).toMatchObject({ TMPDIR: temp, TMP: temp, TEMP: temp, MSYSTEM: 'MSYS', TERM: 'dumb' })
  })
})
