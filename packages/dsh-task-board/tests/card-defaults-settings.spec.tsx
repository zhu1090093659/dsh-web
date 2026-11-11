// @vitest-environment jsdom
/**
 * The settings card's new-card-defaults topic: the four prefills an operator
 * configures for cards created afterwards, the roster and model catalog behind
 * them, and what the card's one save commits.
 *
 * These cases drive the real card controller over a settings-form double and
 * render the shipped card component through the selector hook the plugin slot
 * synthesizes, so what they observe is the shipped staging rule and the
 * shipped field wiring rather than a re-implementation.
 *
 * The body carries the appearance-skin marker on purpose: with a skin active
 * the shared select control renders the native branch a skin-active GUI takes,
 * which lets these cases drive every field with a real change event instead of
 * poking at presentation state.
 */
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TaskBoardSettingsCard,
  TaskBoardSettingsCardController,
  type TaskBoardSettingsCardProps,
  type TaskBoardSettingsCardState,
} from '../src/client/TaskBoardSettingsCard.tsx'
import type { ExecutionPresetOption } from '../src/core/controller.ts'
import { t } from '../src/client/locales.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

/** The host event channel the card subscribes to while mounted; no frame is pushed here. */
class StubEventSource {
  onmessage: ((message: MessageEvent<string>) => void) | null = null
  close(): void {}
}

/**
 * The model catalog the card reads through `api/task-board/model-catalog`:
 * one provider whose model declares two levels, one model declaring a single
 * level, and one model declaring none at all.
 */
const VERIFICATION = {
  catalog: {
    default: { provider: 'alpha', model: 'fast' },
    groups: [
      {
        id: 'alpha',
        models: [
          { id: 'fast', name: 'Fast', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' } },
          { id: 'smart', name: 'Smart', reasoning: { efforts: [{ id: 'high' }] } },
        ],
      },
      { id: 'beta', models: [{ id: 'plain', name: 'Plain' }] },
    ],
  },
}

/** The deployment roster: a default preset a run lands on, plus a user preset. */
const ROSTER: ExecutionPresetOption[] = [
  { id: 'standard', isDefault: true },
  { id: 'ptc', isDefault: false },
  { id: 'dispatch', name: 'Dispatch', isDefault: false },
]

/** The global faces this file replaces for the card's own reads. */
const globalWithFaces = globalThis as { EventSource?: unknown; fetch?: unknown }

beforeEach(() => {
  document.documentElement.lang = 'zh'
  // An appearance skin is active: the shipped selects render their native branch.
  document.body.dataset.dshSkin = 'test-skin'
  globalWithFaces.EventSource = StubEventSource
  globalWithFaces.fetch = async () => ({ ok: true, json: async () => VERIFICATION })
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  delete document.body.dataset.dshSkin
  delete globalWithFaces.EventSource
  delete globalWithFaces.fetch
})

type Op = { op: 'set' | 'unset'; path: string[]; value?: unknown }

/** A settings-form double that applies the batches the card commits. */
function settingsForm(initial: Record<string, unknown>) {
  const user: Record<string, unknown> = { ...initial }
  const ops: Op[] = []
  const form = {
    entryId: 'task-board',
    getSnapshot: () => ({
      status: 'ready' as const,
      value: { ...user },
      base: undefined,
      user: { ...user },
      revision: 1,
      writable: true as const,
    }),
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
    mutate: async (batch: Op[]) => {
      ops.push(...batch)
      for (const op of batch) {
        if (op.op === 'set') user[op.path[0]!] = op.value
        else delete user[op.path[0]!]
      }
      return true
    },
  }
  return { form, ops, user }
}

interface CardHarness {
  container: HTMLElement
  ops: Op[]
  user: Record<string, unknown>
  controller: TaskBoardSettingsCardController
}

/**
 * Mount the shipped card over a live controller: the slot's selector hook is
 * bound to the controller's own store, so a staged edit re-renders the card the
 * way it does in the GUI.
 * @param options - the stored settings and the roster the deployment serves.
 * @returns the rendered container and the committed batches.
 */
async function renderCard(options: { stored?: Record<string, unknown>; presets?: readonly ExecutionPresetOption[] } = {}): Promise<CardHarness> {
  const target = settingsForm(options.stored ?? { enabled: true })
  const controller = new TaskBoardSettingsCardController(target.form as never, async () => false)
  if (options.presets !== undefined) controller.setPresetRoster(options.presets)
  const face = controller.inject()
  const store = face.hooks.taskBoardSettingsCard
  function Bound() {
    const [state, setState] = useState<TaskBoardSettingsCardState>(() => store.getSnapshot())
    useEffect(() => store.subscribe(() => { setState(store.getSnapshot()) }), [])
    const props = {
      t,
      renderSlot: () => undefined,
      dispatch: async () => false,
      useTaskBoardSettingsCard: (select: (snapshot: TaskBoardSettingsCardState) => unknown) => select(state),
      edit: face.edit,
      resetField: face.resetField,
      save: face.save,
      discard: face.discard,
    } as unknown as TaskBoardSettingsCardProps
    return <TaskBoardSettingsCard {...props} />
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<Bound />)
    // Let the card's catalog fetch settle, as it does after mount.
    for (let round = 0; round < 5; round += 1) await Promise.resolve()
  })
  return { container, ops: target.ops, user: target.user, controller }
}

