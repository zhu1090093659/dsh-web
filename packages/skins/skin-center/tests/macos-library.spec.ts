/**
 * macOS wallpaper discovery tests: an in-memory filesystem stands in for
 * ~/Library/Application Support/com.apple.wallpaper and Desktop Pictures,
 * covering the modern aerial layout, the legacy idleassetsd layout,
 * manifest title mapping and fallback, thumbnail pairing, Desktop Pictures
 * image listing, format validation (extension + magic bytes), de-duplication
 * and the non-darwin early-out.
 */
import { describe, expect, it } from 'vitest'
import {
  readAerialManifest,
  scanMacAerials,
  scanMacDesktopPictures,
  scanMacosWallpapers,
  defaultMacosWallpaperRoots,
  type MacosScanFs,
} from '../src/macos-library.ts'

/** Valid magic bytes the scanners validate against. */
const MOV_MAGIC = '\x00\x00\x00\x18ftypqt  '
const HEIC_MAGIC = '\x00\x00\x00\x1cftypheic'
const JPEG_MAGIC = '\xff\xd8\xff\xe0JFIF'
const PNG_MAGIC = '\x89PNG\x0d\x0a\x1a\x0a'
const WEBP_MAGIC = 'RIFF\x10\x00\x00\x00WEBP'

interface FakeNode {
  kind: 'file' | 'dir'
  content?: string
  children?: string[]
  mtimeMs?: number
  size?: number
}

/** Build an injectable fs face over a path -> node map. */
function fakeFs(tree: Record<string, FakeNode>): MacosScanFs {
  return {
    exists: (path) => path in tree,
    readdir: (path) => {
      const node = tree[path]
      if (node === undefined || node.kind !== 'dir') throw new Error('ENOTDIR: ' + path)
      return node.children ?? []
    },
    readFile: (path) => {
      const node = tree[path]
      if (node === undefined || node.kind !== 'file') throw new Error('ENOENT: ' + path)
      return node.content ?? ''
    },
    stat: (path) => {
      const node = tree[path]
      if (node === undefined) throw new Error('ENOENT: ' + path)
      return {
        mtimeMs: node.mtimeMs ?? 1000,
        size: node.size ?? (node.content?.length ?? 0),
        isFile: () => node.kind === 'file',
        isDirectory: () => node.kind === 'dir',
      }
    },
    readHead: (path, bytes) => {
      const node = tree[path]
      if (node === undefined || node.kind !== 'file') throw new Error('ENOENT: ' + path)
      return Buffer.from(node.content ?? '', 'latin1').subarray(0, bytes)
    },
  }
}

const dir = (children: string[]): FakeNode => ({ kind: 'dir', children })
const file = (content: string, extra: Partial<FakeNode> = {}): FakeNode => ({ kind: 'file', content, ...extra })

const MANIFEST = JSON.stringify({
  assets: [
    { id: 'AAAA-1', accessibilityLabel: 'Sonoma from Above' },
    { id: 'BBBB-2', accessibilityLabel: 'Patagonia' },
    { id: 'CCCC-3' }, // no label: falls back to the stem
  ],
})

describe('readAerialManifest', () => {
  it('maps asset ids to their accessibility labels', () => {
    const titles = readAerialManifest(MANIFEST)
    expect(titles.get('AAAA-1')).toBe('Sonoma from Above')
    expect(titles.get('BBBB-2')).toBe('Patagonia')
  })

  it('returns an empty map for malformed manifests', () => {
    expect(readAerialManifest('not json').size).toBe(0)
    expect(readAerialManifest('{"assets": 42}').size).toBe(0)
    expect(readAerialManifest('[]').size).toBe(0)
  })
})

