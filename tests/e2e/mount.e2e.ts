/**
 * Aggregate-bundle mount lane: prove the packed `@linxin666/dsh-web-all`
 * tarball mounts into a real `dsh web` instance and boots cleanly on the
 * 0.1.7-alpha.1 cohort:
 *
 *  1. the DSH host frame mounts (`[data-dsh-frame]` is the official host
 *     frame the shell always renders, with its `data-pane` / `data-slot`
 *     / `data-dsh-responsive-part` children — its presence proves the app
 *     booted and rendered without the loader aborting);
 *  2. no bundled right panel: `dsh-better-sidebar` is absent from the DOM and
 *     from the console;
 *  3. no crash markers: no `archive-manager` error strip, no `pageerror`, no
 *     plugin-prefixed console errors.
 *
 * The alpha branch bundles no right-panel plugin: dsh-better-sidebar's 0.19.1
 * peers declare `^0.1.5-rc.1`, which this cohort does not satisfy, so its row
 * is absent from the aggregate and its host div must NOT appear. A profile can
 * still install it on demand. @mlgbnb/dsh-archive-manager stays excluded too —
 * its latest upstream build (1.0.7) still imports the removed
 * `@deepseek-ai/dsh-client-runtime` face. aionui-panel was removed from the
 * family entirely, and @morlay/better-session as well (deprecated; the stock
 * jsonl backend owns session storage again), so no test, gate, or e2e
 * assertion requires either to mount.
 *
 * The server is booted by `scripts/e2e-mount.sh`; the base URL arrives via
 * `DSH_E2E_URL`. Deterministic: every wait is on a DOM marker, and any crash
 * trips the very next assertion.
 */
import { test, expect } from '@playwright/test'

const BASE_URL = process.env.DSH_E2E_URL
if (!BASE_URL) {
  throw new Error('DSH_E2E_URL is not set — boot a DSH web instance with the aggregate bundle mounted and point this lane at it (see scripts/e2e-mount.sh)')
}

/** Plugin crash-marker prefixes (the client renders a strip instead of crashing). */
const CRASH_STRIP_PATTERNS = [/^dsh-archive-manager:/, /^\[dsh-archive-manager\]/]

test('family bundle boots without a bundled right panel or crash markers', async ({ page }) => {
  const pageErrors: string[] = []
  const pluginConsoleErrors: string[] = []
  page.on('pageerror', (error) => { pageErrors.push(error.message) })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (/dsh-better-sidebar|archive-manager/.test(text)) pluginConsoleErrors.push(text)
  })

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })

  // Fast-fail on the browser-auth 401 gate: alpha.2 hosts print a tokenized
  // root URL and fence `/` behind it, so a tokenless DSH_E2E_URL renders an
  // auth page instead of the app. Fail fast with a targeted message rather
  // than timing out on the frame selector below.
  await expect(page.getByText(/dsh web authentication required/u)).toHaveCount(0, { timeout: 5_000 })

  // The DSH host frame mounted: `[data-dsh-frame]` is the official shell
  // frame the harness always renders, so its presence proves the aggregate
  // booted and rendered without the loader aborting.
  await page.waitForSelector('[data-dsh-frame]', { state: 'attached', timeout: 30_000 })

  // The unbundled right panel must be ABSENT: the alpha branch neither depends
  // on nor mounts dsh-better-sidebar, so no host div and no crash strip for it
  // may appear.
  await expect(page.locator('[data-dsh-better-sidebar]')).toHaveCount(0)

  // The still-excluded archive-manager must be ABSENT from the DOM (its
  // latest upstream build imports the removed client-runtime face).
  await expect(page.locator('[data-dsh-archive-manager]')).toHaveCount(0)

  // No archive-manager crash strips anywhere on the page.
  for (const pattern of CRASH_STRIP_PATTERNS) {
    await expect(page.getByText(pattern)).toHaveCount(0)
  }
  expect(pageErrors, 'page errors').toEqual([])
  expect(pluginConsoleErrors, 'plugin console errors').toEqual([])
})
