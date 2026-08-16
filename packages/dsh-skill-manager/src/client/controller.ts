/**
 * State machine behind the Settings "Skills" section: workspace selection,
 * catalog refresh, toggles, installs, and ledger-guarded uninstalls. The
 * store is the component's only data face; every mutation goes through
 * update() so renders stay consistent with the wire.
 * @module @linxin666/dsh-skill-manager/client/controller
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, WorkspaceView } from '@deepseek-ai/dsh-client-connection/client'
import type { SkillRow } from '../core/protocol.ts'
import type { SkillManagerApi } from './api.ts'
import { SkillManagerApiError } from './api.ts'

/** Workspace rows the section renders (wire projection, kept local). */
export interface SkillWorkspaceView {
  workspaceId: string
  title: string
  path: string
  sessionIds: SessionId[]
}

/** One completed install/uninstall notice. */
export type SkillManagerNotice =
  | { kind: 'installed'; count: number }
  | { kind: 'uninstalled'; name: string }

/** Full section state. */
export interface SkillManagerState {
  phase: 'loading' | 'ready' | 'error'
  error?: string
  workspaces: SkillWorkspaceView[]
  selectedWorkspaceId?: string
  selectedSessionId?: SessionId
  cwd?: string
  live: boolean
  skills: SkillRow[]
  toggling: Record<string, boolean>
  toggleError?: string
  installing: boolean
  installError?: string
  notice?: SkillManagerNotice
  sourceKind: 'dir' | 'git'
  sourceValue: string
  destination: 'workspace' | 'user'
  uninstallTarget?: string
  uninstalling: boolean
}

/** Initial section state. */
export function initialSkillManagerState(): SkillManagerState {
  return {
    phase: 'loading',
    workspaces: [],
    live: false,
    skills: [],
    toggling: {},
    installing: false,
    sourceKind: 'dir',
    sourceValue: '',
    destination: 'workspace',
    uninstalling: false,
  }
}

/** The session-list slice the controller reads (structural). */
export interface SessionListLike {
  current?: SessionId
  ids: readonly SessionId[]
  byId: Record<string, { running: boolean; updatedAt: number }>
  phase: string
}

/** Controller dependencies (structural; the client apply adapts ctx). */
export interface SkillManagerControllerDeps {
  /** The route API client. */
  api: SkillManagerApi
  /** Client session list (reads the current selection and readiness). */
  sessions: {
    list: {
      getSnapshot(): SessionListLike
      subscribe(fn: () => void): () => void
    }
  }
  /** Workspace list RPC (`api.workspace.list({})`). */
  workspaces: () => Promise<{
    result: { ok: true; value: { items: WorkspaceView[] } } | { ok: false; error: unknown }
  }>
}

/** The registration-side face the section slot entry injects. */
export interface SkillManagerSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useSkillManagerSection. */
    skillManagerSection: SnapshotStore<SkillManagerState>
  }
  /** Read workspaces and the first catalog; called when the section renders. */
  load: () => Promise<void>
  /** Re-list the catalog for the current selection. */
  refresh: () => Promise<void>
  /** Switch the viewing workspace (and its first session). */
  selectWorkspace: (workspaceId: string) => void
  /** Toggle one skill. */
  toggle: (name: string, enabled: boolean) => Promise<void>
  /** Stage the install source kind. */
  setSourceKind: (kind: 'dir' | 'git') => void
  /** Stage the install source value. */
  setSourceValue: (value: string) => void
  /** Stage the install destination. */
  setDestination: (destination: 'workspace' | 'user') => void
  /** Run the staged install. */
  install: () => Promise<void>
  /** Open or dismiss the uninstall confirmation. */
  confirmUninstall: (name: string | null) => void
  /** Run the confirmed uninstall. */
  uninstall: () => Promise<void>
}

/** Bridges the section component onto the manager routes. */
export class SkillManagerController {
  private readonly store: SnapshotStore<SkillManagerState>
  private readonly unsubscribeSessions: () => void
  private refreshRetried = false

  /** @param deps - api client, session list, and workspace RPC. */
  constructor(private readonly deps: SkillManagerControllerDeps) {
    this.store = createSnapshotStore(initialSkillManagerState())
    this.unsubscribeSessions = this.deps.sessions.list.subscribe(() => this.onSessionListChange())
  }

  /** Stop listening to the session list (plugin teardown). */
  dispose(): void {
    this.unsubscribeSessions()
  }

