/** @vitest-environment jsdom */

/**
 * Presets panel contract: catalog rows join the host state by id, install
 * downloads and then declares, executable content is gated behind the
 * confirmation modal, and the gateway-unavailable path degrades to a note.
 * The host routes themselves are covered by tests/routes.spec.ts.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const create = (React.createElement as (...args: unknown[]) => unknown).bind(React)
  return {
    Button: (props: Record<string, unknown>) =>
      create('button', { disabled: props['disabled'], onClick: props['onClick'], className: props['className'] }, props['children']),
    Modal: (props: Record<string, unknown>) =>
      props['open'] === true ? create('div', { role: 'dialog' }, props['title'], props['children']) : null,
  }
})

import { PresetPanel, compareVersions, hasUpdate, type PresetPanelProps, type PresetStateRow } from '../src/client/PresetPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const t = ((key: keyof typeof zh, params?: Record<string, unknown>): string => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll('{' + name + '}', String(value))
  return text
}) as PresetPanelProps['t']

const PROFILE = { plugins: ['@deepseek-ai/dsh-persona'], relativeNames: [], inlineExpressions: 0, codeFiles: [], codeExecution: 'none', rows: 1 }

const RECORD = { id: 'demo', name: '演示预设', nameEn: 'Demo preset', author: 'tester', version: '1.1.0', description: '一句话说明。', rank: 1 }

/** One library row the host state route would answer for an installed preset. */
function libraryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'demo', installed: true, enabled: false, managed: true, integrity: 'valid', dir: '/tmp/demo', profile: PROFILE, ...overrides }
}

/**
 * How many rendered nodes carry one piece of panel copy: a value assertion in
 * place of a presence check, so a duplicated badge is visible to the test.
 */
function shownTimes(text: string | RegExp): number {
  return screen.queryAllByText(text).length
}

function stateResponse(presets: unknown[]): Response {
  return new Response(JSON.stringify({ ok: true, defaultId: 'ptc', occupied: [], rosterAvailable: true, presets }), { status: 200 })
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init)))
  vi.stubGlobal('fetch', mock)
  return mock
}

function panelProps(overrides: Partial<PresetPanelProps> = {}): PresetPanelProps {
  return {
    t,
    items: [RECORD],
    catalogState: 'ready',
    gateway: true,
    installs: { demo: 4 },
    ...overrides,
  } as unknown as PresetPanelProps
}

