// @vitest-environment jsdom
// Issue #2022: the list must refuse exactly what the host refuses. A row the
// host protects for a reason the browser half cannot observe (`attached`,
// `in-flight`) has to read as protected here too — otherwise the delete
// affordance invites an operation the host skips, and the confirm dialog
// undercounts the skips.
import { createElement } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { ArchiveController } from '../src/client/archive-controller.ts'
import { createArchiveStore } from '../src/client/archive-store.ts'
import { SessionArchiveCard } from '../src/client/SessionArchiveCard.tsx'
import type { ArchiveApi } from '../src/client/api.ts'
import { setRuntimeTranslate, t } from '../src/client/locales.ts'
import type { SessionArchiveConfig } from '../src/core/config.ts'
import type { ArchiveSessionRow, InventoryView } from '../src/core/types.ts'

/** Ready config form; the panel binds subscribe/getSnapshot before subscribing. */
class ReadyConfigForm implements ConfigForm<SessionArchiveConfig> {
  private readonly snapshot: ConfigFormSnapshot<SessionArchiveConfig>

  constructor(value: Partial<SessionArchiveConfig>) {
    this.snapshot = { status: 'ready', value, base: {}, user: {}, revision: 1, writable: true }
  }

  getSnapshot(): ConfigFormSnapshot<SessionArchiveConfig> {
    return this.snapshot
  }

  subscribe(): () => void {
    return () => {}
  }

  async set(): Promise<boolean> {
    return true
  }

  async unset(): Promise<boolean> {
    return true
  }

  async mutate(): Promise<boolean> {
    return true
  }
}

function row(overrides: Partial<ArchiveSessionRow> & { id: string }): ArchiveSessionRow {
  return {
    workspaceIds: [],
    archived: true,
    lastActivityReliable: true,
    running: false,
    blank: false,
    childIds: [],
    childCount: 0,
    issues: [],
    ...overrides,
  }
}

const ROWS: ArchiveSessionRow[] = [
  row({ id: 'session-attached', title: 'attached', hostProtectedReason: 'attached' }),
  row({ id: 'session-inflight', title: 'in-flight', hostProtectedReason: 'in-flight' }),
  row({ id: 'session-current', title: 'current' }),
  row({ id: 'session-running', title: 'running', running: true }),
  row({ id: 'session-plain', title: 'plain' }),
]

const INVENTORY: InventoryView = {
  generatedAt: 0,
  rows: ROWS,
  workspaces: [],
  archivedSessionIds: [],
  auto: { cycleRunning: false },
}

function stubApi(): ArchiveApi {
  return {
    inventory: () => Promise.resolve(INVENTORY),
    preview: () => Promise.reject(new Error('not used')),
    archive: () => Promise.resolve({ results: [], freedBytes: 0 }),
    unarchive: () => Promise.resolve({ results: [], freedBytes: 0 }),
    deleteSessions: () => Promise.resolve({ results: [], freedBytes: 0 }),
    autoPreview: () => Promise.resolve({ archiveCandidates: [], deleteCandidates: [], deleteBytes: 0 }),
    autoRun: () => Promise.resolve({ at: 0, total: 0, ok: 0, skipped: 0, failed: 0, entries: [] }),
  }
}

/** The same rows as an older host serves them: no host-protection field at all. */
function withoutHostFacts(rows: readonly ArchiveSessionRow[]): ArchiveSessionRow[] {
  return rows.map((entry) => {
    const copy = { ...entry }
    delete copy.hostProtectedReason
    return copy
  })
}

/**
 * Render the card against the given rows.
 * @param currentSessionId - the session the browser half reports as being viewed.
 * @param rows - the inventory rows to serve for this mount.
 */
async function mountCard(
  currentSessionId: string | undefined = 'session-current',
  rows: readonly ArchiveSessionRow[] = ROWS,
): Promise<{ container: HTMLElement; controller: ArchiveController }> {
  const inventory: InventoryView = { ...INVENTORY, rows }
  const controller = new ArchiveController({
    api: { ...stubApi(), inventory: () => Promise.resolve(inventory) },
    store: createArchiveStore().create(),
    sessions: { current: () => currentSessionId },
  })
  const { container } = render(createElement(SessionArchiveCard, {
    controller,
    settings: new ReadyConfigForm({}),
    close: () => {},
  }))
  await waitFor(() => expect(container.querySelectorAll('[data-dsh-part="row"]')).toHaveLength(rows.length))
  return { container, controller }
}

