/**
 * The two optional faces a session entry point needs, held as one subscribable
 * per-instance snapshot instead of being probed once while the plugin applies.
 *
 * Both faces belong to OTHER official plugins - `uiWorkspace` to the workspace
 * plugin, and the shared session catalog to the session controller - and either
 * one can arrive after this plugin applied, because plugin load order between
 * two independent rows is not a contract. A probe performed inside `apply` read
 * `undefined` for the whole life of the process on such a deployment: the page
 * then offered no way into an existing session, and it read the live roster
 * from a route this build does not serve (see `team-source.ts`).
 *
 * So the faces are bridged with `ctx.inject` (never the module-level `inject`
 * array, which would make apply wait for services this row must mount without):
 * the callback runs when the providing plugin appears, its `inner.effect`
 * cleanup runs when that plugin goes away, and every change bumps the snapshot
 * version so the mounted page re-renders. The initial snapshot is exactly the
 * no-workspace deployment: no opener, and the live team read through the
 * fallback poll.
 *
 * @module @linxin666/dsh-agents/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: these two official browser halves declare the optional services
// this file bridges (`uiWorkspace`, `sessions`) on the cordis context. Nothing
// of either package is shipped in this bundle.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { AgentsTransport } from './host-api.ts'
import { pollTeamSource, projectionTeamSource, sessionListFace } from './team-source.ts'
import type { SquadTeamSource } from './team-source.ts'

/** The slice of the GUI workspace service this plugin calls. */
export interface WorkspaceOpener {
  /**
   * Switch the GUI to an existing session.
   * @param sessionId - the exact session id to open.
   */
  openSession(sessionId: string): void
}

/** What one mounted page can offer right now. */
export interface SessionFaces {
  /** Switch the GUI to an existing session; undefined when nothing serves it. */
  readonly openSession: ((sessionId: string) => void) | undefined
  /** Where the live team of a squad run is read from; never undefined. */
  readonly teamSource: SquadTeamSource
  /** Bumped on every change, so a consumer can detect a same-shape swap. */
  readonly version: number
}

/**
 * The instance-level capability store one plugin instance owns.
 *
 * `getSnapshot`/`subscribe` are the `useSyncExternalStore` pair; the two
 * `offer*` calls are the bridge's write side, and passing `undefined` withdraws
 * a face because a provider unloaded.
 */
export interface SessionFacesStore {
  /**
   * Read the current snapshot; the same object is returned until a face changes.
   * @returns the current faces.
   */
  getSnapshot(): SessionFaces
  /**
   * Subscribe to face changes.
   * @param listener - called once per change.
   * @returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void
  /**
   * Publish or withdraw the session opener.
   * @param opener - the opener a workspace service answers with, or undefined.
   */
  offerOpener(opener: ((sessionId: string) => void) | undefined): void
  /**
   * Publish or withdraw the live-team surface.
   * @param source - the projection source when the session catalog is reachable,
   *   or undefined to fall back to the proposed roster route.
   */
  offerTeamSource(source: SquadTeamSource | undefined): void
}

/**
 * Wrap a workspace service's opener so the page holds a plain function.
 * @param workspace - whatever the context published under `uiWorkspace`.
 * @returns the opener, or undefined when this deployment serves none.
 */
export function openerFrom(workspace: unknown): ((sessionId: string) => void) | undefined {
  if (typeof workspace !== 'object' || workspace === null) return undefined
  const candidate = workspace as { openSession?: unknown }
  if (typeof candidate.openSession !== 'function') return undefined
  const face = workspace as WorkspaceOpener
  return (sessionId: string) => { face.openSession(sessionId) }
}

/**
 * Build the capability store one plugin instance owns.
 *
 * The fallback surface is created once, so withdrawing the projection source
 * returns the page to the very source it started with.
 * @param transport - the frozen-contract transport, used by the fallback poll.
 * @returns the store the bridges write and the page subscribes to.
 */
export function createSessionFaces(transport: AgentsTransport): SessionFacesStore {
  const fallback = pollTeamSource(transport)
  const listeners = new Set<() => void>()
  let openSession: ((sessionId: string) => void) | undefined
  let teamSource: SquadTeamSource = fallback
  let snapshot: SessionFaces = { openSession, teamSource, version: 0 }

  /** Replace the faces, notify once, and keep the reference stable when nothing moved. */
  const commit = (next: { openSession: typeof openSession; teamSource: SquadTeamSource }): void => {
    if (next.openSession === openSession && next.teamSource === teamSource) return
    openSession = next.openSession
    teamSource = next.teamSource
    snapshot = { openSession, teamSource, version: snapshot.version + 1 }
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot(): SessionFaces { return snapshot },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    offerOpener(opener: ((sessionId: string) => void) | undefined): void {
      commit({ openSession: opener, teamSource })
    },
    offerTeamSource(source: SquadTeamSource | undefined): void {
      commit({ openSession, teamSource: source ?? fallback })
    },
  }
}

/**
 * Bridge both optional faces into the store.
 *
 * `ctx.inject` keeps each face optional in BOTH directions: a deployment that
 * serves no workspace or session service mounts the page with the initial
 * snapshot, a provider that appears later enables the face, and a provider that
 * unloads withdraws it again.
 * @param ctx - the browser root context.
 * @param store - the store of the plugin instance applying.
 */
export function bridgeSessionFaces(ctx: ClientContext, store: SessionFacesStore): void {
  ctx.inject(['uiWorkspace'], (inner) => {
    inner.effect(() => {
      store.offerOpener(openerFrom(inner.get('uiWorkspace')))
      return () => { store.offerOpener(undefined) }
    }, 'dsh-agents: session opener bridge')
  })
  ctx.inject(['sessions'], (inner) => {
    inner.effect(() => {
      const list = sessionListFace(inner.get('sessions'))
      store.offerTeamSource(list === undefined ? undefined : projectionTeamSource(list))
      return () => { store.offerTeamSource(undefined) }
    }, 'dsh-agents: live team bridge')
  })
}
