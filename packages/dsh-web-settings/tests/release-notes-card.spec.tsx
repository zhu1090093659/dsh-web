/** @vitest-environment jsdom */

/**
 * The version-notes entry contract: a compact row carrying the version and a
 * "new" pill while the release is unacknowledged; clicking it opens the
 * release page in a modal dialog. The pill clears only when the user explicitly
 * closes the page (Got it / Escape / mask), which persists the seen version.
 *
 * Auto-popup (方案 D): on first mount after a version upgrade the modal
 * opens automatically exactly once. A "don't auto-popup" checkbox records a
 * preference that is persisted on close and honored on next mount.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ReleaseNotesCard } from '../src/client/ReleaseNotesCard.tsx'
import { en } from '../src/client/locales.ts'
import { CURRENT_VERSION, RELEASES } from '../src/client/release-notes.ts'
import {
  WHATS_NEW_AUTO_SHOWN_KEY,
  WHATS_NEW_LAST_SEEN_KEY,
  WHATS_NEW_SUPPRESS_KEY,
  type StringStorage,
} from '../src/client/whats-new.ts'

afterEach(cleanup)

/** English translate stub reading the published dictionary. */
const t = (key: string): string => (en as Record<string, string>)[key] ?? key

/** In-memory storage with optional pre-seeded keys. */
function makeStorage(seed?: { lastSeen?: string; autoShown?: string; suppress?: boolean }) {
  const state: Record<string, string> = {}
  if (seed?.lastSeen !== undefined) state[WHATS_NEW_LAST_SEEN_KEY] = seed.lastSeen
  if (seed?.autoShown !== undefined) state[WHATS_NEW_AUTO_SHOWN_KEY] = seed.autoShown
  if (seed?.suppress) state[WHATS_NEW_SUPPRESS_KEY] = '1'
  const storage: StringStorage = {
    getItem: (key) => state[key] ?? null,
    setItem: (key, value) => { state[key] = value },
  }
  const getLastSeen = () => storage.getItem(WHATS_NEW_LAST_SEEN_KEY) ?? undefined
  const getAutoShown = () => storage.getItem(WHATS_NEW_AUTO_SHOWN_KEY) ?? undefined
  const getSuppress = () => storage.getItem(WHATS_NEW_SUPPRESS_KEY) === '1'
  return { storage, getLastSeen, getAutoShown, getSuppress }
}

function renderCard(seed?: { lastSeen?: string; autoShown?: string; suppress?: boolean }) {
  const { storage, getLastSeen, getAutoShown, getSuppress } = makeStorage(seed)
  const view = render(<ReleaseNotesCard t={t} storage={storage} />)
  return { view, getLastSeen, getAutoShown, getSuppress }
}

/** The entry-row button of the rendered card. */
function entry(): HTMLElement {
  const node = screen.getAllByText(t('releaseNotesTitle')).find(
    el => el.closest('button')?.getAttribute('aria-haspopup') === 'dialog',
  )
  if (node === null || node === undefined) throw new Error('version-notes entry row not found')
  return node.closest('button') as HTMLElement
}

