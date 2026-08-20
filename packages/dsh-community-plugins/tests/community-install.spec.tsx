/** @vitest-environment jsdom */

/**
 * The marketplace install states: with the optional 'pluginManager' service
 * bridged in and loopback authority, each card offers in-GUI install (with a
 * polled stage line), an installed badge with a confirmed uninstall, and an
 * inline error on failure; with the service absent or remote, the card keeps
 * the exact read-only copy-command UI plus a subtle hint.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import React, { useSyncExternalStore, type ComponentProps } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the one value
// member the card chain needs.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: unknown) => {
    let value = init
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      set: (next: unknown) => { value = next; for (const listener of listeners) listener() },
      update: (mutator: (draft: never) => void) => { mutator(value as never); for (const listener of listeners) listener() },
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
  },
}))
// The official primitives pull in shiki/katex at module scope; stub the two
// members the card consumes (same stance as the plugin-manager tab tests).
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const create = (React.createElement as (...args: unknown[]) => unknown).bind(React)
  return {
    Button: (props: Record<string, unknown>) =>
      create('button', { disabled: props['disabled'], onClick: props['onClick'], className: props['className'] }, props['children']),
    Modal: (props: Record<string, unknown>) =>
      props['open'] === true ? create('div', { role: 'dialog' }, props['title'], props['children']) : null,
  }
})
import { CommunityPluginsCard, CommunityPluginsCardController, type CommunityPluginsCardProps, type CommunityPluginsSettings } from '../src/client/CommunityPluginsCard.tsx'
import { en } from '../src/client/locales.ts'
import type { CommunityPluginEntry } from '../src/client/generated/community.ts'
import type { InstalledPluginItem, InstallProgressItem, PluginManagerService } from '../src/client/plugin-manager-bridge.ts'

afterEach(cleanup)

/** English translate stub with {param} interpolation. */
const t: CommunityPluginsCardProps['t'] = (key, params) => {
  const text = (en as Record<string, string>)[key] ?? key
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}

