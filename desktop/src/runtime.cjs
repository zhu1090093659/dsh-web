'use strict';

/**
 * Pure helpers for the desktop main process. This module must stay free of
 * the electron import so it can be unit-tested with plain node --test.
 */

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

/**
 * Loopback ports a plain `dsh web` install owns (its CLI defaults). The
 * desktop app always spawns its own separate host and never binds these, so
 * the desktop instance and the user's own instance run side by side.
 */
const RESERVED_PORTS = new Set([3080, 3081]);

/** Preferred loopback range for the desktop host: DESKTOP_PORT_BASE + SPAN. */
const DESKTOP_PORT_BASE = 3082;
const DESKTOP_PORT_SPAN = 100;

/** Marker file written into a profile directory this app seeded itself. */
const SEED_MARKER = '.dsh-desktop-seed.json';

/**
 * argv fragments that mark a second launch as a programmatic spawn of this
 * executable (doctor supervisor/provisioning children, CLI helpers) rather
 * than a real user double-click. Raising the main window for such launches
 * is the #1382 focus-stealing loop: every background retry repaints and
 * focuses the window while the child itself fails the single-instance lock.
 */
const PROGRAMMATIC_LAUNCH_MARKERS = ['cli.mjs', 'supervisor', 'provision', '--parent-pid'];

/**
 * Decide whether a `second-instance` argv belongs to a programmatic spawn of
 * the app executable. A genuine user launch carries no arguments.
 * @param {readonly string[]} argv - full second-instance argv (exe path first).
 * @returns {boolean}
 */
function isProgrammaticLaunch(argv) {
  return argv.some((arg) => PROGRAMMATIC_LAUNCH_MARKERS.some((marker) => String(arg).includes(marker)));
}

/** Version stamp file produced by scripts/build-runtime.mjs. */
const RUNTIME_STAMP = 'VERSION.json';

/**
 * Resolve the on-disk locations of the bundled runtime payload.
 * @param {string} resourcesRoot - process.resourcesPath when packaged, else
 *   the desktop/resources directory in a development checkout.
 * @param {string} platform - process.platform.
 * @param {string} arch - process.arch.
 */
function resolveRuntimePaths(resourcesRoot, platform, arch, packaged = true) {
  const runtimeRoot = path.join(resourcesRoot, 'runtime');
  // Packaged builds map node-<os>-<arch> to runtime/node via extraResources;
  // a development checkout keeps the per-platform directory name in the same
  // electron-builder os spelling (mac/win) the staged layout uses.
  const runtimeOs = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform;
  const nodeRoot = packaged ? path.join(runtimeRoot, 'node') : path.join(runtimeRoot, 'node-' + runtimeOs + '-' + arch);
  return {
    runtimeRoot,
    nodeBin: platform === 'win32'
      ? path.join(nodeRoot, 'node.exe')
      : path.join(nodeRoot, 'bin', 'node'),
    nodeHome: nodeRoot,
    hostBin: path.join(runtimeRoot, 'host', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    profileSeed: path.join(runtimeRoot, 'profile-web'),
    stampFile: path.join(runtimeRoot, RUNTIME_STAMP),
  };
}

/**
 * Resolve the DSH home the desktop app manages: an explicit DSH_HOME from the
 * environment wins, everything else falls back to ~/.dsh — the same lookup
 * order the dsh host itself applies.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} homedir
 */
function resolveDshHome(env, homedir) {
  const configured = env.DSH_HOME;
  if (configured === undefined || configured.trim() === '') return path.join(homedir, '.dsh');
  const trimmed = configured.trim();
  if (trimmed === '~') return homedir;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return path.join(homedir, trimmed.slice(2));
  return path.resolve(trimmed);
}

/**
 * Construct the environment block for the spawned dsh host child process.
 * Prepends the bundled Node distribution's bin directory to PATH so anything
 * the host shells out to resolves against the bundled runtime.
 *
 * Normalizes PATH across platforms: on Windows, process.env frequently exposes 'Path'
 * rather than 'PATH'. Spreading process.env into a plain JS object preserves 'Path',
 * so assigning env.PATH directly would leave the existing system PATH under 'Path'
 * while env.PATH only contains nodeBinDir. In Windows process creation, this duplicate
 * or shadowed key causes spawned children (such as powershell.exe for DPAPI decryption)
 * to fail with ENOENT. We normalize all case variants of PATH into a single env.PATH.
 *
 * Normalizes NODE_PATH across platforms: ensures node_modules search fallback
 * reaches the bundled host runtime, the user's $DSH_HOME/profiles/node_modules,
 * and any specified extra paths so dynamically installed profile plugins find
 * their peer and shared dependencies without relying on CLI pre-healing.
 *
 * @param {string} home - resolved DSH_HOME.
 * @param {string} nodeHome - bundled node runtime directory.
 * @param {string} [platform] - process.platform override for testing.
 * @param {NodeJS.ProcessEnv} [baseEnv] - environment to derive from.
 * @param {readonly string[]} [extraNodePaths] - additional node_modules paths.
 * @returns {Record<string, string | undefined>}
 */
function childEnv(home, nodeHome, platform = process.platform, baseEnv = process.env, extraNodePaths = []) {
  const env = { ...baseEnv, DSH_HOME: home };
  const delimiter = platform === 'win32' ? ';' : ':';
  const nodeBinDir = platform === 'win32' ? nodeHome : path.posix.join(nodeHome, 'bin');

  let existingPath = '';
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PATH') {
      if (!existingPath && typeof env[key] === 'string' && env[key] !== '') {
        existingPath = env[key];
      }
      delete env[key];
    }
  }

  env.PATH = nodeBinDir + (existingPath ? delimiter + existingPath : '');
  delete env.ELECTRON_RUN_AS_NODE;

  let existingNodePath = '';
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'NODE_PATH') {
      if (!existingNodePath && typeof env[key] === 'string' && env[key] !== '') {
        existingNodePath = env[key];
      }
      delete env[key];
    }
  }

  const nodePaths = [];
  for (const entry of extraNodePaths) {
    if (entry && !nodePaths.includes(entry)) nodePaths.push(entry);
  }
  if (existingNodePath) {
    for (const entry of existingNodePath.split(delimiter)) {
      if (entry && !nodePaths.includes(entry)) nodePaths.push(entry);
    }
  }
  if (nodePaths.length > 0) {
    env.NODE_PATH = nodePaths.join(delimiter);
  }

  return env;
}

