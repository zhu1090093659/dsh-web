import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)
const fingerprints = JSON.parse(readFileSync(new URL('scripts/lib-artifact-fingerprints.json', root), 'utf8'))

/**
 * Committed client artifacts that consume the client store.
 *
 * dsh-web-all used to be one of them: its browser bundle inlined every family
 * plugin's client half, so it pulled in the same snapshot store. Family rows
 * mount their real packages now (issue #1901) and the bundle is the compat
 * patch layer alone, so it consumes no store at all — asserted below, because
 * re-inlining a family client is exactly how that cost came back.
 */
const storeConsumers = ['packages/dsh-market']
const patchLayerOnly = 'packages/dsh-web-all'

for (const dir of storeConsumers) {
  const file = `${dir}/lib/client.js`
  test(`${file} resolves the snapshot store through the supported platform`, () => {
    // Given a committed client artifact, when mounted, then use one supported store identity.
    assert.ok(Object.hasOwn(fingerprints, dir), 'the store-consuming artifact must remain in the committed registry')
    const source = readFileSync(fileURLToPath(new URL(file, root)), 'utf8')
    assert.equal(/\brequire\s*\(\s*["']@deepseek-ai\/dsh-client-store["']\s*\)/.test(source), true, 'store must resolve through the supported platform')
    assert.equal(/dsh-store-engine|@deepseek-ai\/dsh-client-runtime/.test(source), false, 'legacy store resolution must not ship')
  })
}

test(`${patchLayerOnly}/lib/client.js carries the compat patch layer and no family client`, () => {
  // Given the aggregate's committed browser bundle, when it is served to a
  // page, then it must be the patch layer alone: no family UI, no store
  // consumer, no legacy runtime. A family plugin brings its own browser half
  // through its own loader row, and only a page that enabled that row pays
  // for it (issue #1901: the inlined copy was 2.9 MB served to every page).
  assert.ok(Object.hasOwn(fingerprints, patchLayerOnly), 'the compat artifact must remain in the committed registry')
  const source = readFileSync(fileURLToPath(new URL(`${patchLayerOnly}/lib/client.js`, root)), 'utf8')
  assert.equal(/\brequire\s*\(\s*["']@deepseek-ai\/dsh-client-store["']\s*\)/.test(source), false, 'the compat layer must consume no store')
  assert.equal(/dsh-store-engine|@deepseek-ai\/dsh-client-runtime/.test(source), false, 'legacy store resolution must not ship')
  // The family client packages, by their own names: importing one here is the
  // regression this assertion exists for.
  for (const pkg of ['dsh-client-ui-task-board', 'dsh-client-ui-git-graph', 'dsh-usage', 'dsh-ssh', 'dsh-session-archive']) {
    assert.equal(source.includes(`@linxin666/${pkg}/client`), false, `the compat layer must not inline ${pkg}`)
  }
})
