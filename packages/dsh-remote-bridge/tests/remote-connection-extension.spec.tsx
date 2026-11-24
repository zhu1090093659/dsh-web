// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'
import { en, type RemoteBridgeKey } from '../src/client/locales.ts'
import { RemoteConnectionExtension } from '../src/client/RemoteConnectionExtension.tsx'

afterEach(() => {
  cleanup()
})

const t: ComponentProps<typeof RemoteConnectionExtension>['t'] = (key, params) => {
  const raw = (en as Record<string, string>)[key as RemoteBridgeKey] ?? String(key)
  if (params === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}

describe('official settings.remoteConnection.extensions integration', () => {
  it('operator sees remote-bridge register its iOS pairing card into settings.remoteConnection.extensions', () => {
    // Given a client context exposing slots and locale
    const registrations: Array<{ name: string; id?: string; order?: number; component: unknown }> = []
    const ctx = {
      effect: (fn: () => unknown) => { fn(); return () => {} },
      locale: { register: () => () => {} },
      slots: {
        inject: (_name: string, cb: () => unknown) => { cb() },
        register: (options: { name: string; id?: string; order?: number }, component: unknown) => {
          registrations.push({ name: options.name, id: options.id, order: options.order, component })
          return () => {}
        },
      },
    } as unknown as ClientContext
    // When the remote-bridge client plugin applies
    apply(ctx)
    // Then an extension entry is registered into settings.remoteConnection.extensions
    const ext = registrations.find(entry => entry.name === 'settings.remoteConnection.extensions')
    expect(ext?.id).toBe('remote-bridge-ios')
    expect(ext?.component).toBe(RemoteConnectionExtension)
  })

  it('user opening the Remote Connection extension card requests a pairing code and opens the QR modal', async () => {
    // Given an extension card rendered in the official Remote Connection settings panel
    let readCount = 0
    const read = async () => {
      readCount += 1
      return {
        kind: 'ok' as const,
        token: 'dsh-pair-token-123',
        expiresAt: 4_102_444_800_000,
        origin: 'https://relay.example.com',
        originSource: 'realtime' as const,
        pairingUrl: 'https://relay.example.com/pair?token=dsh-pair-token-123',
      }
    }
    const copy = async () => true
    const view = render(<RemoteConnectionExtension read={read} copy={copy} t={t} />)
    const card = view.container.querySelector('[data-dsh-part="remote-connection-extension"]')
    expect(card?.getAttribute('data-dsh-plugin')).toBe('remote-bridge')
    // When the user clicks the pairing button
    fireEvent.click(screen.getByRole('button', { name: t('entry.label') }))
    // Then the host pair-token route is queried and the pairing modal renders the pairing URL
    await waitFor(() => {
      expect(readCount).toBe(1)
      expect(screen.getByRole('button', { name: t('action.copy') }).tagName).toBe('BUTTON')
    })
    const qr = document.querySelector('[data-dsh-qr-value]')
    expect(qr?.getAttribute('data-dsh-qr-value')).toContain('dsh-pair-token-123')
  })
})
