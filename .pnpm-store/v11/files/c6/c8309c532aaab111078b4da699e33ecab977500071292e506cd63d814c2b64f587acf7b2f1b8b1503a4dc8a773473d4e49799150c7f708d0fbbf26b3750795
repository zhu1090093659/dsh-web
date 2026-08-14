import globRex from 'globrex'
import * as fs from 'node:fs'
import { readdir } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { inspect } from 'node:util'
import * as tsconfck from 'tsconfck'
import * as vite from 'vite'
import { debug } from './debug'
import { LogFileWriter } from './logFile'
import { resolvePathMappings } from './mappings'
import type { NormalizedPath } from './path'
import * as path from './path'
import {
  Directory,
  PluginOptions,
  Project,
  Resolver,
  ViteResolve,
} from './types'

const notApplicable = [undefined, false] as const
const notFound = [undefined, true] as const

/** A directory with no projects. */
const emptyDirectory: Directory = {
  projects: Object.freeze([]) as any,
  lazyDiscovery: false,
}

type Logger = Pick<vite.Logger, 'error' | 'hasErrorLogged'>

export type TsconfigResolvers = ReturnType<typeof createTsconfigResolvers>

export function createTsconfigResolvers({
  projectRoot,
  workspaceRoot,
  skip = () => false,
  logFile,
  logger,
  ...opts
}: Omit<PluginOptions, 'root' | 'logFile'> & {
  projectRoot: string
  workspaceRoot: string
  logFile?: LogFileWriter | null
  logger: Logger
}) {
  let initializing: Promise<void> | undefined
  let directoryCache: Map<string, Directory>
  let resolversByProject: WeakMap<Project, Resolver>
  let isFirstParseError = true
  let hasTypeScriptDep = false

  if (opts.parseNative) {
    try {
      const pkgJson = fs.readFileSync(
        join(workspaceRoot, 'package.json'),
        'utf8'
      )
      const pkg = JSON.parse(pkgJson)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      hasTypeScriptDep = 'typescript' in deps
    } catch (e: any) {
      if (e.code != 'ENOENT') {
        throw e
      }
    }
  }

  const configNames = opts.configNames || ['tsconfig.json', 'jsconfig.json']
  debug(
    'Only tsconfig files with a name in this list are discoverable:',
    configNames
  )

  const parseProject = async (
    tsconfigFile: string
  ): Promise<Project | null> => {
    tsconfigFile = path.normalize(tsconfigFile)

    try {
      return (
        hasTypeScriptDep
          ? await tsconfck.parseNative(tsconfigFile)
          : await tsconfck.parse(tsconfigFile)
      ) as Project
    } catch (error: any) {
      if (opts.ignoreConfigErrors) {
        debug('[!] Failed to parse tsconfig file at %s', tsconfigFile)
        if (isFirstParseError) {
          debug('Remove the `ignoreConfigErrors` option to see the error.')
        }
      } else {
        logger.error(
          '[tsconfig-paths] An error occurred while parsing "' +
            tsconfigFile +
            '". See below for details.' +
            (isFirstParseError
              ? ' To disable this message, set the `ignoreConfigErrors` option to true.'
              : ''),
          { error }
        )
        if (!logger.hasErrorLogged(error)) {
          console.error(error)
        }
      }
      isFirstParseError = false
      return null
    }
  }

  // File watcher hooks
  let onBeforeAddProject: ((project: Project) => void) | undefined
  let onParseError: ((tsconfigFile: string) => void) | undefined

  const addProject = (project: Project, data?: Directory) => {
    const tsconfigFile = project.tsconfigFile
    const dir = path.normalize(path.dirname(tsconfigFile))
    data ??= directoryCache.get(dir)

    // Sanity check
    if (data?.projects.some((p) => p.tsconfigFile === tsconfigFile)) {
      return
    }

    onBeforeAddProject?.(project)

    // Referenced projects must be added first, so they can override
    // the parent project's paths if both are in the same directory.
    if (project.referenced) {
      project.referenced.forEach((projectRef) => {
        addProject(projectRef)
      })
      // Ensure the latest directory data is used. One of the project
      // references may have updated it.
      data = directoryCache.get(dir)
    }

    const resolver = createResolver(project, opts, logFile)
    if (resolver) {
      resolversByProject.set(project, resolver)
    }

    if (!data || data === emptyDirectory) {
      directoryCache.set(
        dir,
        (data = {
          projects: [],
          lazyDiscovery: null,
        })
      )
    }

    data.projects.push(project)
  }

  const loadProject = async (tsconfigFile: string, data?: Directory) => {
    const project = await parseProject(tsconfigFile)
    if (project) {
      addProject(project, data)
    } else {
      onParseError?.(tsconfigFile)
    }
  }

  // Ensure a deterministic order.
  const sortProjects = (projects: Project[]) => {
    projects.sort((left, right) =>
      left.tsconfigFile.localeCompare(right.tsconfigFile)
    )
  }

  const processConfigFile = async (
    dir: NormalizedPath,
    name: string,
    data = directoryCache.get(dir)
  ): Promise<void> => {
    if (!data) {
      return // Wait to be loaded on-demand.
    }
    const file = path.join(dir, name as NormalizedPath)
    if (data.projects.some((p) => p.tsconfigFile === file)) {
      return
    }
    await loadProject(file, data)
  }

  const loadEagerProjects = async () => {
    let projectPaths: string[]
    if (opts.projects) {
      projectPaths = opts.projects.map((file) => {
        if (!file.endsWith('.json')) {
          file = join(file, 'tsconfig.json')
        }
        return path.resolve(projectRoot, file)
      })
    } else {
      if (opts.projectDiscovery === 'lazy') {
        return
      }
      projectPaths = await tsconfck.findAll(workspaceRoot, {
        configNames,
        skip,
      })
    }

    debug('Eagerly parsing these projects:', projectPaths)

    await Promise.all(Array.from(new Set(projectPaths), (p) => loadProject(p)))
    for (const data of directoryCache.values()) {
      sortProjects(data.projects)
    }
  }

  const resetResolvers = () => {
    directoryCache = new Map()
    resolversByProject = new WeakMap()
    initializing = loadEagerProjects()
  }

  // Only used when projectDiscovery is 'lazy'.
  const discoverProjects = async (dir: NormalizedPath, data: Directory) => {
    debug('Searching directory for tsconfig files:', dir)
    const names = await readdir(dir).catch(() => [])

    await Promise.all(
      names
        .filter((name) => configNames.includes(name))
        .map((name) => {
          return processConfigFile(dir, name, data)
        })
    )

    if (data.projects.length) {
      sortProjects(data.projects)
      if (debug.enabled) {
        debug(
          `Directory "${dir}" contains the following tsconfig files:`,
          data.projects.map((p) => path.basename(p.tsconfigFile))
        )
      }
    } else {
      // No projects found. Reduce memory usage with a stand-in.
      directoryCache.set(dir, emptyDirectory)
      debug('No tsconfig files found in directory:', dir)
    }
  }

  const getResolvers = async function* (
    importer: string
  ): AsyncIterable<Resolver> {
    await initializing

    let dir = path.normalize(importer)
    const { root } = path.parse(dir)
    while (dir !== (dir = path.dirname(dir)) && dir !== root) {
      let data = directoryCache.get(dir)

      if (opts.projectDiscovery === 'lazy') {
        if (!data) {
          if (skip(path.basename(dir))) {
            directoryCache.set(dir, emptyDirectory)
            continue
          }
          directoryCache.set(
            dir,
            (data = {
              projects: [],
              lazyDiscovery: null,
            })
          )
        }
        await (data.lazyDiscovery ??= discoverProjects(dir, data))
      } else if (!data) {
        continue
      }

      for (const project of data.projects) {
        const resolver = resolversByProject.get(project)
        if (resolver) {
          yield resolver
        }
      }
    }
  }

  const watchProjects = (watcher: vite.FSWatcher) => {
    onBeforeAddProject = (project) => {
      watcher.add(project.tsconfigFile)
      project.extended?.forEach((parent) => {
        watcher.add(parent.tsconfigFile)
      })
    }
    onParseError = (tsconfigFile) => {
      // Try again if the file changes.
      watcher.add(tsconfigFile)
    }
    watcher.on('all', (event, file) => {
      const normalizedFile = path.normalize(file)
      if (
        !normalizedFile.endsWith('.json') ||
        !path.isAbsolute(normalizedFile)
      ) {
        return
      }
      if (event === 'add') {
        if (configNames.includes(path.basename(normalizedFile))) {
          processConfigFile(
            path.dirname(normalizedFile),
            path.basename(normalizedFile)
          ).catch(console.error)
        }
      } else if (event === 'change' || event === 'unlink') {
        invalidateConfigFile(
          path.dirname(normalizedFile),
          path.basename(normalizedFile),
          event
        )
      }
    })

    function invalidateConfigFile(
      dir: NormalizedPath,
      name: string,
      event: 'change' | 'unlink'
    ): void {
      const data = directoryCache.get(dir)
      if (!data) {
        return
      }
      const file = path.join(dir, name as NormalizedPath)
      const index = data.projects.findIndex(
        (project) => project.tsconfigFile === file
      )
      if (index !== -1) {
        const project = data.projects[index]
        debug(
          `Unloading project because of ${event} event:`,
          project.tsconfigFile
        )

        resolversByProject.delete(project)
        data.projects.splice(index, 1)

        if (event === 'change') {
          if (opts.projectDiscovery === 'lazy') {
            data.lazyDiscovery = null
          } else {
            loadProject(project.tsconfigFile, data)
              .then(() => {
                sortProjects(data.projects)
              })
              .catch(console.error)
          }
        }
      }
    }
  }

  return {
    reset: resetResolvers,
    get: getResolvers,
    watch: watchProjects,
  }
}