describe('scanMacAerials', () => {
  it('scans the modern per-user layout with titles and thumbnails', () => {
    const root = '/home/u/Library/Application Support/com.apple.wallpaper/aerials'
    const fs = fakeFs({
      [root]: dir(['videos', 'thumbnails', 'manifest']),
      [root + '/videos']: dir(['AAAA-1.mov', 'BBBB-2.mov', 'README.txt']),
      [root + '/videos/AAAA-1.mov']: file(MOV_MAGIC + 'VID1', { mtimeMs: 42, size: 7 }),
      [root + '/videos/BBBB-2.mov']: file(MOV_MAGIC + 'VID2'),
      [root + '/thumbnails']: dir(['AAAA-1.png']),
      [root + '/thumbnails/AAAA-1.png']: file('PNG'),
      [root + '/manifest']: dir(['entries.json']),
      [root + '/manifest/entries.json']: file(MANIFEST),
    })
    const entries = scanMacAerials([root], fs)
    expect(entries.map((e) => e.id).sort()).toEqual(['macos-aerial/AAAA-1', 'macos-aerial/BBBB-2'])
    const a = entries.find((e) => e.id === 'macos-aerial/AAAA-1')
    expect(a?.title).toBe('Sonoma from Above')
    expect(a?.type).toBe('video')
    expect(a?.source).toBe('system')
    expect(a?.playable).toBe(true)
    expect(a?.previewAbs).toBe(root + '/thumbnails/AAAA-1.png')
    expect(a?.srcMtime).toBe(42)
    // No thumbnail downloaded for BBBB-2: the preview stays null and the
    // panel falls back to the video first frame.
    const b = entries.find((e) => e.id === 'macos-aerial/BBBB-2')
    expect(b?.title).toBe('Patagonia')
    expect(b?.previewAbs).toBeNull()
  })

  it('skips .mov files whose content is not an ISO BMFF container', () => {
    const root = '/a'
    const fs = fakeFs({
      [root + '/videos']: dir(['real.mov', 'fake.mov', 'empty.mov']),
      [root + '/videos/real.mov']: file(MOV_MAGIC + 'payload'),
      [root + '/videos/fake.mov']: file('this is plain text, not a movie'),
      [root + '/videos/empty.mov']: file(''),
    })
    const entries = scanMacAerials([root], fs)
    expect(entries.map((e) => e.id)).toEqual(['macos-aerial/real'])
  })

  it('scans the legacy idleassetsd quality-folder layout', () => {
    const root = '/Library/Application Support/com.apple.idleassetsd/Customer'
    const fs = fakeFs({
      [root]: dir(['4KSDR240FPS', 'TVIdleScreenStrings.bundle', 'entries.json']),
      [root + '/4KSDR240FPS']: dir(['EEEE-5.mov']),
      [root + '/4KSDR240FPS/EEEE-5.mov']: file(MOV_MAGIC + 'VID'),
      [root + '/TVIdleScreenStrings.bundle']: dir(['en.lproj']),
      [root + '/entries.json']: file(MANIFEST),
    })
    const entries = scanMacAerials([root], fs)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe('macos-aerial/EEEE-5')
    // Not in the manifest: the asset id is the title.
    expect(entries[0]?.title).toBe('EEEE-5')
    expect(entries[0]?.previewAbs).toBeNull()
  })

  it('de-dupes asset ids across roots (first root wins)', () => {
    const modern = '/m'
    const legacy = '/l'
    const fs = fakeFs({
      [modern + '/videos']: dir(['AAAA-1.mov']),
      [modern + '/videos/AAAA-1.mov']: file(MOV_MAGIC + 'V1'),
      [legacy]: dir(['2KSDR']),
      [legacy + '/2KSDR']: dir(['AAAA-1.mov']),
      [legacy + '/2KSDR/AAAA-1.mov']: file(MOV_MAGIC + 'V2'),
    })
    const entries = scanMacAerials([modern, legacy], fs)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.fileAbs).toBe(modern + '/videos/AAAA-1.mov')
  })

  it('returns nothing when roots are absent', () => {
    expect(scanMacAerials(['/nope'], fakeFs({}))).toEqual([])
  })
})

