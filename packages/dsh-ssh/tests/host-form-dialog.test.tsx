// @vitest-environment jsdom
/**
 * Host form payload tests (#1910).
 *
 * Editing a host whose auth is switched to SSH Agent with the agent path left
 * empty used to drop the whole `auth` block: the form treated the non-secret
 * `agentPath` as a credential, the PATCH carried no `auth` field, and the
 * store's `patch.auth !== undefined` guard turned the save into a silent
 * no-op that kept the previous auth kind. The form now submits agent auth
 * unconditionally, while password and key still preserve the stored
 * credential when their secret field is left empty.
 */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostFormDialog } from '../src/client/panel/HostFormDialog.tsx'
import type { SshApi } from '../src/client/api.ts'
import type { HostPayload, SshPanelHostSummary } from '../src/protocol.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeHost(alias: string, extra: Partial<SshPanelHostSummary> = {}): SshPanelHostSummary {
  return {
    alias,
    host: alias + '.example.com',
    port: 22,
    user: 'root',
    auth: 'key',
    keyReady: true,
    proxyJump: [],
    forwardAgent: false,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

function makeApi(): SshApi {
  return {
    listHosts: vi.fn(async () => []),
    listKeys: vi.fn(async () => []),
    createHost: vi.fn(async (payload: HostPayload) => makeHost(payload.alias ?? 'new-host')),
    updateHost: vi.fn(async (alias: string) => makeHost(alias)),
  } as unknown as SshApi
}

const mountedRoots: { root: ReturnType<typeof createRoot> }[] = []

afterEach(() => {
  for (const { root } of mountedRoots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
})

/** Find a labelled form field by its visible label text. */
function fieldOf(container: HTMLElement, label: string): HTMLElement {
  const field = [...container.querySelectorAll('label')].find(el => el.textContent?.startsWith(label))
  if (field === undefined) throw new Error('field not found: ' + label)
  return field
}

/** Write a value into a controlled input the way a real keystroke does. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Tick a radio by its visible label text. */
async function chooseAuth(container: HTMLElement, label: string): Promise<void> {
  const radio = [...container.querySelectorAll('label')]
    .filter(el => el.textContent?.trim() === label)
    .map(el => el.querySelector('input[type="radio"]') as HTMLInputElement | null)
    .find((input): input is HTMLInputElement => input !== null)
  if (radio === undefined) throw new Error('radio not found: ' + label)
  await act(async () => { radio.click() })
}

const saveButtonOf = (container: HTMLElement): HTMLButtonElement =>
  [...container.querySelectorAll('button')].find(button => button.textContent === '保存') as HTMLButtonElement

async function renderEdit(host: SshPanelHostSummary, api: SshApi): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push({ root })
  await act(async () => {
    root.render(<HostFormDialog api={api} editing={host} onClose={() => undefined} onSaved={() => undefined} />)
  })
  return container
}

describe('HostFormDialog editing auth (#1910)', () => {
  it('user switches a key host to SSH Agent with an empty path and the agent auth is submitted', async () => {
    // Given a stored key-auth host opened in the edit dialog
    const api = makeApi()
    const container = await renderEdit(makeHost('build-1'), api)

    // When the user picks SSH Agent and saves without filling the agent path
    await chooseAuth(container, 'SSH Agent')
    await typeInto(fieldOf(container, 'Agent 路径').querySelector('input') as HTMLInputElement, '')
    await act(async () => { saveButtonOf(container).click() })

    // Then the PATCH still carries an auth block, so the store switches the
    // host instead of treating the save as "no change"
    const updateHost = vi.mocked(api.updateHost)
    expect(updateHost.mock.calls.length).toBe(1)
    const payload = updateHost.mock.calls[0]![1]
    expect(payload.auth).toEqual({ kind: 'agent', agentPath: undefined })
    expect('auth' in payload).toBe(true)
  })

  it('user switches a password host to SSH Agent with a path and the path is submitted', async () => {
    // Given a stored password-auth host
    const api = makeApi()
    const container = await renderEdit(makeHost('db-1', { auth: 'password' }), api)

    // When the user picks SSH Agent, types an endpoint, and saves
    await chooseAuth(container, 'SSH Agent')
    await typeInto(fieldOf(container, 'Agent 路径').querySelector('input') as HTMLInputElement, '/tmp/agent.sock')
    await act(async () => { saveButtonOf(container).click() })

    // Then the endpoint travels with the auth block
    expect(vi.mocked(api.updateHost).mock.calls[0]![1].auth).toEqual({ kind: 'agent', agentPath: '/tmp/agent.sock' })
  })

  it('user leaving the password field empty keeps the stored credential by omitting auth', async () => {
    // Given a stored password-auth host whose secret is never echoed back
    const api = makeApi()
    const container = await renderEdit(makeHost('pw-1', { auth: 'password' }), api)

    // When the user saves without typing a new password
    await act(async () => { saveButtonOf(container).click() })

    // Then the auth block stays omitted, which is how the store preserves it
    expect(vi.mocked(api.updateHost).mock.calls[0]![1].auth).toBeUndefined()
  })

  it('user leaving the key path empty keeps the stored credential by omitting auth', async () => {
    // Given a stored key-auth host
    const api = makeApi()
    const container = await renderEdit(makeHost('key-1'), api)

    // When the user saves without retyping the key path
    await act(async () => { saveButtonOf(container).click() })

    // Then the auth block stays omitted
    expect(vi.mocked(api.updateHost).mock.calls[0]![1].auth).toBeUndefined()
  })

  it('user editing a matching hand-written path gets the managed key selected automatically', async () => {
    // Given a legacy host path equal to a managed key path
    const api = makeApi()
    vi.mocked(api.listKeys).mockResolvedValue([{
      id: 'key-work', name: 'Work key', path: '/keys/work', hasPassphrase: true,
      exists: true, usedBy: ['managed-1'], createdAt: 1, updatedAt: 1,
    }])
    const container = await renderEdit(makeHost('managed-1', { keyPath: '/keys/work' }), api)
    // When the managed list loads and the user saves
    const select = container.querySelector('select[aria-label="受管密钥"]') as HTMLSelectElement
    expect(select.value).toBe('key-work')
    await act(async () => { saveButtonOf(container).click() })
    // Then the visual match does not silently replace a legacy host's stored passphrase
    const payload = vi.mocked(api.updateHost).mock.calls[0]![1]
    expect(payload.managedKeyId).toBeUndefined()
    expect(payload.auth).toEqual({ kind: 'key', keyPath: '/keys/work', passphrase: undefined })
  })

  it('user explicitly selecting a managed key sends its transient id and path', async () => {
    // Given a custom-path host and an available managed key
    const api = makeApi()
    vi.mocked(api.listKeys).mockResolvedValue([{
      id: 'key-work', name: 'Work key', path: '/keys/work', hasPassphrase: true,
      exists: true, usedBy: [], createdAt: 1, updatedAt: 1,
    }])
    const container = await renderEdit(makeHost('select-1', { keyPath: '/custom/id_rsa' }), api)
    const select = container.querySelector('select[aria-label="受管密钥"]') as HTMLSelectElement
    // When the user actively chooses the managed key and saves
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set?.call(select, 'key-work')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { saveButtonOf(container).click() })
    // Then the Host resolves the selected credentials without returning the managed passphrase
    const payload = vi.mocked(api.updateHost).mock.calls[0]![1]
    expect(payload.managedKeyId).toBe('key-work')
    expect(payload.auth).toEqual({ kind: 'key', keyPath: '/keys/work', passphrase: undefined })
  })

  it('user editing an unmatched hand-written path keeps it as a custom path', async () => {
    // Given a stored custom path not present in the managed list
    const api = makeApi()
    vi.mocked(api.listKeys).mockResolvedValue([{
      id: 'key-other', name: 'Other', path: '/keys/other', hasPassphrase: false,
      exists: false, usedBy: [], createdAt: 1, updatedAt: 1,
    }])
    const container = await renderEdit(makeHost('custom-1', { keyPath: '/custom/id_rsa' }), api)
    // When the list loads and the user saves without changing the selection
    const select = container.querySelector('select[aria-label="受管密钥"]') as HTMLSelectElement
    expect(select.value).toBe('')
    expect((fieldOf(container, '私钥路径').querySelector('input') as HTMLInputElement).value).toBe('/custom/id_rsa')
    await act(async () => { saveButtonOf(container).click() })
    // Then the original path is preserved and no managed id is invented
    const payload = vi.mocked(api.updateHost).mock.calls[0]![1]
    expect(payload.managedKeyId).toBeUndefined()
    expect(payload.auth).toEqual({ kind: 'key', keyPath: '/custom/id_rsa', passphrase: undefined })
  })

  it('user hint no longer claims an empty agent path keeps the previous auth kind', async () => {
    // Given the edit dialog of any host
    const api = makeApi()
    const container = await renderEdit(makeHost('hint-1'), api)

    // When the dialog renders its auth hint
    const hint = container.textContent ?? ''

    // Then the copy says an empty agent path is auto-detect, not "keep the
    // stored authentication" — the wording that hid the defect from users
    expect(hint).toContain('Agent 路径留空是合法的自动检测')
    expect(hint).not.toContain('密钥/密码/Agent 留空')
  })
})
