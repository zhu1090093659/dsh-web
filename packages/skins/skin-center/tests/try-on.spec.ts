// @vitest-environment jsdom
/**
 * TryOnController regression tests: switching between skin try-ons must
 * never leave residue from the previous skin, and a skin whose apply()
 * throws mid-write must be rolled back completely (the regression: trading
 * reads the optional connection service via ctx.get(), which the try-on
 * miniCtx must answer with undefined — otherwise apply() crashes after
 * writing the body attribute, chrome and style tag, and the residue bleeds
 * into every later try-on).
 *
 * The registry carries metadata only (bundles are served on demand by the
 * host route /api/skin-center/bundle/<id>), so the tests inject a loadBundle
 * stub that executes the REAL bundle text — read from the committed build
 * artifact packages/skins/<id>/lib/client.js — exactly like the host route's
 * script would: the text registers its factory on window.__ModuleLoader__
 * (the production path uses a same-origin script tag, no eval; the stub uses
 * eval because jsdom does not fetch external scripts).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SKIN_CENTER_ENTRIES, type SkinCenterEntry } from '../src/client/generated/skins.ts'
import { activeSkinEntry, resetHotOverride, TryOnController } from '../src/client/try-on.ts'

declare global {
  interface Window {
    __ModuleLoader__?: {
      load(handoff: { id: string; factory: (require: (spec: string) => unknown) => unknown }): void
    }
    __DSH_MODULES__?: {
      import(id: string): Promise<{ apply?: (ctx: unknown) => unknown }>
      invalidate(id: string): void
    }
    __DSH_BOOT__?: { entries: Array<{ id: string }> }
  }
}

/** Minimal ClientModuleSystem stand-in: register factories, materialize on import. */
const factories = new Map<string, (require: (spec: string) => unknown) => unknown>()

beforeEach(() => {
  factories.clear()
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="root"></div>'
  document.title = 'DeepSeek Harness'
  window.__ModuleLoader__ = {
    load(handoff) {
      if (factories.has(handoff.id)) throw new Error(`duplicate factory ${handoff.id}`)
      factories.set(handoff.id, handoff.factory)
    },
  }
  window.__DSH_MODULES__ = {
    async import(id) {
      const factory = factories.get(id)
      if (factory === undefined) throw new Error(`no factory for ${id}`)
      return factory((spec) => { throw new Error(`unexpected require ${spec}`) }) as never
    },
    invalidate(id) {
      factories.delete(id)
    },
  }
  delete window.__DSH_BOOT__
  resetHotOverride()
})

const entry = (id: string): SkinCenterEntry => {
  const found = SKIN_CENTER_ENTRIES.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`registry entry missing: ${id}`)
  return found
}

