/**
 * dsh-market-telemetry-view — dashboard page (dark theme, SVG charts,
 * fetch-driven pagination). The page is fully rendered by the inline
 * client from the boot JSON embedded by the worker; every interaction
 * (range switch, pagination) refetches the aggregate through the
 * same-origin /data proxy without a page reload.
 *
 * CSP: the client script is a same-origin external file (/app.js) under
 * script-src 'self', never inline. Cloudflare's edge injects a CSP nonce
 * on this zone, and a nonce neutralizes 'unsafe-inline' per spec — inline
 * scripts get blocked no matter what the worker sends. Boot data rides in
 * an inert <script type="application/json"> block, which script-src does
 * not govern at all.
 */

export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"

const CSS = [
  ':root{--bg:#0a0f1e;--panel:rgba(148,163,255,.055);--panel-border:rgba(148,163,255,.14);--text:#e6eaf6;--dim:#8d96b3;--faint:#5d6580;--accent:#6f8cff;--accent-strong:#8ea6ff;--sky:#45c4f5;--good:#34d399;--bad:#f87171;--radius:14px;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
  '*{box-sizing:border-box;margin:0;padding:0}',
  'html{color-scheme:dark}',
  'body{font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--text);background:var(--bg);min-height:100vh}',
  'body::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(900px 480px at 82% -10%,rgba(111,140,255,.16),transparent 60%),radial-gradient(700px 420px at 8% 108%,rgba(69,196,245,.10),transparent 60%)}',
  '.wrap{position:relative;max-width:1120px;margin:0 auto;padding:36px 24px 72px}',
  '.top{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:26px}',
  'h1{font-size:24px;font-weight:700;letter-spacing:.01em;background:linear-gradient(92deg,#cdd8ff,#8ea6ff 55%,#45c4f5);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}',
  '.sub{color:var(--dim);font-size:13px;margin-top:4px}',
  '.controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
  '.seg{display:flex;background:var(--panel);border:1px solid var(--panel-border);border-radius:10px;padding:3px;gap:2px}',
  '.seg button{appearance:none;border:0;background:transparent;color:var(--dim);font:inherit;font-size:13px;padding:5px 13px;border-radius:8px;cursor:pointer;transition:background .18s,color .18s}',
  '.seg button:hover{color:var(--text)}',
  '.seg button.on{background:rgba(111,140,255,.22);color:#dbe4ff;font-weight:600}',
  '.seg button:focus-visible,.btn:focus-visible,.pg button:focus-visible,.pg select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
  '.btn{display:inline-flex;align-items:center;gap:7px;appearance:none;border:1px solid var(--panel-border);background:var(--panel);color:var(--dim);font:inherit;font-size:13px;padding:7px 14px;border-radius:10px;cursor:pointer;transition:background .18s,color .18s,border-color .18s}',
  '.btn:hover{color:var(--text);border-color:rgba(148,163,255,.32)}',
  '.btn svg{width:14px;height:14px}',
  '.btn.spin svg{animation:spin .8s linear infinite}',
  '@keyframes spin{to{transform:rotate(360deg)}}',
  '.meta{color:var(--faint);font-size:12px;margin:-14px 0 22px}',
  '.warnline{display:none;color:var(--bad);font-size:12px;margin:-14px 0 22px}',
  '.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:26px}',
  '.card{background:var(--panel);border:1px solid var(--panel-border);border-radius:var(--radius);padding:16px 18px;backdrop-filter:blur(8px);transition:transform .18s ease,border-color .18s ease}',
  '.card:hover{transform:translateY(-2px);border-color:rgba(148,163,255,.3)}',
  '.card .ic{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:rgba(111,140,255,.14);color:var(--accent-strong);margin-bottom:10px}',
  '.card .ic svg{width:16px;height:16px}',
  '.card-v{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.01em;line-height:1.2}',
  '.card-l{font-size:12px;color:var(--dim);margin-top:2px}',
  '.delta{display:inline-block;font-size:11px;font-weight:600;border-radius:6px;padding:1px 7px;margin-left:8px;vertical-align:2px;font-variant-numeric:tabular-nums}',
  '.delta.up{color:var(--good);background:rgba(52,211,153,.12)}',
  '.delta.down{color:var(--bad);background:rgba(248,113,113,.12)}',
  '.delta.flat{color:var(--dim);background:rgba(141,150,179,.12)}',
  '.panel{background:var(--panel);border:1px solid var(--panel-border);border-radius:var(--radius);backdrop-filter:blur(8px);padding:20px 22px;margin-bottom:26px;transition:opacity .25s ease}',
  '.panel.loading{opacity:.45;pointer-events:none}',
  '.panel-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}',
  '.panel-h h2{font-size:15px;font-weight:650;letter-spacing:.02em;color:#cdd6f2}',
  '.panel-h .note{font-size:12px;color:var(--faint)}',
  '.legend{display:flex;gap:16px;font-size:12px;color:var(--dim)}',
  '.legend i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:-1px}',
  '.chart-box{position:relative}',
  '.chart-box svg{display:block;width:100%;height:auto}',
  '.tip{position:absolute;pointer-events:none;background:rgba(13,18,36,.94);border:1px solid rgba(148,163,255,.28);border-radius:10px;padding:8px 12px;font-size:12px;color:var(--text);white-space:nowrap;opacity:0;transform:translateY(4px);transition:opacity .15s ease,transform .15s ease;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:3}',
  '.tip.show{opacity:1;transform:translateY(0)}',
  '.tip .d{color:var(--dim);margin-bottom:3px;font-size:11px}',
  '.tip b{font-variant-numeric:tabular-nums}',
  'table{border-collapse:collapse;width:100%}',
  'th,td{padding:9px 12px;text-align:left;border-bottom:1px solid rgba(148,163,255,.08);vertical-align:middle}',
  'th{color:var(--faint);font-weight:500;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap}',
  'tbody tr{transition:background .15s}',
  'tbody tr:hover{background:rgba(111,140,255,.06)}',
  'tbody tr:last-child td{border-bottom:none}',
  '.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
  '.rank{color:var(--faint);font-size:12px;width:34px;font-variant-numeric:tabular-nums}',
  'code{color:#a9bcff;font-family:var(--mono);font-size:12.5px;background:rgba(111,140,255,.1);padding:2px 7px;border-radius:6px;word-break:break-all}',
  '.pbar{height:6px;border-radius:3px;background:rgba(148,163,255,.1);min-width:70px;overflow:hidden}',
  '.pbar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,var(--accent),var(--sky));transition:width .35s ease}',
  '.cell-pv{display:flex;align-items:center;gap:12px;justify-content:flex-end}',
  '.cell-pv .pbar{flex:1;max-width:180px}',
  '.chan{display:flex;height:8px;border-radius:4px;overflow:hidden;min-width:80px;background:rgba(148,163,255,.08)}',
  '.chan i{display:block;height:100%}',
  '.chan-l{font-size:11px;color:var(--faint);margin-top:4px;white-space:nowrap}',
  '.vers{color:var(--dim);font-size:12px;font-family:var(--mono)}',
  '.dim{color:var(--faint);font-size:12px}',
  '.empty{color:var(--faint);text-align:center;padding:26px 12px !important;font-size:13px}',
  '.pg{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:14px}',
  '.pg .pages{display:flex;align-items:center;gap:4px}',
  '.pg button{appearance:none;border:1px solid transparent;background:transparent;color:var(--dim);font:inherit;font-size:13px;min-width:30px;height:30px;padding:0 8px;border-radius:8px;cursor:pointer;transition:background .15s,color .15s;font-variant-numeric:tabular-nums}',
  '.pg button:hover:not(:disabled){background:rgba(111,140,255,.12);color:var(--text)}',
  '.pg button.on{background:rgba(111,140,255,.22);color:#dbe4ff;font-weight:600}',
  '.pg button:disabled{opacity:.32;cursor:default}',
  '.pg .info{font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}',
  '.pg select{appearance:none;border:1px solid var(--panel-border);background:rgba(10,15,30,.6);color:var(--dim);font:inherit;font-size:12.5px;padding:5px 9px;border-radius:8px;cursor:pointer}',
  '.foot{color:var(--faint);font-size:12px;margin-top:34px;line-height:1.8}',
  '.err{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);color:#fca5a5;border-radius:10px;padding:10px 16px;font-size:13px;margin-bottom:20px;display:none}',
  '.err.show{display:block;animation:rise .3s ease}',
  '.rise{animation:rise .45s cubic-bezier(.22,.8,.36,1) both}',
  '@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}',
  '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms !important;transition-duration:.01ms !important}}',
  '@media (max-width:640px){.wrap{padding:24px 14px 56px}.card-v{font-size:22px}th,td{padding:8px 8px}.hide-s{display:none}.panel{overflow-x:auto}#panel-items table{min-width:560px}}',
].join('')

