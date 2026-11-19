/** @vitest-environment jsdom */

/**
 * The create dialog's new-card seat: whether the row exists at all, what it
 * reports the moment a reader picks a target, and what it refuses to report.
 *
 * The seat is the only place a card's target is chosen before the card exists,
 * so the cases follow one reader through it: a deployment whose host half is
 * mounted, one whose host half is not, the published defaults prefilling the
 * fields, the two workspace mechanisms underneath, and the refusals that keep a
 * draft the parser cannot read from ever reaching the board.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { SshComposeSection } from '../src/client/ssh/compose-section.tsx'
import { acceptPublishedSummary, resetSummaryStore } from '../src/client/ssh/summary.ts'
import { setRuntimeTranslate, t } from '../src/client/locales.ts'
import type { TaskBoardExtensionPayload } from '../src/core/contract.ts'
import { parseSshLedgerPayload } from '../src/core/ledger.ts'

/** The instant every report is stamped with. */
const NOW = 1_700_000_000_000

/** The hosts the provider publishes for the picker. */
const HOSTS = [
  { alias: 'devbox', host: '10.0.0.5', user: 'zcl', port: 22 },
  { alias: 'build', host: 'build.lan', user: 'ci', port: 2222 },
]

/** What a mounted host half publishes for this deployment. */
function publish(options: { hosts?: typeof HOSTS, defaults?: Record<string, string> } = {}): void {
  acceptPublishedSummary({
    ssh: {
      enabled: true,
      hosts: options.hosts ?? HOSTS,
      defaults: options.defaults ?? { mode: 'direct', agent: 'dsh', workspace: 'in-place' },
    },
  })
}

/** Render the seat with the board's own draft channel. */
function mountCompose() {
  const contribute = vi.fn<(extensionId: string, payload: TaskBoardExtensionPayload | undefined) => void>()
  const view = render(createElement(SshComposeSection, { contribute }))
  /** The last draft the seat reported; undefined means it withdrew it. */
  const lastDraft = (): TaskBoardExtensionPayload | undefined => {
    const calls = contribute.mock.calls.filter(call => call[0] === 'ssh')
    return calls.length === 0 ? undefined : calls[calls.length - 1]?.[1]
  }
  return { ...view, contribute, lastDraft }
}

beforeEach(() => {
  // Deterministic submission instants: only the clock is faked, so React's own
  // scheduling keeps running on real timers.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  resetSummaryStore()
})

afterEach(() => {
  cleanup()
  resetSummaryStore()
  setRuntimeTranslate(undefined)
  vi.useRealTimers()
})

