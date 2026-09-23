/**
 * Composition profile: what a preset will load, read from its own bytes.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { needsConfirmation, profileComposition, profilePresetDir } from '../src/core/profile.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-preset-profile-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('composition profile', () => {
  it('collects plugin names and ignores group rows', () => {
    const profile = profileComposition([
      '- id: persona',
      '  name: "@deepseek-ai/dsh-persona"',
      '- id: shell',
      '  name: cordis:group',
      '  group: true',
      '  config:',
      '    - id: tool-bash',
      '      name: "@deepseek-ai/dsh-tool-bash"',
    ].join('\n'), [])
    expect(profile.plugins).toEqual(['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-bash'])
    expect(profile.rows).toBe(3)
    expect(profile.codeExecution).toBe('none')
    expect(needsConfirmation(profile)).toBe(false)
  })

  it('flags relative rows and inline expressions as executable', () => {
    const relative = profileComposition('- id: hook\n  name: ./hook.mjs\n', [])
    expect(relative.relativeNames).toEqual(['./hook.mjs'])
    expect(relative.codeExecution).toBe('local')

    const inline = profileComposition('- id: tool\n  name: "@deepseek-ai/dsh-tool-bash"\n  disabled: !!js process.platform === \'win32\'\n', [])
    expect(inline.inlineExpressions).toBe(1)
    expect(inline.codeExecution).toBe('inline')
    expect(needsConfirmation(inline)).toBe(true)
  })

  it('flags code files shipped beside the composition even when no row names them', () => {
    const profile = profileComposition('- id: persona\n  name: "@deepseek-ai/dsh-persona"\n', ['hook.mjs', 'assets/logo.png'])
    expect(profile.codeFiles).toEqual(['hook.mjs'])
    expect(profile.codeExecution).toBe('local')
  })

  it('reads an installed directory and degrades on a missing composition', () => {
    mkdirSync(join(dir, 'nested'), { recursive: true })
    writeFileSync(join(dir, 'agent.cordis.yml'), '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n')
    writeFileSync(join(dir, 'hook.mjs'), 'export const x = 1\n')
    const profile = profilePresetDir(dir)
    expect(profile.plugins).toEqual(['@deepseek-ai/dsh-persona'])
    expect(profile.codeFiles).toEqual(['hook.mjs'])
    expect(profile.codeExecution).toBe('local')

    const empty = profilePresetDir(join(dir, 'nested'))
    expect(empty.plugins).toEqual([])
    expect(empty.rows).toBe(0)
  })
})
