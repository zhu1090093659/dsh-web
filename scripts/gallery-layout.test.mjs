/**
 * gallery 试穿页布局回归：验证 conversation 不被 aionui 右侧面板列异常压缩，
 * preview 与 explorer 两列折叠（右侧面板不展示），且 hero /
 * composer 关键节点没有被水平裁切。
 *
 * 用真实浏览器（playwright + chromium）测量，覆盖 stock/qq98 × light/dark。
 * 无 chromium 的环境（如 CI 用 --ignore-scripts 安装、未下载浏览器）自动跳过，
 * 不阻断其它脚本测试。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const GALLERY = fileURLToPath(new URL('../gallery', import.meta.url))

// 尝试启动 chromium；不可用则全部跳过（CI 无浏览器）。
let browser = null
try {
  const { chromium } = await import('playwright')
  browser = await chromium.launch()
} catch {
  browser = null
}

after(() => { if (browser !== null) return browser.close() })

const SKIP = browser === null
const CASES = [
  { skin: 'stock', theme: 'light' },
  { skin: 'stock', theme: 'dark' },
  { skin: 'qq98', theme: 'light' },
  { skin: 'qq98', theme: 'dark' },
]

for (const c of CASES) {
  test(`preview ${c.skin}/${c.theme}: conversation 不被压缩、右侧面板折叠`, { skip: SKIP }, async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    try {
      await page.goto(`file://${GALLERY}/preview.html?skin=${c.skin}&theme=${c.theme}&chrome=0`, { waitUntil: 'load' })
      await page.waitForTimeout(1200)
      const info = await page.evaluate(() => {
        const conv = document.querySelector('[data-pane="conversation"]')
        const preview = document.querySelector('[data-aionui-preview-col]')
        const explorer = document.querySelector('[data-aionui-explorer-col]')
        const headline = document.querySelector('[class*="headlineText"]')
        const composer = document.querySelector('[contenteditable="true"], textarea')
        const w = (el) => (el ? el.getBoundingClientRect().width : -1)
        return {
          convW: w(conv),
          previewW: w(preview),
          previewHidden: preview ? preview.style.visibility === 'hidden' : false,
          explorerW: w(explorer),
          explorerHidden: explorer ? explorer.style.visibility === 'hidden' : false,
          headline: headline ? headline.textContent.trim() : '',
          headlineClipped: headline ? headline.scrollWidth > headline.clientWidth + 1 : false,
          composerW: w(composer),
        }
      })

      // conversation 不得被右侧空白列压缩（修复前 1280 下约 240px）。
      assert.ok(info.convW >= 400, `conversation 过窄: ${info.convW}px`)
      // preview 列折叠（官方空会话默认态），不得有 480px 空白占位。
      assert.ok(info.previewW < 10 && info.previewHidden, `preview 未折叠: ${info.previewW}px / hidden=${info.previewHidden}`)
      // explorer 折叠（右侧面板不展示）。
      assert.ok(info.explorerW < 10 && info.explorerHidden, `explorer 未折叠: ${info.explorerW}px / hidden=${info.explorerHidden}`)
      // hero 完整显示且无水平裁切。
      assert.equal(info.headline, "Let's start building")
      assert.equal(info.headlineClipped, false, 'headline 被水平裁切')
      // composer 可见且有一定宽度。
      assert.ok(info.composerW >= 300, `composer 过窄: ${info.composerW}px`)
    } finally {
      await page.close()
    }
  })
}
