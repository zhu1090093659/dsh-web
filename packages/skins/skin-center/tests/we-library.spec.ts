/**
 * we-library tests: Steam layout discovery (vdf parsing, workshop roots),
 * manual library folders (project dirs, single-project dirs, bare-media
 * synthesis), the import store, and inventory update detection — all against
 * synthetic fixture trees in a temp dir; nothing real is ever touched.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  allLibrariesFromVdf,
  buildInventory,
  expandUser,
  inferType,
  inventoryFingerprint,
  librariesFromVdf,
  libraryOwnsAppFromManifest,
  locateWallpaperEngine,
  memoizedProbe,
  owningLibraries,
  readImportedManifest,
  readProjectJson,
  scanImportStore,
  scanManualWallpaperRoot,
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

describe('Steam library discovery', () => {
  it('reads every VDF library and confirms stale-cache ownership from appmanifest', () => {
    const fixtureExists = (path: string): boolean => path.startsWith(root) && existsSync(path)
    const steam = join(root, 'steam')
    const library = join(root, 'other-library')
    mkdirSync(join(steam, 'steamapps'), { recursive: true })
    mkdirSync(join(library, 'steamapps'), { recursive: true })
    const vdf = [
      '"libraryfolders"', '{', '  "1"', '  {',
      `    "path" "${library.replace(/\\/g, '\\\\')}"`,
      '    "apps"', '    {', '      "570" "1"', '    }', '  }', '}',
    ].join('\n')
    writeFileSync(join(steam, 'steamapps', 'libraryfolders.vdf'), vdf, 'utf8')
    writeFileSync(join(library, 'steamapps', 'appmanifest_431960.acf'), '"appid" "431960"', 'utf8')

    expect(allLibrariesFromVdf(vdf)).toEqual([library])
    expect(libraryOwnsAppFromManifest(library, '431960')).toBe(true)
    expect(owningLibraries({ exists: fixtureExists, registry: () => steam })).toEqual([library])
  })

  it('locates an install even when the VDF apps cache omits Wallpaper Engine', () => {
    const fixtureExists = (path: string): boolean => path.startsWith(root) && existsSync(path)
    const steam = join(root, 'steam')
    const library = join(root, 'other-library')
    const install = join(library, 'steamapps', 'common', 'wallpaper_engine')
    mkdirSync(join(steam, 'steamapps'), { recursive: true })
    mkdirSync(install, { recursive: true })
    writeFileSync(join(install, 'wallpaper32.exe'), 'x', 'utf8')
    writeFileSync(join(steam, 'steamapps', 'libraryfolders.vdf'), [
      '"libraryfolders"', '{', '  "1"', '  {',
      `    "path" "${library.replace(/\\/g, '\\\\')}"`,
      '    "apps"', '    {', '    }', '  }', '}',
    ].join('\n'), 'utf8')

    expect(locateWallpaperEngine({ env: { OS: 'Windows_NT' }, exists: fixtureExists, registry: () => steam })).toBe(install)
  })
})

describe('expandUser', () => {
  it('expands a leading tilde to the home directory and leaves other paths alone', () => {
    const home = homedir()
    expect(expandUser('~')).toBe(home)
    expect(expandUser('~/Movies/wallpapers')).toBe(join(home, 'Movies/wallpapers'))
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
    expect(scene?.playable).toBe(false)
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

describe('scanManualWallpaperRoot', () => {
  it('descends from a Wallpaper Engine install root into local and workshop projects', () => {
    const library = join(root, 'SteamLibrary')
    const install = join(library, 'steamapps', 'common', 'wallpaper_engine')
    makeProject(join(install, 'projects', 'defaultprojects', 'local-one'), { title: 'Local', file: 'local.mp4' }, ['local.mp4'])
    makeProject(join(library, 'steamapps', 'workshop', 'content', '431960', '123'), { title: 'Workshop', file: 'workshop.mp4' }, ['workshop.mp4'])

    const entries = scanManualWallpaperRoot(install)
    expect(entries.map(entry => entry.title).sort()).toEqual(['Local', 'Workshop'])
  })

  it('descends from a Steam library root into workshop content', () => {
    const library = join(root, 'SteamLibrary')
    makeProject(join(library, 'steamapps', 'workshop', 'content', '431960', '456'), { title: 'Library workshop', file: 'wall.mp4' }, ['wall.mp4'])
    expect(scanManualWallpaperRoot(library).map(entry => entry.title)).toEqual(['Library workshop'])
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
})

describe('scene container resolution (#521)', () => {
  it('falls back to scene.pkg when the declared scene.json is missing', () => {
    const ws = join(root, 'workshop')
    makeProject(join(ws, '444'), { title: 'S', type: 'scene', file: 'scene.json' }, ['scene.pkg'])
    const entries = scanProjectsRoot(ws, 'workshop')
    expect(entries).toHaveLength(1)
    expect(entries[0].file).toBe('scene.pkg')
    expect(entries[0].fileAbs).toBe(join(ws, '444', 'scene.pkg'))
    expect(entries[0].srcSize).toBeGreaterThan(0)
  })

  it('keeps an existing declared file and probes a lone *.pkg last', () => {
    const ws = join(root, 'workshop2')
    makeProject(join(ws, '555'), { title: 'S', type: 'scene', file: 'scene.json' }, ['scene.json'])
    expect(scanProjectsRoot(ws, 'workshop2')[0].file).toBe('scene.json')
    const ws2 = join(root, 'workshop3')
    makeProject(join(ws2, '666'), { title: 'S', type: 'scene', file: 'main.json' }, ['effect.pkg'])
    expect(scanProjectsRoot(ws2, 'workshop3')[0].file).toBe('effect.pkg')
  })

  it('heals imported manifests that recorded the wrong declared name', () => {
    const store = join(root, 'store')
    const entryDir = join(store, '777')
    mkdirSync(join(entryDir, 'project'), { recursive: true })
    writeFileSync(join(entryDir, 'project', 'scene.pkg'), 'x', 'utf8')
    writeFileSync(join(entryDir, 'manifest.json'), JSON.stringify({
      sourceId: '777', title: 'Imported S', type: 'scene',
      srcMtime: 10, srcSize: 1, importedAt: 20,
      file: join('project', 'scene.json'), preview: null,
    }), 'utf8')
    const entries = scanImportStore(store)
    expect(entries).toHaveLength(1)
    expect(entries[0].file).toBe(join('project', 'scene.pkg'))
    expect(entries[0].fileAbs).toBe(join(entryDir, 'project', 'scene.pkg'))
    expect(entries[0].srcSize).toBeGreaterThan(0)
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

describe('memoizedProbe', () => {
  it('probes once per process and memoizes a null result too', () => {
    let calls = 0
    const probe = memoizedProbe(() => { calls++; return null })
    expect(probe()).toBeNull()
    expect(probe()).toBeNull()
    expect(calls).toBe(1)
  })

  it('memoizes a concrete result', () => {
    let calls = 0
    const probe = memoizedProbe(() => { calls++; return 'C:\\Steam' })
    expect(probe()).toBe('C:\\Steam')
    expect(probe()).toBe('C:\\Steam')
    expect(calls).toBe(1)
  })
})

describe('inventoryFingerprint', () => {
  it('is stable for unchanged inputs and changes with the entry set', () => {
    const manual = join(root, 'manual')
    makeProject(join(manual, '111'), { title: 'A', file: 'a.mp4' }, ['a.mp4'])
    const entries = scanProjectsRoot(manual, 'local')
    const before = inventoryFingerprint({ manualDirs: [manual], entries })
    expect(inventoryFingerprint({ manualDirs: [manual], entries })).toBe(before)
    expect(inventoryFingerprint({ manualDirs: [manual] })).not.toBe(before)
  })

  it('invalidates when a root gains a project (root mtime moves)', () => {
    const manual = join(root, 'manual')
    makeProject(join(manual, '111'), { title: 'A', file: 'a.mp4' }, ['a.mp4'])
    const entries = scanProjectsRoot(manual, 'local')
    const before = inventoryFingerprint({ manualDirs: [manual], entries })
    makeProject(join(manual, '222'), { title: 'B', file: 'b.mp4' }, ['b.mp4'])
    // The previous entry set is reused on purpose: the root mtime alone
    // must flip the fingerprint.
    expect(inventoryFingerprint({ manualDirs: [manual], entries })).not.toBe(before)
  })

  it('invalidates when a main file or project.json is rewritten in place', () => {
    const manual = join(root, 'manual')
    makeProject(join(manual, '111'), { title: 'A', file: 'a.mp4' }, ['a.mp4'])
    const entries = scanProjectsRoot(manual, 'local')
    const before = inventoryFingerprint({ manualDirs: [manual], entries })
    // In-place rewrite: the containing root mtime never changes.
    const main = join(manual, '111', 'a.mp4')
    utimesSync(main, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000))
    expect(inventoryFingerprint({ manualDirs: [manual], entries })).not.toBe(before)
    const projectJson = join(manual, '111', 'project.json')
    utimesSync(projectJson, new Date(Date.now() + 120_000), new Date(Date.now() + 120_000))
    expect(inventoryFingerprint({ manualDirs: [manual], entries })).not.toBe(before)
  })

  it('invalidates when the store appears or the manual dir list changes', () => {
    const manual = join(root, 'manual')
    makeProject(join(manual, '111'), { title: 'A', file: 'a.mp4' }, ['a.mp4'])
    const entries = scanProjectsRoot(manual, 'local')
    const store = join(root, 'store')
    const before = inventoryFingerprint({ manualDirs: [manual], storeDir: store, entries })
    mkdirSync(store, { recursive: true })
    expect(inventoryFingerprint({ manualDirs: [manual], storeDir: store, entries })).not.toBe(before)

    const later = join(root, 'later')
    const beforeLater = inventoryFingerprint({ manualDirs: [manual, later], storeDir: store, entries })
    mkdirSync(later, { recursive: true })
    expect(inventoryFingerprint({ manualDirs: [manual, later], storeDir: store, entries })).not.toBe(beforeLater)
  })
})
