/**
 * Panel interaction tests (jsdom): the shell (header, tabs), the
 * last-good list policy when a refresh fails, mutation identity, the create
 * tab's lazy workspace resolution, the loading state, and the edit flow.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ListPayload } from '../src/client/api.ts'
import { PanelController } from '../src/client/panel/controller.ts'
import { SkillPanel } from '../src/client/panel/SkillPanel.tsx'

interface CreateArgs {
  root: 'user' | 'project'
  name: string
  description: string
  whenToUse?: string
  content: string
  cwd: string
}

/** Minimal fake api: list is controllable per call, other methods recorded. */
/** Minimal fake api: list is controllable per call, other methods overridable. */
function fakeApi(listResults: Array<() => Promise<ListPayload>>, overrides: Record<string, unknown> = {}) {
  let calls = 0
  return {
    calls: () => calls,
    list: async () => { const fn = listResults[Math.min(calls, listResults.length - 1)]; calls += 1; return fn() },
    setEnabled: async (_name: string, _path: string, _enabled: boolean) => ({ name: '', enabled: true }),
    remove: async (_name: string, _path: string) => ({ ok: true as const, name: '', moved: '' }),
    create: async (args: CreateArgs) => ({ ok: true as const, name: args.name, path: '/work/' + args.name + '/SKILL.md' }),
    read: async (name: string, path: string) => ({ name, path, description: '', content: '' }),
    update: async () => { throw new Error('unused') },
    ...overrides,
  }
}

const payload = (names: string[]): ListPayload => ({
  cwd: '/work',
  projectRoots: [],
  complete: true,
  groups: [{ key: 'user-dsh', title: 'User skills', hint: '', skills: names.map((name) => ({
    name, description: 'desc', provider: 'filesystem', level: 'user-dsh', path: '/work/' + name + '/SKILL.md',
    fileState: 'editable',
    modelInvocable: true, userInvocable: true,
  })) }],
})

function mount(api: ReturnType<typeof fakeApi>, controller: PanelController = new PanelController()): {
  container: HTMLDivElement
  controller: PanelController
  dispose: () => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // Render inside act so the commit and passive effects (the list fetch) are
  // drained synchronously; an unwrapped render rides the Scheduler and can
  // lose the race on slow CI runners.
  act(() => {
    root.render(<SkillPanel api={api as never} controller={controller} />)
  })
  return {
    container,
    controller,
    dispose: () => {
      root.unmount()
      container.remove()
    },
  }
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

/** Click the tab whose label matches. */
async function openTab(container: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    const tab = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    tab?.click()
  })
}

/** Type into a controlled input/textarea the way React expects. */
async function typeInto(element: HTMLElement, value: string): Promise<void> {
  const prototype = element instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  await act(async () => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('SkillPanel shell', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('user opening the panel sees a title header with no back control and no workspace path (#1215, #1785)', async () => {
    // Given a panel listing one skill
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api)
    await flush()
    // When the panel renders
    const header = mount_.container.querySelector('h2')?.parentElement
    // Then the header is the title alone: leaving the panel is the sidebar
    // row's job, like the shell's own Plugins and Schedule pages, so no
    // control here re-renders the whole center column
    expect(header?.textContent).toBe('技能中心')
    expect(mount_.container.querySelector('[data-dsh-center-view-back]')).toBeNull()
    expect(header?.textContent).not.toContain('cwd:')
    mount_.dispose()
  })

  it('user opening the panel sees the family semantic attributes and the active tab', async () => {
    // Given a panel listing one skill
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api)
    await flush()
    // When the panel renders
    const panel = mount_.container.querySelector('[data-dsh-plugin="skill-explorer"]')
    // Then the panel root and its tab bar carry the family vocabulary
    expect(panel).toBeInstanceOf(HTMLDivElement)
    const tabs = Array.from(mount_.container.querySelectorAll('[data-dsh-part="tab"]'))
    expect(tabs.map(tab => tab.textContent)).toEqual(['技能', '创建'])
    expect(tabs[0]?.hasAttribute('data-active')).toBe(true)
    expect(tabs[1]?.hasAttribute('data-active')).toBe(false)
    mount_.dispose()
  })

  it('user inside the panel has no in-page way out, and Escape does not close it either', async () => {
    // Given an open panel with one skill listed
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api)
    await flush()
    // When the user presses Escape, the controller stays where it is
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(mount_.controller.getSnapshot().panelOpen).toBe(false)
    // And the rendered header offers no close affordance of its own, so the
    // layout is never asked to re-select the conversation from in here
    // (the click lag of issue #1785 had no other in-page trigger to remove)
    const header = mount_.container.querySelector('h2')?.parentElement
    expect(header?.querySelector('button')).toBeNull()
    expect(mount_.container.querySelector('[data-dsh-center-view-back]')).toBeNull()
    expect(mount_.container.textContent).not.toContain('返回会话')
    mount_.dispose()
  })

  it('user switching to the create tab sees the create form', async () => {
    // Given an open panel on its skills tab
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api)
    await flush()
    // When the user switches to the create tab
    await openTab(mount_.container, '创建')
    // Then the create form is on screen
    expect(mount_.container.querySelector('form')).toBeInstanceOf(HTMLFormElement)
    expect(mount_.container.textContent).toContain('创建位置')
    mount_.dispose()
  })
})

