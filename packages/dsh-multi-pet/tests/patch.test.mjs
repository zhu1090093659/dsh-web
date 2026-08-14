/**
 * T1 — patch content test.
 * The shipped cordis.patch.yml must be a single id-targeted patch that
 * isolates the built-in pet entry with an entry-local realm (`isolate.pet`
 * exactly `true`). A shared-label string would map two pet providers onto the
 * same symbol and re-trigger the duplicate-service conflict.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'

const PATCH = new URL('../cordis.patch.yml', import.meta.url)

test('cordis.patch.yml parses as a single id-targeted patch', () => {
  const parsed = yaml.load(readFileSync(PATCH, 'utf8'))
  assert.ok(Array.isArray(parsed), 'patch must be a top-level YAML array')
  assert.equal(parsed.length, 1, 'exactly one patch entry')
  const [entry] = parsed
  assert.equal(entry.id, 'pet', 'targets the built-in pet entry id')
  assert.equal(entry.name, '@linxin666/dsh-pet', 'name guard pins the exact package')
  assert.ok(entry.isolate !== null && typeof entry.isolate === 'object', 'isolate map present')
  assert.equal(entry.isolate.pet, true, 'isolate.pet must be exactly true (entry-local realm), never a shared label string')
  assert.equal(Object.keys(entry.isolate).length, 1, 'only pet is isolated')
})
