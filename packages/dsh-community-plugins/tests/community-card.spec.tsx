/** @vitest-environment jsdom */

/**
 * The community plugin index card contract: it is always open, so the
 * contributor links (pointing at the authors' own repositories) are directly
 * visible on mount, the entries render as a marketplace-style card grid with a
 * search box and category filter pills, the list hides while its enable switch
 * is off, and the card explains itself when the index is empty.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore, type ComponentProps } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the one value
// member the card chain needs.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: unknown) => {
    let value = init
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      set: (next: unknown) => { value = next; for (const listener of listeners) listener() },
      update: (mutator: (draft: never) => void) => { mutator(value as never); for (const listener of listeners) listener() },
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
  },
}))
import { CommunityPluginsCard, CommunityPluginsCardController, type CommunityPluginsCardProps, type CommunityPluginsSettings } from '../src/client/CommunityPluginsCard.tsx'
import { en, type CommunityPluginKey } from '../src/client/locales.ts'
import type { CommunityPluginEntry } from '../src/client/generated/community.ts'

afterEach(cleanup)

/** English translate stub (same shape the sibling settings-card tests use), with {name} param interpolation. */
const t: CommunityPluginsCardProps['t'] = (key, params) => {
  const text = (en as Record<string, string>)[key] ?? key
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}