/** Inline stroke icons (24px grid, currentColor) — no emoji, no text glyphs. */
const ICONS = {
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-6 4 3 5-8"/></svg>',
  sum: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 4H6l6 8-6 8h12"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
}

export const CLIENT_JS = `
'use strict'
window.addEventListener('error', function (ev) {
  var e = document.getElementById('err')
  if (!e) return
  e.textContent = '页面脚本执行失败：' + (ev.message || 'unknown')
  e.classList.add('show')
})
var hint = document.getElementById('boot-hint')
if (hint) hint.parentNode.removeChild(hint)
var BOOT = null
try {
  BOOT = JSON.parse(document.getElementById('boot-data').textContent)
} catch (err) {
  var e0 = document.getElementById('err')
  e0.textContent = '启动数据解析失败：' + err.message
  e0.classList.add('show')
  throw err
}
var state = {
  days: BOOT.days,
  pathsOffset: 0, pathsSize: BOOT.sizes.paths,
  itemsOffset: 0, itemsSize: BOOT.sizes.items,
}
var data = BOOT.data
var CHAN_COLORS = { market: '#6f8cff', npm: '#45c4f5', unknown: '#5d6580' }

function $(id) { return document.getElementById(id) }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }
function fmt(n) { n = Number(n) || 0; return n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n) }
function full(n) { return (Number(n) || 0).toLocaleString('en-US') }

/* ---------- KPI cards ---------- */
function deltaBadge(today, yesterday) {
  if (!yesterday) return ''
  var diff = today - yesterday
  var pct = Math.round(Math.abs(diff) / yesterday * 100)
  if (diff === 0) return '<span class="delta flat">±0</span>'
  var cls = diff > 0 ? 'up' : 'down'
  var sign = diff > 0 ? '+' : '-'
  return '<span class="delta ' + cls + '" title="对比昨日 ' + full(yesterday) + '">' + sign + pct + '%</span>'
}
function renderCards() {
  var daily = (data.site && data.site.daily) || []
  var today = daily[daily.length - 1] || { pv: 0, uv: 0 }
  var yesterday = daily[daily.length - 2] || { pv: 0, uv: 0 }
  var hbDaily = (data.plugins && data.plugins.daily) || []
  var hbToday = hbDaily[hbDaily.length - 1] || { uv: 0 }
  var cards = [
    { icon: BOOT.icons.eye, label: '今日 PV', value: full(today.pv), delta: deltaBadge(Number(today.pv), Number(yesterday.pv)) },
    { icon: BOOT.icons.users, label: '今日 UV', value: full(today.uv), delta: deltaBadge(Number(today.uv), Number(yesterday.uv)) },
    { icon: BOOT.icons.chart, label: '区间累计 PV', value: full(data.site.totals.pv), delta: '' },
    { icon: BOOT.icons.sum, label: '区间累计 UV（按日去重求和）', value: full(data.site.totals.uv_daily_sum), delta: '' },
    { icon: BOOT.icons.box, label: '心跳条目数（区间）', value: full(data.plugins.totals.items), delta: '' },
    { icon: BOOT.icons.pulse, label: '今日活跃实例', value: full(hbToday.uv), delta: '' },
  ]
  $('cards').innerHTML = cards.map(function (c) {
    return '<div class="card"><div class="ic">' + c.icon + '</div>'
      + '<div class="card-v">' + c.value + c.delta + '</div>'
      + '<div class="card-l">' + c.label + '</div></div>'
  }).join('')
}

/* ---------- hand-rolled SVG line chart, shared by both trend panels ----------
   cfg = { rows, series: [{ key, color, width, opacity, label }], aria, empty,
           fill: { id, key, color }, tip(row) -> html }
   Each box owns its own tooltip/crosshair so two charts can coexist. */
function drawChart(boxId, cfg) {
  var box = $(boxId)
  var rows = cfg.rows || []
  if (!rows.length) { box.innerHTML = '<div class="empty">' + (cfg.empty || '暂无数据') + '</div>'; return }
  var W = 1000, H = 300, pl = 46, pr = 18, pt = 16, pb = 34
  var iw = W - pl - pr, ih = H - pt - pb
  var peak = 0
  rows.forEach(function (r) {
    cfg.series.forEach(function (s) { peak = Math.max(peak, Number(r[s.key]) || 0) })
  })
  var top = Math.max(1, peak)
  var step = rows.length > 1 ? iw / (rows.length - 1) : 0
  function X(i) { return pl + (rows.length > 1 ? i * step : iw / 2) }
  function Y(v) { return pt + ih - (Number(v) || 0) / top * ih }
  function line(key) {
    return rows.map(function (r, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(r[key]).toFixed(1) }).join('')
  }
  var fill = cfg.fill
    ? '<defs><linearGradient id="' + cfg.fill.id + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="' + cfg.fill.color + '" stop-opacity=".32"/><stop offset="1" stop-color="' + cfg.fill.color + '" stop-opacity="0"/>'
      + '</linearGradient></defs>'
      + '<path d="' + line(cfg.fill.key) + 'L' + X(rows.length - 1).toFixed(1) + ' ' + (pt + ih) + 'L' + X(0).toFixed(1) + ' ' + (pt + ih) + 'Z" fill="url(#' + cfg.fill.id + ')"/>'
    : ''
  var grid = ''
  for (var g = 0; g <= 4; g++) {
    var gy = pt + ih * g / 4
    grid += '<line x1="' + pl + '" y1="' + gy + '" x2="' + (W - pr) + '" y2="' + gy + '" stroke="rgba(148,163,255,.1)" stroke-width="1"/>'
      + '<text x="' + (pl - 8) + '" y="' + (gy + 4) + '" text-anchor="end" fill="#5d6580" font-size="11">' + fmt(Math.round(top * (4 - g) / 4)) + '</text>'
  }
  var ticks = ''
  var every = Math.max(1, Math.ceil(rows.length / 8))
  for (var t = 0; t < rows.length; t += every) {
    ticks += '<text x="' + X(t).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" fill="#5d6580" font-size="11">' + esc(rows[t].day.slice(5)) + '</text>'
  }
  var legend = cfg.series.length > 1
    ? '<div class="legend" style="margin-bottom:10px">' + cfg.series.map(function (s) {
      return '<span><i style="background:' + s.color + '"></i>' + esc(s.label) + '</span>'
    }).join('') + '</div>'
    : ''
  var strokes = cfg.series.map(function (s) {
    return '<path d="' + line(s.key) + '" fill="none" stroke="' + s.color + '" stroke-width="' + s.width + '" stroke-linejoin="round" stroke-linecap="round"'
      + (s.opacity ? ' opacity="' + s.opacity + '"' : '') + '/>'
  }).join('')
  box.innerHTML = legend
    + '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cfg.aria) + '">'
    + fill + grid + strokes + ticks
    + '<line class="cross" y1="' + pt + '" y2="' + (pt + ih) + '" stroke="rgba(230,234,246,.35)" stroke-width="1" opacity="0"/>'
    + '<rect class="hit" x="' + pl + '" y="' + pt + '" width="' + iw + '" height="' + ih + '" fill="transparent"/>'
    + '</svg><div class="tip"></div>'
  var svg = box.querySelector('svg'), tip = box.querySelector('.tip'), cross = box.querySelector('.cross'), hit = box.querySelector('.hit')
  hit.addEventListener('mousemove', function (ev) {
    var rect = svg.getBoundingClientRect()
    var mx = (ev.clientX - rect.left) / rect.width * W
    var i = Math.max(0, Math.min(rows.length - 1, Math.round((mx - pl) / (step || 1))))
    var r = rows[i]
    cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('opacity', '1')
    tip.innerHTML = '<div class="d">' + esc(r.day) + '</div>' + cfg.tip(r)
    tip.style.left = Math.max(0, Math.min(rect.width - 150, X(i) / W * rect.width - 60)) + 'px'
    tip.style.top = '34px'
    tip.classList.add('show')
  })
  hit.addEventListener('mouseleave', function () {
    tip.classList.remove('show'); cross.setAttribute('opacity', '0')
  })
}

/* ---------- active instances per day (heartbeat UV) ---------- */
function renderActiveChart() {
  drawChart('active-chart', {
    rows: (data.plugins && data.plugins.daily) || [],
    aria: '每日活跃实例趋势',
    empty: '暂无心跳数据——插件心跳要等含遥测的版本发布、用户更新后才会出现',
    series: [{ key: 'uv', color: '#45c4f5', width: 2.2 }],
    tip: function (r) { return '活跃实例 <b>' + full(r.uv) + '</b> · 心跳上报 <b>' + full(r.beats) + '</b>' },
  })
}

/* ---------- site traffic trend (PV area + UV line) ---------- */
function renderChart() {
  drawChart('chart', {
    rows: (data.site && data.site.daily) || [],
    aria: '站点访问趋势',
    fill: { id: 'pvfill', key: 'pv', color: '#6f8cff' },
    series: [
      { key: 'pv', color: '#8ea6ff', width: 2.2, label: 'PV' },
      { key: 'uv', color: '#45c4f5', width: 2, opacity: '.9', label: 'UV' },
    ],
    tip: function (r) { return 'PV <b>' + full(r.pv) + '</b> · UV <b>' + full(r.uv) + '</b>' },
  })
}

/* ---------- shared pager ---------- */
function pager(el, total, offset, size, onGo, onSize) {
  var pages = Math.max(1, Math.ceil(total / size))
  var cur = Math.min(pages, Math.floor(offset / size) + 1)
  var nums = []
  var lo = Math.max(1, cur - 2), hi = Math.min(pages, cur + 2)
  if (lo > 1) { nums.push(1); if (lo > 2) nums.push(0) }
  for (var p = lo; p <= hi; p++) nums.push(p)
  if (hi < pages) { if (hi < pages - 1) nums.push(0); nums.push(pages) }
  var html = '<div class="pages">'
    + '<button data-p="' + (cur - 1) + '" ' + (cur <= 1 ? 'disabled' : '') + ' aria-label="上一页">‹</button>'
  for (var i = 0; i < nums.length; i++) {
    html += nums[i] === 0 ? '<button disabled>…</button>'
      : '<button data-p="' + nums[i] + '"' + (nums[i] === cur ? ' class="on"' : '') + '>' + nums[i] + '</button>'
  }
  html += '<button data-p="' + (cur + 1) + '" ' + (cur >= pages ? 'disabled' : '') + ' aria-label="下一页">›</button></div>'
  html += '<div style="display:flex;align-items:center;gap:12px"><span class="info">共 ' + full(total) + ' 条 · ' + cur + '/' + pages + ' 页</span>'
    + '<select aria-label="每页条数">' + [10, 20, 50].map(function (s) {
      return '<option value="' + s + '"' + (s === size ? ' selected' : '') + '>' + s + ' 条/页</option>'
    }).join('') + '</select></div>'
  el.innerHTML = html
  el.querySelectorAll('button[data-p]').forEach(function (b) {
    b.addEventListener('click', function () { onGo((Number(b.getAttribute('data-p')) - 1) * size) })
  })
  el.querySelector('select').addEventListener('change', function (ev) { onSize(Number(ev.target.value)) })
}

/* ---------- hot paths table ---------- */
function renderPaths() {
  var rows = (data.site && data.site.top_paths) || []
  var total = (data.site && data.site.paths_total) || 0
  var max = Math.max(1, Math.max.apply(null, rows.map(function (r) { return Number(r.pv) || 0 })))
  var body = $('paths-body')
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty">暂无数据</td></tr>'
  } else {
    body.innerHTML = rows.map(function (r, i) {
      var w = Math.max(2, Math.round(Number(r.pv) / max * 100))
      return '<tr><td class="rank">' + (state.pathsOffset + i + 1) + '</td>'
        + '<td><code>' + esc(r.path) + '</code></td>'
        + '<td class="cell-pv"><span class="pbar"><i style="width:' + w + '%"></i></span></td>'
        + '<td class="num">' + full(r.pv) + '</td></tr>'
    }).join('')
  }
  pager($('paths-pager'), total, state.pathsOffset, state.pathsSize,
    function (off) { state.pathsOffset = off; refresh('paths') },
    function (size) { state.pathsSize = size; state.pathsOffset = 0; refresh('paths') })
}

/* ---------- plugins table ---------- */
function channelCell(channels) {
  var entries = Object.keys(channels || {}).filter(function (k) { return channels[k] > 0 })
  if (!entries.length) return '<span class="dim">—</span>'
  var sum = entries.reduce(function (a, k) { return a + channels[k] }, 0)
  var bar = entries.map(function (k) {
    var w = Math.max(3, channels[k] / sum * 100)
    return '<i style="width:' + w + '%;background:' + (CHAN_COLORS[k] || CHAN_COLORS.unknown) + '"></i>'
  }).join('')
  var label = entries.map(function (k) { return k + ' ' + channels[k] }).join(' · ')
  return '<div class="chan" title="' + esc(label) + '">' + bar + '</div><div class="chan-l">' + esc(label) + '</div>'
}
function renderItems() {
  var rows = (data.plugins && data.plugins.items) || []
  var total = (data.plugins && data.plugins.totals && data.plugins.totals.items) || 0
  var body = $('items-body')
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">暂无心跳数据——插件心跳要等含遥测的版本发布、用户更新后才会出现</td></tr>'
  } else {
    body.innerHTML = rows.map(function (r, i) {
      var vers = (r.versions || []).slice(0, 3).map(function (v) { return esc(v.version) + '(' + v.instances + ')' }).join(' ') || '—'
      return '<tr><td class="rank">' + (state.itemsOffset + i + 1) + '</td>'
        + '<td><code>' + esc(r.item) + '</code></td>'
        + '<td class="num">' + full(r.instances) + '</td>'
        + '<td class="num">' + full(r.active_today) + '</td>'
        + '<td>' + channelCell(r.channels) + '</td>'
        + '<td class="vers hide-s">' + vers + '</td></tr>'
    }).join('')
  }
  pager($('items-pager'), total, state.itemsOffset, state.itemsSize,
    function (off) { state.itemsOffset = off; refresh('items') },
    function (size) { state.itemsSize = size; state.itemsOffset = 0; refresh('items') })
}

/* ---------- data flow ---------- */
function dataUrl() {
  return '/data?days=' + state.days
    + '&paths_limit=' + state.pathsSize + '&paths_offset=' + state.pathsOffset
    + '&items_limit=' + state.itemsSize + '&items_offset=' + state.itemsOffset
}
function renderAll() {
  renderCards(); renderActiveChart(); renderChart(); renderPaths(); renderItems()
  $('updated').textContent = '查询于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })
  renderFreshness()
}
/* The summary payload carries the rollup's generation stamp (cache reads
   keep the original one) and the auxiliary breakdowns skipped under D1
   memory pressure. Surface both so a lagging cache can never read as lost
   data: a 09-13 rollup served on 09-16 once looked like two missing days. */
function renderFreshness() {
  var gen = Number(data && data.generated_at) || 0
  var generated = ''
  if (gen) {
    generated = new Date(gen).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    var ageHours = (Date.now() - gen) / 3600000
    // Freshness matches the rollup TTLs: 30 minutes up to 30 days, 12 hours beyond.
    var staleAfter = state.days <= 30 ? 0.5 : 12
    if (ageHours > staleAfter * 2) generated += '（滞后 ' + (ageHours >= 10 ? Math.round(ageHours) : ageHours.toFixed(1)) + ' 小时）'
  }
  $('generated').textContent = generated ? ' · 数据滚存于 ' + generated : ''
  var warns = []
  if (gen && (Date.now() - gen) / 3600000 > (state.days <= 30 ? 1 : 24)) {
    warns.push('当前是滞后的滚存快照：实时聚合暂时受限，上报与计数未中断，恢复后自动补齐')
  }
  var degraded = (data && data.degraded) || []
  if (degraded.indexOf('channels') >= 0) warns.push('渠道分布本次聚合降级跳过（数据源过载），其余数据正常')
  if (degraded.indexOf('versions') >= 0) warns.push('版本分布本次聚合降级跳过（数据源过载），其余数据正常')
  var line = $('stale-warn')
  line.textContent = warns.join('；')
  line.style.display = warns.length ? '' : 'none'
}
function refresh(section) {
  var panel = section === 'paths' ? $('panel-paths') : section === 'items' ? $('panel-items') : null
  if (panel) panel.classList.add('loading')
  fetch(dataUrl(), { credentials: 'same-origin' }).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json()
  }).then(function (d) {
    data = d
    if (panel) panel.classList.remove('loading')
    if (section === 'paths') renderPaths()
    else if (section === 'items') renderItems()
    else renderAll()
  }).catch(function (err) {
    if (panel) panel.classList.remove('loading')
    var e = $('err')
    e.textContent = '数据刷新失败：' + err.message + '（可点击右上角刷新重试）'
    e.classList.add('show')
    setTimeout(function () { e.classList.remove('show') }, 6000)
  })
}
function switchRange(days) {
  state.days = days
  state.pathsOffset = 0; state.itemsOffset = 0
  document.querySelectorAll('.seg button').forEach(function (b) {
    b.classList.toggle('on', Number(b.getAttribute('data-days')) === days)
  })
  $('range-label').textContent = '最近 ' + days + ' 天'
  refresh()
}

document.querySelectorAll('.seg button').forEach(function (b) {
  b.addEventListener('click', function () { switchRange(Number(b.getAttribute('data-days'))) })
})
$('reload').addEventListener('click', function () {
  $('reload').classList.add('spin')
  refresh()
  setTimeout(function () { $('reload').classList.remove('spin') }, 900)
})
renderAll()
`