describe('ReleaseNotesCard', () => {
  it('renders the entry row with title and version pill, without the release page', () => {
    renderCard({ lastSeen: CURRENT_VERSION })
    expect(entry()).toBeTruthy()
    expect(within(entry()).getByText(`v${CURRENT_VERSION}`)).toBeTruthy()
    expect(screen.queryByText(RELEASES[0].lede)).toBeNull()
  })

  it('shows the new pill while the release is unacknowledged', () => {
    renderCard()
    expect(within(entry()).getByText(t('new'))).toBeTruthy()
  })

  it('omits the new pill when the current version was already seen', () => {
    renderCard({ lastSeen: CURRENT_VERSION })
    expect(within(entry()).queryByText(t('new'))).toBeNull()
  })

  it('opening the release page does NOT acknowledge (pill stays visible)', () => {
    const { getLastSeen } = renderCard()
    fireEvent.click(entry())
    expect(screen.getByRole('dialog')).toBeTruthy()
    // Pill still visible in the entry row behind the modal.
    expect(within(entry()).getByText(t('new'))).toBeTruthy()
    expect(getLastSeen()).toBeUndefined()
  })

  it('closing via Got it acknowledges and clears the pill', () => {
    const { getLastSeen } = renderCard()
    fireEvent.click(entry())
    fireEvent.click(screen.getByRole('button', { name: t('ack') }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getLastSeen()).toBe(CURRENT_VERSION)
    expect(within(entry()).queryByText(t('new'))).toBeNull()
  })

  it('closing via Escape acknowledges', () => {
    const { getLastSeen } = renderCard()
    fireEvent.click(entry())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getLastSeen()).toBe(CURRENT_VERSION)
  })

  it('closing via mask click acknowledges', () => {
    const { getLastSeen } = renderCard()
    fireEvent.click(entry())
    fireEvent.click(document.querySelector('[aria-hidden="true"]')!)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getLastSeen()).toBe(CURRENT_VERSION)
  })

  it('opens the release page with the lede, every highlight title, and the category lists', () => {
    renderCard({ lastSeen: CURRENT_VERSION })
    fireEvent.click(entry())
    expect(screen.getByText(RELEASES[0].lede)).toBeTruthy()
    expect(screen.getByText(t('highlights'))).toBeTruthy()
    for (const highlight of RELEASES[0].highlights) {
      expect(screen.getByText(highlight.title)).toBeTruthy()
    }
    for (const item of RELEASES[0].sections.new) {
      expect(screen.getByText(item)).toBeTruthy()
    }
    for (const item of RELEASES[0].sections.fixed) {
      expect(screen.getByText(item)).toBeTruthy()
    }
  })

  it('tolerates a host without localStorage: no pill, page still opens', () => {
    // Simulate a host where localStorage is unavailable (throws on access).
    const brokenStorage: StringStorage = {
      getItem: () => { throw new Error('no storage') },
      setItem: () => { throw new Error('no storage') },
    }
    render(<ReleaseNotesCard t={t} storage={brokenStorage} />)
    expect(within(entry()).queryByText(t('new'))).toBeNull()
    fireEvent.click(entry())
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('ReleaseNotesCard auto-popup', () => {
  it('auto-opens the modal on first mount when a new version exists', () => {
    renderCard()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('does not auto-open when the version was already auto-shown', () => {
    renderCard({ autoShown: CURRENT_VERSION })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not auto-open when the version was already acknowledged', () => {
    renderCard({ lastSeen: CURRENT_VERSION })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not auto-open when suppress preference is set', () => {
    renderCard({ suppress: true })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('auto-popup persists the auto-shown flag immediately', () => {
    const { getAutoShown } = renderCard()
    expect(getAutoShown()).toBe(CURRENT_VERSION)
  })

  it('auto-popup does not acknowledge the version (new pill remains)', () => {
    const { getLastSeen } = renderCard()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(getLastSeen()).toBeUndefined()
    expect(within(entry()).getByText(t('new'))).toBeTruthy()
  })

  it('closing the auto-opened modal via Got it acknowledges', () => {
    const { getLastSeen } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: t('ack') }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getLastSeen()).toBe(CURRENT_VERSION)
  })
})

describe('ReleaseNotesCard suppress checkbox', () => {
  it('checking the checkbox does NOT close the modal', () => {
    renderCard()
    expect(screen.getByRole('dialog')).toBeTruthy()
    const checkbox = screen.getByRole('checkbox', { name: t('dontAutoShow') }) as HTMLInputElement
    fireEvent.click(checkbox)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(checkbox.checked).toBe(true)
  })

  it('unchecking the checkbox keeps the modal open', () => {
    renderCard()
    const checkbox = screen.getByRole('checkbox', { name: t('dontAutoShow') }) as HTMLInputElement
    fireEvent.click(checkbox)
    fireEvent.click(checkbox)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(checkbox.checked).toBe(false)
  })

  it('closing with checkbox checked persists the suppress preference', () => {
    const { getSuppress } = renderCard()
    const checkbox = screen.getByRole('checkbox', { name: t('dontAutoShow') }) as HTMLInputElement
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: t('ack') }))
    expect(getSuppress()).toBe(true)
  })

  it('closing with checkbox unchecked clears the suppress preference', () => {
    const { getSuppress } = renderCard({ suppress: true })
    fireEvent.click(entry())
    const checkbox = screen.getByRole('checkbox', { name: t('dontAutoShow') }) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox) // uncheck
    expect(checkbox.checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: t('ack') }))
    expect(getSuppress()).toBe(false)
  })
})
