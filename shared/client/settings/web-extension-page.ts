/**
 * One settings page's seat in either the Web Extensions parent or the legacy
 * first-level settings navigation.
 *
 * The parent supplies the page contract; a child does not know which slot the
 * parent uses internally. While `webUiExtensions` is live the page is handed
 * to its service, which owns keyed mounting and disposal. Without the parent,
 * the same component registers as its original first-level settings section,
 * so a standalone install keeps a working entry.
 */

/** The parent service face this helper consumes. */
export interface WebExtensionPageService {
  readonly sectionId: string
  registerPage(page: WebExtensionPageSeat): () => void
}

/** Seat-independent page contribution. */
export interface WebExtensionPageSeat {
  key: string
  order: number
  locale: string
  label(): string
  inject(): object
  component: unknown
  children?: Record<string, { kind: 'keyed' | 'list'; scope: 'root' }>
}

/** The slot-registry slice used for the standalone fallback. */
export interface WebExtensionPageSlots {
  register(options: never, component: never): unknown
  spec?(key: string): unknown
  entries?(key: string): readonly { component?: unknown; options: Record<string, unknown> }[]
}

/** The context slice needed by the migration. */
export interface WebExtensionPageContext {
  slots: WebExtensionPageSlots
  get?(name: string): unknown
  on?(event: never, listener: never): unknown
}

const SETTINGS_SECTION = 'settings.section'
const WEB_EXTENSION_SLOT = 'web-ui.extension'

function serviceOf(ctx: WebExtensionPageContext): WebExtensionPageService | undefined {
  if (typeof ctx.get !== 'function') return undefined
  try {
    const candidate = ctx.get('webUiExtensions') as Partial<WebExtensionPageService> | undefined
    return candidate !== null
      && typeof candidate === 'object'
      && typeof candidate.sectionId === 'string'
      && typeof candidate.registerPage === 'function'
      ? candidate as WebExtensionPageService
      : undefined
  } catch {
    return undefined
  }
}

function warn(seat: string, error: unknown): void {
  try {
    console.warn(`[dsh-web-settings] page "${seat}" could not be mounted`, error)
  } catch {
    // A restricted console must not drop the remaining entry.
  }
}

/**
 * Keep exactly one reachable page contribution while the parent loads or
 * unloads. The parent service owns integrated mounting; only the fallback uses
 * this plugin's own slot registry. Slot disposal is synchronous, so the latch
 * prevents a move from recursively registering a duplicate.
 */
export function installWebExtensionPage(
  ctx: WebExtensionPageContext,
  page: WebExtensionPageSeat,
): () => void {
  let dispose: (() => void) | undefined
  let current: 'integrated' | 'legacy' | undefined
  let reconciling = false
  let disposed = false

  const present = (seat: 'integrated' | 'legacy'): boolean => {
    if (typeof ctx.slots.entries !== 'function') return current === seat
    const slot = seat === 'integrated' ? WEB_EXTENSION_SLOT : SETTINGS_SECTION
    return ctx.slots.entries(slot).some(entry =>
      entry.component === page.component
      && (seat === 'integrated' ? entry.options.key : entry.options.id) === page.key)
  }

  const registerSeat = (seat: 'integrated' | 'legacy'): (() => void) => {
    if (seat === 'integrated') {
      const service = serviceOf(ctx)
      if (service === undefined) throw new Error('webUiExtensions service is unavailable')
      return service.registerPage(page)
    }
    return ctx.slots.register({
      name: SETTINGS_SECTION,
      id: page.key,
      order: page.order,
      label: page.label,
      locale: page.locale,
      inject: page.inject as never,
      ...(page.children === undefined ? {} : { children: page.children }),
    } as never, page.component as never) as () => void
  }

  const reconcile = (): void => {
    if (disposed || reconciling) return
    const target: 'integrated' | 'legacy' = serviceOf(ctx) === undefined ? 'legacy' : 'integrated'
    if (current === target && present(target)) return
    const slot = target === 'integrated' ? WEB_EXTENSION_SLOT : SETTINGS_SECTION
    if (typeof ctx.slots.spec === 'function' && ctx.slots.spec(slot) === undefined) return
    reconciling = true
    const previous = current
    const disposePrevious = dispose
    current = undefined
    dispose = undefined
    disposePrevious?.()
    try {
      dispose = registerSeat(target)
      current = target
    } catch (error) {
      warn(target, error)
      if (previous !== undefined && previous !== target) {
        try {
          dispose = registerSeat(previous)
          current = previous
        } catch (restoreError) {
          warn(previous, restoreError)
        }
      }
    } finally {
      reconciling = false
    }
  }

  if (typeof ctx.on === 'function') {
    try { ctx.on('slots/changed' as never, reconcile as never) } catch { /* the initial entry remains usable */ }
  }
  reconcile()
  return () => {
    if (disposed) return
    disposed = true
    dispose?.()
    dispose = undefined
    current = undefined
  }
}
