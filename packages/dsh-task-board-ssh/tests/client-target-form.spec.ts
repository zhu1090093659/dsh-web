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
  it('an untargeted card offers mode, host, agent and workspace, and no repository field', () => {
    // Given an empty card on a provider that publishes two hosts
    mount()

    // When the form renders
    // Then the picker carries the published aliases and the in-place defaults
    // ask for a remote path only
    expect(screen.getByLabelText('直接执行')).toBeDefined()
    expect(screen.getByLabelText('本地代理')).toBeDefined()
    const host = screen.getByLabelText('主机') as HTMLSelectElement
    expect(Array.from(host.options).map(option => option.value)).toContain('devbox')
    expect(Array.from(host.options).map(option => option.value)).toContain('build')
    expect(screen.getByLabelText('远端目录')).toBeDefined()
    expect(screen.getByLabelText('远端路径')).toBeDefined()
    expect(screen.queryByLabelText('仓库地址')).toBeNull()
    expect(screen.queryByLabelText('本机工作区')).toBeNull()
  })

  it('the git workspace asks for a repository source, and only the chosen one', () => {
    // Given the form with the git mechanism chosen
    mount()
    fireEvent.click(screen.getByLabelText('Git 分支'))

    // When the source is a repository URL
    // Then the path input is gone and the URL and branch inputs are asked for
    expect(screen.queryByLabelText('远端路径')).toBeNull()
    expect(screen.getByLabelText('仓库地址')).toBeDefined()
    expect(screen.getByLabelText('起始分支')).toBeDefined()
    expect(screen.queryByLabelText('本机工作区')).toBeNull()

    // When the source is this machine's workspace instead
    fireEvent.click(screen.getByLabelText('本机仓库'))

    // Then the address fields are gone and the workspace id is asked for
    expect(screen.queryByLabelText('仓库地址')).toBeNull()
    expect(screen.queryByLabelText('起始分支')).toBeNull()
    expect(screen.getByLabelText('本机工作区')).toBeDefined()
  })

  it('a custom agent adds its two command templates', () => {
    // Given the form on the default agent
    mount()
    expect(screen.queryByLabelText('启动命令')).toBeNull()

    // When the reader picks the custom agent
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'custom' } })

    // Then both templates are offered
    expect(screen.getByLabelText('启动命令')).toBeDefined()
    expect(screen.getByLabelText('续跑命令')).toBeDefined()
  })

  it('a pinned alias that left the host list stays selectable and labelled', () => {
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
    expect(screen.getByText('已不在 dsh-ssh 的主机列表中：gonebox')).toBeDefined()
  })

  it('a provider with no hosts explains the empty picker instead of failing', () => {
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
    expect(screen.getByText('在 dsh-ssh 设置里添加主机后，这里才能选择。')).toBeDefined()
  })
})

describe('refusals before submit', () => {
  it('an empty host and a relative path are reported under their own fields', () => {
    // Given a draft with no host and a path that is not absolute
    const { onSubmit } = mount({ initial: { ...draftOf(undefined), workspacePath: 'srv/app' } })

    // When the reader submits
    fireEvent.click(screen.getByRole('button', { name: '保存目标' }))

    // Then both refusals are on screen and nothing was sent
    expect(screen.getByText('选择一台主机。')).toBeDefined()
    expect(screen.getByText('填写主机上的绝对路径，需以 / 开头。')).toBeDefined()
    expect(onSubmit).not.toHaveBeenCalled()
    expect((screen.getByLabelText('主机') as HTMLSelectElement).getAttribute('aria-invalid')).toBe('true')
  })

  it('a corrected field drops its refusal', () => {
    // Given a submit that was refused on the path
    mount({ initial: { ...draftOf(undefined), host: 'devbox', workspacePath: 'srv/app' } })
    fireEvent.click(screen.getByRole('button', { name: '保存目标' }))
    expect(screen.getByText('填写主机上的绝对路径，需以 / 开头。')).toBeDefined()

    // When the path is corrected
    fireEvent.change(screen.getByLabelText('远端路径'), { target: { value: '/srv/app' } })

    // Then the refusal is gone before the next submit
    expect(screen.queryByText('填写主机上的绝对路径，需以 / 开头。')).toBeNull()
  })

  it('a valid draft submits the parsed target and only the fields on screen', () => {
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

  it('a git draft from this workspace sends the workspace id', () => {
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
  it('every control is reachable by its own name, and the radios walk as one group', () => {
    // Given the form with a custom agent chosen
    mount()
    fireEvent.click(screen.getByLabelText('Git 分支'))
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'custom' } })

    // When each control is looked up by its accessible name
    const names = ['主机', 'Agent', '启动命令', '续跑命令', '仓库地址', '起始分支']
    // Then none of them is anonymous
    for (const name of names) expect(screen.getByLabelText(name)).toBeDefined()

    // And the two mode options share one radio group, so arrows move between them
    const direct = screen.getByLabelText('直接执行') as HTMLInputElement
    const proxy = screen.getByLabelText('本地代理') as HTMLInputElement
    expect(direct.name).toBe(proxy.name)
    expect(direct.checked).toBe(true)
    fireEvent.click(proxy)
    expect(proxy.checked).toBe(true)
  })
})
