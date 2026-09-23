/** @vitest-environment jsdom */

/**
 * The settings card's probe surface: the connectivity button, its live
 * states, and the model chips that back-fill the model field. Rendered
 * against a fake slot face — the snapshot hook answers a fixed state, and
 * the injected actions are spies.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

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
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
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
    rotationMode: field,
    retryNextOnFailure: field,
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

/**
 * One ordered path-op batch as the shared configuration form accepts it.
 * Taken off the contract so the fake never restates the wire type.
 */
type FormOps = Parameters<ConfigForm<DescribeImageSettings>['mutate']>[0]

/**
 * Minimal in-memory configuration form modelling the real 0.1.7 contract: an
 * accepted mutation folds its writes into the view layers and answers `true`;
 * a refused one applies nothing and answers `false` (it does not reject).
 */
class FakeConfigForm implements ConfigForm<DescribeImageSettings> {
  /** Raw user layer, as the read-back judgment sees it. */
  readonly user: Record<string, unknown> = {}
  /** Whether the Host accepts the next write. */
  answer = true
  private value: DescribeImageSettings
  private readonly listeners = new Set<() => void>()

  /** @param value - the effective section the Host serves. */
  constructor(value: DescribeImageSettings) {
    this.value = value
  }

  getSnapshot(): ConfigFormSnapshot<DescribeImageSettings> {
    return { status: 'ready', value: this.value, base: {}, user: this.user, revision: 1, writable: true, mode: 'host' }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(field: string, value: unknown): Promise<boolean> {
    return this.mutate([{ op: 'set', path: [field], value: value as never }])
  }

  unset(field: string): Promise<boolean> {
    return this.mutate([{ op: 'unset', path: [field] }])
  }

  async mutate(ops: FormOps): Promise<boolean> {
    if (!this.answer) return false
    for (const op of ops) {
      const field = op.path[0]
      if (op.op === 'set') {
        this.user[field] = op.value
        this.value = { ...this.value, [field]: op.value }
      } else {
        delete this.user[field]
      }
    }
    for (const listener of this.listeners) listener()
    return true
  }
}

/** The card snapshot the controller publishes. */
function cardState(controller: DescribeImageSettingsCardController): DescribeImageSettingsCardState {
  return controller.inject().hooks.describeImageSettingsCard.getSnapshot()
}

describe('DescribeImageSettingsCardController probe', () => {
  it('sends the staged drafts and publishes the listing', async () => {
    let init: RequestInit | undefined
    const fetchMock = vi.fn(async (_input: string | URL | Request, initArg?: RequestInit) => {
      init = initArg
      return { json: async () => ({ ok: true, value: { models: ['m1'] } }) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new DescribeImageSettingsCardController(new FakeConfigForm({ baseURL: 'https://saved.example.com/v1', model: 'old' }))
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
    const controller = new DescribeImageSettingsCardController(new FakeConfigForm({ baseURL: 'https://saved.example.com/v1', model: 'vision-1' }))
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
    const controller = new DescribeImageSettingsCardController(new FakeConfigForm({ baseURL: 'https://saved.example.com/v1' }))
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
    const controller = new DescribeImageSettingsCardController(new FakeConfigForm({ baseURL: 'https://saved.example.com/v1', model: 'old' }))
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

describe('DescribeImageSettingsCardController save', () => {
  it('operator sees a staged edit written and the drafts cleared', async () => {
    // Given a card bound to a form the Host accepts writes on
    const form = new FakeConfigForm({ baseURL: 'https://saved.example.com/v1', model: 'old' })
    const controller = new DescribeImageSettingsCardController(form)
    try {
      const face = controller.inject()
      face.edit('model', 'vision-2')
      expect(cardState(controller).dirty).toBe(true)

      // When the operator saves the staged edit
      face.save()
      await vi.waitFor(() => { expect(cardState(controller).dirty).toBe(false) })

      // Then the write landed and the card reports no failure
      expect(form.user.model).toBe('vision-2')
      expect(cardState(controller).failed).toBe(false)
      expect(cardState(controller).model).toMatchObject({ text: 'vision-2', overridden: true })
    } finally {
      controller.dispose()
    }
  })

  it('operator sees a refused write reported as a failed save with the drafts kept', async () => {
    // Given a Host that refuses (or skips) the write: the form answers false
    // instead of throwing, which must not read as a successful save
    const form = new FakeConfigForm({ baseURL: 'https://saved.example.com/v1', model: 'old' })
    form.answer = false
    const controller = new DescribeImageSettingsCardController(form)
    try {
      const face = controller.inject()
      face.edit('model', 'vision-2')

      // When the operator saves the staged edit
      face.save()
      await vi.waitFor(() => { expect(cardState(controller).failed).toBe(true) })

      // Then the refusal surfaces as a failure and the draft stays editable
      expect(cardState(controller).dirty).toBe(true)
      expect(cardState(controller).model.text).toBe('vision-2')
      expect(form.user.model).toBeUndefined()
    } finally {
      controller.dispose()
    }
  })
})