describe('PresetPanel', () => {
  it('operator reads catalog rows with their install state and counts', async () => {
    // Given an installed preset the catalog advertises a newer version of,
    // When the operator opens the panel, Then the row reports both states.
    stubFetch((url) => {
      if (url.includes('/api/preset-center/state')) {
        return stateResponse([libraryRow({ assetVersion: '1.0.0' })])
      }
      return new Response('{}', { status: 404 })
    })

    render(<PresetPanel {...panelProps()} />)

    expect(shownTimes(/演示预设/)).toBe(1)
    expect(shownTimes('安装 4')).toBe(1)
    await waitFor(() => expect(shownTimes(zh['state.installed'])).toBe(1))
    expect(shownTimes(zh['state.newVersion'].replace('{version}', '1.1.0'))).toBe(1)
    expect(shownTimes(zh['code.none'])).toBe(1)
  })

  it('operator installs through the store gateway and the host declares it', async () => {
    // Given a preset the library does not hold yet, When the operator installs
    // it, Then the gateway downloads it and the host declares the download.
    const install = vi.fn(async () => ({ dest: '/home/.dsh/agent-presets/demo' }))
    const reportInstall = vi.fn(async () => 5)
    const declared: unknown[] = []
    stubFetch((url, init) => {
      if (url.includes('/api/preset-center/state')) return stateResponse([])
      if (url.includes('/api/preset-center/install')) {
        declared.push(JSON.parse(String(init?.body ?? '{}')) as unknown)
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })

    render(<PresetPanel {...panelProps({ install, reportInstall })} />)
    fireEvent.click(await screen.findByRole('button', { name: zh['action.install'] }))

    await waitFor(() => expect(install).toHaveBeenCalledWith('demo', false))
    await waitFor(() => expect(reportInstall).toHaveBeenCalledWith('demo'))
    await waitFor(() => expect(declared).toEqual([{ id: 'demo', confirm: false }]))
    await waitFor(() => expect(shownTimes(zh['note.enabled'])).toBe(1))
  })

  it('operator is asked to confirm before executable content is declared', async () => {
    // Given a downloaded preset carrying a local module, When the operator
    // enables it, Then the modal states the trust and the confirmation is what
    // declares it.
    const profile = { plugins: ['@deepseek-ai/dsh-persona'], relativeNames: ['./hook.mjs'], inlineExpressions: 2, codeFiles: ['hook.mjs'], codeExecution: 'local', rows: 2 }
    const bodies: { confirm?: boolean }[] = []
    stubFetch((url, init) => {
      if (url.includes('/api/preset-center/state')) return stateResponse([libraryRow({ profile })])
      if (url.includes('/api/preset-center/install')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { confirm?: boolean }
        bodies.push(body)
        return body.confirm === true
          ? new Response(JSON.stringify({ ok: true }), { status: 200 })
          : new Response(JSON.stringify({ ok: false, error: 'confirmation-required', profile }), { status: 409 })
      }
      return new Response('{}', { status: 404 })
    })

    render(<PresetPanel {...panelProps()} />)
    fireEvent.click(await screen.findByRole('button', { name: zh['action.enable'] }))

    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(1))
    expect(shownTimes(/权限等同 shell 访问/)).toBe(1)

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: zh['action.enable'] }))
    await waitFor(() => expect(bodies).toEqual([{ id: 'demo', confirm: false }, { id: 'demo', confirm: true }]))
    await waitFor(() => expect(shownTimes(zh['note.enabled'])).toBe(1))
  })

  it('operator disables a declared preset and is refused the protected default', async () => {
    // Given a declared preset, When the operator disables it, Then the host
    // confirms; and when the registry default names it, Then the refusal is
    // reported instead.
    let protectedDefault = false
    stubFetch((url) => {
      if (url.includes('/api/preset-center/state')) {
        return stateResponse([libraryRow({ enabled: true })])
      }
      if (url.includes('/api/preset-center/disable')) {
        return protectedDefault
          ? new Response(JSON.stringify({ ok: false, error: 'default-preset' }), { status: 409 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })

    render(<PresetPanel {...panelProps()} />)
    fireEvent.click(await screen.findByRole('button', { name: zh['action.disable'] }))
    await waitFor(() => expect(shownTimes(zh['note.disabled'])).toBe(1))

    protectedDefault = true
    cleanup()
    render(<PresetPanel {...panelProps()} />)
    fireEvent.click(await screen.findByRole('button', { name: zh['action.disable'] }))
    await waitFor(() => expect(shownTimes(zh['note.defaultPreset'])).toBe(1))
  })

  it('operator sees the empty-catalog note and the gateway-unavailable degradation', async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: true, presets: [] }), { status: 200 }))
    render(<PresetPanel {...panelProps({ items: [], gateway: false })} />)
    expect(shownTimes(zh['note.remoteInstall'])).toBe(1)
    await waitFor(() => expect(shownTimes(zh['note.emptyCatalog'])).toBe(1))
    expect(screen.queryByRole('button', { name: zh['action.install'] })).toBeNull()
  })

  it('operator cannot install an id another declaration supplies', async () => {
    // Given the host reports the id as occupied, When the operator opens the
    // panel, Then the row is marked and the install action stays disabled.
    stubFetch((url) => url.includes('/api/preset-center/state')
      ? new Response(JSON.stringify({ ok: true, defaultId: 'ptc', occupied: ['demo'], rosterAvailable: true, presets: [] }), { status: 200 })
      : new Response('{}', { status: 404 }))
    render(<PresetPanel {...panelProps()} />)
    await waitFor(() => expect(shownTimes(zh['state.shadowed'])).toBe(1))
    await waitFor(() => expect((screen.getByRole('button', { name: zh['action.install'] }) as HTMLButtonElement).disabled).toBe(true))
  })
})

describe('hasUpdate and compareVersions', () => {
  it('operator sees an update only when the catalog version is strictly newer', () => {
    // Given installed versions around the catalog version, When the operator
    // compares them, Then only a strictly newer catalog version is offered.
    const record = { ...RECORD, version: '1.2.0' }
    expect(hasUpdate(record, { id: 'demo', installed: true, enabled: false, assetVersion: '1.1.0' } as unknown as PresetStateRow)).toBe(true)
    expect(hasUpdate(record, { id: 'demo', installed: true, enabled: false, assetVersion: '1.2.0' } as unknown as PresetStateRow)).toBe(false)
    expect(hasUpdate(record, { id: 'demo', installed: true, enabled: false, assetVersion: '1.3.0' } as unknown as PresetStateRow)).toBe(false)
    expect(hasUpdate(record, { id: 'demo', installed: false, enabled: false, assetVersion: '1.1.0' } as unknown as PresetStateRow)).toBe(false)
  })

  it('operator orders semantic versions including prereleases', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('1.1.0', '1.0.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.3.2', '0.3.10')).toBe(-1)
    expect(compareVersions('0.3.10', '0.3.2')).toBe(1)
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1)
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.2')).toBe(-1)
  })
})
