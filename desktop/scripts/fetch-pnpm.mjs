#!/usr/bin/env node
'use strict';

/**
 * Install the pinned pnpm into every bundled Node distribution under
 * desktop/resources/runtime/node-<os>-<cpu>, replicating the global layout
 * `npm install -g pnpm` produces on each platform (shims resolve `node`
 * through PATH, which the desktop app prepends with the bundled runtime's
 * bin directory), so in-app `dsh plugin` flows work with zero preinstalled
 * tooling. The tarball is fetched from the npm registry and verified against
 * the metadata's dist.integrity sha512.
 *
 * Usage: node scripts/fetch-pnpm.mjs [11.24.0]
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractArchive } from './tar-extract.mjs';

const DEFAULT_PNPM_VERSION = '11.24.0';

// The bundled Node distributions staged by scripts/fetch-node.mjs. The pnpm
// layout follows the platform's npm global-install convention: unix dists
// keep packages under lib/node_modules with shims in bin/, the Windows dist
// keeps both at the distribution root next to node.exe.
const TARGETS = [
  { os: 'mac', cpu: 'arm64' },
  { os: 'mac', cpu: 'x64' },
  { os: 'win', cpu: 'x64' },
];

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.join(desktopDir, 'resources', 'runtime');
const requestedVersion = process.argv[2] ?? DEFAULT_PNPM_VERSION;

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'follow' });
  if (!response.ok) throw new Error('fetch failed: ' + response.status + ' ' + url);
  return response.json();
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error('download failed: ' + response.status + ' ' + url);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(dest, buffer);
  return buffer;
}

/** Verify a buffer against a registry dist.integrity string (sha512-<base64>). */
function assertIntegrity(buffer, integrity, label) {
  const [algorithm, expected] = String(integrity).split('-', 2);
  if (algorithm !== 'sha512') throw new Error('unsupported integrity algorithm for ' + label + ': ' + algorithm);
  const actual = createHash(algorithm).update(buffer).digest('base64');
  if (actual !== expected) throw new Error('integrity mismatch for ' + label + ': got ' + actual + ', want ' + expected);
}

/**
 * The npm-compatible shims for one staged distribution: [relativePath, text].
 * Relative paths keep the shims valid after electron-builder relocates the
 * distribution; the cmd shim's %~dp0 carries the trailing backslash. The
 * .cmd spelling matters on Windows because `dsh plugin` spawns pnpm through
 * cmd.exe there, while macOS resolves the shebang-less sh shim via PATH.
 * @param {'mac' | 'win'} os
 */
function shimLayout(os) {
  if (os === 'mac') {
    const sh = (name) => [
      'bin/' + name,
      '#!/bin/sh\n'
      + 'basedir=$(dirname "$0")\n'
      + "exec node \"$basedir/../lib/node_modules/pnpm/bin/" + name + ".cjs\" \"$@\"\n",
    ];
    return [sh('pnpm'), sh('pnpx')];
  }
  const cmd = (name) => [
    name + '.cmd',
    '@ECHO off\r\n'
    + 'SETLOCAL\r\n'
    + 'SET "_prog=%~dp0node_modules\\pnpm\\bin\\' + name + '.cjs"\r\n'
    + 'node "%_prog%" %*\r\n',
  ];
  const sh = (name) => [
    name,
    '#!/bin/sh\n'
    + 'basedir=$(dirname "$0")\n'
    + 'exec node "$basedir/node_modules/pnpm/bin/' + name + '.cjs" "$@"\n',
  ];
  return [cmd('pnpm'), cmd('pnpx'), sh('pnpm'), sh('pnpx')];
}

async function installPnpm(target, packageDir) {
  const outDir = path.join(outRoot, 'node-' + target.os + '-' + target.cpu);
  const marker = path.join(outDir, '.pnpm-version');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === requestedVersion) {
    console.log('[fetch-pnpm] ' + target.os + '-' + target.cpu + ' already at pnpm ' + requestedVersion + ', skipping');
    return;
  }
  if (!fs.existsSync(path.join(outDir, target.os === 'win' ? 'node.exe' : path.join('bin', 'node')))) {
    throw new Error('staged Node distribution is missing: ' + outDir + ' (run scripts/fetch-node.mjs first)');
  }

  const modulesDir = target.os === 'mac'
    ? path.join(outDir, 'lib', 'node_modules')
    : path.join(outDir, 'node_modules');
  fs.rmSync(path.join(modulesDir, 'pnpm'), { recursive: true, force: true });
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.cpSync(packageDir, path.join(modulesDir, 'pnpm'), { recursive: true, dereference: true });

  for (const [relative, text] of shimLayout(target.os)) {
    const shim = path.join(outDir, relative);
    fs.mkdirSync(path.dirname(shim), { recursive: true });
    fs.writeFileSync(shim, text, { mode: 0o755 });
  }

  fs.writeFileSync(marker, requestedVersion + '\n');
  console.log('[fetch-pnpm] staged pnpm ' + requestedVersion + ' into ' + path.relative(desktopDir, outDir));
}

async function main() {
  const pnpmVersion = requestedVersion;
  const meta = await fetchJson('https://registry.npmjs.org/pnpm/' + pnpmVersion);
  const dist = meta && meta.dist;
  if (!dist || !dist.tarball || !dist.integrity) {
    throw new Error('registry metadata for pnpm@' + pnpmVersion + ' has no dist.tarball/integrity');
  }
  // One download serves every target: the pnpm package tarball is
  // platform-independent, only the shim layout differs.
  console.log('[fetch-pnpm] downloading pnpm@' + pnpmVersion);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pnpm-'));
  const archive = path.join(tmp, 'pnpm.tgz');
  const buffer = await download(dist.tarball, archive);
  assertIntegrity(buffer, dist.integrity, 'pnpm@' + pnpmVersion);

  const unpackDir = path.join(tmp, 'unpacked');
  fs.mkdirSync(unpackDir, { recursive: true });
  extractArchive(archive, unpackDir);
  const packageDir = path.join(unpackDir, 'package');
  if (!fs.existsSync(path.join(packageDir, 'package.json'))) {
    throw new Error('unexpected pnpm tarball layout: no package/package.json');
  }

  try {
    for (const target of TARGETS) {
      await installPnpm(target, packageDir);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[fetch-pnpm] ' + String(error && error.message ? error.message : error));
  process.exitCode = 1;
});