describe('SkillPanel create tab', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('user creating a skill right after opening the panel gets the workspace resolved once', async () => {
    // Given an open panel whose skills tab has already loaded the list
    const api = fakeApi([async () => payload(['demo-skill'])])
    const create = vi.fn(async (args: CreateArgs) => ({ ok: true as const, name: args.name, path: '/work/' + args.name + '/SKILL.md' }))
    api.create = create
    const mount_ = mount(api)
    await flush()
    // When the user opens the create tab first and submits a filled form
    const firstCallCount = api.calls()
    await openTab(mount_.container, '创建')
    const inputs = mount_.container.querySelectorAll('input')
    await typeInto(inputs[0]!, 'my-workflow')
    await typeInto(inputs[1]!, 'demo skill')
    await typeInto(mount_.container.querySelector('textarea')!, '# steps')
    await act(async () => {
      const submit = Array.from(mount_.container.querySelectorAll('button')).find(b => b.textContent?.trim() === '创建技能')
      submit?.click()
    })
    await flush()
    // Then the workspace came from one list call and is reused afterwards
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![0].cwd).toBe('/work')
    expect(create.mock.calls[0]![0].name).toBe('my-workflow')
    // The workspace was resolved once (list fetch) and then reused: no second scan.
    expect(api.calls()).toBe(firstCallCount + 1)
    expect(mount_.container.textContent).toContain('已创建')
    mount_.dispose()
  })

  it('user submitting an empty create form sees the validation banner', async () => {
    // Given an open create tab with an untouched form
    const api = fakeApi([async () => payload(['demo-skill'])])
    const create = vi.fn(async (args: CreateArgs) => ({ ok: true as const, name: args.name, path: '/' }))
    api.create = create
    const mount_ = mount(api)
    await flush()
    await openTab(mount_.container, '创建')
    await act(async () => {
      const submit = Array.from(mount_.container.querySelectorAll('button')).find(b => b.textContent?.trim() === '创建技能')
      submit?.click()
    })
    // Then nothing reaches the host and the form reports what is missing
    expect(create).not.toHaveBeenCalled()
    expect(mount_.container.textContent).toContain('技能名/描述/内容不能为空')
    mount_.dispose()
  })
})

describe('SkillPanel loading state', () => {
  afterEach(() => { document.body.innerHTML = '' })

  /** Whether the toolbar currently offers the refresh control. */
  function hasRefresh(container: HTMLElement): boolean {
    return Array.from(container.querySelectorAll('button')).some(button => button.textContent?.trim() === '刷新')
  }

  it('user opening the panel sees no refresh control while the list loads', async () => {
    // Given a host whose first list call stays pending
    let releaseInitial: (() => void) | undefined
    let releaseRefresh: (() => void) | undefined
    const api = fakeApi([
      async () => new Promise<ListPayload>((resolve) => {
        releaseInitial = () => { resolve(payload(['demo-skill'])) }
      }),
      async () => new Promise<ListPayload>((resolve) => {
        releaseRefresh = () => { resolve(payload(['demo-skill'])) }
      }),
    ])
    const mount_ = mount(api)
    // First load: the loading state stands alone, with no refresh control.
    expect(mount_.container.textContent).toContain('加载中')
    expect(hasRefresh(mount_.container)).toBe(false)
    await act(async () => { releaseInitial?.() })
    await flush()
    expect(hasRefresh(mount_.container)).toBe(true)
    // Refresh in flight: the control disappears again until the list settles.
    await act(async () => {
      const refresh = Array.from(mount_.container.querySelectorAll('button')).find(button => button.textContent?.trim() === '刷新')
      refresh?.click()
    })
    expect(hasRefresh(mount_.container)).toBe(false)
    await act(async () => { releaseRefresh?.() })
    await flush()
    expect(hasRefresh(mount_.container)).toBe(true)
    mount_.dispose()
  })

  it('user whose first load fails keeps the refresh control as the retry path', async () => {
    // Given a host whose first list call fails
    const api = fakeApi([async () => { throw new Error('boom') }])
    const mount_ = mount(api)
    await flush()
    // Then the failure is reported and the refresh control remains the way out
    expect(mount_.container.textContent).toContain('boom')
    expect(hasRefresh(mount_.container)).toBe(true)
    mount_.dispose()
  })
})

