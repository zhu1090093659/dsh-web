/**
 * Manifest parse/validate/edit.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryFs } from '../src/core/fs.ts'
import {
  PROFILE_PATCH_FILENAME,
  editManifestJson,
  parseProfileManifest,
  readProfileManifest,
  writeProfileManifestJson,
} from '../src/core/manifest.ts'

const GOOD = JSON.stringify(
  {
    name: 'dsh-profile-web',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@linxin666/dsh-web-all'] } },
    dependencies: { '@linxin666/dsh-web-all': '0.2.7' },
  },
  null,
  2,
) + '\n'

describe('parseProfileManifest', () => {
  it('parses a valid manifest', () => {
    const { facts, error } = parseProfileManifest(GOOD, '/p/package.json')
    expect(error).toBeUndefined()
    expect(facts.bundles).toEqual(['@deepseek-ai/dsh-base', '@linxin666/dsh-web-all'])
    expect(facts.dependencies).toEqual({ '@linxin666/dsh-web-all': '0.2.7' })
    expect(facts.hasDshProfile).toBe(true)
    expect(facts.private).toBe(true)
  })

  it('rejects invalid JSON and non-object roots', () => {
    expect(parseProfileManifest('{', '/p/package.json').error).toBeDefined()
    expect(parseProfileManifest('[1]', '/p/package.json').error).toBeDefined()
    expect(parseProfileManifest('"str"', '/p/package.json').error).toBeDefined()
  })

  it('rejects malformed bundles and dependencies', () => {
    expect(parseProfileManifest(JSON.stringify({ dsh: { profile: { bundles: 'x' } } }), '/p/package.json').error).toContain('bundles')
    expect(parseProfileManifest(JSON.stringify({ dependencies: { a: 1 } }), '/p/package.json').error).toContain('string')
  })

  it('tolerates missing sections', () => {
    const { facts, error } = parseProfileManifest(JSON.stringify({ name: 'x' }), '/p/package.json')
    expect(error).toBeUndefined()
    expect(facts.bundles).toEqual([])
    expect(facts.dependencies).toEqual({})
    expect(facts.hasDshProfile).toBe(false)
  })
})

describe('readProfileManifest', () => {
  it('reads through the injected fs', async () => {
    const fs = createMemoryFs()
    await fs.mkdir('/h/profiles/web', { recursive: true })
    await fs.writeText('/h/profiles/web/package.json', GOOD)
    const result = await readProfileManifest(fs, '/h/profiles/web')
    expect(result.error).toBeUndefined()
    expect(result.facts.bundles).toContain('@linxin666/dsh-web-all')
  })

  it('reports a missing manifest instead of throwing', async () => {
    const fs = createMemoryFs()
    await fs.mkdir('/h/profiles/web', { recursive: true })
    const result = await readProfileManifest(fs, '/h/profiles/web')
    expect(result.error).toContain('missing')
    expect(result.facts.bundles).toEqual([])
  })
})

describe('editManifestJson', () => {
  it('sets and removes by dotted path, preserving other fields', () => {
    const edited = editManifestJson(GOOD, { set: { 'dsh.profile.bundles': ['@deepseek-ai/dsh-base'] } })
    expect(edited.changed).toBe(true)
    const parsed = JSON.parse(edited.text)
    expect(parsed.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base'])
    expect(parsed.dependencies['@linxin666/dsh-web-all']).toBe('0.2.7')
  })

  it('reports no change when the value already matches', () => {
    const edited = editManifestJson(GOOD, { set: { 'dsh.profile.bundles': ['@deepseek-ai/dsh-base', '@linxin666/dsh-web-all'] } })
    expect(edited.changed).toBe(false)
  })

  it('throws on unparsable input', () => {
    expect(() => editManifestJson('{', { remove: ['a'] })).toThrow()
  })
})

describe('writeProfileManifestJson', () => {
  it('writes two-space JSON with a trailing newline', () => {
    expect(writeProfileManifestJson({ a: 1 })).toBe('{\n  "a": 1\n}\n')
  })
})

describe('constants', () => {
  it('names the standard profile files', () => {
    expect(PROFILE_PATCH_FILENAME).toBe('cordis.patch.yml')
  })
})