/** Minimal in-memory scope backing the card controller. */
class FakeScope implements SettingsScope<CommunityPluginsSettings> {
  value: CommunityPluginsSettings
  base: CommunityPluginsSettings
  user: Partial<CommunityPluginsSettings> = {}
  writable = true
  private listeners = new Set<() => void>()
  set = vi.fn(async (field: string, value: unknown) => {
    (this.user as Record<string, unknown>)[field] = value
    this.reflect()
  })
  unset = vi.fn(async (field: string) => {
    delete (this.user as Record<string, unknown>)[field]
    this.reflect()
  })
  constructor(value: CommunityPluginsSettings) {
    this.value = value
    this.base = value
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getSnapshot(): SettingsScopeSnapshot<CommunityPluginsSettings> {
    return { status: 'ready', writable: this.writable, value: this.value, base: this.base, user: this.user, revision: 1, mode: 'host' }
  }
  private reflect(): void {
    this.value = { ...this.base, ...this.user }
    for (const listener of this.listeners) listener()
  }
}

/** Bind the controller's face into the card's prop shape (mirrors the slot renderer). */
function cardProps(
  scope: SettingsScope<CommunityPluginsSettings>,
  plugins: readonly CommunityPluginEntry[],
  pluginManager: PluginManagerService | null,
) {
  const controller = new CommunityPluginsCardController(scope)
  const face = controller.inject()
  const { hooks, ...actions } = face
  const useCommunityPluginsCard = <S,>(selector: (snapshot: ReturnType<typeof hooks.communityPluginsCard.getSnapshot>) => S) =>
    useSyncExternalStore(
      hooks.communityPluginsCard.subscribe,
      () => selector(hooks.communityPluginsCard.getSnapshot()),
    )
  return { t, plugins, pluginManager, useCommunityPluginsCard, ...actions } as unknown as ComponentProps<typeof CommunityPluginsCard>
}

const NPM_ENTRY: CommunityPluginEntry = {
  id: 'dsh-sample',
  name: 'Sample',
  nameEn: 'Sample Plugin',
  author: 'someone',
  description: 'Sample.',
  descriptionEn: 'A sample entry.',
  repo: 'https://github.com/someone/dsh-sample',
  npm: '@someone/dsh-sample',
  category: 'knowledge',
}

const SECOND_ENTRY: CommunityPluginEntry = {
  id: 'dsh-beta',
  name: 'Beta',
  nameEn: 'Beta UI',
  author: 'bob',
  descriptionEn: 'A UI plugin.',
  repo: 'https://github.com/bob/dsh-beta',
  category: 'ui',
}

/** The installed row the service reports once NPM_ENTRY is installed. */
const INSTALLED_ROW: InstalledPluginItem = {
  id: '@someone/dsh-sample',
  name: 'Sample Plugin',
  version: '1.0.0',
  source: { kind: 'npm', spec: '@someone/dsh-sample' },
  installedAt: '2026-01-01T00:00:00.000Z',
  enabled: true,
}

/** A fake pluginManager face; every member is a spy the test overrides. */
function fakeFace(overrides: Partial<PluginManagerService> = {}): PluginManagerService {
  return {
    isLoopback: true,
    list: vi.fn(async () => []),
    install: vi.fn(async () => INSTALLED_ROW),
    uninstall: vi.fn(async () => []),
    status: vi.fn(async (): Promise<InstallProgressItem> => ({ kind: 'idle', stage: 'fetch' })),
    onChange: vi.fn(() => () => {}),
    ...overrides,
  }
}

/** A manually settled promise for the in-flight install test. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('CommunityPluginsCard install states', () => {
  it('keeps the plain copy-command index when the service is absent', () => {
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}), [NPM_ENTRY], null)} />)
    expect(screen.getByRole('button', { name: 'Copy install command' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
    expect(screen.getByText(/Plugin manager plugin is not detected/)).toBeTruthy()
  })

  it('keeps the copy-command UI for remote browsers, with a hint', async () => {
    const face = fakeFace({ isLoopback: false })
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}), [NPM_ENTRY], face)} />)
    expect(screen.getByRole('button', { name: 'Copy install command' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.getByText(/remote browser/)).toBeTruthy()
    // Read-only: the remote face is never asked for its snapshot.
    await Promise.resolve()
    expect(face.list).not.toHaveBeenCalled()
  })

  it('installs from the card and lands on the installed badge', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce([] as InstalledPluginItem[])
      .mockResolvedValue([INSTALLED_ROW])
    const face = fakeFace({ list })
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}), [NPM_ENTRY], face)} />)
    const install = await screen.findByRole('button', { name: 'Install' })
    fireEvent.click(install)
    expect(face.install).toHaveBeenCalledWith('@someone/dsh-sample')
    // After resolution the list refreshes and the badge + Uninstall appear.
    expect(await screen.findByText('Installed · restart to take effect')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Uninstall' })).toBeTruthy()
    // The copy-command fallback stays available in every state.
    expect(screen.getByRole('button', { name: 'Copy install command' })).toBeTruthy()
  })

  it('keeps a mutation refresh newer than an earlier list request', async () => {
    const initialList = deferred<InstalledPluginItem[]>()
    const list = vi.fn()
      .mockImplementationOnce(() => initialList.promise)
      .mockResolvedValue([INSTALLED_ROW])
    const face = fakeFace({ list })
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}), [NPM_ENTRY], face)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))
    expect(await screen.findByText('Installed · restart to take effect')).toBeTruthy()

    await act(async () => {
      initialList.resolve([])
      await initialList.promise
    })
    expect(screen.getByText('Installed · restart to take effect')).toBeTruthy()
  })

  it('ignores an install completion from a replaced plugin-manager face', async () => {
    const pending = deferred<InstalledPluginItem>()
    const previousFace = fakeFace({
      install: vi.fn(() => pending.promise),
      list: vi.fn(async () => []),
    })
    const currentFace = fakeFace({ list: vi.fn(async () => [INSTALLED_ROW]) })
    const scope = new FakeScope({})
    const view = render(<CommunityPluginsCard {...cardProps(scope, [NPM_ENTRY], previousFace)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))
    view.rerender(<CommunityPluginsCard {...cardProps(scope, [NPM_ENTRY], currentFace)} />)
    expect(await screen.findByText('Installed · restart to take effect')).toBeTruthy()

    await act(async () => {
      pending.resolve(INSTALLED_ROW)
      await pending.promise
    })
    expect(screen.getByText('Installed · restart to take effect')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Uninstall' })).toHaveProperty('disabled', false)
  })

  it('ignores an install failure from a replaced plugin-manager face', async () => {
    const pending = deferred<InstalledPluginItem>()
    const previousFace = fakeFace({ install: vi.fn(() => pending.promise) })
    const currentFace = fakeFace()
    const scope = new FakeScope({})
    const view = render(<CommunityPluginsCard {...cardProps(scope, [NPM_ENTRY], previousFace)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))
    view.rerender(<CommunityPluginsCard {...cardProps(scope, [NPM_ENTRY], currentFace)} />)
    await screen.findByRole('button', { name: 'Install' })

    await act(async () => {
      pending.reject(new Error('old connection failed'))
      await pending.promise.catch(() => undefined)
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Install' })).toHaveProperty('disabled', false)
  })

  it('shows the polled stage while installing and locks other cards', async () => {
    const pending = deferred<InstalledPluginItem>()
    const face = fakeFace({
      install: vi.fn(() => pending.promise),
      status: vi.fn(async (): Promise<InstallProgressItem> => ({ kind: 'install', stage: 'download', percent: 40 })),
    })
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}), [NPM_ENTRY, SECOND_ENTRY], face)} />)
    const buttons = await screen.findAllByRole('button', { name: 'Install' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0]!)
    // The stage line comes from the status() poll, not the install promise.
    expect(await screen.findByText('Downloading')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Installing…' })).toHaveProperty('disabled', true)
    // The other card's mutation button is disabled for the duration.
    expect(screen.getByRole('button', { name: 'Install' })).toHaveProperty('disabled', true)
    pending.resolve(INSTALLED_ROW)
    await screen.findAllByRole('button', { name: 'Install' })
  })

  it('uninstalls only after the confirmation dialog', async () => {
    const face = fakeFace({ list: vi.fn(async () => [INSTALLED_ROW]) })
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}), [NPM_ENTRY], face)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Uninstall' }))
    expect(face.uninstall).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Uninstall Sample Plugin?')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm uninstall' }))
    expect(face.uninstall).toHaveBeenCalledWith('@someone/dsh-sample')
    // The fresh snapshot has no row: the card returns to the install state.
    await screen.findByRole('button', { name: 'Install' })
    expect(screen.queryByText('Installed · restart to take effect')).toBeNull()
  })

  it('ignores an uninstall completion from a replaced plugin-manager face', async () => {
    const pending = deferred<InstalledPluginItem[]>()
    const previousFace = fakeFace({
      list: vi.fn(async () => [INSTALLED_ROW]),
      uninstall: vi.fn(() => pending.promise),
    })
    const currentFace = fakeFace({ list: vi.fn(async () => [INSTALLED_ROW]) })
    const scope = new FakeScope({})
    const view = render(<CommunityPluginsCard {...cardProps(scope, [NPM_ENTRY], previousFace)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Uninstall' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm uninstall' }))
    view.rerender(<CommunityPluginsCard {...cardProps(scope, [NPM_ENTRY], currentFace)} />)
    expect(await screen.findByText('Installed · restart to take effect')).toBeTruthy()

    await act(async () => {
      pending.resolve([])
      await pending.promise
    })
    expect(screen.getByText('Installed · restart to take effect')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Uninstall' })).toHaveProperty('disabled', false)
  })

  it('shows a bilingual-keyed inline error when install fails', async () => {
    const face = fakeFace({ install: vi.fn(async () => { throw new Error('ENOENT exploded') }) })
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}), [NPM_ENTRY], face)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Install failed: ENOENT exploded')
    // The card recovers: the install button is usable again.
    expect(await screen.findByRole('button', { name: 'Install' })).toHaveProperty('disabled', false)
  })

  it('matches git entries by normalized repository URL', async () => {
    const gitRow: InstalledPluginItem = {
      ...INSTALLED_ROW,
      id: 'dsh-beta',
      source: { kind: 'git', spec: 'git@github.com:Bob/dsh-beta.git' },
    }
    const face = fakeFace({ list: vi.fn(async () => [gitRow]) })
    render(<CommunityPluginsCard {...cardProps(new FakeScope({}), [SECOND_ENTRY], face)} />)
    expect(await screen.findByText('Installed · restart to take effect')).toBeTruthy()
  })
})
