import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://127.0.0.1:3092/', { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(5000)
const box = await page.evaluate(() => {
  const el = document.querySelector('[data-dsh-plugin="pet"] .kz2Bea_sprite, [data-dsh-plugin="pet"] [role="button"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
console.log('pet at', JSON.stringify(box))
if (box) {
  await page.mouse.move(box.x, box.y)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: 'docs/archive/blue-throated-bee-eater-pet/gui-panel.png' })
}
await browser.close()
console.log('DONE')