/** The real bundle text of a skin, read from its committed build artifact. */
const bundleTextFor = (id: string): string => {
  // Built through a variable: Vite's dev transform rewrites an INLINE
  // `new URL(<template literal>, import.meta.url)` as an asset reference,
  // which resolves to garbage under vitest's jsdom environment.
  const relative = `../../../skins/${id}/lib/client.js`
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

/** A hand-built bundle for the throw-mid-apply regression (mirrors the old embedded-text entry). */
const bombBundle = [
  'window.__ModuleLoader__.load({',
  '  id: "@deepseek-ai/dsh-client-ui-skin-bomb",',
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  '    exports.apply = function () {',
  '      document.body.setAttribute("data-dsh-bomb", "");',
  '      var chrome = document.createElement("div");',
  '      chrome.className = "bombChrome";',
  '      chrome.dataset.skinChrome = "bomb";',
  '      document.body.appendChild(chrome);',
  '      throw new Error("boom");',
  '    };',
  '    return module.exports;',
  '  }',
  '})',
].join('\n')

/** A controller whose bundle loading executes the real (or hand-built) bundle text. */
const controller = (): TryOnController => new TryOnController({
  loadBundle: async target => {
    // The stub stands in for the host route's script execution.
    ;(0, eval)(target.id === 'bomb' ? bombBundle : bundleTextFor(target.id))
  },
})

describe('TryOnController skin switching', () => {
  it('keeps the active skin visible until the target bundle is ready', async () => {
    const active = entry('whale-song')
    const target = entry('xp')
    window.__DSH_BOOT__ = { entries: [{ id: active.package }] }
    document.body.setAttribute(active.bodyAttr, '')

    let releaseBundle!: () => void
    const bundleReady = new Promise<void>(resolve => { releaseBundle = resolve })
    const c = new TryOnController({
      loadBundle: async next => {
        await bundleReady
        ;(0, eval)(bundleTextFor(next.id))
      },
    })

    const pending = c.tryOn(target)
    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
    expect(document.body.hasAttribute(target.bodyAttr)).toBe(false)

    releaseBundle()
    await expect(pending).resolves.toBe(true)
    expect(document.body.hasAttribute(active.bodyAttr)).toBe(false)
    expect(document.body.getAttribute(target.bodyAttr)).toBe('')

    c.exit()
    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
    expect(document.body.hasAttribute(target.bodyAttr)).toBe(false)
  })

  it('keeps the current preview mounted until the next preview bundle is ready', async () => {
    const first = entry('miku')
    const second = entry('xp')
    const c = controller()

    await expect(c.tryOn(first)).resolves.toBe(true)
    expect(document.body.getAttribute(first.bodyAttr)).toBe('')

    let releaseBundle!: () => void
    const bundleReady = new Promise<void>(resolve => { releaseBundle = resolve })
    const delayed = new TryOnController({
      loadBundle: async target => {
        if (target.id === second.id) await bundleReady
        ;(0, eval)(bundleTextFor(target.id))
      },
    })

    // The delayed controller needs to own the first preview's active snapshot,
    // so reproduce the chain entirely on it.
    c.exit()
    await expect(delayed.tryOn(first)).resolves.toBe(true)
    const pending = delayed.tryOn(second)
    expect(document.body.getAttribute(first.bodyAttr)).toBe('')
    expect(document.body.hasAttribute(second.bodyAttr)).toBe(false)

    releaseBundle()
    await expect(pending).resolves.toBe(true)
    expect(document.body.hasAttribute(first.bodyAttr)).toBe(false)
    expect(document.body.getAttribute(second.bodyAttr)).toBe('')

    delayed.exit()
  })

  it('restores the original active skin after chained try-ons', async () => {
    const active = entry('whale-song')
    window.__DSH_BOOT__ = { entries: [{ id: active.package }] }
    document.body.setAttribute(active.bodyAttr, '')
    const c = controller()

    await expect(c.tryOn(entry('miku'))).resolves.toBe(true)
    await expect(c.tryOn(entry('xp'))).resolves.toBe(true)
    c.exit()

    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
    expect(document.body.hasAttribute(entry('miku').bodyAttr)).toBe(false)
    expect(document.body.hasAttribute(entry('xp').bodyAttr)).toBe(false)
  })

  it('cancels a pending chained try-on without a late remount', async () => {
    const active = entry('whale-song')
    const first = entry('miku')
    const second = entry('xp')
    window.__DSH_BOOT__ = { entries: [{ id: active.package }] }
    document.body.setAttribute(active.bodyAttr, '')

    let releaseBundle!: () => void
    const bundleReady = new Promise<void>(resolve => { releaseBundle = resolve })
    const c = new TryOnController({
      loadBundle: async target => {
        if (target.id === second.id) await bundleReady
        ;(0, eval)(bundleTextFor(target.id))
      },
    })

    await expect(c.tryOn(first)).resolves.toBe(true)
    const pending = c.tryOn(second)
    c.exit()
    releaseBundle()

    await expect(pending).resolves.toBe(false)
    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
    expect(document.body.hasAttribute(first.bodyAttr)).toBe(false)
    expect(document.body.hasAttribute(second.bodyAttr)).toBe(false)
  })

  it('deduplicates an overlapping A -> B -> A load and keeps the newest A mounted', async () => {
    const active = entry('whale-song')
    const first = entry('miku')
    const second = entry('xp')
    window.__DSH_BOOT__ = { entries: [{ id: active.package }] }
    document.body.setAttribute(active.bodyAttr, '')

    let releaseFirst!: () => void
    let releaseSecond!: () => void
    const firstReady = new Promise<void>(resolve => { releaseFirst = resolve })
    const secondReady = new Promise<void>(resolve => { releaseSecond = resolve })
    const loadCounts = new Map<string, number>()
    const c = new TryOnController({
      loadBundle: async target => {
        loadCounts.set(target.id, (loadCounts.get(target.id) ?? 0) + 1)
        await (target.id === first.id ? firstReady : secondReady)
        ;(0, eval)(bundleTextFor(target.id))
      },
    })

    const staleFirst = c.tryOn(first)
    const staleSecond = c.tryOn(second)
    const newestFirst = c.tryOn(first)
    expect(loadCounts.get(first.id)).toBe(1)
    expect(loadCounts.get(second.id)).toBe(1)

    releaseFirst()
    await expect(staleFirst).resolves.toBe(false)
    await expect(newestFirst).resolves.toBe(true)
    expect(document.body.getAttribute(first.bodyAttr)).toBe('')
    expect(document.querySelector('style[data-plugin-css*="miku.module.css"]')).not.toBeNull()

    releaseSecond()
    await expect(staleSecond).resolves.toBe(false)
    expect(document.body.getAttribute(first.bodyAttr)).toBe('')
    expect(document.querySelector('style[data-plugin-css*="miku.module.css"]')).not.toBeNull()
    expect(document.body.hasAttribute(second.bodyAttr)).toBe(false)

    c.exit()
    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
  })

  it('cancels an initial load before a session exists', async () => {
    const active = entry('whale-song')
    const target = entry('xp')
    window.__DSH_BOOT__ = { entries: [{ id: active.package }] }
    document.body.setAttribute(active.bodyAttr, '')

    let releaseBundle!: () => void
    const bundleReady = new Promise<void>(resolve => { releaseBundle = resolve })
    const c = new TryOnController({
      loadBundle: async next => {
        await bundleReady
        ;(0, eval)(bundleTextFor(next.id))
      },
    })

    const pending = c.tryOn(target)
    c.exit()
    expect(document.body.getAttribute(active.bodyAttr)).toBe('')

    releaseBundle()
    await expect(pending).resolves.toBe(false)
    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
    expect(document.body.hasAttribute(target.bodyAttr)).toBe(false)
    expect(document.querySelector('style[data-plugin-css*="xp.module.css"]')).toBeNull()
  })

  it('switches to the official preview while another preview is loading', async () => {
    const active = entry('whale-song')
    const first = entry('miku')
    const pendingTarget = entry('xp')
    window.__DSH_BOOT__ = { entries: [{ id: active.package }] }
    document.body.setAttribute(active.bodyAttr, '')

    let releaseBundle!: () => void
    const bundleReady = new Promise<void>(resolve => { releaseBundle = resolve })
    const c = new TryOnController({
      loadBundle: async target => {
        if (target.id === pendingTarget.id) await bundleReady
        ;(0, eval)(bundleTextFor(target.id))
      },
    })

    await expect(c.tryOn(first)).resolves.toBe(true)
    const pending = c.tryOn(pendingTarget)
    c.tryOnOfficial()

    expect(c.tryingOfficial).toBe(true)
    expect(document.body.hasAttribute(active.bodyAttr)).toBe(false)
    expect(document.body.hasAttribute(first.bodyAttr)).toBe(false)

    releaseBundle()
    await expect(pending).resolves.toBe(false)
    expect(c.tryingOfficial).toBe(true)
    expect(document.body.hasAttribute(pendingTarget.bodyAttr)).toBe(false)

    c.exit()
    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
  })

  it('switching from trading try-on to another skin leaves no trading residue', async () => {
    const c = controller()

    await expect(c.tryOn(entry('trading'))).resolves.toBe(true)
    expect(document.body.getAttribute('data-dsh-trading')).toBe('')
    expect(document.querySelector('style[data-plugin-css*="trading.module.css"]')).not.toBeNull()

    await expect(c.tryOn(entry('xp'))).resolves.toBe(true)
    expect(document.body.hasAttribute('data-dsh-trading')).toBe(false)
    expect(document.querySelector('style[data-plugin-css*="trading.module.css"]')).toBeNull()
    expect(document.body.querySelector('[class*="tradingTitlebar"]')).toBeNull()
    expect(document.body.querySelector('[class*="tradingStatusbar"]')).toBeNull()
    // xp try-on is live, so the title is xp's — but never trading's.
    expect(document.title).not.toBe('交易终端 · DeepSeek 在线')
  })

  it('a skin whose apply() throws mid-write is rolled back completely', async () => {
    const bomb: SkinCenterEntry = {
      id: 'bomb',
      name: 'Bomb',
      nameEn: 'Bomb',
      tagline: '',
      accent: '#000',
      bodyAttr: 'data-dsh-bomb',
      package: '@deepseek-ai/dsh-client-ui-skin-bomb',
    }
    const c = controller()

    await expect(c.tryOn(bomb)).rejects.toThrow('boom')
    expect(document.body.hasAttribute('data-dsh-bomb')).toBe(false)
    expect(document.body.querySelector('.bombChrome')).toBeNull()

    // The surface stays usable for the next try-on.
    await expect(c.tryOn(entry('xp'))).resolves.toBe(true)
    expect(document.body.hasAttribute('data-dsh-bomb')).toBe(false)
    expect(document.querySelector('style[data-plugin-css*="xp.module.css"]')).not.toBeNull()
  })

  it('try-on of another skin neutralizes an active matrix (canvas hidden, observer inert)', async () => {
    const matrix = entry('matrix')
    window.__DSH_BOOT__ = { entries: [{ id: matrix.package }] }
    // Mount matrix the way the fiber system would: real bundle + mini ctx.
    ;(0, eval)(bundleTextFor('matrix'))
    const disposers: Array<() => void> = []
    const surface = await window.__DSH_MODULES__!.import(matrix.package)
    surface.apply?.({
      effect(callback: () => () => void) {
        disposers.push(callback())
        return () => {}
      },
      get() {
        return undefined
      },
    })
    // jsdom has no 2d context, so the real rain canvas is never mounted;
    // simulate the active skin's fixed overlay.
    const canvas = document.createElement('canvas')
    canvas.dataset.plugin = 'dsh-matrix-skin'
    document.body.appendChild(canvas)
    document.body.dataset.dsDarkTheme = ''

    // The active matrix keep-alive works while its marker is present.
    delete document.body.dataset.dsDarkTheme
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.body.dataset.dsDarkTheme).toBe('')

    const c = controller()
    await expect(c.tryOn(entry('xp'))).resolves.toBe(true)

    // Marker retracted and the overlay hidden by the neutralize rule (the
    // canvas itself stays in the DOM, exactly like xp's taskbar).
    expect(document.body.hasAttribute('data-dsh-matrix')).toBe(false)
    expect(document.querySelector('canvas[data-plugin="dsh-matrix-skin"]')).not.toBeNull()
    const neutralize = document.querySelector('style[data-skin-center-neutralize]')
    expect(neutralize?.textContent).toContain("[data-plugin='dsh-matrix-skin']")

    // The ghost observer stays inert: a light-preview flip of the dark flag
    // is not reverted while matrix is retracted.
    delete document.body.dataset.dsDarkTheme
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.body.dataset.dsDarkTheme).toBeUndefined()

    c.exit()
    expect(document.body.dataset.dshMatrix).toBe('')
    expect(document.querySelector('style[data-skin-center-neutralize]')).toBeNull()
    expect(document.querySelector('canvas[data-plugin="dsh-matrix-skin"]')).not.toBeNull()

    // Restoring the marker re-arms the keep-alive for the real session.
    // (Set a concrete value first: deleting an already-absent attribute
    // emits no mutation, so the observer would have nothing to react to.)
    document.body.dataset.dsDarkTheme = 'light'
    delete document.body.dataset.dsDarkTheme
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(document.body.dataset.dsDarkTheme).toBe('')

    for (const dispose of disposers.reverse()) dispose()
  })

  it('trying on matrix itself mounts the full skin (no neutralize rule, own rain path)', async () => {
    const active = entry('whale-song')
    window.__DSH_BOOT__ = { entries: [{ id: active.package }] }
    document.body.setAttribute(active.bodyAttr, '')
    const c = controller()

    await expect(c.tryOn(entry('matrix'))).resolves.toBe(true)

    // matrix is the PREVIEW, not the active skin: the neutralize rule (which
    // hides the rain canvas) must NOT be injected, so the preview keeps its
    // full digital-rain effect. The preview's own apply() mounts the rain
    // canvas in a real browser (jsdom has no 2d context, so it is mounted
    // and immediately removed — the marker + absence of any hide rule is
    // what this environment can assert).
    expect(document.querySelector('style[data-skin-center-neutralize]')).toBeNull()
    expect(document.body.getAttribute('data-dsh-matrix')).toBe('')
    expect(document.body.hasAttribute(active.bodyAttr)).toBe(false)

    c.exit()
    expect(document.body.hasAttribute('data-dsh-matrix')).toBe(false)
    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
  })

  it('re-try-on after exit re-registers the same skin cleanly', async () => {
    const c = controller()
    await expect(c.tryOn(entry('xp'))).resolves.toBe(true)
    c.exit()
    expect(document.body.hasAttribute('data-dsh-xp')).toBe(false)
    expect(document.querySelector('style[data-plugin-css*="xp.module.css"]')).toBeNull()
    // A second try-on of the same skin must work: the exit invalidated the
    // module record, so the next load registers a fresh factory (no
    // duplicate-registration throw).
    await expect(c.tryOn(entry('xp'))).resolves.toBe(true)
    expect(document.body.getAttribute('data-dsh-xp')).toBe('')
  })

  it('re-trying the skin already being previewed keeps its CSS and live session', async () => {
    const c = controller()

    await expect(c.tryOn(entry('xp'))).resolves.toBe(true)
    expect(document.body.getAttribute('data-dsh-xp')).toBe('')
    expect(document.querySelector('style[data-plugin-css*="xp.module.css"]')).not.toBeNull()

    // Same skin again while the preview is live must be a no-op, not a
    // reload: each bundle materialization injects its CSS exactly once (a
    // per-bundle style[data-plugin-css] dedup guard), so reload + style
    // cleanup would delete the only style tag and the page would fall back
    // to the default look while the badge still claims "trying on".
    await expect(c.tryOn(entry('xp'))).resolves.toBe(true)
    expect(c.trying?.id).toBe('xp')
    expect(document.body.getAttribute('data-dsh-xp')).toBe('')
    expect(document.querySelector('style[data-plugin-css*="xp.module.css"]')).not.toBeNull()

    c.exit()
    expect(document.body.hasAttribute('data-dsh-xp')).toBe(false)
    expect(document.querySelector('style[data-plugin-css*="xp.module.css"]')).toBeNull()
  })

  it('re-trying the official preview while it is live is a no-op', async () => {
    const active = entry('whale-song')
    window.__DSH_BOOT__ = { entries: [{ id: active.package }] }
    document.body.setAttribute(active.bodyAttr, '')

    const c = controller()
    c.tryOnOfficial()
    expect(c.tryingOfficial).toBe(true)

    c.tryOnOfficial()
    expect(c.tryingOfficial).toBe(true)

    c.exit()
    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
  })

  it('notifies subscribers when a skin preview switches to the official look', async () => {
    const c = controller()
    const seen: Array<string | null> = []
    c.subscribe(() => seen.push(c.trying?.id ?? null))

    await c.tryOn(entry('xp'))
    expect(seen).toEqual(['xp'])

    c.tryOnOfficial()
    expect(seen).toEqual(['xp', null])

    await c.tryOn(entry('miku'))
    expect(seen).toEqual(['xp', null, 'miku'])

    c.exit()
    expect(seen).toEqual(['xp', null, 'miku', null])
  })
})

