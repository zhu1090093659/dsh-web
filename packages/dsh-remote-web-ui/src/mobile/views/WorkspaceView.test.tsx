// @vitest-environment jsdom
/** Mobile workspace landing: roster rendering and QR deep-link selection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { mobileWorkspaceTarget } from './App.tsx'
import { WorkspaceView } from './WorkspaceView.tsx'

vi.mock('../api.ts', () => ({
  listWorkspaces: vi.fn(),
  listDirectory: vi.fn(),
  createWorkspace: vi.fn(),
}))
import { listWorkspaces, listDirectory, createWorkspace } from '../api.ts'

const listWorkspacesMock = vi.mocked(listWorkspaces)
const listDirectoryMock = vi.mocked(listDirectory)
const createWorkspaceMock = vi.mocked(createWorkspace)

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

describe('mobile workspace creation', () => {
  it('shows new workspace button and navigates to directory browser', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    listDirectoryMock.mockResolvedValue({
      path: '/home/user',
      home: '/home/user',
      crumbs: [{ name: '', path: '/', hidden: false }, { name: 'home', path: '/home', hidden: false }, { name: 'user', path: '/home/user', hidden: false }],
      entries: [
        { name: 'projects', path: '/home/user/projects', hidden: false },
        { name: '.config', path: '/home/user/.config', hidden: true }
      ],
      truncated: false
    })

    const onPick = vi.fn()
    render(<WorkspaceView onPick={onPick} />)

    // Wait for workspaces to load
    const createBtn = await screen.findByText('+ 新建工作区')
    
    // Click create button
    fireEvent.click(createBtn)

    // Verify directory browser renders
    expect(await screen.findByText('选择目录')).toBeTruthy()
    
    // Verify crumbs
    expect(await screen.findByText('user')).toBeTruthy()
    
    // Verify entries
    expect(await screen.findByText('projects')).toBeTruthy()
    expect(await screen.findByText('.config')).toBeTruthy()
  })

  it('navigates into directory and allows breadcrumb navigation', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    
    // Initial dir
    listDirectoryMock.mockResolvedValueOnce({
      path: '/home/user',
      home: '/home/user',
      crumbs: [{ name: '', path: '/', hidden: false }, { name: 'home', path: '/home', hidden: false }, { name: 'user', path: '/home/user', hidden: false }],
      entries: [{ name: 'projects', path: '/home/user/projects', hidden: false }],
      truncated: false
    })

    const onPick = vi.fn()
    render(<WorkspaceView onPick={onPick} />)

    // Open dir browser
    fireEvent.click(await screen.findByText('+ 新建工作区'))
    
    // Wait for first dir listing
    const projBtn = await screen.findByText('projects')

    // Prepare next listing
    listDirectoryMock.mockResolvedValueOnce({
      path: '/home/user/projects',
      home: '/home/user',
      crumbs: [
        { name: '', path: '/', hidden: false },
        { name: 'home', path: '/home', hidden: false },
        { name: 'user', path: '/home/user', hidden: false },
        { name: 'projects', path: '/home/user/projects', hidden: false }
      ],
      entries: [{ name: 'foo', path: '/home/user/projects/foo', hidden: false }],
      truncated: false
    })

    // Click into folder
    fireEvent.click(projBtn)

    // Verify new contents load
    expect(await screen.findByText('foo')).toBeTruthy()
    
    // Check breadcrumb
    const homeCrumb = screen.getByText('home')
    expect(homeCrumb).toBeTruthy()
    
    // Click breadcrumb
    listDirectoryMock.mockResolvedValueOnce({
      path: '/home',
      home: '/home/user',
      crumbs: [{ name: '', path: '/', hidden: false }, { name: 'home', path: '/home', hidden: false }],
      entries: [{ name: 'user', path: '/home/user', hidden: false }],
      truncated: false
    })
    
    fireEvent.click(homeCrumb)
    expect(await screen.findByText('user')).toBeTruthy()
  })

  it('creates workspace successfully', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    listDirectoryMock.mockResolvedValue({
      path: '/home/user/projects/foo',
      home: '/home/user',
      crumbs: [{ name: '', path: '/', hidden: false }, { name: 'foo', path: '/home/user/projects/foo', hidden: false }],
      entries: [],
      truncated: false
    })

    const newWorkspace = { ...workspaces[0], workspaceId: 'ws-new' as never, title: 'foo' }
    createWorkspaceMock.mockResolvedValue({
      workspace: newWorkspace,
      created: true
    })

    const onPick = vi.fn()
    render(<WorkspaceView onPick={onPick} />)

    fireEvent.click(await screen.findByText('+ 新建工作区'))
    
    const selectBtn = await screen.findByText('选择此目录')
    fireEvent.click(selectBtn)

    expect(await screen.findByText('创建中…')).toBeTruthy()
    
    await waitFor(() => {
      expect(createWorkspaceMock).toHaveBeenCalledWith('/home/user/projects/foo')
      expect(onPick).toHaveBeenCalledWith(newWorkspace)
    })
  })

  it('handles errors from directory listing and workspace creation', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    listDirectoryMock.mockRejectedValue(new Error('Permission denied'))

    const onPick = vi.fn()
    render(<WorkspaceView onPick={onPick} />)

    fireEvent.click(await screen.findByText('+ 新建工作区'))

    // Verify error from listing
    expect(await screen.findByText('Permission denied')).toBeTruthy()
    
    // Retry with success
    listDirectoryMock.mockResolvedValue({
      path: '/home',
      home: '/home/user',
      crumbs: [],
      entries: [],
      truncated: false
    })
    fireEvent.click(screen.getByText('重试'))
    
    const selectBtn = await screen.findByText('选择此目录')
    
    // Fail creation
    createWorkspaceMock.mockRejectedValue(new Error('Already exists'))
    fireEvent.click(selectBtn)

    expect(await screen.findByText('Already exists')).toBeTruthy()
  })
})
