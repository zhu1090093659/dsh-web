/** Generated reviewed-hooks registry drift gate. */

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts', 'skin-hooks-registry.mjs')
const GENERATED = join(ROOT, 'packages', 'skins', 'skin-center', 'src', 'reviewed-hooks.generated.ts')

test('reviewed hooks registry is current', () => {
  const out = execFileSync(process.execPath, [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8' })
  assert.match(out, /check OK/)
})

test('check mode reports a stale generated registry without rewriting it', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'skin-hooks-registry-'))
  const copyRoot = join(sandbox, 'repo')
  const copiedScript = join(copyRoot, 'scripts', 'skin-hooks-registry.mjs')
  const copiedGenerated = join(copyRoot, 'packages', 'skins', 'skin-center', 'src', 'reviewed-hooks.generated.ts')
  try {
    for (const [source, target] of [
      [SCRIPT, copiedScript],
      [GENERATED, copiedGenerated],
    ]) {
      const targetDir = dirname(target)
      execFileSync(process.execPath, ['-e', 'require("node:fs").mkdirSync(process.argv[1],{recursive:true})', targetDir])
      writeFileSync(target, readFileSync(source))
    }
    const sourceSkins = join(ROOT, 'packages', 'skins', 'skin-center', 'skins')
    const targetSkins = join(copyRoot, 'packages', 'skins', 'skin-center', 'skins')
    execFileSync(process.execPath, ['-e', [
      'const fs=require("node:fs")',
      'fs.cpSync(process.argv[1],process.argv[2],{recursive:true})',
    ].join(';'), sourceSkins, targetSkins])
    writeFileSync(copiedGenerated, '// stale\n')
    const result = spawnSync(process.execPath, [copiedScript, '--check'], { cwd: copyRoot, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /generated registry is stale/)
    assert.equal(readFileSync(copiedGenerated, 'utf8'), '// stale\n')
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
