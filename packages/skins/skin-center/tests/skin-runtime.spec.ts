/**
 * Client runtime tests: decoration layers, semantic adapter, skin controller
 * (jsdom). Pins the activation lifecycle semantics of issue #506.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import { createEffectLedger } from '../src/client/runtime/effect-ledger.ts'
import {
  buildBackgroundMedia,
  ensureDecorationLayers,
  setLayerContent,
} from '../src/client/runtime/decoration-layers.ts'
import { createSemanticAdapter } from '../src/client/runtime/semantic-adapter.ts'
import { createSkinController } from '../src/client/runtime/skin-controller.ts'
import type { ControllerSkinEntry } from '../src/client/runtime/skin-controller.ts'

const hookedEntry = {
    manifest: {
      id: 'hooked',
      contributes: { stylesheet: 'skin.css' },
      facets: { client: { entry: 'hooks.mjs', apiVersion: 'x-org.linxin666.skin-center/v1alpha1' } },
    },
  } as ControllerSkinEntry

function entryFor(id: string, extra: Record<string, unknown> = {}): ControllerSkinEntry {
  return {
    manifest: {
      id,
      contributes: { stylesheet: 'skin.css', ...extra },
    },
  } as ControllerSkinEntry
}

/** The skin background art currently painted in the background decoration layer. */
function backgroundImgSrc(): string {
  const layer = document.querySelector<HTMLElement>('[data-dsh-skin-layer="background"]')
  return layer?.querySelector('img')?.getAttribute('src') ?? ''
}

describe('decoration layers', () => {
  it('ensures six non-interactive layers idempotently', () => {
    const layers = ensureDecorationLayers(document)
    expect(Object.keys(layers)).toHaveLength(6)
    for (const el of Object.values(layers)) {
      expect(el.style.pointerEvents).toBe('none')
    }
    const again = ensureDecorationLayers(document)
    expect(again.background).toBe(layers.background)
  })

  it('setLayerContent teardown removes exactly its nodes, idempotently', () => {
    const layers = ensureDecorationLayers(document)
    const node = document.createElement('div')
    const teardown = setLayerContent(layers.top, [node])
    expect(layers.top.contains(node)).toBe(true)
    teardown()
    teardown()
    expect(layers.top.contains(node)).toBe(false)
  })

  it('builds image media with scrim', () => {
    const nodes = buildBackgroundMedia(document, { type: 'image', src: 'assets/bg.jpg', scrim: '#0008' }, '/x/skins/h')
    expect(nodes).toHaveLength(2)
    expect((nodes[0] as HTMLImageElement).src).toContain('/x/skins/h/assets/bg.jpg')
  })
})

describe('semantic adapter', () => {
  it('stamps surfaces and parts on existing and added nodes', async () => {
    document.body.innerHTML = `
      <div data-slot="sidebar"></div>
      <div data-chat-flow-kind="message"></div>
    `
    const adapter = createSemanticAdapter(document)
    adapter.start()
    expect(document.querySelector('[data-slot="sidebar"]')!.getAttribute('data-dsh-surface')).toBe('sidebar')
    expect(document.querySelector('[data-chat-flow-kind]')!.getAttribute('data-dsh-part')).toBe('message-row')

    const added = document.createElement('div')
    added.setAttribute('data-turn-tail', '')
    document.body.appendChild(added)
    await new Promise((r) => setTimeout(r, 0))
    expect(added.getAttribute('data-dsh-part')).toBe('turn-tail')
    adapter.stop()
  })

  it('tags plugin roots', () => {
    document.body.innerHTML = '<div data-dsh-ssh-view></div>'
    const adapter = createSemanticAdapter(document)
    adapter.start()
    expect(document.querySelector('[data-dsh-ssh-view]')!.getAttribute('data-dsh-plugin')).toBe('ssh')
    adapter.stop()
  })

  it('reports unmatched rules as diagnostics without throwing', () => {
    document.body.innerHTML = '<div></div>'
    const adapter = createSemanticAdapter(document)
    adapter.start()
    const diag = adapter.diagnostics()
    expect(diag.unmatchedRules.length).toBeGreaterThan(0)
    adapter.stop()
  })
})

