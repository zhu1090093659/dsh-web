// @vitest-environment jsdom
/**
 * TryOnController regression tests: switching between skin try-ons must
 * never leave residue from the previous skin, and a skin whose apply()
 * throws mid-write must be rolled back completely (the 同花顺 bug: ths reads
 * the optional connection service via ctx.get(), which the try-on miniCtx
 * must answer with undefined — otherwise apply() crashes after writing the
 * body attribute, chrome and style tag, and the residue bleeds into every
 * later try-on).
 *
 * The registry carries metadata only (bundles are served on demand by the
 * host route /api/skin-center/bundle/<id>), so the tests inject a loadBundle
 * stub that executes the REAL bundle text — read from the committed build
 * artifact packages/skins/<id>/lib/client.js — exactly like the host route's
 * script would: the text registers its factory on window.__ModuleLoader__
 * (the production path uses a same-origin script tag, no eval; the stub uses
 * eval because jsdom does not fetch external scripts).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SKIN_CENTER_ENTRIES, type SkinCenterEntry } from '../src/client/generated/skins.ts'
import { TryOnController } from '../src/client/try-on.ts'

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
    const target = entry('qq98')
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
    const first = entry('qq98')
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

    await expect(c.tryOn(entry('qq98'))).resolves.toBe(true)
    await expect(c.tryOn(entry('xp'))).resolves.toBe(true)
    c.exit()

    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
    expect(document.body.hasAttribute(entry('qq98').bodyAttr)).toBe(false)
    expect(document.body.hasAttribute(entry('xp').bodyAttr)).toBe(false)
  })

  it('cancels a pending chained try-on without a late remount', async () => {
    const active = entry('whale-song')
    const first = entry('qq98')
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
    const first = entry('qq98')
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
    expect(document.querySelector('style[data-plugin-css*="qq98.module.css"]')).not.toBeNull()

    releaseSecond()
    await expect(staleSecond).resolves.toBe(false)
    expect(document.body.getAttribute(first.bodyAttr)).toBe('')
    expect(document.querySelector('style[data-plugin-css*="qq98.module.css"]')).not.toBeNull()
    expect(document.body.hasAttribute(second.bodyAttr)).toBe(false)

    c.exit()
    expect(document.body.getAttribute(active.bodyAttr)).toBe('')
  })

  it('cancels an initial load before a session exists', async () => {
    const active = entry('whale-song')
    const target = entry('qq98')
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
    expect(document.querySelector('style[data-plugin-css*="qq98.module.css"]')).toBeNull()
  })

  it('switches to the official preview while another preview is loading', async () => {
    const active = entry('whale-song')
    const first = entry('qq98')
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

  it('switching from ths try-on to another skin leaves no ths residue', async () => {
    const c = controller()

    await expect(c.tryOn(entry('ths'))).resolves.toBe(true)
    expect(document.body.getAttribute('data-dsh-ths')).toBe('')
    expect(document.querySelector('style[data-plugin-css*="ths.module.css"]')).not.toBeNull()

    await expect(c.tryOn(entry('qq98'))).resolves.toBe(true)
    expect(document.body.hasAttribute('data-dsh-ths')).toBe(false)
    expect(document.querySelector('style[data-plugin-css*="ths.module.css"]')).toBeNull()
    expect(document.body.querySelector('[class*="thsTitlebar"]')).toBeNull()
    expect(document.body.querySelector('[class*="thsStatusbar"]')).toBeNull()
    // qq98 try-on is live, so the title is qq98's — but never ths's.
    expect(document.title).not.toBe('同花顺 · DeepSeek 在线')
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
    await expect(c.tryOn(entry('qq98'))).resolves.toBe(true)
    expect(document.body.hasAttribute('data-dsh-bomb')).toBe(false)
    expect(document.querySelector('style[data-plugin-css*="qq98.module.css"]')).not.toBeNull()
  })

  it('re-try-on after exit re-registers the same skin cleanly', async () => {
    const c = controller()
    await expect(c.tryOn(entry('qq98'))).resolves.toBe(true)
    c.exit()
    expect(document.body.hasAttribute('data-dsh-retro')).toBe(false)
    expect(document.querySelector('style[data-plugin-css*="qq98.module.css"]')).toBeNull()
    // A second try-on of the same skin must work: the exit invalidated the
    // module record, so the next load registers a fresh factory (no
    // duplicate-registration throw).
    await expect(c.tryOn(entry('qq98'))).resolves.toBe(true)
    expect(document.body.getAttribute('data-dsh-retro')).toBe('')
  })
})