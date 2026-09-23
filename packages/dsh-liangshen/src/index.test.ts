/**
 * The host half's own surface: the family-shared harness-home resolution it
 * still carries as a synced copy, the schema defaults the effective settings
 * fall back to, and the preset directory the declaration reads.
 */

import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { dshHome } from './dsh-home.ts'
import { Config, DEFAULT_CONFIG, bundledPresetDir, resolveConfig } from './index.ts'

/** Run `body` with the given DSH_HOME overrides, restoring the env afterwards. */
function withEnv(values: Record<string, string | undefined>, body: () => void): void {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    body()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe('dshHome', () => {
  it('expands a bare tilde to the user home directory', () => {
    withEnv({ DSH_HOME: '~' }, () => {
      expect(dshHome()).toBe(homedir())
    })
  })

  it('expands ~/ and ~\\ prefixes to home-relative paths', () => {
    withEnv({ DSH_HOME: '~/liangshen-home' }, () => {
      expect(dshHome()).toBe(join(homedir(), 'liangshen-home'))
    })
    withEnv({ DSH_HOME: '~\\liangshen-home' }, () => {
      expect(dshHome()).toBe(join(homedir(), 'liangshen-home'))
    })
  })

  it('trims the override before expanding', () => {
    withEnv({ DSH_HOME: '  ~/liangshen-home  ' }, () => {
      expect(dshHome()).toBe(join(homedir(), 'liangshen-home'))
    })
  })

  it('falls back to ~/.dsh for a missing or blank override', () => {
    withEnv({ DSH_HOME: undefined }, () => {
      expect(dshHome()).toBe(join(homedir(), '.dsh'))
    })
    withEnv({ DSH_HOME: '   ' }, () => {
      expect(dshHome()).toBe(join(homedir(), '.dsh'))
    })
  })

  it('keeps absolute overrides untouched', () => {
    withEnv({ DSH_HOME: '/srv/dsh-home' }, () => {
      expect(dshHome()).toBe('/srv/dsh-home')
    })
  })

  it('resolves a relative override against the process cwd (shared contract)', () => {
    withEnv({ DSH_HOME: 'data/home' }, () => {
      expect(dshHome()).toBe(join(process.cwd(), 'data', 'home'))
    })
  })
})

describe('resolveConfig', () => {
  it('operator gets the schema defaults for an activation with no config', () => {
    // Given an activation the Host passed no config to, When the operator
    // reads the effective settings, Then every field is the schema default.
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(resolveConfig({})).toEqual(DEFAULT_CONFIG)
    // The schema and the reader agree on every default the settings card shows:
    // the Host hands the activation the schema's own output, whose volatile
    // fields are references, and the reader resolves them back to values.
    expect(resolveConfig(Config({}))).toEqual(DEFAULT_CONFIG)
  })

  it('operator sees a committed volatile write through the held reference', () => {
    // Given a volatile field the Host hands over as a stable reference, When
    // the operator commits a write and reads again, Then the read moves with it.
    let committed = false
    const live = { get: () => committed }
    const config = { announceToAgent: live, enabled: { get: () => true } }
    expect(resolveConfig(config).announceToAgent).toBe(false)
    committed = true
    expect(resolveConfig(config).announceToAgent).toBe(true)
  })

  it('operator gets a plain profile-patch value as it is', () => {
    // Given a config written as plain values, When the operator reads the
    // effective settings, Then each one passes through unchanged.
    expect(resolveConfig({
      enabled: false,
      announceToAgent: true,
      presentation: 'ptc',
      guardEnabled: false,
      guardSensitivity: 'aggressive',
      guardStallReasoningChars: 12000,
      guardGlobalStallCap: 6,
      guardEchoFailures: 2,
    })).toEqual({
      enabled: false,
      announceToAgent: true,
      presentation: 'ptc',
      guardEnabled: false,
      guardSensitivity: 'aggressive',
      guardStallReasoningChars: 12000,
      guardGlobalStallCap: 6,
      guardEchoFailures: 2,
    })
  })
})

describe('bundledPresetDir', () => {
  it('operator has the bundled preset directory the declaration reads', () => {
    // Given the installed package, When the operator resolves the bundled
    // preset directory, Then it holds the composition and its local plugins.
    const dir = bundledPresetDir()
    expect(existsSync(join(dir, 'agent.cordis.yml'))).toBe(true)
    expect(existsSync(join(dir, 'preset.yml'))).toBe(true)
    expect(existsSync(join(dir, 'minimal-prompt.mjs'))).toBe(true)
  })
})
