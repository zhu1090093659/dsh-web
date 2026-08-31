// @vitest-environment jsdom
/**
 * Branch-chip behavior tests: the input selector context entry renders the
 * branch chip from the session baseline, non-repository workspaces (and
 * sessions without a cwd) hide it, blank (hero) sessions keep it mounted,
 * the popover searches/filters and marks the current branch, the footer
 * flows fire the right verbs, switch rejections surface readable copy, and
 * the create/graph dialogs behave (validation, duplicate copy, lane
 * rendering).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { BranchesView, GraphView, RepoStatus, SwitchResult, WorktreeListView } from '../src/core/types.ts'
import type { GitGraphInjected } from '../src/client/index.ts'
import type { BranchChipProps } from '../src/client/chips/BranchChip.tsx'
import { BranchChip } from '../src/client/chips/BranchChip.tsx'
import { GraphDialog } from '../src/client/graph/GraphDialog.tsx'
import { zh, type GitGraphKey } from '../src/client/locales.ts'
import css from '../src/client/chips/context.module.css'

afterEach(() => {
  cleanup()
  for (const name of document.body.getAttributeNames()) {
    if (name.startsWith('data-dsh-') || name === 'data-ds-dark-theme') document.body.removeAttribute(name)
  }
})

const sid = (value: string): SessionId => value as SessionId

/** Minimal translate over the zh dictionary (template params included). */
function makeTranslate(): BranchChipProps['t'] {
  return (key, params) => {
    let text = zh[key as GitGraphKey] ?? key
    if (params !== undefined) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}

/** Resolve the positioning anchor of a mounted chip (its parent is chipWrap). */
function anchorOf(chip: HTMLElement): HTMLElement {
  const anchor = chip.parentElement?.closest<HTMLElement>('[data-gitgraph-chip-anchor]')
  if (anchor === null || anchor === undefined) throw new Error('BranchChip anchor not found')
  return anchor
}

/** Wait one animation frame when the environment provides requestAnimationFrame. */
function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  return new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
}

interface BenchOptions {
  cwd?: string
  blank?: boolean
  repoStatus?: RepoStatus | null
  branchesView?: BranchesView | null
  switchResult?: SwitchResult
  createResult?: SwitchResult
  graphView?: GraphView | null
  /** The worktree list served by the worktrees verb. */
  worktreesView?: WorktreeListView | null
  /** Scripted createWorktreeSession outcome. */
  createWorktreeResult?: { ok: true; path: string; branch: string; name: string } | { ok: false; error: { code: 'worktree-already-exists'; message: string } }
  /** Override the graph verb (e.g. a deferred promise for the loading state). */
  graph?: (limit?: number) => Promise<GraphView | null>
  /** The dock seat's conversation composer phase (blank = the hero phase). */
  /** The dock seat's conversation open state (open = the hero phase). */
  openState?: 'open' | 'loading'
  /** Render into this element instead of the RTL default container. */
  container?: HTMLElement
}

/** The seat whose props the bench should compose. */
type BenchSeat = 'context' | 'dock'

