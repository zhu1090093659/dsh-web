/** @vitest-environment jsdom */

/**
 * The disable/enable surfaces: the provider card's disabled state and toggle
 * button, and the Models-page footer archive listing. The two-phase
 * orchestration itself is covered in provider-toggle.spec.ts.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RemoteResult, SettingsDescribeValue, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { CapabilitiesPanel } from '../src/client/CapabilitiesPanel.tsx'
import { DisabledProvidersFooter } from '../src/client/DisabledProvidersFooter.tsx'
import type { RefreshBus, SettingsNamespaceFace } from '../src/client/settings-face.ts'
import { CAPS_ENTRY_IDS } from '../src/core/provider-toggle.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The profile entry id this deployment mounts the plugin under (the aggregate's row). */
const CAPS_ENTRY_ID = CAPS_ENTRY_IDS[1]

/** The archive form schema as the Host serves it (the plugin's volatile config fields). */
const ARCHIVE_SCHEMA = { type: 'object', meta: { default: {} }, dict: { disabled: { type: 'any', meta: { default: {} } } } }

const PROVIDER = {
  provider: 'acme-gateway',
  displayName: 'ACME Gateway',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'acme-gateway'],
  active: true,
}

const STORED_ROW = { id: 'gpt-x', name: 'GPT X', contextWindow: 256000, maxTokens: 32000 }

interface World {
  llm: SettingsNamespaceView
  caps: SettingsNamespaceView
  calls: Array<{ ns: string, ops: Array<{ op: string, path: string[] }>, revision: number | undefined }>
  describeCount: number
  failNext?: { ns: string, code: string }
}

function view(ns: string, user: unknown, revision: number, schema: unknown = {}): SettingsNamespaceView {
  // Share one object for the resolved value and raw user section (the archive
  // entry's schema is a passthrough, so production carries the same content).
  const section = user as Record<string, unknown>
  return { ns, autoGenerate: true, schema: schema as never, value: section as never, user: section as never, applies: 'live', secrets: [], revision }
}

/** Replace the raw user section (the resolved value follows: passthrough schema). */
function setUserSection(target: SettingsNamespaceView, section: unknown): void {
  const shared = section as Record<string, unknown>
  target.user = shared as never
  target.value = shared as never
}

/** Apply a path op to the user section (object paths only, mirroring the host walker). */
function applyToUser(view: SettingsNamespaceView, op: { op: string, path: string[], value?: unknown }): void {
  const user = (view.user ?? {}) as Record<string, unknown>
  let node: Record<string, unknown> = user
  const segments = op.path
  for (let index = 0; index < segments.length - 1; index++) {
    const key = segments[index]
    const child = node[key]
    if (typeof child !== 'object' || child === null || Array.isArray(child)) {
      if (op.op === 'unset') return
      const created: Record<string, unknown> = {}
      node[key] = created
      node = created
    } else {
      node = child as Record<string, unknown>
    }
  }
  const last = segments[segments.length - 1]
  if (op.op === 'set') node[last] = op.value
  else delete node[last]
  ;(view as { user?: unknown }).user = user
}

function makeFace(world: World): SettingsNamespaceFace {
  return {
    describe: () => {
      world.describeCount += 1
      return Promise.resolve({
        ok: true,
        value: { writable: true, hasDocument: true, namespaces: [world.llm, world.caps] } satisfies SettingsDescribeValue,
      }) as Promise<RemoteResult<SettingsDescribeValue>>
    },
    mutate: (ns: string, ops: never, expectedRevision: number | undefined) => {
      world.calls.push({ ns, ops: ops as unknown as Array<{ op: string, path: string[] }>, revision: expectedRevision })
      const fail = world.failNext
      if (fail !== undefined && fail.ns === ns) {
        world.failNext = undefined
        return Promise.resolve({
          ok: false,
          error: Object.assign(new Error('boom'), { code: fail.code }),
        }) as Promise<RemoteResult<SettingsNamespaceView>>
      }
      const view = ns === world.llm.ns ? world.llm : world.caps
      for (const op of world.calls[world.calls.length - 1].ops) applyToUser(view, op)
      view.revision += 1
      return Promise.resolve({ ok: true, value: view }) as Promise<RemoteResult<SettingsNamespaceView>>
    },
  }
}

