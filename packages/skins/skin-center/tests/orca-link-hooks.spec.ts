/**
 * Focused tests for the ORCA LINK (orca-link) skin port: scene layers,
 * wordmark/signal chrome, link-state projection, status character and
 * cleanup. Exercises the real skins/orca-link/hooks.mjs in jsdom.
 */

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'

import defineSkinHooks from '../skins/orca-link/hooks.mjs'

function orcaSkinDir(): string {
  for (const base of [process.cwd(), path.resolve(process.cwd(), 'packages/skins/skin-center')]) {
    const dir = path.join(base, 'skins', 'orca-link')
    if (existsSync(path.join(dir, 'skin.json'))) return dir
  }
  throw new Error('cannot locate skins/orca-link directory')
}

function sidebarFixture(): void {
  const sidebar = document.createElement('div')
  sidebar.setAttribute('data-slot', 'sidebar')
  const pane = document.createElement('div')
  const logoRow = document.createElement('div')
  const brand = document.createElement('button')
  brand.setAttribute('aria-label', 'DeepSeek Harness')
  logoRow.append(brand)
  pane.append(logoRow)
  sidebar.append(pane)
  document.body.append(sidebar)
}

function conversationFixture(phase: string): HTMLElement {
  const root = document.createElement('div')
  root.setAttribute('data-phase', phase)
  const scroll = document.createElement('div')
  scroll.setAttribute('data-conversation-scroll', '')
  root.append(scroll)
  document.body.append(root)
  return root
}

function setup() {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.documentElement.setAttribute('data-dsh-skin', 'orca-link')
  document.title = 'orca-link-hooks-spec'
  const cleanups: Array<() => void> = []
  const theme = {
    get: () => (document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'),
    subscribe: () => () => {},
  }
  const ctx = {
    skinId: 'orca-link',
    scopeAttr: 'orca-link',
    assetBase: '/api/skin-center/v2/skins/orca-link',
    theme,
    onCleanup: (fn: () => void) => cleanups.push(fn),
  }
  const runCleanup = () => {
    for (const fn of cleanups.splice(0).reverse()) fn()
  }
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 10))
  return { ctx, runCleanup, cleanups, flush }
}

