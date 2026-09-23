// @vitest-environment jsdom
/**
 * "Parse pasted text" section of the new-task form (issue #1540): it appears
 * only where the deployment can parse, sends the pasted text plus the picked
 * model route to the Host, fills the three fields from the draft, and shows a
 * plain-language reason when the parse fails.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewTaskModal } from '../src/client/board/NewTaskModal.tsx'
import { t } from '../src/client/locales.ts'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  // The remembered parse model lives in localStorage; keep tests independent.
  window.localStorage.clear()
})

const draft = { title: 'Parsed title', description: 'Parsed description', prompt: 'Parsed prompt' }

function renderModal(options: { canParseTask?: boolean; parseTaskDraft?: unknown } = {}): {
  container: HTMLElement
  parseTaskDraft: ReturnType<typeof vi.fn>
} {
  const parseTaskDraft = (options.parseTaskDraft ?? vi.fn(async () => draft)) as ReturnType<typeof vi.fn>
  const snapshot: ControllerSnapshot = {
    tasks: [],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: undefined,
    executionOptions: {
      workspaces: [],
      presets: [],
      models: [{ id: 'deepseek/deepseek-chat', name: 'deepseek-chat' }],
    },
    pendingTaskIds: [],
    ...(options.canParseTask === false ? {} : { canParseTask: true }),
  }
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    createTaskConfirmed: vi.fn(),
    parseTaskDraft,
  } as unknown as BoardController
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<NewTaskModal controller={controller} onClose={() => undefined} />) })
  return { container, parseTaskDraft }
}

function field(container: HTMLElement, placeholder: string): HTMLInputElement | HTMLTextAreaElement {
  const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[placeholder="${placeholder}"]`)
  if (element === null) throw new Error(`no field with placeholder ${placeholder}`)
  return element
}

function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function chooseOption(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function parseButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(candidate => candidate.textContent === t('new.aiParseRun'))
  if (button === undefined) throw new Error('no parse button')
  return button as HTMLButtonElement
}

describe('new-task AI parse section (#1540)', () => {
  it('stays hidden when the deployment cannot parse', () => {
    const { container } = renderModal({ canParseTask: false })
    expect(container.querySelector('[data-dsh-part="ai-parse"]')).toBeNull()
  })

  it('sends the pasted text and the picked model, then fills the form', async () => {
    const { container, parseTaskDraft } = renderModal()
    const section = container.querySelector('[data-dsh-part="ai-parse"]')
    expect(section).not.toBeNull()
    // Issue #1621: with nothing remembered the picker starts on the Host
    // default, not on the roster's first entry.
    expect(section!.querySelector('select')!.value).toBe('')
    chooseOption(section!.querySelector('select')!, 'deepseek/deepseek-chat')
    expect(parseButton(container).disabled).toBe(true)

    typeInto(field(container, t('new.aiParsePlaceholder')), '  下周三前把报价发给张工  ')
    await act(async () => { parseButton(container).dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(parseTaskDraft).toHaveBeenCalledOnce()
    expect(parseTaskDraft.mock.calls[0]![0]).toEqual({ text: '下周三前把报价发给张工', model: 'deepseek/deepseek-chat' })
    expect(field(container, t('new.titlePlaceholder'))).toHaveProperty('value', draft.title)
    expect(field(container, t('new.descriptionPlaceholder'))).toHaveProperty('value', draft.description)
    expect(field(container, t('new.promptPlaceholder'))).toHaveProperty('value', draft.prompt)
  })

  it('shows the reason a parse failed', async () => {
    const { container } = renderModal({ parseTaskDraft: vi.fn(async () => { throw new Error('没有可用的模型') }) })
    typeInto(field(container, t('new.aiParsePlaceholder')), 'some note')
    await act(async () => { parseButton(container).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.querySelector('[data-dsh-part="ai-parse"]')!.textContent).toContain('没有可用的模型')
    // A failed parse never overwrites what the user already typed.
    expect(field(container, t('new.titlePlaceholder'))).toHaveProperty('value', '')
  })

  it('keeps already typed fields when the parse fails', async () => {
    const { container } = renderModal({ parseTaskDraft: vi.fn(async () => { throw new Error('boom') }) })
    typeInto(field(container, t('new.titlePlaceholder')), '手工写的标题')
    typeInto(field(container, t('new.aiParsePlaceholder')), 'some note')
    await act(async () => { parseButton(container).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(field(container, t('new.titlePlaceholder'))).toHaveProperty('value', '手工写的标题')
  })

  it('user sees the picker start from the model this browser used last (#1621)', () => {
    // Given this browser remembered the parse model deepseek/deepseek-chat
    window.localStorage.setItem('dsh-task-board.parse-model', 'deepseek/deepseek-chat')

    // When the new-task modal opens
    const { container } = renderModal()

    // Then the picker starts on the remembered model rather than the roster default
    expect(container.querySelector<HTMLSelectElement>('[data-dsh-part="ai-parse"] select')!.value).toBe('deepseek/deepseek-chat')
  })

  it('user sees a remembered model the roster dropped fall back to the default (#1621)', () => {
    // Given this browser remembered a model the deployment no longer offers
    window.localStorage.setItem('dsh-task-board.parse-model', 'vendor/gone')

    // When the new-task modal opens
    const { container } = renderModal()

    // Then the picker falls back to the Host default and forgets the stale model
    expect(container.querySelector<HTMLSelectElement>('[data-dsh-part="ai-parse"] select')!.value).toBe('')
    expect(window.localStorage.getItem('dsh-task-board.parse-model')).toBe('')
  })

  it('user sees the model picked for the next modal remembered (#1621)', () => {
    // Given an open new-task modal
    const { container } = renderModal()
    const select = container.querySelector<HTMLSelectElement>('[data-dsh-part="ai-parse"] select')!

    // When a model is picked
    chooseOption(select, 'deepseek/deepseek-chat')

    // Then it is remembered for the next modal
    expect(window.localStorage.getItem('dsh-task-board.parse-model')).toBe('deepseek/deepseek-chat')

    // And clearing the picker forgets it
    chooseOption(select, '')
    expect(window.localStorage.getItem('dsh-task-board.parse-model')).toBe('')
  })
})
