/**
 * Patch-layer merge logic: disable overrides are appended or updated,
 * enabling removes them, comments survive, and malformed files fail loud.
 */

import { describe, expect, it } from 'vitest'
import { mergeDisabledOverride, PatchFileEditor, type PatchFileIo } from '../src/core/patch-file.ts'

function memoryIo(files: Map<string, string>): PatchFileIo {
  return {
    async readFile(path) {
      const text = files.get(path)
      if (text === undefined) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      return text
    },
    async writeFileAtomic(path, text) {
      files.set(path, text)
    },
  }
}

describe('mergeDisabledOverride', () => {
  it('creates a disable override when the file is absent', () => {
    const next = mergeDisabledOverride(undefined, 'ui-task-board', true)
    expect(next).toBe('- id: ui-task-board\n  disabled: true\n')
  })

  it('returns undefined when enabling without a file', () => {
    expect(mergeDisabledOverride(undefined, 'ui-task-board', false)).toBeUndefined()
  })

  it('appends a disable override to an existing list', () => {
    const text = '- id: alpha\n  name: ./a.mjs\n'
    const next = mergeDisabledOverride(text, 'beta', true)
    expect(next).toContain('disabled: true')
    expect(next).toContain('- id: beta')
  })

  it('updates an existing override to true', () => {
    const text = '- id: alpha\n  disabled: false\n'
    const next = mergeDisabledOverride(text, 'alpha', true)
    expect(next).toContain('disabled: true')
    expect(next).not.toContain('disabled: false')
  })

  it('removes the override key on enable, keeping other keys', () => {
    const text = '- id: alpha\n  disabled: true\n  config:\n    value: 1\n'
    const next = mergeDisabledOverride(text, 'alpha', false)
    expect(next).toBe('- id: alpha\n  config:\n    value: 1\n')
  })

  it('removes the whole entry on enable when only the id remained', () => {
    const text = '- id: alpha\n  disabled: true\n'
    const next = mergeDisabledOverride(text, 'alpha', false)
    expect(next).toBe('[]\n')
  })

  it('returns undefined when the file already matches the request', () => {
    const text = '- id: alpha\n  disabled: true\n'
    expect(mergeDisabledOverride(text, 'alpha', true)).toBeUndefined()
    expect(mergeDisabledOverride(text, 'beta', false)).toBeUndefined()
  })

  it('preserves comments and untouched rows', () => {
    const text = '# user patch layer\n- id: alpha\n  name: ./a.mjs\n'
    const next = mergeDisabledOverride(text, 'beta', true)
    expect(next).toContain('# user patch layer')
    expect(next).toContain('name: ./a.mjs')
  })

  it('fails loud on a non-array document', () => {
    expect(() => mergeDisabledOverride('id: not-a-list\n', 'alpha', true)).toThrow(/top-level YAML array/)
  })
})

describe('PatchFileEditor', () => {
  it('writes through the injected io and reports change', async () => {
    const files = new Map<string, string>()
    const editor = new PatchFileEditor('/home/.dsh/cordis.patch.yml', memoryIo(files))
    expect(await editor.setEnabled('ui-task-board', false)).toBe(true)
    expect(files.get('/home/.dsh/cordis.patch.yml')).toContain('disabled: true')
    expect(await editor.setEnabled('ui-task-board', true)).toBe(true)
    expect(files.get('/home/.dsh/cordis.patch.yml')).toBe('[]\n')
    expect(await editor.setEnabled('ui-task-board', true)).toBe(false)
  })

  it('propagates io failures for the caller to fall back', async () => {
    const editor = new PatchFileEditor('/home/.dsh/cordis.patch.yml', {
      readFile: async () => { throw new Error('disk gone') },
      writeFileAtomic: async () => {},
    })
    await expect(editor.setEnabled('x', false)).rejects.toThrow('disk gone')
  })
})
