// @vitest-environment jsdom
/**
 * The new-task dialog's prefills: the four execution targets it opens on,
 * resolved from the board's new-card defaults and the card the new one is
 * created from (a duplicate's source, a subtask's parent) by the one rule the
 * Host create path uses — plus what a picker the user clears leaves out of the
 * create payload.
 *
 * The dialog is the surface a user meets, so these cases drive the shipped
 * component over a controller double and read what the create action would
 * actually send.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewTaskModal } from '../src/client/board/NewTaskModal.tsx'
import { t } from '../src/client/locales.ts'
import type { BoardController, ControllerSnapshot, ExecutionModelOption, ExecutionPresetOption } from '../src/core/controller.ts'
import type { TaskPermission, TaskRecord } from '../src/core/tasks.ts'
import { openFormSection } from './form-sections.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  window.localStorage.clear()
})

/** The deployment roster the dialog's mode picker lists. */
const PRESETS: ExecutionPresetOption[] = [
  { id: 'standard', isDefault: true },
  { id: 'ptc', isDefault: false },
  { id: 'minimal', isDefault: false },
]

/** The deployment model roster: one route declaring levels, one declaring none. */
const MODELS: ExecutionModelOption[] = [
  { id: 'alpha/fast', name: 'Fast', provider: 'alpha', reasoning: { supported: true, efforts: ['low', 'high'] } },
  { id: 'beta/plain', name: 'Plain', provider: 'beta', reasoning: { supported: false } },
]

interface DialogHarness {
  container: HTMLElement
  createTaskConfirmed: ReturnType<typeof vi.fn>
}

/**
 * Render the dialog over a controller double.
 * @param options - the board's new-card defaults and the card this one is created from.
 */
function renderDialog(options: {
  defaults?: { mode?: string; permission?: TaskPermission; model?: string; reasoningEffort?: string }
  initialTask?: TaskRecord
  parentTask?: TaskRecord
} = {}): DialogHarness {
  const snapshot: ControllerSnapshot = {
    tasks: options.parentTask === undefined ? [] : [options.parentTask],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: undefined,
    executionOptions: { workspaces: [], presets: PRESETS, models: MODELS },
    pendingTaskIds: [],
    host: {
      revision: 1,
      scheduler: { timeZone: 'UTC' },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
      ...(options.defaults === undefined ? {} : { cardDefaults: options.defaults }),
    },
  }
  const createTaskConfirmed = vi.fn(async () => ({ id: 'created' } as TaskRecord))
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    createTaskConfirmed,
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
      <NewTaskModal
        controller={controller}
        onClose={() => {}}
        {...(options.initialTask === undefined ? {} : { initialTask: options.initialTask })}
        {...(options.parentTask === undefined ? {} : { parentTask: options.parentTask })}
      />,
    )
  })
  openFormSection(container, t('new.section.execution'))
  return { container, createTaskConfirmed }
}

/** One execution-target select, found by the label copy its field renders. */
function executionSelect(container: HTMLElement, label: string): HTMLSelectElement {
  const field = [...container.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === label)
  const select = field?.querySelector('select')
  if (select === undefined || select === null) throw new Error(`no select labelled ${label}`)
  return select
}

