/**
 * Runtime plugin installation.
 *
 * `dsh plugin add <pkg>` shells out to pnpm and appends the package's bundle to
 * the profile manifest. There is no pnpm here, but every step it performs has a
 * browser equivalent: the npm registry serves package metadata and tarballs
 * with permissive CORS, the tarball unpacks into the virtual filesystem, and
 * the package's `cordis.patch.yml` becomes another patch layer on the root
 * include — the same mechanism, the same layer order.
 *
 * The installed set is durable (it lives in the virtual filesystem alongside
 * the packages), so a plugin installed once is still there after a reload.
 */

import type { Context } from '@deepseek-ai/cordis'
import { loadOptionalPatches, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { extractTarball } from './tar.ts'
import { importInstalledPackage, PLUGIN_MODULES_ROOT, resolveInstalled } from './esm-loader.ts'
import { isSharedModule, registerRuntimeLoader } from '../host/module-system.ts'
import { volume } from '../vfs/volume.ts'
import { resolveSource, type PackageSource } from './sources.ts'
import { toBytes, toText } from '../node/binary.ts'
import { dirname } from '../vfs/path.ts'
import { DEPLOY_ROOT, SHIPPED_BUNDLES } from '../host/seed.ts'
import { setPluginManager } from '../../packages/dsh-web-plugins/src/index.ts'

/** Where the installed-plugin roster lives. */
const ROSTER_PATH = `${DEPLOY_ROOT}/plugins/installed.json`

/** Default registry; a deployment can point this at a mirror. */
const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

/** Packages the app already provides; installing a second copy would fork cordis. */
const PROVIDED_PREFIXES = ['@deepseek-ai/']

/** One roster entry. */
export interface InstalledPlugin {
  /** npm package name. */
  name: string
  /** Exact installed version. */
  version: string
  /** Whether its bundle patch is applied to the composition. */
  enabled: boolean
  /** Relative path of its `cordis.patch.yml`, when it declares one. */
  patch?: string
  /** Whether the package ships a browser client half. */
  hasClient: boolean
  /** The specifier the composition mounts; absent for library-only packages. */
  bundleName?: string
}

/** The roster file's shape. */
interface Roster {
  plugins: InstalledPlugin[]
}

/** Read the roster, tolerating a missing or corrupt file. */
function readRoster(): Roster {
  if (!volume.exists(ROSTER_PATH)) return { plugins: [] }
  try {
    const parsed = JSON.parse(toText(volume.readFile(ROSTER_PATH))) as Roster
    return Array.isArray(parsed.plugins) ? parsed : { plugins: [] }
  } catch {
    return { plugins: [] }
  }
}

/** Persist the roster. */
function writeRoster(roster: Roster): void {
  volume.mkdirp(dirname(ROSTER_PATH))
  volume.writeFile(ROSTER_PATH, toBytes(JSON.stringify(roster, null, 2)))
}

/** Resolve a `name@range` spec against the registry. */
async function resolveVersion(name: string, range: string | undefined, registry: string): Promise<{ version: string, tarball: string, manifest: Record<string, unknown> }> {
  const response = await fetch(`${registry}/${name.replace('/', '%2f')}`)
  if (!response.ok) throw new Error(`registry: ${name} not found (${String(response.status)})`)
  const document = await response.json() as {
    'dist-tags': Record<string, string>
    versions: Record<string, Record<string, unknown>>
  }
  const versions = Object.keys(document.versions)
  let version: string | undefined
  if (range === undefined || range === 'latest') {
    version = document['dist-tags'].latest
  } else if (document.versions[range] !== undefined) {
    version = range
  } else if (document['dist-tags'][range] !== undefined) {
    version = document['dist-tags'][range]
  } else {
    // Only the common `^`/`~`/exact forms are honored; anything else falls back
    // to the newest published version, which is what a user typing a loose
    // range in a browser almost always means.
    const target = range.replace(/^[\^~>=<\s]+/, '')
    const [major] = target.split('.')
    const compatible = versions.filter(candidate => candidate.split('.')[0] === major && !candidate.includes('-'))
    version = compatible.sort(compareVersions).pop() ?? document['dist-tags'].latest
  }
  if (version === undefined) throw new Error(`registry: ${name} has no published version matching ${range ?? 'latest'}`)
  const manifest = document.versions[version]
  const tarball = (manifest.dist as { tarball?: string } | undefined)?.tarball
  if (tarball === undefined) throw new Error(`registry: ${name}@${version} has no tarball`)
  return { version, tarball, manifest }
}

/** Compare two semver strings numerically, ignoring prerelease ordering subtleties. */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const difference = (left[i] || 0) - (right[i] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** Split `@scope/name@range` or `name@range`. */
function parseSpec(spec: string): { name: string, range?: string } {
  const at = spec.lastIndexOf('@')
  if (at <= 0) return { name: spec }
  return { name: spec.slice(0, at), range: spec.slice(at + 1) }
}

/** Unpack a tarball into the plugin module root. */
function unpack(name: string, tarball: Uint8Array): Record<string, unknown> {
  const root = `${PLUGIN_MODULES_ROOT}/${name}`
  volume.rm(root, { recursive: true, force: true })
  volume.mkdirp(root)
  let manifest: Record<string, unknown> | undefined
  for (const entry of extractTarball(tarball)) {
    const path = `${root}/${entry.name}`
    volume.mkdirp(dirname(path))
    volume.writeFile(path, entry.data, entry.mode)
    if (entry.name === 'package.json') {
      manifest = JSON.parse(toText(entry.data)) as Record<string, unknown>
    }
  }
  if (manifest === undefined) throw new Error(`install: ${name} tarball has no package.json`)
  return manifest
}

/**
 * Write a resolved source into the plugin module root.
 * @param source - the resolved package.
 * @returns the package's manifest.
 */
function writeSource(source: PackageSource): Record<string, unknown> {
  const root = `${PLUGIN_MODULES_ROOT}/${source.name}`
  volume.rm(root, { recursive: true, force: true })
  volume.mkdirp(root)
  for (const file of source.files) {
    const path = `${root}/${file.name}`
    volume.mkdirp(dirname(path))
    volume.writeFile(path, file.data, file.mode)
  }
  return source.manifest
}

/** The manager surface, exposed on `window.dsh.plugins`. */
export interface PluginManager {
  /** Every installed package. */
  list(): InstalledPlugin[]
  /**
   * Download and unpack a package (and its non-provided dependencies).
   * @param spec - `name`, `name@version`, or `name@range`.
   * @returns the roster entry.
   */
  install(spec: string): Promise<InstalledPlugin>
  /** Apply an installed package's bundle patch and reload the composition. */
  enable(name: string): Promise<void>
  /** Withdraw a package's bundle patch and reload the composition. */
  disable(name: string): Promise<void>
  /** Remove a package's files and its layer. */
  remove(name: string): Promise<void>
  /** Reapply every enabled layer (used after install/enable/disable). */
  reload(): Promise<void>
}

/**
 * Every package present under the plugin module root, direct or transitive.
 *
 * A meta-package's dependencies are loader rows too — `@linxin666/dsh-web-all`
 * mounts thirteen of them — so resolution has to cover the whole installed tree,
 * not just the roster's top-level entries.
 * @returns package names, including scoped ones.
 */
function installedPackageNames(): string[] {
  if (!volume.exists(PLUGIN_MODULES_ROOT)) return []
  const names: string[] = []
  for (const entry of volume.readdir(PLUGIN_MODULES_ROOT)) {
    if (entry.startsWith('@')) {
      const scoped = `${PLUGIN_MODULES_ROOT}/${entry}`
      for (const inner of volume.readdir(scoped)) {
        if (volume.exists(`${scoped}/${inner}/package.json`)) names.push(`${entry}/${inner}`)
      }
      continue
    }
    if (volume.exists(`${PLUGIN_MODULES_ROOT}/${entry}/package.json`)) names.push(entry)
  }
  return names
}

/**
 * Register host module loaders for one installed package and its subpath
 * exports, so a composition can mount `pkg` or `pkg/startup`.
 * @param name - the package name.
 */
function registerPackageLoaders(name: string): void {
  const manifestPath = `${PLUGIN_MODULES_ROOT}/${name}/package.json`
  if (!volume.exists(manifestPath)) return
  registerRuntimeLoader(name, () => importInstalledPackage(name))
  try {
    const manifest = JSON.parse(toText(volume.readFile(manifestPath))) as { exports?: Record<string, unknown> }
    for (const key of Object.keys(manifest.exports ?? {})) {
      if (!key.startsWith('./') || key === './package.json' || key.includes('*')) continue
      const specifier = `${name}/${key.slice(2)}`
      registerRuntimeLoader(specifier, () => importInstalledPackage(specifier))
    }
  } catch {
    // A malformed manifest is reported when the package is actually imported.
  }
}

/** Recursively install the dependencies this app does not already provide. */
async function installDependencies(
  manifest: Record<string, unknown>,
  registry: string,
  seen: Set<string>,
  depth: number,
): Promise<void> {
  if (depth > 4) return
  const dependencies = (manifest.dependencies ?? {}) as Record<string, string>
  for (const [name, range] of Object.entries(dependencies)) {
    if (seen.has(name)) continue
    if (PROVIDED_PREFIXES.some(prefix => name.startsWith(prefix))) continue
    // A shared library (zod, schemastery, cordis) must stay the app's single
    // instance; installing a second copy forks schema and service identity.
    if (isSharedModule(name)) continue
    if (resolveInstalled(name) !== undefined) continue
    seen.add(name)
    try {
      const resolved = await resolveVersion(name, range, registry)
      const response = await fetch(resolved.tarball)
      if (!response.ok) throw new Error(`tarball ${resolved.tarball} → ${String(response.status)}`)
      const child = unpack(name, new Uint8Array(await response.arrayBuffer()))
      await installDependencies(child, registry, seen, depth + 1)
    } catch (error) {
      // A missing optional dependency must not abort the whole install; the
      // plugin fails loudly later if it actually needed it.
      console.warn(`[plugins] could not install dependency ${name}:`, error)
    }
  }
}

/**
 * Build the manager and publish it on `window.dsh`.
 * @param ctx - the settled host context.
 * @returns the manager.
 */
export function installPluginManager(ctx: Context): PluginManager {
  const registry = DEFAULT_REGISTRY

  /** Register lazily-loaded host modules for every package in the module root. */
  const registerLoaders = (): void => {
    for (const name of installedPackageNames()) registerPackageLoaders(name)
  }

  /** Recompose the root include with the current layer set. */
  const reload = async (): Promise<void> => {
    registerLoaders()
    const loader = ctx.get('loader')
    if (loader === undefined) throw new Error('plugins: the loader service is gone')
    const include = [...loader.entries()].find(entry => entry.options.name === 'cordis:include')
    if (include === undefined) throw new Error('plugins: the root include entry is missing')
    // The same stack the boot composed, not a shorter one that happens to
    // contain the roster — see `composePatchLayers`.
    const patches = composePatchLayers(message => { console.warn(`[plugins] ${message}`) })
    const options = include.options as { id: string, name: string, config: { path: string, patches?: unknown[] } }
    await loader.update(options.id, {
      ...options,
      config: { ...options.config, patches },
    })
    await loader.await()
  }

  const manager: PluginManager = {
    list: () => readRoster().plugins,

    async install(spec: string): Promise<InstalledPlugin> {
      // Any source npm would accept: a registry name, a tarball URL, a GitHub
      // reference, or a path in this filesystem — which is how a plugin the
      // user wrote in the terminal, or dropped in from their machine, installs.
      const source = await resolveSource(spec, registry)
      const name = source.name
      if (PROVIDED_PREFIXES.some(prefix => name.startsWith(prefix))) {
        throw new Error(`install: ${name} is part of this build and cannot be installed separately`)
      }
      const manifest = writeSource(source)
      await installDependencies(manifest, registry, new Set([name]), 0)
      const resolved = { version: source.version }

      const dsh = manifest.dsh as { bundle?: { patch?: string }, client?: { platform?: string } } | undefined
      const entry: InstalledPlugin = {
        name,
        version: resolved.version,
        enabled: dsh?.bundle?.patch !== undefined,
        ...(dsh?.bundle?.patch === undefined ? {} : { patch: dsh.bundle.patch }),
        hasClient: dsh?.client?.platform === 'web',
        ...(dsh?.bundle === undefined ? {} : { bundleName: name }),
      }
      const roster = readRoster()
      roster.plugins = [...roster.plugins.filter(plugin => plugin.name !== name), entry]
      writeRoster(roster)
      registerLoaders()
      if (dsh === undefined) {
        console.warn(`[plugins] ${name} has no "dsh" manifest field; installed as a plain dependency, no layer applied`)
      }
      return entry
    },

    async enable(name: string): Promise<void> {
      const roster = readRoster()
      const plugin = roster.plugins.find(candidate => candidate.name === name)
      if (plugin === undefined) throw new Error(`enable: ${name} is not installed`)
      plugin.enabled = true
      writeRoster(roster)
      await reload()
    },

    async disable(name: string): Promise<void> {
      const roster = readRoster()
      const plugin = roster.plugins.find(candidate => candidate.name === name)
      if (plugin === undefined) throw new Error(`disable: ${name} is not installed`)
      plugin.enabled = false
      writeRoster(roster)
      await reload()
    },

    async remove(name: string): Promise<void> {
      const roster = readRoster()
      roster.plugins = roster.plugins.filter(plugin => plugin.name !== name)
      writeRoster(roster)
      volume.rm(`${PLUGIN_MODULES_ROOT}/${name}`, { recursive: true, force: true })
      await reload()
    },

    reload,
  }

  registerLoaders()
  setPluginManager(manager)
  const surface = (globalThis as { dsh?: Record<string, unknown> }).dsh ?? {}
  surface.plugins = manager
  ;(globalThis as { dsh?: Record<string, unknown> }).dsh = surface
  return manager
}

/**
 * Apply the layers of already-installed plugins during boot, before the tree
 * settles, so an enabled plugin is part of the first composition rather than a
 * post-boot reload.
 * @returns the patch lists to append, in roster order.
 */
export function installedPatchFiles(): { label: string, path: string }[] {
  return readRoster().plugins
    .filter(plugin => plugin.enabled && plugin.patch !== undefined)
    .map(plugin => ({
      label: plugin.name,
      path: `${PLUGIN_MODULES_ROOT}/${plugin.name}/${plugin.patch!.replace(/^\.\//, '')}`,
    }))
    .filter(entry => volume.exists(entry.path))
}

/**
 * Every patch layer this deployment composes, in application order.
 *
 * One function because there are two callers and they must not disagree: the
 * boot builds this stack, and `reload` rebuilds it after the roster changes.
 * They did disagree — `reload` knew only the three base layers and the roster,
 * so the first `enable` of a session recomposed the tree *without* the layers
 * this build ships (the terminal, this installer, the star, the network page)
 * and without the user's own. The symptom was a plugin toggle that silently
 * took the terminal away until the next reload, which is the opposite of what
 * a toggle is for.
 * @param onWarning - called with a layer that failed to load, rather than throwing.
 * @returns the layers, base first and the user's own last.
 */
export function composePatchLayers(onWarning?: (message: string) => void): PatchOptions[] {
  return [
    ...loadOverlayPatches('dsh-web', `${DEPLOY_ROOT}/bundles/dsh-base/cordis.patch.yml`),
    ...loadOverlayPatches('dsh-web', `${DEPLOY_ROOT}/bundles/dsh-web-app/cordis.patch.yml`),
    ...loadOverlayPatches('dsh-web', `${DEPLOY_ROOT}/bundles/browser/cordis.patch.yml`),
    // The plugins this build ships, each as its own layer.
    ...SHIPPED_BUNDLES
      .filter(name => name !== 'browser')
      .flatMap(name => loadOverlayPatches(name, `${DEPLOY_ROOT}/bundles/${name}/cordis.patch.yml`)),
    // Installed plugin bundles, in the order they were added — the same place
    // `dsh.profile.bundles` puts them.
    ...installedPatchFiles().flatMap(({ label, path }) => {
      try {
        return loadOverlayPatches(label, path)
      } catch (error) {
        onWarning?.(`${label}: patch layer failed to load (${error instanceof Error ? error.message : String(error)})`)
        return []
      }
    }),
    // The user's own layer, last, exactly as a profile's patch file is.
    ...(loadOptionalPatches('dsh-web', dshHomePath('cordis.patch.yml')) ?? []),
  ]
}

/**
 * Names of every installed plugin, readable before the host boots.
 * @returns the roster's package names.
 */
export function installedPluginNames(): string[] {
  return readRoster().plugins.map(plugin => plugin.name)
}

/**
 * Turn every installed plugin's layer off without removing its files.
 *
 * The boot-failure screen offers this: a plugin can break the composition in a
 * way the per-row retry cannot isolate, and disabling the layers is a recovery
 * that keeps the user's files, sessions, and the packages themselves.
 */
export function disableAllPlugins(): void {
  const roster = readRoster()
  for (const plugin of roster.plugins) plugin.enabled = false
  writeRoster(roster)
}

/** Register host module loaders for installed packages before the tree boots. */
export function registerInstalledModules(): void {
  for (const name of installedPackageNames()) registerPackageLoaders(name)
}
