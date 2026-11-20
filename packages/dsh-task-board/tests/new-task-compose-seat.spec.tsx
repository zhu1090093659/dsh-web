// @vitest-environment jsdom
/**
 * A provider's own new-card rows: where the board paints them in the create
 * dialog, and where the draft they report ends up.
 *
 * The decision under test: a provider registers its create-time configuration
 * into `task-board.compose.section`, the dialog renders it inside the run-mode
 * region it already has — after the session-reuse switch, and only while that
 * region is expanded — and the draft the provider reports is written into the
 * created card's `integrations` under the provider's own id. A provider that
 * reports nothing, reports something the board cannot store, or throws while
 * rendering neither blocks the create nor changes the card beyond its own
 * missing entry.
 */
import { act, useEffect, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewTaskModal } from '../src/client/board/NewTaskModal.tsx'
import { t } from '../src/client/locales.ts'
import {
  EMPTY_TASK_BOARD_SEATS,
  seatsFromRenderSlot,
  TaskBoardSeatsProvider,
  type TaskBoardSeats,
} from '../src/client/seats.tsx'
import {
  TASK_BOARD_PAYLOAD_LIMIT_BYTES,
  type TaskBoardComposeSectionProps,
  type TaskBoardExtensionPayload,
} from '../src/core/extension.ts'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import type { NewTaskInput, TaskRecord } from '../src/core/tasks.ts'
import { openFormSection } from './form-sections.ts'
import css from '../src/client/board.module.css'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  window.localStorage.clear()
})

/** The Host-confirmed task; the dialog only reads its id back. */
const created = { id: 'task-new' } as TaskRecord

/** One row of the compose seat, taking the props the seat hands every provider. */
type ComposeRow = (props: TaskBoardComposeSectionProps) => ReactNode

/** A board state the create dialog can open on. */
function snapshot(): ControllerSnapshot {
  return {
    tasks: [],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: undefined,
    executionOptions: { workspaces: [], presets: [], models: [] },
    pendingTaskIds: [],
    host: {
      revision: 1,
      scheduler: { timeZone: 'UTC' },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
    },
  }
}

interface RenderedModal {
  container: HTMLElement
  createTaskConfirmed: ReturnType<typeof vi.fn<(input: NewTaskInput) => Promise<TaskRecord>>>
  onClose: ReturnType<typeof vi.fn>
}

/**
 * Render the create dialog over one seat set.
 * @param seats - the provider seat set above the dialog (absent for a page no
 * provider registered into at all).
 * @returns the rendered tree and the create face the dialog drives.
 */
function renderModal(seats?: TaskBoardSeats): RenderedModal {
  const createTaskConfirmed = vi.fn(async (_input: NewTaskInput) => created)
  const onClose = vi.fn()
  const controller = {
    getSnapshot: snapshot,
    subscribe: () => () => {},
    createTaskConfirmed,
    runTask: vi.fn(async () => true),
    openTask: vi.fn(),
  } as unknown as BoardController
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const modal = <NewTaskModal controller={controller} onClose={onClose} />
  act(() => {
    root.render(seats === undefined ? modal : <TaskBoardSeatsProvider value={seats}>{modal}</TaskBoardSeatsProvider>)
  })
  return { container, createTaskConfirmed, onClose }
}

/** A seat set whose compose seat paints exactly the rows the test hands in. */
function seatsOf(...rows: readonly ComposeRow[]): TaskBoardSeats {
  return {
    ...EMPTY_TASK_BOARD_SEATS,
    composeSection: props => (
      <>
        {rows.map((Row, index) => <Row key={index} {...props} />)}
      </>
    ),
  }
}

/** A provider row that reports one draft for its own id, as a provider publishing its current choice does. */
function ReportingRow({ id, draft, label, contribute }: TaskBoardComposeSectionProps & {
  id: string
  draft: TaskBoardExtensionPayload
  label: string
}): ReactNode {
  useEffect(() => { contribute(id, draft) }, [contribute, id, draft])
  return <p data-provider={id}>{label}</p>
}

/** A provider row whose draft follows a switch the user clears. */
function ClearingRow({ id, draft, label, contribute }: TaskBoardComposeSectionProps & {
  id: string
  draft: TaskBoardExtensionPayload
  label: string
}): ReactNode {
  const [picked, setPicked] = useState(true)
  useEffect(() => { contribute(id, picked ? draft : undefined) }, [contribute, id, draft, picked])
  return (
    <label data-provider={id}>
      <input type="checkbox" checked={picked} onChange={event => { setPicked(event.target.checked) }} />
      <span>{label}</span>
    </label>
  )
}

