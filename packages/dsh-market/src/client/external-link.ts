/**
 * External-link opener for the Workshop card, with the official right-sidebar
 * browser as the first seat.
 *
 * alpha.2 registers a `browser` tab type in the right sidebar and the official
 * chat routes an external link there through `sidebarRight.openTab`, falling
 * back to a new browser tab when the type is absent. The store card's market,
 * preview and repository links use the same probe, read through the structural
 * slices below so this package needs no sidebar SDK dependency (the browser
 * half may only type-import official packages).
 *
 * @module @linxin666/dsh-client-ui-market/client/external-link
 */

/** The tab kind the official sidebar browser registers. */
export const BROWSER_TAB_KIND = 'browser'

/** Structural slice of the right sidebar's tab-type registry. */
export interface TabTypeRegistry {
  /** The registration for one tab kind, or undefined when unclaimed. */
  get(kind: string): unknown
}

/** Structural slice of the right sidebar navigation face. */
export interface SidebarRightSeat {
  /** Open one registered tab kind in the right sidebar. */
  openTab(kind: string, options: { params: { url: string } }): void
}

/** The client-context slice the opener reads. */
export interface ExternalLinkContext {
  /** Service lookup; a context that refuses it is treated as "no sidebar". */
  get?(name: string): unknown
  /** Right-sidebar navigation, absent on shells without it. */
  sidebarRight?: SidebarRightSeat
}

/** Open one URL in a new browser tab: the fallback when no sidebar browser exists. */
export function openInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Build the card's external-link opener.
 * @param ctx - client context (its services decide the seat).
 * @param fallback - what to do when the sidebar browser is unavailable; tests inject a recorder.
 * @returns an opener that never throws.
 */
export function createExternalLinkOpener(
  ctx: ExternalLinkContext,
  fallback: (url: string) => void = openInNewTab,
): (url: string) => void {
  return (url: string): void => {
    let registry: TabTypeRegistry | undefined
    try {
      registry = ctx.get?.call(ctx, 'sidebarRightTabs') as TabTypeRegistry | undefined
    } catch {
      // A context that refuses the lookup: treat the sidebar as absent.
      registry = undefined
    }
    let declared = false
    try {
      declared = typeof registry?.get === 'function' && registry.get(BROWSER_TAB_KIND) !== undefined
    } catch {
      declared = false
    }
    if (declared && ctx.sidebarRight !== undefined) {
      ctx.sidebarRight.openTab(BROWSER_TAB_KIND, { params: { url } })
      return
    }
    fallback(url)
  }
}
