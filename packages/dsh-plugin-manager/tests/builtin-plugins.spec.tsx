/** @vitest-environment jsdom */

/**
 * The built-in plugin group as the page shows it: the rows and their switches,
 * the write that runs through the official manager and the re-read that follows
 * it, the rollback and the named reason a refusal leaves, the locked rows, the
 * read-only preset block — and the DOM seat the group takes after the page's own
 * installed panel.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import {
  BuiltinPlugins,
  type BuiltinPluginsProps,
} from '../src/client/BuiltinPlugins.tsx'
import {
  BUILTIN_GROUP_MOUNT_SELECTOR,
  builtinGroupSeat,
  mountBuiltinPluginGroup,
} from '../src/client/builtin-plugins-mount.tsx'
import { en } from '../src/client/locales.ts'
import type { AgentPreset, DisplayText, LoaderEntry } from '../src/core/builtin.ts'
import type { InventoryFace, ManagerFace, RemoteSnapshot } from '../src/client/native-faces.ts'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** English copy, formatted the way the locale service formats it. */
const t: BuiltinPluginsProps['t'] = (key, params) => {
  const text = (en as Record<string, string>)[key] ?? String(key)
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}

/** Metadata resolution stand-in: the English entry of a translation map. */
const resolveText = (text: DisplayText): string => typeof text === 'string' ? text : text.en

const COMPUTER_USE: LoaderEntry = {
  entryId: 'computer-use',
  moduleName: '@deepseek-ai/dsh-computer-use',
  enabled: true,
  fiberPhase: 'active',
}

const COMPUTER_USE_DRIVER: LoaderEntry = {
  entryId: 'computer-use-cua-driver-native',
  moduleName: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
  enabled: true,
  fiberPhase: 'active',
}

const INVENTORY_ROW: LoaderEntry = {
  entryId: 'plugin-inventory',
  moduleName: '@deepseek-ai/dsh-host-plugin-inventory',
  enabled: true,
  fiberPhase: 'active',
}

/** One row one installed bundle contributes. */
const BUNDLE_ROW: LoaderEntry = {
  entryId: 'ui-settings-general',
  moduleName: '@deepseek-ai/dsh-client-ui-settings-general',
  enabled: true,
  fiberPhase: 'active',
}

/**
 * Whether the running Loader would really carry a write, read from the answer the
 * manager gave: only `applied` lands live. A restart-required change is written
 * but not loaded, and an overridden one is a higher layer's to keep.
 */
function tookEffect(answer: unknown): boolean {
  if (typeof answer !== 'object' || answer === null) return false
  const envelope = answer as { ok?: unknown; value?: { application?: string }; application?: string }
  const result = typeof envelope.ok === 'boolean' ? envelope.value : envelope
  return result?.application === 'applied'
}

/** A deployment stand-in: the manager answers, the inventory is re-read. */
interface Deployment {
  readonly remote: RemoteSnapshot
  readonly calls: { entryId: string; enabled: boolean }[]
  /** How many times the Loader snapshot was read. */
  reads(): number
}

function deployment(config: {
  entries: readonly LoaderEntry[]
  plugins?: unknown
  bundles?: unknown
  change?: unknown
  presets?: readonly AgentPreset[]
  /** A raw inventory answer, verbatim, to model a host that sends another shape. */
  answer?: unknown
  /** A value the inventory read throws instead of answering with. */
  failure?: unknown
  /** Set to null to model a deployment that publishes no manager face. */
  noManager?: boolean
}): Deployment {
  let entries = config.entries
  const calls: { entryId: string; enabled: boolean }[] = []
  let reads = 0

  const inventory: InventoryFace = {
    list: async () => {
      reads += 1
      if (config.failure !== undefined) throw config.failure
      if (config.answer !== undefined) return config.answer
      return {
        ok: true,
        value: {
          managementAvailable: true,
          entries,
          ...config.presets === undefined ? {} : { agentPresets: config.presets },
        },
      }
    },
  }
  const manager: ManagerFace = {
    listPlugins: async () => config.plugins ?? { ok: true, value: entries.map(entry => ({ entryId: entry.entryId })) },
    listBundles: async () => config.bundles ?? { ok: true, value: [{ name: 'dsh-web-app', rows: [{ entryId: 'ui-settings-general' }] }] },
    setPluginEnabled: async (entryId, enabled) => {
      calls.push({ entryId, enabled })
      const answer = config.change ?? { changed: true, application: 'applied' }
      if (tookEffect(answer)) entries = entries.map(entry => entry.entryId === entryId ? { ...entry, enabled } : entry)
      return answer
    },
  }

  return {
    remote: {
      version: 1,
      inventory,
      manager: config.noManager === true ? null : manager,
    },
    calls,
    reads: () => reads,
  }
}

