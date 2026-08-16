/** @vitest-environment jsdom */

/**
 * The shutdown footer entry contract: the power trigger opens a confirm
 * dialog, cancel closes it, confirm POSTs to /api/dsh-shutdown and shows the
 * exiting state, a failed request surfaces an error with retry, and the
 * confirm gate can bypass the dialog entirely.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ShutdownEntry, type ShutdownEntryProps } from '../src/client/ShutdownEntry.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** English translate stub (same shape the family tests use). */
const t = ((key: string, params?: Record<string, unknown>) => {
  let text = (en as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}) as ShutdownEntryProps['t']

function makeProps(overrides: Partial<ShutdownEntryProps> = {}): ShutdownEntryProps {
  return { wide: true, t, confirmShutdown: () => true, ...overrides }
}

function stubFetch(impl: () => Promise<unknown>): ReturnType<typeof vi.fn> {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('ShutdownEntry', () => {
  it('opens the confirm dialog from the power trigger and cancels it', () => {
    render(<ShutdownEntry {...makeProps()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Exit DeepSeek Harness' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('confirms by POSTing to the shutdown route and shows the exiting state', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true }))
    render(<ShutdownEntry {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit DeepSeek Harness' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(await screen.findByText(/Exiting/)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/dsh-shutdown', { method: 'POST' })
  })

  it('surfaces a failed request with a retry action', async () => {
    const fetchMock = stubFetch(async () => { throw new Error('boom') })
    render(<ShutdownEntry {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit DeepSeek Harness' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(await screen.findByText(/Exit request failed: boom/)).toBeTruthy()
    // Retry now succeeds.
    fetchMock.mockImplementation(async () => ({ ok: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/Exiting/)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('skips the dialog when the confirm gate is off', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true }))
    render(<ShutdownEntry {...makeProps({ confirmShutdown: () => false })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit DeepSeek Harness' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText(/Exiting/)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/dsh-shutdown', { method: 'POST' })
  })
})