type ResolverOptions = {
  loose?: boolean
  importerFilter?: (importer: string) => boolean
}

function createResolver(
  project: Project,
  opts: ResolverOptions,
  logFile?: LogFileWriter | null
): Resolver | null {
  const configPath = project.tsconfigFile
  const config = project.tsconfig

  debug('Config loaded:', inspect({ configPath, config }, false, 10, true))

  // Sometimes a tsconfig is not meant to be used for path resolution,
  // but rather for pointing to other tsconfig files and possibly being
  // extended by them. This is represented by an explicitly empty "files"
  // array and a missing/empty "include" array.
  if (config.files?.length == 0 && !config.include?.length) {
    debug(
      `[!] Skipping "${configPath}" as no files can be matched since "files" is empty and "include" is missing or empty.`
    )
    return null
  }

  const compilerOptions = config.compilerOptions || {}
  const { baseUrl, paths } = compilerOptions

  type InternalResolver = (
    viteResolve: ViteResolve,
    id: string,
    importer: string
  ) => Promise<string | undefined>

  const resolveWithBaseUrl: InternalResolver | undefined = baseUrl
    ? async (viteResolve, id, importer) => {
        if (id[0] === '/') {
          return
        }
        const absoluteId = join(baseUrl, id)
        const resolvedId = await viteResolve(absoluteId, importer)
        if (resolvedId) {
          if (resolvedId.endsWith('.json') && !id.endsWith('.json')) {
            return
          }
          logFile?.write('resolvedWithBaseUrl', {
            importer,
            id,
            resolvedId,
            configPath,
          })
          return resolvedId
        }
      }
    : undefined

  let resolveId: InternalResolver
  if (paths) {
    const pathsRootDir = resolvePathsRootDir(project)
    const pathMappings = resolvePathMappings(paths, pathsRootDir)

    const resolveWithPaths: InternalResolver = async (
      viteResolve,
      id,
      importer
    ) => {
      const candidates = logFile ? ([] as string[]) : null
      for (const mapping of pathMappings) {
        const match = id.match(mapping.pattern)
        if (!match) {
          continue
        }
        for (let pathTemplate of mapping.paths) {
          let starCount = 0
          const mappedId = pathTemplate.replace(/\*/g, () => {
            // There may exist more globs in the path template than in
            // the match pattern. In that case, we reuse the final glob
            // match.
            const matchIndex = Math.min(++starCount, match.length - 1)
            return match[matchIndex]
          })
          candidates?.push(mappedId)
          const resolvedId = await viteResolve(mappedId, importer)
          if (resolvedId) {
            logFile?.write('resolvedWithPaths', {
              importer,
              id,
              resolvedId,
              configPath,
            })
            return resolvedId
          }
        }
      }
      logFile?.write('notFound', {
        importer,
        id,
        candidates,
        configPath,
      })
    }

    if (resolveWithBaseUrl) {
      resolveId = async (viteResolve, id, importer) =>
        (await resolveWithPaths(viteResolve, id, importer)) ??
        (await resolveWithBaseUrl(viteResolve, id, importer))
    } else {
      resolveId = resolveWithPaths
    }
  } else if (resolveWithBaseUrl) {
    resolveId = resolveWithBaseUrl
  } else {
    debug(`[!] Skipping "${configPath}" as no paths or baseUrl are defined.`)
    return null
  }

  const configDir = path.normalize(path.dirname(configPath))

  let outDir = compilerOptions.outDir && path.normalize(compilerOptions.outDir)

  // When `tsconfck.parseNative` is used, the outDir is absolute, which
  // is not what `getIncluder` expects.
  if (outDir && path.isAbsolute(outDir)) {
    outDir = path.relative(configDir, outDir)
  }

  const isIncludedRelative = getIncluder(
    config.include?.map((p) => ensureRelative(configDir, p)),
    config.exclude?.map((p) => ensureRelative(configDir, p)),
    outDir
  )

  const isImporterSupported = opts.loose
    ? () => true
    : opts.importerFilter ??
      (() => {
        const extensionFilter =
          compilerOptions.allowJs ||
          path.basename(configPath).startsWith('jsconfig.')
            ? /\.(astro|mdx|svelte|vue|[mc]?[jt]sx?)$/
            : /\.[mc]?tsx?$/

        return (importer: string) => extensionFilter.test(importer)
      })()

  const resolutionCache = new Map<string, string>()

  const hashQueryPattern = /[#?].+$/
  const queryPattern = /\?.+$/
  const dtsPattern = /\.d\.ts(\?|$)/

  return async (viteResolve, id, importer) => {
    // Remove query and hash parameters from the importer path.
    const importerFile = path.normalize(importer.replace(hashQueryPattern, ''))

    // Skip unsupported importers.
    if (!isImporterSupported(importerFile)) {
      logFile?.write('unsupportedExtension', { importer, id })
      return notApplicable
    }

    // Respect the include/exclude properties.
    const relativeImporterFile = path.relative(configDir, importerFile)
    if (!isIncludedRelative(relativeImporterFile)) {
      logFile?.write('configMismatch', { importer, id, configPath })
      return notApplicable
    }

    // Find and remove special Vite queries (e.g. "?url") if present. If
    // the path is resolved, the query will be added back.
    const query = queryPattern.exec(id)?.[0]
    if (query) {
      id = id.slice(0, -query.length)
    }

    let resolvedId = resolutionCache.get(id)
    if (resolvedId) {
      logFile?.write('resolvedFromCache', {
        importer,
        id,
        resolvedId,
        configPath,
      })
    } else {
      resolvedId = await resolveId(viteResolve, id, importer)
      if (!resolvedId) {
        return notFound
      }
      resolutionCache.set(id, resolvedId)
    }

    // If we get a .d.ts file (ambient type declarations), it's because a
    // tsconfig file is being used for opt-in type overrides. This is an
    // unusual pattern, but we can just stop here to avoid trouble.
    if (dtsPattern.test(resolvedId)) {
      logFile?.write('resolvedToDeclarationFile', {
        importer,
        id,
        resolvedId,
        configPath,
      })
      return notApplicable
    }

    // Restore the query if one was removed earlier.
    if (query) {
      resolvedId += query
    }

    return [resolvedId, true]
  }
}

function resolvePathsRootDir(project: Project): string {
  if (project.result) {
    const { options } = project.result
    if (options && typeof options.pathsBasePath === 'string') {
      return options.pathsBasePath
    }
    return path.dirname(project.tsconfigFile)
  }
  const baseUrl = project.tsconfig.compilerOptions?.baseUrl
  if (baseUrl) {
    return baseUrl
  }
  const projectWithPaths = project.extended?.find(
    (project) => project.tsconfig.compilerOptions?.paths
  )
  return path.dirname((projectWithPaths ?? project).tsconfigFile)
}

const defaultInclude = ['**/*']
const defaultExclude = [
  '**/node_modules',
  '**/bower_components',
  '**/jspm_packages',
]

/**
 * The returned function does not support absolute paths.
 * Be sure to call `path.relative` on your path first.
 */
function getIncluder(
  includePaths = defaultInclude,
  excludePaths = defaultExclude,
  outDir?: string
) {
  if (outDir) {
    excludePaths = excludePaths.concat(outDir)
  }
  if (includePaths.length || excludePaths.length) {
    const includers: RegExp[] = []
    const excluders: RegExp[] = []

    includePaths.forEach(addCompiledGlob, includers)
    excludePaths.forEach(addCompiledGlob, excluders)

    if (debug.enabled) {
      debug(`Compiled tsconfig globs:`, {
        include: {
          globs: includePaths,
          regexes: includers,
        },
        exclude: {
          globs: excludePaths,
          regexes: excluders,
        },
      })
    }

    return (id: string) => {
      id = id.replace(/\?.+$/, '')
      if (!path.relativeImportRE.test(id)) {
        id = './' + id
      }
      const test = (glob: RegExp) => glob.test(id)
      return includers.some(test) && !excluders.some(test)
    }
  }
  return () => true
}

function addCompiledGlob(this: RegExp[], glob: string) {
  const endsWithGlob = glob.split('/').pop()!.includes('*')
  const relativeGlob = path.relativeImportRE.test(glob) ? glob : './' + glob
  if (endsWithGlob) {
    this.push(compileGlob(relativeGlob))
  } else {
    // Append a globstar to possible directories.
    this.push(compileGlob(relativeGlob + '/**'))

    // Try to match specific files (must have file extension).
    if (/\.\w+$/.test(glob)) {
      this.push(compileGlob(relativeGlob))
    }
  }
}

function compileGlob(glob: string) {
  return globRex(glob, {
    extended: true,
    globstar: true,
  }).regex
}

function ensureRelative(dir: string, path: string) {
  return isAbsolute(path) ? relative(dir, path) : path
}
