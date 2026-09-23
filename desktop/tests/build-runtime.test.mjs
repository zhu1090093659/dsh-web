/**
 * build-runtime payload contract: the staged desktop payload must not carry
 * pnpm's .modules.yaml, whose storeDir points at the CI runner's store and
 * breaks in-app plugin updates with ERR_PNPM_UNEXPECTED_STORE (#1669).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removePnpmModulesManifests } from '../scripts/build-runtime.mjs';

function withTempTree(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runtime-manifests-'));
  try {
    return build(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('operator stages a payload whose nested .modules.yaml files are cleared and whose other files survive', () => {
  // Given a staged node_modules tree carrying pnpm manifests and real payload files
  withTempTree((root) => {
    const nested = path.join(root, 'pkg', 'node_modules', 'dep', 'node_modules');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(root, '.modules.yaml'), 'storeDir: /Users/runner/setup-pnpm/store/v11\n');
    fs.writeFileSync(path.join(nested, '.modules.yaml'), 'storeDir: /Users/runner/setup-pnpm/store/v11\n');
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"profile-web"}');
    fs.writeFileSync(path.join(nested, 'index.js'), 'module.exports = 1');

    // When the staging cleanup runs over the tree
    const removed = removePnpmModulesManifests(root);

    // Then both manifests are gone and the runtime files are untouched
    assert.equal(removed, 2, 'both manifests are removed');
    assert.equal(fs.existsSync(path.join(root, '.modules.yaml')), false);
    assert.equal(fs.existsSync(path.join(nested, '.modules.yaml')), false);
    assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), '{"name":"profile-web"}');
    assert.equal(fs.readFileSync(path.join(nested, 'index.js'), 'utf8'), 'module.exports = 1');
  });
});

test('operator staging reports zero when the payload carries no pnpm manifest', () => {
  // Given a payload tree with no .modules.yaml anywhere
  withTempTree((root) => {
    fs.mkdirSync(path.join(root, 'pkg'), { recursive: true });

    // When the staging cleanup runs
    const removed = removePnpmModulesManifests(root);

    // Then it reports that it stripped nothing, which stage() treats as a layout change
    assert.equal(removed, 0);
  });
});

test('operator staging tolerates a payload root that does not exist yet', () => {
  // Given a path that was never created
  withTempTree((root) => {
    // When the staging cleanup runs against it
    const removed = removePnpmModulesManifests(path.join(root, 'nope'));

    // Then it is a no-op rather than a crash
    assert.equal(removed, 0);
  });
});

test('operator sees no CI store path left anywhere in a cleaned payload', () => {
  // Given a payload whose manifest pins the build machine's store
  withTempTree((root) => {
    const ciManifest = path.join(root, 'node_modules', '.modules.yaml');
    fs.mkdirSync(path.dirname(ciManifest), { recursive: true });
    fs.writeFileSync(ciManifest, JSON.stringify({ storeDir: '/Users/runner/setup-pnpm/node_modules/.bin/store/v11' }));

    // When the staged node_modules is cleaned
    removePnpmModulesManifests(path.join(root, 'node_modules'));

    // Then nothing remains that mentions the runner store
    assert.deepEqual(fs.readdirSync(path.join(root, 'node_modules')), []);
  });
});
