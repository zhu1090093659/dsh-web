/**
 * Status-decoration manifest tests (pet-center M5, #567): fail-closed
 * structure, warn-and-drop content, duration normalization and the
 * PNG/WebP entry discipline.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KNOWN_DECORATION_TOP_LEVEL, parseDecorationManifest, safeDecorationEntry } from './decoration.ts'
import { PET_ACTIVITY_PHASES } from './manifest-v2.ts'
import { petPackageRoot } from './registry.ts'

function parse(raw: unknown) {
  return parseDecorationManifest(raw, 'test/decoration.json')
}

function valid(): Record<string, unknown> {
  return {
    decorationManifestVersion: 1,
    id: 'whale',
    displayName: '喷水鲸鱼',
    license: 'MIT',
    entry: 'whale-frames.png',
    cell: { width: 64, height: 48 },
    columns: 4,
    frameMs: 140,
    loop: true,
    phases: {
      idle: 'hide',
      waiting: { from: 0, to: 1 },
      thinking: { from: 0, to: 3 },
    },
  }
}

describe('parseDecorationManifest structure', () => {
  it('accepts a valid descriptor with duration and display-name defaults', () => {
    const verdict = parse(valid())
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.manifest.durations).toEqual([140, 140, 140, 140])
    expect(verdict.manifest.loop).toBe(true)
    expect(verdict.manifest.phases.thinking).toEqual({ from: 0, to: 3 })
    expect(verdict.manifest.phases.idle).toBe('hide')
  })

  it('defaults displayName to the id and frameMs to 120', () => {
    const manifest = { ...valid() }
    delete manifest.displayName
    delete manifest.frameMs
    const verdict = parse(manifest)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.manifest.displayName).toBe('whale')
    expect(verdict.manifest.durations).toEqual([120, 120, 120, 120])
  })

  it('rejects non-object roots, wrong versions and unknown top-level fields', () => {
    expect(parse(['x']).ok).toBe(false)
    const wrongVersion = { ...valid(), decorationManifestVersion: 2 }
    const verdict = parse(wrongVersion)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.diagnostics.some(d => d.message.includes('decorationManifestVersion'))).toBe(true)
    const unknown = { ...valid(), mystery: true }
    expect(parse(unknown).ok).toBe(false)
  })

  it('rejects unsafe or non-image entries', () => {
    for (const entry of ['../etc/passwd', '/abs.png', 'a.svg', 'a.css', 'x\\y.png']) {
      const verdict = parse({ ...valid(), entry })
      expect(verdict.ok).toBe(false)
    }
  })

  it('rejects out-of-range geometry and missing license/id', () => {
    expect(parse({ ...valid(), cell: { width: 999, height: 48 } }).ok).toBe(false)
    expect(parse({ ...valid(), columns: 99 }).ok).toBe(false)
    expect(parse({ ...valid(), license: '' }).ok).toBe(false)
    expect(parse({ ...valid(), id: 'Bad Id' }).ok).toBe(false)
  })
})

describe('parseDecorationManifest content (warn-and-drop)', () => {
  it('drops unknown phase keys and out-of-range segments with warnings', () => {
    const verdict = parse({
      ...valid(),
      phases: {
        ...(valid().phases as Record<string, unknown>),
        bogus: { from: 0, to: 1 },
        waiting: { from: 2, to: 9 },
        review: { from: 3, to: 1 },
      },
    })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.manifest.phases.done).toBeUndefined()
    expect(verdict.manifest.phases.waiting).toBeUndefined()
    expect(verdict.manifest.phases.review).toBeUndefined()
    expect(verdict.diagnostics.some(d => d.level === 'warning' && d.message.includes('ignored'))).toBe(true)
  })

  it('warns when no phase shows the ornament', () => {
    const verdict = parse({ ...valid(), phases: { idle: 'hide' } })
    expect(verdict.ok).toBe(true)
    expect(verdict.diagnostics.some(d => d.level === 'warning' && d.message.includes('stays hidden'))).toBe(true)
  })

  it('falls back to the constant frameMs when durations has the wrong length', () => {
    const verdict = parse({ ...valid(), durations: [100] })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.manifest.durations).toEqual([140, 140, 140, 140])
    expect(verdict.diagnostics.some(d => d.level === 'warning' && d.message.includes('durations'))).toBe(true)
  })

  it('keeps a well-sized durations array', () => {
    const verdict = parse({ ...valid(), durations: [120, 130, 140, 150] })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.manifest.durations).toEqual([120, 130, 140, 150])
  })

  it('warns and defaults to looping when loop is not a boolean', () => {
    const verdict = parse({ ...valid(), loop: 'yes' })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.manifest.loop).toBe(true)
    expect(verdict.diagnostics.some(d => d.level === 'warning' && d.message.includes('loop'))).toBe(true)
    const off = parse({ ...valid(), loop: false })
    expect(off.ok && off.manifest.loop).toBe(false)
  })
})

describe('safeDecorationEntry', () => {
  it('accepts safe relative PNG/WebP paths and rejects everything else', () => {
    expect(safeDecorationEntry('frames.webp')).toBe('frames.webp')
    expect(safeDecorationEntry('a/b.png')).toBe('a/b.png')
    expect(safeDecorationEntry('')).toBeUndefined()
    expect(safeDecorationEntry('a/../b.png')).toBeUndefined()
    expect(safeDecorationEntry('/tmp/x.png')).toBeUndefined()
    expect(safeDecorationEntry('x.svg')).toBeUndefined()
    expect(safeDecorationEntry('x')).toBeUndefined()
  })

  it('rejects case-mismatched extensions (the route serves paths verbatim)', () => {
    // A lenient case check would pass validation here, but the asset route
    // matches the declared path exactly and 403s on case-sensitive hosts.
    expect(safeDecorationEntry('img/FRAMES.PNG')).toBeUndefined()
    expect(safeDecorationEntry('img/frames.WebP')).toBeUndefined()
    expect(safeDecorationEntry('img/frames.png')).toBe('img/frames.png')
  })
})

describe('status-decoration schema file drift lock', () => {
  const schema = JSON.parse(readFileSync(
    join(petPackageRoot(import.meta.url), 'contracts', 'status-decoration-v1.schema.json'),
    'utf8',
  )) as {
    required: string[]
    properties: Record<string, { const?: number; properties?: Record<string, unknown> }>
  }

  it('locks the schema top-level fields to the validator allow-list', () => {
    expect(new Set(Object.keys(schema.properties))).toEqual(KNOWN_DECORATION_TOP_LEVEL)
  })

  it('locks the required set and the version const', () => {
    expect([...schema.required].sort()).toEqual([
      'cell', 'columns', 'decorationManifestVersion', 'entry', 'id', 'license',
    ])
    expect(schema.properties.decorationManifestVersion?.const).toBe(1)
  })

  it('locks the phases key set to the ActivityPhase stream', () => {
    expect(new Set(Object.keys(schema.properties.phases?.properties ?? {}))).toEqual(new Set(PET_ACTIVITY_PHASES))
  })
})