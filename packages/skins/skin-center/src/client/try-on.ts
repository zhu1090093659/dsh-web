/**
 * Try-on engine for the in-GUI skin center.
 *
 * A skin's client bundle is executed through the REAL module system, not a
 * shim and not eval: the host route `/api/skin-center/bundle/<id>` serves
 * the skin's prebuilt `lib/client.js` as a same-origin script (mirroring
 * the kernel's own defaultLoadBundle — see dsh-client-modules), and its
 * body calls `window.__ModuleLoader__.load({id, factory})`, which only
 * REGISTERS the factory. `window.__DSH_MODULES__.import(package)` (the
 * kernel's ClientModuleSystem, contract C5/C6) then materializes it — which
 * auto-injects the skin's CSS `<style data-plugin>` tag — and
 * `surface.apply(miniCtx)` mounts the skin exactly as the fiber system
 * would, returning a full disposer. That makes try-on and its teardown the
 * real code paths, with no CSP `unsafe-eval` dependence and no startup
 * cost: the ~700KB of embedded art base64 is only parsed when a skin is
 * actually tried on.
 *
 * Mutual exclusion: the GUI never hosts two skins at once. The currently
 * ACTIVE skin is owned by its own cordis fiber (its disposer is not
 * reachable), so try-on retracts the active skin's visual writes by recipe:
 * remove its body attribute (its stylesheet goes inert), clear the
 * body-level backdrop inline styles (blue-fantasy's whale art), detach only
 * known skin chrome body children (title/status bars marked `data-skin-chrome`
 * or carrying the skin's body attribute, leaving other plugins' portals and
 * toasts in place), and neutralize known global-rule leaks (xp's sidebar
 * taskbar/start). Everything is snapshotted and restored on exit in original
 * order. The active skin's own fiber is never touched, so exiting try-on
 * returns the page to exactly the pre-try-on state.
 *
 * A ghost MutationObserver may survive retraction (blue-fantasy re-writes
 * its backdrop on theme flips), so during try-on a neutralizing observer
 * re-clears the backdrop props whenever `data-ds-dark-theme` changes.
 */

import { SKIN_CENTER_ENTRIES, type SkinCenterEntry } from './generated/skins.ts'

/** Body-level backdrop properties skins may write inline (blue-fantasy). */
const BACKDROP_PROPS = [
  'background-image',
  'background-position',
  'background-size',
  'background-attachment',
  'background-repeat',
] as const

/**
 * Per-skin neutralization CSS: rules that hide visual leaks whose styles
 * are NOT scoped under the skin's body attribute (they live on app elements
 * the skin touches, so detaching chrome cannot remove them). Matched by
 * css-module class substring, which is stable across rebuilds.
 */
const NEUTRALIZE_CSS: Record<string, string> = {
  // xp styles its start button + taskbar strip in the sidebar footer with
  // top-level (unscoped) rules; its apply() removes them on dispose, but
  // during try-on its ghost observer would re-add them, so hide instead.
  xp: [
    `[data-pane='sidebar'] [class*='xpTaskbar']{background:transparent!important;border-top:none!important;box-shadow:none!important}`,
    `[data-pane='sidebar'] [class*='xpStart']{display:none!important}`,
  ].join(''),
}

/** The window surfaces the boot protocol installs (manifest.ts contract). */
interface SkinCenterWindow {
  __DSH_BOOT__?: { entries?: Array<{ id: string }> }
  __DSH_MODULES__?: {
    import(specifier: string): Promise<unknown>
    invalidate(id: string): void
  }
}

/** Host base path of the skin bundle route (registered by src/routes.ts). */
const BUNDLE_ROUTE = '/api/skin-center/bundle'

/**
 * Execute one skin's client bundle as a real same-origin script, mirroring
 * the kernel's own defaultLoadBundle (dsh-client-modules): the script body
 * calls `window.__ModuleLoader__.load({id, factory})`, which only registers
 * the factory — materialization is the caller's separate `import` step. No
 * eval: try-on works under any CSP that allows same-origin scripts (the
 * shell itself loads plugin bundles this way), and a failed fetch rejects
 * so the caller can restore the active skin instead of leaving it retracted.
 * @param url - same-origin bundle URL.
 * @returns a promise resolving once the script executed.
 */
function loadBundleScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.async = true
    el.src = url
    el.addEventListener('load', () => {
      el.remove()
      resolve()
    }, { once: true })
    el.addEventListener('error', () => {
      el.remove()
      reject(new Error(`skin-center: bundle script ${url} failed to load`))
    }, { once: true })
    document.head.append(el)
  })
}

