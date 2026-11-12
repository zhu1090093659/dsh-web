// @vitest-environment jsdom
/**
 * The agents settings card: the one field it exposes, the write that field
 * stages, and the states it must survive.
 *
 * The card face is driven with a fixed snapshot plus recording actions; the
 * save path runs through the real controller over a fake configuration form, so
 * the operation a save hands the Host is read where the Host receives it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the client entry's SlotMap merge (the 'web-ui.plugin.item'
// entry the card's PropsRuntime names) into this program without executing it.
import type {} from '../src/client/index.ts'
import {
  AgentsSettingsCard,
  AgentsSettingsCardController,
  type AgentsSettings,
  type AgentsSettingsCardProps,
  type AgentsSettingsCardState,
} from '../src/client/AgentsSettingsCard.tsx'
import type { FieldState } from '../src/client/settings-form.ts'
import { click, mount, unmountAll } from './render.tsx'

afterEach(() => { unmountAll() })

/** One untouched field the card renders. */
const field: FieldState = { text: '', overridden: false, invalid: false }

/** The field id the announcement switch owns. */
const ANNOUNCE_FIELD_ID = 'settings-agents-announce'

/** One complete card snapshot; callers override what one case exercises. */
function baseState(overrides: Partial<AgentsSettingsCardState> = {}): AgentsSettingsCardState {
  return {
    available: true,
    exposed: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    announceToAgent: field,
    ...overrides,
  }
}

/** The one element matching a selector, failing loudly when it is absent. */
function must(container: ParentNode, selector: string): Element {
  const found = container.querySelector(selector)
  if (found === null) throw new Error('no element matching ' + selector)
  return found
}

/** Render the card against a fixed snapshot; spies stand in for the actions. */
function renderCard(state: AgentsSettingsCardState) {
  const edit = vi.fn()
  const resetField = vi.fn()
  const props = {
    t: (key: string) => key,
    useAgentsSettingsCard: (select: (snapshot: AgentsSettingsCardState) => AgentsSettingsCardState) => select(state),
    edit,
    resetField,
    save: vi.fn(),
    discard: vi.fn(),
  } as unknown as AgentsSettingsCardProps
  const view = mount(<AgentsSettingsCard {...props} />)
  // The card arrives collapsed; open the disclosure the way the operator does.
  click(must(view.container, 'li > button[aria-expanded]'))
  return { edit, resetField, view }
}

/** The decorative mark the card header leads with, in the rendered card. */
function cardMark(container: ParentNode): Element {
  return must(container, 'li > button[aria-expanded] > span[aria-hidden="true"]')
}

/** The endpoints of every absolute M/L segment of one edge path. */
function parseLinks(d: string): Array<[[number, number], [number, number]]> {
  const segment = /M\s*([\d.]+)\s+([\d.]+)\s+L\s*([\d.]+)\s+([\d.]+)/g
  return Array.from(d.matchAll(segment)).map(match => {
    const [x1, y1, x2, y2] = match.slice(1, 5).map(Number) as [number, number, number, number]
    return [[x1, y1], [x2, y2]]
  })
}

/** Whether a point sits on (or inside) one node's disc, within a half-pixel of slack. */
function onFace(node: { x: number; y: number; r: number }, point: [number, number]): boolean {
  return Math.hypot(point[0] - node.x, point[1] - node.y) <= node.r + 0.5
}

/** The option buttons one segmented field shows. */
function segmentOptions(id: string): HTMLButtonElement[] {
  const group = document.getElementById(id)
  if (group === null) throw new Error('field ' + id + ' is not rendered')
  return Array.from(group.querySelectorAll('button'))
}

/** The labels of one field's options, as the operator reads them. */
function optionLabels(id: string): Array<string | null> {
  return segmentOptions(id).map(node => node.textContent)
}

/** Press the option of one boolean field that carries a label. */
function pickOption(id: string, label: string): void {
  const option = segmentOptions(id).find(node => node.textContent === label)
  if (option === undefined) throw new Error('field ' + id + ' offers no ' + label + ' option')
  click(option)
}