  /**
   * The best session of one workspace: a running one, else the most recently
   * updated. Attached sessions are running; stale rows must not win.
   */
  private bestSessionId(sessionIds: readonly SessionId[], snapshot: SessionListLike): SessionId | undefined {
    if (sessionIds.length === 0) return undefined
    const running = sessionIds.find(id => snapshot.byId[id]?.running === true)
    if (running !== undefined) return running
    return [...sessionIds].sort((a, b) => (snapshot.byId[b]?.updatedAt ?? 0) - (snapshot.byId[a]?.updatedAt ?? 0))[0]
  }

  /** Pick the selection: the current session's workspace, else the first usable workspace's best session. */
  private pickSelection(): { workspaceId?: string; sessionId?: SessionId } {
    const snapshot = this.deps.sessions.list.getSnapshot()
    const workspaces = this.store.getSnapshot().workspaces
    const current = snapshot.current
    if (current !== undefined) {
      const containing = workspaces.find(workspace => workspace.sessionIds.includes(current))
      if (containing !== undefined) return { workspaceId: containing.workspaceId, sessionId: current }
    }
    for (const workspace of workspaces) {
      const sessionId = this.bestSessionId(workspace.sessionIds, snapshot)
      if (sessionId !== undefined) return { workspaceId: workspace.workspaceId, sessionId }
    }
    return {}
  }

  /** Apply the current pick and refresh when it changed. */
  private applySelection(): Promise<void> {
    const picked = this.pickSelection()
    const previous = this.store.getSnapshot()
    const unchanged = previous.selectedWorkspaceId === picked.workspaceId
      && previous.selectedSessionId === picked.sessionId
    this.store.update((draft) => {
      draft.selectedWorkspaceId = picked.workspaceId
      draft.selectedSessionId = picked.sessionId
    })
    if (picked.sessionId === undefined) {
      this.store.update((draft) => { draft.phase = 'ready'; draft.skills = [] })
      return Promise.resolve()
    }
    return unchanged ? Promise.resolve() : this.refresh()
  }

  /** Re-pick only when the selection is missing or the session vanished. */
  private onSessionListChange(): void {
    const state = this.store.getSnapshot()
    const snapshot = this.deps.sessions.list.getSnapshot()
    const stale = state.selectedSessionId === undefined
      || (state.selectedSessionId !== undefined && !snapshot.ids.includes(state.selectedSessionId))
    if (!stale) return
    void this.applySelection()
  }

  /** The face the slot registration injects. */
  inject(): SkillManagerSectionInjected {
    return {
      hooks: { skillManagerSection: this.store },
      load: () => this.load(),
      refresh: () => this.refresh(),
      selectWorkspace: (workspaceId) => this.selectWorkspace(workspaceId),
      toggle: (name, enabled) => this.toggle(name, enabled),
      setSourceKind: (kind) => this.setSourceKind(kind),
      setSourceValue: (value) => this.setSourceValue(value),
      setDestination: (destination) => this.setDestination(destination),
      install: () => this.install(),
      confirmUninstall: (name) => this.confirmUninstall(name),
      uninstall: () => this.uninstall(),
    }
  }

  /** Read the current snapshot (tests). */
  getSnapshot(): SkillManagerState {
    return this.store.getSnapshot()
  }

  /** Load workspaces, then the catalog for the current session's workspace. */
  async load(): Promise<void> {
    this.store.update((draft) => { draft.phase = 'loading'; draft.error = undefined })
    let items: WorkspaceView[]
    try {
      const { result } = await this.deps.workspaces()
      if (!result.ok) {
        this.store.update((draft) => {
          draft.phase = 'error'
          draft.error = 'workspace listing failed'
        })
        return
      }
      items = result.value.items
    } catch (error) {
      this.store.update((draft) => {
        draft.phase = 'error'
        draft.error = error instanceof Error ? error.message : String(error)
      })
      return
    }
    const workspaces = items.map(item => ({
      workspaceId: item.workspaceId,
      title: item.title,
      path: item.path,
      sessionIds: [...item.sessionIds],
    }))
    this.store.update((draft) => { draft.workspaces = workspaces })
    await this.applySelection()
  }

  /** Switch the viewing workspace (its best session). */
  selectWorkspace(workspaceId: string): void {
    const workspace = this.store.getSnapshot().workspaces.find(item => item.workspaceId === workspaceId)
    const sessionId = workspace === undefined ? undefined : this.bestSessionId(workspace.sessionIds, this.deps.sessions.list.getSnapshot())
    this.store.update((draft) => {
      draft.selectedWorkspaceId = workspaceId
      draft.selectedSessionId = sessionId
      draft.skills = []
      draft.toggleError = undefined
      draft.notice = undefined
    })
    if (sessionId === undefined) {
      this.store.update((draft) => { draft.phase = 'ready' })
      return
    }
    void this.refresh()
  }

