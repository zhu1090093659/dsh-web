#!/usr/bin/env node
/**
 * Runtime dependency guardrail (issue #70).
 *
 * Every bare (non-relative) import in a package's committed lib/ must
 * resolve at consumer install time:
 *
 * - node:* builtins are always available;
 * - @deepseek-ai/* is provided by the DSH runtime (see .npmrc);
 * - everything else must be declared in the package's `dependencies`.
 *
 * A runtime import of a package that only sits in devDependencies crashes
 * dsh web at boot with ERR_MODULE_NOT_FOUND (skin-center 0.1.9, issue #70):
 * pnpm/npm do not install a dependency's devDependencies, so the module
 * cannot resolve. This script makes that whole bug class fail fast in CI
 * instead of at user boot.
 *
 * Only git-tracked lib/ files are scanned: some packages deliberately do not
 * commit lib/ (e.g. dsh-ssh ships a release build that bundles its deps), so
 * scanning the working tree would flag stale build leftovers that are not
 * part of the repository's shipped state.
 *
 * Usage: node scripts/runtime-deps-check.mjs
 * Tests: node --test scripts/runtime-deps-check.test.mjs
 */

import { readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const BARE_IMPORT = /(?:from\s+|import\s*\()\s*['"]([^'".][^'"]*)['"]/g

/**
 * Check a single package's lib sources against its declared dependencies.
 *
 * Pure function (no filesystem access) so the node:test suite can feed it
 * inline fixtures.
 *
 * @param {{ dependencies?: Record<string,string> }} pkgJson package.json
 * @param {Record<string,string>} files map of file path -> source text
 * @returns {{ file: string, specifier: string }[]} violations
 */
export function checkRuntimeImports(pkgJson, files) {
  const deps = new Set(Object.keys(pkgJson.dependencies ?? {}))
  const violations = []
  for (const [file, source] of Object.entries(files)) {
    for (const match of source.matchAll(BARE_IMPORT)) {
      const specifier = match[1]
      if (specifier.startsWith('node:')) continue
      if (specifier.startsWith('@deepseek-ai/')) continue
      // Support subpath imports ('pkg/sub/path' or '@scope/pkg/sub').
      const depKey = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]
      if (deps.has(depKey)) continue
      violations.push({ file, specifier })
    }
  }
  return violations
}

/** All git-tracked files under packages/, grouped by package dir. */
function trackedPackageFiles() {
  const files = execFileSync('git', ['ls-files', 'packages'], { encoding: 'utf8', cwd: ROOT })
    .split('\n')
    .filter(Boolean)
  const byDir = new Map()
  for (const file of files) {
    const dir = dirname(file)
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push(file)
  }
  return byDir
}

const isCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

if (isCli) {
  const byDir = trackedPackageFiles()
  let failed = 0
  for (const [dir, files] of byDir) {
    if (!files.includes(`${dir}/package.json`)) continue
    const pkgJson = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'))
    const libPrefix = `${dir}/lib/`
    const libFiles = files.filter((f) => f.startsWith(libPrefix) && /\.(?:js|cjs|mjs)$/.test(f))
    if (libFiles.length === 0) continue
    const sources = Object.fromEntries(libFiles.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]))
    const violations = checkRuntimeImports(pkgJson, sources)
    if (violations.length === 0) {
      console.log(`[OK]   ${pkgJson.name}`)
    } else {
      failed += 1
      console.error(`[FAIL] ${pkgJson.name}`)
      for (const v of violations) {
        console.error(`       ${v.file} imports "${v.specifier}" which is not in dependencies`)
      }
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} package(s) FAILED runtime dependency check`)
    process.exit(1)
  }
  console.log('\nall packages pass the runtime dependency check')
}
