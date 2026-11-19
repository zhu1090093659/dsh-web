/** @vitest-environment jsdom */

/**
 * The task-detail seat and the card chip: what an untargeted card offers, how
 * the five run states differ in both places, and what the log, the follow-up box
 * and the workspace notices do.
 *
 * The card's payload is the only state the seats read besides the provider's
 * published summary, so each case hands the component what a host half would
 * have written and asserts what a reader sees — never an internal.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { SshCardDecoration } from '../src/client/ssh/card-decoration.tsx'
import { SshDetailSection } from '../src/client/ssh/detail-section.tsx'
import { acceptPublishedSummary, resetSummaryStore } from '../src/client/ssh/summary.ts'
import type { TaskBoardExtensionActionRequest } from '../src/core/contract.ts'
import type { TaskRecord } from '../src/core/task-record.ts'

beforeEach(() => { resetSummaryStore() })
afterEach(cleanup)

/** A card carrying whatever SSH payload the case needs. */
function card(parts?: Record<string, unknown>): TaskRecord {
  return {
    id: 'task-1',
    title: 'Ship it',
    description: '',
    prompt: 'do it',
    status: 'todo',
    createdAt: 1,
    updatedAt: 1,
    executions: [],
    ...(parts === undefined ? {} : { integrations: { ssh: { version: 1, updatedAt: 10, history: [], ...parts } } }),
  }
}