/** Render the branch chip with stub framework hooks and a scripted inject face. */
function bench(options: BenchOptions = {}, seat: BenchSeat = 'context') {
  const sessionId = sid('sess-1')
  const cwd = 'cwd' in options ? options.cwd : '/ws/proj'
  const repoStatus = options.repoStatus === undefined
    ? { root: '/ws/proj', branch: 'main', head: 'abc1234', dirtyFiles: 0, untrackedFiles: 0, conflicts: 0, operationInProgress: false }
    : options.repoStatus
  const branchesView = options.branchesView === undefined
    ? {
      root: '/ws/proj', branch: 'main',
      branches: [
        { name: 'feature/x', current: false },
        { name: 'main', current: true },
      ],
      dirtyFiles: 0, untrackedFiles: 0, conflicts: 0, operationInProgress: false,
    }
    : options.branchesView

  const calls: Record<string, unknown[]> = {
    repoStatus: [], branches: [], switchBranch: [], createBranch: [], graph: [],
    worktrees: [], createWorktreeSession: [], removeWorktree: [], gitConfig: [],
    subscribeChanges: [],
  }
  const record = <K extends keyof typeof calls>(key: K, ...args: unknown[]): void => {
    calls[key].push(args)
  }

  const injected: GitGraphInjected = {
    // Mirrors the real inject face: without a session cwd every git verb
    // resolves no workspace (null), so the chip has nothing to show.
    repoStatus: vi.fn(async (sessionId: SessionId | undefined) => { record('repoStatus', sessionId); return cwd === undefined ? null : repoStatus }),
    branches: vi.fn(async (sessionId: SessionId | undefined) => { record('branches', sessionId); return cwd === undefined ? null : branchesView }),
    switchBranch: vi.fn(async (sessionId: SessionId | undefined, branch: string) => {
      record('switchBranch', sessionId, branch)
      return options.switchResult ?? { ok: true, branch }
    }),
    createBranch: vi.fn(async (sessionId: SessionId | undefined, name: string) => {
      record('createBranch', sessionId, name)
      return options.createResult ?? { ok: true, branch: name }
    }),
    graph: vi.fn(async (sessionId: SessionId | undefined, limit?: number) => {
      record('graph', sessionId, limit)
      return options.graph !== undefined ? options.graph(limit) : options.graphView ?? null
    }),
    worktrees: vi.fn(async (sessionId: SessionId | undefined) => {
      record('worktrees', sessionId)
      return options.worktreesView === undefined ? null : options.worktreesView
    }),
    createWorktreeSession: vi.fn(async (sessionId: SessionId | undefined, name: string, baseRef?: string) => {
      record('createWorktreeSession', sessionId, name, baseRef)
      return options.createWorktreeResult ?? { ok: true as const, path: `/home/u/.dsh/worktrees/proj-a1b2c3d4/${name}`, branch: `wt/${name}`, name }
    }),
    removeWorktree: vi.fn(async (sessionId: SessionId | undefined, worktreePath: string, opts?: { force?: boolean }) => {
      record('removeWorktree', sessionId, worktreePath, opts)
      return { ok: true as const }
    }),
    gitConfig: vi.fn(async () => {
      record('gitConfig')
      return { autoIsolate: false, autoBaseline: 'current' as const, worktreesHome: '/home/u/.dsh/worktrees' }
    }),
    subscribeChanges: vi.fn((sessionId: SessionId | undefined, _onChange: () => void) => { record('subscribeChanges', sessionId); return () => {} }),
  }

  const blank = options.blank ?? seat === 'context'
  const sessionsState = {
    byId: { [sessionId]: { cwd, blank } },
  }
  const commonProps = {
    // The context/dock holes read their state from the standard session kit +
    // the inject face; the dock seat additionally carries the conversation
    // snapshot used to identify the blank hero phase.
    useSession: (() => undefined) as never,
    useSessions: ((selector: (state: typeof sessionsState) => unknown) => selector(sessionsState)) as never,
    useWorkspaces: (() => undefined) as never,
    useProjection: (() => undefined) as never,
    t: makeTranslate(),
    ...injected,
  } as const

  let props: BranchChipProps
  if (seat === 'dock') {
    props = {
      ...commonProps,
      sessionId,
      session: {
        blank: options.blank ?? false,
        openState: options.openState ?? 'open',
      } as never,
      input: {} as never,
    }
  } else {
    props = {
      ...commonProps,
      sessionId,
    }
  }

  const view = render(<BranchChip {...props} />, options.container !== undefined ? { container: options.container } : undefined)
  return { view, injected, calls, props }
}

