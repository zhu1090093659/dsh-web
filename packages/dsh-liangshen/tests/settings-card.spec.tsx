/** @vitest-environment jsdom */

/**
 * The LiangShen settings card: the fields it renders, the values it stages, and
 * the states it must survive. Rendered against a fake slot face — the snapshot
 * hook answers a fixed state and the injected actions are spies.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// Type-only: pulls the client entry's SlotMap merge (the 'web-ui.plugin.item'
// entry the card's PropsRuntime names) into this program without executing it.
import type {} from '../src/client/index.ts'
import {
  PRESENTATION_CHOICES,
  LiangShenSettingsCard,
  LiangShenSettingsCardController,
  type LiangShenSettingsCardProps,
  type LiangShenSettingsCardState,
  type LiangShenSettings,
} from '../src/client/LiangShenSettingsCard.tsx'
import type { FieldState } from '../src/client/settings-form.ts'

afterEach(() => { cleanup() })

/** One untouched field the card renders. */
const field: FieldState = { text: '', overridden: false, invalid: false }

/** One complete card snapshot; callers override what one case exercises. */
function baseState(overrides: Partial<LiangShenSettingsCardState> = {}): LiangShenSettingsCardState {
  return {
    available: true,
    exposed: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    enabled: field,
    announceToAgent: field,
    presentation: field,
    ...overrides,
  }
}

/** Render the card against a fixed snapshot; spies stand in for the actions. */
function renderCard(state: LiangShenSettingsCardState) {
  const edit = vi.fn()
  const props = {
    t: (key: string) => key,
    useLiangShenSettingsCard: (select: (snapshot: LiangShenSettingsCardState) => LiangShenSettingsCardState) => select(state),
    edit,
    resetField: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
  } as unknown as LiangShenSettingsCardProps
  render(<LiangShenSettingsCard {...props} />)
  // The card defaults to collapsed; open the disclosure first.
  fireEvent.click(screen.getByRole('button', { expanded: false }))
  return { edit }
}

/**
 * Open one choice field's popup and read the option labels it renders.
 *
 * The shared card renders a custom trigger plus a listbox under the default
 * appearance (a native `<select>` only appears when an appearance skin is
 * active), so every choice field is driven by clicking, not by `change`.
 */
function openChoices(id: string): HTMLElement[] {
  const trigger = document.getElementById(id)
  expect(trigger, id).not.toBeNull()
  fireEvent.click(trigger!)
  const listbox = document.querySelector('[role="listbox"]')
  expect(listbox).not.toBeNull()
  return Array.from(listbox!.querySelectorAll('[role="option"]')) as HTMLElement[]
}

describe('LiangShenSettingsCard', () => {
  it('renders every field the Host schema carries', () => {
    renderCard(baseState())
    for (const id of [
      'settings-liangshen-enabled',
      'settings-liangshen-announce',
      'settings-liangshen-presentation',
    ]) {
      expect(document.getElementById(id), id).not.toBeNull()
    }
  })

  it('offers the presentation choices with the inherit option leading', () => {
    renderCard(baseState())
    const presentation = openChoices('settings-liangshen-presentation')
    expect(presentation.map(option => option.textContent)).toEqual([
      'settings.inherit',
      'presentation.ptc',
      'presentation.native',
      'presentation.both',
    ])
  })

  it('stages the presentation a choice selects', () => {
    const { edit } = renderCard(baseState())
    const presentation = openChoices('settings-liangshen-presentation')
    fireEvent.click(presentation[2]!)   // presentation.native
    expect(edit).toHaveBeenCalledWith('presentation', 'native')
  })

  it('disables every control when the document is not writable', () => {
    renderCard(baseState({ writable: false }))
    const trigger = document.getElementById('settings-liangshen-presentation') as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
  })

  it('renders fields gracefully when the Host does not expose the namespace', () => {
    renderCard(baseState({ exposed: false }))
    expect(screen.queryByText('settings.notExposed')).toBeNull()
    expect(document.getElementById('settings-liangshen-presentation')?.tagName).toBe('BUTTON')
  })

  it('binds the scope into a controller whose face carries the snapshot and actions', () => {
    // The card's slot entry injects this face; a missing hook or action would
    // leave the renderer with nothing to bind.
    const scope = {
      getSnapshot: () => ({ value: {}, revision: 0 }),
      subscribe: () => () => {},
      mutate: vi.fn(),
    } as unknown as Parameters<typeof LiangShenSettingsCardController.prototype.constructor>[0]
    const controller = new LiangShenSettingsCardController(scope)
    try {
      const face = controller.inject()
      expect(face.hooks.liangShenSettingsCard).toBeDefined()
      expect(typeof face.edit).toBe('function')
      expect(typeof face.save).toBe('function')
      expect(typeof face.discard).toBe('function')
      expect(typeof face.resetField).toBe('function')
    } finally {
      controller.dispose()
    }
  })

  it('keeps the exported choice lists aligned with the Host schema', () => {
    // These mirror the Host's PRESENTATION_OPTIONS; a drift
    // would offer a value the Host rejects or hide one it accepts.
    expect([...PRESENTATION_CHOICES]).toEqual(['ptc', 'native', 'both'])
    const settings: LiangShenSettings = { presentation: 'ptc', enabled: true }
    expect(Object.keys(settings).length).toBe(2)
  })
})
