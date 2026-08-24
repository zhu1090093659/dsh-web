/**
 * Human-readable API documentation page. Served at GET /api-docs.html and
 * linked from the API catalog as service-doc.
 */
export default `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH 创意工坊 API 文档</title>
<style>
body { font: 14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #1f2937; max-width: 780px; margin: 24px auto; padding: 0 16px; }
h1 { font-size: 22px; }
h2 { font-size: 17px; margin-top: 28px; }
code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; }
th, td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; font-size: 13px; vertical-align: top; }
th { background: #f9fafb; }
</style>
</head>
<body>
<h1>DSH 创意工坊 API 文档</h1>
<p>dsh-market.com 的边缘 API（Cloudflare Workers + D1），承载点赞计数、皮肤资产分发与健康检查。机器可读描述见 <a href="/openapi.json">/openapi.json</a>（OpenAPI 3.1），目录见 <code>/.well-known/api-catalog</code>。</p>

<h2>端点</h2>
<table>
<thead><tr><th>方法</th><th>路径</th><th>说明</th><th>状态</th></tr></thead>
<tbody>
<tr><td>GET</td><td><code>/api</code></td><td>API 服务信息与目录链接</td><td>200</td></tr>
<tr><td>GET</td><td><code>/api/health</code></td><td>健康检查，返回 <code>{ "ok": true }</code></td><td>200</td></tr>
<tr><td>GET</td><td><code>/api/stats</code></td><td>每类（skin / pet / plugin）每个资产的投票数</td><td>200</td></tr>
<tr><td>POST</td><td><code>/api/like</code></td><td>点赞 / 取消点赞（每设备一票，Turnstile 校验），字段：<code>kind</code>、<code>asset_id</code>、<code>device_fp</code>、<code>turnstile_token</code>、<code>unlike</code></td><td>200 / 400 / 403</td></tr>
<tr><td>GET</td><td><code>/api/turnstile/challenge</code></td><td>供市场卡片使用的 Turnstile 挑战页面</td><td>200</td></tr>
<tr><td>POST</td><td><code>/api/telemetry/event</code></td><td>匿名使用统计上报（站点 pageview / 插件心跳，条目含 name/version/channel））。仅存储客户端随机 ID 的加盐哈希、UTC 日期与条目名，不存 IP</td><td>200 / 400</td></tr>
<tr><td>GET</td><td><code>/api/telemetry/summary?days=N</code></td><td>UV/PV 聚合摘要（仅计数，永不暴露原始事件）。配置 <code>TELEMETRY_READ_KEY</code> 后需携带 <code>x-telemetry-key</code> 头或 <code>?key=</code> 参数</td><td>200 / 403</td></tr>
<tr><td>GET</td><td><code>/api/npm-badge/downloads</code></td><td>Shields 端点徽章：聚合包新旧两个 npm 名的月下载量合计</td><td>200</td></tr>
<tr><td>GET</td><td><code>/api/npm-badge/version</code></td><td>Shields 端点徽章：聚合包新旧两个 npm 名中的最新版本</td><td>200</td></tr>
<tr><td>GET</td><td><code>/api/skin-center/v2/skins/{skinId}/{asset}</code></td><td>皮肤资产：<code>stylesheet</code>、<code>patches</code>、<code>hooks.mjs</code>、<code>assets/*</code>、<code>preview/*</code></td><td>200 / 404</td></tr>
</tbody>
</table>

<h2>示例</h2>
<pre><code>$ curl -s https://dsh-market.com/api/health
{"ok":true}

$ curl -s https://dsh-market.com/api/stats
{"skin":{"harbor":7},"pet":{},"plugin":{}}</code></pre>
</body>
</html>
`
