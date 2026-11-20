/**
 * Browser-half installer for the SSH provider.
 *
 * A provider's browser half registers its own contributions into the child seats
 * the board declares; it resolves the board's client capability face from the
 * shared service name and adds no HTTP surface of its own. Three switches
 * compose here:
 *
 * - the BOARD's master switch collapses the seats (the board mirror reports it,
 *   so the seats are rebuilt when the board comes back);
 * - this EXTENSION's own volatile switch hides the seats entirely, without a
 *   restart, because the installer follows the settings form the section edits;
 * - the settings section itself follows neither: it is where that switch lives.
 *
 * The board's browser half publishes its `taskBoard` service inside its own
 * apply, and the aggregate mounts its client children without ordering those
 * applies, so the service is frequently NOT there yet when this installer runs.
 * The seats therefore live behind a cordis dependency scope (`ctx.inject`)
 * instead of a one-shot lookup: the scope mounts once the board serves the
 * service and unloads — releasing every seat — when the board withdraws it.
 *
 * @module dsh-task-board-ssh/client/ssh/extension
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  resolveTaskBoardClientFace,
  TASK_BOARD_CARD_DECORATION,
  TASK_BOARD_COMPOSE_SECTION,
  TASK_BOARD_DETAIL_SECTION,
  TASK_BOARD_SETTINGS_SECTION,
} from '../../core/contract.ts'
import { SSH_EXTENSION_ID } from '../../core/action.ts'
import { SshCardDecoration } from './card-decoration.tsx'
import { SshComposeSection } from './compose-section.tsx'
import { SshDetailSection } from './detail-section.tsx'
import { acceptBoardContext, acceptPublishedSummary, clearSummary } from './summary.ts'

/** Locale namespace the seats bind to. */
const LOCALE_NS = 'task-board-ssh'

/** The live switch the installer follows; the settings section's form supplies it. */
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
 * The section is NOT gated by the extension's own switch: turning the extension
 * off must not remove the control that turns it back on. It is gated by the
 * board's service alone, because the board's settings card is the only surface
 * that declares the seat it renders into.
 */
export interface SshSettingsSectionSeat {
  /** Build the face the section renders with (its staged form and actions). */
  inject(): unknown
  /** The section component itself. */
  component: unknown
}

/**
 * Install the SSH provider's browser half.
 * @param ctx - client context (slot registry).
 * @param source - the extension's live enabled switch.
 * @param settings - the section to contribute into the board's settings card.
 * @returns disposer releasing every contribution.
 */