/** Minimal in-memory scope backing the card controller. */
class FakeScope implements SettingsScope<CommunityPluginsSettings> {
  value: CommunityPluginsSettings
  base: CommunityPluginsSettings
  user: Partial<CommunityPluginsSettings> = {}
  writable = true
  private listeners = new Set<() => void>()
  set = vi.fn(async (field: string, value: unknown) => {
    (this.user as Record<string, unknown>)[field] = value
    this.reflect()
  })
  unset = vi.fn(async (field: string) => {
    delete (this.user as Record<string, unknown>)[field]
    this.reflect()
  })
  constructor(value: CommunityPluginsSettings) {
    this.value = value
    this.base = value
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getSnapshot(): SettingsScopeSnapshot<CommunityPluginsSettings> {
    return {
      status: 'ready',
      writable: this.writable,
      value: this.value,
      base: this.base,
      user: this.user,
      revision: 1,
      mode: 'host',
    }
  }
  private reflect(): void {
    this.value = { ...this.base, ...this.user }
    for (const listener of this.listeners) listener()
  }
}

/** Bind the controller's face into the card's prop shape (mirrors the slot renderer). */
function cardProps(scope: SettingsScope<CommunityPluginsSettings>, plugins?: readonly CommunityPluginEntry[]) {
  const controller = new CommunityPluginsCardController(scope)
  const face = controller.inject()
  const { hooks, ...actions } = face
  const useCommunityPluginsCard = <S,>(selector: (snapshot: ReturnType<typeof hooks.communityPluginsCard.getSnapshot>) => S) =>
    useSyncExternalStore(
      hooks.communityPluginsCard.subscribe,
      () => selector(hooks.communityPluginsCard.getSnapshot()),
    )
  return { t, plugins, useCommunityPluginsCard, ...actions } as unknown as ComponentProps<typeof CommunityPluginsCard>
}

const SAMPLE: CommunityPluginEntry[] = [
  {
    id: 'dsh-sample',
    name: '示例插件',
    nameEn: 'Sample Plugin',
    author: 'someone',
    description: '一个示例条目。',
    descriptionEn: 'A sample entry.',
    repo: 'https://github.com/someone/dsh-sample',
    npm: '@someone/dsh-sample',
    category: 'knowledge',
  },
]

/** Two categorized entries for the search / filter pill tests (locale-en display). */
const TWO: CommunityPluginEntry[] = [
  {
    id: 'dsh-alpha',
    name: 'Alpha 记忆',
    nameEn: 'Alpha Memory',
    author: 'alice',
    description: '记忆插件。',
    descriptionEn: 'A memory plugin.',
    repo: 'https://github.com/alice/dsh-alpha',
    npm: '@alice/dsh-alpha',
    category: 'knowledge',
  },
  {
    id: 'dsh-beta',
    name: 'Beta UI',
    nameEn: 'Beta UI',
    author: 'bob',
    description: '界面插件。',
    descriptionEn: 'A UI plugin.',
    repo: 'https://github.com/bob/dsh-beta',
    category: 'ui',
  },
]

describe('CommunityPluginsCard', () => {
  it('renders the index and repository links on mount (always open)', () => {
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}))} />)
    expect(screen.getByText('Data Agent')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /repository/i }).length).toBeGreaterThan(0)
  })

  it('links to the contributor repository and shows the npm marker on the card', () => {
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}))} plugins={SAMPLE} />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://github.com/someone/dsh-sample')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
    // Published plugin: the badge is the npm marker and the author sits in the meta line.
    expect(screen.getByText('Published on npm')).toBeTruthy()
    expect(screen.getByTitle('@someone/dsh-sample')).toBeTruthy()
    expect(screen.getByText('someone')).toBeTruthy()
    expect(screen.getByText('A sample entry.')).toBeTruthy()
  })

  it('shows the npm install command when the plugin is published', () => {
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}))} plugins={SAMPLE} />)
    expect(screen.getByText(/dsh plugin --profile web add @someone\/dsh-sample/)).toBeTruthy()
  })

  it('falls back to the repository URL as the install command without npm', () => {
    const noNpm: CommunityPluginEntry[] = [{ ...SAMPLE[0]!, npm: undefined }]
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}))} plugins={noNpm} />)
    expect(screen.getByText(/dsh plugin --profile web add https:\/\/github\.com\/someone\/dsh-sample/)).toBeTruthy()
    expect(screen.getByText('Install from repo')).toBeTruthy()
  })

  it('copies the install command on demand', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard')
    Object.defineProperty(Navigator.prototype, 'clipboard', { value: { writeText }, configurable: true })
    try {
      render(<CommunityPluginsCard {...cardProps(new FakeScope({}))} plugins={SAMPLE} />)
      const button = screen.getAllByRole('button', { name: /copy/i })[0]!
      fireEvent.click(button)
      expect(writeText).toHaveBeenCalledWith('dsh plugin --profile web add @someone/dsh-sample')
      await screen.findByRole('button', { name: /copied/i })
    } finally {
      if (original) Object.defineProperty(Navigator.prototype, 'clipboard', original)
      else delete (Navigator.prototype as unknown as Record<string, unknown>).clipboard
    }
  })

  it('filters the grid by search text across names and descriptions', () => {
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}))} plugins={TWO} />)
    fireEvent.change(screen.getByLabelText(/search community plugins/i), { target: { value: 'memory' } })
    expect(screen.getByText('Alpha Memory')).toBeTruthy()
    expect(screen.queryByText('Beta UI')).toBeNull()
    expect(screen.getByText('Showing 1 / 2')).toBeTruthy()
  })

  it('filters the grid by the active category pill and toggles it off', () => {
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}))} plugins={TWO} />)
    const uiPill = screen.getByRole('button', { name: /UI & Experience/ })
    expect(uiPill.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(uiPill)
    expect(screen.getByText('Beta UI')).toBeTruthy()
    expect(screen.queryByText('Alpha Memory')).toBeNull()
    // Clicking the active pill again clears the filter.
    fireEvent.click(screen.getByRole('button', { name: /UI & Experience/ }))
    expect(screen.getByText('Alpha Memory')).toBeTruthy()
    expect(screen.getByText('Beta UI')).toBeTruthy()
    expect(screen.getByText('Showing 2 / 2')).toBeTruthy()
  })

  it('shows the no-match notice when search or filter empties the list', () => {
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}))} plugins={TWO} />)
    fireEvent.change(screen.getByLabelText(/search community plugins/i), { target: { value: 'zzz-nonexistent' } })
    expect(screen.getByText(/no matching community plugin found/i)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders the empty notice when no entries are registered', () => {
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}))} plugins={[]} />)
    expect(screen.getByText(/no community plugins registered yet/i)).toBeTruthy()
  })

  it('hides the entry list while the stored enable switch is off', () => {
    render(<CommunityPluginsCard {...cardProps(new FakeScope({ enabled: false }))} plugins={SAMPLE} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/community plugin index is turned off/i)).toBeTruthy()
  })

  it('stages the enable edit and persists it on save', async () => {
    const scope = new FakeScope({})
    render(<CommunityPluginsCard {...cardProps(scope)} plugins={SAMPLE} />)
    fireEvent.change(screen.getByLabelText(/enable the community plugin index/i), { target: { value: 'false' } })
    expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(scope.set).toHaveBeenCalledWith('enabled', false)
    await vi.waitFor(() => {
      expect(screen.getByText(/community plugin index is turned off/i)).toBeTruthy()
    })
  })
})
