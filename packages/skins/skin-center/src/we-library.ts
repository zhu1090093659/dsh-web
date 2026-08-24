/**
 * Wallpaper Engine library discovery for the skin center (host half).
 *
 * Enumerates locally installed Wallpaper Engine wallpapers so the browser
 * half can list, preview and render them. Discovery sources, in order:
 *
 *   1. The WE install itself (Steam app 431960), located on Windows through
 *      the HKCU Steam registry value plus libraryfolders.vdf, falling back to
 *      common probe paths. Its projects/defaultprojects and
 *      projects/myprojects folders are scanned, and every Steam library that
 *      owns app 431960 contributes its steamapps/workshop/content/431960
 *      directory.
 *   2. Manual library folders (the skin-wallpaper settings field
 *      weLibraryDirs): each entry may be a folder of wallpaper projects (like
 *      a workshop content dir) or a single project folder. A folder without
 *      a project.json is accepted when it directly contains a playable media
 *      file (e.g. a lone .mp4), which is the no-Steam fallback path.
 *   3. macOS wallpaper stores (darwin only, src/macos-library.ts): the
 *      user's downloaded aerial .mov wallpapers (com.apple.wallpaper /
 *      idleassetsd) and Desktop Pictures *.heic — source 'system', never
 *      importable.
 *   4. The import store (<harnessHome>/skin-center/wallpapers/<id>/): copies
 *      made by the import route. Each holds a manifest.json recording the
 *      source identity and the source file mtime/size at import time, so a
 *      later workshop update can be flagged as updateAvailable.
 *
 * Entries are plain data; the HTTP layer (src/we-routes.ts) assigns media
 * tokens and decides what is playable. Everything here is injectable for
 * tests: roots, platform and environment are parameters, never hard reads.
 * @module @linxin666/dsh-client-ui-skin-center/we-library
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join as joinPath, resolve as resolvePath } from 'node:path'
import { defaultMacosWallpaperRoots, scanMacosWallpapers, type MacosWallpaperRoots } from './macos-library.ts'

export type { MacosWallpaperRoots } from './macos-library.ts'

/** Steam appid of Wallpaper Engine. */
export const WE_APPID = '431960'

/** Wallpaper Engine wallpaper kinds, as declared by project.json. 'image' is the macOS Desktop Pictures extension (HEIC rendered via host conversion). */
export type WallpaperType = 'video' | 'web' | 'scene' | 'application' | 'image'

/** Where one wallpaper entry came from. 'system' entries are macOS-managed and never importable. */
export type WallpaperSource = 'workshop' | 'local' | 'imported' | 'system'

/** One discovered wallpaper project (plain data; routes assign tokens). */
export interface WallpaperEntry {
  /** Stable id: project dir basename for scanned entries, imported id for store entries. */
  id: string
  /** Display title (project.json title or dir name). */
  title: string
  /** Wallpaper kind (video/web are portable, scene degrades to a static frame). */
  type: WallpaperType
  /** Main file path relative to dir (project.json file field, or inferred). */
  file: string
  /** Preview image path relative to dir, when present. */
  preview: string | null
  /** Absolute project directory. */
  dir: string
  /** Absolute main file path (may not exist for scene/application). */
  fileAbs: string
  /** Absolute preview path, when present. */
  previewAbs: string | null
  /** Discovery source. */
  source: WallpaperSource
  /** Main file exists and the type is renderable in the browser (video/web). */
  playable: boolean
  /** Main-file mtime (ms) and size (bytes); 0 when the file is missing. */
  srcMtime: number
  srcSize: number
  /** True when this imported entry's original source has changed since import. */
  updateAvailable: boolean
  /** Imported entries only: source mtime/size recorded in the manifest at import time. */
  importSrcMtime?: number
  importSrcSize?: number
}