describe('SkillPanel last-good list policy', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('user refreshing after a failure keeps the previous list and sees the error', async () => {
    // Given a listed skill and a refresh that will fail
    const api = fakeApi([
      async () => payload(['demo-skill']),
      async () => { throw new Error('boom') },
    ])
    const mount_ = mount(api)
    await flush()
    expect(mount_.container.textContent).toContain('demo-skill')
    // When the user refreshes and the call fails
    await act(async () => {
      const refresh = Array.from(mount_.container.querySelectorAll('button')).find(b => b.textContent?.trim() === '刷新')
      refresh?.click()
    })
    await flush()
    // Then the previous list stays visible next to the error
    const text = mount_.container.textContent ?? ''
    expect(text).toContain('demo-skill')
    expect(text).toContain('boom')
    mount_.dispose()
  })
})

describe('SkillPanel mutation identity', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('user toggling a skill certifies the displayed path', async () => {
    // Given a listed skill with its own path
    const api = fakeApi([async () => payload(['demo-skill'])])
    const setEnabled = vi.fn(async () => ({ name: 'demo-skill', enabled: false }))
    api.setEnabled = setEnabled
    const mount_ = mount(api)
    await flush()
    // When the user flips the enable switch
    const toggle = mount_.container.querySelector('[role="switch"]') as HTMLButtonElement
    await act(async () => {
      toggle.click()
    })
    await flush()
    expect(setEnabled).toHaveBeenCalledWith('demo-skill', '/work/demo-skill/SKILL.md', false)
    mount_.dispose()
  })

  it('user deleting a skill certifies the displayed path', async () => {
    // Given a listed skill and a confirmed delete prompt
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const api = fakeApi([async () => payload(['demo-skill'])])
    const remove = vi.fn(async () => ({ ok: true as const, name: 'demo-skill', moved: '/trash/SKILL.md' }))
    api.remove = remove
    const mount_ = mount(api)
    await flush()
    // When the user presses the row's delete action
    const deleteButton = Array.from(mount_.container.querySelectorAll('button')).find(button => button.textContent?.trim() === '删除')
    await act(async () => {
      deleteButton?.click()
    })
    await flush()
    expect(remove).toHaveBeenCalledWith('demo-skill', '/work/demo-skill/SKILL.md')
    mount_.dispose()
  })

  it('user reading a row sees the localized provider badge and the invokable tooltip (#1304, #1305)', async () => {
    // Given a listed skill from the filesystem provider
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api)
    await flush()
    // When the row renders
    const badges = Array.from(mount_.container.querySelectorAll('span'))
    // Then both badges are localized and explain themselves
    const providerBadge = badges.find(b => b.textContent?.trim() === '文件系统')
    expect(providerBadge).toBeInstanceOf(HTMLSpanElement)
    expect(providerBadge?.getAttribute('title')).toBe('技能来源：文件系统')

    const invokableBadge = badges.find(b => b.textContent?.includes('可调用'))
    expect(invokableBadge).toBeInstanceOf(HTMLSpanElement)
    expect(invokableBadge?.getAttribute('title')).toBe('模型可自动调用该技能；手动 /skill 指令不受影响')
    mount_.dispose()
  })
})