/** One write a save staged, as the Host receives it. */
type FormOp = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }

/** A configuration-form double holding one namespace section in memory. */
function fakeForm(init: { user?: Record<string, unknown>; writable?: boolean } = {}) {
  let user: Record<string, unknown> = { ...init.user }
  let snapshot = {
    status: 'ready',
    value: { ...init.user } as AgentsSettings,
    base: {} as AgentsSettings,
    user: user as AgentsSettings,
    revision: 1,
    writable: init.writable ?? true,
  }
  const listeners = new Set<() => void>()
  const writes: FormOp[][] = []
  let releases = 0
  const form = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { releases += 1; listeners.delete(listener) }
    },
    set: async () => true,
    unset: async () => true,
    mutate: async (ops: FormOp[]) => {
      writes.push(ops)
      const next = { ...user }
      for (const op of ops) {
        const key = op.path[0] ?? ''
        if (op.op === 'set') next[key] = op.value
        else delete next[key]
      }
      user = next
      snapshot = { ...snapshot, value: user as AgentsSettings, user: user as AgentsSettings, revision: snapshot.revision + 1 }
      for (const listener of [...listeners]) listener()
      return true
    },
  } as unknown as ConfigForm<AgentsSettings>
  return { form, writes, releases: () => releases }
}