describe('BranchChip', () => {
  it('shows the branch chip with the current branch name', async () => {
    bench()
    const branchChip = await screen.findByRole('button', { name: '分支' })
    expect(branchChip.textContent).toContain('main')
  })

  it('opts the chip anchor into the L2 semantic attributes (#506)', async () => {
    bench()
    const branchChip = await screen.findByRole('button', { name: '分支' })
    const anchor = anchorOf(branchChip)
    expect(anchor.getAttribute('data-dsh-plugin')).toBe('git-graph')
    expect(anchor.getAttribute('data-dsh-part')).toBe('chip')
  })

  it('marks only the unskinned light skin-center page for stock-light fallback styles', async () => {
    document.body.setAttribute('data-dsh-skin-center', '')
    bench()
    const branchChip = await screen.findByRole('button', { name: '分支' })
    const anchor = anchorOf(branchChip)
    expect(anchor.getAttribute('data-gitgraph-stock-light')).toBe('true')

    act(() => { document.body.setAttribute('data-dsh-xp', '') })
    await waitFor(() => { expect(anchor.hasAttribute('data-gitgraph-stock-light')).toBe(false) })

    act(() => { document.body.removeAttribute('data-dsh-xp') })
    await waitFor(() => { expect(anchor.getAttribute('data-gitgraph-stock-light')).toBe('true') })

    act(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    await waitFor(() => { expect(anchor.hasAttribute('data-gitgraph-stock-light')).toBe(false) })
  })

  it('keeps the branch chip in a blank (hero) session — the selector row stays docked', async () => {
    bench({ blank: true })
    const branchChip = await screen.findByRole('button', { name: '分支' })
    expect(branchChip.textContent).toContain('main')
  })

  it('hides the branch selector in active dock sessions', async () => {
    const { injected } = bench({}, 'dock')
    await act(async () => {})
    expect(screen.queryByRole('button', { name: '分支' })).toBeNull()
    expect(injected.repoStatus).not.toHaveBeenCalled()
    expect(injected.subscribeChanges).not.toHaveBeenCalled()
  })

  it('hides the branch selector in active context sessions', async () => {
    const { injected } = bench({ blank: false })
    await act(async () => {})
    expect(screen.queryByRole('button', { name: '分支' })).toBeNull()
    expect(injected.repoStatus).not.toHaveBeenCalled()
    expect(injected.subscribeChanges).not.toHaveBeenCalled()
  })

  it('keeps the full pill in the blank hero and context seats', async () => {
    bench({ blank: true }, 'dock')
    const heroChip = await screen.findByRole('button', { name: '分支' })
    expect(heroChip.className).toContain('chipHero')
    cleanup()
    bench({ blank: true })
    const contextChip = await screen.findByRole('button', { name: '分支' })
    expect(contextChip.className).not.toContain('chipHero')
  })

  it('styles the dock chip with the official hero seat in the blank phase', async () => {
    bench({ blank: true, openState: 'open' }, 'dock')
    const branchChip = await screen.findByRole('button', { name: '分支' })
    const chipWrap = branchChip.parentElement as HTMLElement
    expect(chipWrap.className).toContain('chipWrap')
    expect(anchorOf(branchChip).className).toContain('anchorHero')
    expect(branchChip.className).toContain('chipHero')
    fireEvent.click(branchChip)
    const popover = await screen.findByRole('listbox', { name: '搜索分支' })
    expect(popover.className).toContain('popoverHero')
    // The popover is absolutely positioned against the chip wrapper, so it
    // stays flush with the chip no matter how the dock anchor is padded.
    expect(chipWrap.contains(popover)).toBe(true)
  })

  it('enters the hero seat while a blank session composer is still loading', async () => {
    bench({ blank: true, openState: 'loading' }, 'dock')
    const branchChip = await screen.findByRole('button', { name: '分支' })
    const anchor = anchorOf(branchChip)
    expect(anchor.className).toContain('anchorHero')
    expect(branchChip.className).toContain('chipHero')
  })

  it('positions the hero dock chip in the hero workspace row', async () => {
    const stack = document.createElement('div')
    const heroRow = document.createElement('div')
    heroRow.className = 'heroWorkspaceRow'
    const preset = document.createElement('span')
    preset.className = 'presetSeat'
    heroRow.append(preset)
    const outlet = document.createElement('div')
    stack.append(heroRow, outlet)
    document.body.append(stack)
    try {
      bench({ blank: true, openState: 'open', container: outlet }, 'dock')
      await waitFor(() => {
        const chip = screen.getByRole('button', { name: '分支' })
        const anchor = anchorOf(chip)

        expect(heroRow.contains(anchor)).toBe(true)
        expect(anchor.parentElement).toBe(heroRow)
        expect(preset.nextElementSibling).toBe(anchor)
        expect(anchor.className).toContain('anchorHero')
        expect(chip.className).toContain('chipHero')
      })
    } finally {
      stack.remove()
    }
  })

  it('hides the branch chip when the workspace is not a git repository', async () => {
    bench({ repoStatus: null })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByRole('button', { name: '分支' })).toBeNull()
  })

  it('hides the branch chip without a session cwd (cold start)', async () => {
    bench({ cwd: undefined })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByRole('button', { name: '分支' })).toBeNull()
  })

  it('switches a branch from the list and closes on success', async () => {
    const { injected, calls } = bench()
    fireEvent.click(await screen.findByRole('button', { name: '分支' }))
    fireEvent.click(await screen.findByRole('option', { name: 'feature/x' }))
    expect(calls.switchBranch).toEqual([['sess-1', 'feature/x']])
    const notice = await screen.findByText('已切换到分支 feature/x')
    // The success banner carries the base notice class plus the ok variant
    // (the variant re-tints the banner; losing it would paint success as an
    // error banner).
    expect(notice.classList.contains(css.notice)).toBe(true)
    expect(notice.classList.contains(css.noticeOk)).toBe(true)
    expect(injected.switchBranch).toHaveBeenCalled()
  })

  it('shows readable copy when a switch is rejected', async () => {
    bench({
      switchResult: { ok: false, error: { code: 'conflicts-present', message: 'conflicts' } },
    })
    fireEvent.click(await screen.findByRole('button', { name: '分支' }))
    fireEvent.click(await screen.findByRole('option', { name: 'feature/x' }))
    const notice = await screen.findByText('当前仓库还有未解决的冲突，先处理完再切换分支。')
    // The error banner is the base notice only (never the ok variant).
    expect(notice.classList.contains(css.notice)).toBe(true)
    expect(notice.classList.contains(css.noticeOk)).toBe(false)
  })

  it('shows the overwrite copy with blocked paths', async () => {
    bench({
      switchResult: {
        ok: false,
        error: { code: 'untracked-changes-would-be-overwritten', message: 'blocked', paths: ['a.txt'], moreFiles: 2 },
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: '分支' }))
    fireEvent.click(await screen.findByRole('option', { name: 'feature/x' }))
    expect(await screen.findByText(/未跟踪文件会被目标分支覆盖："a.txt" 等另外 2 个文件/)).toBeTruthy()
  })

  it('creates a branch through the dialog with validation copy', async () => {
    const { injected } = bench()
    fireEvent.click(await screen.findByRole('button', { name: '分支' }))
    fireEvent.click(await screen.findByRole('button', { name: /创建并检出新分支/ }))
    const input = screen.getByLabelText('分支名')
    fireEvent.change(input, { target: { value: 'bad name' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并切换' }))
    expect(await screen.findByText('分支名无效，请重新输入。')).toBeTruthy()
    expect(injected.createBranch).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'feature/good' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并切换' }))
    expect(injected.createBranch).toHaveBeenCalledWith(sid('sess-1'), 'feature/good')
  })

  it('shows duplicate-name copy from the host', async () => {
    bench({
      createResult: { ok: false, error: { code: 'branch-already-exists', message: 'dup' } },
    })
    fireEvent.click(await screen.findByRole('button', { name: '分支' }))
    fireEvent.click(await screen.findByRole('button', { name: /创建并检出新分支/ }))
    fireEvent.change(screen.getByLabelText('分支名'), { target: { value: 'feature/x' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并切换' }))
    expect(await screen.findByText('分支已存在，请换一个名称。')).toBeTruthy()
  })

  it('renders the Git graph with lanes, refs, and load-more', async () => {
    const graphView: GraphView = {
      root: '/ws/proj', branch: 'main',
      commits: [
        { oid: 'aabbcc', parents: ['ddeeff'], subject: 'merge work', author: 'Alice', authorTime: 1700000000, refs: ['main', 'v1'] },
        { oid: 'ddeeff', parents: [], subject: 'root commit', author: 'Bob', authorTime: 1690000000, refs: [] },
      ],
      hasMore: true,
    }
    const { calls } = bench({ graphView })
    fireEvent.click(await screen.findByRole('button', { name: '分支' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Git 图谱' }))
    const dialog = await screen.findByRole('dialog', { name: 'Git 图谱' })
    expect(dialog.textContent).toContain('merge work')
    expect(dialog.textContent).toContain('2 个提交')
    expect(calls.graph).toEqual([['sess-1', 200]])
    // Refs render as pills; the current branch is highlighted.
    expect(dialog.querySelectorAll('[class*="graphRef"]')).toHaveLength(2)
    expect(dialog.querySelectorAll('[class*="graphRefCurrent"]')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(calls.graph).toEqual([['sess-1', 200], ['sess-1', 102]])
  })

  it('shows a loading hint before the first graph response', async () => {
    let resolveGraph!: (view: GraphView) => void
    bench({
      graph: () => new Promise<GraphView>((resolve) => { resolveGraph = resolve }),
    })
    fireEvent.click(await screen.findByRole('button', { name: '分支' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Git 图谱' }))
    expect(await screen.findByText('加载中…')).toBeTruthy()
    resolveGraph({
      root: '/ws/proj', branch: 'main',
      commits: [
        { oid: 'aabbcc', parents: [], subject: 'root commit', author: 'Bob', authorTime: 1690000000, refs: [] },
      ],
      hasMore: false,
    })
    expect(await screen.findByText('root commit')).toBeTruthy()
  })

  it('throttles focus refetches to one per 5s window', async () => {
    // now starts past the initial lastFocusRefetch (0) so the FIRST focus is
    // the one consumed by the throttle window (a second burst focus is held).
    vi.useFakeTimers({ now: 10_000 })
    try {
      const { injected } = bench()
      // Flush the initial mount load so the throttle deltas are relative to it.
      await act(async () => {})
      const initialCalls = injected.repoStatus.mock.calls.length

      await act(async () => { window.dispatchEvent(new Event('focus')) })
      await act(async () => {})
      expect(injected.repoStatus.mock.calls.length).toBe(initialCalls + 1)

      // A second focus inside the 5s window is throttled: no new call.
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      await act(async () => {})
      expect(injected.repoStatus.mock.calls.length).toBe(initialCalls + 1)

      // The window elapses; the next focus refetches again.
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      await act(async () => {})
      expect(injected.repoStatus.mock.calls.length).toBe(initialCalls + 2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('GraphDialog', () => {
  it('opts the dialog into the L2 semantic attributes (#506)', async () => {
    render(
      <GraphDialog
        graph={async () => ({
          root: '/ws/proj', branch: 'main',
          commits: [
            { oid: 'aabbcc', parents: [], subject: 'root commit', author: 'Bob', authorTime: 1690000000, refs: [] },
          ],
          hasMore: false,
        })}
        onClose={() => {}}
        t={makeTranslate()}
      />,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Git 图谱' })
    expect(dialog.getAttribute('data-gitgraph-dialog')).not.toBeNull()
    expect(dialog.getAttribute('data-dsh-plugin')).toBe('git-graph')
    expect(dialog.getAttribute('data-dsh-part')).toBe('dialog')
    expect(await screen.findByText('root commit')).toBeTruthy()
  })

  it('does not re-run the initial load when the graph prop identity changes', async () => {
    const calls: number[] = []
    const graph = async (limit?: number) => {
      calls.push(limit ?? 0)
      return {
        root: '/ws/proj', branch: 'main',
        commits: [
          { oid: 'aabbcc', parents: [], subject: 'root commit', author: 'Bob', authorTime: 1690000000, refs: [] },
        ],
        hasMore: false,
      }
    }
    const { rerender } = render(
      <GraphDialog graph={graph} onClose={() => {}} t={makeTranslate()} />,
    )
    await screen.findByText('root commit')
    const callsAfterMount = calls.length
    // The initial load ran with the page size.
    expect(calls).toEqual([200])

    // A parent re-render passes a fresh inline arrow → graph identity changes.
    rerender(
      <GraphDialog
        graph={async (limit?: number) => {
          calls.push(limit ?? 0)
          return {
            root: '/ws/proj', branch: 'main',
            commits: [
              { oid: 'aabbcc', parents: [], subject: 'root commit', author: 'Bob', authorTime: 1690000000, refs: [] },
            ],
            hasMore: false,
          }
        }}
        onClose={() => {}}
        t={makeTranslate()}
      />,
    )
    // No new initial fetch: the effect is mount-only.
    expect(calls.length).toBe(callsAfterMount)
  })
})
describe('branch name tooltip', () => {
  const LONG_A = 'feature/very-long-branch-name-over-eighteen-chars'
  const LONG_B = 'feature/another-long-branch-name-exceeding-limit'
  const longBranchesView: BranchesView = {
    root: '/ws/proj', branch: 'main',
    branches: [
      { name: LONG_A, current: false },
      { name: 'main', current: true },
    ],
    dirtyFiles: 0, untrackedFiles: 0, conflicts: 0, operationInProgress: false,
  }

  it('keeps the native title and adds aria-label on long names', async () => {
    bench({ branchesView: longBranchesView })
    const chip = await screen.findByRole('button', { name: '分支' })
    fireEvent.click(chip)
    const long = await screen.findByRole('option', { name: LONG_A })
    expect(long.getAttribute('data-tip')).toBe(LONG_A)
    // Pointer-independent fallback stays intact: aria-label on the button
    // and the native title on the name span (keyboard / SR / touch).
    expect(long.getAttribute('aria-label')).toBe(LONG_A)
    const name = long.querySelector('[class*=itemName]')
    expect(name?.getAttribute('title')).toBe(LONG_A)
  })

  it('keeps data-tip empty on short names', async () => {
    bench()
    const chip = await screen.findByRole('button', { name: '分支' })
    fireEvent.click(chip)
    const short = await screen.findByRole('option', { name: 'feature/x' })
    expect(short.getAttribute('data-tip')).toBe('')
    const name = short.querySelector('[class*=itemName]')
    expect(name?.getAttribute('title')).toBe('feature/x')
  })

  it('defers tooltip readiness until the 500ms dwell elapses', async () => {
    bench({ branchesView: longBranchesView })
    const chip = await screen.findByRole('button', { name: '分支' })
    fireEvent.click(chip)
    const long = await screen.findByRole('option', { name: LONG_A })
    expect(long.getAttribute('data-tip-ready')).toBe('')
    vi.useFakeTimers()
    try {
      fireEvent.mouseEnter(long)
      act(() => { vi.advanceTimersByTime(499) })
      expect(long.getAttribute('data-tip-ready')).toBe('')
      act(() => { vi.advanceTimersByTime(2) })
      expect(long.getAttribute('data-tip-ready')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the tooltip immediately when switching items after one is visible', async () => {
    bench({ branchesView: { ...longBranchesView, branches: [...longBranchesView.branches, { name: LONG_B, current: false }] } })
    const chip = await screen.findByRole('button', { name: '分支' })
    fireEvent.click(chip)
    const first = await screen.findByRole('option', { name: LONG_A })
    const second = screen.getByRole('option', { name: LONG_B })
    vi.useFakeTimers()
    try {
      fireEvent.mouseEnter(first)
      act(() => { vi.advanceTimersByTime(500) })
      expect(first.getAttribute('data-tip-ready')).toBe('true')
      // Realistic pointer move: entering another row while the bubble is
      // visible shows it at once (row-level leave has no handler; only the
      // list-level leave below resets the instant-handoff state).
      fireEvent.mouseEnter(second)
      expect(second.getAttribute('data-tip-ready')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('resets readiness only when the pointer leaves the whole list', async () => {
    bench({ branchesView: longBranchesView })
    const chip = await screen.findByRole('button', { name: '分支' })
    fireEvent.click(chip)
    const long = await screen.findByRole('option', { name: LONG_A })
    vi.useFakeTimers()
    try {
      fireEvent.mouseEnter(long)
      act(() => { vi.advanceTimersByTime(500) })
      expect(long.getAttribute('data-tip-ready')).toBe('true')
      // Leaving the whole list resets readiness (re-arms the dwell).
      const list = long.parentElement
      expect(list).not.toBeNull()
      fireEvent.mouseLeave(list as HTMLElement)
      expect(long.getAttribute('data-tip-ready')).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the dwell timer on unmount', async () => {
    bench({ branchesView: longBranchesView })
    const chip = await screen.findByRole('button', { name: '分支' })
    fireEvent.click(chip)
    const long = await screen.findByRole('option', { name: LONG_A })
    vi.useFakeTimers()
    try {
      fireEvent.mouseEnter(long)
      cleanup()
      // Advancing past the dwell must not throw after unmount (timer cleared).
      expect(() => { act(() => { vi.advanceTimersByTime(600) }) }).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('flips the bubble below for items near the top of the list', async () => {
    bench({ branchesView: longBranchesView })
    const chip = await screen.findByRole('button', { name: '分支' })
    fireEvent.click(chip)
    const long = await screen.findByRole('option', { name: LONG_A })
    // jsdom rects are all zero, so itemTop - listTop (0) < 56 → 'down'.
    fireEvent.mouseEnter(long)
    expect(long.getAttribute('data-tip-dir')).toBe('down')
  })
})

describe('popover search box focus', () => {
  it('auto-focuses the search input when the popover opens', async () => {
    bench()
    const chip = await screen.findByRole('button', { name: '分支' })
    fireEvent.click(chip)
    const input = await screen.findByPlaceholderText(/搜索分支/)
    expect(document.activeElement).toBe(input)
  })
})

describe('worktree UI', () => {
  const worktreesView: WorktreeListView = {
    root: '/ws/proj',
    worktrees: [
      { path: '/ws/proj', head: 'abc1234def', branch: 'main', main: true },
      { path: '/home/u/.dsh/worktrees/proj-a1b2c3d4/fix-x', head: 'bbbbbbbcccc', branch: 'wt/fix-x', main: false },
    ],
  }

  it('opens the create-worktree dialog from the popover footer and submits', async () => {
    const { injected } = bench()
    fireEvent.click(await screen.findByRole('button', { name: '分支' }))
    fireEvent.click(await screen.findByRole('button', { name: /在 worktree 中开始新会话/ }))
    const input = screen.getByLabelText('worktree 名称')
    fireEvent.change(input, { target: { value: 'Fix Login!' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并开始会话' }))
    await waitFor(() => {
      expect(injected.createWorktreeSession).toHaveBeenCalledWith(sid('sess-1'), 'fix-login', 'main')
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '在 worktree 中开始新会话' })).toBeNull()
    })
  })

  it('shows invalid-name copy and never calls the verb for unusable names', async () => {
    const { injected } = bench()
    fireEvent.click(await screen.findByRole('button', { name: '分支' }))
    fireEvent.click(await screen.findByRole('button', { name: /在 worktree 中开始新会话/ }))
    fireEvent.change(screen.getByLabelText('worktree 名称'), { target: { value: '!!!' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并开始会话' }))
    expect(await screen.findByText('worktree 名称无效，请重新输入。')).toBeTruthy()
    expect(injected.createWorktreeSession).not.toHaveBeenCalled()
  })

  it('shows the host rejection copy for duplicate worktree names', async () => {
    bench({
      createWorktreeResult: { ok: false, error: { code: 'worktree-already-exists', message: 'dup' } },
    })
    fireEvent.click(await screen.findByRole('button', { name: '分支' }))
    fireEvent.click(await screen.findByRole('button', { name: /在 worktree 中开始新会话/ }))
    fireEvent.change(screen.getByLabelText('worktree 名称'), { target: { value: 'dup' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并开始会话' }))
    expect(await screen.findByText('同名 worktree 或分支已存在，请换一个名称。')).toBeTruthy()
  })

  it('lists worktrees in the manager and removes a linked one', async () => {
    const { injected } = bench({ worktreesView })
    fireEvent.click(await screen.findByRole('button', { name: '分支' }))
    fireEvent.click(await screen.findByRole('button', { name: /管理 worktree/ }))
    expect(await screen.findByText('wt/fix-x')).toBeTruthy()
    expect(screen.getByText('主检出')).toBeTruthy()
    // The main checkout row renders no remove control.
    const removeButtons = screen.getAllByRole('button', { name: '删除' })
    expect(removeButtons).toHaveLength(1)
    fireEvent.click(removeButtons[0]!)
    await waitFor(() => {
      expect(injected.removeWorktree).toHaveBeenCalledWith(
        sid('sess-1'),
        '/home/u/.dsh/worktrees/proj-a1b2c3d4/fix-x',
        expect.objectContaining({ force: false }),
      )
    })
  })
})

