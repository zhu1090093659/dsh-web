// @vitest-environment jsdom
/** Mobile workspace landing: roster rendering and QR deep-link selection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { mobileWorkspaceTarget } from './App.tsx'
import { WorkspaceView } from './WorkspaceView.tsx'

vi.mock('../api.ts', () => ({
  listWorkspaces: vi.fn(),
}))
import { listWorkspaces } from '../api.ts'

const listWorkspacesMock = vi.mocked(listWorkspaces)
const workspaces: WorkspaceRow[] = [
  {
    workspaceId: 'ws-1' as never,
    path: '/tmp/first',
    title: 'First',
    sessionIds: [] as never,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    workspaceId: 'ws-2' as never,
    path: '/tmp/second',
    title: 'Second',
    sessionIds: [] as never,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('mobile workspace deep link', () => {
  it('reads a non-empty workspace target from the query', () => {
    expect(mobileWorkspaceTarget('?workspace=ws-2')).toBe('ws-2')
    expect(mobileWorkspaceTarget('?workspace=')).toBeUndefined()
    expect(mobileWorkspaceTarget('')).toBeUndefined()
  })

  it('opens the targeted workspace as soon as the roster loads', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    const onPick = vi.fn()

    render(<WorkspaceView initialWorkspaceId="ws-2" onPick={onPick} />)

    await waitFor(() => expect(onPick).toHaveBeenCalledWith(workspaces[1]))
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('falls back to the roster when the target no longer exists', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    const onPick = vi.fn()

    render(<WorkspaceView initialWorkspaceId="missing" onPick={onPick} />)

    expect(await screen.findByText('First')).toBeTruthy()
    expect(await screen.findByText('Second')).toBeTruthy()
    expect(onPick).not.toHaveBeenCalled()
  })
})
