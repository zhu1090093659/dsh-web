// @vitest-environment jsdom
/**
 * Create-task dialog regions (UX): the form groups its configuration into
 * collapsible regions instead of one long scrolling column, every collapsed
 * region keeps a one-line summary of the values it holds, a region holding a
 * blocking error is forced open, and the agent-preset picker offers the
 * deployment's four built-in presets plus any user preset with an inherit
 * default that names the preset a run actually lands on.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewTaskModal } from '../src/client/board/NewTaskModal.tsx'
import { t } from '../src/client/locales.ts'
import type { BoardController, ControllerSnapshot, ExecutionPresetOption } from '../src/core/controller.ts'
import type { TaskRecord } from '../src/core/tasks.ts'
import { OVERLAY_EXIT_MS } from '../src/client/board/overlay.tsx'
import { openFormSection } from './form-sections.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  window.localStorage.clear()
})

/** The deployment roster: the four built-in rows carry no display name. */
const PRESETS: ExecutionPresetOption[] = [
  { id: 'standard', isDefault: true },
  { id: 'ptc', isDefault: false },
  { id: 'minimal', isDefault: false },
  { id: 'cordis', isDefault: false },
  { id: 'dispatch', name: 'Dispatch', isDefault: false },
]

function renderModal(initialTask?: TaskRecord): HTMLElement {
  const snapshot: ControllerSnapshot = {
    tasks: [],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: undefined,
    executionOptions: {
      workspaces: [{ workspaceId: 'w1', title: 'Alpha' }],
      presets: PRESETS,
      models: [],
    },
    pendingTaskIds: [],
    host: {
      revision: 1,
      scheduler: { timeZone: 'UTC' },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
    },
  }
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    createTaskConfirmed: vi.fn(async () => ({ id: 'created' } as TaskRecord)),
    runTask: vi.fn(async () => true),
    openTask: vi.fn(),
    archiveTask: vi.fn(async () => true),
  } as unknown as BoardController
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      initialTask === undefined
        ? <NewTaskModal controller={controller} onClose={() => {}} />
        : <NewTaskModal controller={controller} initialTask={initialTask} onClose={() => {}} />,
    )
  })
  return container
}

/** The region header button carrying one localized title. */
function regionHeader(container: HTMLElement, title: string): HTMLButtonElement {
  const header = [...container.querySelectorAll<HTMLButtonElement>('[data-dsh-part="form-section"] > button')]
    .find(button => (button.textContent ?? '').startsWith(title))
  if (header === undefined) throw new Error(`no form region titled ${title}`)
  return header
}

/** The agent-preset picker: the select that carries the built-in optgroup. */
function agentPresetSelect(container: HTMLElement): HTMLSelectElement {
  openFormSection(container, t('new.section.execution'))
  const select = [...container.querySelectorAll<HTMLSelectElement>('select')]
    .find(candidate => [...candidate.querySelectorAll('optgroup')].some(group => group.label === t('exec.mode.builtinGroup')))
  if (select === undefined) throw new Error('no agent-preset picker')
  return select
}

