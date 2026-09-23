import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_REGISTRY, assertPublished, missingVersions, sweepOnce, versionDocUrl } from './verify-registry.mjs'

test('versionDocUrl encodes the scope and normalizes the registry base', () => {
  assert.equal(versionDocUrl('@linxin666/dsh-web-all', '0.3.18'),
    DEFAULT_REGISTRY + '/%40linxin666%2Fdsh-web-all/0.3.18')
  assert.equal(versionDocUrl('@linxin666/dsh-web-all', '0.3.18', 'https://example.test/'),
    'https://example.test/%40linxin666%2Fdsh-web-all/0.3.18')
})

test('missingVersions keeps input order and drops resolved packages', () => {
  const results = [
    { name: 'a', ok: true },
    { name: 'b', ok: false, reason: 'HTTP 404' },
    { name: 'c', ok: false, reason: 'boom' },
  ]
  assert.deepEqual(missingVersions(results), ['b', 'c'])
  assert.deepEqual(missingVersions([{ name: 'a', ok: true }]), [])
})

/** One fake response; ok defaults to a 200. */
function response(status, ok = status === 200) {
  return { ok, status, text: async () => '' }
}

test('sweepOnce reports one result per package and treats errors as misses', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    if (url.includes('boom')) throw new Error('network down')
    if (url.includes('missing')) return response(404)
    return response(200)
  }
  const results = await sweepOnce({
    packages: ['@linxin666/ok', '@linxin666/missing', '@linxin666/boom'],
    version: '1.0.0',
    fetchImpl,
  })
  assert.equal(calls.length, 3)
  assert.deepEqual(results.map(result => [result.name, result.ok]), [
    ['@linxin666/ok', true],
    ['@linxin666/missing', false],
    ['@linxin666/boom', false],
  ])
  assert.equal(results[1].reason, 'HTTP 404')
  assert.equal(results[2].reason, 'network down')
})

test('assertPublished retries propagation lag until every version resolves', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    // First full sweep misses, the second resolves.
    return calls <= 2 ? response(404) : response(200)
  }
  const sleeps = []
  const results = await assertPublished({
    packages: ['a', 'b'],
    version: '1.0.0',
    attempts: 5,
    delayMs: 7,
    fetchImpl,
    sleep: async ms => { sleeps.push(ms) },
  })
  assert.equal(calls, 4)
  assert.deepEqual(sleeps, [7])
  assert.deepEqual(missingVersions(results), [])
})

test('assertPublished gives up after the attempt budget without extra sleeps', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return response(404)
  }
  const sleeps = []
  const results = await assertPublished({
    packages: ['a'],
    version: '1.0.0',
    attempts: 3,
    delayMs: 5,
    fetchImpl,
    sleep: async ms => { sleeps.push(ms) },
  })
  assert.equal(calls, 3)
  assert.deepEqual(sleeps, [5, 5])
  assert.deepEqual(missingVersions(results), ['a'])
})
