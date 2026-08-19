/** @vitest-environment jsdom */

/**
 * The settings card's probe surface: the connectivity button, its live
 * states, and the model chips that back-fill the model field. Rendered
 * against a fake slot face — the snapshot hook answers a fixed state, and
 * the injected actions are spies.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// The SDK client half is a closure bundle the GUI module loader executes;
// outside the shell a minimal store stands in (family convention, see the
// dsh-live-stats client-apply spec).
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: <T,>(init: T) => {
    let value = init
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      subscribe: (listener: () => void): (() => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: (next: T): void => {
        value = next
        for (const listener of [...listeners]) listener()
      },
      update: (mutator: (draft: T) => void): void => {
        mutator(value)
        for (const listener of [...listeners]) listener()
      },
    }
  },
}))

// Type-only: pulls the client entry's SlotMap merge (the 'web-ui.plugin.item'
// entry the card's PropsRuntime names) into this program without executing it.
import type {} from '../src/client/index.ts'
import {
  DescribeImageSettingsCard,
  DescribeImageSettingsCardController,
  type DescribeImageSettingsCardProps,
  type DescribeImageSettingsCardState,
} from '../src/client/DescribeImageSettingsCard.tsx'
import { setLanguage } from '../src/client/locales.ts'
import type { FieldState } from '../src/client/settings-form.ts'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { DescribeImageSettings } from '../src/client/DescribeImageSettingsCard.tsx'

afterEach(() => {
  cleanup()
  setLanguage('zh')
})

/** One untouched field the card renders. */
const field: FieldState = { text: '', overridden: false, invalid: false }

/** One complete card snapshot; callers override what one case exercises. */
function baseState(overrides: Partial<DescribeImageSettingsCardState> = {}): DescribeImageSettingsCardState {
  return {
    available: true,
    exposed: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    baseURL: field,
    model: field,
    apiKey: field,
    apiKeyEnv: field,
    defaultPrompt: field,
    maxBytes: field,
    maxOutputTokens: field,
    timeoutMs: field,
    apiStyle: field,
    renderImagePreview: field,
    interceptImageSend: field,
    probe: { status: 'idle', models: [] },
    ...overrides,
  }
}

/** Render the card against a fixed snapshot; spies stand in for the actions.
 * The card defaults to collapsed, so the disclosure header opens first. */
function renderCard(state: DescribeImageSettingsCardState) {
  const edit = vi.fn()
  const fetchModels = vi.fn()
  const testModel = vi.fn()
  const props = {
    useDescribeImageSettingsCard: (select: (snapshot: DescribeImageSettingsCardState) => DescribeImageSettingsCardState) => select(state),
    edit,
    resetField: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    fetchModels,
    testModel,
  } as unknown as DescribeImageSettingsCardProps
  render(<DescribeImageSettingsCard {...props} />)
  fireEvent.click(screen.getByRole('button', { expanded: false }))
  return { edit, fetchModels, testModel }
}