function bus(): RefreshBus & { notifyCount: number } {
  let notifyCount = 0
  const listeners = new Set<() => void>()
  return {
    subscribe(callback) {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    notify() {
      notifyCount += 1
      for (const listener of [...listeners]) listener()
    },
    get notifyCount() { return notifyCount },
  }
}

function baseWorld(): World {
  return {
    llm: view('llm-pi-ai', { providers: { 'acme-gateway': { models: [{ ...STORED_ROW }] } } }, 7),
    caps: view(CAPS_ENTRY_ID, {}, 3),
    calls: [],
    describeCount: 0,
  }
}

describe('CapabilitiesPanel disable/enable', () => {
  it('operator disables a provider whose archive row was renamed', async () => {
    // Given a profile that serves this plugin's archive under a row id the
    // package does not know, carrying the schema it declares
    const world = baseWorld()
    world.caps = view('my-caps', {}, 3, ARCHIVE_SCHEMA)
    render(<CapabilitiesPanel provider={PROVIDER} configured keyConfigured settings={makeFace(world)} refresh={bus()} />)
    fireEvent.click(screen.getByRole('button', { name: /模型能力/ }))

    // When the operator disables the provider from the card
    await waitFor(() => {
      expect(document.querySelectorAll('[data-dsh-part="model-row"]')).toHaveLength(1)
    })
    fireEvent.click(screen.getByRole('button', { name: '禁用此提供方' }))
    await waitFor(() => {
      expect(world.calls).toHaveLength(2)
    })

    // Then the profile is archived in that row before the route goes down
    expect(world.calls[0].ns).toBe('my-caps')
    expect(world.calls[1].ns).toBe('llm-pi-ai')
  })

  it('operator is offered no disable control while no archive entry is served', async () => {
    // Given a host that serves no form carrying this plugin's archive schema
    const world = baseWorld()
    world.caps = view('something-else', {}, 3)
    render(<CapabilitiesPanel provider={PROVIDER} configured keyConfigured settings={makeFace(world)} refresh={bus()} />)
    fireEvent.click(screen.getByRole('button', { name: /模型能力/ }))

    // When the panel has loaded the served forms
    await waitFor(() => {
      expect(document.querySelectorAll('[data-dsh-part="model-row"]')).toHaveLength(1)
    })

    // Then no disable control is offered, because nothing could archive the profile
    expect(screen.queryByRole('button', { name: '禁用此提供方' })).toBeNull()
  })

  it('shows the disabled state with an enable affordance and no editor', async () => {
    const world = baseWorld()
    setUserSection(world.llm, { providers: {} })
    setUserSection(world.caps, { disabled: { 'acme-gateway': { profile: { apiKeyEnv: 'ACME_KEY' }, displayName: 'ACME Gateway' } } })
    render(<CapabilitiesPanel provider={PROVIDER} configured keyConfigured settings={makeFace(world)} refresh={bus()} />)
    fireEvent.click(screen.getByRole('button', { name: /模型能力/ }))
    await waitFor(() => {
      expect(screen.getByText('该提供方已禁用：模型不出现在输入框模型选择器与子代理可选列表中。配置已存档，启用即恢复。')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: '启用' })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: '无推理' })).toBeNull()
  })

  it('disables through two mutations: archive first, then the route unset', async () => {
    const world = baseWorld()
    const mirror = bus()
    render(<CapabilitiesPanel provider={PROVIDER} configured keyConfigured settings={makeFace(world)} refresh={mirror} />)
    fireEvent.click(screen.getByRole('button', { name: /模型能力/ }))
    await waitFor(() => {
      expect(screen.getByText('gpt-x')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '禁用此提供方' }))
    await waitFor(() => {
      expect(screen.getByText('该提供方已禁用：模型不出现在输入框模型选择器与子代理可选列表中。配置已存档，启用即恢复。')).toBeTruthy()
    })
    expect(world.calls).toHaveLength(2)
    expect(world.calls[0].ns).toBe(CAPS_ENTRY_ID)
    expect(world.calls[0].ops[0].op).toBe('set')
    expect(world.calls[0].ops[0].path).toEqual(['disabled', 'acme-gateway'])
    expect(world.calls[1].ns).toBe('llm-pi-ai')
    expect(world.calls[1].ops[0]).toEqual({ op: 'unset', path: ['providers', 'acme-gateway'] })
    expect(mirror.notifyCount).toBe(1)
  })

  it('re-enables from the card and the editor returns', async () => {
    const world = baseWorld()
    setUserSection(world.llm, { providers: {} })
    setUserSection(world.caps, { disabled: { 'acme-gateway': { profile: { apiKeyEnv: 'ACME_KEY', models: [{ ...STORED_ROW }] } } } })
    render(<CapabilitiesPanel provider={PROVIDER} configured keyConfigured settings={makeFace(world)} refresh={bus()} />)
    fireEvent.click(screen.getByRole('button', { name: /模型能力/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '启用' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    await waitFor(() => {
      expect(screen.getByText('gpt-x')).toBeTruthy()
    })
    expect(world.calls[0].ns).toBe('llm-pi-ai')
    expect(world.calls[1].ns).toBe(CAPS_ENTRY_ID)
  })

  it('hides the disable control while the document is read-only', async () => {
    const world = baseWorld()
    const face = {
      describe: () => Promise.resolve({
        ok: true,
        value: { writable: false, hasDocument: true, namespaces: [world.llm, world.caps] } satisfies SettingsDescribeValue,
      }),
      mutate: () => Promise.resolve({ ok: true, value: world.llm }),
    }
    render(<CapabilitiesPanel provider={PROVIDER} configured keyConfigured settings={face as unknown as SettingsNamespaceFace} refresh={bus()} />)
    fireEvent.click(screen.getByRole('button', { name: /模型能力/ }))
    await waitFor(() => {
      expect(screen.getByText('当前设置文档只读，无法修改。')).toBeTruthy()
    })
    const disable = screen.getByRole('button', { name: '禁用此提供方' }) as HTMLButtonElement
    expect(disable.disabled).toBe(true)
  })

  it('hides the disable control when the composition layer also declares the route', async () => {
    const world = baseWorld()
    world.llm.base = { providers: { 'acme-gateway': { apiKeyEnv: 'BASE_KEY' } } }
    render(<CapabilitiesPanel provider={PROVIDER} configured keyConfigured settings={makeFace(world)} refresh={bus()} />)
    fireEvent.click(screen.getByRole('button', { name: /模型能力/ }))
    await waitFor(() => {
      expect(screen.getByText('gpt-x')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: '禁用此提供方' })).toBeNull()
  })

  it('keeps an open draft across a background refresh and fences it at its own revision', async () => {
    const world = baseWorld()
    const mirror = bus()
    render(<CapabilitiesPanel provider={PROVIDER} configured keyConfigured settings={makeFace(world)} refresh={mirror} />)
    fireEvent.click(screen.getByRole('button', { name: /模型能力/ }))
    await waitFor(() => {
      expect(screen.getByText('gpt-x')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /展开模型能力: gpt-x/ }))
    fireEvent.click(screen.getByRole('radio', { name: '无推理' }))

    // Another surface rewrites the provider while the draft is open.
    setUserSection(world.llm, { providers: { 'acme-gateway': { models: [{ ...STORED_ROW, name: 'Renamed' }] } } })
    world.llm.revision = 9
    mirror.notify()

    await waitFor(() => {
      expect(screen.getByText('配置已被其他界面修改；你的未保存修改仍保留，保存时会再次校验。')).toBeTruthy()
    })
    // The draft survived, and the write stays fenced at the revision it read.
    expect((screen.getByRole('radio', { name: '无推理' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(world.calls).toHaveLength(1)
    })
    expect(world.calls[0].revision).toBe(7)
  })

  it('leaves the disabled view after a partial enable restored the route', async () => {
    const world = baseWorld()
    setUserSection(world.llm, { providers: {} })
    setUserSection(world.caps, { disabled: { 'acme-gateway': { profile: { apiKeyEnv: 'ACME_KEY', models: [{ ...STORED_ROW }] }, displayName: 'ACME Gateway' } } })
    world.failNext = { ns: CAPS_ENTRY_ID, code: 'settings/conflict' }
    render(<CapabilitiesPanel provider={PROVIDER} configured keyConfigured settings={makeFace(world)} refresh={bus()} />)
    fireEvent.click(screen.getByRole('button', { name: /模型能力/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '启用' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    await waitFor(() => {
      expect(screen.getByText('已启用，但清理存档失败：boom')).toBeTruthy()
    })
    // The route is back, so the card must not keep claiming it is disabled.
    expect(screen.queryByText('该提供方已禁用：模型不出现在输入框模型选择器与子代理可选列表中。配置已存档，启用即恢复。')).toBeNull()
    await waitFor(() => {
      expect(screen.getByText('gpt-x')).toBeTruthy()
    })
  })
})

describe('DisabledProvidersFooter', () => {
  it('renders nothing while the archive is empty', async () => {
    const world = baseWorld()
    const { container } = render(<DisabledProvidersFooter settings={makeFace(world)} refresh={bus()} />)
    await waitFor(() => {
      expect(world.describeCount).toBe(1)
    })
    expect(container.querySelector('[data-dsh-part="disabled-footer"]')).toBeNull()
  })

  it('lists archived providers and enables one through the orchestration', async () => {
    const world = baseWorld()
    setUserSection(world.llm, { providers: {} })
    setUserSection(world.caps, {
      disabled: {
        'acme-gateway': { profile: { apiKeyEnv: 'ACME_KEY' }, displayName: 'ACME Gateway' },
        'other-gw': { profile: { apiKeyEnv: 'OTHER_KEY' } },
      },
    })
    const mirror = bus()
    render(<DisabledProvidersFooter settings={makeFace(world)} refresh={mirror} />)
    await waitFor(() => {
      expect(screen.getByText('已禁用的提供方')).toBeTruthy()
    })
    expect(screen.getByText('ACME Gateway')).toBeTruthy()
    expect(screen.getByText('other-gw')).toBeTruthy()

    const enableButtons = screen.getAllByRole('button', { name: '启用' })
    fireEvent.click(enableButtons[0])
    await waitFor(() => {
      // The row leaves the archive after the reload.
      expect(screen.queryByText('ACME Gateway')).toBeNull()
    })
    expect(world.calls[0].ns).toBe('llm-pi-ai')
    expect(world.calls[1].ns).toBe(CAPS_ENTRY_ID)
    expect(mirror.notifyCount).toBe(1)
  })

  it('reports a route that grew a new configuration between the listing and the click', async () => {
    const world = baseWorld()
    setUserSection(world.llm, { providers: {} })
    setUserSection(world.caps, { disabled: { 'acme-gateway': { profile: { apiKeyEnv: 'OLD' } } } })
    render(<DisabledProvidersFooter settings={makeFace(world)} refresh={bus()} />)
    await waitFor(() => {
      expect(screen.getByText('已禁用的提供方')).toBeTruthy()
    })
    // The route comes back after the listing read (a race, not a stale entry):
    // the enable re-reads the document and must refuse instead of clobbering.
    // A fresh view object mirrors the wire, where the listing's read cannot
    // retroactively change.
    world.llm = view('llm-pi-ai', { providers: { 'acme-gateway': { apiKeyEnv: 'NEW' } } }, 8)
    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    await waitFor(() => {
      expect(screen.getByText('该提供方已存在新配置，无法恢复存档；请先移除现有配置再启用。')).toBeTruthy()
    })
    expect(world.calls).toHaveLength(0)
  })

  it('hides an archive entry whose provider is configured again', async () => {
    const world = baseWorld()
    // The archive still holds the profile, but the route is live in the user layer.
    setUserSection(world.caps, { disabled: { 'acme-gateway': { profile: { apiKeyEnv: 'OLD' } } } })
    const { container } = render(<DisabledProvidersFooter settings={makeFace(world)} refresh={bus()} />)
    await waitFor(() => {
      expect(world.describeCount).toBe(1)
    })
    expect(container.querySelector('[data-dsh-part="disabled-footer"]')).toBeNull()
  })

  it('hides an archive entry whose route is declared in the composition layer', async () => {
    const world = baseWorld()
    setUserSection(world.llm, { providers: {} })
    world.llm.base = { providers: { 'acme-gateway': { apiKeyEnv: 'BASE_KEY' } } }
    setUserSection(world.caps, { disabled: { 'acme-gateway': { profile: { apiKeyEnv: 'OLD' } } } })
    const { container } = render(<DisabledProvidersFooter settings={makeFace(world)} refresh={bus()} />)
    await waitFor(() => {
      expect(world.describeCount).toBe(1)
    })
    expect(container.querySelector('[data-dsh-part="disabled-footer"]')).toBeNull()
  })
})