describe('SkillPanel pathless rows (#1842)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  /** A payload mixing a plugin-supplied file and a virtual registration. */
  const pathlessPayload: ListPayload = {
    cwd: '/work',
    projectRoots: [],
    complete: true,
    groups: [{
      key: 'bundled', title: 'System bundled', hint: '', skills: [
        {
          name: 'provider-skill', description: '插件提供的技能', provider: 'orca', level: 'bundled',
          fileState: 'provider-file', modelInvocable: true, userInvocable: true,
        },
        {
          name: 'virtual-skill', description: '运行时注册技能', provider: 'runtime', level: 'runtime',
          fileState: 'virtual', modelInvocable: true, userInvocable: true,
        },
      ],
    }],
  }

  /** The skill-row article whose name matches. */
  function row(container: HTMLElement, name: string): HTMLElement {
    const found = Array.from(container.querySelectorAll('[data-dsh-part="skill-row"]'))
      .find(r => r.querySelector('span')?.textContent === name)
    expect(found).toBeInstanceOf(HTMLElement)
    return found as HTMLElement
  }

  it('user sees a plugin-supplied file and a virtual skill badged differently', async () => {
    // Given a panel listing one provider-backed skill and one virtual skill
    const api = fakeApi([async () => pathlessPayload])
    const mount_ = mount(api)
    await flush()

    // When both rows render
    const providerRow = row(mount_.container, 'provider-skill')
    const virtualRow = row(mount_.container, 'virtual-skill')

    // Then the provider row states the file is plugin-supplied, and only the
    // truly fileless row claims there is no local file
    expect(providerRow.textContent).toContain('由插件提供')
    expect(providerRow.textContent).not.toContain('无本地文件')
    expect(virtualRow.textContent).toContain('无本地文件')
    expect(virtualRow.textContent).not.toContain('由插件提供')
    mount_.dispose()
  })

  it('user sees an enable switch on the provider row but no file controls on either row', async () => {
    // Given the same two pathless rows
    const api = fakeApi([async () => pathlessPayload])
    const mount_ = mount(api)
    await flush()

    // When the rows render
    const providerRow = row(mount_.container, 'provider-skill')
    const virtualRow = row(mount_.container, 'virtual-skill')

    // Then the plugin-provided file carries the switch (#1854): the host
    // records it in the panel's own store, which needs no writable path
    const providerSwitch = providerRow.querySelector('[role="switch"]')
    expect(providerSwitch?.getAttribute('aria-checked')).toBe('true')
    // And the truly fileless registration still has nothing to switch
    expect(virtualRow.querySelector('[role="switch"]')).toBeNull()
    // Neither offers a file control the write routes would refuse
    for (const element of [providerRow, virtualRow]) {
      const labels = Array.from(element.querySelectorAll('button')).map(b => b.textContent?.trim())
      expect(labels).not.toContain('编辑')
      expect(labels).not.toContain('删除')
    }
    mount_.dispose()
  })

  it('user switching off a plugin-provided skill certifies its provider identity instead of a path', async () => {
    // Given a panel listing one plugin-provided skill
    const setProviderEnabled = vi.fn(async () => ({ ok: true as const, name: 'provider-skill', provider: 'orca', disabled: true }))
    const setEnabled = vi.fn(async () => ({ name: '', enabled: false }))
    const api = fakeApi([async () => pathlessPayload], { setProviderEnabled, setEnabled })
    const mount_ = mount(api)
    await flush()

    // When the user flips that row's enable switch
    const toggle = row(mount_.container, 'provider-skill').querySelector('[role="switch"]') as HTMLButtonElement
    await act(async () => { toggle.click() })
    await flush()

    // Then the host receives the (provider, name) pair and no path
    expect(setProviderEnabled).toHaveBeenCalledWith('provider-skill', 'orca', false)
    // And the row's own file toggle was never used
    expect(setEnabled).not.toHaveBeenCalled()
    mount_.dispose()
  })
})

