/**
 * Browser-half installer for the GitHub provider.
 *
 * A provider's browser half registers its own contributions into the child
 * seats the board declares; it resolves the board's client capability face from
 * the shared service name and adds no HTTP surface of its own. Two switches
 * compose here:
 *
 * - the BOARD's master switch collapses the seats (the board mirror reports it,
 *   and the board's own registrations collapse with them);
 * - this EXTENSION's own volatile switch hides the seats entirely, without a
 *   restart, because the installer follows the settings form the card edits.
 *
 * The board's browser half publishes its `taskBoard` service inside its own
 * apply, and the aggregate mounts its client children without ordering those
 * applies, so the service is frequently NOT there yet when this installer runs.
 * The seats therefore live behind a cordis dependency scope (`ctx.inject`)
 * instead of a one-shot lookup: the scope mounts once the board serves the
 * service and unloads — releasing every seat — when the board withdraws it.
 * A one-shot "resolve, give up, never retry" lookup is what made the seats
 * permanently absent under a real aggregate load.
 *
 * @module dsh-task-board-github/client/github/extension
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  resolveTaskBoardClientFace,
  TASK_BOARD_CARD_DECORATION,
  TASK_BOARD_DETAIL_SECTION,
  TASK_BOARD_SETTINGS_SECTION,
} from '../../core/contract.ts'
import { GITHUB_EXTENSION_ID } from '../../core/types.ts'
import { GitHubCardDecoration, GitHubDetailSection } from './sections.tsx'
import { acceptPublishedSummaries, clearSummary } from './summary.ts'
import { isGitHubTaskVisible } from './visibility.ts'
import { gitHubSourceGroup } from './grouping.ts'

/** Locale namespace the seats bind to. */
const LOCALE_NS = 'task-board-github'

/** The live switch the installer follows; the settings card's form supplies it. */
export interface ExtensionEnabledSource {
  /** Whether the extension is currently enabled (absent config means enabled). */
  read(): boolean
  /** Observe switch changes; the returned disposer removes the listener. */
  subscribe(listener: () => void): () => void
}

/**
 * The configuration section this extension contributes to the board's own
 * settings card.
 *
 * The section is NOT gated by the extension's own switch: turning the
 * extension off must not remove the control that turns it back on. It is gated
 * by the board's service alone, because the board's settings card is the only
 * surface that declares the seat it renders into.
 */
export interface GitHubSettingsSectionSeat {
  /** Build the face the section renders with (its staged form and setup API). */
  inject(): unknown
  /** The section component itself. */
  component: unknown
}

/**
 * Install the GitHub browser half.
 * @param ctx - client context (slot registry).
 * @param source - the extension's live enabled switch.
 * @returns disposer releasing every contribution.
 */
export function installGitHubClientHalf(
  ctx: ClientContext,
  source: ExtensionEnabledSource,
  settings?: GitHubSettingsSectionSeat,
): () => void {
  /** The dependency-scoped fiber that owns the seats, while both gates are on. */
  let injection: ReturnType<ClientContext['inject']> | undefined
  /** The fiber that owns the board's provider-settings section, independent of the switch. */
  let settingsInjection: ReturnType<ClientContext['inject']> | undefined

  const install = (): void => {
    if (injection !== undefined) return
    // Cordis runs this callback once the board serves `taskBoard` — immediately
    // if it is already there (on the microtask the fiber load settles on), or
    // the moment it appears otherwise — and disposes the scope when the service
    // is withdrawn or replaced, which is what releases the seats again.
    injection = ctx.inject(['taskBoard'], (scope: ClientContext) => {
      scope.effect(() => installSeats(scope), 'task-board-github: provider seats')
    })
  }

  const release = (): void => {
    const current = injection
    injection = undefined
    if (current === undefined) return
    void current.dispose()
    // A hidden provider publishes no summary; keep the last one from looking
    // like live state on a settings page that is still open.
    clearSummary()
  }

  const apply = (): void => {
    if (source.read()) install()
    else release()
  }

  // The provider-settings section: installed once, behind the board service,
  // and left alone by the extension's own switch (see GitHubSettingsSectionSeat).
  if (settings !== undefined) {
    settingsInjection = ctx.inject(['taskBoard'], (scope: ClientContext) => {
      scope.effect(() => registerSettingsSection(scope, settings), 'task-board-github: provider settings section')
    })
  }

  const unsubscribe = source.subscribe(apply)
  apply()

  return () => {
    unsubscribe()
    release()
    const currentSettings = settingsInjection
    settingsInjection = undefined
    if (currentSettings !== undefined) void currentSettings.dispose()
  }
}

