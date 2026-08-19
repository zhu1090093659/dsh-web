/** @vitest-environment jsdom */

/**
 * The shutdown footer entry contract: the power trigger opens a confirm
 * dialog, cancel closes it, confirm POSTs to the shutdown route, closes the
 * current page, and shows the exiting state; a failed request surfaces an
 * error with retry; the confirm gate can bypass the dialog entirely.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
// The api module touches window.close / window.location.replace (jsdom would
// tear the environment down); mock it so the component flow is testable.
vi.mock('../src/client/shutdown-api.ts', () => ({
  requestShutdown: vi.fn(),
  closeCurrentPage: vi.fn(),
}))
import { closeCurrentPage, requestShutdown } from '../src/client/shutdown-api.ts'
import { ShutdownEntry, type ShutdownEntryProps } from '../src/client/ShutdownEntry.tsx'
import { en } from '../src/client/locales.ts'

const mockedRequestShutdown = vi.mocked(requestShutdown)
const mockedCloseCurrentPage = vi.mocked(closeCurrentPage)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
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

describe('ShutdownEntry', () => {
  it('opens the confirm dialog from the power trigger and cancels it', () => {
    render(<ShutdownEntry {...makeProps()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Exit DeepSeek Harness' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockedRequestShutdown).not.toHaveBeenCalled()
    expect(mockedCloseCurrentPage).not.toHaveBeenCalled()
  })

  it('confirms by POSTing to the shutdown route, closes the page and shows the exiting state', async () => {
    mockedRequestShutdown.mockResolvedValueOnce(undefined)
    render(<ShutdownEntry {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit DeepSeek Harness' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(await screen.findByText(/Exiting/)).toBeTruthy()
    expect(mockedRequestShutdown).toHaveBeenCalledTimes(1)
    expect(mockedCloseCurrentPage).toHaveBeenCalledTimes(1)
  })

  it('surfaces a failed request with a retry action and never closes the page', async () => {
    mockedRequestShutdown.mockRejectedValueOnce(new Error('boom'))
    render(<ShutdownEntry {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit DeepSeek Harness' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(await screen.findByText(/Exit request failed: boom/)).toBeTruthy()
    expect(mockedCloseCurrentPage).not.toHaveBeenCalled()
    // Retry now succeeds.
    mockedRequestShutdown.mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/Exiting/)).toBeTruthy()
    expect(mockedRequestShutdown).toHaveBeenCalledTimes(2)
    expect(mockedCloseCurrentPage).toHaveBeenCalledTimes(1)
  })

  it('skips the dialog when the confirm gate is off', async () => {
    mockedRequestShutdown.mockResolvedValueOnce(undefined)
    render(<ShutdownEntry {...makeProps({ confirmShutdown: () => false })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit DeepSeek Harness' }))
    // No confirm prompt: the confirm/cancel buttons never appear, and the
    // exiting status is shown instead.
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Exit' })).toBeNull()
    expect(await screen.findByText(/Exiting/)).toBeTruthy()
    expect(mockedRequestShutdown).toHaveBeenCalledTimes(1)
    expect(mockedCloseCurrentPage).toHaveBeenCalledTimes(1)
  })
})