import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  legacyDualPublishedCount,
  rewriteLegacyClient,
  rewriteLegacyPackageJson,
  rewriteLegacyPatch,
} from './publish-legacy-aggregate.mjs'

test('legacy manifest gains migration metadata and old npm identity', () => {
  const output = rewriteLegacyPackageJson(JSON.stringify({
    name: '@linxin666/dsh-web-all',
    version: '0.3.3',
    dsh: { engines: { dsh: '>=0.1.1-rc.1' } },
  }), '0.3.3')
  const pkg = JSON.parse(output)
  assert.equal(pkg.name, '@linxin666/dsh-web-ui-all')
  assert.deepEqual(pkg.dsh.migrate, { to: '@linxin666/dsh-web-all', since: '0.3.3' })
})

test('legacy patch self row points to the old package', () => {
  const output = rewriteLegacyPatch("- insert:\n    - id: web-ui-compat\n      name: '@linxin666/dsh-web-all'\n")
  assert.match(output, /name: '@linxin666\/dsh-web-ui-all'/)
  assert.doesNotMatch(output, /name: '@linxin666\/dsh-web-all'/)
})

test('legacy client bundle loader id is rewritten', () => {
  assert.equal(rewriteLegacyClient('id: "@linxin666/dsh-web-all"'), 'id: "@linxin666/dsh-web-ui-all"')
})

test('dual-publish skips after the two-release transition window', () => {
  const migrated = (count) => ({
    versions: Object.fromEntries(Array.from({ length: count }, (_, index) => [
      `0.3.${String(3 + index)}`,
      { dsh: { migrate: { to: '@linxin666/dsh-web-all' } } },
    ])),
  })
  assert.equal(legacyDualPublishedCount({ view: () => JSON.stringify(migrated(1)) }), 1)
  assert.equal(legacyDualPublishedCount({ view: () => JSON.stringify(migrated(2)) }), 2)
  assert.throws(() => legacyDualPublishedCount({ view: () => 'not json' }), /cannot read/)
})
