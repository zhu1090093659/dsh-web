/**
 * Panel interaction tests (jsdom): Escape-dismiss semantics around form
 * fields, and the last-good list policy when a refresh fails.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
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
  root.render(<SkillPanel api={api as never} onClose={onClose} />)
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
