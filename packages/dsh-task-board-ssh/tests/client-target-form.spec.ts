/** @vitest-environment jsdom */

/**
 * The target form: which fields a mode and a workspace kind actually ask for,
 * and what happens to input the frozen parser refuses.
 *
 * The form is the only place a card's target is written, so the cases follow a
 * reader through it: an empty card on a published host list, the two workspace
 * mechanisms underneath, a custom agent's templates, and the refusals that stop
 * a submit before anything leaves the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { SshTargetForm } from '../src/client/ssh/target-form.tsx'
import { draftOf } from '../src/client/ssh/model.ts'
import type { SshTarget } from '../src/core/target.ts'

afterEach(cleanup)

/** The hosts a provider publishes for the picker. */
const HOSTS = [
  { alias: 'devbox', host: '10.0.0.5', user: 'zcl', port: 22 },
  { alias: 'build', host: 'build.lan', user: 'ci', port: 2222 },
]

/** Render the form the way the detail section does. */
function mount(options: { initial?: ReturnType<typeof draftOf>, onCancel?: () => void } = {}) {
  const onSubmit = vi.fn<(target: SshTarget) => void>()
  const view = render(createElement(SshTargetForm, {
    initial: options.initial ?? draftOf(undefined),
    hosts: HOSTS,
    saving: false,
    submitLabel: '保存目标',
    ...(options.onCancel === undefined ? {} : { onCancel: options.onCancel }),
    onSubmit,
  }))
  return { ...view, onSubmit }
}

describe('the fields a target asks for', () => {
  it('operator opening an untargeted form gets mode, host, agent and workspace, and no repository field', () => {
    // Given an empty card on a provider that publishes two hosts
    mount()

    // When the form renders
    // Then the picker carries the published aliases and the in-place defaults
    // ask for a remote path only
    expect((screen.getByLabelText('直接执行') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('本地代理') as HTMLInputElement).checked).toBe(false)
    const host = screen.getByLabelText('主机') as HTMLSelectElement
    expect(Array.from(host.options).map(option => option.value)).toEqual(['', 'devbox', 'build'])
    expect((screen.getByLabelText('远端目录') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('远端路径') as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('仓库地址')).toBeNull()
    expect(screen.queryByLabelText('本机工作区')).toBeNull()
  })

  it('operator choosing the git workspace is asked for one repository source, and only the chosen one', () => {
    // Given the form with the git mechanism chosen
    mount()
    fireEvent.click(screen.getByLabelText('Git 分支'))

    // When the source is a repository URL
    // Then the path input is gone and the URL and branch inputs are asked for
    expect(screen.queryByLabelText('远端路径')).toBeNull()
    expect((screen.getByLabelText('仓库地址') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('起始分支') as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('本机工作区')).toBeNull()

    // When the source is this machine's workspace instead
    fireEvent.click(screen.getByLabelText('本机仓库'))

    // Then the address fields are gone and the workspace id is asked for
    expect(screen.queryByLabelText('仓库地址')).toBeNull()
    expect(screen.queryByLabelText('起始分支')).toBeNull()
    expect((screen.getByLabelText('本机工作区') as HTMLInputElement).value).toBe('')
  })

  it('operator choosing a custom agent is asked for its two command templates', () => {
    // Given the form on the default agent
    mount()
    expect(screen.queryByLabelText('启动命令')).toBeNull()

    // When the reader picks the custom agent
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'custom' } })

    // Then both templates are offered, empty, waiting for a command line
    expect((screen.getByLabelText('启动命令') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('续跑命令') as HTMLInputElement).value).toBe('')
  })

  it('operator reopening a card pinned to a host that left the list still sees that alias selected', () => {
    // Given a card pinned to a host the provider no longer publishes
    render(createElement(SshTargetForm, {
      initial: { ...draftOf(undefined), host: 'gonebox', workspacePath: '/srv/app' },
      hosts: HOSTS,
      unknownHost: 'gonebox',
      saving: false,
      submitLabel: '保存目标',
      onSubmit: vi.fn(),
    }))

    // When the picker renders
    // Then the alias is still the selected option and says why it is odd
    const select = screen.getByLabelText('主机') as HTMLSelectElement
    expect(select.value).toBe('gonebox')
    expect(select.selectedOptions[0]?.textContent).toBe('已不在 dsh-ssh 的主机列表中：gonebox')
  })

  it('operator on a deployment with no hosts is told where to add one', () => {
    // Given no published host at all
    render(createElement(SshTargetForm, {
      initial: draftOf(undefined),
      hosts: [],
      saving: false,
      submitLabel: '保存目标',
      onSubmit: vi.fn(),
    }))

    // When the form renders
    // Then the picker is disabled and named, and the reason is on screen
    const select = screen.getByLabelText('主机') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    const hintId = (select.getAttribute('aria-describedby') ?? '').split(' ')[0]
    expect(document.getElementById(hintId)?.textContent).toBe('在 dsh-ssh 设置里添加主机后，这里才能选择。')
  })
})