describe('TryOnController commit (hot swap, #359)', () => {
  // Hot mounts are never restored by design, so each test must dispose its
  // own commit before the jsdom environment goes away — otherwise the skin
  // bundles' MutationObservers keep firing into later tests and teardown.
  const committed: TryOnController[] = []
  const tracked = (c: TryOnController): TryOnController => {
    committed.push(c)
    return c
  }
  afterEach(async () => {
    while (committed.length > 0) {
      const c = committed.pop()
      if (c !== undefined) await c.commit(null).catch(() => {})
    }
  })

  it('recognizes an active skin supplied by the dynamic roster', () => {
    const custom: SkinCenterEntry = {
      id: 'custom-wallpaper',
      name: '自定义壁纸',
      nameEn: 'Custom Wallpaper',
      tagline: 'Local wallpaper skin',
      accent: '#336699',
      bodyAttr: 'data-dsh-custom-wallpaper',
      package: '@local/dsh-client-ui-skin-custom-wallpaper',
    }
    window.__DSH_BOOT__ = { entries: [{ id: custom.package }] }

    expect(activeSkinEntry([custom])).toBe(custom)
  })

  it('keeps a dynamically supplied skin active after a hot commit', async () => {
    const custom: SkinCenterEntry = {
      id: 'custom-wallpaper',
      name: '自定义壁纸',
      nameEn: 'Custom Wallpaper',
      tagline: 'Local wallpaper skin',
      accent: '#336699',
      bodyAttr: 'data-dsh-custom-wallpaper',
      package: '@local/dsh-client-ui-skin-custom-wallpaper',
    }
    const c = tracked(new TryOnController({
      loadBundle: async target => {
        window.__ModuleLoader__?.load({
          id: target.package,
          factory: () => ({
            apply(ctx: { effect(register: () => () => void): void }) {
              document.body.setAttribute(target.bodyAttr, '')
              ctx.effect(() => () => { document.body.removeAttribute(target.bodyAttr) })
            },
          }),
        })
      },
    }))
    c.setEntries([custom])

    await c.commit(custom)

    expect(document.body.getAttribute(custom.bodyAttr)).toBe('')
    expect(activeSkinEntry()).toBe(custom)
  })

  it('mounts the applied skin in place and flips the active marker', async () => {
    const active = entry('whale-song')
    const target = entry('xp')
    window.__DSH_BOOT__ = { entries: [{ id: active.package }] }
    document.body.setAttribute(active.bodyAttr, '')

    const c = tracked(controller())
    await c.commit(target)
    expect(document.body.hasAttribute(active.bodyAttr)).toBe(false)
    expect(document.body.getAttribute(target.bodyAttr)).toBe('')
    expect(activeSkinEntry()?.package).toBe(target.package)
  })

  it('is a no-op when the target already drives the page', async () => {
    const active = entry('xp')
    window.__DSH_BOOT__ = { entries: [{ id: active.package }] }
    document.body.setAttribute(active.bodyAttr, '')
    let loads = 0
    const c = tracked(new TryOnController({
      loadBundle: async () => { loads += 1 },
    }))
    await c.commit(active)
    expect(loads).toBe(0)
    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
    expect(activeSkinEntry()?.package).toBe(active.package)
  })

  it('commits the official stock look by retracting without mounting', async () => {
    const active = entry('whale-song')
    window.__DSH_BOOT__ = { entries: [{ id: active.package }] }
    document.body.setAttribute(active.bodyAttr, '')

    const c = tracked(controller())
    await c.commit(null)
    expect(document.body.hasAttribute(active.bodyAttr)).toBe(false)
    expect(activeSkinEntry()).toBeUndefined()
  })

  it('disposes the previous hot mount on a second commit', async () => {
    window.__DSH_BOOT__ = { entries: [] }
    const c = tracked(controller())
    await c.commit(entry('xp'))
    expect(document.body.getAttribute('data-dsh-xp')).toBe('')
    await c.commit(entry('matrix'))
    expect(document.body.hasAttribute('data-dsh-xp')).toBe(false)
    expect(document.body.getAttribute('data-dsh-matrix')).toBe('')
    expect(activeSkinEntry()?.package).toBe(entry('matrix').package)
  })

  it('keeps the incumbent intact when the target bundle fails to load', async () => {
    const active = entry('whale-song')
    window.__DSH_BOOT__ = { entries: [{ id: active.package }] }
    document.body.setAttribute(active.bodyAttr, '')
    const c = tracked(new TryOnController({
      loadBundle: async () => { throw new Error('network down') },
    }))
    await expect(c.commit(entry('xp'))).rejects.toThrow('network down')
    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
    expect(activeSkinEntry()?.package).toBe(active.package)
  })
})
