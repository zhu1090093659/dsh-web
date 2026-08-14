// src/index.ts
import * as fs2 from "fs";
import * as vite2 from "vite";

// src/debug.ts
import createDebug from "debug";
var debug = createDebug("vite-tsconfig-paths");
if (process.env.TEST === "vite-tsconfig-paths") {
  createDebug.enable("vite-tsconfig-paths");
}

// src/logFile.ts
import { createWriteStream, statSync, writeFileSync } from "fs";
function createLogFile(logFilePath) {
  let mtime;
  try {
    mtime = statSync(logFilePath).mtime.getTime();
  } catch (e) {
  }
  if (!mtime || Date.now() - mtime > 1e4) {
    debug("Clearing log file:", logFilePath);
    writeFileSync(logFilePath, "");
  }
  const logFile = createWriteStream(logFilePath, {
    flags: "a",
    encoding: "utf-8"
  });
  return {
    write(...event) {
      logFile.write(event[0] + ": " + JSON.stringify(event[1]) + "\n");
    }
  };
}

// src/path.ts
import * as os from "os";
import * as path from "path";
import * as vite from "vite";
var isWindows = os.platform() == "win32";
var normalize = (p) => {
  let output = vite.normalizePath(p);
  if (isWindows && output[1] === ":") {
    output = output[0].toUpperCase() + output.substring(1);
  }
  return output;
};
var parse2 = path.parse;
var resolve = isWindows ? (...paths) => normalize(path.win32.resolve(...paths)) : path.posix.resolve;
var isAbsolute = isWindows ? path.win32.isAbsolute : path.posix.isAbsolute;
var join = path.posix.join;
var relative = path.posix.relative;
var basename = path.posix.basename;
var dirname2 = path.dirname;
var relativeImportRE = /^\.\.?(\/|$)/;

// src/resolver.ts
import globRex from "globrex";
import * as fs from "fs";
import { readdir } from "fs/promises";
import { isAbsolute as isAbsolute2, join as join2, relative as relative2 } from "path";
import { inspect } from "util";
import * as tsconfck from "tsconfck";

// src/mappings.ts
import { resolve as resolve2 } from "path";
function resolvePathMappings(paths, base) {
  const sortedPatterns = Object.keys(paths).sort(
    (a, b) => getPrefixLength(b) - getPrefixLength(a)
  );
  const resolved = [];
  for (let pattern of sortedPatterns) {
    const relativePaths = paths[pattern];
    pattern = escapeStringRegexp(pattern).replace(/\*/g, "(.+)");
    resolved.push({
      pattern: new RegExp("^" + pattern + "$"),
      paths: relativePaths.map((relativePath) => resolve2(base, relativePath))
    });
  }
  return resolved;
}
function getPrefixLength(pattern) {
  const prefixLength = pattern.indexOf("*");
  return pattern.substr(0, prefixLength).length;
}
function escapeStringRegexp(string) {
  return string.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/-/g, "\\x2d");
}