/** The import-store manifest (<store>/<id>/manifest.json). */
export interface ImportedManifest {
  /** The workshop/project id this copy was imported from. */
  sourceId: string
  /** Title at import time. */
  title: string
  /** Wallpaper type at import time. */
  type: WallpaperType
  /** Source main-file mtime (ms) and size (bytes) at import time. */
  srcMtime: number
  srcSize: number
  /** Import timestamp (ms). */
  importedAt: number
  /** Main file path relative to the entry dir (inside project/). */
  file: string
  /** Preview path relative to the entry dir, when present. */
  preview: string | null
}

/** The assembled inventory returned to the browser half. */
export interface WeInventory {
  /** The located WE install dir, or null when not found / not applicable. */
  installDir: string | null
  /** Steam library roots that own app 431960. */
  libraryDirs: string[]
  total: number
  /** Entries playable in the browser (video/web with an existing main file). */
  portableCount: number
  wallpapers: WallpaperEntry[]
}

/** Common Steam install locations probed when libraryfolders.vdf is missing. */
const STEAM_PROBE_DIRS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'D:\\SteamLibrary',
  'E:\\SteamLibrary',
]

/**
 * Expand a leading '~' to the user's home directory (manual library folder
 * settings are typed by humans, and existsSync does not understand '~').
 */
export function expandUser(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return joinPath(homedir(), path.slice(2))
  return path
}

/** First non-blank value, trimmed. */
function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/**
 * The Steam root recorded by the Windows installer (HKCU\\Software\\Valve\\Steam).
 * Returns null off Windows or when reg.exe fails. Injectable for tests.
 * @param run - reg.exe runner (defaults to execFileSync).
 */
