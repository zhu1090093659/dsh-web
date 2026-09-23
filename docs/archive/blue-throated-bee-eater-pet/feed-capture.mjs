import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://127.0.0.1:3092/', { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(5000)
// trigger a feed via the pet API, then capture the feedback bubble
await page.evaluate(async () => {
  await fetch('/api/pet/interact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'feed' }) })
})
await page.waitForTimeout(1200)
await page.screenshot({ path: 'docs/archive/blue-throated-bee-eater-pet/gui-feed-bubble.png' })
await browser.close()
console.log('DONE')