describe('skin controller', () => {
  function harness(options: {
    hooks?: Record<string, unknown>
    failFetchFor?: string[]
    persist?: (id: string | null) => Promise<void>
  } = {}) {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-dsh-skin')
    const ledger = createEffectLedger()
    const loadStylesheet = vi.fn(async (href: string) => {
      for (const bad of options.failFetchFor ?? []) {
        if (href.includes(bad)) throw new Error(`load ${href} -> 500`)
      }
      // Mirror the default loader's DOM effect so trackStylesheet finds it.
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    })
    const errors: string[] = []
    const controller = createSkinController({
      doc: document,
      ledger,
      loadStylesheet,
      importHooks: async () => options.hooks,
      persist: options.persist ?? (async () => {}),
      onError: (m) => errors.push(m),
    })
    return { ledger, controller, errors, loadStylesheet }
  }

  it('applies a skin: styles, attribute, persistence', async () => {
    const persist = vi.fn(async () => {})
    const { controller } = harness({ persist })
    const result = await controller.switchTo('harbor', entryFor('harbor', { patches: 'patches.css' }))
    expect(result).toBe('harbor')
    expect(controller.active).toBe('harbor')
    expect(document.documentElement.getAttribute('data-dsh-skin')).toBe('harbor')
    const links = document.head.querySelectorAll('link[rel="stylesheet"]')
    expect(links).toHaveLength(2)
    expect(persist).toHaveBeenCalledWith('harbor')
  })

  it('switching replaces the old activation completely', async () => {
    const { controller, ledger } = harness()
    await controller.switchTo('harbor', entryFor('harbor'))
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1)
    await controller.switchTo('matrix', entryFor('matrix'))
    expect(document.documentElement.getAttribute('data-dsh-skin')).toBe('matrix')
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1)
    expect(ledger.entries().some((e) => e.kind === 'release')).toBe(true)
  })

  it('switch to stock removes styles and the attribute', async () => {
    const { controller } = harness()
    await controller.switchTo('harbor', entryFor('harbor'))
    await controller.switchTo(null, null)
    expect(controller.active).toBeNull()
    expect(document.documentElement.hasAttribute('data-dsh-skin')).toBe(false)
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0)
  })

  it('a failed fetch leaves the previous skin intact', async () => {
    const { controller, errors } = harness({ failFetchFor: ['matrix'] })
    await controller.switchTo('harbor', entryFor('harbor'))
    const before = document.head.querySelectorAll('link[rel="stylesheet"]').length
    const result = await controller.switchTo('matrix', entryFor('matrix'))
    expect(result).toBe('harbor')
    expect(document.documentElement.getAttribute('data-dsh-skin')).toBe('harbor')
    expect(document.head.querySelectorAll('link[rel="stylesheet"]').length).toBe(before)
    expect(errors.some((m) => m.includes('matrix'))).toBe(true)
  })

  it('latest request wins: a stale in-flight switch is discarded', async () => {
    document.head.innerHTML = ''
    document.documentElement.removeAttribute('data-dsh-skin')
    const ledger = createEffectLedger()
    let resolveSlow!: () => void
    const slow = new Promise<void>((r) => { resolveSlow = r })
    const loadStylesheet = vi.fn((href: string) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
      if (href.includes('slow-skin')) return slow
      return Promise.resolve()
    })
    const controller = createSkinController({
      doc: document,
      ledger,
      loadStylesheet,
      persist: async () => {},
    })
    const first = controller.switchTo('slow-skin', entryFor('slow-skin'))
    const second = controller.switchTo('fast-skin', entryFor('fast-skin'))
    resolveSlow()
    await Promise.all([first, second])
    expect(controller.active).toBe('fast-skin')
    expect(document.documentElement.getAttribute('data-dsh-skin')).toBe('fast-skin')
    const links = Array.from(document.head.querySelectorAll('link[rel="stylesheet"]'))
    expect(links.some((l) => l.href.includes('slow-skin'))).toBe(false)
  })

  it('hooks failure keeps the static skin and reports the error', async () => {
    const { controller, errors } = harness({
      hooks: { default: () => ({ apply() { throw new Error('boom') } }) },
    })
    const result = await controller.switchTo('hooked', hookedEntry)
    expect(result).toBe('hooked')
    expect(document.documentElement.getAttribute('data-dsh-skin')).toBe('hooked')
    expect(errors.some((m) => m.includes('hooks failed'))).toBe(true)
  })

  it('hooks onCleanup runs on the next switch', async () => {
    const cleanup = vi.fn()
    const { controller } = harness({
      hooks: {
        default: () => ({
          apply(ctx: { onCleanup: (fn: () => void) => void }) { ctx.onCleanup(cleanup) },
        }),
      },
    })
    await controller.switchTo('hooked', hookedEntry)
    expect(cleanup).not.toHaveBeenCalled()
    await controller.switchTo(null, null)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('try-on previews without persisting and exit restores the committed skin', async () => {
    const persist = vi.fn(async () => {})
    const { controller } = harness({ persist })
    await controller.switchTo('harbor', entryFor('harbor'))
    expect(persist).toHaveBeenCalledTimes(1)

    await controller.tryOn('matrix', entryFor('matrix'))
    expect(controller.getState()).toEqual({ active: 'matrix', trying: 'matrix', previewing: true })
    expect(document.documentElement.getAttribute('data-dsh-skin')).toBe('matrix')
    // Try-on never persists.
    expect(persist).toHaveBeenCalledTimes(1)

    await controller.exitTryOn()
    expect(controller.getState()).toEqual({ active: 'harbor', trying: null, previewing: false })
    expect(document.documentElement.getAttribute('data-dsh-skin')).toBe('harbor')
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('committing during a preview clears the trying state', async () => {
    const { controller } = harness()
    await controller.tryOn('matrix', entryFor('matrix'))
    expect(controller.getState().trying).toBe('matrix')
    expect(controller.getState().previewing).toBe(true)
    await controller.switchTo('matrix', entryFor('matrix'))
    expect(controller.getState()).toEqual({ active: 'matrix', trying: null, previewing: false })
  })

  it('getState returns a cached snapshot (React useSyncExternalStore contract)', async () => {
    const { controller } = harness()
    const first = controller.getState()
    expect(controller.getState()).toBe(first)
    await controller.switchTo('harbor', entryFor('harbor'))
    const second = controller.getState()
    expect(second).not.toBe(first)
    expect(second).toEqual({ active: 'harbor', trying: null, previewing: false })
    expect(controller.getState()).toBe(second)
  })

  it('subscribe emits on every state transition', async () => {
    const { controller } = harness()
    const seen: Array<{ active: string | null; trying: string | null; previewing: boolean }> = []
    controller.subscribe(() => seen.push(controller.getState()))
    await controller.switchTo('harbor', entryFor('harbor'))
    await controller.tryOn('matrix', entryFor('matrix'))
    await controller.exitTryOn()
    expect(seen.length).toBeGreaterThanOrEqual(3)
    expect(seen.at(-1)).toEqual({ active: 'harbor', trying: null, previewing: false })
  })

  it('a refresh with an unchanged suppression verdict is a no-op (boot race)', async () => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-dsh-skin')
    const ledger = createEffectLedger()
    const loadStylesheet = async (href: string) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    }
    const mediaEntry = {
      manifest: {
        id: 'media-skin',
        contributes: {
          stylesheet: 'skin.css',
          backgroundMedia: { light: { type: 'image' as const, src: 'assets/bg.jpg' } },
        },
      },
    } as ControllerSkinEntry
    const controller = createSkinController({
      doc: document,
      ledger,
      loadStylesheet,
      persist: async () => {},
      // Suppression is false from creation; the wallpaper scope publishes
      // during boot, but a same-verdict refresh must not re-switch and
      // wipe the just-applied background.
      suppressBackgroundMedia: () => false,
    })
    await controller.switchTo('media-skin', mediaEntry)
    expect(backgroundImgSrc()).toContain('bg.jpg')
    await controller.refresh()
    expect(backgroundImgSrc()).toContain('bg.jpg')
    expect(controller.active).toBe('media-skin')
  })

  it('suppressBackgroundMedia wins over the manifest background (WE priority)', async () => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-dsh-skin')
    const ledger = createEffectLedger()
    let suppressed = false
    const loadStylesheet = async (href: string) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    }
    const mediaEntry = {
      manifest: {
        id: 'media-skin',
        contributes: {
          stylesheet: 'skin.css',
          backgroundMedia: { light: { type: 'image' as const, src: 'assets/bg.jpg' } },
        },
      },
    } as ControllerSkinEntry
    const controller = createSkinController({
      doc: document,
      ledger,
      loadStylesheet,
      persist: async () => {},
      suppressBackgroundMedia: () => suppressed,
    })
    await controller.switchTo('media-skin', mediaEntry)
    expect(backgroundImgSrc()).toContain('bg.jpg')
    expect(document.body.getAttribute('data-dsh-backdrop-active')).toBe('true')

    // The wallpaper bridge turns on: refresh drops the manifest media.
    suppressed = true
    await controller.refresh()
    expect(backgroundImgSrc()).toBe('')
    expect(document.body.hasAttribute('data-dsh-backdrop-active')).toBe(false)
    expect(controller.active).toBe('media-skin')

    // And back: refresh repaints it.
    suppressed = false
    await controller.refresh()
    expect(backgroundImgSrc()).toContain('bg.jpg')
    expect(document.body.getAttribute('data-dsh-backdrop-active')).toBe('true')
  })

  it('disposing an older activation never wipes a newer activation\'s layer content', async () => {
    const { controller } = harness()
    const mediaEntry = {
      manifest: {
        id: 'media-skin',
        contributes: {
          stylesheet: 'skin.css',
          backgroundMedia: { light: { type: 'image' as const, src: 'assets/bg.jpg' } },
        },
      },
    } as ControllerSkinEntry
    await controller.switchTo('media-skin', mediaEntry)
    expect(backgroundImgSrc()).toContain('bg.jpg')
    // Re-activation (the refresh path): the OLD activation's dispose must
    // restore only its own snapshot — the newer activation's layer paint
    // survives because it re-paints after the restore is skipped as stale.
    await controller.switchTo('media-skin', mediaEntry)
    expect(backgroundImgSrc()).toContain('bg.jpg')
    await controller.switchTo(null, null)
    expect(backgroundImgSrc()).toBe('')
  })

  it('theme flips repaint the background media with the matching variant', async () => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-dsh-skin')
    const ledger = createEffectLedger()
    const loadStylesheet = async (href: string) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    }
    let theme: 'light' | 'dark' = 'light'
    let themeListener: ((theme: 'light' | 'dark') => void) | null = null
    const mediaEntry = {
      manifest: {
        id: 'media-skin',
        contributes: {
          stylesheet: 'skin.css',
          backgroundMedia: {
            light: { type: 'image' as const, src: 'assets/light.jpg' },
            dark: { type: 'image' as const, src: 'assets/dark.png' },
          },
        },
      },
    } as ControllerSkinEntry
    const controller = createSkinController({
      doc: document,
      ledger,
      loadStylesheet,
      persist: async () => {},
      themeGet: () => theme,
      themeSubscribe: (listener) => {
        themeListener = listener
        return () => { themeListener = null }
      },
    })
    await controller.switchTo('media-skin', mediaEntry)
    expect(backgroundImgSrc()).toContain('light.jpg')

    // Flip to dark: the controller must swap the painted variant live.
    theme = 'dark'
    themeListener?.('dark')
    expect(backgroundImgSrc()).toContain('dark.png')
    expect(document.body.getAttribute('data-dsh-backdrop-active')).toBe('true')

    // Flip back to light.
    theme = 'light'
    themeListener?.('light')
    expect(backgroundImgSrc()).toContain('light.jpg')
  })

  it('theme repaint is a no-op when no skin or no backgroundMedia is active', async () => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-dsh-skin')
    const ledger = createEffectLedger()
    const loadStylesheet = async (href: string) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    }
    let themeListener: ((theme: 'light' | 'dark') => void) | null = null
    const plainEntry = entryFor('plain', {})
    const mediaEntry = {
      manifest: {
        id: 'media-skin',
        contributes: {
          stylesheet: 'skin.css',
          backgroundMedia: { light: { type: 'image' as const, src: 'assets/bg.jpg' } },
        },
      },
    } as ControllerSkinEntry
    const controller = createSkinController({
      doc: document,
      ledger,
      loadStylesheet,
      persist: async () => {},
      themeSubscribe: (listener) => {
        themeListener = listener
        return () => { themeListener = null }
      },
    })
    // No skin yet: a theme flip must not throw or paint anything.
    expect(() => themeListener?.('dark')).not.toThrow()
    expect(backgroundImgSrc()).toBe('')

    // A skin without backgroundMedia: theme flip stays a no-op.
    await controller.switchTo('plain', plainEntry)
    themeListener?.('dark')
    expect(backgroundImgSrc()).toBe('')

    // With media, then back to stock: flip again stays a no-op.
    await controller.switchTo('media-skin', mediaEntry)
    expect(backgroundImgSrc()).toContain('bg.jpg')
    await controller.switchTo(null, null)
    themeListener?.('dark')
    expect(backgroundImgSrc()).toBe('')
  })

  it('drives --dsh-skin-scrim with the background media (whale-mom contract)', async () => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.body.removeAttribute('style')
    document.documentElement.removeAttribute('data-dsh-skin')
    const ledger = createEffectLedger()
    const loadStylesheet = async (href: string) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    }
    const mediaEntry = {
      manifest: {
        id: 'media-skin',
        contributes: {
          stylesheet: 'skin.css',
          backgroundMedia: { light: { type: 'image' as const, src: 'assets/bg.jpg' } },
        },
      },
    } as ControllerSkinEntry
    const controller = createSkinController({
      doc: document,
      ledger,
      loadStylesheet,
      persist: async () => {},
      suppressBackgroundMedia: () => false,
    })
    expect(document.body.style.getPropertyValue('--dsh-skin-scrim')).toBe('')
    await controller.switchTo('media-skin', mediaEntry)
    expect(document.body.style.getPropertyValue('--dsh-skin-scrim')).toBe('1')
    await controller.switchTo(null, null)
    expect(document.body.style.getPropertyValue('--dsh-skin-scrim')).toBe('0')
  })

  it('marks the unified backdrop-active marker and installs the shared composer-seat neutralizer while media is mounted (#777)', async () => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-dsh-skin')
    const ledger = createEffectLedger()
    const loadStylesheet = async (href: string) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    }
    const mediaEntry = {
      manifest: {
        id: 'media-skin',
        contributes: {
          stylesheet: 'skin.css',
          backgroundMedia: { light: { type: 'image' as const, src: 'assets/bg.jpg' } },
        },
      },
    } as ControllerSkinEntry
    const controller = createSkinController({
      doc: document,
      ledger,
      loadStylesheet,
      persist: async () => {},
    })
    await controller.switchTo('media-skin', mediaEntry)
    expect(document.body.getAttribute('data-dsh-backdrop-active')).toBe('true')
    expect(document.documentElement.getAttribute('data-dsh-backdrop-active')).toBe('true')
    const neutralizer = document.head.querySelector('style[data-dsh-scene-neutralizer]')
    expect(neutralizer).not.toBeNull()
    expect(neutralizer?.textContent).toContain('html[data-dsh-backdrop-active] [data-composer-seat]::before')
    // A plain skin (no background media) must never mark a backdrop.
    await controller.switchTo(null, null)
    expect(document.body.hasAttribute('data-dsh-backdrop-active')).toBe(false)
    expect(document.documentElement.hasAttribute('data-dsh-backdrop-active')).toBe(false)
  })

  it('shutdown disposes the activation and clears the attribute', async () => {
    const { controller } = harness()
    await controller.switchTo('harbor', entryFor('harbor'))
    controller.shutdown()
    expect(controller.active).toBeNull()
    expect(document.documentElement.hasAttribute('data-dsh-skin')).toBe(false)
    expect(document.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0)
  })

  it('refresh during in-flight boot switchTo does not stale or clobber the activation (#604)', async () => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.setAttribute('data-dsh-skin', 'miku')
    const ledger = createEffectLedger()
    let resolveStylesheet!: () => void
    const stylesheetPromise = new Promise<void>((r) => { resolveStylesheet = r })
    const loadStylesheet = vi.fn(async (href: string) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
      await stylesheetPromise
    })
    let suppressed = false
    const controller = createSkinController({
      doc: document,
      ledger,
      loadStylesheet,
      suppressBackgroundMedia: () => suppressed,
      persist: async () => {},
    })

    // Boot begins switchTo('miku', entry) while loadStylesheet is pending
    const bootSwitch = controller.switchTo('miku', entryFor('miku'))

    // While loadStylesheet is still pending, wallpaper inventory resolves and triggers refresh()
    suppressed = true
    const refreshResult = await controller.refresh()
    expect(refreshResult).toBe('miku')

    // Finish the stylesheet load
    resolveStylesheet()
    await bootSwitch

    // Stylesheet link and attributes remain installed, not destroyed as stale
    expect(controller.active).toBe('miku')
    expect(document.documentElement.getAttribute('data-dsh-skin')).toBe('miku')
    const links = document.head.querySelectorAll('link[rel="stylesheet"]')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toContain('miku')
  })

  it('fail-closed on initial boot switch failure resets active state to null', async () => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.documentElement.setAttribute('data-dsh-skin', 'broken-skin')
    const ledger = createEffectLedger()
    const loadStylesheet = vi.fn(async () => {
      throw new Error('404 stylesheet not found')
    })
    const errors: string[] = []
    const controller = createSkinController({
      doc: document,
      ledger,
      loadStylesheet,
      onError: (m) => errors.push(m),
    })

    expect(controller.active).toBe('broken-skin')
    await controller.switchTo('broken-skin', entryFor('broken-skin'))

    // Controller active state, committed state, and html attribute reset to null
    expect(controller.active).toBeNull()
    expect(controller.getState().active).toBeNull()
    expect(document.documentElement.hasAttribute('data-dsh-skin')).toBe(false)
    expect(errors.some((m) => m.includes('broken-skin'))).toBe(true)
  })
})