describe('create-task dialog regions', () => {
  it('user opening the dialog gets the content region open and the configuration regions collapsed', () => {
    // Given no task on the board
    // When the user opens the new-task dialog
    const container = renderModal()

    // Then the content region renders its (empty) fields
    expect(regionHeader(container, t('new.section.content')).getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector<HTMLInputElement>(`[placeholder="${t('new.titlePlaceholder')}"]`)?.value).toBe('')

    // And every configuration region starts collapsed without rendering its fields
    for (const title of [
      t('new.section.labels'),
      t('new.section.execution'),
      t('new.section.run'),
      t('new.section.handover'),
      t('new.section.schedule'),
    ]) {
      expect(regionHeader(container, title).getAttribute('aria-expanded')).toBe('false')
    }
    expect(container.querySelector('[data-dsh-part="ai-parse"]')).toBeNull()
    expect(container.textContent).not.toContain(t('detail.schedule.enable'))
  })

  it('user expanding a region reaches the configuration it holds', () => {
    // Given the new-task dialog with its execution region collapsed
    const container = renderModal()
    expect(container.textContent).not.toContain(t('new.workspace'))

    // When the user expands that region
    openFormSection(container, t('new.section.execution'))

    // Then its fields are rendered and the header reports the open state
    expect(regionHeader(container, t('new.section.execution')).getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain(t('new.workspace'))
    expect(container.textContent).toContain(t('new.agentPreset'))
  })

  it('user opening the dialog reads what each collapsed region holds in its summary', () => {
    // Given the new-task dialog whose configuration regions are collapsed
    // When the user reads the region headers
    const container = renderModal()

    // Then each collapsed header summarizes the values it holds: session
    // reuse is off by default, so the run region reports nothing set
    expect(regionHeader(container, t('new.section.run')).textContent).toContain(t('new.summary.none'))
    // And the execution summary names the preset a run without a pin lands on
    expect(regionHeader(container, t('new.section.execution')).textContent)
      .toContain(t('preset.builtin.standard'))
    expect(regionHeader(container, t('new.section.labels')).textContent).toContain(t('new.summary.none'))
  })

  it('user sees the four built-in presets and user presets under an inherit default', () => {
    // Given the new-task dialog
    const container = renderModal()

    // When the user expands the execution region and reads the picker
    const select = agentPresetSelect(container)

    // Then it defaults to the inherit choice that names the deployment default
    // preset
    expect(select.options[0]!.value).toBe('')
    expect(select.options[0]!.textContent).toBe(t('exec.mode.inheritWith', { preset: t('preset.builtin.standard') }))

    // And the built-in rows carry their localized names, the user preset its own
    const builtinGroup = [...select.querySelectorAll('optgroup')].find(group => group.label === t('exec.mode.builtinGroup'))!
    expect([...builtinGroup.querySelectorAll('option')].map(option => option.textContent)).toEqual([
      `${t('preset.builtin.standard')}${t('exec.mode.defaultSuffix')}`,
      t('preset.builtin.ptc'),
      t('preset.builtin.minimal'),
      t('preset.builtin.cordis'),
    ])
    const customGroup = [...select.querySelectorAll('optgroup')].find(group => group.label === t('exec.mode.customGroup'))!
    expect([...customGroup.querySelectorAll('option')].map(option => option.value)).toEqual(['dispatch'])
  })

  it('user arming a schedule picks the time zone the create payload carries', async () => {
    // Given the new-task dialog with its schedule region expanded
    const container = renderModal()
    openFormSection(container, t('new.section.schedule'))

    // When the user enables the schedule and selects the Shanghai zone
    const enable = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    act(() => { enable.click() })
    const zoneSelect = [...container.querySelectorAll<HTMLSelectElement>('select')]
      .find(candidate => candidate.getAttribute('aria-label') === t('detail.schedule.timeZone'))
    if (zoneSelect === undefined) throw new Error('no schedule zone picker')
    expect([...zoneSelect.options].some(option => option.value === 'Asia/Shanghai')).toBe(true)
    act(() => {
      zoneSelect.value = 'Asia/Shanghai'
      zoneSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Then the dialog renders the zone picker labelled for the user and the
    // selected zone is the one the create call will carry
    expect(zoneSelect.value).toBe('Asia/Shanghai')
    expect(container.textContent).toContain(t('detail.schedule.timeZone'))
  })

  it('user leaving the zone at the Host default creates an unscheduled-zone rule', () => {
    // Given the new-task dialog with its schedule region expanded
    const container = renderModal()
    openFormSection(container, t('new.section.schedule'))

    // When the user enables the schedule without touching the zone picker
    const enable = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    act(() => { enable.click() })
    const zoneSelect = [...container.querySelectorAll<HTMLSelectElement>('select')]
      .find(candidate => candidate.getAttribute('aria-label') === t('detail.schedule.timeZone'))!

    // Then the picker rests on the Host entry, which stores no zone
    expect(zoneSelect.value).toBe('')
    expect(zoneSelect.options[0].value).toBe('')
  })

  it('user submitting an invalid schedule sees that region forced open with its error', async () => {
    // Given a duplicated task whose stored cron is invalid for a new create
    const source = {
      id: 'source',
      title: 'Source',
      description: '',
      prompt: '',
      schedule: { enabled: true, cron: 'not-a-cron' },
    } as unknown as TaskRecord

    // When the dialog opens (schedule region collapsed) and the user submits
    const container = renderModal(source)
    expect(regionHeader(container, t('new.section.schedule')).getAttribute('aria-expanded')).toBe('false')
    const form = container.querySelector('form')!
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    // Then the region is open and its error is visible instead of hidden
    expect(regionHeader(container, t('new.section.schedule')).getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain(t('detail.schedule.invalid'))
  })
})

describe('create-task dialog action hierarchy and disclosure wiring', () => {
  it('user scanning the create dialog sees one filled action, and it is the submit', () => {
    // Given the create dialog with its footer actions
    const container = renderModal()
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')]

    // When the user looks for the control that commits the form
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    // The commit is operable and announces the dialog's own submit copy
    expect(submit?.textContent).toBe(t('new.submit'))
    expect(submit?.disabled).toBe(false)
    const submitClass = submit?.className ?? ''
    const filled = buttons.filter(button => button.className === submitClass)

    // Then exactly one control wears the filled primary style
    expect(filled).toEqual([submit])

    // And the dismiss beside it is a secondary control
    const cancel = buttons.find(button => button.textContent === t('new.cancel'))
    expect(cancel?.className).not.toBe(submitClass)
  })

  it('user folding a create-dialog region gets the panel fold disclosure wiring', () => {
    // Given a collapsed region that carries a one-line summary
    const container = renderModal()
    const header = regionHeader(container, t('new.section.labels'))
    const controls = header.getAttribute('aria-controls')

    // Then the row declares its state, names its own body, and keeps the
    // collapsed line readable in full
    expect(header.getAttribute('aria-expanded')).toBe('false')
    // The row is the one claimant of that body id, declared before the body mounts
    expect([...container.querySelectorAll('[aria-controls]')].filter(node => node.getAttribute('aria-controls') === controls)).toEqual([header])
    expect(header.getAttribute('title')).toBe(t('new.summary.none'))

    // When the user expands it
    act(() => { header.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    // Then the body it names is the one that rendered, on this region's open leg
    expect(header.getAttribute('aria-expanded')).toBe('true')
    const body = document.getElementById(controls ?? '')
    expect(body?.parentElement).toBe(header.closest('[data-dsh-part="form-section"]'))
    expect(body?.getAttribute('data-state')).toBe('open')
  })
})

describe('create-task dialog region motion', () => {
  /** A region header the user has already expanded, plus the id of its body. */
  function openRegion(container: HTMLElement, title: string): { header: HTMLButtonElement; panelId: string } {
    const header = openFormSection(container, title)
    return { header, panelId: header.getAttribute('aria-controls') ?? '' }
  }

  it('user collapsing a region keeps its body mounted on the exit leg until the close duration ends', () => {
    // Given a dialog region the user has opened
    const container = renderModal()
    vi.useFakeTimers()
    try {
      const { header, panelId } = openRegion(container, t('new.section.labels'))
      expect(document.getElementById(panelId)?.getAttribute('data-state')).toBe('open')

      // When the user collapses it
      act(() => { header.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

      // Then the row already reports closed while the body stays mounted on
      // the exit leg of the pair the panel's fold rides
      expect(header.getAttribute('aria-expanded')).toBe('false')
      expect(document.getElementById(panelId)?.getAttribute('data-state')).toBe('closing')

      // And it is still mounted one tick before the close duration ends...
      act(() => { vi.advanceTimersByTime(OVERLAY_EXIT_MS - 1) })
      expect(document.getElementById(panelId)?.getAttribute('data-state')).toBe('closing')

      // ...and gone once it has
      act(() => { vi.advanceTimersByTime(2) })
      expect(document.getElementById(panelId)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('user reopening a region during the exit leg keeps the body it was collapsing', () => {
    // Given a region the user has just collapsed
    const container = renderModal()
    vi.useFakeTimers()
    try {
      const { header, panelId } = openRegion(container, t('new.section.labels'))
      act(() => { header.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(document.getElementById(panelId)?.getAttribute('data-state')).toBe('closing')

      // When they reopen it before the exit leg ends
      act(() => { vi.advanceTimersByTime(OVERLAY_EXIT_MS - 20) })
      act(() => { header.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

      // Then the body never left and it is back on the open leg, past the
      // point where the cancelled exit would have unmounted it
      expect(header.getAttribute('aria-expanded')).toBe('true')
      expect(document.getElementById(panelId)?.getAttribute('data-state')).toBe('open')
      act(() => { vi.advanceTimersByTime(OVERLAY_EXIT_MS * 2) })
      expect(document.getElementById(panelId)?.getAttribute('data-state')).toBe('open')
    } finally {
      vi.useRealTimers()
    }
  })
})

