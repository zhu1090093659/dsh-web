// Regenerate docs/dsh-web-banner.png (1280x400) and docs/dsh-web-social.png
// (1280x640, GitHub social preview) from banner.html.
// Usage: node scripts/banner/shoot.mjs
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const page_path = path.join(here, 'banner.html')

const browser = await chromium.launch()

async function shoot(width, height, out, center, opts = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: opts.scale || 2 })
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()) })
  await page.goto('file://' + page_path)
  await page.waitForLoadState('networkidle')
  if (center) {
    await page.addStyleTag({ content:
      'html, body { height: ' + height + 'px !important; }' +
      '.brand { top: ' + (center === 'social' ? 186 : 66) + 'px !important; }' +
      '.pet { bottom: 90px !important; }'
    })
  }
  const report = await page.evaluate(() => {
    const imgs = [...document.images].map((img) => ({
      src: img.getAttribute('src'), ok: img.complete && img.naturalWidth > 0,
    }))
    const bgs = [...document.querySelectorAll('.pet .frame')].map((el) => {
      const bg = getComputedStyle(el).backgroundImage
      return { bg, ok: bg !== 'none' }
    })
    const doc = document.documentElement
    return { imgs, bgs, scrollW: doc.scrollWidth, scrollH: doc.scrollHeight }
  })
  for (const img of report.imgs) {
    if (!img.ok) throw new Error('image failed to load: ' + img.src)
  }
  if (report.scrollW !== width || report.scrollH > height) {
    throw new Error('canvas overflow: ' + report.scrollW + 'x' + report.scrollH + ' for ' + width + 'x' + height)
  }
  await page.screenshot(opts.jpeg ? { path: out, type: 'jpeg', quality: 92 } : { path: out })
  await page.close()
  console.log('wrote', path.relative(root, out))
}

await shoot(1280, 400, path.join(root, 'docs/dsh-web-banner.png'))
// GitHub social preview: exactly 1280x640 and under 1 MB, so JPEG at 1x.
await shoot(1280, 640, path.join(root, 'docs/dsh-web-social.jpg'), 'social', { scale: 1, jpeg: true })
await browser.close()