/** A pinned target on one host. */
const TARGET = { mode: 'direct', host: 'devbox', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/app' } }

/** One run record at a phase. */
function run(runId: string, phase: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { runId, phase, startedAt: 5, ...extra }
}

/** The board's action channel, recording every envelope it is handed. */
function board(): { calls: TaskBoardExtensionActionRequest[], dispatch: (request: TaskBoardExtensionActionRequest) => Promise<boolean> } {
  const calls: TaskBoardExtensionActionRequest[] = []
  return {
    calls,
    dispatch: async (request: TaskBoardExtensionActionRequest) => {
      calls.push(request)
      return true
    },
  }
}

/** Accept one client mirror frame, exactly as the board hands it over. */
function publishFrame(extensions: Record<string, unknown>): void {
  act(() => { acceptPublishedSummary(extensions) })
}

/** Publish a provider summary, as one mirror frame would. */
function publish(summary: Record<string, unknown>): void {
  publishFrame({ ssh: summary })
}

/** The log rows the section actually mounted, in reading order. */
function logRows(): Array<string | null> {
  return [...document.querySelectorAll('[data-dsh-part="log"] div[style*="height: 18px"]')].map(row => row.textContent)
}

/** Every paragraph the run section renders, in reading order. */
function sectionLines(): Array<string | null> {
  return [...document.querySelectorAll('[data-dsh-part="run"] p')].map(paragraph => paragraph.textContent)
}

describe('an untargeted card', () => {
  it('user opening an untargeted card gets the target entry only, and no chip on the card', () => {
    // Given a card with no SSH payload
    const task = card()
    const channel = board()

    // When the detail panel opens
    render(createElement(SshDetailSection, { task, dispatch: channel.dispatch }))

    // Then the section is the target entry: a named form, no run state, no log
    // and no cancel, and nothing was dispatched
    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('设置执行目标')
    expect(screen.getByLabelText('主机').tagName).toBe('SELECT')
    expect(screen.queryByText('待运行')).toBeNull()
    expect(screen.queryByRole('group', { name: '运行日志' })).toBeNull()
    expect(screen.queryByRole('button', { name: '取消执行' })).toBeNull()
    expect(channel.calls).toEqual([])

    // And the card itself carries no chip at all
    cleanup()
    const badge = render(createElement(SshCardDecoration, { task }))
    expect(badge.container.firstChild).toBeNull()
  })
})

describe('the five run states', () => {
  const CASES = [
    { phase: 'queued', label: '排队', parts: { activeRun: run('r1', 'queued') } },
    { phase: 'running', label: '运行中', parts: { activeRun: run('r1', 'running') } },
    { phase: 'succeeded', label: '已完成', parts: { history: [run('r1', 'succeeded')] } },
    { phase: 'failed', label: '失败', parts: { history: [run('r1', 'failed')] } },
    { phase: 'lost', label: '失联', parts: { history: [run('r1', 'lost')] } },
    { phase: 'cancelled', label: '已取消', parts: { history: [run('r1', 'cancelled')] } },
  ]

  it('user reading each run phase sees that phase named and marked in the section', () => {
    // Given one card per phase
    const labels: string[] = []
    const marks: Array<string | null> = []
    for (const entry of CASES) {
      // When its detail section renders
      cleanup()
      render(createElement(SshDetailSection, { task: card({ target: TARGET, ...entry.parts }), dispatch: board().dispatch }))

      // Then the pill carries this phase's own words and its own mark
      const pill = screen.getByText(entry.label)
      labels.push(pill.textContent ?? '')
      marks.push(pill.getAttribute('data-run'))
    }

    // And no two phases read the same
    expect(new Set(labels).size).toBe(CASES.length)
    expect(marks).toEqual(CASES.map(entry => entry.phase))
  })

  it('user reading the chip on each phase sees the phase named and marked on the card', () => {
    // Given one card per phase
    for (const entry of CASES) {
      // When its chip renders
      cleanup()
      const { container } = render(createElement(SshCardDecoration, { task: card({ target: TARGET, ...entry.parts }) }))
      const chip = container.querySelector('[data-dsh-part="badge"]')

      // Then the chip names the host, repeats the phase, and keeps both in its title
      expect(chip?.getAttribute('data-run')).toBe(entry.phase)
      expect(chip?.textContent).toBe('devbox · ' + entry.label)
      expect(chip?.getAttribute('title')).toBe('devbox · ' + entry.label)
    }
  })
})

describe('the log', () => {
  it('user reopening a card detail sees the log replayed from its first byte', () => {
    // Given a card whose run has produced output
    const task = card({ target: TARGET, activeRun: run('r1', 'running') })
    const channel = board()
    const window = { runId: 'r1', baseOffset: 0, endOffset: 18, text: 'first line\nsecond' }

    // When the panel opens
    const first = render(createElement(SshDetailSection, { task, dispatch: channel.dispatch }))
    publish({ logs: { 'task-1': window } })

    // Then the provider was asked to re-read that run and the log shows its first line
    expect(channel.calls.some(call => call.action === 'refresh' && call.taskId === 'task-1')).toBe(true)
    expect(logRows()).toEqual(['first line', 'second'])

    // When the panel is closed and opened again
    first.unmount()
    const reopened = board()
    render(createElement(SshDetailSection, { task, dispatch: reopened.dispatch }))
    publish({ logs: { 'task-1': { ...window } } })

    // Then the replay starts at the beginning again rather than continuing
    expect(reopened.calls.some(call => call.action === 'refresh')).toBe(true)
    expect(logRows()).toEqual(['first line', 'second'])
  })

  it('user watching a running card sees the log grow line by line', () => {
    // Given a panel showing the first increment of a live run
    const task = card({ target: TARGET, activeRun: run('r1', 'running') })
    render(createElement(SshDetailSection, { task, dispatch: board().dispatch }))
    publish({ logs: { 'task-1': { runId: 'r1', baseOffset: 0, endOffset: 6, text: 'one\ntw' } } })
    expect(logRows()).toEqual(['one', 'tw'])

    // When the next increment arrives
    publish({ logs: { 'task-1': { runId: 'r1', baseOffset: 6, endOffset: 13, text: 'o\nthree' } } })

    // Then the partial line was continued and the new line follows it
    expect(logRows()).toEqual(['one', 'two', 'three'])
  })
})

describe('the workspace notices', () => {
  it('user reading a run that left files untracked sees how many were not sent', () => {
    // Given a provider that reports three untracked files for this card
    const task = card({ target: TARGET, activeRun: run('r1', 'running') })
    render(createElement(SshDetailSection, { task, dispatch: board().dispatch }))

    // When the summary arrives with that count
    publish({ runs: [{ taskId: 'task-1', runId: 'r1', phase: 'running', host: 'devbox', untrackedFiles: 3 }] })

    // Then the section says so, once
    const lines = sectionLines()
    expect(lines).toContain('3 个未跟踪文件未同步')
    expect(lines.filter(line => line === '3 个未跟踪文件未同步')).toHaveLength(1)
  })

  it('user reading a run that left nothing behind sees no untracked notice', () => {
    // Given a provider whose summary reports no untracked count at all
    const task = card({ target: TARGET, activeRun: run('r1', 'running') })
    render(createElement(SshDetailSection, { task, dispatch: board().dispatch }))

    // When the summary arrives without one
    publish({ runs: [{ taskId: 'task-1', runId: 'r1', phase: 'running', host: 'devbox', bytes: 12 }] })

    // Then nothing claims files were left behind
    expect(sectionLines().some(line => line?.includes('未跟踪'))).toBe(false)
  })
})

describe('the follow-up box', () => {
  it('operator sending a follow-up during a run sees it queued for the end of the turn', async () => {
    // Given a running card
    const task = card({ target: TARGET, activeRun: run('r1', 'running', { followUps: 0 }) })
    const channel = board()
    render(createElement(SshDetailSection, { task, dispatch: channel.dispatch }))

    // When the reader types a follow-up and sends it
    fireEvent.change(screen.getByLabelText('追问'), { target: { value: 'also update the docs' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送' }))
    })

    // Then exactly that message left through the board's channel, the field is
    // cleared, and the section says when it will be delivered
    expect(channel.calls.filter(call => call.action === 'follow-up')).toEqual([
      { extensionId: 'ssh', action: 'follow-up', taskId: 'task-1', payload: { text: 'also update the docs' } },
    ])
    expect((screen.getByLabelText('追问') as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByText('本轮结束后发送').className).toContain('queuedChip')
  })

  it('operator sending a follow-up on a finished card sees the card back in running', async () => {
    // Given a card whose last run succeeded
    const finished = card({ target: TARGET, history: [run('r1', 'succeeded')] })
    const channel = board()
    const view = render(createElement(SshDetailSection, { task: finished, dispatch: channel.dispatch }))
    expect(screen.getByText('已完成').getAttribute('data-run')).toBe('succeeded')

    // When the reader sends a follow-up
    fireEvent.change(screen.getByLabelText('追问'), { target: { value: 'one more pass' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送' }))
    })
    expect(channel.calls.some(call => call.action === 'follow-up')).toBe(true)
    expect(screen.queryByText('本轮结束后发送')).toBeNull()

    // Then the board's next mirror frame carries the new run and the section
    // reports the card as running again
    view.rerender(createElement(SshDetailSection, {
      task: card({ target: TARGET, activeRun: run('r2', 'running'), history: [run('r1', 'succeeded')] }),
      dispatch: channel.dispatch,
    }))
    expect(screen.getByText('运行中').getAttribute('data-run')).toBe('running')
  })
})

describe('a deployment without the SSH plugin', () => {
  /** The notice a reader gets when nothing is mounted to serve the section. */
  const MISSING = '需要先在插件管理里启用 SSH 插件'

  it('user opening a card before the first mirror frame gets the usual surface, not a notice', () => {
    // Given a page that has not received a mirror frame yet
    const task = card({ target: TARGET })

    // When the detail panel opens
    render(createElement(SshDetailSection, { task, dispatch: board().dispatch }))

    // Then the section behaves as it always has: the run surface, and no claim
    // about a plugin it cannot see
    expect(screen.queryByText(MISSING)).toBeNull()
    expect(screen.getByRole('button', { name: '编辑目标' }).textContent).toBe('编辑目标')
  })

  it('user whose frames never carry a summary is told to enable the SSH plugin, and gets no form', () => {
    // Given mirror frames that never carried this extension's summary
    const task = card()
    publishFrame({})

    // When the detail panel opens
    render(createElement(SshDetailSection, { task, dispatch: board().dispatch }))

    // Then the section is that one line: no form, no log, no follow-up, no cancel
    expect(screen.getByText(MISSING).textContent).toBe(MISSING)
    expect(screen.queryByLabelText('主机')).toBeNull()
    expect(screen.queryByRole('group', { name: '运行日志' })).toBeNull()
    expect(screen.queryByLabelText('追问')).toBeNull()
    expect(screen.queryByRole('button', { name: '取消执行' })).toBeNull()

    // And the card carries no chip either
    cleanup()
    const badge = render(createElement(SshCardDecoration, { task: card({ target: TARGET, activeRun: run('r1', 'running') }) }))
    expect(badge.container.firstChild).toBeNull()
  })

  it('user on a mounted deployment gets the form back the moment a summary arrives', () => {
    // Given a page whose frames carry the summary
    const task = card()
    publish({ hosts: [{ alias: 'devbox', host: '10.0.0.5', user: 'zcl', port: 22 }] })

    // When the detail panel opens
    render(createElement(SshDetailSection, { task, dispatch: board().dispatch }))

    // Then the target form is there, fed by the published host list
    expect(screen.queryByText(MISSING)).toBeNull()
    const host = screen.getByLabelText('主机') as HTMLSelectElement
    expect(Array.from(host.options).map(option => option.value)).toEqual(['', 'devbox'])
  })

  it('user whose extension went off after it ran keeps the surface instead of a missing-plugin notice', () => {
    // Given a page that saw the summary, then frames without it
    const task = card({ target: TARGET, activeRun: run('r1', 'running') })
    publish({ hosts: [] })
    publishFrame({})

    // When the detail panel opens
    render(createElement(SshDetailSection, { task, dispatch: board().dispatch }))

    // Then the provider is still installed: the run surface stays and nothing
    // claims the plugin is missing
    expect(screen.queryByText(MISSING)).toBeNull()
    expect(screen.getByText('运行中').getAttribute('data-run')).toBe('running')
  })
})

describe('the chip on a card', () => {
  it('user reading the chip sees where the card runs and how the run stands', () => {
    // Given a mounted deployment and a card pinned to a host
    publish({})
    const { container } = render(createElement(SshCardDecoration, { task: card({ target: TARGET, activeRun: run('r1', 'running') }) }))
    const chip = container.querySelector('[data-dsh-part="badge"]')

    // When its parts are read
    const spans = [...(chip?.querySelectorAll('span') ?? [])]
    const [dot, host, separator, state] = spans

    // Then the dot is decoration, the alias is its own element, and the phase is
    // the last word so a long alias can only ever truncate itself
    expect(dot?.getAttribute('aria-hidden')).toBe('true')
    expect(host?.textContent).toBe('devbox')
    expect(separator?.textContent).toBe(' · ')
    expect(state?.textContent).toBe('运行中')
    expect(chip?.textContent).toBe('devbox · 运行中')
  })

  it('user reading a card on a host with a long alias keeps the full name in the title', () => {
    // Given a card pinned to a host whose alias is longer than the chip shows
    publish({})
    const alias = 'staging-worker-eu-west-1'
    const { container } = render(createElement(SshCardDecoration, {
      task: card({ target: { ...TARGET, host: alias }, activeRun: run('r1', 'queued') }),
    }))
    const chip = container.querySelector('[data-dsh-part="badge"]')

    // When it renders
    // Then the truncation is a style on the alias element, not a lost value
    expect(chip?.getAttribute('title')).toBe(alias + ' · 排队')
    expect(chip?.querySelector('span:nth-child(2)')?.textContent).toBe(alias)
    expect(chip?.textContent).toBe(alias + ' · 排队')
  })
})

describe('the run controls', () => {
  it('operator cancelling a run sends the cancel action, and a settled card offers none', () => {
    // Given a running card
    const channel = board()
    const view = render(createElement(SshDetailSection, {
      task: card({ target: TARGET, activeRun: run('r1', 'running') }),
      dispatch: channel.dispatch,
    }))

    // When the reader cancels
    fireEvent.click(screen.getByRole('button', { name: '取消执行' }))

    // Then the board was asked to stop the run
    expect(channel.calls.filter(call => call.action === 'cancel')).toEqual([
      { extensionId: 'ssh', action: 'cancel', taskId: 'task-1' },
    ])

    // And a settled card offers no cancel at all
    view.rerender(createElement(SshDetailSection, {
      task: card({ target: TARGET, history: [run('r1', 'succeeded')] }),
      dispatch: channel.dispatch,
    }))
    expect(screen.queryByRole('button', { name: '取消执行' })).toBeNull()
  })

  it('operator whose action was refused is told instead of seeing a silent no-op', async () => {
    // Given a channel that refuses the write
    const refusing = async (): Promise<boolean> => false
    render(createElement(SshDetailSection, {
      task: card({ target: TARGET, activeRun: run('r1', 'running') }),
      dispatch: refusing,
    }))

    // When the reader asks to cancel
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消执行' }))
    })

    // Then the refusal is the one announced line
    expect(screen.getByRole('alert').textContent).toBe('看板没有接受这次操作。')
  })

  it('operator editing a target again sees the form prefilled and saves the change', async () => {
    // Given a targeted card whose provider publishes one host
    const channel = board()
    publish({ hosts: [{ alias: 'devbox', host: '10.0.0.5', user: 'zcl', port: 22 }] })
    render(createElement(SshDetailSection, { task: card({ target: TARGET }), dispatch: channel.dispatch }))
    expect(screen.queryByLabelText('远端路径')).toBeNull()

    // When the target is opened for editing
    fireEvent.click(screen.getByRole('button', { name: '编辑目标' }))
    expect((screen.getByLabelText('远端路径') as HTMLInputElement).value).toBe('/srv/app')

    // Then saving sends the edited target and folds the form again
    fireEvent.change(screen.getByLabelText('远端路径'), { target: { value: '/srv/other' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存目标' }))
    })
    const saved = channel.calls.find(call => call.action === 'set-target')
    expect(saved?.payload).toEqual({ target: { ...TARGET, workspace: { kind: 'in-place', path: '/srv/other' } } })
    expect(screen.queryByLabelText('远端路径')).toBeNull()
  })
})