/** The row element for one session id. */
function rowOf(container: HTMLElement, id: string): HTMLElement {
  const match = [...container.querySelectorAll<HTMLElement>('[data-dsh-part="row"]')]
    .find((element) => element.textContent?.includes(id) === true)
  return match as HTMLElement
}

/** The per-row delete affordance. */
function rowDeleteButton(container: HTMLElement, id: string): HTMLButtonElement {
  return rowOf(container, id).querySelector('button[class*="linkDanger"]') as HTMLButtonElement
}

/** The batch delete affordance in the selection bar. */
function batchDeleteButton(container: HTMLElement): HTMLButtonElement {
  return [...container.querySelectorAll('button')]
    .find((button) => button.textContent === t('arch.batch.delete')) as HTMLButtonElement
}

describe('dsh-session-archive protected rows (issue #2022)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh'
    setRuntimeTranslate(undefined)
  })

  afterEach(() => {
    cleanup()
    document.documentElement.lang = ''
  })

  it('user cannot delete a row the host protects, and its tooltip says why', async () => {
    // Given a list where the host reports attachment, an in-flight operation,
    // the viewed session, and a running agent, beside one ordinary row
    const { container } = await mountCard()

    // When the user looks at the per-row delete affordances
    // Then every protected row refuses the action with its own reason
    for (const [id, reason] of [
      ['session-attached', 'attached'],
      ['session-inflight', 'in-flight'],
      ['session-current', 'current'],
      ['session-running', 'running'],
    ] as const) {
      const button = rowDeleteButton(container, id)
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('title')).toBe(t(`arch.reason.${reason}`))
    }

    // And the ordinary row stays deletable, with no excuse attached
    const plain = rowDeleteButton(container, 'session-plain')
    expect(plain.disabled).toBe(false)
    expect(plain.getAttribute('title')).toBeNull()
  })

  it('user keeps the batch delete when the selection mixes protected and deletable rows', async () => {
    // Given the card with one protected and one ordinary row selected
    const { container, controller } = await mountCard()
    controller.store.actions.selectMany(['session-attached', 'session-plain'], true)

    // When the selection bar re-renders
    await waitFor(() => expect(batchDeleteButton(container).disabled).toBe(false))

    // Then the batch affordance stays available, because the host would still delete one row
    expect(batchDeleteButton(container).getAttribute('title')).toBeNull()

    // And the confirm dialog states exactly how many sessions the host will skip
    fireEvent.click(batchDeleteButton(container))
    await waitFor(() => expect(container.textContent).toContain(t('arch.confirm.skipped', { n: 1 })))
    expect(container.textContent).toContain(t('arch.confirm.total', { n: 1 }))
  })

  it('user cannot start a batch delete when the host protects every selected row', async () => {
    // Given a selection made only of host-protected rows
    const { container, controller } = await mountCard()
    controller.store.actions.selectMany(['session-attached', 'session-inflight', 'session-current'], true)

    // When the selection bar re-renders
    await waitFor(() => expect(batchDeleteButton(container).disabled).toBe(true))

    // Then the batch affordance refuses the action and explains why
    expect(batchDeleteButton(container).getAttribute('title')).toBe(t('arch.batch.deleteBlocked'))
  })

  it('user sees no protection on rows from a host that reports none', async () => {
    // Given a host that predates the host-protection field: its rows carry no
    // such fact, and only running sessions travel with a reason
    const { container } = await mountCard(undefined, withoutHostFacts(ROWS))

    // When the rows render
    // Then the running row is still refused
    expect(rowDeleteButton(container, 'session-running').disabled).toBe(true)
    expect(rowDeleteButton(container, 'session-running').getAttribute('title')).toBe(t('arch.reason.running'))
    // And the rows whose only protection would be a host fact degrade to deletable
    expect(rowDeleteButton(container, 'session-attached').disabled).toBe(false)
    expect(rowDeleteButton(container, 'session-inflight').disabled).toBe(false)
  })
})