describe('orca-link hooks: scene layers and chrome', () => {
  it('mounts the two-layer light and dark scenes and resolves artwork through assetBase', () => {
    const { ctx, runCleanup } = setup()
    defineSkinHooks().apply(ctx)

    const light = document.body.querySelector('[data-skin-chrome="light-scene"]')
    const dark = document.body.querySelector('[data-skin-chrome="dark-scene"]')
    expect(light).not.toBeNull()
    expect(dark).not.toBeNull()
    // The crossfade layers carry BOTH the Layer and Hero/Active classes on one
    // element (the v1 stylesheet sizes them that way); a bare Layer wrapper
    // would end up static with 0 height.
    const hero = light?.querySelector('.orca-ch-lightSceneLayer.orca-ch-lightSceneHero')
    const active = light?.querySelector('.orca-ch-lightSceneLayer.orca-ch-lightSceneActive')
    expect(hero).not.toBeNull()
    expect(active).not.toBeNull()

    expect(document.body.style.getPropertyValue('--orca-link-light-hero-art')).toContain(
      'assets/orca-link-light-hero.webp',
    )
    expect(document.body.style.getPropertyValue('--orca-link-dark-active-art')).toContain(
      'assets/orca-link-dark-active.webp',
    )
    expect(document.body.hasAttribute('data-dsh-orca-link')).toBe(true)
    expect(document.body.querySelector('[data-skin-chrome="spine"]')).not.toBeNull()
    expect(document.body.querySelector('[data-skin-chrome="standby"]')).not.toBeNull()

    runCleanup()
    expect(document.body.querySelector('[data-skin-chrome="light-scene"]')).toBeNull()
    expect(document.body.querySelector('[data-skin-chrome="dark-scene"]')).toBeNull()
    expect(document.body.hasAttribute('data-dsh-orca-link')).toBe(false)
    expect(document.body.style.getPropertyValue('--orca-link-light-hero-art')).toBe('')
    expect(document.title).toBe('orca-link-hooks-spec')
  })

  it('mounts the wordmark and signal chip into the sidebar logo row', async () => {
    const { ctx, runCleanup, flush } = setup()
    sidebarFixture()
    defineSkinHooks().apply(ctx)

    const row = document.body.querySelector("[data-slot='sidebar'] > :first-child > :first-child")
    expect(row?.querySelector('[data-orca-link-wordmark]')).not.toBeNull()
    const chip = document.body.querySelector('[data-orca-link-signal]')
    expect(chip).not.toBeNull()
    await flush()
    expect(chip?.getAttribute('data-orca-link-status')).toBe('standby')

    runCleanup()
    expect(document.body.querySelector('[data-orca-link-signal]')).toBeNull()
    expect(document.body.querySelector('[data-orca-link-wordmark]')).toBeNull()
  })

  it('projects the conversation phase onto body[data-orca-scene] and back', async () => {
    const { ctx, runCleanup, flush } = setup()
    conversationFixture('settling')
    defineSkinHooks().apply(ctx)
    expect(document.body.getAttribute('data-orca-scene')).toBe('active')

    const root = document.body.querySelector('[data-phase]')
    root?.setAttribute('data-phase', 'hero')
    await flush()
    expect(document.body.getAttribute('data-orca-scene')).toBe('hero')

    root?.setAttribute('data-phase', 'active')
    await flush()
    expect(document.body.getAttribute('data-orca-scene')).toBe('active')

    runCleanup()
    expect(document.body.hasAttribute('data-orca-scene')).toBe(false)
  })

  it('mounts the status character and mirrors the projected link status', () => {
    const { ctx, runCleanup } = setup()
    sidebarFixture()
    const active = conversationFixture('active')
    const running = document.createElement('div')
    running.setAttribute('data-state', 'running')
    active.append(running)
    defineSkinHooks().apply(ctx)

    const character = document.body.querySelector('[data-orca-link-character]')
    expect(character).not.toBeNull()
    expect(character?.getAttribute('data-orca-link-status')).toBe('working')
    const sprite = document.body.querySelector('[data-orca-link-character-sprite]')
    expect(sprite?.style.getPropertyValue('--orca-status-x')).not.toBe('')
    expect(character?.style.getPropertyValue('--orca-status-column')).toBe('')
    expect(character?.style.getPropertyValue('--orca-link-status-atlas')).toContain(
      'assets/orca-link-status-atlas.webp',
    )

    runCleanup()
    expect(document.body.querySelector('[data-orca-link-character]')).toBeNull()
  })
})

describe('orca-link hooks: icon reconciler', () => {
  const makeSvg = (d: string) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    svg.append(path)
    return svg
  }

  it('only reconciles host glyphs matching a fingerprint key', async () => {
    const { ctx, runCleanup, flush } = setup()
    const hit = makeSvg('M9.67272 0.522841C10.8339 2.1')
    const miss = makeSvg('M0 0 C1 1 2 2 3 3 -- no fingerprint here')
    document.body.append(hit, miss)
    defineSkinHooks().apply(ctx)

    expect(hit.getAttribute('data-orca-link-icon')).toBe('panel-collapse')
    expect(hit.querySelector('[data-orca-link-icon-art]')).not.toBeNull()
    expect(miss.getAttribute('data-orca-link-icon')).toBeNull()
    expect(miss.querySelector('[data-orca-link-icon-art]')).toBeNull()

    // Late-inserted svgs (session loads, skill pickers) reconcile through
    // the mount observer as well.
    const late = makeSvg('M4 4l8 8M12 4l-8 8')
    document.body.append(late)
    await flush()
    expect(late.getAttribute('data-orca-link-icon')).toBe('close')

    // Idempotent: further churn must not stack a second art group.
    document.body.append(document.createElement('div'))
    await flush()
    expect(late.querySelectorAll('[data-orca-link-icon-art]')).toHaveLength(1)

    runCleanup()
    expect(hit.getAttribute('data-orca-link-icon')).toBeNull()
  })
})

describe('orca-link hooks: background throttling', () => {
  it('mirrors tab visibility onto body and resumes on return', () => {
    const { ctx, runCleanup } = setup()
    sidebarFixture()
    defineSkinHooks().apply(ctx)

    expect(document.body.hasAttribute('data-orca-page-hidden')).toBe(false)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(document.body.hasAttribute('data-orca-page-hidden')).toBe(true)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(document.body.hasAttribute('data-orca-page-hidden')).toBe(false)

    runCleanup()
    expect(document.body.hasAttribute('data-orca-page-hidden')).toBe(false)
  })
})

