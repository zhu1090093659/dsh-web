/** @vitest-environment jsdom */

/**
 * Sidebar foot card mounting: the container seats in the shell foot area
 * directly above the Settings row (keeping Settings the terminal row),
 * self-heals through the shared body-mutation hub when the shell re-renders
 * around it, stays single under duplicate mounts, and replays the user's
 * settings path on click-through.
 * The React body is covered by foot-card.spec.tsx; here only DOM placement
 * and the settings-navigation replay are under test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { FOOT_CARD_SELECTOR, mountUsageFootCard, openUsageSettings } from '../src/client/foot-card-mount.tsx'
import type { UsageFootCardProps } from '../src/client/UsageFootCard.tsx'
import type { UsageSettings } from '../src/client/UsageSectionCard.tsx'
import type { UsageStoreInstance, UsageUiState } from '../src/client/usage-store.ts'

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.lang = ''
})

/** A minimal shell: the sidebar column with its foot area (actions above the Settings seat). */
function shell(): { column: HTMLElement; foot: HTMLElement; settingsArea: HTMLElement } {
  const column = document.createElement('div')
  column.setAttribute('data-pane', 'sidebar')
  const foot = document.createElement('div')
  foot.className = 'SidebarRoot-footArea-x'
  const actions = document.createElement('div')
  actions.className = 'SidebarRoot-footerActions-x'
  const settingsArea = document.createElement('div')
  settingsArea.className = 'SidebarRoot-settingsArea-x'
  foot.append(actions, settingsArea)
  column.append(foot)
  document.body.append(column)
  return { column, foot, settingsArea }
}

/** Mount props over a loading store; the React body is not under test here. */
function mountProps(extra: Partial<UsageFootCardProps> = {}): UsageFootCardProps {
  const state: UsageUiState = { snapshot: null, status: 'loading', error: null }
  const store = { subscribe: () => () => {}, getSnapshot: () => state } as unknown as UsageStoreInstance
  const snapshot: ConfigFormSnapshot<UsageSettings> = {
    status: 'ready',
    value: { enabled: false },
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
  }
  const settings = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: () => Promise.resolve(true),
    unset: () => Promise.resolve(false),
    mutate: () => Promise.resolve(false),
  } as unknown as ConfigForm<UsageSettings>
  return { store, poll: () => {}, onOpen: () => {}, settings, ...extra }
}

describe('mountUsageFootCard placement', () => {
  it('user finds the card directly above the sidebar Settings row', () => {
    // Given the shell sidebar with its foot area
    const { foot, settingsArea } = shell()

    // When the foot card mounts
    const dispose = mountUsageFootCard(mountProps())

    // Then its container sits just before the Settings seat, which stays last
    const container = document.querySelector(FOOT_CARD_SELECTOR)
    expect(container?.parentElement).toBe(foot)
    expect(container?.nextElementSibling).toBe(settingsArea)
    expect(foot.lastElementChild).toBe(settingsArea)
    dispose()
  })

  it('user keeps exactly one card when the mount runs twice', () => {
    // Given one mounted card
    shell()
    const first = mountUsageFootCard(mountProps())

    // When a duplicate apply mounts again
    const second = mountUsageFootCard(mountProps())

    // Then the second mount is an inert no-op and the foot still carries one card
    expect(document.querySelectorAll(FOOT_CARD_SELECTOR)).toHaveLength(1)
    second()
    expect(document.querySelectorAll(FOOT_CARD_SELECTOR)).toHaveLength(1)
    first()
    expect(document.querySelectorAll(FOOT_CARD_SELECTOR)).toHaveLength(0)
  })

  it('user keeps the card directly above Settings when the shell inserts a node between them', async () => {
    // Given a mounted card seated directly above the Settings seat
    const { foot, settingsArea } = shell()
    const dispose = mountUsageFootCard(mountProps())
    const container = document.querySelector(FOOT_CARD_SELECTOR)

    // When the shell re-renders and a foreign node lands between the two
    foot.insertBefore(document.createElement('div'), settingsArea)

    // Then the next body-mutation flush re-seats the card above Settings
    await vi.waitFor(() => {
      expect(container?.nextElementSibling).toBe(settingsArea)
    })
    dispose()
  })

  it('user keeps the card when the shell rebuilds the whole sidebar pane', async () => {
    // Given a mounted card whose sidebar pane is torn down
    const first = shell()
    const dispose = mountUsageFootCard(mountProps())
    const container = document.querySelector(FOOT_CARD_SELECTOR)

    // When the shell rebuilds the pane from scratch
    first.column.remove()
    const second = shell()

    // Then the card re-seats into the new foot area, again above Settings
    await vi.waitFor(() => {
      expect(container?.parentElement).toBe(second.foot)
      expect(container?.nextElementSibling).toBe(second.settingsArea)
    })
    dispose()
  })

  it('user loses the card once the plugin unmounts it', () => {
    // Given a mounted card
    shell()
    const dispose = mountUsageFootCard(mountProps())
    expect(document.querySelectorAll(FOOT_CARD_SELECTOR)).toHaveLength(1)

    // When the apply body disposes the mount
    dispose()

    // Then the container leaves the sidebar foot
    expect(document.querySelectorAll(FOOT_CARD_SELECTOR)).toHaveLength(0)
  })
})

