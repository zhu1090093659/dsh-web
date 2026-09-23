/**
 * Tests for the root alias aggregate pin (issue #1442): the root bundle's
 * dependency must name the exact released aggregate version, because a range
 * can resolve to an aggregate whose exports predate the shipped patch rows.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rootAggregatePinMismatch } from './lib/root-alias-pin.mjs'

const manifest = spec => ({ dependencies: { '@linxin666/dsh-web-all': spec } })

test('accepts an exact pin on the tag version', () => {
  assert.equal(rootAggregatePinMismatch(manifest('0.3.20'), '0.3.20'), undefined)
})

test('rejects a range, a stale pin, and a missing dependency', () => {
  assert.match(rootAggregatePinMismatch(manifest('^0.3.6'), '0.3.20'), /\^0\.3\.6 does not match tag v0\.3\.20/)
  assert.match(rootAggregatePinMismatch(manifest('0.3.19'), '0.3.20'), /does not match/)
  assert.match(rootAggregatePinMismatch({ dependencies: {} }, '0.3.20'), /\(missing\)/)
  assert.match(rootAggregatePinMismatch({}, '0.3.20'), /\(missing\)/)
  assert.match(rootAggregatePinMismatch(null, '0.3.20'), /\(missing\)/)
})