/** Let the staged save run to settlement. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 4; tick += 1) await Promise.resolve()
}

describe('AgentsSettingsCard', () => {
  it('operator sees the announcement switch and what the master switch governs', () => {
    // Given the card rendered with a fixed snapshot, When the operator reads the
    // switch's options, Then it offers exactly the inheritable boolean choices, the
    // master switch on the profile row stays out of the form, and that switch is
    // explained as read-only copy.
    const { view } = renderCard(baseState())
    expect(optionLabels(ANNOUNCE_FIELD_ID)).toEqual(['settings.inherit', 'settings.on', 'settings.off'])
    expect(document.getElementById('settings-agents-enabled'), 'editable master switch').toBeNull()
    expect(view.container.textContent).toContain('settings.enabledNote')
  })

it('operator sees the card lead with the squad mark beside the family cards', () => {
    // Given the card rendered with a fixed snapshot, When the operator reads its
    // header, Then the plugin's own 18px mark leads the title, every shape takes
    // the surrounding text color, and the mark stays out of the accessibility
    // tree so the card is announced by its title alone.
    const { view } = renderCard(baseState())
    const mark = cardMark(view.container)
    const glyph = mark.firstElementChild
    expect(glyph?.tagName.toLowerCase(), 'header mark').toBe('svg')
    expect(glyph?.getAttribute('viewBox'), 'mark canvas').toBe('0 0 18 18')
    expect(glyph?.getAttribute('fill'), 'mark canvas').toBe('none')
    const painted = Array.from(glyph?.querySelectorAll('circle, path') ?? [])
      .flatMap(shape => [shape.getAttribute('fill'), shape.getAttribute('stroke')])
      .filter(color => color !== null)
    expect(painted.length, 'painted shapes').toBeGreaterThan(0)
    expect(painted.every(color => color === 'currentColor'), 'mark shape colors').toBe(true)
    expect(mark.nextElementSibling?.textContent).toContain('settings.title')
  })

  it('operator gets a squad mark whose three nodes stay linked inside the tile', () => {
    // Given the card's mark as rendered, When the operator reads its geometry,
    // Then it draws exactly three member nodes, every edge ends on a node face
    // so the nodes read as one connected squad instead of loose dots, and no
    // shape is clipped by the 18x18 tile.
    const glyph = cardMark(renderCard(baseState()).view.container).firstElementChild!
    const nodes = Array.from(glyph.querySelectorAll('circle')).map(node => ({
      x: Number(node.getAttribute('cx')),
      y: Number(node.getAttribute('cy')),
      r: Number(node.getAttribute('r')),
    }))
    expect(nodes, 'member nodes').toHaveLength(3)
    const links = Array.from(glyph.querySelectorAll('path'))
      .flatMap(edge => parseLinks(edge.getAttribute('d') ?? ''))
    expect(links, 'node links').toHaveLength(3)
    for (const [from, to] of links) {
      expect(nodes.some(node => onFace(node, from)), 'link start on a node face').toBe(true)
      expect(nodes.some(node => onFace(node, to)), 'link end on a node face').toBe(true)
    }
    const xs = nodes.flatMap(node => [node.x - node.r, node.x + node.r])
    const ys = nodes.flatMap(node => [node.y - node.r, node.y + node.r])
    expect(Math.min(...xs), 'mark left edge').toBeGreaterThan(0)
    expect(Math.max(...xs), 'mark right edge').toBeLessThan(18)
    expect(Math.min(...ys), 'mark top edge').toBeGreaterThan(0)
    expect(Math.max(...ys), 'mark bottom edge').toBeLessThan(18)
  })

  it('operator turns the announcement on from the card', () => {
    // Given the card rendered with the switch left at its inherit state, When
    // the operator picks On, Then the card stages the boolean write that adds
    // the announcement to agent system prompts.
    const { edit } = renderCard(baseState())
    pickOption(ANNOUNCE_FIELD_ID, 'settings.on')
    expect(edit).toHaveBeenCalledWith('announceToAgent', 'true')
  })

  it('operator clears a stored announcement back to the deployment default', () => {
    // Given a user layer that already stores the switch, When the operator resets
    // that field, Then the card stages a clear so saving drops the key.
    const { resetField } = renderCard(baseState({ announceToAgent: { text: 'true', overridden: true, invalid: false } }))
    const field = document.getElementById(ANNOUNCE_FIELD_ID)!.parentElement!
    const reset = Array.from(field.querySelectorAll('button')).find(button => button.textContent === 'settings.reset')
    if (reset === undefined) throw new Error('no reset control in the announcement field')
    click(reset)
    expect(resetField).toHaveBeenCalledWith('announceToAgent')
  })

  it('operator save writes the staged switch as one set on the announcement path', async () => {
    // Given a bound form whose section holds no announcement, When the operator
    // stages On and saves, Then the Host receives one set on
    // ['announceToAgent'] carrying true, and the form settles clean.
    const { form, writes } = fakeForm()
    const controller = new AgentsSettingsCardController(form)
    try {
      const face = controller.inject()
      face.edit('announceToAgent', 'true')
      face.save()
      await settle()
      expect(writes).toEqual([[{ op: 'set', path: ['announceToAgent'], value: true }]])
      const snapshot = face.hooks.agentsSettingsCard.getSnapshot()
      expect(snapshot.dirty, 'staged edits after a landed save').toBe(false)
      expect(snapshot.failed, 'save outcome').toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('operator cannot change the switch while the document is read-only', () => {
    // Given a deployment that serves settings read-only, When the card renders
    // the switch, Then the control is disabled instead of accepting a draft.
    renderCard(baseState({ writable: false }))
    expect(segmentOptions(ANNOUNCE_FIELD_ID).map(option => option.disabled)).toEqual([true, true, true])
  })

  it('operator still gets the switch when the Host does not expose the namespace', () => {
    // Given a Host whose settings allowlist omits this namespace, When the card
    // renders, Then it explains nothing away and still offers the switch, so a
    // missing namespace never reads as a missing plugin.
    const { view } = renderCard(baseState({ exposed: false }))
    expect(document.querySelector('[role="status"]'), 'not-exposed banner').toBeNull()
    expect(view.container.textContent).not.toContain('settings.notExposed')
    expect(optionLabels(ANNOUNCE_FIELD_ID)).toEqual(['settings.inherit', 'settings.on', 'settings.off'])
  })

  it('operator sees the card release its form subscription when it unloads', () => {
    // Given a card bound to a form, When the plugin unloads, Then the card drops
    // exactly one subscription so a reload can bind again.
    const fake = fakeForm()
    new AgentsSettingsCardController(fake.form).dispose()
    expect(fake.releases()).toBe(1)
  })
})