/** Read the page's composed boot-graph entry ids (only enabled plugins appear). */
function bootEntryIds(): string[] {
  const boot = (window as SkinCenterWindow).__DSH_BOOT__
  return boot?.entries?.map(entry => entry.id) ?? []
}

/** The skin package currently ACTIVE in the boot graph, if it is one of ours. */
export function activeSkinEntry(): SkinCenterEntry | undefined {
  const ids = new Set(bootEntryIds())
  return SKIN_CENTER_ENTRIES.find(entry => ids.has(entry.package))
}

/**
 * Whether a direct body child is skin chrome owned by `skin`: marked with the
 * `data-skin-chrome` marker (minecraft/dragon-heir) or carrying the skin's
 * scoping body attribute. Everything else — other plugins' portals, toasts and
 * overlays appended to body — is left alone.
 */
function isSkinChrome(el: Element, skin: SkinCenterEntry | null): boolean {
  if (el.hasAttribute('data-skin-chrome')) return true
  return skin !== null && el.hasAttribute(skin.bodyAttr)
}

/** Minimal ctx the skins' apply() needs: cordis effect lifecycle only. */
interface MiniCtx {
  effect(callback: () => () => void, label?: string): () => void
  /**
   * Service reads are answered with undefined: try-on is a pure-DOM stage,
   * so optional service access (e.g. ths reading the connection handle)
   * degrades to its fallback instead of throwing mid-apply.
   */
  get(key: string): unknown
  /** Hidden handle for the controller: run the disposers in reverse order. */
  __disposeAll(): void
}

