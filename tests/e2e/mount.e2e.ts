/**
 * Aggregate-bundle mount lane: prove the packed `@linxin666/dsh-web-all`
 * tarball mounts into a real `dsh web` instance and boots cleanly on the
 * alpha.2 cohort:
 *
 *  1. the DSH host frame mounts (`[data-dsh-frame]` is the official host
 *     frame the shell always renders, with its `data-pane` / `data-slot`
 *     / `data-dsh-responsive-part` children — its presence proves the app
 *     booted and rendered without the loader aborting);
 *  2. `dsh-better-sidebar` mounts (`[data-dsh-better-sidebar]` host div
 *     appears);
 *  3. no crash markers: no `dsh-better-sidebar:` / `archive-manager`
 *     error strips, no `pageerror`, no plugin-prefixed console errors.
 *
 * dsh-better-sidebar is back in the aggregate on the alpha.2 cohort at
 * 0.18.0-alpha.0 (peers aligned to alpha.2; the removed
 * `@deepseek-ai/dsh-client-runtime` face is gone from its inject list).
 * @mlgbnb/dsh-archive-manager stays excluded — its latest upstream build
 * (1.0.7) still imports that removed face. aionui-panel was removed from the
 * family entirely. @morlay/better-session stays but ships inactive by default
 * (no host div until opted in), so no test, gate, or e2e assertion requires it
 * to mount.
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
const CRASH_STRIP_PATTERNS = [/^dsh-better-sidebar:/, /^\[dsh-better-sidebar\]/, /^dsh-archive-manager:/, /^\[dsh-archive-manager\]/]

test('family bundle mounts better-sidebar without crash markers', async ({ page }) => {
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

  // The shell rendered and better-sidebar mounted its host div. The panel
  // itself is COLLAPSED by default (openByDefault is off), so the host div
  // is attached but not visible — 'attached' is the mount contract.
  await page.waitForSelector('[data-dsh-better-sidebar]', { state: 'attached', timeout: 30_000 })
  await expect(page.locator('[data-dsh-better-sidebar]')).toHaveCount(1)

  // The still-excluded archive-manager must be ABSENT from the DOM (its
  // latest upstream build imports the removed client-runtime face).
  await expect(page.locator('[data-dsh-archive-manager]')).toHaveCount(0)

  // No better-sidebar / archive-manager crash strips anywhere on the page.
  for (const pattern of CRASH_STRIP_PATTERNS) {
    await expect(page.getByText(pattern)).toHaveCount(0)
  }
  expect(pageErrors, 'page errors').toEqual([])
  expect(pluginConsoleErrors, 'plugin console errors').toEqual([])
})