// src/resolver.ts
var notApplicable = [void 0, false];
var notFound = [void 0, true];
var emptyDirectory = {
  projects: Object.freeze([]),
  lazyDiscovery: false
};
function createTsconfigResolvers({
  projectRoot,
  workspaceRoot,
  skip = () => false,
  logFile,
  logger,
  ...opts
}) {
  let initializing;
  let directoryCache;
  let resolversByProject;
  let isFirstParseError = true;
  let hasTypeScriptDep = false;
  if (opts.parseNative) {
    try {
      const pkgJson = fs.readFileSync(
        join2(workspaceRoot, "package.json"),
        "utf8"
      );
      const pkg = JSON.parse(pkgJson);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      hasTypeScriptDep = "typescript" in deps;
    } catch (e) {
      if (e.code != "ENOENT") {
        throw e;
      }
    }
  }
  const configNames = opts.configNames || ["tsconfig.json", "jsconfig.json"];
  debug(
    "Only tsconfig files with a name in this list are discoverable:",
    configNames
  );
  const parseProject = async (tsconfigFile) => {
    tsconfigFile = normalize(tsconfigFile);
    try {
      return hasTypeScriptDep ? await tsconfck.parseNative(tsconfigFile) : await tsconfck.parse(tsconfigFile);
    } catch (error) {
      if (opts.ignoreConfigErrors) {
        debug("[!] Failed to parse tsconfig file at %s", tsconfigFile);
        if (isFirstParseError) {
          debug("Remove the `ignoreConfigErrors` option to see the error.");
        }
      } else {
        logger.error(
          '[tsconfig-paths] An error occurred while parsing "' + tsconfigFile + '". See below for details.' + (isFirstParseError ? " To disable this message, set the `ignoreConfigErrors` option to true." : ""),
          { error }
        );
        if (!logger.hasErrorLogged(error)) {
          console.error(error);
        }
      }
      isFirstParseError = false;
      return null;
    }
  };
  let onBeforeAddProject;
  let onParseError;
  const addProject = (project, data) => {
    const tsconfigFile = project.tsconfigFile;
    const dir = normalize(dirname2(tsconfigFile));
    data != null ? data : data = directoryCache.get(dir);
    if (data == null ? void 0 : data.projects.some((p) => p.tsconfigFile === tsconfigFile)) {
      return;
    }
    onBeforeAddProject == null ? void 0 : onBeforeAddProject(project);
    if (project.referenced) {
      project.referenced.forEach((projectRef) => {
        addProject(projectRef);
      });
      data = directoryCache.get(dir);
    }
    const resolver = createResolver(project, opts, logFile);
    if (resolver) {
      resolversByProject.set(project, resolver);
    }
    if (!data || data === emptyDirectory) {
      directoryCache.set(
        dir,
        data = {
          projects: [],
          lazyDiscovery: null
        }
      );
    }
    data.projects.push(project);
  };
  const loadProject = async (tsconfigFile, data) => {
    const project = await parseProject(tsconfigFile);
    if (project) {
      addProject(project, data);
    } else {
      onParseError == null ? void 0 : onParseError(tsconfigFile);
    }
  };
  const sortProjects = (projects) => {
    projects.sort(
      (left, right) => left.tsconfigFile.localeCompare(right.tsconfigFile)
    );
  };
  const processConfigFile = async (dir, name, data = directoryCache.get(dir)) => {
    if (!data) {
      return;
    }
    const file = join(dir, name);
    if (data.projects.some((p) => p.tsconfigFile === file)) {
      return;
    }
    await loadProject(file, data);
  };
  const loadEagerProjects = async () => {
    let projectPaths;
    if (opts.projects) {
      projectPaths = opts.projects.map((file) => {
        if (!file.endsWith(".json")) {
          file = join2(file, "tsconfig.json");
        }
        return resolve(projectRoot, file);
      });
    } else {
      if (opts.projectDiscovery === "lazy") {
        return;
      }
      projectPaths = await tsconfck.findAll(workspaceRoot, {
        configNames,
        skip
      });
    }
    debug("Eagerly parsing these projects:", projectPaths);
    await Promise.all(Array.from(new Set(projectPaths), (p) => loadProject(p)));
    for (const data of directoryCache.values()) {
      sortProjects(data.projects);
    }
  };
  const resetResolvers = () => {
    directoryCache = /* @__PURE__ */ new Map();
    resolversByProject = /* @__PURE__ */ new WeakMap();
    initializing = loadEagerProjects();
  };
  const discoverProjects = async (dir, data) => {
    debug("Searching directory for tsconfig files:", dir);
    const names = await readdir(dir).catch(() => []);
    await Promise.all(
      names.filter((name) => configNames.includes(name)).map((name) => {
        return processConfigFile(dir, name, data);
      })
    );
    if (data.projects.length) {
      sortProjects(data.projects);
      if (debug.enabled) {
        debug(
          `Directory "${dir}" contains the following tsconfig files:`,
          data.projects.map((p) => basename(p.tsconfigFile))
        );
      }
    } else {
      directoryCache.set(dir, emptyDirectory);
      debug("No tsconfig files found in directory:", dir);
    }
  };
  const getResolvers = async function* (importer) {
    var _a;
    await initializing;
    let dir = normalize(importer);
    const { root } = parse2(dir);
    while (dir !== (dir = dirname2(dir)) && dir !== root) {
      let data = directoryCache.get(dir);
      if (opts.projectDiscovery === "lazy") {
        if (!data) {
          if (skip(basename(dir))) {
            directoryCache.set(dir, emptyDirectory);
            continue;
          }
          directoryCache.set(
            dir,
            data = {
              projects: [],
              lazyDiscovery: null
            }
          );
        }
        await ((_a = data.lazyDiscovery) != null ? _a : data.lazyDiscovery = discoverProjects(dir, data));
      } else if (!data) {
        continue;
      }
      for (const project of data.projects) {
        const resolver = resolversByProject.get(project);
        if (resolver) {
          yield resolver;
        }
      }
    }
  };
  const watchProjects = (watcher) => {
    onBeforeAddProject = (project) => {
      var _a;
      watcher.add(project.tsconfigFile);
      (_a = project.extended) == null ? void 0 : _a.forEach((parent) => {
        watcher.add(parent.tsconfigFile);
      });
    };
    onParseError = (tsconfigFile) => {
      watcher.add(tsconfigFile);
    };
    watcher.on("all", (event, file) => {
      const normalizedFile = normalize(file);
      if (!normalizedFile.endsWith(".json") || !isAbsolute(normalizedFile)) {
        return;
      }
      if (event === "add") {
        if (configNames.includes(basename(normalizedFile))) {
          processConfigFile(
            dirname2(normalizedFile),
            basename(normalizedFile)
          ).catch(console.error);
        }
      } else if (event === "change" || event === "unlink") {
        invalidateConfigFile(
          dirname2(normalizedFile),
          basename(normalizedFile),
          event
        );
      }
    });
    function invalidateConfigFile(dir, name, event) {
      const data = directoryCache.get(dir);
      if (!data) {
        return;
      }
      const file = join(dir, name);
      const index = data.projects.findIndex(
        (project) => project.tsconfigFile === file
      );
      if (index !== -1) {
        const project = data.projects[index];
        debug(
          `Unloading project because of ${event} event:`,
          project.tsconfigFile
        );
        resolversByProject.delete(project);
        data.projects.splice(index, 1);
        if (event === "change") {
          if (opts.projectDiscovery === "lazy") {
            data.lazyDiscovery = null;
          } else {
            loadProject(project.tsconfigFile, data).then(() => {
              sortProjects(data.projects);
            }).catch(console.error);
          }
        }
      }
    }
  };
  return {
    reset: resetResolvers,
    get: getResolvers,
    watch: watchProjects
  };
}
function createResolver(project, opts, logFile) {
  var _a, _b, _c, _d, _e;
  const configPath = project.tsconfigFile;
  const config = project.tsconfig;
  debug("Config loaded:", inspect({ configPath, config }, false, 10, true));
  if (((_a = config.files) == null ? void 0 : _a.length) == 0 && !((_b = config.include) == null ? void 0 : _b.length)) {
    debug(
      `[!] Skipping "${configPath}" as no files can be matched since "files" is empty and "include" is missing or empty.`
    );
    return null;
  }
  const compilerOptions = config.compilerOptions || {};
  const { baseUrl, paths } = compilerOptions;
  const resolveWithBaseUrl = baseUrl ? async (viteResolve, id, importer) => {
    if (id[0] === "/") {
      return;
    }
    const absoluteId = join2(baseUrl, id);
    const resolvedId = await viteResolve(absoluteId, importer);
    if (resolvedId) {
      if (resolvedId.endsWith(".json") && !id.endsWith(".json")) {
        return;
      }
      logFile == null ? void 0 : logFile.write("resolvedWithBaseUrl", {
        importer,
        id,
        resolvedId,
        configPath
      });
      return resolvedId;
    }
  } : void 0;
  let resolveId;
  if (paths) {
    const pathsRootDir = resolvePathsRootDir(project);
    const pathMappings = resolvePathMappings(paths, pathsRootDir);
    const resolveWithPaths = async (viteResolve, id, importer) => {
      const candidates = logFile ? [] : null;
      for (const mapping of pathMappings) {
        const match = id.match(mapping.pattern);
        if (!match) {
          continue;
        }
        for (let pathTemplate of mapping.paths) {
          let starCount = 0;
          const mappedId = pathTemplate.replace(/\*/g, () => {
            const matchIndex = Math.min(++starCount, match.length - 1);
            return match[matchIndex];
          });
          candidates == null ? void 0 : candidates.push(mappedId);
          const resolvedId = await viteResolve(mappedId, importer);
          if (resolvedId) {
            logFile == null ? void 0 : logFile.write("resolvedWithPaths", {
              importer,
              id,
              resolvedId,
              configPath
            });
            return resolvedId;
          }
        }
      }
      logFile == null ? void 0 : logFile.write("notFound", {
        importer,
        id,
        candidates,
        configPath
      });
    };
    if (resolveWithBaseUrl) {
      resolveId = async (viteResolve, id, importer) => {
        var _a2;
        return (_a2 = await resolveWithPaths(viteResolve, id, importer)) != null ? _a2 : await resolveWithBaseUrl(viteResolve, id, importer);
      };
    } else {
      resolveId = resolveWithPaths;
    }
  } else if (resolveWithBaseUrl) {
    resolveId = resolveWithBaseUrl;
  } else {
    debug(`[!] Skipping "${configPath}" as no paths or baseUrl are defined.`);
    return null;
  }
  const configDir = normalize(dirname2(configPath));
  let outDir = compilerOptions.outDir && normalize(compilerOptions.outDir);
  if (outDir && isAbsolute(outDir)) {
    outDir = relative(configDir, outDir);
  }
  const isIncludedRelative = getIncluder(
    (_c = config.include) == null ? void 0 : _c.map((p) => ensureRelative(configDir, p)),
    (_d = config.exclude) == null ? void 0 : _d.map((p) => ensureRelative(configDir, p)),
    outDir
  );
  const isImporterSupported = opts.loose ? () => true : (_e = opts.importerFilter) != null ? _e : (() => {
    const extensionFilter = compilerOptions.allowJs || basename(configPath).startsWith("jsconfig.") ? /\.(astro|mdx|svelte|vue|[mc]?[jt]sx?)$/ : /\.[mc]?tsx?$/;
    return (importer) => extensionFilter.test(importer);
  })();
  const resolutionCache = /* @__PURE__ */ new Map();
  const hashQueryPattern = /[#?].+$/;
  const queryPattern = /\?.+$/;
  const dtsPattern = /\.d\.ts(\?|$)/;
  return async (viteResolve, id, importer) => {
    var _a2;
    const importerFile = normalize(importer.replace(hashQueryPattern, ""));
    if (!isImporterSupported(importerFile)) {
      logFile == null ? void 0 : logFile.write("unsupportedExtension", { importer, id });
      return notApplicable;
    }
    const relativeImporterFile = relative(configDir, importerFile);
    if (!isIncludedRelative(relativeImporterFile)) {
      logFile == null ? void 0 : logFile.write("configMismatch", { importer, id, configPath });
      return notApplicable;
    }
    const query = (_a2 = queryPattern.exec(id)) == null ? void 0 : _a2[0];
    if (query) {
      id = id.slice(0, -query.length);
    }
    let resolvedId = resolutionCache.get(id);
    if (resolvedId) {
      logFile == null ? void 0 : logFile.write("resolvedFromCache", {
        importer,
        id,
        resolvedId,
        configPath
      });
    } else {
      resolvedId = await resolveId(viteResolve, id, importer);
      if (!resolvedId) {
        return notFound;
      }
      resolutionCache.set(id, resolvedId);
    }
    if (dtsPattern.test(resolvedId)) {
      logFile == null ? void 0 : logFile.write("resolvedToDeclarationFile", {
        importer,
        id,
        resolvedId,
        configPath
      });
      return notApplicable;
    }
    if (query) {
      resolvedId += query;
    }
    return [resolvedId, true];
  };
}
function resolvePathsRootDir(project) {
  var _a, _b;
  if (project.result) {
    const { options } = project.result;
    if (options && typeof options.pathsBasePath === "string") {
      return options.pathsBasePath;
    }
    return dirname2(project.tsconfigFile);
  }
  const baseUrl = (_a = project.tsconfig.compilerOptions) == null ? void 0 : _a.baseUrl;
  if (baseUrl) {
    return baseUrl;
  }
  const projectWithPaths = (_b = project.extended) == null ? void 0 : _b.find(
    (project2) => {
      var _a2;
      return (_a2 = project2.tsconfig.compilerOptions) == null ? void 0 : _a2.paths;
    }
  );
  return dirname2((projectWithPaths != null ? projectWithPaths : project).tsconfigFile);
}
var defaultInclude = ["**/*"];
var defaultExclude = [
  "**/node_modules",
  "**/bower_components",
  "**/jspm_packages"
];
function getIncluder(includePaths = defaultInclude, excludePaths = defaultExclude, outDir) {
  if (outDir) {
    excludePaths = excludePaths.concat(outDir);
  }
  if (includePaths.length || excludePaths.length) {
    const includers = [];
    const excluders = [];
    includePaths.forEach(addCompiledGlob, includers);
    excludePaths.forEach(addCompiledGlob, excluders);
    if (debug.enabled) {
      debug(`Compiled tsconfig globs:`, {
        include: {
          globs: includePaths,
          regexes: includers
        },
        exclude: {
          globs: excludePaths,
          regexes: excluders
        }
      });
    }
    return (id) => {
      id = id.replace(/\?.+$/, "");
      if (!relativeImportRE.test(id)) {
        id = "./" + id;
      }
      const test = (glob) => glob.test(id);
      return includers.some(test) && !excluders.some(test);
    };
  }
  return () => true;
}
function addCompiledGlob(glob) {
  const endsWithGlob = glob.split("/").pop().includes("*");
  const relativeGlob = relativeImportRE.test(glob) ? glob : "./" + glob;
  if (endsWithGlob) {
    this.push(compileGlob(relativeGlob));
  } else {
    this.push(compileGlob(relativeGlob + "/**"));
    if (/\.\w+$/.test(glob)) {
      this.push(compileGlob(relativeGlob));
    }
  }
}
function compileGlob(glob) {
  return globRex(glob, {
    extended: true,
    globstar: true
  }).regex;
}
function ensureRelative(dir, path2) {
  return isAbsolute2(path2) ? relative2(dir, path2) : path2;
}

// src/index.ts
var src_default = (opts = {}) => {
  let tsconfigResolvers;
  let isFirstBuild = true;
  const logFile = opts.logFile ? createLogFile(
    opts.logFile === true ? "vite-tsconfig-paths.log" : opts.logFile
  ) : null;
  debug("Plugin options:", opts);
  const plugin = {
    name: "vite-tsconfig-paths",
    enforce: "pre",
    configResolved(config) {
      let projectRoot;
      let workspaceRoot;
      if (opts.root) {
        projectRoot = workspaceRoot = resolve(config.root, opts.root);
      } else {
        projectRoot = normalize(config.root);
        workspaceRoot = normalize(vite2.searchForWorkspaceRoot(config.root));
      }
      debug("Project root:  ", projectRoot);
      debug("Workspace root:", workspaceRoot);
      tsconfigResolvers = createTsconfigResolvers({
        ...opts,
        projectRoot,
        workspaceRoot,
        logFile,
        logger: config.logger,
        skip(dir) {
          if (dir === ".git" || dir === "node_modules") {
            return true;
          }
          if (typeof opts.skip === "function") {
            return opts.skip(dir);
          }
          return false;
        }
      });
      tsconfigResolvers.reset();
    },
    configureServer(server) {
      tsconfigResolvers.watch(server.watcher);
    },
    buildStart() {
      if (isFirstBuild) {
        isFirstBuild = false;
        return;
      }
      tsconfigResolvers.reset();
    },
    async resolveId(id, importer, options) {
      if (!importer) {
        logFile == null ? void 0 : logFile.write("emptyImporter", { importer, id });
        return;
      }
      if (relativeImportRE.test(id)) {
        logFile == null ? void 0 : logFile.write("relativeId", { importer, id });
        return;
      }
      if (id.includes("\0")) {
        logFile == null ? void 0 : logFile.write("virtualId", { importer, id });
        return;
      }
      let importerFile = importer;
      if (importer[0] === "\0") {
        const index = importer.indexOf("?");
        if (index !== -1) {
          const query = normalize(importer.slice(index + 1));
          if (isAbsolute(query) && fs2.existsSync(query)) {
            debug("Rewriting virtual importer to real file:", importer);
            importerFile = query;
          } else {
            logFile == null ? void 0 : logFile.write("virtualImporter", { importer, id });
            return;
          }
        } else {
          logFile == null ? void 0 : logFile.write("virtualImporter", { importer, id });
          return;
        }
      }
      const resolveOptions = { ...options, skipSelf: true };
      const viteResolve = async (id2, importer2) => {
        var _a;
        return (_a = await this.resolve(id2, importer2, resolveOptions)) == null ? void 0 : _a.id;
      };
      for await (const resolveId of tsconfigResolvers.get(importerFile)) {
        const [resolved, matched] = await resolveId(
          viteResolve,
          id,
          importerFile
        );
        if (resolved) {
          return resolved;
        }
        if (matched) {
          break;
        }
      }
    }
  };
  return plugin;
};
export {
  src_default as default
};
//# sourceMappingURL=index.js.map