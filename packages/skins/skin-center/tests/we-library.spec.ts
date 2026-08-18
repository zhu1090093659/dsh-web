/**
 * we-library tests: Steam layout discovery (vdf parsing, workshop roots),
 * manual library folders (project dirs, single-project dirs, bare-media
 * synthesis), the import store, and inventory update detection — all against
 * synthetic fixture trees in a temp dir; nothing real is ever touched.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildInventory,
  expandUser,
  inferType,
  librariesFromVdf,
  readImportedManifest,
  readProjectJson,
  scanImportStore,
  scanProjectsRoot,
} from '../src/we-library.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'we-library-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Write one wallpaper project dir with a project.json and empty payloads. */
function makeProject(dir: string, project: Record<string, unknown>, files: string[] = []): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project), 'utf8')
  for (const file of files) {
    writeFileSync(join(dir, file), 'x', 'utf8')
  }
}

describe('librariesFromVdf', () => {
  it('collects only libraries that own app 431960', () => {
    const vdf = [
      '"libraryfolders"',
      '{',
      '  "0"',
      '  {',
      '    "path"    "C:\\\\Steam"',
      '    "apps"',
      '    {',
      '      "431960"    "123"',
      '    }',
      '  }',
      '  "1"',
      '  {',
      '    "path"    "D:\\\\SteamLibrary"',
      '    "apps"',
      '    {',
      '      "570"    "456"',
      '    }',
      '  }',
      '}',
    ].join('\n')
    expect(librariesFromVdf(vdf)).toEqual(['C:\\Steam'])
  })
})

describe('expandUser', () => {
  it('expands a leading tilde to the home directory and leaves other paths alone', () => {
    // expandUser resolves through os.homedir(), not the HOME env var.
    const home = homedir()
    expect(expandUser('~')).toBe(home)
    expect(expandUser('~/Movies/wallpapers')).toBe(join(home, 'Movies', 'wallpapers'))
    expect(expandUser('/abs/path')).toBe('/abs/path')
    expect(expandUser('relative/path')).toBe('relative/path')
    expect(expandUser('~user/x')).toBe('~user/x')
  })
})

describe('inferType', () => {
  it('maps extensions to wallpaper kinds', () => {
    expect(inferType('a.mp4')).toBe('video')
    expect(inferType('b.webm')).toBe('video')
    expect(inferType('index.html')).toBe('web')
    expect(inferType('scene.pkg')).toBe('scene')
  })
})

describe('readProjectJson', () => {
  it('parses title/type/file/preview and infers a missing type', () => {
    const dir = join(root, 'p1')
    makeProject(dir, { title: 'Ocean', file: 'sea.mp4', preview: 'p.jpg' })
    expect(readProjectJson(dir)).toEqual({ title: 'Ocean', type: 'video', file: 'sea.mp4', preview: 'p.jpg' })
  })

  it('returns null for missing or invalid project.json', () => {
    expect(readProjectJson(join(root, 'nope'))).toBeNull()
    const dir = join(root, 'broken')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'project.json'), '{ not json', 'utf8')
    expect(readProjectJson(dir)).toBeNull()
  })

  it('normalizes backslash paths to forward slashes', () => {
    const dir = join(root, 'slashed')
    makeProject(dir, { title: 'S', type: 'scene', file: 'project\\scene.json', preview: 'preview\\p.jpg' })
    expect(readProjectJson(dir)).toEqual({
      title: 'S', type: 'scene', file: 'project/scene.json', preview: 'preview/p.jpg',
    })
  })
})

describe('scanProjectsRoot', () => {
  it('scans a workshop-style root of project dirs', () => {
    const ws = join(root, 'workshop')
    makeProject(join(ws, '111'), { title: 'A', type: 'video', file: 'a.mp4' }, ['a.mp4'])
    makeProject(join(ws, '222'), { title: 'B', type: 'scene', file: 'scene.pkg' }, ['scene.pkg'])
    const entries = scanProjectsRoot(ws, 'workshop')
    expect(entries).toHaveLength(2)
    const video = entries.find(e => e.id === '111')
    expect(video?.playable).toBe(true)
    expect(video?.source).toBe('workshop')
    const scene = entries.find(e => e.id === '222')
    expect(scene?.playable).toBe(true)
  })

  it('falls back to the actual scene container when the declared file is absent', () => {
    const ws = join(root, 'workshop')
    makeProject(join(ws, '444'), { title: 'Scenery', type: 'scene', file: 'project\\scene.json' }, ['scene.pkg'])
    const scene = scanProjectsRoot(ws, 'workshop')[0]
    expect(scene?.file).toBe('scene.pkg')
    expect(scene?.playable).toBe(true)
    expect(scene?.srcSize).toBe(1)
  })

  it('prefers scene.pkg over scene.json when both exist', () => {
    const ws = join(root, 'workshop')
    makeProject(join(ws, '555'), { title: 'Packed', type: 'scene', file: 'scene.json' }, ['scene.json', 'scene.pkg'])
    const scene = scanProjectsRoot(ws, 'workshop')[0]
    expect(scene?.file).toBe('scene.pkg')
  })

  it('accepts a root that is itself a single project', () => {
    const dir = join(root, 'single')
    makeProject(dir, { title: 'Solo', file: 's.mp4' }, ['s.mp4'])
    const entries = scanProjectsRoot(dir, 'local')
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe('Solo')
  })

  it('synthesizes one entry per media file in a bare folder without project.json', () => {
    const dir = join(root, 'bare')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'loop.mp4'), 'x', 'utf8')
    writeFileSync(join(dir, 'aurora.mp4'), 'x', 'utf8')
    writeFileSync(join(dir, 'loop.jpg'), 'x', 'utf8')
    const entries = scanProjectsRoot(dir, 'local')
    expect(entries).toHaveLength(2)
    const loop = entries.find(e => e.id === 'bare/loop.mp4')
    expect(loop?.type).toBe('video')
    expect(loop?.playable).toBe(true)
    expect(loop?.preview).toBe('loop.jpg')
    const aurora = entries.find(e => e.id === 'bare/aurora.mp4')
    expect(aurora?.preview).toBeNull()
  })

  it('does not synthesize bare-media folders under workshop roots', () => {
    const ws = join(root, 'ws')
    const dir = join(ws, '333')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'loop.mp4'), 'x', 'utf8')
    expect(scanProjectsRoot(ws, 'workshop')).toHaveLength(0)
  })
})

