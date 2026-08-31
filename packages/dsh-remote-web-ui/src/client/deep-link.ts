/**
 * Pair boot flow: the QR link's `pair` parameter. Runs from the client
 * apply on every page load, on any device: `pair` present → accept the
 * token, then reload so the whole SPA boots with the device cookie (the
 * accept endpoint is exempt from the pairing gate; every other /api request
 * needs the cookie). Every device — phone or PC — lands on the same official
 * Web GUI; phones get the injected portrait adaptation. Failure of accept
 * leaves a sessionStorage marker the entry renders as a one-time notice.
 */

import type { Context } from '@deepseek-ai/cordis'
import { acceptPair, readPairParams } from './pair-api.ts'

/** sessionStorage key for the failed-pair notice. */
export const PAIR_FAILED_MARKER = 'dsh-remote-pair-failed'

/**
 * The page-navigation surface the boot flow drives. Browser pages use the
 * default (window.location/history); tests inject a fake.
 */
export interface PageSurface {
  /** The current page URL (read fresh on each access). */
  href: string
  /** Replace the URL without reloading. */
  replaceState(url: string): void
  /** Navigate to a URL (a fresh page load). */
  navigate(url: string): void
  /** Reload the page. */
  reload(): void
}

/** The browser implementation of {@link PageSurface}. */
export const browserPage: PageSurface = {
  get href(): string {
    return window.location.href
  },
  replaceState(url: string): void {
    window.history.replaceState(null, '', url)
  },
  navigate(url: string): void {
    window.location.assign(url)
  },
  reload(): void {
    window.location.reload()
  },
}

/**
 * Run the pair boot flow for this page load.
 * @param ctx - client root context (unused since the deep-link retirement;
 * kept for call-site stability).
 * @param search - the current location.search.
 * @param page - the page surface (defaults to the browser).
 */
export function runPairBootFlow(ctx: Context, search: string, page: PageSurface = browserPage): void {
  void ctx
  const params = readPairParams(search)
  if (params.pair !== undefined) {
    void runAccept(params.pair, page)
  }
}

/** Accept the token, then reload into the paired official UI. */
async function runAccept(token: string, page: PageSurface): Promise<void> {
  let ok = false
  try {
    const result = await acceptPair(token)
    ok = result.ok
    if (!ok) sessionStorage.setItem(PAIR_FAILED_MARKER, 'failed')
  } catch {
    sessionStorage.setItem(PAIR_FAILED_MARKER, 'failed')
  }
  // Drop the token from the URL either way: an accepted token is consumed
  // (a re-scan would 409), and a failed one must not loop.
  const url = new URL(page.href)
  url.searchParams.delete('pair')
  page.replaceState(`${url.pathname}${url.search}${url.hash}`)
  if (ok) {
    // Every device reloads into the same official Web GUI at this origin.
    page.reload()
  }
}