  /** Re-list the catalog for the selected session. */
  async refresh(): Promise<void> {
    const sessionId = this.store.getSnapshot().selectedSessionId
    if (sessionId === undefined) return
    this.store.update((draft) => { draft.phase = 'loading' })
    try {
      const result = await this.deps.api.list(sessionId)
      this.store.update((draft) => {
        draft.phase = 'ready'
        draft.error = undefined
        draft.cwd = result.cwd
        draft.live = result.live
        draft.skills = result.skills
      })
    } catch (error) {
      // The session list may not have been ready when the section opened;
      // re-pick the selection and retry once instead of showing a dead error.
      const code = error instanceof SkillManagerApiError ? error.code : undefined
      if (code === 'session-not-found' && !this.refreshRetried) {
        this.refreshRetried = true
        try {
          const picked = this.pickSelection()
          if (picked.sessionId !== undefined) {
            this.store.update((draft) => {
              draft.selectedWorkspaceId = picked.workspaceId
              draft.selectedSessionId = picked.sessionId
            })
          }
          await this.refresh()
          return
        } finally {
          this.refreshRetried = false
        }
      }
      this.store.update((draft) => {
        draft.phase = 'error'
        draft.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Toggle one skill and update its row in place. */
  async toggle(name: string, enabled: boolean): Promise<void> {
    const sessionId = this.store.getSnapshot().selectedSessionId
    if (sessionId === undefined) return
    this.store.update((draft) => {
      draft.toggling[name] = true
      draft.toggleError = undefined
    })
    try {
      const result = await this.deps.api.toggle(sessionId, name, enabled)
      this.store.update((draft) => {
        const row = draft.skills.find(skill => skill.name === result.name)
        if (row !== undefined) {
          row.modelInvocable = result.modelInvocable
          row.userInvocable = result.userInvocable
        }
      })
    } catch (error) {
      this.store.update((draft) => {
        draft.toggleError = error instanceof Error ? error.message : String(error)
      })
    } finally {
      this.store.update((draft) => { delete draft.toggling[name] })
    }
  }

  /** Stage the install source kind. */
  setSourceKind(kind: 'dir' | 'git'): void {
    this.store.update((draft) => { draft.sourceKind = kind })
  }

  /** Stage the install source value. */
  setSourceValue(value: string): void {
    this.store.update((draft) => { draft.sourceValue = value })
  }

  /** Stage the install destination. */
  setDestination(destination: 'workspace' | 'user'): void {
    this.store.update((draft) => { draft.destination = destination })
  }

  /** Run the staged install and refresh the catalog. */
  async install(): Promise<void> {
    const sessionId = this.store.getSnapshot().selectedSessionId
    const sourceValue = this.store.getSnapshot().sourceValue.trim()
    if (sessionId === undefined || sourceValue === '') return
    const snapshot = this.store.getSnapshot()
    this.store.update((draft) => {
      draft.installing = true
      draft.installError = undefined
      draft.notice = undefined
    })
    try {
      const result = await this.deps.api.install({
        sessionId,
        source: { kind: snapshot.sourceKind, value: sourceValue },
        destination: snapshot.destination,
      })
      this.store.update((draft) => {
        draft.notice = { kind: 'installed', count: result.entries.length }
      })
      await this.refresh()
    } catch (error) {
      this.store.update((draft) => {
        draft.installError = error instanceof Error ? error.message : String(error)
      })
    } finally {
      this.store.update((draft) => { draft.installing = false })
    }
  }

  /** Open or dismiss the uninstall confirmation. */
  confirmUninstall(name: string | null): void {
    this.store.update((draft) => {
      draft.uninstallTarget = name ?? undefined
      draft.installError = undefined
    })
  }

  /** Run the confirmed uninstall and drop the row. */
  async uninstall(): Promise<void> {
    const sessionId = this.store.getSnapshot().selectedSessionId
    const target = this.store.getSnapshot().uninstallTarget
    if (sessionId === undefined || target === undefined) return
    this.store.update((draft) => { draft.uninstalling = true })
    try {
      await this.deps.api.uninstall(sessionId, target)
      this.store.update((draft) => {
        draft.skills = draft.skills.filter(skill => skill.name !== target)
        draft.uninstallTarget = undefined
        draft.notice = { kind: 'uninstalled', name: target }
      })
    } catch (error) {
      this.store.update((draft) => {
        draft.installError = error instanceof Error ? error.message : String(error)
      })
    } finally {
      this.store.update((draft) => { draft.uninstalling = false })
    }
  }
}