/**
 * Ensure fallback module junctions exist for installed profile plugins so
 * missing peer dependencies (such as @deepseek-ai/dsh-client-ui-primitives)
 * resolve immediately on boot without requiring a terminal `dsh web` run.
 *
 * @param {string} home - $DSH_HOME.
 * @param {string} hostRuntimeDir - runtimeRoot/host.
 */
function ensureProfileFallbacks(home, hostRuntimeDir) {
  const profileDir = path.join(home, 'profiles', 'web');
  const profilePkgFile = path.join(profileDir, 'package.json');
  if (!fs.existsSync(profilePkgFile)) return;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(profilePkgFile, 'utf8'));
  } catch {
    return;
  }

  const bundles = manifest && manifest.dsh && manifest.dsh.profile && Array.isArray(manifest.dsh.profile.bundles)
    ? manifest.dsh.profile.bundles
    : [];
  const dependencies = Object.keys((manifest && manifest.dependencies) || {});
  const allPluginNames = new Set([...bundles, ...dependencies]);
  if (allPluginNames.size === 0) return;

  const candidateSourceDirs = [
    path.join(hostRuntimeDir, 'node_modules'),
    path.join(home, 'profiles', 'node_modules'),
  ];
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidateSourceDirs.push(path.join(process.env.APPDATA, 'npm', 'node_modules'));
  }

  const profileModulesDir = path.join(profileDir, 'node_modules');
  const fallbackModulesDir = path.join(profileDir, '.dsh-module-fallback', 'node_modules');

  const ensureJunction = (target, linkPath) => {
    try {
      if (fs.existsSync(linkPath)) return;
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      fs.symlinkSync(target, linkPath, 'junction');
    } catch {
      // Best-effort; continue
    }
  };

  for (const pluginName of allPluginNames) {
    const pluginPkg = path.join(profileModulesDir, pluginName, 'package.json');
    if (!fs.existsSync(pluginPkg)) continue;
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pluginPkg, 'utf8'));
    } catch {
      continue;
    }
    const peers = Object.keys(pkg.peerDependencies || {});
    for (const peer of peers) {
      const targetInProfile = path.join(profileModulesDir, peer);
      if (fs.existsSync(targetInProfile)) continue;

      for (const sourceRoot of candidateSourceDirs) {
        const candidate = path.join(sourceRoot, peer);
        if (fs.existsSync(candidate)) {
          const fallbackLink = path.join(fallbackModulesDir, peer);
          ensureJunction(candidate, fallbackLink);
          ensureJunction(fallbackLink, targetInProfile);
          break;
        }
      }
    }
  }
}

/**
 * Check whether required Visual C++ runtime libraries exist on Windows.
 * Returns true on non-Windows platforms or when the required DLLs are present.
 *
 * @param {string} [platform] - process.platform override for testing.
 * @param {string} [systemRoot] - Windows system directory override.
 * @returns {boolean}
 */
function checkVcRuntime(platform = process.platform, systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows') {
  if (platform !== 'win32') return true;
  const sys32 = path.join(systemRoot, 'System32');
  const vcruntime = path.join(sys32, 'vcruntime140.dll');
  return fs.existsSync(vcruntime);
}

/**
 * Read a JSON stamp file; undefined when missing or unreadable.
 * @param {string} stampFile
 */