describe('openUsageSettings navigation replay', () => {
  /** A Settings trigger whose click mounts a fake panel whose rows record clicks. */
  function trigger(navLabels: string[]): { button: HTMLButtonElement; clicks: () => number } {
    let clicks = 0
    const button = document.createElement('button')
    button.type = 'button'
    button.addEventListener('click', () => {
      clicks += 1
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      const nav = document.createElement('nav')
      for (const label of navLabels) {
        const row = document.createElement('button')
        row.type = 'button'
        row.textContent = label
        row.addEventListener('click', () => { row.dataset.clicked = 'true' })
        nav.append(row)
      }
      dialog.append(nav)
      document.body.append(dialog)
    })
    return { button, clicks: () => clicks }
  }

  it('user lands on the usage section when the card opens settings', async () => {
    // Given the shell sidebar whose Settings trigger opens a panel with a usage row
    const { settingsArea } = shell()
    const settingsTrigger = trigger(['General', '使用统计'])
    settingsArea.append(settingsTrigger.button)

    // When the card's open path runs
    openUsageSettings(() => '使用统计')

    // Then the trigger opens the panel and the usage nav row gets selected
    await vi.waitFor(() => {
      expect(settingsTrigger.clicks()).toBe(1)
      expect(document.querySelectorAll('[role="dialog"] nav button')).toHaveLength(2)
      const usageRow = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] nav button')]
        .find((row) => row.textContent?.includes('使用统计'))
      expect(usageRow?.dataset.clicked).toBe('true')
    })
    // And the foreign row stays untouched
    const general = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] nav button')]
      .find((row) => row.textContent === 'General')
    expect(general?.dataset.clicked).toBeUndefined()
  })

  it('user keeps the already open panel when its nav lacks the usage row', () => {
    // Given an already open settings panel without the usage section
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const nav = document.createElement('nav')
    const general = document.createElement('button')
    general.type = 'button'
    general.textContent = 'General'
    general.addEventListener('click', () => { general.dataset.clicked = 'true' })
    nav.append(general)
    dialog.append(nav)
    document.body.append(dialog)
    const { settingsArea } = shell()
    const settingsTrigger = trigger(['General'])
    settingsArea.append(settingsTrigger.button)

    // When the card's open path runs
    openUsageSettings(() => '使用统计')

    // Then the trigger never toggles the open panel shut and no foreign row is clicked
    expect(settingsTrigger.clicks()).toBe(0)
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(general.dataset.clicked).toBeUndefined()
  })
})
