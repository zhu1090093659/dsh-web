/** @vitest-environment jsdom */

/**
 * Mounting the update toolbar beside the official Plugins page's "Installed"
 * heading: where the container lands, that duplicate mounts stay inert, that a
 * re-render which replaces the heading re-seats it, that a language switch
 * reaches the mounted copy, and that the plugin unmounting removes it. The
 * React body is covered by plugin-list-toolbar.spec.tsx; here only DOM
 * placement and re-rendering are under test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountPluginListToolbar, TOOLBAR_MOUNT_SELECTOR, toolbarSeat, type PluginToolbarMountOptions } from '../src/client/plugin-toolbar-mount.tsx'
import { en, type PluginManagerKey } from '../src/client/locales.ts'
import type { PluginListToolbarProps } from '../src/client/PluginListToolbar.tsx'

afterEach(() => { document.body.innerHTML = '' })

/** English translate stub. */
const t: PluginListToolbarProps['t'] = (key, params) => {
  const text = (en as Record<string, string>)[key as PluginManagerKey] ?? String(key)
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}

/** The official Plugins page's list view: the "Installed" group and its heading. */
function pluginPage(): { page: HTMLElement; group: HTMLElement; head: HTMLElement } {
  const page = document.createElement('section')
  page.setAttribute('data-plugin-panel', '')
  const group = document.createElement('section')
  group.setAttribute('data-plugin-group', 'bundles')
  const head = document.createElement('div')
  head.className = 'Page_module_groupHead-hash'
  const title = document.createElement('h3')
  title.textContent = 'Installed'
  const count = document.createElement('span')
  count.textContent = '7'
  head.append(title, count)
  const list = document.createElement('ul')
  group.append(head, list)
  page.append(group)
  document.body.append(page)
  return { page, group, head }
}

/**
 * A batch result. This file never clicks the update action, so only the resolved
 * shape matters here; the React body is covered by plugin-list-toolbar.spec.tsx.
 */
const updateAll: PluginListToolbarProps['updateAll'] = async ids => ({
  applied: ids.map(id => ({ id, phase: 'done', landed: '1.0.0' }) as const),
  failed: [],
})

/** Mount options over an inert face; the React body is not under test here. */
function options(extra: Partial<PluginToolbarMountOptions> = {}): PluginToolbarMountOptions {
  return {
    props: () => ({
      isLoopback: true,
      checkUpdates: async () => [],
      updateAll,
      restartPlan: async () => ({ mode: 'relaunch' as const }),
      restart: async () => 'relaunch' as const,
      t,
    }),
    ...extra,
  }
}

/** The mounted container's rendered toolbar, once React has flushed. */
async function mountedToolbar(): Promise<Element | null> {
  await vi.waitFor(() => {
    expect(document.querySelector('[data-update-toolbar]')?.getAttribute('data-dsh-plugin')).toBe('plugin-manager')
  })
  return document.querySelector('[data-update-toolbar]')
}

describe('toolbar placement', () => {
  it('user finds the toolbar in the Installed heading', async () => {
    // Given the official Plugins page list view
    const { head } = pluginPage()

    // When the toolbar mounts
    const dispose = mountPluginListToolbar(options())

    // Then its container is a child of that heading, rendering the toolbar
    const container = document.querySelector(TOOLBAR_MOUNT_SELECTOR)
    expect(container?.parentElement).toBe(head)
    const toolbar = await mountedToolbar()
    expect(toolbar?.getAttribute('data-dsh-part')).toBe('update-toolbar')
    dispose()
  })

  it('user keeps exactly one toolbar when the mount runs twice', async () => {
    // Given one mounted toolbar
    pluginPage()
    const first = mountPluginListToolbar(options())
    await mountedToolbar()

    // When a duplicate apply mounts again
    const second = mountPluginListToolbar(options())

    // Then the second mount is an inert no-op, and its own disposal leaves the first
    expect(document.querySelectorAll(TOOLBAR_MOUNT_SELECTOR)).toHaveLength(1)
    second()
    expect(document.querySelectorAll(TOOLBAR_MOUNT_SELECTOR)).toHaveLength(1)
    first()
    expect(document.querySelectorAll(TOOLBAR_MOUNT_SELECTOR)).toHaveLength(0)
  })

  it('user sees no toolbar while the page is off the list view', () => {
    // Given a Plugins page showing a detail view (no Installed group)
    const page = document.createElement('section')
    page.setAttribute('data-plugin-panel', '')
    document.body.append(page)

    // When the toolbar is mounted and the seat is resolved
    const dispose = mountPluginListToolbar(options())

    // Then nothing is left behind on the page
    expect(toolbarSeat()).toBeUndefined()
    expect(document.querySelector(TOOLBAR_MOUNT_SELECTOR)).toBeNull()
    dispose()
  })

  it('user keeps the toolbar when the page rebuilds the heading', async () => {
    // Given a mounted toolbar
    const { page, group } = pluginPage()
    const dispose = mountPluginListToolbar(options())
    await mountedToolbar()
    const container = document.querySelector(TOOLBAR_MOUNT_SELECTOR)

    // When the page re-renders the group head from scratch
    const rebuilt = document.createElement('div')
    rebuilt.className = 'Page_module_groupHead-hash'
    rebuilt.append(document.createElement('h3'), document.createElement('span'))
    group.replaceChild(rebuilt, group.firstElementChild as HTMLElement)
    page.append(document.createElement('div'))

    // Then the container re-seats into the new heading
    await vi.waitFor(() => { expect(container?.parentElement).toBe(rebuilt) })
    dispose()
  })

  it('user loses the toolbar once the plugin unmounts it', async () => {
    // Given a mounted toolbar
    pluginPage()
    const dispose = mountPluginListToolbar(options())
    await mountedToolbar()

    // When the apply body disposes the mount
    dispose()

    // Then the container left the page
    expect(document.querySelectorAll(TOOLBAR_MOUNT_SELECTOR)).toHaveLength(0)
  })

  it('user sees the mounted toolbar follow a language switch', async () => {
    // Given a mount subscribed to locale changes
    pluginPage()
    const listeners = new Set<() => void>()
    let label = 'Check for updates'
    const dispose = mountPluginListToolbar({
      props: () => ({
        isLoopback: true,
        checkUpdates: async () => [],
        updateAll,
        restartPlan: async () => ({ mode: 'relaunch' as const }),
        restart: async () => 'relaunch' as const,
        t: () => label,
      }),
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    })
    await vi.waitFor(() => {
      expect(document.querySelector('[data-update-toolbar]')?.textContent).toContain('Check for updates')
    })

    // When the active language moves
    label = 'Проверить обновления'
    for (const listener of [...listeners]) listener()

    // Then the mounted copy follows it
    await vi.waitFor(() => {
      expect(document.querySelector('[data-update-toolbar]')?.textContent).toContain('Проверить обновления')
    })
    dispose()
  })
})