export function installSshClientHalf(
  ctx: ClientContext,
  source: ExtensionEnabledSource,
  settings?: SshSettingsSectionSeat,
): () => void {
  /** The dependency-scoped fiber that owns the seats, while both gates are on. */
  let injection: ReturnType<ClientContext['inject']> | undefined
  /** The fiber that owns the board's provider-settings section, independent of the switch. */
  let settingsInjection: ReturnType<ClientContext['inject']> | undefined

  const install = (): void => {
    if (injection !== undefined) return
    // Cordis runs this callback once the board serves `taskBoard` — immediately
    // if it is already there, or the moment it appears otherwise — and disposes
    // the scope when the service is withdrawn or replaced, which is what
    // releases the seats again.
    injection = ctx.inject(['taskBoard'], (scope: ClientContext) => {
      scope.effect(() => installSeats(scope), 'task-board-ssh: provider seats')
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
  // and left alone by the extension's own switch (see SshSettingsSectionSeat).
  if (settings !== undefined) {
    settingsInjection = ctx.inject(['taskBoard'], (scope: ClientContext) => {
      scope.effect(() => registerSettingsSection(scope, settings), 'task-board-ssh: provider settings section')
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
 * The registration follows the seat's OWN declaration lifecycle
 * (`slots.inject`), not a one-shot `register`: the board's card declares the
 * seat, and re-declares it whenever it moves between plugin-card seats (the
 * family group loading after boot is the normal case). Re-declaring RELEASES the
 * seat's declarations together with every entry registered in it, so a one-shot
 * registration is silently dropped — the section then never renders while
 * nothing reports an error.
 * @param ctx - the dependency-scoped context (slot registry).
 * @param seat - the contribution to register.
 * @returns disposer releasing the registration.
 */
function registerSettingsSection(ctx: ClientContext, seat: SshSettingsSectionSeat): () => void {
  const slots = ctx.slots as {
    register(options: Record<string, unknown>, component: unknown): () => void
    inject?(key: string, callback: () => () => void): () => void
  }
  const register = (): (() => void) => {
    try {
      const dispose = slots.register({
        name: TASK_BOARD_SETTINGS_SECTION,
        id: SSH_EXTENSION_ID,
        locale: LOCALE_NS,
        inject: seat.inject,
      }, seat.component as never)
      return () => {
        try { dispose() } catch { /* best-effort */ }
      }
    } catch (error) {
      console.error('[dsh-task-board-ssh] provider settings section registration failed', error)
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
    console.error('[dsh-task-board-ssh] provider settings section could not follow its seat', error)
    return () => {}
  }
}

/**
 * Register the three rendering seats for as long as the board's own master switch
 * is on, and mirror the published summary into the browser-side store.
 * @param ctx - client context.
 * @returns disposer releasing every contribution.
 */
function installSeats(ctx: ClientContext): () => void {
  const face = resolveTaskBoardClientFace(ctx)
  if (face === undefined) {
    // Unreachable while the dependency scope holds: `ctx.inject(['taskBoard'])`
    // only runs this once the service is served. It stays as a guard against a
    // service that answers the name without carrying the client contract, and it
    // is not a dead end — cordis re-runs this effect when the implementation
    // behind the name changes.
    console.error('[dsh-task-board-ssh] the taskBoard service does not answer the client contract')
    return () => {}
  }
  const slots = ctx.slots as {
    register(options: Record<string, unknown>, component: unknown): () => void
    inject?(key: string, callback: () => () => void): () => void
  }
  const seats: Array<() => void> = []
  let registered = false

  /** Follow a slot declaration via `slots.inject` when available, falling back to one-shot `register`. */
  const followSeat = (options: Record<string, unknown>, component: unknown): (() => void) => {
    const seatName = String(options.name)
    const doRegister = (): (() => void) => {
      try {
        const dispose = slots.register(options, component)
        return () => {
          try { dispose() } catch { /* best-effort */ }
        }
      } catch (error) {
        console.error(`[dsh-task-board-ssh] seat registration failed for ${seatName}`, error)
        return () => {}
      }
    }
    if (typeof slots.inject !== 'function') return doRegister()
    try {
      return slots.inject(seatName, doRegister)
    } catch (error) {
      console.error(`[dsh-task-board-ssh] seat ${seatName} could not follow its declaration`, error)
      return doRegister()
    }
  }

  const ensure = (): void => {
    if (registered) return
    const next: Array<() => void> = []
    try {
      next.push(followSeat({ name: TASK_BOARD_DETAIL_SECTION, id: SSH_EXTENSION_ID, locale: LOCALE_NS }, SshDetailSection as never))
      next.push(followSeat({ name: TASK_BOARD_CARD_DECORATION, id: SSH_EXTENSION_ID }, SshCardDecoration as never))
      next.push(followSeat({ name: TASK_BOARD_COMPOSE_SECTION, id: SSH_EXTENSION_ID, locale: LOCALE_NS }, SshComposeSection as never))
      seats.push(...next)
      registered = true
    } catch (error) {
      for (const dispose of next) {
        try { dispose() } catch { /* best-effort */ }
      }
      console.error('[dsh-task-board-ssh] seat registration failed', error)
    }
  }
  const release = (): void => {
    registered = false
    for (const dispose of seats.splice(0)) {
      try { dispose() } catch { /* best-effort */ }
    }
  }

  const applyMirror = (mirror: ReturnType<typeof face.snapshot>): void => {
    if (mirror.enabled) ensure()
    else release()
    acceptBoardContext({
      ...(mirror.workspaces === undefined ? {} : { workspaces: mirror.workspaces }),
      lastError: mirror.lastError,
    })
    // Before the first authoritative Host snapshot arrives (`hydrated === false`),
    // `mirror.extensions` is an empty initial placeholder; wait for hydration
    // instead of flashing a false "host half unmounted" state on cold start.
    if (mirror.hydrated !== false) {
      acceptPublishedSummary(mirror.extensions)
    }
  }

  const unsubscribe = face.subscribe(applyMirror)
  // Establish immediately when the board is already running; the mirror
  // subscription covers the enable transition that rebuilds the seats.
  applyMirror(face.snapshot())

  return () => {
    unsubscribe()
    release()
  }
}