describe('the row itself', () => {
  it('operator opening the create dialog on a mounted provider sees one switch and no target fields yet', () => {
    // Given a deployment whose host half published a host list
    publish()

    // When the create dialog renders the seat
    mountCompose()

    // Then the row offers the choice, and the fields it owns are not on screen
    // until the reader asks for them
    expect((screen.getByLabelText('在远程主机上执行') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByLabelText('主机')).toBeNull()
    expect(screen.queryByLabelText('远端路径')).toBeNull()
  })

  it('operator on a deployment whose SSH host half is not mounted sees no row, and no instruction to enable a plugin', () => {
    // Given a board that publishes its extensions and has no summary for this
    // provider, which is what a disabled dsh-ssh row produces
    acceptPublishedSummary({})

    // When the create dialog renders the seat
    const { container } = mountCompose()

    // Then the seat contributes nothing at all: no row, and none of the copy
    // the detail seat uses to explain the missing host half
    expect(container.firstChild).toBeNull()
    expect(screen.queryByLabelText('在远程主机上执行')).toBeNull()
    expect(screen.queryByText(t('detail.hostHalfMissing'))).toBeNull()
  })

  it('operator opening the dialog before the board published any frame sees no row', () => {
    // Given a page that has not received one mirror frame yet
    // (the store is reset before every case)

    // When the create dialog renders the seat
    const { container } = mountCompose()

    // Then nothing is claimed and nothing is rendered
    expect(container.firstChild).toBeNull()
  })

  it('operator on a deployment with no published host sees where to add one and no refusal', () => {
    // Given a mounted host half that knows of no host
    publish({ hosts: [] })

    // When the reader asks for a remote target
    mountCompose()
    fireEvent.click(screen.getByLabelText('在远程主机上执行'))

    // Then the picker is disabled, says where hosts come from, and carries no
    // refusal: a field that cannot be answered is not one to be blamed for
    const host = screen.getByLabelText('主机') as HTMLSelectElement
    expect(host.disabled).toBe(true)
    expect(host.getAttribute('aria-invalid')).toBe('false')
    expect(screen.getByText('在 dsh-ssh 设置里添加主机后，这里才能选择。').textContent)
      .toBe('在 dsh-ssh 设置里添加主机后，这里才能选择。')
  })
})

describe('the draft it reports', () => {
  it('operator expanding the row sees the provider defaults already chosen', () => {
    // Given defaults that name a published host
    publish({ defaults: { mode: 'proxy', agent: 'claude', workspace: 'git', host: 'build' } })

    // When the row expands
    mountCompose()
    fireEvent.click(screen.getByLabelText('在远程主机上执行'))

    // Then each control opens on the provider's own default
    expect((screen.getByLabelText('本地代理') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('主机') as HTMLSelectElement).value).toBe('build')
    expect((screen.getByLabelText('Agent') as HTMLSelectElement).value).toBe('claude')
    expect((screen.getByLabelText('Git 分支') as HTMLInputElement).checked).toBe(true)
  })

  it('operator filling in a complete target hands the board one payload it can read back', () => {
    // Given a mounted provider whose default host is a published one
    publish({ defaults: { mode: 'direct', agent: 'dsh', workspace: 'in-place', host: 'devbox' } })
    const { lastDraft } = mountCompose()

    // When the reader asks for a remote target
    fireEvent.click(screen.getByLabelText('在远程主机上执行'))

    // Then the missing remote path is named in place, and no draft travels yet
    expect(screen.getByText('填写主机上的绝对路径，需以 / 开头。').textContent).toBe('填写主机上的绝对路径，需以 / 开头。')
    expect(lastDraft()).toBeUndefined()

    // When the path is filled in
    fireEvent.change(screen.getByLabelText('远端路径'), { target: { value: '/srv/app' } })

    // Then the row reports the stored document: the frozen version, the instant
    // of the report, no run account, and exactly the target on screen
    const draft = lastDraft()
    expect(draft).toEqual({
      version: 1,
      updatedAt: NOW,
      history: [],
      target: { mode: 'direct', host: 'devbox', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/app' } },
    })
    const parsed = parseSshLedgerPayload(draft)
    expect(parsed.ok).toBe(true)
  })

  it('operator switching the workspace to git is asked for a repository source, and never for a remote path', () => {
    // Given a complete in-place target
    publish({ defaults: { mode: 'direct', agent: 'dsh', workspace: 'in-place', host: 'devbox' } })
    mountCompose()
    fireEvent.click(screen.getByLabelText('在远程主机上执行'))
    fireEvent.change(screen.getByLabelText('远端路径'), { target: { value: '/srv/app' } })

    // When the reader switches to a git branch
    fireEvent.click(screen.getByLabelText('Git 分支'))

    // Then the path field is gone and a repository URL is asked for instead
    expect(screen.queryByLabelText('远端路径')).toBeNull()
    expect((screen.getByLabelText('仓库地址') as HTMLInputElement).value).toBe('')

    // When the source becomes this machine's workspace
    fireEvent.click(screen.getByLabelText('本机仓库'))

    // Then no address is asked for, only the workspace id
    expect(screen.queryByLabelText('仓库地址')).toBeNull()
    expect(screen.queryByLabelText('起始分支')).toBeNull()
    expect((screen.getByLabelText('本机工作区') as HTMLInputElement).value).toBe('')
  })

  it('operator whose custom command the parser refuses sees the refusal and loses the draft it had', () => {
    // Given a complete target already reported
    publish({ defaults: { mode: 'direct', agent: 'dsh', workspace: 'in-place', host: 'devbox' } })
    const { lastDraft } = mountCompose()
    fireEvent.click(screen.getByLabelText('在远程主机上执行'))
    fireEvent.change(screen.getByLabelText('远端路径'), { target: { value: '/srv/app' } })
    const before = parseSshLedgerPayload(lastDraft())
    expect(before.ok && before.value.target?.workspace).toEqual({ kind: 'in-place', path: '/srv/app' })

    // When the agent becomes a custom command that carries no prompt file
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'custom' } })

    // Then the refusal sits under the command field and the draft is withdrawn,
    // because the board must never store a target this seat is not showing
    expect(screen.getByText('启动命令必须引用 {prompt_file}。').textContent).toBe('启动命令必须引用 {prompt_file}。')
    expect(lastDraft()).toBeUndefined()
  })

  it('operator clearing the row back to no target withdraws the draft', () => {
    // Given a reported target
    publish({ defaults: { mode: 'direct', agent: 'dsh', workspace: 'in-place', host: 'devbox' } })
    const { lastDraft } = mountCompose()
    fireEvent.click(screen.getByLabelText('在远程主机上执行'))
    fireEvent.change(screen.getByLabelText('远端路径'), { target: { value: '/srv/app' } })
    const before = parseSshLedgerPayload(lastDraft())
    expect(before.ok && before.value.target?.host).toBe('devbox')

    // When the reader clears the choice again
    fireEvent.click(screen.getByLabelText('在远程主机上执行'))

    // Then the board is told to keep no target for this card, and the fields are
    // gone with nothing left to edit
    expect(lastDraft()).toBeUndefined()
    expect(screen.queryByLabelText('主机')).toBeNull()
  })
})