/** The disclosure header carrying one localized title. */
function header(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
    .find(button => button.textContent?.startsWith(label) === true)
  if (found === undefined) throw new Error(`the "${label}" disclosure header did not render`)
  return found
}

/** Open the settings card and its new-card-defaults topic, as an operator does. */
function openDefaultsTopic(container: HTMLElement): void {
  act(() => { header(container, t('settings.title')).click() })
  act(() => { header(container, t('settings.cardDefaultsTitle')).click() })
}

const MODE_FIELD = 'settings-task-board-card-default-mode'
const PERMISSION_FIELD = 'settings-task-board-card-default-permission'
const MODEL_FIELD = 'settings-task-board-card-default-model'
const EFFORT_FIELD = 'settings-task-board-card-default-effort'

/** One staged field's select as the skin-active branch renders it. */
function field(container: HTMLElement, id: string): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(`select#${id}`)
  if (select === null) throw new Error(`no select field ${id}`)
  return select
}

/** The option values one field offers, in render order. */
function optionValues(container: HTMLElement, id: string): string[] {
  return [...field(container, id).options].map(option => option.value)
}

/** Pick a field's value the way an operator does. */
function chooseOption(container: HTMLElement, id: string, value: string): void {
  const select = field(container, id)
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Save through the card's own form, as its one footer button does. */
async function save(controller: TaskBoardSettingsCardController): Promise<void> {
  await act(async () => {
    await (controller as unknown as { form: { save(): Promise<void> } }).form.save()
  })
}

describe('task-board settings: new-card defaults of the create dialog', () => {
  it('operator saving the four prefills sees them committed in one batch', async () => {
    // Given a board that configures no new-card default at all
    const { container, ops, controller } = await renderCard({ presets: ROSTER })
    openDefaultsTopic(container)

    // When the operator picks one value in each of the four fields and saves
    chooseOption(container, MODE_FIELD, 'ptc')
    chooseOption(container, PERMISSION_FIELD, 'workspace-write')
    chooseOption(container, MODEL_FIELD, 'alpha/fast')
    chooseOption(container, EFFORT_FIELD, 'high')
    await save(controller)

    // Then one batch carries all four as written values
    expect(ops).toEqual([
      { op: 'set', path: ['cardDefaultMode'], value: 'ptc' },
      { op: 'set', path: ['cardDefaultPermission'], value: 'workspace-write' },
      { op: 'set', path: ['cardDefaultModel'], value: 'alpha/fast' },
      { op: 'set', path: ['cardDefaultReasoningEffort'], value: 'high' },
    ])
  })

  it('operator blanking a configured prefill sees it cleared rather than stored blank', async () => {
    // Given a board whose four defaults are configured
    const { container, ops, user, controller } = await renderCard({
      stored: {
        enabled: true,
        cardDefaultMode: 'ptc',
        cardDefaultPermission: 'read-only',
        cardDefaultModel: 'alpha/fast',
        cardDefaultReasoningEffort: 'high',
      },
      presets: ROSTER,
    })
    openDefaultsTopic(container)

    // When the operator picks the "apply no default" choice of each field and saves
    chooseOption(container, MODE_FIELD, '')
    chooseOption(container, PERMISSION_FIELD, '')
    chooseOption(container, MODEL_FIELD, '')
    chooseOption(container, EFFORT_FIELD, '')
    await save(controller)

    // Then every field is unset in the user layer: "unconfigured" and "blank"
    // are the same state, and nothing stores an empty string that would read as
    // a pin.
    expect(ops).toEqual([
      { op: 'unset', path: ['cardDefaultMode'] },
      { op: 'unset', path: ['cardDefaultPermission'] },
      { op: 'unset', path: ['cardDefaultModel'] },
      { op: 'unset', path: ['cardDefaultReasoningEffort'] },
    ])
    expect(user.cardDefaultMode).toBeUndefined()
    expect(user.cardDefaultModel).toBeUndefined()
  })

  it('operator typing a permission outside the three sandbox modes sees the save blocked', async () => {
    // Given the open topic of a board whose defaults are unconfigured
    const { container, ops, controller } = await renderCard({ presets: ROSTER })
    openDefaultsTopic(container)

    // When the operator stages a value no execution can be composed with
    act(() => { controller.inject().edit('cardDefaultPermission', 'god-mode') })
    await save(controller)

    // Then nothing is written and the card reports the draft as blocking, so a
    // value the Host would refuse never reaches the document.
    expect(ops).toEqual([])
    expect(controller.inject().hooks.taskBoardSettingsCard.getSnapshot().invalid).toBe(true)
  })

  it('operator typing a default model that is not a provider/model route sees the save blocked', async () => {
    // Given the open topic of a board whose defaults are unconfigured
    const { container, ops, controller } = await renderCard({ presets: ROSTER })
    openDefaultsTopic(container)

    // When the operator stages a bare model id
    act(() => { controller.inject().edit('cardDefaultModel', 'fast') })
    await save(controller)

    // Then nothing is written: only a qualified route is a value an execution
    // can pin, and the card says so instead of storing an unresolvable one.
    expect(ops).toEqual([])
    expect(controller.inject().hooks.taskBoardSettingsCard.getSnapshot().invalid).toBe(true)
  })

  it('operator reading the default-preset field sees the deployment roster and a broken preset unselectable', async () => {
    // Given a roster whose user preset cannot compose a session
    const { container } = await renderCard({
      presets: [...ROSTER, { id: 'legacy', name: 'Legacy', broken: 'no provider', isDefault: false }],
    })
    openDefaultsTopic(container)

    // When the operator reads the field
    const select = field(container, MODE_FIELD)

    // Then the inherit choice names the preset a card without a pin lands on,
    // and the broken preset is listed but cannot be picked: it is neither
    // silently dropped nor storable as a default.
    expect(select.options[0]!.value).toBe('')
    expect(select.options[0]!.textContent).toBe(t('exec.mode.inheritWith', { preset: t('preset.builtin.standard') }))
    const legacy = [...select.options].find(option => option.value === 'legacy')!
    expect(legacy.disabled).toBe(true)
    expect(legacy.textContent).toBe(`Legacy${t('exec.mode.brokenSuffix')}`)
  })

  it('operator whose deployment serves no preset roster sees only the inherit choice and can still save', async () => {
    // Given a card whose roster read never answered, with a stored default preset
    const { container, ops, user, controller } = await renderCard({
      stored: { enabled: true, cardDefaultMode: 'ptc', cardDefaultPermission: 'read-only' },
    })
    openDefaultsTopic(container)

    // When the operator opens the topic and saves another change
    expect(optionValues(container, MODE_FIELD)).toEqual([''])
    chooseOption(container, PERMISSION_FIELD, 'workspace-write')
    await save(controller)

    // Then the missing roster neither reports an error nor blocks the save: the
    // untouched preset keeps its stored value and the edit lands.
    expect(ops).toEqual([{ op: 'set', path: ['cardDefaultPermission'], value: 'workspace-write' }])
    expect(user.cardDefaultMode).toBe('ptc')
  })

  it('operator setting no default model sees the reasoning selector locked to the inherit choice', async () => {
    // Given the open topic of a board whose default model is unconfigured
    const { container } = await renderCard({ presets: ROSTER })
    openDefaultsTopic(container)

    // When the operator reads the reasoning field
    const effort = field(container, EFFORT_FIELD)

    // Then it offers nothing but "follow the model/Host default" and explains
    // why, because the level belongs to a model route that is not pinned yet.
    expect([...effort.options].map(option => option.value)).toEqual([''])
    expect(effort.disabled).toBe(true)
    expect(container.textContent).toContain(t('exec.reasoning.hint.pickModel'))
  })

  it('operator defaulting to a model without declared levels sees the reasoning selector locked', async () => {
    // Given the open topic of a board whose defaults are unconfigured
    const { container } = await renderCard({ presets: ROSTER })
    openDefaultsTopic(container)

    // When the operator defaults to a model that declares no level
    chooseOption(container, MODEL_FIELD, 'beta/plain')

    // Then the levels on offer stay empty and the field explains that this
    // model always follows its own default.
    const effort = field(container, EFFORT_FIELD)
    expect([...effort.options].map(option => option.value)).toEqual([''])
    expect(effort.disabled).toBe(true)
    expect(container.textContent).toContain(t('exec.reasoning.hint.noEfforts'))
  })

  it('operator defaulting to a model that declares levels sees the reasoning selector offer exactly those', async () => {
    // Given the open topic of a board whose defaults are unconfigured
    const { container } = await renderCard({ presets: ROSTER })
    openDefaultsTopic(container)

    // When the operator defaults to a model that declares two levels
    chooseOption(container, MODEL_FIELD, 'alpha/fast')

    // Then the field offers those two and nothing else
    const effort = field(container, EFFORT_FIELD)
    expect([...effort.options].map(option => option.value)).toEqual(['', 'low', 'high'])
    expect(effort.disabled).toBe(false)
    // And every model row names the provider beside the model, so two
    // providers offering the same model name stay distinguishable.
    expect([...field(container, MODEL_FIELD).options].map(option => option.textContent))
      .toEqual([t('exec.model.default'), 'Fast · alpha', 'Smart · alpha', 'Plain · beta'])
  })

  it('operator switching the default model to one that cannot honour the level sees the level dropped', async () => {
    // Given a board whose default model/level pair is configured
    const { container, ops, controller } = await renderCard({
      stored: { enabled: true, cardDefaultModel: 'alpha/fast', cardDefaultReasoningEffort: 'high' },
      presets: ROSTER,
    })
    openDefaultsTopic(container)
    expect(field(container, EFFORT_FIELD).value).toBe('high')

    // When the operator switches the default model to one that declares no levels
    chooseOption(container, MODEL_FIELD, 'beta/plain')
    await save(controller)

    // Then the stored level goes with the model it was chosen for, so the
    // document never holds a level its route would be refused over.
    expect(field(container, EFFORT_FIELD).value).toBe('')
    expect(ops).toEqual([
      { op: 'set', path: ['cardDefaultModel'], value: 'beta/plain' },
      { op: 'unset', path: ['cardDefaultReasoningEffort'] },
    ])
  })

  it('operator switching to another model that declares the stored level keeps it', async () => {
    // Given a board whose default model/level pair is configured
    const { container, ops, controller } = await renderCard({
      stored: { enabled: true, cardDefaultModel: 'alpha/fast', cardDefaultReasoningEffort: 'high' },
      presets: ROSTER,
    })
    openDefaultsTopic(container)

    // When the operator switches to a model that also declares that level
    chooseOption(container, MODEL_FIELD, 'alpha/smart')
    await save(controller)

    // Then only the model is written: a level the new route honours is not a
    // change, so switching models never clears a still-valid choice.
    expect(field(container, EFFORT_FIELD).value).toBe('high')
    expect(ops).toEqual([{ op: 'set', path: ['cardDefaultModel'], value: 'alpha/smart' }])
  })
})
