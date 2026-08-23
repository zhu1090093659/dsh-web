// @vitest-environment jsdom
/** SessionListView: owned-row filtering, incremental pages, session creation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { SessionListView, type SessionListViewProps } from './SessionListView.tsx'
import { type SessionView } from './App.tsx'

// The api module is fully mocked; the view's App.tsx helpers stay real.
vi.mock('../api.ts', () => ({
  listSessions: vi.fn(),
  listWorkspaces: vi.fn(),
  listAgentPresets: vi.fn(),
  createSession: vi.fn(),
}))
import { createSession, listAgentPresets, listSessions, listWorkspaces } from '../api.ts'

const listSessionsMock = vi.mocked(listSessions)
const listWorkspacesMock = vi.mocked(listWorkspaces)
const listAgentPresetsMock = vi.mocked(listAgentPresets)
const createSessionMock = vi.mocked(createSession)

const workspace: WorkspaceRow = {
  workspaceId: 'w-1' as never,
  path: '/tmp/demo',
  title: '演示项目',
  sessionIds: ['s-1'] as never,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** A session.list summary row. */
function summary(sessionId: string, updatedAt: number, extra: Record<string, unknown> = {}): never {
  return { sessionId, updatedAt, running: false, blank: false, ...extra } as never
}

let picked: SessionView | undefined

function renderList(props: Partial<SessionListViewProps> = {}): void {
  picked = undefined
  render(
    <SessionListView
      workspace={workspace}
      onBack={() => {}}
      onPick={(session) => { picked = session }}
      {...props}
    />,
  )
}

beforeEach(() => {
  listSessionsMock.mockResolvedValue({ items: [], hasMore: false })
  listWorkspacesMock.mockResolvedValue([workspace])
  listAgentPresetsMock.mockResolvedValue({ presets: [], authorable: false, hasDocument: false })
  createSessionMock.mockResolvedValue({ sessionId: 's-new' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SessionListView roster', () => {
  it('renders the sessions owned by the workspace', async () => {
    listSessionsMock.mockResolvedValue({
      items: [
        summary('s-1', 1_700_000_000_000, { projections: { values: { title: '改造移动端' } } }),
        summary('s-other', 1_600_000_000_000, { cwd: '/tmp/foreign' }),
      ],
      hasMore: false,
    })
    renderList()

    expect(await screen.findByText('改造移动端')).toBeTruthy()
    // The foreign session (not in workspace.sessionIds) stays hidden.
    expect(screen.queryByText(/foreign/)).toBeNull()
  })

  it('shows the empty state when the workspace owns no sessions', async () => {
    renderList()
    expect(await screen.findByText(/还没有会话/)).toBeTruthy()
  })

  it('refreshes the owned-id set from workspace.list on mount', async () => {
    listSessionsMock.mockResolvedValue({
      items: [summary('s-2', 1_700_000_000_000, { cwd: '/tmp/other' })],
      hasMore: false,
    })
    listWorkspacesMock.mockResolvedValue([
      { ...workspace, sessionIds: ['s-2'] as never },
    ])
    renderList()
    // s-2 is absent from the stale row but present in the fresh roster.
    expect(await screen.findByText(/other/)).toBeTruthy()
  })
})

describe('SessionListView creation', () => {
  it('creates a blank session in the workspace and opens it immediately', async () => {
    renderList()
    await screen.findByText(/还没有会话/)

    fireEvent.click(screen.getByRole('button', { name: '+ 新建会话' }))

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledWith({ workspaceId: 'w-1' })
    })
    await waitFor(() => {
      expect(picked).toBeDefined()
    })
    expect(picked?.sessionId).toBe('s-new')
    expect(picked?.blank).toBe(true)
    // Blank sessions are filtered from the list (desktop parity): the fresh
    // row is not rendered until the session has content.
    await waitFor(() => {
      expect(screen.queryByText('新会话')).toBeNull()
    })
  })

  it('creates the session with the selected agent preset', async () => {
    listAgentPresetsMock.mockResolvedValue({
      presets: [
        { id: 'router-standard', name: 'Router Standard', trust: 'system', isDefault: true },
        { id: 'router-spec', name: 'Router Spec', description: '规格驱动模式', trust: 'system', isDefault: false },
      ],
      authorable: false,
      hasDocument: false,
    })
    renderList()

    const picker = await screen.findByRole('combobox', { name: 'Agent 模式' })
    expect((picker as HTMLSelectElement).value).toBe('router-standard')
    fireEvent.change(picker, { target: { value: 'router-spec' } })
    fireEvent.click(screen.getByRole('button', { name: '+ 新建会话' }))

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledWith({ workspaceId: 'w-1', agentPreset: 'router-spec' })
    })
    expect(await screen.findByText('规格驱动模式')).toBeTruthy()
  })

  it('skips a broken default preset and disables it in the picker', async () => {
    listAgentPresetsMock.mockResolvedValue({
      presets: [
        { id: 'broken-default', trust: 'system', isDefault: true, broken: 'missing plugin' },
        { id: 'local-router', name: 'Local Router', trust: 'user', isDefault: false },
      ],
      authorable: false,
      hasDocument: false,
    })
    renderList()

    const picker = await screen.findByRole('combobox', { name: 'Agent 模式' }) as HTMLSelectElement
    expect(picker.value).toBe('local-router')
    expect(screen.getByRole('option', { name: 'broken-default（默认）（不可用）' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('option', { name: 'Local Router（本地）' })).toBeTruthy()
  })

  it('keeps default session creation available when the preset roster fails', async () => {
    listAgentPresetsMock.mockRejectedValue(new Error('preset roster unavailable'))
    renderList()
    await screen.findByText(/还没有会话/)

    const button = await screen.findByRole('button', { name: '+ 新建会话' })
    await waitFor(() => { expect(button.hasAttribute('disabled')).toBe(false) })
    fireEvent.click(button)

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledWith({ workspaceId: 'w-1' })
    })
  })

  it('waits for the preset roster before enabling session creation', async () => {
    let resolvePresets: (value: Awaited<ReturnType<typeof listAgentPresets>>) => void = () => {}
    listAgentPresetsMock.mockReturnValue(new Promise(resolve => { resolvePresets = resolve }))
    renderList()

    const button = screen.getByRole('button', { name: '+ 新建会话' })
    expect(button.hasAttribute('disabled')).toBe(true)

    resolvePresets({ presets: [], authorable: false, hasDocument: false })
    await waitFor(() => { expect(button.hasAttribute('disabled')).toBe(false) })
  })

  it('keeps the button disabled while a creation is in flight', async () => {
    let resolveCreate: (value: { sessionId: string }) => void = () => {}
    createSessionMock.mockReturnValue(new Promise(resolve => { resolveCreate = resolve }))
    renderList()
    await screen.findByText(/还没有会话/)

    fireEvent.click(screen.getByRole('button', { name: '+ 新建会话' }))
    const button = await screen.findByRole('button', { name: '创建中…' })
    expect(button.hasAttribute('disabled')).toBe(true)

    resolveCreate({ sessionId: 's-new' })
    await waitFor(() => { expect(picked).toBeDefined() })
  })

  it('shows the stale-host hint when creation is refused with HTTP 403', async () => {
    createSessionMock.mockRejectedValue(new Error('HTTP 403'))
    renderList()
    await screen.findByText(/还没有会话/)

    fireEvent.click(screen.getByRole('button', { name: '+ 新建会话' }))

    expect(await screen.findByText(/HTTP 403/)).toBeTruthy()
    expect(await screen.findByText(/重启 dsh web/)).toBeTruthy()
    expect(picked).toBeUndefined()
  })
})