describe('orca-link hooks: composer seat and settings overlay', () => {
  function composerFixture(phase = 'active', hasFlow = true): { root: HTMLElement; seat: HTMLElement; card: HTMLElement } {
    const root = document.createElement('div')
    root.setAttribute('data-phase', phase)
    const scroll = document.createElement('div')
    scroll.setAttribute('data-conversation-scroll', '')
    if (hasFlow) {
      const flow = document.createElement('div')
      flow.setAttribute('data-chat-flow', '')
      flow.setAttribute('data-chat-flow-kind', 'message')
      scroll.append(flow)
    }
    const seat = document.createElement('div')
    seat.setAttribute('data-composer-seat', '')
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', '')
    const textarea = document.createElement('textarea')
    card.append(textarea)
    seat.append(card)
    scroll.append(seat)
    root.append(scroll)
    document.body.append(root)
    return { root, seat, card }
  }

  function settingsFixture(): { slot: HTMLElement; dialog: HTMLElement } {
    const slot = document.createElement('div')
    slot.setAttribute('data-slot', 'sidebar.settings')
    const presentation = document.createElement('div')
    presentation.setAttribute('role', 'presentation')
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    presentation.append(dialog)
    slot.append(presentation)
    document.body.append(slot)
    return { slot, dialog }
  }

  it('mounts composer drag handles without throwing on initial binding (#1200)', () => {
    const { ctx, runCleanup } = setup()
    const { card } = composerFixture('active', true)

    expect(() => {
      defineSkinHooks().apply(ctx)
    }).not.toThrow()

    const left = card.querySelector('[data-orca-composer-handle="left"]')
    const right = card.querySelector('[data-orca-composer-handle="right"]')
    expect(left).not.toBeNull()
    expect(right).not.toBeNull()

    runCleanup()
    expect(card.querySelector('[data-orca-composer-handle]')).toBeNull()
  })

  it('synchronizes body[data-orca-settings-open] when settings dialog mounts and unmounts', async () => {
    const { ctx, runCleanup, flush } = setup()
    composerFixture('active', true)
    defineSkinHooks().apply(ctx)

    expect(document.body.hasAttribute('data-orca-settings-open')).toBe(false)

    const { slot } = settingsFixture()
    await flush()
    expect(document.body.hasAttribute('data-orca-settings-open')).toBe(true)

    slot.remove()
    await flush()
    expect(document.body.hasAttribute('data-orca-settings-open')).toBe(false)

    runCleanup()
  })

  it('operator sees composer handles mounted when conversation-scroll is nested in PTC tabs container', () => {
    // Given an active conversation root wrapping conversation-scroll within a PTC tabs container
    const { ctx, runCleanup } = setup()
    const root = document.createElement('div')
    root.setAttribute('data-phase', 'active')
    const tabsWrapper = document.createElement('div')
    tabsWrapper.setAttribute('data-ptc-tabs-panel', '')
    const scroll = document.createElement('div')
    scroll.setAttribute('data-conversation-scroll', '')
    const flow = document.createElement('div')
    flow.setAttribute('data-chat-flow', '')
    flow.setAttribute('data-chat-flow-kind', 'message')
    scroll.append(flow)
    const seat = document.createElement('div')
    seat.setAttribute('data-composer-seat', '')
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', '')
    const textarea = document.createElement('textarea')
    card.append(textarea)
    seat.append(card)
    scroll.append(seat)
    tabsWrapper.append(scroll)
    root.append(tabsWrapper)
    document.body.append(root)

    // When skin hooks are applied to the context
    defineSkinHooks().apply(ctx)

    // Then composer drag handles are successfully discovered and mounted on both edges
    const left = card.querySelector('[data-orca-composer-handle="left"]')
    const right = card.querySelector('[data-orca-composer-handle="right"]')
    expect(left?.getAttribute('data-orca-composer-handle')).toBe('left')
    expect(right?.getAttribute('data-orca-composer-handle')).toBe('right')

    runCleanup()
    expect(card.querySelector('[data-orca-composer-handle]')).toBe(null)
  })
})