/** Pick a select's value the way a user does. */
function chooseOption(container: HTMLElement, label: string, value: string): void {
  const select = executionSelect(container, label)
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Submit the dialog's plain create action and read the payload it sent. */
async function submit(container: HTMLElement, createTaskConfirmed: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
  const form = container.querySelector('form')
  if (form === null) throw new Error('no dialog form')
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  return createTaskConfirmed.mock.calls[0]![0] as Record<string, unknown>
}

describe('create-task dialog prefills from the new-card defaults', () => {
  it('user opening the dialog on a configured board sees all four defaults preselected and created', async () => {
    // Given a board that defaults every execution target of a new card
    const { container, createTaskConfirmed } = renderDialog({
      defaults: { mode: 'ptc', permission: 'workspace-write', model: 'alpha/fast', reasoningEffort: 'high' },
    })

    // When the user creates the card without touching the pickers
    const payload = await submit(container, createTaskConfirmed)

    // Then the dialog opened on the configured values and the created card
    // pins exactly them: the default is a prefill the card stores.
    expect(payload.mode).toBe('ptc')
    expect(payload.permission).toBe('workspace-write')
    expect(payload.model).toBe('alpha/fast')
    expect(payload.reasoningEffort).toBe('high')
  })

  it('user opening the dialog on an unconfigured board sees the pickers unpinned and creates an unpinned card', async () => {
    // Given a board that configures no new-card default
    const { container, createTaskConfirmed } = renderDialog()

    // When the user creates the card right away
    const payload = await submit(container, createTaskConfirmed)

    // Then the dialog showed the inherit/default choices of every picker and
    // the create carries nothing for them: an unconfigured board behaves
    // exactly as it did before this feature existed.
    expect(executionSelect(container, t('new.agentPreset')).value).toBe('')
    expect(executionSelect(container, t('new.permission')).value).toBe('')
    expect(executionSelect(container, t('new.model')).value).toBe('')
    expect(executionSelect(container, t('exec.reasoning')).value).toBe('')
    for (const field of ['mode', 'permission', 'model', 'reasoningEffort']) {
      expect(Object.hasOwn(payload, field)).toBe(false)
    }
  })

  it('user creating a subtask sees the parent pins kept and the parent permission never carried', async () => {
    // Given a parent card pinned to one preset/model pair and an elevated
    // permission, beside a board that configures different defaults
    const parent = {
      id: 'parent',
      title: 'Parent',
      mode: 'minimal',
      permission: 'danger-full-access',
      model: 'alpha/fast',
      reasoningEffort: 'high',
    } as unknown as TaskRecord
    const { container, createTaskConfirmed } = renderDialog({
      defaults: { mode: 'ptc', permission: 'read-only', model: 'beta/plain', reasoningEffort: 'low' },
      parentTask: parent,
    })

    // When the user creates a subtask without touching the pickers
    const payload = await submit(container, createTaskConfirmed)

    // Then the subtask keeps the parent's own pins, while its permission comes
    // from the board default instead: a parent's binding is resolved along the
    // ancestor chain at launch and is never copied onto a new card.
    expect(payload.mode).toBe('minimal')
    expect(payload.permission).toBe('read-only')
    expect(payload.model).toBe('alpha/fast')
    expect(payload.reasoningEffort).toBe('high')
    expect(payload.parentId).toBe('parent')
  })

  it('user duplicating a card sees the source pins kept and the defaults fill only what it left unset', async () => {
    // Given a source card that pinned its own permission and model/level pair
    // but no agent preset, beside a board that defaults a different model
    const source = {
      id: 'source',
      title: 'Source',
      permission: 'workspace-write',
      model: 'alpha/fast',
      reasoningEffort: 'high',
    } as unknown as TaskRecord
    const { container, createTaskConfirmed } = renderDialog({
      defaults: { mode: 'ptc', permission: 'read-only', model: 'beta/plain', reasoningEffort: 'low' },
      initialTask: source,
    })

    // When the user duplicates it without touching the pickers
    const payload = await submit(container, createTaskConfirmed)

    // Then the copy keeps every pin the source had, the default preset fills
    // the one field the source left unset, and the default level stays inert:
    // it is bound to the default model, which this card is not on.
    expect(payload.mode).toBe('ptc')
    expect(payload.permission).toBe('workspace-write')
    expect(payload.model).toBe('alpha/fast')
    expect(payload.reasoningEffort).toBe('high')
  })

  it('user clearing a prefilled picker sees that target left out of the create payload', async () => {
    // Given a board that defaults all four targets
    const { container, createTaskConfirmed } = renderDialog({
      defaults: { mode: 'ptc', permission: 'workspace-write', model: 'alpha/fast', reasoningEffort: 'high' },
    })

    // When the user clears the preset picker back to "inherit" and creates
    chooseOption(container, t('new.agentPreset'), '')
    const payload = await submit(container, createTaskConfirmed)

    // Then the cleared target is absent from the create rather than sent empty,
    // so the new card really pins nothing there and inherits again at run time,
    // while the targets left alone keep their prefilled values.
    expect(Object.hasOwn(payload, 'mode')).toBe(false)
    expect(payload.permission).toBe('workspace-write')
    expect(payload.model).toBe('alpha/fast')
  })

  it('user switching the model to one that cannot honour the level sees the level dropped too', async () => {
    // Given a board that defaults a model with declared levels
    const { container, createTaskConfirmed } = renderDialog({
      defaults: { model: 'alpha/fast', reasoningEffort: 'high' },
    })

    // When the user switches the model to a route that declares no level
    chooseOption(container, t('new.model'), 'beta/plain')
    const payload = await submit(container, createTaskConfirmed)

    // Then the level is gone with the model it belonged to and the create
    // carries only the route the user picked.
    expect(executionSelect(container, t('exec.reasoning')).value).toBe('')
    expect(payload.model).toBe('beta/plain')
    expect(Object.hasOwn(payload, 'reasoningEffort')).toBe(false)
  })
})
