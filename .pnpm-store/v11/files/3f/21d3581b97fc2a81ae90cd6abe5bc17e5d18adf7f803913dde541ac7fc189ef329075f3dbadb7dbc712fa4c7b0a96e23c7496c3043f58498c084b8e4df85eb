import * as fs from 'node:fs'
import * as vite from 'vite'
import { debug } from './debug'
import { createLogFile } from './logFile'
import type { NormalizedPath } from './path'
import * as path from './path'
import { createTsconfigResolvers, TsconfigResolvers } from './resolver'
import { PluginOptions, ViteResolve } from './types'

export type { PluginOptions }

export default (opts: PluginOptions = {}) => {
  let tsconfigResolvers: TsconfigResolvers
  let isFirstBuild = true

  const logFile = opts.logFile
    ? createLogFile(
        opts.logFile === true ? 'vite-tsconfig-paths.log' : opts.logFile
      )
    : null

  debug('Plugin options:', opts)

  const plugin = {
    name: 'vite-tsconfig-paths',
    enforce: 'pre',
    configResolved(config: Pick<vite.ResolvedConfig, 'logger' | 'root'>) {
      let projectRoot: NormalizedPath
      let workspaceRoot: NormalizedPath

      if (opts.root) {
        projectRoot = workspaceRoot = path.resolve(config.root, opts.root)
      } else {
        projectRoot = path.normalize(config.root)
        workspaceRoot = path.normalize(vite.searchForWorkspaceRoot(config.root))
      }

      debug('Project root:  ', projectRoot)
      debug('Workspace root:', workspaceRoot)

      tsconfigResolvers = createTsconfigResolvers({
        ...opts,
        projectRoot,
        workspaceRoot,
        logFile,
        logger: config.logger,
        skip(dir: string) {
          if (dir === '.git' || dir === 'node_modules') {
            return true
          }
          if (typeof opts.skip === 'function') {
            return opts.skip(dir)
          }
          return false
        },
      })

      tsconfigResolvers.reset()
    },
    configureServer(server: Pick<vite.ViteDevServer, 'watcher'>) {
      tsconfigResolvers.watch(server.watcher)
    },
    buildStart() {
      if (isFirstBuild) {
        isFirstBuild = false
        return
      }
      tsconfigResolvers.reset()
    },
    async resolveId(
      this: Pick<vite.Rollup.PluginContext, 'resolve'>,
      id: string,
      importer: string | undefined,
      options: {}
    ) {
      if (!importer) {
        logFile?.write('emptyImporter', { importer, id })
        return
      }
      if (path.relativeImportRE.test(id)) {
        logFile?.write('relativeId', { importer, id })
        return
      }
      if (id.includes('\0')) {
        logFile?.write('virtualId', { importer, id })
        return
      }

      // Attempt to coerce the importer to a file path. The importer may be
      // a "virtual module" that may not exist in the filesystem, or it may
      // be derived from a real file.
      let importerFile = importer
      if (importer[0] === '\0') {
        // Check if the real file path is provided in the query string. For
        // example, the WXT framework for browser extensions does this.
        const index = importer.indexOf('?')
        if (index !== -1) {
          const query = path.normalize(importer.slice(index + 1))
          if (path.isAbsolute(query) && fs.existsSync(query)) {
            debug('Rewriting virtual importer to real file:', importer)
            importerFile = query
          } else {
            logFile?.write('virtualImporter', { importer, id })
            return
          }
        } else {
          logFile?.write('virtualImporter', { importer, id })
          return
        }
      }

      // For Vite 4 and under, skipSelf needs to be set.
      const resolveOptions = { ...options, skipSelf: true }
      const viteResolve: ViteResolve = async (id, importer) =>
        (await this.resolve(id, importer, resolveOptions))?.id

      for await (const resolveId of tsconfigResolvers.get(importerFile)) {
        const [resolved, matched] = await resolveId(
          viteResolve,
          id,
          importerFile
        )
        if (resolved) {
          return resolved
        }
        if (matched) {
          // Once a matching resolver is found, stop looking.
          break
        }
      }
    },
  } as const

  return plugin satisfies vite.Plugin
}
