/** @vitest-environment jsdom */

/**
 * External-link opener: the official sidebar browser is the first seat, and
 * every unavailable path (no registry, no `browser` claim, a refusing
 * context) falls back to a new browser tab.
 */
import { describe, expect, it } from 'vitest'
import { createExternalLinkOpener, type SidebarRightSeat } from '../src/client/external-link.ts'

/** One recorded right-sidebar open. */
interface OpenedTab { kind: string; url: string }

/** A fake sidebar that records what it was asked to open. */
function recordingSidebar(opened: OpenedTab[]): SidebarRightSeat {
  return {
    openTab: (kind, options) => { opened.push({ kind, url: options.params.url }) },
  }
}

describe('createExternalLinkOpener', () => {
  it('operator opens the link in the official sidebar browser when the tab type is registered', () => {
    // Given a shell whose sidebar registry claims the browser tab type
    const opened: OpenedTab[] = []
    const ctx = {
      get: (name: string) => (name === 'sidebarRightTabs' ? { get: () => ({ kind: 'browser' }) } : undefined),
      sidebarRight: recordingSidebar(opened),
    }
    const fallbacks: string[] = []
    const openExternal = createExternalLinkOpener(ctx, url => { fallbacks.push(url) })

    // When the operator opens the Workshop link
    openExternal('https://dsh-market.com/')

    // Then the sidebar opened the browser tab at that URL, with no new browser tab
    expect(opened).toEqual([{ kind: 'browser', url: 'https://dsh-market.com/' }])
    expect(fallbacks).toEqual([])
  })

  it('operator falls back to a new browser tab when the shell declares no browser tab type', () => {
    // Given a shell whose sidebar registry answers undefined for the browser type
    const opened: OpenedTab[] = []
    const ctx = {
      get: (name: string) => (name === 'sidebarRightTabs' ? { get: () => undefined } : undefined),
      sidebarRight: recordingSidebar(opened),
    }
    const fallbacks: string[] = []
    const openExternal = createExternalLinkOpener(ctx, url => { fallbacks.push(url) })

    // When the operator opens the repository link
    openExternal('https://github.com/zhu1090093659/dsh-web')

    // Then the fallback new tab received the URL and the sidebar stayed closed
    expect(fallbacks).toEqual(['https://github.com/zhu1090093659/dsh-web'])
    expect(opened).toEqual([])
  })

  it('operator falls back to a new browser tab when the sidebar service is missing or refusing', () => {
    // Given contexts without the registry, without the sidebar face, and one that throws on lookup
    const fallbacks: string[] = []
    const record = (url: string): void => { fallbacks.push(url) }
    const withoutRegistry = createExternalLinkOpener({ sidebarRight: recordingSidebar([]) }, record)
    const withoutSidebar = createExternalLinkOpener({ get: () => ({ get: () => ({}) }) }, record)
    const refusing = createExternalLinkOpener({
      get: () => { throw new Error('context inactive') },
      sidebarRight: recordingSidebar([]),
    }, record)

    // When the operator opens a preview link through each of them
    withoutRegistry('https://dsh-market.com/a')
    withoutSidebar('https://dsh-market.com/b')
    refusing('https://dsh-market.com/c')

    // Then every path landed in a new browser tab
    expect(fallbacks).toEqual(['https://dsh-market.com/a', 'https://dsh-market.com/b', 'https://dsh-market.com/c'])
  })
})