/** Expand the run-mode region and answer its body: the only place a provider row may land. */
function runRegionBody(container: HTMLElement): HTMLElement {
  const header = openFormSection(container, t('new.section.run'))
  const body = header.parentElement?.querySelector('.' + css.formSectionBody)
  if (body === null || body === undefined) throw new Error('no run-mode region body in the create dialog')
  return body as HTMLElement
}

/** The run-mode region's own session-reuse switch. */
function reuseSwitch(body: HTMLElement): HTMLElement {
  const label = [...body.querySelectorAll('label')]
    .find(node => node.textContent?.includes(t('exec.reuseSession')))
  if (label === undefined) throw new Error('no session-reuse switch in the run-mode region')
  return label
}

/** Whether one node reads after another in the document. */
function readsAfter(node: Node, earlier: Node): boolean {
  return (earlier.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

/** Submit the dialog as a user does and answer the create input the Host was handed. */
async function submitAndReadInput(modal: RenderedModal): Promise<NewTaskInput> {
  const form = modal.container.querySelector('form')
  if (form === null) throw new Error('no create-dialog form')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  const input = modal.createTaskConfirmed.mock.calls[0]?.[0]
  if (input === undefined) throw new Error('the create dialog created no task')
  return input
}

describe('new-card provider seat', () => {
  it('user creating a card where no provider registered gets the input the dialog always sent', async () => {
    // Given a dialog whose compose seat answers with nothing, the way a page no
    // provider registered into does
    const modal = renderModal(seatsFromRenderSlot(() => null))
    runRegionBody(modal.container)

    // When the user submits the dialog
    const input = await submitAndReadInput(modal)

    // Then the create input carries no integrations key, and the run region
    // gained no wrapper for a seat nobody filled
    expect('integrations' in input).toBe(false)
    expect(runRegionBody(modal.container).querySelector('div')).toBeNull()
  })

  it('user picking a target in a provider row creates the card carrying that provider draft', async () => {
    // Given a dialog whose provider reports the target it picked, under its own id
    const modal = renderModal(seatsOf(
      props => <ReportingRow {...props} id="alpha" draft={{ host: 'alpha-host' }} label="alpha target" />,
    ))
    runRegionBody(modal.container)

    // When the user submits the dialog
    const input = await submitAndReadInput(modal)

    // Then the created card carries that draft under that provider's id
    expect(input.integrations).toEqual({ alpha: { host: 'alpha-host' } })
  })

  it('user with two providers gets one entry per provider under its own id', async () => {
    // Given a dialog with two providers, each reporting its own draft
    const modal = renderModal(seatsOf(
      props => <ReportingRow {...props} id="alpha" draft={{ host: 'alpha-host' }} label="alpha target" />,
      props => <ReportingRow {...props} id="beta" draft={{ level: 2 }} label="beta target" />,
    ))
    runRegionBody(modal.container)

    // When the user submits the dialog
    const input = await submitAndReadInput(modal)

    // Then both drafts reach the create input, neither overwriting the other
    expect(input.integrations).toEqual({ alpha: { host: 'alpha-host' }, beta: { level: 2 } })
  })

  it('user clearing one provider switch creates the card without that provider entry', async () => {
    // Given two providers, the first of which withdraws its draft once the user
    // clears its switch
    const modal = renderModal(seatsOf(
      props => <ClearingRow {...props} id="alpha" draft={{ host: 'alpha-host' }} label="alpha target" />,
      props => <ReportingRow {...props} id="beta" draft={{ level: 2 }} label="beta target" />,
    ))
    const body = runRegionBody(modal.container)
    const toggle = body.querySelector<HTMLInputElement>('[data-provider="alpha"] input')
    if (toggle === null) throw new Error('no switch on the alpha provider row')

    // When the user clears that switch and submits the dialog
    act(() => { toggle.click() })
    const input = await submitAndReadInput(modal)

    // Then only the provider that still holds a draft contributes an entry
    expect(input.integrations).toEqual({ beta: { level: 2 } })
  })

  it('user clearing the only provider switch creates the card with no integrations key', async () => {
    // Given a dialog whose one provider withdraws its draft when its switch is cleared
    const modal = renderModal(seatsOf(
      props => <ClearingRow {...props} id="alpha" draft={{ host: 'alpha-host' }} label="alpha target" />,
    ))
    const body = runRegionBody(modal.container)
    const toggle = body.querySelector<HTMLInputElement>('[data-provider="alpha"] input')
    if (toggle === null) throw new Error('no switch on the alpha provider row')

    // When the user clears it and submits the dialog
    act(() => { toggle.click() })
    const input = await submitAndReadInput(modal)

    // Then the card is created without any integrations key at all
    expect(modal.onClose).toHaveBeenCalledOnce()
    expect('integrations' in input).toBe(false)
  })

  it('user whose provider reports an unstorable draft still creates the card, without that entry', async () => {
    // Given one provider whose draft is far past the payload limit and one
    // whose draft the board can store
    const modal = renderModal(seatsOf(
      props => <ReportingRow {...props} id="alpha" draft={{ padding: 'x'.repeat(TASK_BOARD_PAYLOAD_LIMIT_BYTES) }} label="alpha target" />,
      props => <ReportingRow {...props} id="beta" draft={{ level: 2 }} label="beta target" />,
    ))
    runRegionBody(modal.container)

    // When the user submits the dialog
    const input = await submitAndReadInput(modal)

    // Then the card exists and keeps the entry the board could store, and only
    // that one
    expect(modal.onClose).toHaveBeenCalledOnce()
    expect(input.integrations).toEqual({ beta: { level: 2 } })
  })

  it('user with a provider that crashes while rendering still gets a usable dialog and a created card', async () => {
    // Given a dialog whose one provider throws as soon as it renders
    const modal = renderModal(seatsOf(() => {
      throw new Error('provider row exploded')
    }))

    // When the user expands the run region and submits the dialog
    const body = runRegionBody(modal.container)
    const input = await submitAndReadInput(modal)

    // Then the region keeps its own switch, and the card is created without the
    // crashed provider's entry
    expect(body.contains(reuseSwitch(body))).toBe(true)
    expect(modal.onClose).toHaveBeenCalledOnce()
    expect('integrations' in input).toBe(false)
  })

  it('user expanding the run region finds the provider rows inside it, after the session-reuse switch', () => {
    // Given a dialog with two providers, whose run region starts collapsed
    const modal = renderModal(seatsOf(
      props => <ReportingRow {...props} id="alpha" draft={{ host: 'alpha-host' }} label="alpha target" />,
      props => <ReportingRow {...props} id="beta" draft={{ level: 2 }} label="beta target" />,
    ))
    expect(modal.container.querySelector('[data-provider]')).toBeNull()

    // When the user expands the run region
    const body = runRegionBody(modal.container)

    // Then both rows read inside that region, after its own switch, in the
    // order the seat registered them
    const rows = [...body.querySelectorAll('[data-provider]')]
    expect(rows.map(row => row.getAttribute('data-provider'))).toEqual(['alpha', 'beta'])
    expect(readsAfter(rows[0] as Node, reuseSwitch(body))).toBe(true)
  })

  it('user submitting while a compose provider reports an incomplete draft is blocked instead of falling back locally', async () => {
    // Given a provider that reports a blocking error on its draft
    function Blocker({ contribute, submitAttempt }: TaskBoardComposeSectionProps): ReactNode {
      useEffect(() => {
        contribute('ssh', undefined, { summary: 'remote', error: 'remote path required' })
      }, [contribute])
      return <div data-provider="ssh" data-attempts={String(submitAttempt ?? 0)} />
    }
    const modal = renderModal(seatsOf(props => <Blocker {...props} />))
    runRegionBody(modal.container)
    // Collapse Run Mode before clicking create to verify the modal re-opens it and blocks submit
    const runHeader = [...modal.container.querySelectorAll('button')]
      .find(button => button.textContent?.includes(t('new.section.run')))
    if (runHeader === undefined) throw new Error('missing run-mode section toggle')
    act(() => { runHeader.click() })

    // When the user submits the form
    const form = modal.container.querySelector('form')
    if (form === null) throw new Error('no create-dialog form')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    // Then the modal did NOT create a local card and signaled the provider's submitAttempt
    expect(modal.createTaskConfirmed).not.toHaveBeenCalled()
    expect(modal.container.querySelector('[data-provider="ssh"]')?.getAttribute('data-attempts')).toBe('1')
  })
})
