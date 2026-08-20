// Regenerate docs/dsh-web-ui-banner.png from banner.html.
// Usage: node scripts/banner/shoot.mjs
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const page_path = path.join(here, 'banner.html')
const out = path.join(root, 'docs/dsh-web-ui-banner.png')

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1280, height: 400 },
  deviceScaleFactor: 2,
})
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()) })
await page.goto('file://' + page_path)
await page.waitForLoadState('networkidle')

// sanity: every image decoded, nothing overflows the 1280x400 canvas
const report = await page.evaluate(() => {
  const imgs = [...document.images].map((img) => ({
    src: img.getAttribute('src'), ok: img.complete && img.naturalWidth > 0,
  }))
  const doc = document.documentElement
  return { imgs, scrollW: doc.scrollWidth, scrollH: doc.scrollHeight }
})
for (const img of report.imgs) {
  if (!img.ok) throw new Error('image failed to load: ' + img.src)
}
if (report.scrollW !== 1280 || report.scrollH !== 400) {
  throw new Error(`canvas overflow: ${report.scrollW}x${report.scrollH}`)
}

await page.screenshot({ path: out })
await browser.close()
console.log('wrote', path.relative(root, out))