function readStampFile(stampFile) {
  try {
    return JSON.parse(fs.readFileSync(stampFile, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Decide how the live web profile relates to the bundled seed.
 * @param {string} profileDir - $DSH_HOME/profiles/web.
 * @param {string} stamp - current runtime stamp string.
 * @returns {'seed' | 'reseed' | 'leave'} - seed when missing, reseed when we
 *   seeded it before and the stamp moved, leave when it is user-managed.
 */
function profileAction(profileDir, stamp) {
  if (!fs.existsSync(path.join(profileDir, 'package.json'))) return 'seed';
  const marker = readStampFile(path.join(profileDir, SEED_MARKER));
  if (marker === undefined) return 'leave';
  return marker.stamp === stamp ? 'leave' : 'reseed';
}

/**
 * Copy the bundled seed profile into place. Only ever touches profiles this
 * app seeded itself; user-managed profiles are left untouched. On reseed the
 * user's patch layer and its backups survive: node_modules and the manifests
 * are replaced, cordis.patch.yml* files are kept.
 */
function applyProfileSeed(seedDir, profileDir, action, stamp, extra) {
  const keep = (name) => name.startsWith('cordis.patch.yml');
  if (action === 'reseed') {
    for (const name of ['node_modules', 'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
      fs.rmSync(path.join(profileDir, name), { recursive: true, force: true });
    }
  }
  fs.mkdirSync(profileDir, { recursive: true });
  fs.cpSync(seedDir, profileDir, {
    recursive: true,
    dereference: true,
    filter: (source) => action !== 'reseed' || !keep(path.basename(source)),
  });
  const marker = { stamp, seededAt: new Date().toISOString(), ...extra };
  fs.writeFileSync(path.join(profileDir, SEED_MARKER), JSON.stringify(marker, null, 2) + '\n');
}

/**
 * Probe whether a dsh web GUI already answers at the given URL.
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function probeGui(url, timeoutMs) {
  return new Promise((resolvePromise) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolvePromise(response.statusCode !== undefined && response.statusCode < 500);
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolvePromise(false);
    });
    request.on('error', () => resolvePromise(false));
  });
}

/**
 * Ask the OS for a free loopback port.
 * @returns {Promise<number>}
 */
function findFreePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = net.createServer();
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolvePromise(port));
    });
  });
}

/**
 * Bind-test one loopback port.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortFree(port) {
  return new Promise((resolvePromise) => {
    const server = net.createServer();
    server.once('error', () => resolvePromise(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolvePromise(true));
    });
  });
}

/**
 * Pick the loopback port for the desktop host: the dedicated range right
 * above the reserved pair first (a stable address across launches while it
 * has room), then an OS-assigned port. The user's own CLI defaults 3080/3081
 * are excluded by contract on both paths — the desktop host never takes them.
 * @returns {Promise<number>}
 */
async function findHostPort() {
  for (let port = DESKTOP_PORT_BASE; port < DESKTOP_PORT_BASE + DESKTOP_PORT_SPAN; port++) {
    if (await isPortFree(port)) return port;
  }
  for (;;) {
    const port = await findFreePort();
    if (!RESERVED_PORTS.has(port)) return port;
  }
}

/**
 * Wait until the spawned host serves the GUI, or fail when the host exits
 * first or the deadline passes.
 */
async function waitForGui(port, options) {
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + options.deadlineMs;
  for (;;) {
    if (!options.isAlive()) throw new Error('the dsh host process exited before the GUI became ready');
    if (await probeGui(url, 1500)) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${Math.round(options.deadlineMs / 1000)}s waiting for ${url}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
}

/**
 * The host prints its tokenized GUI URL on this stdout line. A non-loopback
 * bind makes the host append a ` (LAN: …)` suffix (#1377), so the suffix is
 * optional here; the line anchor stays so only full URL lines match.
 */
const TOKEN_URL_PATTERN = /^dsh web: (\S+)(?: \(LAN: \S+\))?$/;

/**
 * Extract the tokenized GUI URL from one host stdout line, if any.
 * @param {string} line
 * @returns {string | undefined}
 */
function parseTokenUrlLine(line) {
  const match = TOKEN_URL_PATTERN.exec(line);
  return match === null ? undefined : match[1];
}

/**
 * Parse a Node.js SHASUMS256.txt into a name -> hash map.
 * @param {string} text
 * @returns {Map<string, string>}
 */
function parseShasums(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+(\S+)$/.exec(line.trim());
    if (match !== null) map.set(match[2], match[1]);
  }
  return map;
}

module.exports = {
  RESERVED_PORTS,
  DESKTOP_PORT_BASE,
  DESKTOP_PORT_SPAN,
  SEED_MARKER,
  RUNTIME_STAMP,
  resolveRuntimePaths,
  resolveDshHome,
  childEnv,
  isProgrammaticLaunch,
  readStampFile,
  profileAction,
  applyProfileSeed,
  probeGui,
  findFreePort,
  isPortFree,
  findHostPort,
  waitForGui,
  parseTokenUrlLine,
  parseShasums,
  ensureProfileFallbacks,
  checkVcRuntime,
};