/** Render the group over one deployment and wait for its first read. */
async function renderGroup(under: Deployment): Promise<void> {
  render(<BuiltinPlugins remote={under.remote} resolveText={resolveText} t={t} />)
  await waitFor(() => { expect(document.querySelector('[data-dsh-part="builtin-group"]')?.getAttribute('data-builtin-state')).toBe('ready') })
}

/** The switches, in row order. */
function switches(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-dsh-part="builtin-row"] button[role="switch"]')]
}

/** One row by entry id. */
function row(entryId: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-dsh-part="builtin-row"][data-entry-id="${entryId}"]`)
  if (found === null) throw new Error(`no row for ${entryId}`)
  return found
}

describe('built-in plugin rows', () => {
  it('user sees the built-in entries with one switch each, the bundle rows left out', async () => {
    // Given a Loader carrying one bundle's row beside the global ones
    const under = deployment({ entries: [BUNDLE_ROW, COMPUTER_USE, COMPUTER_USE_DRIVER, INVENTORY_ROW] })

    // When the group renders
    await renderGroup(under)

    // Then only the global rows are listed, each with a switch
    expect([...document.querySelectorAll('[data-dsh-part="builtin-row"]')].map(node => node.getAttribute('data-entry-id')))
      .toEqual(['computer-use', 'computer-use-cua-driver-native', 'plugin-inventory'])
    expect(switches()).toHaveLength(3)
    expect(switches()[0]?.getAttribute('aria-checked')).toBe('true')
  })

  it('user reads a row by the title its package publishes, with the module under it', async () => {
    // Given a row whose metadata carries a localized title
    const titled: LoaderEntry = { ...COMPUTER_USE, meta: { title: { en: 'Computer Use', zh: '电脑操作' } } }
    const under = deployment({ entries: [titled] })

    // When the group renders
    await renderGroup(under)

    // Then the title is the row's name and the module specifier stays readable
    expect(row('computer-use').textContent).toContain('Computer Use')
    expect(row('computer-use').textContent).toContain('@deepseek-ai/dsh-computer-use')
  })
})

describe('the built-in switch', () => {
  it('user turns a row off through the official manager and the switch then shows the Loader', async () => {
    // Given a writable row that is on
    const under = deployment({ entries: [COMPUTER_USE] })
    await renderGroup(under)

    // When the switch is clicked
    fireEvent.click(switches()[0] as HTMLElement)

    // Then the manager was asked to disable exactly that entry, and the group re-read the Loader
    await waitFor(() => { expect(switches()[0]?.getAttribute('aria-checked')).toBe('false') })
    expect(under.calls).toEqual([{ entryId: 'computer-use', enabled: false }])
    expect(under.reads()).toBe(2)
  })

  it('user sees the switch come back and the code named when the manager refuses', async () => {
    // Given a manager that folds a refusal into its answer
    const under = deployment({
      entries: [COMPUTER_USE],
      change: { changed: false, application: 'failed', error: { code: 'operation-error' } },
    })
    await renderGroup(under)

    // When the switch is clicked
    fireEvent.click(switches()[0] as HTMLElement)

    // Then the switch is back where the Loader still has it, and the alert names the code
    await waitFor(() => { expect(document.querySelector('[role="alert"]')?.textContent).toContain('operation-error') })
    expect(switches()[0]?.getAttribute('aria-checked')).toBe('true')
  })

  it('user reads a refused envelope as the sentence its code stands for', async () => {
    // Given a refusal delivered as the gateway's envelope
    const under = deployment({
      entries: [COMPUTER_USE],
      change: { ok: false, error: { code: 'management-required' } },
    })
    await renderGroup(under)

    // When the switch is clicked
    fireEvent.click(switches()[0] as HTMLElement)

    // Then the alert reads as the official sentence for that refusal
    await waitFor(() => {
      expect(document.querySelector('[role="alert"]')?.textContent)
        .toContain('Plugin management needs it; it cannot be switched off or uninstalled')
    })
  })

  it('user is told when a higher profile layer overrides the write', async () => {
    // Given a write the host accepted but a higher layer overrides
    const under = deployment({
      entries: [COMPUTER_USE],
      change: { changed: true, application: 'overridden' },
    })
    await renderGroup(under)

    // When the switch is clicked
    fireEvent.click(switches()[0] as HTMLElement)

    // Then the note says the change was overridden, and the re-read leaves the switch on
    await waitFor(() => {
      expect(document.querySelector('[data-dsh-part="builtin-notice"]')?.textContent)
        .toContain('A higher profile layer overrides this change to @deepseek-ai/dsh-computer-use, so it did not take effect.')
    })
    await waitFor(() => { expect(switches()[0]?.getAttribute('aria-checked')).toBe('true') })
    expect(under.reads()).toBe(2)
  })

  it('user is told when an accepted write only takes effect after a restart', async () => {
    // Given a write the running process cannot load
    const under = deployment({
      entries: [COMPUTER_USE],
      change: { changed: true, application: 'restart-required', restartReason: 'no-hmr' },
    })
    await renderGroup(under)

    // When the switch is clicked
    fireEvent.click(switches()[0] as HTMLElement)

    // Then the status line says the change waits for a restart, and why
    await waitFor(() => {
      expect(document.querySelector('[data-dsh-part="builtin-notice"]')?.textContent)
        .toContain('This change needs a DSH restart: This profile applies changes only at startup.')
    })

    // And it speaks in the passing tone: nothing has taken effect yet
    expect(document.querySelector('[data-dsh-part="builtin-notice"]')?.getAttribute('data-notice-tone')).toBe('note')
  })
})

describe('locked rows', () => {
  it('user sees each lock named separately, with no switch to press', async () => {
    // Given two rows the manager protects for different reasons
    const under = deployment({
      entries: [COMPUTER_USE, INVENTORY_ROW],
      plugins: {
        ok: true,
        value: [
          { entryId: 'computer-use', readOnlyReason: 'management-required' },
          { entryId: 'plugin-inventory', readOnlyReason: 'unaddressable' },
        ],
      },
    })

    // When the group renders
    await renderGroup(under)

    // Then both switches are disabled and each row says which lock it is
    expect(switches().map(node => node.hasAttribute('disabled'))).toEqual([true, true])
    expect(row('computer-use').textContent).toContain('Plugin management needs it; it cannot be switched off or uninstalled')
    expect(row('plugin-inventory').textContent).toContain('The profile patch cannot address this one uniquely')
  })

  it('user gets no switch when the manager roster could not be read', async () => {
    // Given a plugin roster read that failed
    const under = deployment({ entries: [COMPUTER_USE], plugins: { ok: false, error: { code: 'network' } } })

    // When the group renders
    await renderGroup(under)

    // Then the row is reported as unknown and cannot be written from here
    expect(row('computer-use').getAttribute('data-write')).toBe('unknown')
    expect(switches()[0]?.hasAttribute('disabled')).toBe(true)
    expect(row('computer-use').textContent).toContain('Whether this one can be written is unknown')
  })

  it('user is told the roster is unconfirmed when the bundle list fails', async () => {
    // Given a bundle read that failed
    const under = deployment({
      entries: [BUNDLE_ROW, COMPUTER_USE],
      bundles: { ok: false, error: { code: 'network' } },
    })

    // When the group renders
    await renderGroup(under)

    // Then every entry is listed and the group says the roster is unconfirmed
    expect(document.querySelector('[data-dsh-part="builtin-group"]')?.getAttribute('data-builtin-bundles'))
      .toBe('unconfirmed')
    expect(document.querySelector('[data-builtin-unconfirmed]')?.textContent)
      .toBe('The installed bundles could not be read, so every Loader entry is listed here.')

    // And no count badge claims that every-entry list is the group's own size
    expect(document.querySelector('[data-builtin-count]')).toBeNull()
    expect([...document.querySelectorAll('[data-dsh-part="builtin-row"]')]).toHaveLength(2)
  })
})

describe('unreadable Loader snapshots', () => {
  /** The failure line the group shows in place of a list. */
  function failureLine(): string | null | undefined {
    return document.querySelector('[role="alert"]')?.textContent
  }

  it('user is told the read failed when the host answers without a snapshot', async () => {
    // Given a namespace whose answer carries no value at all
    const under = deployment({ entries: [COMPUTER_USE], answer: { ok: true } })

    // When the group reads it
    render(<BuiltinPlugins remote={under.remote} resolveText={resolveText} t={t} />)

    // Then the group reports the failure instead of waiting for a list forever
    await waitFor(() => {
      expect(document.querySelector('[data-dsh-part="builtin-group"]')?.getAttribute('data-builtin-state')).toBe('failed')
    })
    expect(failureLine()).toBe(t('builtinFailed', { reason: 'operation-error' }))
  })

  it('user is told the read failed when the namespace answers with a bare null', async () => {
    // Given a namespace that hands back null instead of a snapshot
    const under = deployment({ entries: [COMPUTER_USE], answer: null })

    // When the group reads it
    render(<BuiltinPlugins remote={under.remote} resolveText={resolveText} t={t} />)

    // Then the same failure is shown, and no row is drawn from a value that is not a snapshot
    await waitFor(() => {
      expect(document.querySelector('[data-dsh-part="builtin-group"]')?.getAttribute('data-builtin-state')).toBe('failed')
    })
    expect(failureLine()).toBe(t('builtinFailed', { reason: 'operation-error' }))
    expect(document.querySelectorAll('[data-dsh-part="builtin-row"]')).toHaveLength(0)
  })

  it('user is told the read failed without the raw host diagnostic reaching the page', async () => {
    // Given a read that throws a diagnostic naming a path on the host
    const under = deployment({
      entries: [COMPUTER_USE],
      failure: new Error('ENOENT: open /Users/somebody/.dsh/profiles/web/cordis.patch.yml'),
    })

    // When the group reads it
    render(<BuiltinPlugins remote={under.remote} resolveText={resolveText} t={t} />)

    // Then the page carries the fixed sentence and none of that path
    await waitFor(() => { expect(failureLine()).toBe(t('builtinFailed', { reason: 'operation-error' })) })
    expect(document.body.textContent).not.toContain('/Users/somebody')
  })
})

describe('rows that share a module', () => {
  const MCP_FILES: LoaderEntry = {
    entryId: 'mcp-filesystem',
    moduleName: '@deepseek-ai/dsh-mcp-client',
    enabled: true,
    fiberPhase: 'active',
  }
  const MCP_GITHUB: LoaderEntry = {
    entryId: 'mcp-github',
    moduleName: '@deepseek-ai/dsh-mcp-client',
    enabled: true,
    fiberPhase: 'active',
  }

  it('user can tell two rows of one module apart, because each names its own entry', async () => {
    // Given two Loader entries that name the same module and carry no title
    const under = deployment({ entries: [MCP_FILES, MCP_GITHUB] })

    // When the group renders them
    await renderGroup(under)

    // Then each row pairs that shared module with its own entry id
    expect(row('mcp-filesystem').textContent).toContain('mcp-filesystem')
    expect(row('mcp-github').textContent).toContain('mcp-github')
    expect(row('mcp-filesystem').textContent).not.toBe(row('mcp-github').textContent)
    expect(row('mcp-filesystem').textContent).toContain('@deepseek-ai/dsh-mcp-client')
  })

  it('user sees the module beside a titled row, as before', async () => {
    // Given a row whose package publishes a title
    const titled: LoaderEntry = { ...MCP_FILES, meta: { title: 'Filesystem MCP' } }
    const under = deployment({ entries: [titled] })

    // When the group renders it
    await renderGroup(under)

    // Then the title stays the name and the module stays the line beneath it
    expect(row('mcp-filesystem').textContent).toContain('Filesystem MCP')
    expect(row('mcp-filesystem').textContent).toContain('@deepseek-ai/dsh-mcp-client')
  })
})

describe('rows the list cannot tell apart', () => {
  const AGENT_PRESET = '@deepseek-ai/dsh-agent-preset'

  /** One preset row: a shared title and a shared module, its own entry. */
  function presetRow(entryId: string): LoaderEntry {
    return {
      entryId,
      moduleName: AGENT_PRESET,
      meta: { title: 'Agent preset definition' },
      enabled: true,
      fiberPhase: 'active',
    }
  }

  /** The entry ids the rows had to reveal, in list order. */
  function revealed(): (string | null)[] {
    return [...document.querySelectorAll<HTMLElement>('[data-entry-revealed]')]
      .map(node => node.getAttribute('data-entry-revealed'))
  }

  it('user tells three rows with one shared title apart by the entry each one names', async () => {
    // Given three Loader rows whose title and module are identical
    const under = deployment({
      entries: [presetRow('agent-preset-a'), presetRow('agent-preset-b'), presetRow('agent-preset-c')],
    })

    // When the group renders them
    await renderGroup(under)

    // Then every row states which entry it is, so the three stop reading as one line
    expect(revealed()).toEqual(['agent-preset-a', 'agent-preset-b', 'agent-preset-c'])
    expect(row('agent-preset-a').textContent).toContain('agent-preset-a')
    expect(row('agent-preset-b').textContent).toContain('agent-preset-b')
  })

  it('user keeps a unique row free of an entry line', async () => {
    // Given rows whose labels nothing else on the list shares
    const under = deployment({ entries: [presetRow('agent-preset-a'), COMPUTER_USE] })

    // When the group renders them
    await renderGroup(under)

    // Then neither row is asked to identify itself
    expect(revealed()).toEqual([])
  })

  it('user sees the entry line appear and go as the list widens and narrows, with nothing read or written', async () => {
    // Given two rows sharing a title, the second one contributed by a bundle
    const under = deployment({
      entries: [presetRow('agent-preset-a'), presetRow('agent-preset-b')],
      bundles: { ok: true, value: [{ name: 'dsh-base', installed: true, rows: [{ entryId: 'agent-preset-b' }] }] },
    })
    await renderGroup(under)

    // When only the default scope is shown, its single row is unambiguous
    expect(revealed()).toEqual([])
    const readsBefore = under.reads()

    // And the list is widened to both rows
    fireEvent.click(document.querySelector('[data-dsh-part="builtin-scope"]') as HTMLElement)
    await waitFor(() => { expect(revealed()).toEqual(['agent-preset-a', 'agent-preset-b']) })

    // Then narrowing it again drops the entry lines, with no read and no write behind it
    fireEvent.click(document.querySelector('[data-dsh-part="builtin-scope"]') as HTMLElement)
    await waitFor(() => { expect(revealed()).toEqual([]) })
    expect(under.reads()).toBe(readsBefore)
    expect(under.calls).toEqual([])
  })
})

describe('builtin list scope', () => {
  /** The scope control beside the heading's count. */
  function scopeControl(): HTMLButtonElement {
    const found = document.querySelector<HTMLButtonElement>('[data-dsh-part="builtin-scope"]')
    if (found === null) throw new Error('the group rendered no scope control')
    return found
  }

  /** The count the heading shows beside the title. */
  function shownCount(): string | null | undefined {
    return document.querySelector('[data-builtin-count]')?.getAttribute('data-builtin-count')
  }

  /** The rows the list currently renders. */
  function listedRows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[data-dsh-part="builtin-row"]')]
  }

  it('user starts on the rows no bundle owns, with the control saying what it would add', async () => {
    // Given a Loader with one bundle-owned row beside two global ones
    const under = deployment({ entries: [BUNDLE_ROW, COMPUTER_USE, INVENTORY_ROW] })

    // When the group renders
    await renderGroup(under)

    // Then only the two unowned rows are listed, and the count matches them
    expect(listedRows().map(node => node.getAttribute('data-entry-id')))
      .toEqual(['computer-use', 'plugin-inventory'])
    expect(shownCount()).toBe('2')
    expect(document.querySelector('[data-dsh-part="builtin-group"]')?.getAttribute('data-builtin-scope')).toBe('default')

    // And the control offers the one row it holds back, collapsed
    expect(scopeControl().getAttribute('aria-expanded')).toBe('false')
    expect(scopeControl().textContent).toBe(t('builtinScopeExpand', { count: '1' }))
  })

  it('user widens the list to every Loader entry, each owned row naming its bundle', async () => {
    // Given the group on its default scope
    const under = deployment({ entries: [BUNDLE_ROW, COMPUTER_USE, INVENTORY_ROW] })
    await renderGroup(under)

    // When the user asks for the wider scope
    fireEvent.click(scopeControl())

    // Then every Loader entry is listed, in Loader order
    await waitFor(() => { expect(shownCount()).toBe('3') })
    expect(listedRows().map(node => node.getAttribute('data-entry-id')))
      .toEqual(['ui-settings-general', 'computer-use', 'plugin-inventory'])

    // And the bundle-owned row says which bundle contributes it
    expect(row('ui-settings-general').getAttribute('data-owned-by')).toBe('dsh-web-app')
    expect(row('ui-settings-general').textContent).toContain(t('builtinOwnedBy', { name: 'dsh-web-app' }))
    expect(row('computer-use').getAttribute('data-owned-by')).toBeNull()
  })

  it('user controls the list through the heading, with the button naming the element it changes', async () => {
    // Given the group on its default scope
    const under = deployment({ entries: [BUNDLE_ROW, COMPUTER_USE] })
    await renderGroup(under)

    // When the control is asked what it controls
    const controls = scopeControl().getAttribute('aria-controls') ?? ''

    // Then it names the list element itself, and its expanded state is that list's scope
    expect(document.getElementById(controls)?.tagName).toBe('UL')
    expect(scopeControl().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(scopeControl())
    await waitFor(() => { expect(scopeControl().getAttribute('aria-expanded')).toBe('true') })
    expect(scopeControl().textContent).toBe(t('builtinScopeCollapse', { count: '1' }))
  })

  it('user narrows the list back with no Loader read and no write behind it', async () => {
    // Given the group widened to every entry
    const under = deployment({ entries: [BUNDLE_ROW, COMPUTER_USE] })
    await renderGroup(under)
    fireEvent.click(scopeControl())
    await waitFor(() => { expect(shownCount()).toBe('2') })
    const readsAfterWidening = under.reads()

    // When the user narrows it again
    fireEvent.click(scopeControl())

    // Then the default scope is back, with no second read and no write to the manager
    await waitFor(() => { expect(shownCount()).toBe('1') })
    expect(listedRows().map(node => node.getAttribute('data-entry-id'))).toEqual(['computer-use'])
    expect(under.reads()).toBe(readsAfterWidening)
    expect(under.calls).toEqual([])
  })

  it('user finds a bundle-owned row locked in the wider scope for the reason the manager gave', async () => {
    // Given a row the manager protects, contributed by a bundle
    const under = deployment({
      entries: [BUNDLE_ROW, COMPUTER_USE],
      plugins: {
        ok: true,
        value: [
          { entryId: 'ui-settings-general', readOnlyReason: 'management-required' },
          { entryId: 'computer-use' },
        ],
      },
    })
    await renderGroup(under)

    // When the list is widened to it
    fireEvent.click(scopeControl())
    await waitFor(() => { expect(shownCount()).toBe('2') })

    // Then its switch refuses input and the row still names that lock
    const owned = row('ui-settings-general')
    expect(owned.getAttribute('data-write')).toBe('management-required')
    expect(owned.querySelector('button')?.hasAttribute('disabled')).toBe(true)
    expect(owned.textContent).toContain(t('builtinReasonManagementRequired'))
  })

  it('user turns a row off from the wider scope and the group re-reads the Loader', async () => {
    // Given the list widened to every entry
    const under = deployment({ entries: [BUNDLE_ROW, COMPUTER_USE] })
    await renderGroup(under)
    fireEvent.click(scopeControl())
    await waitFor(() => { expect(shownCount()).toBe('2') })
    const readsBefore = under.reads()

    // When the user switches the global row off
    fireEvent.click(row('computer-use').querySelector('button') as HTMLElement)

    // Then the official manager was asked, and the group read the Loader again
    await waitFor(() => { expect(under.calls).toEqual([{ entryId: 'computer-use', enabled: false }]) })
    await waitFor(() => { expect(under.reads()).toBe(readsBefore + 1) })

    // And the wider scope is still the one being shown
    expect(document.querySelector('[data-dsh-part="builtin-group"]')?.getAttribute('data-builtin-scope')).toBe('all')
    expect(row('computer-use').getAttribute('data-write')).toBe('writable')
  })
})

describe('built-in list search and pagination', () => {
  const MANY_ROWS: LoaderEntry[] = Array.from({ length: 25 }, (_, index) => {
    const suffix = String(index + 1).padStart(2, '0')
    return {
      entryId: 'global-' + suffix,
      moduleName: '@example/global-' + suffix,
      enabled: true,
      fiberPhase: 'active',
    }
  })

  function searchInput(): HTMLInputElement {
    const found = document.querySelector<HTMLInputElement>('[data-builtin-search]')
    if (found === null) throw new Error('the group rendered no search input')
    return found
  }

  function listedEntryIds(): (string | null)[] {
    return [...document.querySelectorAll<HTMLElement>('[data-dsh-part="builtin-row"]')]
      .map(node => node.getAttribute('data-entry-id'))
  }

  function pagination(): HTMLElement {
    const found = document.querySelector<HTMLElement>('[data-dsh-part="pagination"]')
    if (found === null) throw new Error('the group rendered no pagination')
    return found
  }

  async function search(value: string): Promise<void> {
    fireEvent.change(searchInput(), { target: { value } })
    await waitFor(() => { expect(searchInput().value).toBe(value) })
  }

  it('user finds a row by its localized title, module package, or entry id without another Loader read', async () => {
    // Given rows whose searchable fields are deliberately different
    const titled: LoaderEntry = {
      entryId: 'alpha-row',
      moduleName: '@example/alpha',
      meta: { title: { en: 'Visible Name', zh: '可见名称' } },
      enabled: true,
      fiberPhase: 'active',
    }
    const under = deployment({ entries: [titled, COMPUTER_USE, INVENTORY_ROW] })
    await renderGroup(under)
    const readsBefore = under.reads()

    // When the user searches each field in turn
    await search('visible name')
    expect(listedEntryIds()).toEqual(['alpha-row'])
    await search('DSH-COMPUTER-USE')
    expect(listedEntryIds()).toEqual(['computer-use'])
    await search('PLUGIN-INVENTORY')
    expect(listedEntryIds()).toEqual(['plugin-inventory'])

    // Then matching is case-insensitive and entirely local to the snapshot already read
    expect(searchInput().getAttribute('aria-label')).toBe(t('builtinSearchLabel'))
    expect(document.querySelector('[data-builtin-count]')?.getAttribute('data-builtin-count')).toBe('1')
    expect(under.reads()).toBe(readsBefore)
    expect(under.calls).toEqual([])
  })

  it('user finds a bundle-owned row by its owner in the wider scope', async () => {
    // Given the wider scope, where the owner is visible on the contributed row
    const under = deployment({ entries: [BUNDLE_ROW, COMPUTER_USE] })
    await renderGroup(under)
    fireEvent.click(document.querySelector('[data-dsh-part="builtin-scope"]') as HTMLElement)
    await waitFor(() => { expect(listedEntryIds()).toHaveLength(2) })

    // When the user searches the bundle package name rather than the row's own module
    await search('dsh-web-app')

    // Then only that contributed row remains
    expect(listedEntryIds()).toEqual(['ui-settings-general'])
  })

  it('user sees a specific empty result and restores the list with Escape', async () => {
    // Given a search that matches no row
    const under = deployment({ entries: [COMPUTER_USE] })
    await renderGroup(under)
    await search('nothing-matches-this')

    // Then the search stays available and the empty state does not claim the inventory is empty
    expect(listedEntryIds()).toEqual([])
    expect(document.querySelector('[role="status"]')?.textContent).toBe(t('builtinSearchEmpty'))
    expect(document.querySelector('[data-builtin-count]')?.getAttribute('data-builtin-count')).toBe('0')

    // When the user presses Escape, the original rows return
    fireEvent.keyDown(searchInput(), { key: 'Escape' })
    await waitFor(() => { expect(listedEntryIds()).toEqual(['computer-use']) })
    expect(searchInput().value).toBe('')
  })

  it('user pages through at most twenty rows without reading or writing again', async () => {
    // Given twenty-five global rows
    const under = deployment({ entries: MANY_ROWS })
    await renderGroup(under)
    const readsBefore = under.reads()

    // Then the first page stops at twenty and names the complete result size
    expect(listedEntryIds()).toEqual(MANY_ROWS.slice(0, 20).map(row => row.entryId))
    expect(pagination().textContent).toContain(t('builtinPageInfo', { page: '1', pages: '2', count: '25' }))
    const firstButtons = pagination().querySelectorAll('button')
    expect(firstButtons[0]?.hasAttribute('disabled')).toBe(true)
    expect(firstButtons[1]?.hasAttribute('disabled')).toBe(false)

    // When the user opens the next page
    fireEvent.click(firstButtons[1] as HTMLElement)
    await waitFor(() => { expect(listedEntryIds()).toEqual(MANY_ROWS.slice(20).map(row => row.entryId)) })

    // Then only the render window moved, not the Loader or the manager
    expect(pagination().textContent).toContain(t('builtinPageInfo', { page: '2', pages: '2', count: '25' }))
    expect(pagination().querySelectorAll('button')[1]?.hasAttribute('disabled')).toBe(true)
    expect(under.reads()).toBe(readsBefore)
    expect(under.calls).toEqual([])

    // And a search, then clearing it, returns through the first page rather than preserving a stale offset
    await search('global-03')
    expect(listedEntryIds()).toEqual(['global-03'])
    fireEvent.keyDown(searchInput(), { key: 'Escape' })
    await waitFor(() => { expect(listedEntryIds()).toEqual(MANY_ROWS.slice(0, 20).map(row => row.entryId)) })
    expect(pagination().textContent).toContain(t('builtinPageInfo', { page: '1', pages: '2', count: '25' }))
  })

  it('user returns to the first page when the list scope changes', async () => {
    // Given page two of the expanded inventory
    const under = deployment({ entries: [BUNDLE_ROW, ...MANY_ROWS] })
    await renderGroup(under)
    fireEvent.click(document.querySelector('[data-dsh-part="builtin-scope"]') as HTMLElement)
    await waitFor(() => { expect(listedEntryIds()).toHaveLength(20) })
    fireEvent.click(pagination().querySelectorAll('button')[1] as HTMLElement)
    await waitFor(() => {
      expect(pagination().textContent).toContain(t('builtinPageInfo', { page: '2', pages: '2', count: '26' }))
    })

    // When the user narrows the scope again
    fireEvent.click(document.querySelector('[data-dsh-part="builtin-scope"]') as HTMLElement)

    // Then the default inventory starts from its first page
    await waitFor(() => { expect(listedEntryIds()).toEqual(MANY_ROWS.slice(0, 20).map(row => row.entryId)) })
    expect(pagination().textContent).toContain(t('builtinPageInfo', { page: '1', pages: '2', count: '25' }))
  })
})

describe('agent preset compositions', () => {
  const presets: AgentPreset[] = [
    {
      id: 'liangshen',
      name: 'Muxiang',
      isDefault: true,
      rows: [
        { entryId: 'agent-loop', moduleName: '@deepseek-ai/dsh-agent-loop', enabled: true, fiberPhase: 'active' },
        { entryId: 'web-search', moduleName: '@deepseek-ai/dsh-web-search', enabled: false, fiberPhase: null },
        { entryId: null, moduleName: '@deepseek-ai/dsh-schedule', enabled: 'conditional', condition: "process.platform === 'darwin'", fiberPhase: null },
      ],
    },
  ]

  it('user reads the preset name and its rows without a switch', async () => {
    // Given a composed preset roster
    const under = deployment({ entries: [COMPUTER_USE], presets })

    // When the group renders
    await renderGroup(under)

    // Then the preset and its rows are listed read-only
    const group = document.querySelector('[data-dsh-part="preset-group"]')
    expect(group?.textContent).toContain('Muxiang')
    expect(group?.textContent).toContain('Default')
    expect(group?.querySelectorAll('[data-dsh-part="preset-row"]')).toHaveLength(3)
    expect(group?.querySelector('button')).toBeNull()
  })

  it('user sees a conditional row marked as conditional, with its expression', async () => {
    // Given a row the composition enables behind a condition
    const under = deployment({ entries: [COMPUTER_USE], presets })

    // When the group renders
    await renderGroup(under)

    // Then that row is marked conditional and names the expression, not a state it does not have
    const conditional = document.querySelector('[data-preset-state="conditional"]')
    expect(conditional?.textContent).toContain("Conditional: process.platform === 'darwin'")
    expect(document.querySelectorAll('[data-preset-state="off"]')).toHaveLength(1)
  })

  it('user sees why a preset composition cannot be read instead of an empty list', async () => {
    // Given a preset whose composition is broken
    const under = deployment({
      entries: [COMPUTER_USE],
      presets: [{ id: 'broken', isDefault: false, broken: 'no rows', rows: [] }],
    })

    // When the group renders
    await renderGroup(under)

    // Then the group names the reason and lists no rows for it
    expect(document.querySelector('[data-dsh-part="preset"]')?.textContent)
      .toContain('This preset composition cannot be read: no rows')
  })
})

/** The official Plugins page's list view: the installed panel and its groups. */
function pluginPage(): { page: HTMLElement; panel: HTMLElement; group: HTMLElement } {
  const page = document.createElement('section')
  page.setAttribute('data-plugin-panel', '')
  const panel = document.createElement('div')
  panel.className = 'Page_module_installedPanel-hash'
  const group = document.createElement('section')
  group.setAttribute('data-plugin-group', 'bundles')
  panel.append(group)
  page.append(panel)
  document.body.append(page)
  return { page, panel, group }
}

/** Mount options over one deployment. */
function mountOptions(under: Deployment, subscribe?: (listener: () => void) => () => void) {
  return {
    props: () => ({ remote: under.remote, resolveText, t }),
    ...subscribe === undefined ? {} : { subscribe },
  }
}

describe('the group seat on the official page', () => {
  it('user finds the group right after the installed panel', async () => {
    // Given the official page on its list view
    const { panel } = pluginPage()

    // When the group mounts
    const dispose = mountBuiltinPluginGroup(mountOptions(deployment({ entries: [COMPUTER_USE] })))

    // Then its container is the installed panel's next sibling
    const container = document.querySelector(BUILTIN_GROUP_MOUNT_SELECTOR)
    expect(container?.previousElementSibling).toBe(panel)
    await waitFor(() => {
      expect(document.querySelector('[data-dsh-part="builtin-group"]')?.getAttribute('data-dsh-plugin')).toBe('plugin-manager')
    })
    dispose()
  })

  it('user keeps exactly one group when the mount runs twice', async () => {
    // Given one mounted group
    pluginPage()
    const under = deployment({ entries: [COMPUTER_USE] })
    const first = mountBuiltinPluginGroup(mountOptions(under))
    await waitFor(() => { expect(document.querySelector('[data-dsh-part="builtin-group"]')?.getAttribute('data-dsh-plugin')).toBe('plugin-manager') })

    // When a duplicate apply mounts again
    const second = mountBuiltinPluginGroup(mountOptions(under))

    // Then the second mount is inert and its disposal leaves the first
    expect(document.querySelectorAll(BUILTIN_GROUP_MOUNT_SELECTOR)).toHaveLength(1)
    second()
    expect(document.querySelectorAll(BUILTIN_GROUP_MOUNT_SELECTOR)).toHaveLength(1)
    first()
    expect(document.querySelectorAll(BUILTIN_GROUP_MOUNT_SELECTOR)).toHaveLength(0)
  })

  it('user keeps the group on the page when the page rebuilds its panel', async () => {
    // Given a mounted group
    const { page } = pluginPage()
    const under = deployment({ entries: [COMPUTER_USE] })
    const dispose = mountBuiltinPluginGroup(mountOptions(under))
    await waitFor(() => { expect(document.querySelector('[data-dsh-part="builtin-group"]')?.getAttribute('data-dsh-plugin')).toBe('plugin-manager') })
    const container = document.querySelector(BUILTIN_GROUP_MOUNT_SELECTOR)

    // When the page re-renders the panel from scratch
    const rebuilt = document.createElement('div')
    rebuilt.className = 'Page_module_installedPanel-hash'
    const group = document.createElement('section')
    group.setAttribute('data-plugin-group', 'bundles')
    rebuilt.append(group)
    page.replaceChild(rebuilt, page.firstElementChild as HTMLElement)

    // Then the container re-seats after the new panel
    await waitFor(() => { expect(container?.previousElementSibling).toBe(rebuilt) })
    dispose()
  })

  it('user sees no group on a view that renders no installed list', async () => {
    // Given the page on a package detail view
    const page = document.createElement('section')
    page.setAttribute('data-plugin-panel', '')
    document.body.append(page)

    // When the group mounts
    const dispose = mountBuiltinPluginGroup(mountOptions(deployment({ entries: [COMPUTER_USE] })))

    // Then nothing is left on the page, and the seat resolves to nothing
    expect(builtinGroupSeat()).toBeUndefined()
    expect(document.querySelector(BUILTIN_GROUP_MOUNT_SELECTOR)).toBeNull()
    dispose()
  })

  it('user sees the mounted group follow a language switch', async () => {
    // Given a mount subscribed to locale changes
    pluginPage()
    const listeners = new Set<() => void>()
    let label = 'Built-in plugins'
    const dispose = mountBuiltinPluginGroup({
      props: () => ({
        remote: deployment({ entries: [] }).remote,
        resolveText,
        t: () => label,
      }),
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    })
    await waitFor(() => { expect(document.body.textContent).toContain('Built-in plugins') })

    // When the active language moves
    label = 'Встроенные плагины'
    for (const listener of [...listeners]) listener()

    // Then the mounted copy follows it
    await waitFor(() => { expect(document.body.textContent).toContain('Встроенные плагины') })
    dispose()
  })
})