function miniCtx(): MiniCtx {
  const disposers: Array<() => void> = []
  return {
    effect(callback) {
      disposers.push(callback())
      return () => {}
    },
    get() {
      return undefined
    },
    __disposeAll(): void {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

/** Snapshot of the active skin's visual writes, restored on try-on exit. */
interface ActiveVisuals {
  skin: SkinCenterEntry | null
  /** Attribute value before retraction (null = attribute absent). */
  bodyAttr: string | null
  /** body inline style before retraction (null = none). */
  bodyStyle: string | null
  /** Skin chrome elements detached from body, re-inserted at their anchors. */
  detached: Array<{ el: HTMLElement; anchor: Node | null }>
  /** Neutralizes ghost backdrop writes while a try-on is live. */
  clearObserver: MutationObserver | null
  /** Hides global-rule leaks of the active skin (xp taskbar). */
  neutralizeStyle: HTMLStyleElement | null
}

/**
 * One live try-on session: owns the tried-on skin's disposer plus the
 * captured active-skin visuals, and restores everything on exit.
 */
export class TryOnController {
  private session: {
    /** The tried-on skin, or null when trying on the official stock look. */
    entry: SkinCenterEntry | null
    dispose: () => void
    active: ActiveVisuals
  } | null = null

  /**
   * Generation counter. A newer try-on or exit increments it, so an in-flight
   * `tryOn` (awaiting the real bundle load) can detect it was superseded and
   * drop only what it mounted instead of clobbering the newer session.
   */
  private epoch = 0

  /**
   * One package can be requested again before its first script load finishes
   * (for example A -> B -> A). Share that materialization so two script tags
   * never race to register the same module factory.
   */
  private readonly pendingModules = new Map<string, Promise<(ctx: unknown) => unknown>>()

  /**
   * Package selected by the newest async request. A superseded request for the
   * same package must not invalidate the module/style now owned by that newer
   * request when their shared load settles.
   */
  private requestedPackage: string | null = null

  /**
   * Loads one skin's client bundle so its factory registers on the page's
   * `__ModuleLoader__`. Defaults to a same-origin script tag from the host
   * route `/api/skin-center/bundle/<id>`; tests inject a stub.
   */
  private readonly loadBundle: (entry: SkinCenterEntry) => Promise<void>

  constructor(options: { loadBundle?: (entry: SkinCenterEntry) => Promise<void> } = {}) {
    this.loadBundle = options.loadBundle ?? (entry => loadBundleScript(`${BUNDLE_ROUTE}/${encodeURIComponent(entry.id)}`))
  }
  /** The skin currently being tried on, if any. */
  get trying(): SkinCenterEntry | null {
    return this.session?.entry ?? null
  }

  /** Whether the official stock look (no skin) is being tried on. */
  get tryingOfficial(): boolean {
    return this.session !== null && this.session.entry === null
  }

  /**
   * Start trying on `entry` (replaces any live session).
   *
   * When another skin is already being tried on, keep it mounted while the
   * next bundle loads. Once the target is ready, tear down the old preview and
   * mount the new one against the SAME captured active-skin snapshot. This
   * avoids the expensive preview -> active -> preview round trip and prevents
   * a flash of the active skin between consecutive try-ons.
   * @returns whether this request mounted the target (false when superseded).
   */
  async tryOn(entry: SkinCenterEntry): Promise<boolean> {
    if (entry.package === activeSkinEntry()?.package) return false
    const epoch = ++this.epoch
    this.requestedPackage = entry.package

    let apply: (ctx: unknown) => unknown
    try {
      // Keep either the active skin or the current preview visible while the
      // target script downloads, parses and materializes its module.
      apply = await this.loadModuleOnce(entry)
    } catch (error) {
      if (this.shouldCleanupRequest(entry, epoch)) this.cleanupModule(entry)
      throw error
    }
    if (epoch !== this.epoch) {
      if (this.shouldCleanupRequest(entry, epoch)) this.cleanupModule(entry)
      return false
    }

    const previous = this.session
    let active: ActiveVisuals
    if (previous === null) {
      active = this.captureAndRetractActive()
    } else {
      // Transfer ownership of the original active-skin snapshot directly to
      // the next preview; restoring and immediately retracting it is wasted
      // DOM work and is the visible pause reported during chained try-ons.
      this.session = null
      previous.dispose()
      if (previous.entry !== null) this.cleanupModule(previous.entry)
      active = previous.active
    }

    let dispose: () => void
    try {
      dispose = this.applyLoaded(entry, apply)
    } catch (error) {
      if (epoch === this.epoch) this.restoreActive(active)
      throw error
    }
    this.session = { entry, dispose, active }
    return true
  }

  /**
   * Try on the official stock look: retract the active skin's visual writes
   * (same recipe as a skin try-on) and mount nothing. Exiting restores the
   * active skin exactly like any other try-on session.
   */
  tryOnOfficial(): void {
    if (activeSkinEntry() === null) return
    this.epoch += 1
    this.requestedPackage = null
    const previous = this.session
    if (previous !== null) {
      // A live preview already owns the captured active visuals. Dispose only
      // that preview and reuse the snapshot instead of restoring and retracting
      // the active skin in two consecutive layout-heavy operations.
      this.session = null
      previous.dispose()
      if (previous.entry !== null) this.cleanupModule(previous.entry)
      this.session = { entry: null, dispose: () => {}, active: previous.active }
      return
    }
    const active: ActiveVisuals = this.captureAndRetractActive()
    this.session = { entry: null, dispose: () => {}, active }
  }

  /** Exit the live session: dispose the tried-on skin, then restore the active skin. */
  exit(): void {
    // Also invalidate an in-flight initial/chained load. The visible session
    // may already be null by the time a user exits, but its late completion
    // must never remount a skin after cancellation.
    this.epoch += 1
    this.requestedPackage = null
    const session = this.session
    if (session === null) return
    this.session = null
    session.dispose()
    if (session.entry !== null) this.cleanupModule(session.entry)
    this.restoreActive(session.active)
  }

  /** Share one materialization while repeated requests for a package overlap. */
  private loadModuleOnce(entry: SkinCenterEntry): Promise<(ctx: unknown) => unknown> {
    const existing = this.pendingModules.get(entry.package)
    if (existing !== undefined) return existing

    const pending = this.loadModule(entry)
    this.pendingModules.set(entry.package, pending)
    void pending.then(
      () => {
        if (this.pendingModules.get(entry.package) === pending) this.pendingModules.delete(entry.package)
      },
      () => {
        if (this.pendingModules.get(entry.package) === pending) this.pendingModules.delete(entry.package)
      },
    )
    return pending
  }

  /** Whether this request still owns cleanup of the package module/style. */
  private shouldCleanupRequest(entry: SkinCenterEntry, epoch: number): boolean {
    return epoch === this.epoch || this.requestedPackage !== entry.package
  }

  /** Execute + materialize the target skin through the real loader. */
  private async loadModule(entry: SkinCenterEntry): Promise<(ctx: unknown) => unknown> {
    const modules = (window as SkinCenterWindow).__DSH_MODULES__
    if (modules === undefined) throw new Error('skin-center: window.__DSH_MODULES__ missing')
    // This try-on session owns the module record for the package for its
    // whole life (a try-on of the ACTIVE skin is rejected above, and the GUI
    // never hosts two skins at once). Drop any factory a crashed earlier
    // session left behind so the script below registers a fresh one — the
    // duplicate-registration retry dance is unnecessary with the real
    // loader, whose load() throws on a duplicate id.
    modules.invalidate(entry.package)
    await this.loadBundle(entry)
    const surface = await modules.import(entry.package)
    const apply = (surface as { apply?: (ctx: unknown) => unknown }).apply
    if (typeof apply !== 'function') {
      throw new Error(`skin-center: "${entry.package}" client bundle exports no apply`)
    }
    return apply
  }

  /** Apply a module that has already been loaded while the active skin was visible. */
  private applyLoaded(entry: SkinCenterEntry, apply: (ctx: unknown) => unknown): () => void {
    const ctx = miniCtx()
    try {
      apply(ctx)
    } catch (error) {
      // A skin that throws mid-apply leaves partial writes behind (body
      // attribute, chrome, style tag) and never registers its disposer —
      // the tryOn catch only restores the ACTIVE skin. Roll the residue back
      // here so a crashed try-on can never bleed into the next one.
      this.cleanupModule(entry)
      document.body.removeAttribute(entry.bodyAttr)
      for (const el of [...document.body.children] as HTMLElement[]) {
        if (isSkinChrome(el, entry)) el.remove()
      }
      throw error
    }
    return ctx.__disposeAll
  }

  /** Drop the tried-on module record + its injected style tag. */
  private cleanupModule(entry: SkinCenterEntry): void {
    const modules = (window as SkinCenterWindow).__DSH_MODULES__
    modules?.invalidate(entry.package)
    for (const el of document.querySelectorAll(`style[data-plugin=${JSON.stringify(entry.package)}]`)) {
      el.remove()
    }
  }

  /**
   * Snapshot the active skin's visual writes and retract them so the tried-on
   * skin can take over the whole surface.
   */
  private captureAndRetractActive(): ActiveVisuals {
    const skin = activeSkinEntry() ?? null
    const body = document.body
    const bodyAttr = skin === null ? null : body.getAttribute(skin.bodyAttr)
    if (skin !== null && bodyAttr !== null) body.removeAttribute(skin.bodyAttr)

    const bodyStyle = body.getAttribute('style')
    for (const prop of BACKDROP_PROPS) body.style.removeProperty(prop)

    // Detach only known skin chrome (marker/bodyAttr), leaving other
    // plugins' portals/toasts in place; remember each element's next sibling
    // so restore re-inserts in the original order.
    const children = [...body.children] as HTMLElement[]
    const chrome = new Set<HTMLElement>()
    for (const el of children) {
      if (el.id !== 'root' && isSkinChrome(el, skin)) chrome.add(el)
    }
    const detached: Array<{ el: HTMLElement; anchor: Node | null }> = []
    for (let i = 0; i < children.length; i++) {
      const el = children[i]
      if (!chrome.has(el)) continue
      let anchor: Node | null = null
      for (let j = i + 1; j < children.length; j++) {
        if (!chrome.has(children[j])) { anchor = children[j]; break }
      }
      detached.push({ el, anchor })
    }
    for (const { el } of detached) el.remove()

    // Neutralize a surviving ghost observer (blue-fantasy's backdrop
    // re-writer) across theme flips during the try-on.
    const clearObserver = new MutationObserver(() => {
      for (const prop of BACKDROP_PROPS) body.style.removeProperty(prop)
    })
    clearObserver.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })

    const neutralizeCss = skin === null ? undefined : NEUTRALIZE_CSS[skin.id]
    const neutralizeStyle = neutralizeCss === undefined ? null : this.injectStyle(neutralizeCss)

    return { skin, bodyAttr, bodyStyle, detached, clearObserver, neutralizeStyle }
  }

  /** Restore the active skin's captured visual state. */
  private restoreActive(active: ActiveVisuals): void {
    const body = document.body
    if (active.skin !== null && active.bodyAttr !== null) {
      body.setAttribute(active.skin.bodyAttr, active.bodyAttr)
    }
    if (active.bodyStyle !== null) {
      body.setAttribute('style', active.bodyStyle)
    } else {
      body.removeAttribute('style')
    }
    for (const { el, anchor } of active.detached) {
      body.insertBefore(el, anchor !== null && anchor.parentNode === body ? anchor : null)
    }
    active.clearObserver?.disconnect()
    active.neutralizeStyle?.remove()
  }

  private injectStyle(css: string): HTMLStyleElement {
    const tag = document.createElement('style')
    tag.dataset.skinCenterNeutralize = ''
    tag.textContent = css
    document.head.append(tag)
    return tag
  }
}