describe('SkillPanel search filter (#1423)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  const searchPayload: ListPayload = {
    cwd: '/work',
    projectRoots: [],
    complete: true,
    groups: [{
      key: 'user-dsh', title: 'User skills', hint: '', skills: [
        { name: 'gamma-skill', description: 'unrelated', provider: 'filesystem', level: 'user-dsh', path: '/work/gamma-skill/SKILL.md', fileState: 'editable', modelInvocable: true, userInvocable: true },
        { name: 'beta-skill', description: 'alpha related helper', provider: 'filesystem', level: 'user-dsh', path: '/work/beta-skill/SKILL.md', fileState: 'editable', modelInvocable: true, userInvocable: true },
        { name: 'alpha-skill', description: 'first helper', provider: 'filesystem', level: 'user-dsh', path: '/work/alpha-skill/SKILL.md', fileState: 'editable', modelInvocable: true, userInvocable: true },
      ],
    }],
  }

  async function typeSearch(container: HTMLElement, value: string): Promise<void> {
    await typeInto(container.querySelector('input[type="search"]')!, value)
  }

  function rows(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('[data-dsh-part="skill-row"]')).map(row => row.querySelector('span')?.textContent ?? '')
  }

  it('user typing a query sees name hits before description hits', async () => {
    const api = fakeApi([async () => searchPayload])
    const mount_ = mount(api)
    await flush()
    expect(rows(mount_.container)).toHaveLength(3)
    await typeSearch(mount_.container, 'ALPHA')
    expect(rows(mount_.container)).toEqual(['alpha-skill', 'beta-skill'])
    mount_.dispose()
  })

  it('user searching for an unmatched query sees the empty state', async () => {
    const api = fakeApi([async () => searchPayload])
    const mount_ = mount(api)
    await flush()
    await typeSearch(mount_.container, 'zzz')
    expect(rows(mount_.container)).toHaveLength(0)
    expect(mount_.container.textContent).toContain('没有匹配「zzz」的技能')
    mount_.dispose()
  })

  it('user pressing Escape in the search box clears the query', async () => {
    const api = fakeApi([async () => searchPayload])
    const mount_ = mount(api)
    await flush()
    await typeSearch(mount_.container, 'alpha')
    expect(rows(mount_.container)).toHaveLength(2)
    const input = mount_.container.querySelector('input[type="search"]') as HTMLInputElement
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(rows(mount_.container)).toHaveLength(3)
    mount_.dispose()
  })
})

describe('SkillPanel edit flow (#1622)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('user editing a skill from its card saves the edited fields', async () => {
    // Given a panel listing one skill, with a host that reads and updates it
    const read = vi.fn(async (name: string, path: string) => ({ name, path, description: '旧描述', whenToUse: '旧场景', content: '# 旧正文' }))
    const update = vi.fn(async (payload: { name: string; path: string; description: string; whenToUse?: string; content: string }) => ({
      ok: true as const,
      name: payload.name,
      path: payload.path,
      disabled: false,
    }))
    const api = fakeApi([async () => payload(['demo-skill'])], { read, update })
    const mount_ = mount(api)
    await flush()

    // When the user opens the card editor (Edit sits next to Delete)
    const editButton = Array.from(mount_.container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '编辑')
    expect(editButton).toBeInstanceOf(HTMLButtonElement)
    await act(async () => { editButton!.click() })
    // Two turns: the host read resolves, then the form re-renders with it.
    await flush()
    await flush()

    expect(read).toHaveBeenCalledWith('demo-skill', '/work/demo-skill/SKILL.md')
    // The form is prefilled from the host read, and the name is fixed.
    const description = Array.from(mount_.container.querySelectorAll('input')).find((input) => input.value === '旧描述') as HTMLInputElement
    expect(description).toBeInstanceOf(HTMLInputElement)
    expect(Array.from(mount_.container.querySelectorAll('input')).some((input) => input.value === 'demo-skill' && input.readOnly)).toBe(true)
    expect((mount_.container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('# 旧正文')

    // When the user edits the description and submits the form
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(description, '新描述')
      description.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = mount_.container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flush()

    // Then the host receives the edited fields
    expect(update).toHaveBeenCalledOnce()
    expect(update.mock.calls[0]![0]).toMatchObject({
      name: 'demo-skill',
      path: '/work/demo-skill/SKILL.md',
      description: '新描述',
      whenToUse: '旧场景',
      content: '# 旧正文',
    })
    // The list refetch settles before the panel goes back to its list view.
    await flush()

    // And saving returns to the list, where the refreshed card is back
    const savedRow = mount_.container.querySelector('[data-dsh-part="skill-row"]')
    expect(savedRow?.textContent).toContain('demo-skill')
    mount_.dispose()
  })

  it('user whose skill read fails sees the failure instead of an empty form', async () => {
    // Given a panel listing one skill whose host read fails
    const read = vi.fn(async () => { throw new Error('gone') })
    const api = fakeApi([async () => payload(['demo-skill'])], { read })
    const mount_ = mount(api)
    await flush()

    // When the user opens the card editor
    const editButton = Array.from(mount_.container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '编辑')
    await act(async () => { editButton!.click() })
    await flush()
    await flush()

    // Then the panel reports the failure instead of an empty form
    expect(mount_.container.textContent).toContain('读取失败：gone')
    mount_.dispose()
  })
})
