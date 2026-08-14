/**
 * T2 — composition semantics test against the REAL patch algorithm
 * (`applyEntryPatches` from @deepseek-ai/cordis-plugin-include, the exact
 * code DSH uses when composing bundle layers + the profile patch).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'

const PATCH = new URL('../cordis.patch.yml', import.meta.url)
const patches = () => yaml.load(readFileSync(PATCH, 'utf8'))
const clone = (x) => structuredClone(x)

/** A realistic entry list: built-in pet + whale-girl + an unrelated plugin. */
const base = [
  { id: 'pet', name: '@linxin666/dsh-pet' },
  { id: 'whale-girl', name: 'whale-girl' },
  { id: 'ui-task-board', name: '@linxin666/dsh-client-ui-task-board' },
]

test('applying the patch isolates only the built-in pet row', () => {
  const warns = []
  const out = applyEntryPatches(clone(base), patches(), (m) => warns.push(m))
  const pet = out.find((e) => e.id === 'pet')
  assert.deepEqual(pet.isolate, { pet: true })
  assert.deepEqual(
    out.find((e) => e.id === 'whale-girl'),
    { id: 'whale-girl', name: 'whale-girl' },
    'whale-girl row must stay untouched',
  )
  assert.deepEqual(
    out.find((e) => e.id === 'ui-task-board'),
    { id: 'ui-task-board', name: '@linxin666/dsh-client-ui-task-board' },
    'unrelated row must stay untouched',
  )
  assert.equal(warns.length, 0, 'all rows matched; no warnings expected')
})

test('no built-in pet row: patch warns and is skipped without throwing', () => {
  const warns = []
  const data = clone(base).filter((e) => e.id !== 'pet')
  const out = applyEntryPatches(data, patches(), (m) => warns.push(m))
  assert.deepEqual(out, data, 'input must be returned unchanged')
  assert.ok(warns.length >= 1, 'must warn about the unmatched id')
})

test('name mismatch: patch skipped with a warning, pet row untouched', () => {
  const warns = []
  const data = clone(base).map((e) => (e.id === 'pet' ? { ...e, name: '@other/pet' } : e))
  const out = applyEntryPatches(data, patches(), (m) => warns.push(m))
  const pet = out.find((e) => e.id === 'pet')
  assert.equal(pet.isolate, undefined, 'patch must not apply when the name guard fails')
  assert.ok(warns.length >= 1, 'must warn about the name mismatch')
})