/** Serialize boot data for safe embedding in the inert JSON block
 * (escapes "<" so the payload cannot terminate the script element). */
function bootJson(boot) {
  return JSON.stringify(boot).replace(/</g, '\\u003c')
}

const SHELL = [
  '<div class="wrap">',
  '<header class="top rise">',
  '<div><h1>dsh-web 使用统计</h1><p class="sub">站点与插件的匿名 UV / PV 实时汇总 · 数据源 dsh-market.com</p></div>',
  '<div class="controls">',
  '<div class="seg" role="group" aria-label="时间范围">',
  [7, 30, 90, 365].map((n) => '<button data-days="' + n + '"' + (n === 30 ? ' class="on"' : '') + '>' + n + ' 天</button>').join(''),
  '</div>',
  '<button class="btn" id="reload" aria-label="刷新数据">' + ICONS.refresh + '<span>刷新</span></button>',
  '</div>',
  '</header>',
  '<p class="meta"><span id="range-label">最近 30 天</span> · <span id="updated"></span><span id="generated"></span> · 已过滤已知爬虫（UA 特征 + webdriver 检测）</p>',
  '<p class="warnline" id="stale-warn" role="status"></p>',
  '<div class="err" id="err" role="alert"></div>',
  '<p class="meta" id="boot-hint">正在渲染数据……若此提示不消失，说明页面脚本被拦截（请检查浏览器控制台）。</p>',
  '<section class="cards rise" id="cards"></section>',
  '<section class="panel rise" id="panel-active">',
  '<div class="panel-h"><h2>活跃实例趋势</h2><span class="note">按日去重的实例数（当日上报插件心跳的浏览器），最新一天即 KPI 卡的「今日活跃实例」</span></div>',
  '<div class="chart-box" id="active-chart"></div>',
  '</section>',
  '<section class="panel rise" id="panel-chart">',
  '<div class="panel-h"><h2>站点访问趋势</h2><span class="note">仅统计浏览器端上报的页面访问</span></div>',
  '<div class="chart-box" id="chart"></div>',
  '</section>',
  '<section class="panel rise" id="panel-paths">',
  '<div class="panel-h"><h2>热门路径</h2><span class="note">按区间 PV 排序，服务端分页</span></div>',
  '<table><thead><tr><th>#</th><th>路径</th><th></th><th class="num">PV</th></tr></thead><tbody id="paths-body"></tbody></table>',
  '<div class="pg" id="paths-pager"></div>',
  '</section>',
  '<section class="panel rise" id="panel-items">',
  '<div class="panel-h"><h2>插件安装量</h2><span class="note">期间活跃 = 区间内按日去重后求和（同一实例多天活跃会重复计入）；当日活跃 = 当天去重实例数；皮肤条目以 skin: 前缀展示；渠道：market=市场一键装 / npm=仓库直装</span></div>',
  '<table><thead><tr><th>#</th><th>包 / 资产</th><th class="num">期间活跃</th><th class="num">当日活跃</th><th>渠道分布</th><th class="hide-s">版本分布</th></tr></thead><tbody id="items-body"></tbody></table>',
  '<div class="pg" id="items-pager"></div>',
  '</section>',
  '<p class="foot">所有事件均匿名（随机 ID 加盐哈希，不存 IP），仅展示聚合计数。契约见 docs/telemetry.md。</p>',
  '</div>',
].join('')

/**
 * Render the full dashboard document. boot = { days, sizes, data } where
 * data is one summary API payload matching the requested page windows.
 */
export function renderDashboard(boot) {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>dsh-web 使用统计</title>'
    + '<style>' + CSS + '</style></head><body>'
    + SHELL
    + '<script type="application/json" id="boot-data">' + bootJson({ days: boot.days, sizes: boot.sizes, icons: ICONS, data: boot.data }) + '</' + 'script>'
    + '<script src="/app.js" defer data-cfasync="false"></' + 'script>'
    + '</body></html>'
}