describe('DescribeImageSettingsCard probe', () => {
  it('renders the fetch control with its hint and no connectivity control without a model', () => {
    setLanguage('en')
    renderCard(baseState())
    const button = screen.getByRole('button', { name: 'Fetch models' })
    expect(button.getAttribute('title')).toContain('works before saving')
    expect(screen.queryByRole('button', { name: 'Test connectivity' })).toBeNull()
  })

  it('fires the injected fetch action on click', () => {
    setLanguage('en')
    const { fetchModels } = renderCard(baseState())
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }))
    expect(fetchModels).toHaveBeenCalledTimes(1)
  })

  it('disables the fetch button and reports status while running', () => {
    setLanguage('en')
    renderCard(baseState({ probe: { status: 'running', pending: 'fetch', models: [] } }))
    const button = screen.getByRole('button', { name: 'Testing…' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('Testing…')
  })

  it('swaps the model field into a dropdown of fetched models and reports the count', () => {
    setLanguage('en')
    const { edit } = renderCard(baseState({ probe: { status: 'idle', pending: 'fetch', models: ['vision-1', 'vision-2'] } }))
    expect(screen.getByRole('status').textContent).toBe('Fetched 2 models')
    const select = document.getElementById('settings-describe-image-model') as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    const options = Array.from(select.querySelectorAll('option')).map(option => option.value)
    expect(options).toEqual(['', 'vision-1', 'vision-2'])
    fireEvent.change(select, { target: { value: 'vision-2' } })
    expect(edit).toHaveBeenCalledWith('model', 'vision-2')
  })

  it('keeps a current model missing from the listing selectable', () => {
    setLanguage('en')
    renderCard(baseState({
      model: { text: 'hand-typed-1', overridden: true, invalid: false },
      probe: { status: 'idle', pending: 'fetch', models: ['vision-1'] },
    }))
    const select = document.getElementById('settings-describe-image-model') as HTMLSelectElement
    const options = Array.from(select.querySelectorAll('option')).map(option => option.value)
    expect(options).toEqual(['', 'hand-typed-1', 'vision-1'])
  })

  it('shows the connectivity control once the model field carries a value', () => {
    setLanguage('en')
    const { testModel } = renderCard(baseState({ model: { text: 'vision-1', overridden: true, invalid: false } }))
    fireEvent.click(screen.getByRole('button', { name: 'Test connectivity' }))
    expect(testModel).toHaveBeenCalledTimes(1)
  })

  it('reports the model ping latency after a successful test', () => {
    setLanguage('en')
    renderCard(baseState({
      model: { text: 'vision-1', overridden: true, invalid: false },
      probe: { status: 'idle', pending: 'test', models: ['vision-1'], latencyMs: 432 },
    }))
    expect(screen.getByRole('status').textContent).toBe('OK: 432 ms')
  })

  it('surfaces the probe failure verbatim', () => {
    setLanguage('en')
    renderCard(baseState({ probe: { status: 'idle', pending: 'fetch', models: [], error: 'describe-image: no API key' } }))
    expect(screen.getByRole('status').textContent).toBe('Failed: describe-image: no API key')
  })

  it('disables the probe surface on a read-only deployment', () => {
    setLanguage('en')
    renderCard(baseState({ writable: false }))
    const button = screen.getByRole('button', { name: 'Fetch models' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})

/** A minimal ready scope answering stored connection settings. */
function fakeScope(value: DescribeImageSettings): SettingsScope<DescribeImageSettings> {
  return {
    subscribe: () => () => {},
    getSnapshot: () => ({ status: 'ready', writable: true, value, base: {}, user: {} }),
    set: async () => {},
    unset: async () => {},
  } as unknown as SettingsScope<DescribeImageSettings>
}

describe('DescribeImageSettingsCardController probe', () => {
  it('sends the staged drafts and publishes the listing', async () => {
    let init: RequestInit | undefined
    const fetchMock = vi.fn(async (_input: string | URL | Request, initArg?: RequestInit) => {
      init = initArg
      return { json: async () => ({ ok: true, value: { models: ['m1'] } }) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new DescribeImageSettingsCardController(fakeScope({ baseURL: 'https://saved.example.com/v1', model: 'old' }))
    try {
      // Stage a draft endpoint the listing must prefer over the stored one.
      controller.inject().edit('baseURL', 'https://draft.example.com/v1')
      controller.inject().fetchModels()
      expect(controller.inject().hooks.describeImageSettingsCard.getSnapshot().probe.status).toBe('running')
      await vi.waitFor(() => {
        expect(controller.inject().hooks.describeImageSettingsCard.getSnapshot().probe.status).toBe('idle')
      })
      const body = JSON.parse(String(init?.body)) as { baseURL: string }
      expect(body.baseURL).toBe('https://draft.example.com/v1')
      const snapshot = controller.inject().hooks.describeImageSettingsCard.getSnapshot()
      expect(snapshot.probe.models).toEqual(['m1'])
      expect(snapshot.probe.pending).toBe('fetch')
      expect(snapshot.probe.error).toBeUndefined()
    } finally {
      controller.dispose()
    }
  })

  it('pings the selected model and publishes its latency', async () => {
    let url = ''
    let init: RequestInit | undefined
    const fetchMock = vi.fn(async (input: string | URL | Request, initArg?: RequestInit) => {
      url = String(input)
      init = initArg
      return { json: async () => ({ ok: true, value: { latencyMs: 432 } }) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new DescribeImageSettingsCardController(fakeScope({ baseURL: 'https://saved.example.com/v1', model: 'vision-1' }))
    try {
      controller.inject().testModel()
      await vi.waitFor(() => {
        expect(controller.inject().hooks.describeImageSettingsCard.getSnapshot().probe.status).toBe('idle')
      })
      expect(url).toBe('/describe-image/models/test')
      const body = JSON.parse(String(init?.body)) as { model: string }
      expect(body.model).toBe('vision-1')
      const snapshot = controller.inject().hooks.describeImageSettingsCard.getSnapshot()
      expect(snapshot.probe.latencyMs).toBe(432)
      expect(snapshot.probe.pending).toBe('test')
    } finally {
      controller.dispose()
    }
  })

  it('skips the model ping while the model field is empty', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new DescribeImageSettingsCardController(fakeScope({ baseURL: 'https://saved.example.com/v1' }))
    try {
      controller.inject().testModel()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(controller.inject().hooks.describeImageSettingsCard.getSnapshot().probe.status).toBe('idle')
    } finally {
      controller.dispose()
    }
  })

  it('publishes the failure reason and ignores fetches while running', async () => {
    let calls = 0
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      calls += 1
      await new Promise(resolve => setTimeout(resolve, 10))
      return { json: async () => ({ ok: false, error: { code: 'rejected', message: 'no key' } }) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new DescribeImageSettingsCardController(fakeScope({ baseURL: 'https://saved.example.com/v1', model: 'old' }))
    try {
      const face = controller.inject()
      face.fetchModels()
      face.fetchModels()
      await vi.waitFor(() => {
        expect(controller.inject().hooks.describeImageSettingsCard.getSnapshot().probe.status).toBe('idle')
      })
      expect(calls).toBe(1)
      expect(controller.inject().hooks.describeImageSettingsCard.getSnapshot().probe.error).toBe('no key')
    } finally {
      controller.dispose()
    }
  })
})
