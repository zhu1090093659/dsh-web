import test from 'node:test'
import assert from 'node:assert/strict'

import viewer from '../market/telemetry-view/src/index.js'
import { CLIENT_JS, renderDashboard, PAGE_CSP } from '../market/telemetry-view/src/page.js'

function context() { return { waitUntil() {} } }

test('telemetry-view refuses to serve until Access secrets are configured', async () => {
  const response = await viewer.fetch(new Request('https://tv.dsh-market.com/'), {}, context())
  assert.equal(response.status, 503)
  assert.match(await response.text(), /setup required/)
})

test('telemetry-view rejects requests without a valid Access JWT', async () => {
  const env = { ACCESS_TEAM: 'team', ACCESS_AUD: 'aud', TELEMETRY_READ_KEY: 'key' }
  const page = await viewer.fetch(new Request('https://tv.dsh-market.com/'), env, context())
  assert.equal(page.status, 401)
  const data = await viewer.fetch(new Request('https://tv.dsh-market.com/data?days=7'), env, context())
  assert.equal(data.status, 401)
})

test('dashboard document inlines CSP-safe boot data and the paginated shell', () => {
  const html = renderDashboard({
    days: 30,
    sizes: { paths: 10, items: 10 },
    data: {
      ok: true,
      range: { days: 30, since: '2026-07-28' },
      site: {
        totals: { pv: 3, uv_daily_sum: 2 },
        daily: [{ day: '2026-08-25', pv: 1, uv: 1 }, { day: '2026-08-26', pv: 2, uv: 1 }],
        top_paths: [{ path: '/</script><script>alert(1)</script>', pv: 2 }],
        paths_total: 1,
        paths_page: { offset: 0, limit: 10 },
      },
      plugins: { totals: { uv_daily_sum: 0, items: 0 }, daily: [], items_page: { offset: 0, limit: 10 }, items: [] },
    },
  })
  // No executable inline script: the client loads from same-origin /app.js
  // and boot data rides an inert JSON block, so an edge-injected CSP nonce
  // (which neutralizes 'unsafe-inline') cannot block the app.
  assert.ok(!html.includes('<script data-cfasync="false">'), 'no inline executable script remains')
  const bootMatch = html.match(/<script type="application\/json" id="boot-data">([\s\S]*?)<\/script>/)
  assert.ok(bootMatch, 'inert boot-data block present')
  assert.ok(!bootMatch[1].includes('</' + 'script>'), 'boot JSON must not self-terminate its block')
  assert.ok(bootMatch[1].includes('\\u003c'), 'angle brackets in data are unicode-escaped')
  const boot = JSON.parse(bootMatch[1])
  assert.equal(boot.data.site.top_paths[0].path, '/</script><script>alert(1)</script>')
  assert.ok(html.includes('<script src="/app.js"'), 'external client script referenced')
  assert.ok(html.includes('id="paths-pager"'))
  assert.ok(html.includes('id="items-pager"'))
  // Rollup freshness and degradation must be visible in the shell: a frozen
  // rollup once read as "lost days" because only the fetch time was shown.
  assert.ok(html.includes('id="generated"'), 'rollup generation stamp element present')
  assert.ok(html.includes('id="stale-warn"'), 'stale/degraded warning element present')
  assert.ok(CLIENT_JS.includes('renderFreshness'), 'client renders the rollup freshness state')
  // The active-instance trend renders above the site traffic trend.
  assert.ok(html.includes('id="active-chart"'), 'active-instance trend panel present')
  assert.ok(html.indexOf('id="active-chart"') < html.indexOf('id="panel-chart"'), 'active-instance trend sits above the site trend')
  assert.match(PAGE_CSP, /script-src 'self'/)
  assert.ok(!/script-src[^;]*unsafe-inline/.test(PAGE_CSP), 'script-src must not rely on unsafe-inline')
  assert.match(PAGE_CSP, /connect-src 'self'/)
})

test('summary fetch rides the MARKET service binding, not a public fetch', async () => {
  // Forge a valid Access JWT: generate an RSA key, publish its JWK through a
  // stubbed team JWKS endpoint, sign RS256 over the header.payload text.
  const { webcrypto: crypto } = await import('node:crypto')
  const b64u = (bytes) => Buffer.from(bytes).toString('base64url')
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  jwk.kid = 'test-kid'
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'test-kid' }))
  const claims = b64u(JSON.stringify({ aud: 'aud-value', exp: Math.floor(Date.now() / 1000) + 600 }))
  const signingInput = new TextEncoder().encode(head + '.' + claims)
  const signature = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, signingInput))
  const jwt = head + '.' + claims + '.' + signature

  const bindingRequests = []
  let publicFetches = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    // Serve the team JWKS locally: the test team does not exist upstream.
    if (url.includes('cloudflareaccess.com/cdn-cgi/access/certs')) {
      return Promise.resolve(new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } }))
    }
    publicFetches++
    return originalFetch(new Request(url), init)
  }
  const env = {
    ACCESS_TEAM: 'team',
    ACCESS_AUD: 'aud-value',
    TELEMETRY_READ_KEY: 'key-value',
    MARKET: {
      fetch: async (req) => {
        bindingRequests.push(req)
        return new Response(JSON.stringify({ ok: true, via: 'binding' }), { headers: { 'content-type': 'application/json' } })
      },
    },
  }
  try {
    const response = await viewer.fetch(
      new Request('https://tv.dsh-market.com/data?days=7&paths_limit=5', { headers: { 'cf-access-jwt-assertion': jwt } }),
      env,
      context()
    )
    assert.equal(response.status, 200)
    assert.equal((await response.json()).via, 'binding')
    assert.equal(bindingRequests.length, 1)
    assert.equal(bindingRequests[0].url, 'https://dsh-market.com/api/telemetry/summary?days=7&paths_limit=5')
    assert.equal(bindingRequests[0].headers.get('x-telemetry-key'), 'key-value')
    // The loop hazard this pins: a public fetch back to dsh-market.com from
    // inside the market worker's invocation chain trips loop protection
    // (observed as a 522 from the placeholder origin). The JWKS lookup is
    // stubbed above, so zero non-JWKS public fetches means the summary rode
    // the binding.
    assert.equal(publicFetches, 0, 'summary must not use public fetch')
  } finally {
    globalThis.fetch = originalFetch
  }
})
