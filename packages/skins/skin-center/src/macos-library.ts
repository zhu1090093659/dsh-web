/**
 * macOS wallpaper auto-discovery for the skin center (host half).
 *
 * Wallpaper Engine ships Windows-only, so on macOS the inventory falls back
 * to the wallpapers macOS itself manages:
 *
 *   1. Aerial (dynamic) wallpapers the user downloaded in System Settings:
 *      - modern layout  ~/Library/Application Support/com.apple.wallpaper/
 *        aerials/videos/<asset-id>.mov with same-stem previews under
 *        aerials/thumbnails/<asset-id>.png and display names in
 *        aerials/manifest/entries.json (the official Apple manifest);
 *      - legacy layout  /Library/Application Support/com.apple.idleassetsd/
 *        Customer/<quality>/<asset-id>.mov (Sonoma and earlier).
 *      Entries become 'video' wallpapers; browsers without HEVC decode fall
 *      back to the thumbnail through the panel's existing video error path.
 *   2. Desktop Pictures (image formats only — .heic/.heif converted through
 *      sips, .jpg/.jpeg/.png/.webp served directly; static and Apple dynamic
 *      wallpapers alike render their first frame): /System/Library/Desktop
 *      Pictures (built-in) and /Library/Desktop Pictures (legacy downloads).
 *
 * Every candidate is validated by extension AND magic bytes (ISO BMFF ftyp
 * for .mov/.heic, JPEG/PNG/WebP signatures for the rest); anything else is
 * skipped even inside a known wallpaper directory.
 *
 * Everything is injectable for tests: roots, platform and filesystem probes
 * are parameters, never hard reads. Scanning is synchronous like the rest
 * of we-library (directory listings only; no file payload is read except
 * the small entries.json manifest).
 * @module @linxin666/dsh-client-ui-skin-center/macos-library
 */

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname as dirnamePath, join as joinPath } from 'node:path'
import type { WallpaperEntry } from './we-library.ts'

/** The macOS wallpaper roots the inventory scans when running on darwin. */
export interface MacosWallpaperRoots {
  /** Aerial roots: <root>/videos, <root>/thumbnails, <root>/manifest/entries.json. */
  aerials: string[]
  /** Desktop Pictures roots scanned one level deep for *.heic. */
  pictures: string[]
}

/** Default roots for the current user (both modern and legacy layouts). */
export function defaultMacosWallpaperRoots(home: string = homedir()): MacosWallpaperRoots {
  return {
    aerials: [
      joinPath(home, 'Library', 'Application Support', 'com.apple.wallpaper', 'aerials'),
      joinPath('/Library', 'Application Support', 'com.apple.idleassetsd', 'Customer'),
    ],
    pictures: [
      joinPath('/System', 'Library', 'Desktop Pictures'),
      joinPath('/Library', 'Desktop Pictures'),
    ],
  }
}

/** Injectable filesystem face (tests). */
export interface MacosScanFs {
  exists?: (path: string) => boolean
  readdir?: (path: string) => string[]
  readFile?: (path: string) => string
  stat?: (path: string) => { mtimeMs: number; size: number; isFile(): boolean; isDirectory(): boolean }
  /** Read the first `bytes` of a file for magic-byte validation. */
  readHead?: (path: string, bytes: number) => Uint8Array
}

interface Fs {
  exists: (path: string) => boolean
  readdir: (path: string) => string[]
  readFile: (path: string) => string
  stat: (path: string) => { mtimeMs: number; size: number; isFile(): boolean; isDirectory(): boolean }
  readHead: (path: string, bytes: number) => Uint8Array
}