export function steamPathFromRegistry(
  run: () => string = () => execFileSync(
    joinPath(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'),
    ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
    { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
  ),
): string | null {
  if (process.platform !== 'win32') return null
  try {
    const match = /SteamPath\s+REG_SZ\s+(.+)/i.exec(run())
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

/**
 * Memoize a zero-argument probe so it runs at most once per process.
 * The default Windows registry probe is wrapped in this: reg.exe is a
 * synchronous child process with a 5s timeout on the request path, and a
 * Steam install path is stable for the life of the host process, so one
 * probe per process is enough. Injected probes (tests) bypass the memo —
 * only the default runner is wrapped.
 */
export function memoizedProbe(probe: () => string | null): () => string | null {
  let cached: string | null | undefined
  return () => {
    if (cached === undefined) cached = probe()
    return cached
  }
}

/** Default registry probe, process-memoized (see memoizedProbe). */
const defaultRegistryProbe = memoizedProbe(() => steamPathFromRegistry())

/** Parse libraryfolders.vdf for library roots that own app 431960. */
export function librariesFromVdf(vdfText: string): string[] {
  const libraries: string[] = []
  let current: string | null = null
  for (const line of vdfText.split(/\r?\n/)) {
    const match = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line)
    if (match) {
      current = match[1].replace(/\\\\/g, '\\')
      continue
    }
    if (current && line.includes(WE_APPID) && !libraries.includes(current)) {
      libraries.push(current)
    }
  }
  return libraries
}

/** Every Steam library root listed in libraryfolders.vdf, independent of its stale apps cache. */
export function allLibrariesFromVdf(vdfText: string): string[] {
  const libraries: string[] = []
  for (const line of vdfText.split(/\r?\n/)) {
    const match = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line)
    if (match === null) continue
    const root = match[1].replace(/\\\\/g, '\\')
    if (!libraries.includes(root)) libraries.push(root)
  }
  return libraries
}

/** Durable ownership fact used when libraryfolders.vdf has not refreshed its apps block. */
export function libraryOwnsAppFromManifest(
  library: string,
  appid: string,
  exists: (path: string) => boolean = existsSync,
): boolean {
  return exists(joinPath(library, 'steamapps', `appmanifest_${appid}.acf`))
}

/**
 * Locate the Wallpaper Engine install directory (holds wallpaper32.exe).
 * Probes: registry Steam root, well-known paths, then every library that
 * owns the app. Non-Windows platforms return null (WE ships Windows-only;
 * manual library folders are the fallback there).
 * @param opts.env - environment (tests inject).
 * @param opts.exists - existence probe (tests inject).
 */
export function locateWallpaperEngine(opts: {
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
  registry?: () => string | null
} = {}): string | null {
  const exists = opts.exists ?? existsSync
  const env = opts.env ?? process.env
  if ((env.OS ?? '') !== '' || process.platform === 'win32') {
    const registry = opts.registry ?? defaultRegistryProbe
    const probes = [...new Set([registry(), ...STEAM_PROBE_DIRS].filter((d): d is string => !!d))]
    const libraries: string[] = []
    for (const probe of probes) {
      const vdf = joinPath(probe, 'steamapps', 'libraryfolders.vdf')
      if (exists(vdf)) {
        try {
          libraries.push(...allLibrariesFromVdf(readFileSync(vdf, 'utf8')))
        } catch {
          // Unreadable vdf: skip this probe.
        }
      }
    }
    const candidates: string[] = []
    for (const root of [...probes, ...libraries]) {
      candidates.push(joinPath(root, 'steamapps', 'common', 'wallpaper_engine'))
    }
    candidates.push('C:\\Program Files (x86)\\Wallpaper Engine')
    for (const dir of candidates) {
      if (exists(joinPath(dir, 'wallpaper32.exe'))) return dir
    }
  }
  return null
}

/**
 * Steam library roots that own app 431960 (for the workshop content dir).
 * Empty on non-Windows or when nothing is found.
 */
export function owningLibraries(opts: {
  exists?: (path: string) => boolean
  registry?: () => string | null
} = {}): string[] {
  const exists = opts.exists ?? existsSync
  if (process.platform !== 'win32' && !opts.exists) return []
  const registry = opts.registry ?? defaultRegistryProbe
  const probes = [...new Set([registry(), ...STEAM_PROBE_DIRS].filter((d): d is string => !!d))]
  const libraries = new Set<string>()
  for (const probe of probes) {
    const vdf = joinPath(probe, 'steamapps', 'libraryfolders.vdf')
    if (!exists(vdf)) continue
    let vdfText: string
    try {
      vdfText = readFileSync(vdf, 'utf8')
    } catch {
      continue
    }
    for (const root of librariesFromVdf(vdfText)) libraries.add(root)
    for (const root of allLibrariesFromVdf(vdfText)) {
      if (libraryOwnsAppFromManifest(root, WE_APPID, exists)) libraries.add(root)
    }
  }
  return [...libraries]
}

/** Infer the wallpaper type from the main file extension (project.json fallback). */
export function inferType(file: string): WallpaperType {
  if (/\.(mp4|webm|mkv|avi|mov)$/i.test(file)) return 'video'
  if (/\.(html?|js)$/i.test(file)) return 'web'
  return 'scene'
}

// Only the four project.json kinds: 'image' is reserved for the macOS
// scanner (it builds entries directly) and must never become parseable from
// a workshop project.json, keeping WE parsing behavior identical.
const KNOWN_TYPES: readonly WallpaperType[] = ['scene', 'video', 'web', 'application']

/** Media file extensions playable through the video element. */
const VIDEO_FILE_RE = /\.(mp4|webm|mkv|avi|mov)$/i
/** Web entry files. */
const WEB_FILE_RE = /\.html?$/i

interface ProjectJson {
  title: string | null
  type: WallpaperType
  file: string
  preview: string | null
}

/** Read one project directory's project.json; null when absent/invalid. */
export function readProjectJson(dir: string): ProjectJson | null {
  const path = joinPath(dir, 'project.json')
  if (!existsSync(path)) return null
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof raw !== 'object' || raw === null) return null
    const record = raw as Record<string, unknown>
    if (typeof record.file !== 'string' || record.file === '') return null
    const declared = typeof record.type === 'string' ? record.type.toLowerCase() : ''
    const type = (KNOWN_TYPES as string[]).includes(declared)
      ? (declared as WallpaperType)
      : inferType(record.file)
    return {
      title: typeof record.title === 'string' && record.title !== '' ? record.title : null,
      type,
      file: record.file,
      preview: typeof record.preview === 'string' && record.preview !== '' ? record.preview : null,
    }
  } catch {
    return null
  }
}

