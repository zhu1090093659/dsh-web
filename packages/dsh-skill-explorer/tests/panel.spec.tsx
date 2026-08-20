/**
 * Panel interaction tests (jsdom): Escape-dismiss semantics around form
 * fields, and the last-good list policy when a refresh fails.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillPanel } from '../src/client/SkillPanel.tsx'
import type { ListPayload } from '../src/client/api.ts'

/** Minimal fake api: list is controllable per call, other methods never used here. */
function fakeApi(listResults: Array<() => Promise<ListPayload>>) {
  let calls = 0
  return {
    calls: () => calls,
    list: async () => { const fn = listResults[Math.min(calls, listResults.length - 1)]; calls += 1; return fn() },
    setEnabled: async () => ({ name: '', enabled: true }),
    remove: async () => ({ ok: true as const, name: '', moved: '' }),
    create: async () => { throw new Error('unused') },
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
})