describe('scanImportStore', () => {
  it('reads manifests into imported entries', () => {
    const store = join(root, 'store')
    const entryDir = join(store, '111')
    mkdirSync(join(entryDir, 'project'), { recursive: true })
    writeFileSync(join(entryDir, 'project', 'a.mp4'), 'x', 'utf8')
    writeFileSync(join(entryDir, 'manifest.json'), JSON.stringify({
      sourceId: '111', title: 'Imported A', type: 'video',
      srcMtime: 10, srcSize: 1, importedAt: 20,
      file: join('project', 'a.mp4'), preview: null,
    }), 'utf8')
    const entries = scanImportStore(store)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('imported/111')
    expect(entries[0].playable).toBe(true)
    expect(entries[0].importSrcMtime).toBe(10)
  })

  it('skips children without a manifest', () => {
    const store = join(root, 'store')
    mkdirSync(join(store, 'junk'), { recursive: true })
    expect(scanImportStore(store)).toHaveLength(0)
  })

  it('re-finds the scene container for legacy scene manifests', () => {
    const store = join(root, 'store')
    const entryDir = join(store, '111')
    mkdirSync(join(entryDir, 'project'), { recursive: true })
    writeFileSync(join(entryDir, 'project', 'scene.pkg'), 'pkg', 'utf8')
    // A pre-fix manifest recorded the declared project\scene.json path.
    writeFileSync(join(entryDir, 'manifest.json'), JSON.stringify({
      sourceId: '111', title: 'Imported Scene', type: 'scene',
      srcMtime: 1, srcSize: 3, importedAt: 20,
      file: join('project', 'project', 'scene.json'), preview: null,
    }), 'utf8')
    const entries = scanImportStore(store)
    expect(entries).toHaveLength(1)
    expect(entries[0].file).toBe('scene.pkg')
    expect(entries[0].playable).toBe(true)
    expect(entries[0].srcSize).toBe(3)
  })
})

describe('readImportedManifest', () => {
  it('rejects invalid manifests', () => {
    const dir = join(root, 'bad')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'manifest.json'), '{"x":1}', 'utf8')
    expect(readImportedManifest(dir)).toBeNull()
  })
})

describe('buildInventory', () => {
  it('merges manual dirs with the import store and flags updates', () => {
    const manual = join(root, 'manual')
    makeProject(join(manual, '111'), { title: 'A', file: 'a.mp4' }, ['a.mp4'])
    const store = join(root, 'store')
    const entryDir = join(store, '111')
    mkdirSync(join(entryDir, 'project'), { recursive: true })
    writeFileSync(join(entryDir, 'project', 'a.mp4'), 'x', 'utf8')
    // The manifest records an OLD mtime; the source file is newer.
    writeFileSync(join(entryDir, 'manifest.json'), JSON.stringify({
      sourceId: '111', title: 'Imported A', type: 'video',
      srcMtime: 1, srcSize: 1, importedAt: 20,
      file: join('project', 'a.mp4'), preview: null,
    }), 'utf8')
    const future = new Date(Date.now() + 60_000)
    utimesSync(join(manual, '111', 'a.mp4'), future, future)

    const inventory = buildInventory({ manualDirs: [manual], storeDir: store, autoDetect: false })
    expect(inventory.total).toBe(2)
    const imported = inventory.wallpapers.find(w => w.id === 'imported/111')
    expect(imported?.updateAvailable).toBe(true)
    const source = inventory.wallpapers.find(w => w.id === '111')
    expect(source?.updateAvailable).toBe(false)
  })

  it('ignores blank manual dirs and missing roots', () => {
    const inventory = buildInventory({ manualDirs: ['', join(root, 'missing')], autoDetect: false })
    expect(inventory.total).toBe(0)
  })
})