/**
 * Register the configuration section into the seat the board's settings card
 * renders.
 *
 * The registration goes through the seat's OWN declaration lifecycle
 * (`slots.inject`), not a one-shot `register`: the board's card declares the
 * seat, and re-declares it whenever it moves between plugin-card seats (the
 * family group loading after boot is the normal case). Re-declaring RELEASES
 * the seat's declarations together with every entry registered in it, so a
 * one-shot registration is silently dropped — the section then never renders
 * while nothing reports an error. Following the declaration epoch re-registers
 * the contribution on every declaration and drops it on every release.
 *
 * A seat that refuses the contribution is reported and leaves the rest of the
 * extension working.
 * @param ctx - the dependency-scoped context (slot registry).
 * @param seat - the contribution to register.
 * @returns disposer releasing the registration.
 */
function registerSettingsSection(ctx: ClientContext, seat: GitHubSettingsSectionSeat): () => void {
  const slots = ctx.slots as {
    register(options: Record<string, unknown>, component: unknown): () => void
    inject?(key: string, callback: () => () => void): () => void
  }
  const register = (): (() => void) => {
    try {
      const dispose = slots.register({
        name: TASK_BOARD_SETTINGS_SECTION,
        id: GITHUB_EXTENSION_ID,
        locale: LOCALE_NS,
        inject: seat.inject,
      }, seat.component as never)
      return () => {
        try { dispose() } catch { /* best-effort */ }
      }
    } catch (error) {
      console.error('[dsh-task-board-github] provider settings section registration failed', error)
      return () => {}
    }
  }
  if (typeof slots.inject !== 'function') {
    // A shell without the declaration-tracking face: register once. The section
    // renders as long as the board's card keeps its first declaration.
    return register()
  }
  try {
    return slots.inject(TASK_BOARD_SETTINGS_SECTION, register)
  } catch (error) {
    console.error('[dsh-task-board-github] provider settings section could not follow its seat', error)
    return () => {}
  }
}

/**
 * Register the two rendering seats, the visibility predicate and the mirror
 * subscription, for as long as the board's own master switch is on. The
 * board's settings seat is installed separately (see
 * {@link GitHubSettingsSectionSeat}): it must outlive this switch.
 * @param ctx - client context.
 * @returns disposer releasing every contribution.
 */
function installSeats(ctx: ClientContext): () => void {
  const face = resolveTaskBoardClientFace(ctx)
  if (face === undefined) {
    // Unreachable while the dependency scope holds: `ctx.inject(['taskBoard'])`
    // only runs this once the service is served. It stays as a guard against a
    // service that answers the name without carrying the client contract, and
    // it is not a dead end — cordis re-runs this effect when the implementation
    // behind the name changes.
    console.error('[dsh-task-board-github] the taskBoard service does not answer the client contract')
    return () => {}
  }
  const slots = ctx.slots as {
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  const seats: Array<() => void> = []
  let registered = false

  const ensure = (): void => {
    if (registered) return
    registered = true
    try {
      seats.push(slots.register({ name: TASK_BOARD_DETAIL_SECTION, id: GITHUB_EXTENSION_ID, locale: LOCALE_NS }, GitHubDetailSection as never))
      seats.push(slots.register({ name: TASK_BOARD_CARD_DECORATION, id: GITHUB_EXTENSION_ID }, GitHubCardDecoration as never))
    } catch (error) {
      console.error('[dsh-task-board-github] seat registration failed', error)
    }
  }
  const release = (): void => {
    registered = false
    for (const dispose of seats.splice(0)) {
      try { dispose() } catch { /* best-effort */ }
    }
  }

  const disposeVisibility = face.registerVisibility(isGitHubTaskVisible)
  const disposeGrouping = face.registerGrouping?.(gitHubSourceGroup)
  const unsubscribe = face.subscribe(mirror => {
    if (mirror.enabled) ensure()
    else release()
    acceptPublishedSummaries(mirror.extensions)
  })
  // Establish immediately when the board is already running; the mirror
  // subscription covers the enable transition.
  const current = face.snapshot()
  if (current.enabled) ensure()
  acceptPublishedSummaries(current.extensions)

  return () => {
    unsubscribe()
    disposeVisibility()
    disposeGrouping?.()
    release()
  }
}
