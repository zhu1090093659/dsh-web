import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEGACY_DUAL_PUBLISH_WINDOW_OPEN,
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

test('legacy patch family subpath rows point to the old package too', () => {
  const output = rewriteLegacyPatch("- insert:\n    - id: web-ui-usage\n      name: '@linxin666/dsh-web-all/usage'\n      config:\n        plugin: '@linxin666/dsh-usage'\n")
  assert.match(output, /name: '@linxin666\/dsh-web-ui-all\/usage'/)
  assert.doesNotMatch(output, /name: '@linxin666\/dsh-web-all\//)
  // The real plugin config is untouched.
  assert.match(output, /plugin: '@linxin666\/dsh-usage'/)
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

test('the legacy dual-publish window stays closed by release policy', () => {
  // Reopening requires a deliberate change here plus a repaired registry-
  // shape handling in legacyDualPublishedCount; see the constant's doc.
  assert.equal(LEGACY_DUAL_PUBLISH_WINDOW_OPEN, false)
})

test('abbreviated registry documents are rejected instead of counted as zero', () => {
  const abbreviated = JSON.stringify({ distTags: {}, versions: ['0.3.3', '0.3.4', '0.3.5'] })
  assert.throws(() => legacyDualPublishedCount({ view: () => abbreviated }), /abbreviated/)
  const stringEntries = JSON.stringify({ versions: Object.fromEntries([
    ['0.3.5', 'not-an-object'],
  ]) })
  assert.throws(() => legacyDualPublishedCount({ view: () => stringEntries }), /abbreviated/)
})
