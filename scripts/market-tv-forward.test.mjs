import test from 'node:test'
import assert from 'node:assert/strict'

import worker from '../market/worker/src/index.js'

function context() { return { waitUntil() {} } }

test('tv.dsh-market.com forwards the whole hostname to the telemetry-view binding', async () => {
  const forwarded = []
  const env = {
    TELEMETRY_VIEW: {
      fetch: async (req) => {
        forwarded.push(req)
        return new Response('<h1>dashboard</h1>', { status: 200 })
      },
    },
  }
  const request = new Request('https://tv.dsh-market.com/', { headers: { 'cf-access-jwt-assertion': 'jwt-value' } })
  const res = await worker.fetch(request, env, context())
  assert.equal(res.status, 200)
  assert.equal(await res.text(), '<h1>dashboard</h1>')
  assert.equal(forwarded.length, 1)
  // The Access JWT must ride along: telemetry-view re-verifies it itself.
  assert.equal(forwarded[0].headers.get('cf-access-jwt-assertion'), 'jwt-value')
})

test('tv.dsh-market.com /app.js forwards instead of serving the store asset', async () => {
  const env = {
    TELEMETRY_VIEW: { fetch: async () => new Response('dashboard-client-js', { headers: { 'content-type': 'text/javascript' } }) },
    ASSETS: { fetch: async () => { throw new Error('assets must not be consulted for tv.dsh-market.com') } },
  }
  const res = await worker.fetch(new Request('https://tv.dsh-market.com/app.js'), env, context())
  assert.equal(await res.text(), 'dashboard-client-js')
})

test('store host keeps serving its own /app.js asset without touching the binding', async () => {
  const env = {
    TELEMETRY_VIEW: { fetch: async () => { throw new Error('binding must not be called for the store host') } },
    ASSETS: { fetch: async () => new Response('store-app-js', { headers: { 'content-type': 'text/javascript' } }) },
  }
  const res = await worker.fetch(new Request('https://dsh-market.com/app.js'), env, context())
  assert.equal(res.headers.get('content-type'), 'text/javascript')
  assert.equal(await res.text(), 'store-app-js')
})
