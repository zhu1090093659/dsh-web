#!/usr/bin/env node
'use strict';

/**
 * Download the official Node.js distributions the desktop app bundles, one
 * directory per shipped target under desktop/resources/runtime/node-<os>-<cpu>.
 * Every download is verified against the release's SHASUMS256.txt.
 *
 * Usage: node scripts/fetch-node.mjs [v24.20.0]
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { extractArchive } from './tar-extract.mjs';

const require = createRequire(import.meta.url);
const { parseShasums } = require('../src/runtime.cjs');

const DEFAULT_NODE_VERSION = 'v24.20.0';
// distOs is Node's own archive naming (darwin/win); the staged directory
// keeps the electron-builder ${os}-${arch} spelling (mac/win) so the
// extraResources glob `node-${os}-${arch}` resolves. A missing source only
// WARNS in electron-builder and silently ships an app without the runtime.
const TARGETS = [
  { os: 'mac', cpu: 'arm64', ext: 'tar.gz', distOs: 'darwin' },
  { os: 'mac', cpu: 'x64', ext: 'tar.gz', distOs: 'darwin' },
  { os: 'win', cpu: 'x64', ext: 'zip', distOs: 'win' },
];

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.join(desktopDir, 'resources', 'runtime');

async function download(url, dest) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error('download failed: ' + response.status + ' ' + url);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(dest, buffer);
  return buffer;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function extract(archive, destDir) {
  // tar-extract prefers the System32 bsdtar on Windows: Git-bash GNU tar
  // rejects drive-letter paths and cannot read the win-x64 zip at all.
  extractArchive(archive, destDir);
}

/**
 * Copy a distribution tree, preserving symlinks verbatim. The official
 * tarballs only carry in-tree relative links (bin/npm ->
 * ../lib/node_modules/npm/bin/npm-cli.js) that stay valid after relocation,
 * and npm's CLI resolves modules relative to its real path, so replacing
 * links with their targets breaks it — while fs.cpSync's dereference: true
 * rewrites the relative targets into absolute paths into the deleted
 * extraction temp dir (observed on Node 25), which is worse.
 */
function copyTree(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(fs.readlinkSync(source), destination);
    return;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, stat.mode);
    return;
  }
  if (!stat.isDirectory()) throw new Error('unexpected file type while copying ' + source);
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    copyTree(path.join(source, entry), path.join(destination, entry));
  }
}

/** Fail when a staged symlink escapes the distribution or dangles. */
function assertInTreeSymlinks(root) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = path.resolve(path.dirname(full), fs.readlinkSync(full));
        if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) {
          throw new Error('staged Node distribution contains a broken symlink: ' + path.relative(root, full) + ' -> ' + fs.readlinkSync(full));
        }
      } else if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
}

async function main() {
  const version = process.argv[2] ?? DEFAULT_NODE_VERSION;
  const base = 'https://nodejs.org/dist/' + version;
  const sumsText = await (await fetch(base + '/SHASUMS256.txt')).text();
  const sums = parseShasums(sumsText);

  for (const target of TARGETS) {
    const name = 'node-' + version + '-' + target.distOs + '-' + target.cpu;
    const file = name + '.' + target.ext;
    const expected = sums.get(file);
    if (expected === undefined) throw new Error('SHASUMS256.txt has no entry for ' + file);

    const outDir = path.join(outRoot, 'node-' + target.os + '-' + target.cpu);
    const marker = path.join(outDir, '.node-version');
    if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === version) {
      console.log('[fetch-node] ' + target.os + '-' + target.cpu + ' already at ' + version + ', skipping');
      // Assert even on the skip path: an older script version could have
      // staged a distribution whose bin shims are dangling symlinks.
      assertInTreeSymlinks(outDir);
      continue;
    }

    console.log('[fetch-node] downloading ' + file);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-node-'));
    const archive = path.join(tmp, file);
    const buffer = await download(base + '/' + file, archive);
    const actual = sha256(buffer);
    if (actual !== expected) throw new Error('sha256 mismatch for ' + file + ': got ' + actual + ', want ' + expected);

    const unpackDir = path.join(tmp, 'unpacked');
    extract(archive, unpackDir);
    const entries = fs.readdirSync(unpackDir);
    if (entries.length !== 1) throw new Error('unexpected archive layout for ' + file + ': ' + entries.join(', '));

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outRoot, { recursive: true });
    copyTree(path.join(unpackDir, entries[0]), outDir);
    assertInTreeSymlinks(outDir);
    fs.writeFileSync(marker, version + '\n');
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('[fetch-node] staged ' + target.os + '-' + target.cpu + ' -> ' + path.relative(desktopDir, outDir));
  }
}

main().catch((error) => {
  console.error('[fetch-node] ' + String(error && error.message ? error.message : error));
  process.exitCode = 1;
});
