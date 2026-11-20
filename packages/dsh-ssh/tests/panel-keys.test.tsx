// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeysTab } from '../src/client/panel/KeysTab.tsx'
import type { SshApi } from '../src/client/api.ts'
import type { SshKeySummary } from '../src/protocol.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const referenced: SshKeySummary = {
  id: 'key-work', name: 'Work key', path: '/keys/work', hasPassphrase: true,
  exists: false, usedBy: ['web-01', 'db-01'], note: 'shared', createdAt: 1, updatedAt: 1,
}

function fakeApi(keys: SshKeySummary[] = [referenced]): SshApi {
  return {
    listKeys: vi.fn(async () => keys),
    createKey: vi.fn(async () => referenced),
    updateKey: vi.fn(async () => referenced),
    deleteKey: vi.fn(async () => undefined),
  } as unknown as SshApi
}

async function renderKeys(api: SshApi, confirmAction?: (message: string) => boolean): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(<KeysTab api={api} confirmAction={confirmAction} />) })
  return container
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(candidate => candidate.textContent === text)
  if (found === undefined) throw new Error('button not found: ' + text)
  return found as HTMLButtonElement
}

function field(container: HTMLElement, label: string): HTMLInputElement {
  const labelElement = [...container.querySelectorAll('label')].find(candidate => candidate.textContent?.startsWith(label))
  const input = labelElement?.querySelector('input')
  if (input == null) throw new Error('field not found: ' + label)
  return input as HTMLInputElement
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('SSH managed keys tab (#2069)', () => {
  it('user sees path existence and the hosts referencing each key', async () => {
    // Given a managed key referenced by two hosts whose file is missing
    const api = fakeApi()
    // When the keys tab renders
    const container = await renderKeys(api)
    // Then the security-relevant metadata is visible without a passphrase value
    expect(container.textContent).toContain('Work key')
    expect(container.textContent).toContain('/keys/work')
    expect(container.textContent).toContain('文件不存在')
    expect(container.textContent).toContain('2 台：web-01, db-01')
    expect(container.textContent).not.toContain('secret')
  })

  it('user creates a managed path and optional passphrase through the dialog', async () => {
    // Given an empty managed-key list and the add dialog
    const api = fakeApi([])
    const container = await renderKeys(api)
    await act(async () => { button(container, '新增密钥').click() })
    await type(field(container, '名称'), 'Deploy key')
    await type(field(container, '私钥路径'), '/keys/deploy')
    await type(field(container, '密钥口令'), 'new-secret')
    // When the user saves
    await act(async () => { button(container, '保存').click() })
    // Then the API receives only the intended managed record fields
    expect(vi.mocked(api.createKey).mock.calls[0]![0]).toEqual({
      name: 'Deploy key', path: '/keys/deploy', note: '', passphrase: 'new-secret',
    })
  })

  it('user editing a referenced key sees its host aliases before any write', async () => {
    // Given a referenced key and an operator who cancels the first warning
    const api = fakeApi()
    const confirm = vi.fn((_message: string) => false).mockReturnValueOnce(false).mockReturnValueOnce(true)
    const container = await renderKeys(api, confirm)
    await act(async () => { button(container, '编辑').click() })
    // When save is attempted, cancelled, and then confirmed
    await act(async () => { button(container, '保存').click() })
    expect(vi.mocked(api.updateKey)).not.toHaveBeenCalled()
    await act(async () => { button(container, '保存').click() })
    // Then the warning names every host and only the confirmed attempt writes
    expect(confirm.mock.calls[0]![0]).toContain('web-01, db-01')
    expect(vi.mocked(api.updateKey)).toHaveBeenCalledOnce()
  })

  it('user deleting a referenced key is told that hosts and key files stay intact', async () => {
    // Given a referenced managed key
    const api = fakeApi()
    const confirm = vi.fn((_message: string) => false)
    const container = await renderKeys(api, confirm)
    // When the user opens the delete confirmation and cancels
    await act(async () => { button(container, '删除').click() })
    // Then it names the hosts and no deletion request is sent
    expect(confirm.mock.calls[0]![0]).toContain('web-01, db-01')
    expect(confirm.mock.calls[0]![0]).toContain('保留')
    expect(vi.mocked(api.deleteKey)).not.toHaveBeenCalled()
  })
})