/**
 * Synthesize one entry per playable media file for a folder without a
 * project.json (the no-Steam fallback: the user points a manual folder at a
 * pile of .mp4/.webm files or an index.html site — every video becomes its
 * own wallpaper). A same-stem image (loop.mp4 -> loop.jpg) becomes the
 * entry's preview when present.
 */
function synthesizeMediaEntries(dir: string, source: WallpaperSource): WallpaperEntry[] {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const media = names.filter((name) => VIDEO_FILE_RE.test(name) || WEB_FILE_RE.test(name))
  const images = names.filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name))
  const entries: WallpaperEntry[] = []
  for (const file of media) {
    const stem = file.replace(/\.[^.]+$/, '')
    const preview = images.find((image) => image.replace(/\.[^.]+$/, '') === stem) ?? null
    entries.push(entryFromDir(dir, source, { title: stem, type: inferType(file), file, preview }, basename(dir) + '/' + file))
  }
  return entries
}

/**
 * Resolve a scene project's real main container. project.json's file field
 * is trusted when it exists on disk, but workshop items frequently declare
 * `scene.json` while shipping only the packed `scene.pkg` (and loose
 * projects ship the reverse) — probe the declared file, then scene.pkg,
 * then scene.json, then a single *.pkg in the directory (#521). Returns the
 * hit relative to dir, or null when nothing matches.
 */
export function resolveSceneMainFile(dir: string, declared: string): string | null {
  for (const candidate of [declared, 'scene.pkg', 'scene.json']) {
    if (candidate === '') continue
    try {
      if (statSync(resolvePath(dir, candidate)).isFile()) return candidate
    } catch {
      // keep probing
    }
  }
  let pkgs: string[] = []
  try {
    pkgs = readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.pkg'))
  } catch {
    return null
  }
  return pkgs.length === 1 ? pkgs[0] : null
}

/** Build one entry from a project directory. */
function entryFromDir(dir: string, source: WallpaperSource, project: ProjectJson, id?: string): WallpaperEntry {
  // A scene project's declared file is only a hint (#521); resolve the
  // container that actually exists so frameUrl, stats and imports follow it.
  const file = project.type === 'scene' ? resolveSceneMainFile(dir, project.file) ?? project.file : project.file
  const fileAbs = resolvePath(dir, file)
  const previewAbs = project.preview ? resolvePath(dir, project.preview) : null
  let mtime = 0
  let size = 0
  let fileExists = false
  try {
    const stat = statSync(fileAbs)
    if (stat.isFile()) {
      fileExists = true
      mtime = stat.mtimeMs
      size = stat.size
    }
  } catch {
    // Missing main file: keep zeros.
  }
  return {
    id: id ?? basename(dir),
    title: project.title ?? basename(dir),
    type: project.type,
    file,
    preview: project.preview,
    dir,
    fileAbs,
    previewAbs: previewAbs && existsSync(previewAbs) ? previewAbs : null,
    source,
    playable: fileExists && (project.type === 'video' || project.type === 'web'),
    srcMtime: mtime,
    srcSize: size,
    updateAvailable: false,
  }
}

/**
 * Scan one root folder of wallpaper projects (workshop content dir,
 * defaultprojects, myprojects, or a manual library folder). A root that is
 * itself a project (has project.json) yields one entry; a manual root
 * holding loose media files yields one entry per file; otherwise each
 * immediate subdirectory is probed the same way.
 */
