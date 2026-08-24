/**
 * dsh-market-telemetry-view — private real-time viewer for the dsh-market
 * UV/PV aggregates, served at tv.dsh-market.com.
 *
 * Access model (defense in depth):
 * - The route is meant to sit behind a Cloudflare Access application; once
 *   the app exists, unauthenticated requests never reach this worker.
 * - Regardless of Access, the worker itself verifies the Cf-Access-Jwt-
 *   Assertion signature against the team JWKS and refuses to serve anything
 *   until ACCESS_TEAM and ACCESS_AUD secrets are configured.
 *
 * The worker holds no data: every render fetches the live aggregate from
 * dsh-market.com /api/telemetry/summary with TELEMETRY_READ_KEY, so the
 * market worker stays the single source of truth.
 */

const SUMMARY_BASE = 'https://dsh-market.com/api/telemetry/summary'

let jwksCache = { at: 0, keys: null }

async function getJwks(team) {
  const now = Date.now()
  if (jwksCache.keys && now - jwksCache.at < 3600000) return jwksCache.keys
  const res = await fetch('https://' + team + '.cloudflareaccess.com/cdn-cgi/access/certs')
  if (!res.ok) throw new Error('jwks fetch failed')
  const body = await res.json()
  jwksCache = { at: now, keys: body.keys || [] }
  return jwksCache.keys
}

function b64uToBytes(text) {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
}

/** Verify the Access JWT signature, audience and expiry against the team. */
async function accessVerified(request, env) {
  const fail = (reason) => { console.log('[access-denied] ' + reason); return false }
  const jwt = request.headers.get('cf-access-jwt-assertion')
  if (!jwt) return fail('no jwt header')
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return fail('secrets unset')
  const [headB64, claimsB64, sigB64] = jwt.split('.')
  if (!headB64 || !claimsB64 || !sigB64) return fail('malformed jwt')
  let header, claims
  try {
    header = JSON.parse(new TextDecoder().decode(b64uToBytes(headB64)))
    claims = JSON.parse(new TextDecoder().decode(b64uToBytes(claimsB64)))
  } catch { return fail('undecodable claims') }
  // Access issues aud as a string for some app shapes and a single-element
  // array for others; accept both.
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(env.ACCESS_AUD) : claims.aud === env.ACCESS_AUD
  if (!audOk) return fail('aud mismatch: ' + JSON.stringify(claims.aud))
  if (Number(claims.exp) * 1000 < Date.now()) return fail('expired')
  let keys
  try {
    keys = await getJwks(env.ACCESS_TEAM)
  } catch (error) {
    return fail('jwks fetch failed: ' + error.message)
  }
  const jwk = keys.find((key) => key.kid === header.kid)
  if (!jwk) return fail('kid not found: ' + JSON.stringify(header.kid))
  const cryptoKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  // The signing input is the literal ASCII "header.payload" string, not
  // base64-decoded data; only the signature itself is base64url.
  const signingInput = new TextEncoder().encode(headB64 + '.' + claimsB64)
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, b64uToBytes(sigB64), signingInput)
  if (!ok) return fail('signature invalid')
  return true
}

function page(status, title, body) {
  return new Response('<!doctype html><meta charset="utf-8"><title>' + title + '</title>' + body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'referrer-policy': 'no-referrer',
    },
  })
}

const SETUP_HTML = [
  '<h1>telemetry view: setup required</h1>',
  '<p>This viewer refuses to serve data until Cloudflare Access is configured.</p>',
  '<ol>',
  '<li>Zero Trust &gt; Access &gt; Applications: create a self-hosted app for <code>tv.dsh-market.com</code> with an email-OTP policy for your address.</li>',
  '<li>Copy the application AUD tag.</li>',
  '<li>From <code>market/telemetry-view</code> run:<br>',
  '<code>npx wrangler@4 secret put ACCESS_TEAM --name dsh-market-telemetry-view</code> (your team name, the part before <code>.cloudflareaccess.com</code>)<br>',
  '<code>npx wrangler@4 secret put ACCESS_AUD --name dsh-market-telemetry-view</code></li>',
  '</ol>',
].join('')

function esc(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
}

/** Chinese dashboard for the private telemetry view. CSP-safe: no scripts,
 * bars are pure CSS widths. */
