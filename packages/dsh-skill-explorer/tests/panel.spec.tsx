/**
 * Panel interaction tests (jsdom): Escape-dismiss semantics around form
 * fields, and the last-good list policy when a refresh fails.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillPanel } from '../src/client/SkillPanel.tsx'
import type { ListPayload } from '../src/client/api.ts'

/** Minimal fake api: list is controllable per call, other methods overridable. */
function fakeApi(listResults: Array<() => Promise<ListPayload>>, overrides: Record<string, unknown> = {}) {
  let calls = 0
  return {
    calls: () => calls,
    list: async () => { const fn = listResults[Math.min(calls, listResults.length - 1)]; calls += 1; return fn() },
    setEnabled: async () => ({ name: '', enabled: true }),
    remove: async () => ({ ok: true as const, name: '', moved: '' }),
    create: async () => { throw new Error('unused') },
    read: async (name: string, path: string) => ({ name, path, description: '', content: '' }),
    update: async () => ({ ok: true as const, name: '', path: '', disabled: false }),
    ...overrides,
  }
}

const payload = (names: string[]): ListPayload => ({
  cwd: '/work',
  projectRoots: [],
  complete: true,
  groups: [{ key: 'user-dsh', title: 'User skills', hint: '', skills: names.map((name) => ({
    name, description: 'desc', provider: 'filesystem', level: 'user-dsh', path: '/work/' + name + '/SKILL.md',
    modelInvocable: true, userInvocable: true,
  })) }],
})

function mount(api: ReturnType<typeof fakeApi>, onClose: () => void): { container: HTMLDivElement; dispose: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // Render inside act so the commit and passive effects (the document
  // keydown listener) are drained synchronously; an unwrapped render rides
  // the Scheduler and can lose the race on slow CI runners.
  act(() => {
    root.render(<SkillPanel api={api as never} onClose={onClose} />)
  })
  return {
    container,
    dispose: () => {
      root.unmount()
      container.remove()
    },
  }
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

describe('SkillPanel header', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('renders clean modal title without showing misleading cwd path (#1215)', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api, () => {})
    await flush()
    const head = mount_.container.querySelector('header')
    expect(head?.textContent).toContain('技能中心')
    expect(head?.textContent).not.toContain('cwd:')
    mount_.dispose()
  })
})

describe('SkillPanel escape handling', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('Escape dismisses the panel when not typing in a form field', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    let closed = 0
    const mount_ = mount(api, () => { closed += 1 })
    await flush()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(closed).toBe(1)
    mount_.dispose()
  })

  it('Escape while typing in the create form keeps the panel open', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    let closed = 0
    const mount_ = mount(api, () => { closed += 1 })
    await flush()
    // Switch to the create tab and focus the name input.
    await act(async () => {
      const tab = Array.from(mount_.container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '创建')
      tab?.click()
    })
    const input = mount_.container.querySelector('input') as HTMLInputElement
    input.focus()
    expect(document.activeElement).toBe(input)
    // Dispatch from the focused element so the event target is the input.
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(closed).toBe(0)
    mount_.dispose()
  })

  it('Escape in a select keeps the panel open', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    let closed = 0
    const mount_ = mount(api, () => { closed += 1 })
    await flush()
    await act(async () => {
      const tab = Array.from(mount_.container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '创建')
      tab?.click()
    })
    const select = mount_.container.querySelector('select') as HTMLSelectElement
    select.focus()
    await act(async () => {
      select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(closed).toBe(0)
    mount_.dispose()
  })
})

