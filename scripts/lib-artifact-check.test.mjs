/**
 * Unit tests for the committed-lib fingerprint guard: which files reach a
 * bundle, that the fingerprint is order-independent and content-sensitive, and
 * that the aggregate manifest's package lists are read completely.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fingerprintEntries, isBundledSource, parseAggregateInputs } from './lib-artifact-check.mjs'

describe('isBundledSource', () => {
  it('keeps shipped sources', () => {
    assert.equal(isBundledSource('client/index.ts'), true)
    assert.equal(isBundledSource('client/runtime/shell-rendering.ts'), true)
    assert.equal(isBundledSource('reviewed-hooks.generated.ts'), true)
  })

  it('drops tests wherever they sit', () => {
    assert.equal(isBundledSource('client/gameplay-hud.test.tsx'), false)
    assert.equal(isBundledSource('client/work-tick-gate.test.ts'), false)
    assert.equal(isBundledSource('tests/routes.spec.ts'), false)
    assert.equal(isBundledSource('client/tests/helper.ts'), false)
    assert.equal(isBundledSource('gameplay.spec.ts'), false)
  })
})

describe('fingerprintEntries', () => {
  it('is independent of input order', () => {
    const a = fingerprintEntries([['b.ts', '2'], ['a.ts', '1']])
    const b = fingerprintEntries([['a.ts', '1'], ['b.ts', '2']])
    assert.equal(a, b)
  })

  it('tracks content and membership', () => {
    const base = fingerprintEntries([['a.ts', '1']])
    assert.notEqual(base, fingerprintEntries([['a.ts', '2']]))
    assert.notEqual(base, fingerprintEntries([['a.ts', '1'], ['b.ts', '1']]))
    assert.notEqual(base, fingerprintEntries([['b.ts', '1']]))
  })
})

describe('parseAggregateInputs', () => {
  it('reads every ../ entry from the list sections', () => {
    const yaml = [
      'patchFrom:',
      '  - ../dsh-market',
      '  - ../dsh-usage',
      'self:',
      '  - ../dsh-web-all',
      'deps:',
      '  - ../skins/skin-center',
      'inactive:',
      '  - web-ui-pet',
    ].join('\n')
    assert.deepEqual(parseAggregateInputs(yaml), [
      'packages/dsh-market',
      'packages/dsh-usage',
      'packages/dsh-web-all',
      'packages/skins/skin-center',
    ].sort())
  })

  it('ignores lines that are not list entries', () => {
    assert.deepEqual(parseAggregateInputs('# comment\ndeps:\n'), [])
  })
})
