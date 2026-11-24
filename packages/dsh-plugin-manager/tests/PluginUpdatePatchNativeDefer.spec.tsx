// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { en, type PluginManagerKey } from '../src/client/locales.ts'
import { IGNORED_UPDATES_STORAGE_KEY } from '../src/client/ignored-updates.ts'
import {
  PluginUpdatePatch,
  type PluginPageSubject,
  type PluginUpdatePatchInjected,
} from '../src/client/PluginUpdatePatch.tsx'
import type { InstallProgressItem } from '../src/core/protocol.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.body.innerHTML = ''
})

const t: ComponentProps<typeof PluginUpdatePatch>['t'] = (key, params) => {
  const text = (en as Record<string, string>)[key as PluginManagerKey] ?? String(key)
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}

const subject: PluginPageSubject = {
  kind: 'bundle',
  pkg: {
    name: '@linxin666/dsh-web-all',
    version: '0.4.22',
    installed: true,
    enabled: true,
    rows: [],
  },
}

const injected: PluginUpdatePatchInjected = {
  isLoopback: true,
  checkUpdates: async () => [],
  update: async () => ({
    plugin: {
      id: '@linxin666/dsh-web-all',
      name: '@linxin666/dsh-web-all',
      version: '0.4.22',
      source: { kind: 'npm', spec: '@linxin666/dsh-web-all@0.4.22' },
      installedAt: '2026-11-24T00:00:00.000Z',
      enabled: true,
    },
    restartRequired: [],
  }),
  status: async (): Promise<InstallProgressItem> => ({ kind: 'idle', stage: 'fetch' }),
}

describe('official native versions section deferral', () => {
  it('user opening a registry bundle page with official data-plugin-versions sees no duplicate check-for-updates section', () => {
    // Given an official plugin detail page that already renders its native versions section
    const nativeVersions = document.createElement('section')
    nativeVersions.setAttribute('data-plugin-versions', '')
    document.body.appendChild(nativeVersions)
    // When PluginUpdatePatch renders into plugins.detail.section
    const { container } = render(
      <PluginUpdatePatch
        {...injected as unknown as ComponentProps<typeof PluginUpdatePatch>}
        subject={subject}
        t={t}
      />,
    )
    // Then the duplicate family update-check section stays hidden
    expect(container.querySelector('[data-update-patch]')).toBeNull()
  })

  it('user with an ignored update version on a native versions page sees only the compact restore strip', () => {
    // Given an official native versions section and one ignored update version stored for this bundle
    const nativeVersions = document.createElement('section')
    nativeVersions.setAttribute('data-plugin-versions', '')
    document.body.appendChild(nativeVersions)
    localStorage.setItem(IGNORED_UPDATES_STORAGE_KEY, JSON.stringify([
      { id: '@linxin666/dsh-web-all', version: '0.5.0' },
    ]))
    // When PluginUpdatePatch renders and the user clicks Restore
    const { container } = render(
      <PluginUpdatePatch
        {...injected as unknown as ComponentProps<typeof PluginUpdatePatch>}
        subject={subject}
        t={t}
      />,
    )
    const section = container.querySelector('[data-update-patch]')
    expect(section?.getAttribute('data-update-patch-mode')).toBe('ignored-only')
    expect(screen.queryByRole('button', { name: t('checkUpdates') })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: t('restoreUpdate') }))
    // Then the ignored version is removed from storage and the strip disappears
    expect(JSON.parse(localStorage.getItem(IGNORED_UPDATES_STORAGE_KEY) ?? '[]')).toEqual([])
    expect(container.querySelector('[data-update-patch]')).toBeNull()
  })
})