export function scanProjectsRoot(root: string, source: WallpaperSource): WallpaperEntry[] {
  const direct = readProjectJson(root)
  if (direct) return [entryFromDir(root, source, direct)]
  if (source === 'local') {
    const synthesized = synthesizeMediaEntries(root, source)
    if (synthesized.length > 0) return synthesized
  }
  let names: string[] = []
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  const entries: WallpaperEntry[] = []
  for (const name of names) {
    const dir = joinPath(root, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const project = readProjectJson(dir)
    if (project) entries.push(entryFromDir(dir, source, project))
    else if (source === 'local') entries.push(...synthesizeMediaEntries(dir, source))
  }
  return entries
}

/**
 * Scan a user-supplied path at any supported Wallpaper Engine level: a
 * project folder, project collection, WE install root, Steam library root,
 * steamapps folder, or workshop content root.
 */
export function scanManualWallpaperRoot(root: string): WallpaperEntry[] {
  const candidates: Array<{ root: string; source: WallpaperSource }> = [
    { root, source: 'local' },
    { root: joinPath(root, 'projects', 'defaultprojects'), source: 'local' },
    { root: joinPath(root, 'projects', 'myprojects'), source: 'local' },
    { root: joinPath(root, 'steamapps', 'workshop', 'content', WE_APPID), source: 'workshop' },
    { root: joinPath(root, 'workshop', 'content', WE_APPID), source: 'workshop' },
  ]
  if (basename(root).toLowerCase() === 'wallpaper_engine') {
    candidates.push({
      root: joinPath(dirname(dirname(root)), 'workshop', 'content', WE_APPID),
      source: 'workshop',
    })
  }
  const found = new Map<string, WallpaperEntry>()
  for (const candidate of candidates) {
    if (!existsSync(candidate.root)) continue
    for (const entry of scanProjectsRoot(candidate.root, candidate.source)) {
      if (!found.has(entry.id)) found.set(entry.id, entry)
    }
  }
  return [...found.values()]
}

/** Read one import-store entry's manifest.json; null when absent/invalid. */
export function readImportedManifest(entryDir: string): ImportedManifest | null {
  const path = joinPath(entryDir, 'manifest.json')
  if (!existsSync(path)) return null
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof raw !== 'object' || raw === null) return null
    const record = raw as Record<string, unknown>
    if (typeof record.sourceId !== 'string' || typeof record.file !== 'string') return null
    const declared = typeof record.type === 'string' ? record.type.toLowerCase() : ''
    return {
      sourceId: record.sourceId,
      title: typeof record.title === 'string' && record.title !== '' ? record.title : basename(entryDir),
      type: (KNOWN_TYPES as string[]).includes(declared) ? (declared as WallpaperType) : inferType(record.file),
      srcMtime: typeof record.srcMtime === 'number' ? record.srcMtime : 0,
      srcSize: typeof record.srcSize === 'number' ? record.srcSize : 0,
      importedAt: typeof record.importedAt === 'number' ? record.importedAt : 0,
      file: record.file,
      preview: typeof record.preview === 'string' && record.preview !== '' ? record.preview : null,
    }
  } catch {
    return null
  }
}

/**
 * Scan the import store (<harnessHome>/skin-center/wallpapers). Each child
 * directory with a manifest.json becomes an 'imported' entry whose project
 * files live under project/.
 * @param storeDir - the wallpapers store root.
 */
export function scanImportStore(storeDir: string): WallpaperEntry[] {
  let names: string[] = []
  try {
    names = readdirSync(storeDir)
  } catch {
    return []
  }
  const entries: WallpaperEntry[] = []
  for (const name of names) {
    const dir = joinPath(storeDir, name)
    const manifest = readImportedManifest(dir)
    if (!manifest) continue
    const projectDir = joinPath(dir, 'project')
    // Heal manifests written from a wrong declared scene file (#521):
    // re-resolve the container inside the copied project directory.
    const declaredRel = manifest.file.replace(/^project[\\/]/, '')
    const file = manifest.type === 'scene'
      ? joinPath('project', resolveSceneMainFile(projectDir, declaredRel) ?? declaredRel)
      : manifest.file
    const fileAbs = resolvePath(dir, file)
    const previewAbs = manifest.preview ? resolvePath(dir, manifest.preview) : null
    let mtime = 0
    let size = 0
    let fileExists = false
    try {
      const stat = statSync(fileAbs)
      if (stat.isFile()) {
        fileExists = true
        mtime = stat.mtimeMs
        size = stat.size
      }
    } catch {
      // Missing copy: keep zeros.
    }
    // A scene import is playable through the extracted frame route even
    // though the raw .pkg is not browser-renderable; the routes layer
    // decides. Here 'playable' stays the video/web definition.
    entries.push({
      id: `imported/${manifest.sourceId}`,
      title: manifest.title,
      type: manifest.type,
      file,
      preview: manifest.preview,
      dir: projectDir,
      fileAbs,
      previewAbs: previewAbs && existsSync(previewAbs) ? previewAbs : null,
      source: 'imported',
      playable: fileExists && (manifest.type === 'video' || manifest.type === 'web'),
      srcMtime: mtime,
      srcSize: size,
      updateAvailable: false,
      importSrcMtime: manifest.srcMtime,
      importSrcSize: manifest.srcSize,
    })
  }
  return entries
}