/** Default head reader: opens the file and reads at most `bytes` (never whole files — aerials are gigabytes). */
function defaultReadHead(path: string, bytes: number): Uint8Array {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const read = readSync(fd, buffer, 0, bytes, 0)
    return buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

function resolveFs(inject: MacosScanFs): Fs {
  return {
    exists: inject.exists ?? existsSync,
    readdir: inject.readdir ?? readdirSync,
    readFile: inject.readFile ?? ((path: string) => readFileSync(path, 'utf8')),
    stat: inject.stat ?? statSync,
    readHead: inject.readHead ?? defaultReadHead,
  }
}

const bytes = (head: Uint8Array, at: number, text: string): boolean =>
  [...text].every((ch, i) => head[at + i] === ch.charCodeAt(0))

/** ISO BMFF container sniff (size + 'ftyp' + brand): covers .mov and .heic/.heif. */
function hasBmffHeader(head: Uint8Array): boolean {
  return head.length >= 12 && bytes(head, 4, 'ftyp')
}

function hasJpegHeader(head: Uint8Array): boolean {
  return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
}

function hasPngHeader(head: Uint8Array): boolean {
  return head.length >= 8 && head[0] === 0x89 && bytes(head, 1, 'PNG')
}

function hasWebpHeader(head: Uint8Array): boolean {
  return head.length >= 12 && bytes(head, 0, 'RIFF') && bytes(head, 8, 'WEBP')
}

const HEAD_BYTES = 12

/** Content check for aerial videos: extension AND ISO BMFF magic must agree. */
function isMovVideo(name: string, head: Uint8Array): boolean {
  return MOV_RE.test(name) && hasBmffHeader(head)
}

/** Content check for desktop pictures: only image formats, magic verified. */
function isSupportedImage(name: string, head: Uint8Array): boolean {
  if (HEIC_RE.test(name)) return hasBmffHeader(head)
  if (/\.jpe?g$/i.test(name)) return hasJpegHeader(head)
  if (/\.png$/i.test(name)) return hasPngHeader(head)
  if (/\.webp$/i.test(name)) return hasWebpHeader(head)
  return false
}

/** Read a file head for validation; null when unreadable. */
function readHeadOrNull(fs: Fs, path: string): Uint8Array | null {
  try {
    return fs.readHead(path, HEAD_BYTES)
  } catch {
    return null
  }
}

/** Shape of one asset row in Apple's aerial manifest (entries.json). */
interface AerialManifestAsset {
  id?: unknown
  accessibilityLabel?: unknown
}

/**
 * Read asset-id -> display name out of an aerial entries.json. Missing or
 * malformed manifests yield an empty map (titles then fall back to the file
 * stem). Only accessibilityLabel is trusted: it is the user-visible name in
 * System Settings across locales.
 */
export function readAerialManifest(text: string): Map<string, string> {
  const titles = new Map<string, string>()
  try {
    const raw: unknown = JSON.parse(text)
    if (typeof raw !== 'object' || raw === null) return titles
    const assets = (raw as { assets?: unknown }).assets
    if (!Array.isArray(assets)) return titles
    for (const asset of assets as AerialManifestAsset[]) {
      if (typeof asset !== 'object' || asset === null) continue
      if (typeof asset.id === 'string'
        && typeof asset.accessibilityLabel === 'string'
        && asset.accessibilityLabel !== '') {
        titles.set(asset.id, asset.accessibilityLabel)
      }
    }
  } catch {
    // Invalid JSON: empty map.
  }
  return titles
}

const MOV_RE = /\.mov$/i
const HEIC_RE = /\.hei[cf]$/i

function statOrZero(fs: Fs, path: string): { mtimeMs: number; size: number; isFile: boolean } {
  try {
    const stat = fs.stat(path)
    return { mtimeMs: stat.mtimeMs, size: stat.size, isFile: stat.isFile() }
  } catch {
    return { mtimeMs: 0, size: 0, isFile: false }
  }
}

/** Build one aerial entry; the preview is the same-stem thumbnail when downloaded. */
function aerialEntry(id: string, title: string, videoAbs: string, previewAbs: string | null, fs: Fs): WallpaperEntry {
  const stat = statOrZero(fs, videoAbs)
  return {
    id: 'macos-aerial/' + id,
    title,
    type: 'video',
    file: videoAbs,
    preview: previewAbs,
    // dir stays the containing folder for fingerprinting; 'system' entries
    // are never importable (the /import route rejects them), so the dir is
    // never copied wholesale.
    dir: dirnamePath(videoAbs),
    fileAbs: videoAbs,
    previewAbs: previewAbs !== null && fs.exists(previewAbs) ? previewAbs : null,
    source: 'system',
    playable: stat.isFile,
    srcMtime: stat.mtimeMs,
    srcSize: stat.size,
    updateAvailable: false,
  }
}

/**
 * Scan the modern per-user aerial layout: <root>/videos/*.mov with titles
 * from <root>/manifest/entries.json and previews from <root>/thumbnails.
 */
function scanAerialsModern(root: string, fs: Fs): WallpaperEntry[] {
  const videosDir = joinPath(root, 'videos')
  if (!fs.exists(videosDir)) return []
  let names: string[] = []
  try {
    names = fs.readdir(videosDir)
  } catch {
    return []
  }
  let titles = new Map<string, string>()
  const manifestPath = joinPath(root, 'manifest', 'entries.json')
  if (fs.exists(manifestPath)) {
    try {
      titles = readAerialManifest(fs.readFile(manifestPath))
    } catch {
      // Unreadable manifest: titles fall back to the asset id.
    }
  }
  const thumbnailsDir = joinPath(root, 'thumbnails')
  const entries: WallpaperEntry[] = []
  for (const name of names) {
    if (!MOV_RE.test(name)) continue
    const videoAbs = joinPath(videosDir, name)
    const head = readHeadOrNull(fs, videoAbs)
    if (head === null || !isMovVideo(name, head)) continue
    const id = name.replace(MOV_RE, '')
    const thumbnail = joinPath(thumbnailsDir, id + '.png')
    entries.push(aerialEntry(id, titles.get(id) ?? id, videoAbs, thumbnail, fs))
  }
  return entries
}

/**
 * Scan the legacy system-wide aerial layout: <root>/<quality>/<id>.mov
 * (2KSDR / 4KHDR / …). Titles come from <root>/entries.json when present.
 */
function scanAerialsLegacy(root: string, fs: Fs): WallpaperEntry[] {
  if (!fs.exists(root)) return []
  let names: string[] = []
  try {
    names = fs.readdir(root)
  } catch {
    return []
  }
  let titles = new Map<string, string>()
  const manifestPath = joinPath(root, 'entries.json')
  if (fs.exists(manifestPath)) {
    try {
      titles = readAerialManifest(fs.readFile(manifestPath))
    } catch {
      // titles fall back to the asset id
    }
  }
  const entries: WallpaperEntry[] = []
  for (const name of names) {
    const sub = joinPath(root, name)
    try {
      if (!fs.stat(sub).isDirectory()) continue
    } catch {
      continue
    }
    let videos: string[] = []
    try {
      videos = fs.readdir(sub)
    } catch {
      continue
    }
    for (const video of videos) {
      if (!MOV_RE.test(video)) continue
      const videoAbs = joinPath(sub, video)
      const head = readHeadOrNull(fs, videoAbs)
      if (head === null || !isMovVideo(video, head)) continue
      const id = video.replace(MOV_RE, '')
      entries.push(aerialEntry(id, titles.get(id) ?? id, videoAbs, null, fs))
    }
  }
  return entries
}

/**
 * Scan every configured aerial root. A root holding a videos/ subdirectory
 * is treated as the modern layout; otherwise as the legacy quality-folder
 * layout. Entries de-dupe by asset id (first root wins).
 */
export function scanMacAerials(roots: string[], inject: MacosScanFs = {}): WallpaperEntry[] {
  const fs = resolveFs(inject)
  const found = new Map<string, WallpaperEntry>()
  for (const root of roots) {
    const entries = fs.exists(joinPath(root, 'videos'))
      ? scanAerialsModern(root, fs)
      : scanAerialsLegacy(root, fs)
    for (const entry of entries) {
      if (!found.has(entry.id)) found.set(entry.id, entry)
    }
  }
  return [...found.values()]
}

/**
 * Scan Desktop Pictures roots for *.heic wallpapers (static + Apple dynamic;
 * only the first frame is rendered). .madesktop records are data files, not
 * folders, and are skipped. Entries de-dupe by stem (first root wins).
 */
export function scanMacDesktopPictures(roots: string[], inject: MacosScanFs = {}): WallpaperEntry[] {
  const fs = resolveFs(inject)
  const found = new Map<string, WallpaperEntry>()
  for (const root of roots) {
    if (!fs.exists(root)) continue
    let names: string[] = []
    try {
      names = fs.readdir(root)
    } catch {
      continue
    }
    for (const name of names) {
      const fileAbs = joinPath(root, name)
      const head = readHeadOrNull(fs, fileAbs)
      if (head === null || !isSupportedImage(name, head)) continue
      const stem = name.replace(/\.[a-z0-9]+$/i, '')
      const id = 'macos-image/' + stem
      if (found.has(id)) continue
      const stat = statOrZero(fs, fileAbs)
      found.set(id, {
        id,
        title: stem,
        type: 'image',
        file: name,
        preview: null,
        dir: root,
        fileAbs,
        // HEIC is not browser-renderable: the /image route converts through
        // sips lazily, so no preview path exists at scan time.
        previewAbs: null,
        source: 'system',
        playable: false,
        srcMtime: stat.mtimeMs,
        srcSize: stat.size,
        updateAvailable: false,
      })
    }
  }
  return [...found.values()]
}

/** Scan every macOS wallpaper source; empty off darwin. */
export function scanMacosWallpapers(
  roots: MacosWallpaperRoots,
  inject: MacosScanFs & { platform?: NodeJS.Platform } = {},
): WallpaperEntry[] {
  const platform = inject.platform ?? process.platform
  if (platform !== 'darwin') return []
  return [...scanMacAerials(roots.aerials, inject), ...scanMacDesktopPictures(roots.pictures, inject)]
}
