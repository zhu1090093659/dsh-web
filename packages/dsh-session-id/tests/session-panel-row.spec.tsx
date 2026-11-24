// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'
import { en, type SessionIdKey } from '../src/client/locales.ts'
import { SessionIdEnvironmentRow } from '../src/client/SessionIdEnvironmentRow.tsx'

afterEach(() => {
  cleanup()
})

const t: ComponentProps<typeof SessionIdEnvironmentRow>['t'] = (key, params) => {
  const raw = (en as Record<string, string>)[key as SessionIdKey] ?? String(key)
  if (params === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}

describe('official session panel environment row', () => {
  it('operator sees session-id register into conversation.session.panel.environment.row alongside the sidebar footer entry', () => {
    // Given a client context exposing slots, locale, and sessions
    const registrations: Array<{ name: string; id?: string; order?: number; inject?: (sessionId: string) => unknown; component: unknown }> = []
    const ctx = {
      effect: (fn: () => unknown) => { fn(); return () => {} },
      locale: { register: () => () => {} },
      get: (name: string) => (name === 'sessions'
        ? { list: { getSnapshot: () => ({ ids: [], byId: {} }), subscribe: () => () => {} } }
        : undefined),
      slots: {
        inject: (_name: string, cb: () => unknown) => { cb() },
        register: (options: { name: string; id?: string; order?: number; inject?: (sessionId: string) => unknown }, component: unknown) => {
          registrations.push({ name: options.name, id: options.id, order: options.order, inject: options.inject, component })
          return () => {}
        },
      },
    } as unknown as ClientContext
    // When the session-id client plugin applies
    apply(ctx)
    // Then the active-session row is registered into conversation.session.panel.environment.row
    const envRow = registrations.find(entry => entry.name === 'conversation.session.panel.environment.row')
    expect(envRow?.id).toBe('session-id')
    expect(envRow?.order).toBe(40)
    expect(envRow?.inject?.('session-abc-123')).toEqual({ sessionId: 'session-abc-123' })
    expect(envRow?.component).toBe(SessionIdEnvironmentRow)
  })

  it('user viewing the Session Panel environment section copies the active session id in one click', async () => {
    // Given the environment row rendered for an active session id
    const copied: string[] = []
    const copy = vi.fn(async (text: string) => {
      copied.push(text)
      return true
    })
    const view = render(<SessionIdEnvironmentRow sessionId="session-abc-123" t={t} copy={copy} />)
    const row = view.container.querySelector('[data-session-panel-row]')
    expect(row?.getAttribute('data-dsh-plugin')).toBe('session-id')
    expect(row?.getAttribute('data-dsh-part')).toBe('environment-row')
    expect(row?.textContent).toContain('session-abc-123')
    // When the user clicks the row copy button
    const button = view.container.querySelector('[data-dsh-part="copy"]') as HTMLButtonElement
    fireEvent.click(button)
    // Then the exact session id is written to the clipboard and the button reflects the copied state
    await waitFor(() => {
      expect(button.getAttribute('data-copied')).toBe('true')
    })
    expect(copied).toEqual(['session-abc-123'])
  })
})