describe('scanMacDesktopPictures', () => {
  it('lists validated image wallpapers and skips everything else', () => {
    const system = '/System/Library/Desktop Pictures'
    const legacy = '/Library/Desktop Pictures'
    const fs = fakeFs({
      [system]: dir(['Tahoe Day.heic', 'iMac Blue.heic', 'Big Sur Aerial.madesktop', 'notes.txt']),
      [system + '/Tahoe Day.heic']: file(HEIC_MAGIC + 'H1', { mtimeMs: 7, size: 99 }),
      [system + '/iMac Blue.heic']: file(HEIC_MAGIC + 'H2'),
      [system + '/notes.txt']: file('not an image'),
      [legacy]: dir(['Tahoe Day.heic', 'My Download.jpg', 'Web Photo.webp', 'Old Pic.png']),
      [legacy + '/Tahoe Day.heic']: file(HEIC_MAGIC + 'DUP'),
      [legacy + '/My Download.jpg']: file(JPEG_MAGIC + 'J'),
      [legacy + '/Web Photo.webp']: file(WEBP_MAGIC),
      [legacy + '/Old Pic.png']: file(PNG_MAGIC + 'P'),
    })
    const entries = scanMacDesktopPictures([system, legacy], fs)
    expect(entries.map((e) => e.id).sort()).toEqual([
      'macos-image/My Download',
      'macos-image/Old Pic',
      'macos-image/Tahoe Day',
      'macos-image/Web Photo',
      'macos-image/iMac Blue',
    ])
    const tahoe = entries.find((e) => e.id === 'macos-image/Tahoe Day')
    expect(tahoe?.type).toBe('image')
    expect(tahoe?.source).toBe('system')
    expect(tahoe?.playable).toBe(false)
    expect(tahoe?.previewAbs).toBeNull()
    expect(tahoe?.fileAbs).toBe(system + '/Tahoe Day.heic')
    expect(tahoe?.srcSize).toBe(99)
  })

  it('rejects files whose magic bytes contradict the image extension', () => {
    const root = '/pics'
    const fs = fakeFs({
      [root]: dir(['broken.heic', 'renamed.jpg', 'fake.png', 'bad.webp', 'empty.png']),
      [root + '/broken.heic']: file('plain text payload'),
      [root + '/renamed.jpg']: file(PNG_MAGIC + 'actually a png'),
      [root + '/fake.png']: file(JPEG_MAGIC + 'actually a jpeg'),
      [root + '/bad.webp']: file('RIFF is not enough'),
      [root + '/empty.png']: file(''),
    })
    expect(scanMacDesktopPictures([root], fs)).toEqual([])
  })

  it('skips images whose head cannot be read', () => {
    const root = '/pics'
    const base = fakeFs({
      [root]: dir(['ghost.heic']),
      [root + '/ghost.heic']: file(HEIC_MAGIC),
    })
    expect(scanMacDesktopPictures([root], {
      ...base,
      readHead: () => { throw new Error('EPERM') },
    })).toEqual([])
  })
})

describe('scanMacosWallpapers', () => {
  const roots = defaultMacosWallpaperRoots('/home/u')

  it('scans nothing off darwin', () => {
    const fs = fakeFs({})
    expect(scanMacosWallpapers(roots, { ...fs, platform: 'linux' })).toEqual([])
    expect(scanMacosWallpapers(roots, { ...fs, platform: 'win32' })).toEqual([])
  })

  it('combines aerials and desktop pictures on darwin', () => {
    const aerialRoot = roots.aerials[0]!
    const pictureRoot = roots.pictures[0]!
    const fs = fakeFs({
      [aerialRoot + '/videos']: dir(['AAAA-1.mov']),
      [aerialRoot + '/videos/AAAA-1.mov']: file(MOV_MAGIC + 'V'),
      [pictureRoot]: dir(['Tahoe Day.heic']),
      [pictureRoot + '/Tahoe Day.heic']: file(HEIC_MAGIC + 'H'),
    })
    const entries = scanMacosWallpapers(roots, { ...fs, platform: 'darwin' })
    expect(entries.map((e) => e.type).sort()).toEqual(['image', 'video'])
  })

  it('exposes the default root layout', () => {
    expect(roots.aerials[0]).toBe('/home/u/Library/Application Support/com.apple.wallpaper/aerials')
    expect(roots.pictures).toContain('/System/Library/Desktop Pictures')
  })
})