describe('refusals before submit', () => {
  it('operator submitting an empty host and a relative path is told on both fields and nothing is sent', () => {
    // Given a draft with no host and a path that is not absolute
    const { onSubmit } = mount({ initial: { ...draftOf(undefined), workspacePath: 'srv/app' } })

    // When the reader submits
    fireEvent.click(screen.getByRole('button', { name: '保存目标' }))

    // Then each control is wired to its own refusal and nothing was sent
    const host = screen.getByLabelText('主机') as HTMLSelectElement
    const path = screen.getByLabelText('远端路径') as HTMLInputElement
    expect(host.getAttribute('aria-invalid')).toBe('true')
    expect(path.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById((host.getAttribute('aria-describedby') ?? '').split(' ').pop() ?? '')?.textContent)
      .toBe('选择一台主机。')
    expect(document.getElementById((path.getAttribute('aria-describedby') ?? '').split(' ').pop() ?? '')?.textContent)
      .toBe('填写主机上的绝对路径，需以 / 开头。')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('operator correcting a refused field sees its message go before the next submit', () => {
    // Given a submit that was refused on the path
    mount({ initial: { ...draftOf(undefined), host: 'devbox', workspacePath: 'srv/app' } })
    fireEvent.click(screen.getByRole('button', { name: '保存目标' }))
    expect((screen.getByLabelText('远端路径') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true')

    // When the path is corrected
    fireEvent.change(screen.getByLabelText('远端路径'), { target: { value: '/srv/app' } })

    // Then the refusal is gone and the field is no longer marked invalid
    expect(screen.queryByText('填写主机上的绝对路径，需以 / 开头。')).toBeNull()
    expect((screen.getByLabelText('远端路径') as HTMLInputElement).getAttribute('aria-invalid')).toBe('false')
  })

  it('operator submitting a complete in-place target sends exactly the fields on screen', () => {
    // Given a complete in-place draft
    const { onSubmit } = mount()

    // When the reader fills it in and submits
    fireEvent.change(screen.getByLabelText('主机'), { target: { value: 'build' } })
    fireEvent.change(screen.getByLabelText('远端路径'), { target: { value: '/srv/app' } })
    fireEvent.click(screen.getByRole('button', { name: '保存目标' }))

    // Then exactly one target left the page, with no repository field at all
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      mode: 'direct',
      host: 'build',
      agent: { kind: 'dsh' },
      workspace: { kind: 'in-place', path: '/srv/app' },
    })
  })

  it('operator submitting a git target from this workspace sends the workspace id', () => {
    // Given the git mechanism on this machine's workspace
    const { onSubmit } = mount()
    fireEvent.change(screen.getByLabelText('主机'), { target: { value: 'devbox' } })
    fireEvent.click(screen.getByLabelText('Git 分支'))
    fireEvent.click(screen.getByLabelText('本机仓库'))
    fireEvent.change(screen.getByLabelText('本机工作区'), { target: { value: 'ws-1' } })

    // When it is submitted
    fireEvent.click(screen.getByRole('button', { name: '保存目标' }))

    // Then the workspace travels as an id, with no address
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      mode: 'direct',
      host: 'devbox',
      agent: { kind: 'dsh' },
      workspace: { kind: 'git', source: { kind: 'workspace', workspaceId: 'ws-1' } },
    })
  })
})

describe('keyboard and accessible names', () => {
  it('operator walking the form reaches every control by its own name, with one radio group per choice', () => {
    // Given the form with a custom agent chosen
    mount()
    fireEvent.click(screen.getByLabelText('Git 分支'))
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'custom' } })

    // When each control is looked up by its accessible name
    const names = ['主机', 'Agent', '启动命令', '续跑命令', '仓库地址', '起始分支']
    // Then each of them is a real control carrying its own name
    for (const name of names) expect((screen.getByLabelText(name) as HTMLElement).tagName).toMatch(/^(INPUT|SELECT)$/)

    // And the two mode options share one radio group, so arrows move between them
    const direct = screen.getByLabelText('直接执行') as HTMLInputElement
    const proxy = screen.getByLabelText('本地代理') as HTMLInputElement
    expect(direct.name).toBe(proxy.name)
    expect(direct.checked).toBe(true)
    fireEvent.click(proxy)
    expect(proxy.checked).toBe(true)
  })
})