/** The default import-store root under the harness home. */
export function defaultWallpapersStoreDir(harnessHome: string): string {
  return joinPath(harnessHome, 'skin-center', 'wallpapers')
}

/**
 * Assemble the full inventory: WE install projects + workshop content of
 * every owning library + manual library folders + the import store, with
 * update detection joining imported manifests back to their sources.
 * All filesystem inputs are injectable for tests.
 */
export function buildInventory(opts: {
  installDir?: string | null
  libraryDirs?: string[]
  manualDirs?: string[]
  storeDir?: string
  autoDetect?: boolean
  /**
   * macOS wallpaper roots. Undefined + autoDetect scans the default roots on
   * darwin; null disables the macOS sources explicitly.
   */
  macos?: MacosWallpaperRoots | null
  /** Platform override for tests (the macOS scanner gates on darwin). */
  platform?: NodeJS.Platform
} = {}): WeInventory {
  const autoDetect = opts.autoDetect ?? true
  const installDir = opts.installDir !== undefined ? opts.installDir : (autoDetect ? locateWallpaperEngine() : null)
  const libraryDirs = opts.libraryDirs ?? (autoDetect ? owningLibraries() : [])
  const macos = opts.macos !== undefined
    ? opts.macos
    : (autoDetect && process.platform === 'darwin' ? defaultMacosWallpaperRoots() : null)
  const found = new Map<string, WallpaperEntry>()
  const add = (entry: WallpaperEntry): void => {
    if (!found.has(entry.id)) found.set(entry.id, entry)
  }

  if (installDir) {
    for (const sub of ['defaultprojects', 'myprojects']) {
      const root = joinPath(installDir, 'projects', sub)
      if (existsSync(root)) for (const entry of scanProjectsRoot(root, 'local')) add(entry)
    }
  }
  for (const library of libraryDirs) {
    const root = joinPath(library, 'steamapps', 'workshop', 'content', WE_APPID)
    if (existsSync(root)) for (const entry of scanProjectsRoot(root, 'workshop')) add(entry)
  }
  for (const manual of opts.manualDirs ?? []) {
    const trimmed = firstNonBlank(manual)
    const dir = trimmed !== undefined ? expandUser(trimmed) : undefined
    if (dir !== undefined && existsSync(dir)) for (const entry of scanManualWallpaperRoot(dir)) add(entry)
  }
  if (macos !== null) {
    for (const entry of scanMacosWallpapers(macos, { platform: opts.platform })) add(entry)
  }

  const imported = opts.storeDir ? scanImportStore(opts.storeDir) : []
  for (const entry of imported) {
    // Update detection: the source project is newer than it was at import
    // time (mtime advanced or size changed vs the manifest snapshot).
    const source = found.get(entry.id.replace(/^imported\//, ''))
    if (source && source.srcMtime > 0 &&
        (source.srcMtime > (entry.importSrcMtime ?? 0) || source.srcSize !== (entry.importSrcSize ?? -1))) {
      entry.updateAvailable = true
    }
    add(entry)
  }

  const wallpapers = [...found.values()].sort((a, b) => a.title.localeCompare(b.title))
  return {
    installDir: installDir ?? null,
    libraryDirs,
    total: wallpapers.length,
    portableCount: wallpapers.filter((w) => w.playable).length,
    wallpapers,
  }
}

/**
 * Staleness fingerprint of everything buildInventory reads, so callers can
 * cache the assembled inventory and re-scan only when this changes.
 *
 * Signed inputs, in order:
 *   - every scan root's existence + directory mtime, including roots that
 *     do not exist yet (a project added or removed under a root changes its
 *     mtime; a root that appears later flips 'missing' into an mtime);
 *   - per previously scanned entry: the project dir mtime, the
 *     project.json / manifest.json mtime and the main + preview file
 *     mtime/size. A root mtime alone cannot see a file rewritten in place
 *     (workshop updates replace files inside an existing project dir
 *     without touching the root), and update detection compares source
 *     mtimes, so entries are signed individually.
 *
 * The caller supplies the current detection result (installDir and
 * libraryDirs) — detection itself is cheap because the default registry
 * probe is process-memoized — and the config (manualDirs), so a changed
 * Steam layout or a settings edit also invalidates. The key for a freshly
 * scanned value must be computed from that value's own entries (the
 * previous entry set described the previous scan, not this one).
 */
export function inventoryFingerprint(opts: {
  installDir?: string | null
  libraryDirs?: string[]
  manualDirs?: string[]
  storeDir?: string
  entries?: WallpaperEntry[]
  /** macOS roots in effect; their sub-layout dirs are signed too. */
  macos?: MacosWallpaperRoots | null
} = {}): string {
  const parts: string[] = []
  const statSig = (path: string): string => {
    try {
      const stats = statSync(path)
      return String(stats.mtimeMs) + ':' + (stats.isDirectory() ? 'd' : String(stats.size))
    } catch {
      return 'missing'
    }
  }
  const signDir = (dir: string): void => { parts.push('d:' + dir + '\u0000' + statSig(dir)) }
  const signFile = (file: string): void => { parts.push('f:' + file + '\u0000' + statSig(file)) }

  const installDir = opts.installDir ?? null
  if (installDir) {
    signDir(joinPath(installDir, 'projects', 'defaultprojects'))
    signDir(joinPath(installDir, 'projects', 'myprojects'))
  }
  for (const library of opts.libraryDirs ?? []) {
    signDir(joinPath(library, 'steamapps', 'workshop', 'content', WE_APPID))
  }
  for (const manual of opts.manualDirs ?? []) {
    const trimmed = firstNonBlank(manual)
    if (trimmed === undefined) continue
    const dir = expandUser(trimmed)
    signDir(dir)
    signDir(joinPath(dir, 'projects', 'defaultprojects'))
    signDir(joinPath(dir, 'projects', 'myprojects'))
    signDir(joinPath(dir, 'steamapps', 'workshop', 'content', WE_APPID))
    signDir(joinPath(dir, 'workshop', 'content', WE_APPID))
    if (basename(dir).toLowerCase() === 'wallpaper_engine') {
      signDir(joinPath(dirname(dirname(dir)), 'workshop', 'content', WE_APPID))
    }
  }
  if (opts.storeDir) signDir(opts.storeDir)
  if (opts.macos) {
    for (const root of opts.macos.aerials) {
      signDir(joinPath(root, 'videos'))
      signDir(joinPath(root, 'thumbnails'))
      signFile(joinPath(root, 'manifest', 'entries.json'))
      // Legacy layout fingerprints its quality folders via the videos they
      // hold; the root dir mtime covers folders appearing or disappearing.
      signDir(root)
    }
    for (const root of opts.macos.pictures) {
      signDir(root)
    }
  }
  for (const entry of opts.entries ?? []) {
    // Imported projects keep their manifest one level above the copied
    // project dir; scanned projects keep project.json inside the dir.
    const manifest = entry.source === 'imported'
      ? joinPath(dirname(entry.dir), 'manifest.json')
      : joinPath(entry.dir, 'project.json')
    signDir(entry.dir)
    signFile(manifest)
    signFile(entry.fileAbs)
    // A preview appearing or disappearing changes the project dir mtime
    // (already signed); only an in-place rewrite needs its own signature.
    if (entry.previewAbs) signFile(entry.previewAbs)
  }
  return parts.join(';')
}