function renderDashboard(data, days) {
  const site = data.site || { totals: {}, daily: [], top_paths: [] }
  const plugins = data.plugins || { items: [] }
  const daily = [...site.daily]
  const today = daily.at(-1) || { pv: 0, uv: 0 }
  const maxPv = Math.max(1, ...daily.map((row) => Number(row.pv) || 0))

  const cards = [
    ['今日 PV', today.pv],
    ['今日 UV', today.uv],
    ['区间累计 PV', site.totals.pv || 0],
    ['区间累计 UV（按日去重求和）', site.totals.uv_daily_sum || 0],
  ].map(([label, value]) =>
    '<div class="card"><div class="card-value">' + esc(value) + '</div><div class="card-label">' + esc(label) + '</div></div>').join('')

  const barRows = daily.map((row) => {
    const width = Math.max(2, Math.round((Number(row.pv) / maxPv) * 100))
    return '<tr><td class="day">' + esc(row.day) + '</td>'
      + '<td class="barcell"><div class="bar" style="width:' + width + '%"></div></td>'
      + '<td class="num">' + esc(row.pv) + '</td><td class="num">' + esc(row.uv) + '</td></tr>'
  }).join('')

  const pathRows = site.top_paths.length
    ? site.top_paths.map((row) =>
        '<tr><td><code>' + esc(row.path) + '</code></td><td class="num">' + esc(row.pv) + '</td></tr>').join('')
    : '<tr><td colspan="2" class="empty">暂无数据</td></tr>'

  const channelText = (channels) => {
    const parts = Object.entries(channels || {}).map(([name, count]) => name + ' ' + count)
    return parts.length ? parts.join(' · ') : '—'
  }
  const versionText = (versions) => (versions || []).slice(0, 4).map((v) => v.version + '(' + v.instances + ')').join(', ') || '—'
  const itemRows = plugins.items.length
    ? plugins.items.map((row) =>
        '<tr><td><code>' + esc(row.item) + '</code></td><td class="num">' + esc(row.instances) + '</td><td class="num">' + esc(row.active_today) + '</td>'
        + '<td class="dim">' + esc(channelText(row.channels)) + '</td><td class="dim">' + esc(versionText(row.versions)) + '</td></tr>').join('')
    : '<tr><td colspan="5" class="empty">暂无心跳数据——插件心跳要等含遥测的版本发布、用户更新后才会出现</td></tr>'

  const ranges = [7, 30, 90, 365].map((n) =>
    n === days ? '<b class="range on">' + n + ' 天</b>' : '<a class="range" href="?days=' + n + '">' + n + ' 天</a>').join(' · ')

  return [
    '<style>',
    // Light theme. Color roles: accent blue (#2563eb) for emphasis/actions,
    // supporting sky tint inside the accent family for bars; surfaces stay
    // low-saturation (off-white base, white cards) for long viewing sessions.
    '*{box-sizing:border-box}body{font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1e293b;background:#f4f6f9;max-width:960px;margin:0 auto;padding:32px 20px 64px}',
    'h1{font-size:22px;margin:0 0 4px;color:#0f172a}h2{font-size:15px;margin:36px 0 12px;color:#2563eb;font-weight:600;letter-spacing:.02em}',
    '.sub{color:#64748b;margin:0 0 20px}.meta{color:#64748b;margin-bottom:6px;font-size:13px}',
    '.range{color:#2563eb;text-decoration:none;padding:2px 8px;border-radius:6px}.range:hover{background:#e0e9fb}.range.on{color:#0f172a;font-weight:600;background:#dbe7fb}',
    '.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}',
    '.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;box-shadow:0 1px 3px rgba(15,23,42,.06)}',
    '.card-value{font-size:28px;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums}',
    '.card-label{font-size:12px;color:#64748b;margin-top:2px}',
    'table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.05)}th,td{padding:8px 14px;text-align:left;border-bottom:1px solid #eef2f7}',
    'th{color:#64748b;font-weight:500;font-size:12px;background:#f8fafc}tr:last-child td{border-bottom:none}tr:hover td{background:#f5f8fd}',
    '.num{text-align:right;font-variant-numeric:tabular-nums;width:90px;color:#334155}',
    '.day{color:#64748b;white-space:nowrap;width:110px;font-size:13px}',
    '.barcell{width:55%}.bar{height:14px;border-radius:4px;background:linear-gradient(90deg,#93c5fd,#3b82f6)}',
    'code{color:#2563eb;font-size:13px;background:#eff5ff;padding:1px 6px;border-radius:5px}.empty{color:#94a3b8;padding:18px 12px}.dim{color:#64748b;font-size:12px}',
    '.foot{margin-top:40px;color:#94a3b8;font-size:12px}',
    '</style>',
    '<h1>dsh-web 使用统计</h1>',
    '<p class="sub">站点与插件的匿名 UV / PV 实时汇总 · 数据源 dsh-market.com</p>',
    '<p class="meta">最近 ' + esc(days) + ' 天 · ' + ranges + ' · <a class="range" href="?days=' + esc(days) + '">刷新</a></p>',
    '<div class="cards">' + cards + '</div>',
    '<h2>站点访问趋势</h2>',
    '<p class="meta">口径：已过滤已知爬虫（UA 特征 + webdriver 检测），仅统计浏览器端上报的页面访问</p>',
    '<table><tr><th>日期</th><th></th><th class="num">PV</th><th class="num">UV</th></tr>' + barRows + '</table>',
    '<h2>热门路径</h2>',
    '<table><tr><th>路径</th><th class="num">PV</th></tr>' + pathRows + '</table>',
    '<h2>插件安装量</h2>',
    '<p class="meta">独立实例 = 去重浏览器数；当日活跃 = 今日上报过心跳；渠道 = 安装来源（market=市场一键装，npm=仓库直装，unknown=无法判定）；皮肤条目以 skin: 前缀展示</p>',
    '<table><tr><th>包 / 资产</th><th class="num">独立实例</th><th class="num">当日活跃</th><th>渠道分布</th><th>版本分布</th></tr>' + itemRows + '</table>',
    '<p class="foot">所有事件均匿名（随机 ID 加盐哈希，不存 IP），仅展示聚合计数。契约见 docs/telemetry.md。</p>',
  ].join('')
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!env.ACCESS_TEAM || !env.ACCESS_AUD) {
      return page(503, 'telemetry view setup', SETUP_HTML)
    }
    if (!(await accessVerified(request, env))) {
      return page(401, 'telemetry view', '<h1>401</h1><p>Cloudflare Access verification failed.</p>')
    }
    let days = Number.parseInt(url.searchParams.get('days') || '', 10)
    if (!Number.isFinite(days)) days = 30
    days = Math.min(Math.max(days, 1), 365)
    const summaryRes = await fetch(SUMMARY_BASE + '?days=' + days, {
      headers: { 'x-telemetry-key': env.TELEMETRY_READ_KEY || '' },
    })
    if (!summaryRes.ok) {
      return page(502, 'telemetry view', '<h1>502</h1><p>Summary upstream returned ' + summaryRes.status + '.</p>')
    }
    const data = await summaryRes.json()
    return page(200, 'dsh-web telemetry', renderDashboard(data, days))
  },
}
