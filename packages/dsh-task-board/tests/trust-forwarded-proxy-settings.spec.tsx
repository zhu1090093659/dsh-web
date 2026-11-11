// @vitest-environment jsdom
/**
 * The forwarded-proxy trust switch in the settings card (issue #1918).
 *
 * A board reached through the operator's own reverse proxy or tunnel is refused
 * by the repository-wide fence (issue #1906) unless the operator says that hop
 * may speak for the browser. The switch is therefore a visible control on the
 * board topic, and a save writes it into the volatile schema field the Host
 * fence reads per request.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TaskBoardSettingsCard,
  TaskBoardSettingsCardController,
  type TaskBoardSettingsCardProps,
  type TaskBoardSettingsCardState,
} from '../src/client/TaskBoardSettingsCard.tsx'
import { zh } from '../src/client/locales.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

/**
 * The host event channel the mounted card subscribes to for power frames.
 * Neither Node nor jsdom serves an EventSource, so a seat that records its own
 * close is enough here.
 */
class StubEventSource {
  onmessage: ((message: MessageEvent<string>) => void) | null = null
  closed = false
  close(): void { this.closed = true }
}

const globalWithEventSource = globalThis as { EventSource?: unknown }

beforeEach(() => {
  document.documentElement.lang = 'zh'
  globalWithEventSource.EventSource = StubEventSource
})

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
  delete globalWithEventSource.EventSource
})

/**
 * One complete, writable card snapshot with no staged edits.
 * @param trustForwardedProxy - stored value of the forwarded-proxy switch.
 * @returns the snapshot the card renders.
 */
function cardState(trustForwardedProxy = ''): TaskBoardSettingsCardState {
  const field = { text: '', overridden: false, invalid: false }
  return {
    available: true,
    exposed: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    enabled: { ...field, text: 'true' },
    announceToAgent: field,
    preventIdleSleep: field,
    trustForwardedProxy: { ...field, text: trustForwardedProxy },
    maxSubtaskDepth: field,
    sessionPollSeconds: field,
    runLaunchWidth: field,
    spendBudgetTokens: { ...field, text: '0' },
    cardDefaultMode: field,
    cardDefaultPermission: field,
    cardDefaultModel: field,
    cardDefaultReasoningEffort: field,
  }
}

/** Render-ready props for the card: a fixed snapshot and an inert form. */
function cardProps(trustForwardedProxy = ''): TaskBoardSettingsCardProps {
  const state = cardState(trustForwardedProxy)
  return {
    t: (key: string) => (zh as Record<string, string>)[key] ?? key,
    renderSlot: () => undefined,
    dispatch: async () => false,
    useTaskBoardSettingsCard: (select: (snapshot: TaskBoardSettingsCardState) => unknown) => select(state),
    edit: () => {},
    resetField: () => {},
    save: () => {},
    discard: () => {},
  } as unknown as TaskBoardSettingsCardProps
}

/**
 * Render the card into a fresh container.
 * @param props - the card props.
 * @returns the container holding the rendered card.
 */
function render(props: TaskBoardSettingsCardProps): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<TaskBoardSettingsCard {...props} />) })
  return container
}

/**
 * The disclosure header whose text starts with this copy line.
 * @param container - the rendered card.
 * @param label - the card or topic title it must start with.
 * @returns the disclosure button.
 */
function header(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button[aria-expanded]'))
    .find(button => button.textContent?.startsWith(label) === true)
  if (found === undefined) throw new Error(`the "${label}" disclosure header did not render`)
  return found as HTMLButtonElement
}

/** One staged write the card commits as a batch. */
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

/**
 * Save through the card's own form, as its one footer button does.
 * @param controller - the card controller under test.
 */
async function save(controller: TaskBoardSettingsCardController): Promise<void> {
  await (controller as unknown as { form: { save(): Promise<void> } }).form.save()
}

describe('task-board settings: the forwarded-proxy trust switch', () => {
  it('operator expanding the board topic finds the forwarded-proxy switch with its warning hint', () => {
    // Given the settings card of a board that never configured the switch
    const container = render(cardProps())
    act(() => { header(container, zh['settings.title']).click() })

    // When the operator opens the board topic
    act(() => { header(container, zh['settings.enabledTopic']).click() })

    // Then the switch is a real control on that topic, resting on the inherit
    // choice and carrying one visible line on when turning it on is justified,
    // while the full warning stays on its hover title
    const control = container.querySelector('#settings-task-board-trust-forwarded-proxy')
    expect(control?.querySelector('[aria-pressed="true"]')?.textContent).toBe(zh['settings.inherit'])
    expect(control?.getAttribute('aria-label')).toBe(zh['settings.trustForwardedProxy'])
    expect(container.textContent).toContain(zh['settings.trustForwardedProxyHintBrief'])
    expect([...container.querySelectorAll('p[title]')].map(node => node.getAttribute('title')))
      .toContain(zh['settings.trustForwardedProxyHint'])
    expect(zh['settings.trustForwardedProxyHint']).toContain('127.0.0.1')
  })

  it('operator sees the stored switch value and the off default reflected in the card', () => {
    // Given a board whose switch was turned on
    const container = render(cardProps('true'))
    act(() => { header(container, zh['settings.title']).click() })

    // When the operator opens the board topic
    act(() => { header(container, zh['settings.enabledTopic']).click() })

    // Then the control shows the stored value instead of the inherit choice
    expect(container.querySelector('#settings-task-board-trust-forwarded-proxy [aria-pressed="true"]')?.textContent).toBe(zh['settings.on'])
  })

  it('operator turning the switch on sees it committed into the volatile field alone', async () => {
    // Given a board whose switch is unset, so the schema default (off) applies
    const target = settingsForm({ enabled: true, preventIdleSleep: false })
    const controller = new TaskBoardSettingsCardController(target.form as never, async () => false)
    expect(controller.inject().hooks.taskBoardSettingsCard.getSnapshot().trustForwardedProxy)
      .toEqual({ text: '', overridden: false, invalid: false })

    // When the operator turns only that switch on and saves
    controller.inject().edit('trustForwardedProxy', 'true')
    await save(controller)

    // Then the committed batch carries that one field as a boolean, which is
    // what the Host writes into the schema-volatile config the fence reads
    expect(target.ops).toEqual([{ op: 'set', path: ['trustForwardedProxy'], value: true }])
    expect(target.user.trustForwardedProxy).toBe(true)
    expect(target.user.preventIdleSleep).toBe(false)
    controller.dispose()
  })

  it('operator turning the switch back off sees an explicit false stored rather than the field left ambiguous', async () => {
    // Given the card whose switch was turned on
    const target = settingsForm({ enabled: true, trustForwardedProxy: true })
    const controller = new TaskBoardSettingsCardController(target.form as never, async () => false)

    // When the operator turns it off and saves
    controller.inject().edit('trustForwardedProxy', 'false')
    await save(controller)

    // Then the stored value is false, so the board returns to the #1906 refusal
    expect(target.ops).toEqual([{ op: 'set', path: ['trustForwardedProxy'], value: false }])
    expect(target.user.trustForwardedProxy).toBe(false)
    controller.dispose()
  })
})
