/**
 * Host-core dependency invariant: no published family package may declare a
 * host core package (`@deepseek-ai/dsh` or `@deepseek-ai/dsh-*`) as a runtime
 * `dependencies` entry.
 *
 * Why it is an invariant rather than a style preference (issue #1966): the
 * plugin manager installs a package's `dependencies` into the user profile, and
 * the host loads profile copies ahead of its own. A core package pinned with a
 * prerelease range is therefore a version switch the user never asked for:
 * `^0.2.2-alpha.3` desugars to `>=0.2.2-alpha.3 <0.3.0-0`, so the next rc of the same
 * 0.2.1 cohort (`0.2.1-rc.4`) satisfies it. pnpm then hoists rc.4 into
 * `profiles/<profile>/node_modules/@deepseek-ai`, where it shadows the rc.3 the
 * running host supplies, `sessionProjections` never registers, and the required
 * `agent-loop` plugin fails activation — taking every plugin that waits on that
 * service down with it (`1 required plugin did not activate`).
 *
 * The family convention that keeps this from happening: core packages are a
 * build-time (types and host-half value imports) concern and belong in
 * `devDependencies`; the runtime copy always comes from the host, whose version
 * is already declared by the single host peer `"@deepseek-ai/dsh": ">=<cohort>"`.
 * `@deepseek-ai/schemastery` and `@deepseek-ai/cordis` are libraries rather
 * than host core packages and may stay in `dependencies`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkFamilyPackages } from './lib/family-packages.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const HOST_CORE = /^@deepseek-ai\/dsh($|[-/])/

test('no family package pulls a host core package in as a runtime dependency', () => {
  // optionalDependencies is installed by the plugin manager just like
  // dependencies, so it is the same defect wearing a different key.
  const RUNTIME_SECTIONS = ['dependencies', 'optionalDependencies']
  const offenders = []
  for (const { pkgPath } of walkFamilyPackages(ROOT)) {
    const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
    for (const section of RUNTIME_SECTIONS) {
      for (const name of Object.keys(manifest[section] ?? {})) {
        if (HOST_CORE.test(name)) {
          offenders.push(relative(ROOT, pkgPath) + ': ' + section + ' ' + name)
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'host core packages must be devDependencies (types, host-half imports) while the running host supplies the runtime copy; declaring one in dependencies installs a second copy into the user profile and can shadow the host the user actually runs (issue #1966)',
  )
})