describe('SkillPanel last-good list policy', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('a failed refresh keeps the previous payload and shows an inline error', async () => {
    const api = fakeApi([
      async () => payload(['demo-skill']),
      async () => { throw new Error('boom') },
    ])
    const mount_ = mount(api, () => {})
    await flush()
    expect(mount_.container.textContent).toContain('demo-skill')
    // Trigger a refresh that will fail.
    await act(async () => {
      const refresh = Array.from(mount_.container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '刷新')
      refresh?.click()
    })
    await flush()
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

  it('forwards the displayed skill path when toggling', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const setEnabled = vi.fn(async () => ({ name: 'demo-skill', enabled: false }))
    api.setEnabled = setEnabled
    const mount_ = mount(api, () => {})
    await flush()
    const toggle = mount_.container.querySelector('[role="switch"]') as HTMLButtonElement
    await act(async () => {
      toggle.click()
    })
    await flush()
    expect(setEnabled).toHaveBeenCalledWith('demo-skill', '/work/demo-skill/SKILL.md', false)
    mount_.dispose()
  })

  it('forwards the displayed skill path when deleting', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const api = fakeApi([async () => payload(['demo-skill'])])
    const remove = vi.fn(async () => ({ ok: true as const, name: 'demo-skill', moved: '/trash/SKILL.md' }))
    api.remove = remove
    const mount_ = mount(api, () => {})
    await flush()
    const deleteButton = Array.from(mount_.container.querySelectorAll('button')).find(button => button.textContent?.trim() === '删除')
    await act(async () => {
      deleteButton?.click()
    })
    await flush()
    expect(remove).toHaveBeenCalledWith('demo-skill', '/work/demo-skill/SKILL.md')
    mount_.dispose()
  })

  it('renders localized provider badge and invokable badge tooltip (#1304, #1305)', async () => {
    const api = fakeApi([async () => payload(['demo-skill'])])
    const mount_ = mount(api, () => {})
    await flush()
    const badges = Array.from(mount_.container.querySelectorAll('span'))
    const providerBadge = badges.find(b => b.textContent?.trim() === '文件系统')
    expect(providerBadge).toBeInstanceOf(HTMLSpanElement)
    expect(providerBadge?.getAttribute('title')).toBe('技能来源：文件系统')

    const invokableBadge = badges.find(b => b.textContent?.includes('可调用'))
    expect(invokableBadge).toBeInstanceOf(HTMLSpanElement)
    expect(invokableBadge?.getAttribute('title')).toBe('模型可自动调用该技能；手动 /skill 指令不受影响')
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
        { name: 'gamma-skill', description: 'unrelated', provider: 'filesystem', level: 'user-dsh', path: '/work/gamma-skill/SKILL.md', modelInvocable: true, userInvocable: true },
        { name: 'beta-skill', description: 'alpha related helper', provider: 'filesystem', level: 'user-dsh', path: '/work/beta-skill/SKILL.md', modelInvocable: true, userInvocable: true },
        { name: 'alpha-skill', description: 'first helper', provider: 'filesystem', level: 'user-dsh', path: '/work/alpha-skill/SKILL.md', modelInvocable: true, userInvocable: true },
      ],
    }],
  }

  /** Type into the search box the way React's controlled input expects. */
  async function typeSearch(container: HTMLElement, value: string): Promise<void> {
    const input = container.querySelector('#dsh-skill-search') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function rows(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('[data-dsh-part="skill-row"]')).map(row => row.querySelector('span')?.textContent ?? '')
  }

  it('filters by name and description with name hits first', async () => {
    const api = fakeApi([async () => searchPayload])
    const mount_ = mount(api, () => {})
    await flush()
    expect(rows(mount_.container)).toHaveLength(3)
    await typeSearch(mount_.container, 'ALPHA')
    expect(rows(mount_.container)).toEqual(['alpha-skill', 'beta-skill'])
    mount_.dispose()
  })

  it('shows an empty state, and the clear button restores the list', async () => {
    const api = fakeApi([async () => searchPayload])
    const mount_ = mount(api, () => {})
    await flush()
    await typeSearch(mount_.container, 'zzz')
    expect(rows(mount_.container)).toHaveLength(0)
    expect(mount_.container.textContent).toContain('没有匹配「zzz」的技能')
    await act(async () => {
      const clear = Array.from(mount_.container.querySelectorAll('button')).find(button => button.textContent?.trim() === '清空')
      clear?.click()
    })
    expect(rows(mount_.container)).toHaveLength(3)
    mount_.dispose()
  })

  it('Escape inside the search box clears the query without closing the panel', async () => {
    const api = fakeApi([async () => searchPayload])
    let closed = 0
    const mount_ = mount(api, () => { closed += 1 })
    await flush()
    await typeSearch(mount_.container, 'alpha')
    expect(rows(mount_.container)).toHaveLength(2)
    const input = mount_.container.querySelector('#dsh-skill-search') as HTMLInputElement
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(rows(mount_.container)).toHaveLength(3)
    expect(closed).toBe(0)
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
    const mount_ = mount(api, () => {})
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
    const mount_ = mount(api, () => {})
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


