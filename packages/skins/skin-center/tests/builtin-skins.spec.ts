// @vitest-environment jsdom

/**
 * Built-in v2 skin acceptance tests (issue #506, M3).
 *
 * Two gates for every skin directory under skins/:
 *
 *  1. Catalog + CSS: the directory loads through loadSkinCatalog with zero
 *     diagnostics, its skin.json passes validateSkinManifestV2, and both
 *     skin.css / patches.css pass transformSkinCss (force-scoping +
 *     whitelist) without throwing.
 *  2. Hooks lifecycle: hooks.mjs (when present) imports with no top-level
 *     side effects, apply(ctx) does not throw against a jsdom
 *     SkinHooksContext double (six real decoration-layer divs, light
 *     theme, no-op subscribe), and after dispose + every registered
 *     cleanup the document contains no node the activation added, the
 *     body attributes are restored and the document title is back.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it, vi } from 'vitest'

import { transformSkinCss } from '../src/core/css-safety/transform.ts'
import { validateSkinManifestV2 } from '../src/core/manifest-v2/validate.ts'
import { loadSkinCatalog } from '../src/skin-repo.ts'

const SKINS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skins')
/** A path that never exists, so the catalog sees no user skins. */
const NO_USER_SKINS = join(tmpdir(), 'dsh-builtin-skins-spec-no-user-dir')

const LAYER_NAMES = ['background', 'ambient', 'top', 'bottom', 'sidebar', 'foreground']

const skinIds = readdirSync(SKINS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(SKINS_DIR, d.name, 'skin.json')))
  .map((d) => d.name)
  .sort()

const hookSkinIds = skinIds.filter((id) => existsSync(join(SKINS_DIR, id, 'hooks.mjs')))

function rootThemeTokens(css: string): string[] {
  const tokens = new Set<string>()
  for (const block of css.matchAll(/(?:^|\n)\s*(?::root|html)(?:\s*,[^{]+)?\s*\{([^}]*)\}/g)) {
    const declarations = (block[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of declarations.matchAll(/(?:^|[;{])\s*(--dsw-(?:alias|specific)-[\w-]+)\s*:/gm)) {
      const token = match[1]
      if (token !== undefined) tokens.add(token)
    }
  }
  return [...tokens]
}

function expectRootThemeTokensBodyScoped(css: string, code: string, skinId: string): void {
  const scope = `html[data-dsh-skin="${skinId}"]`
  for (const token of rootThemeTokens(css)) {
    const reset = code.indexOf(`${token}: initial;`)
    const bodyCloneStart = code.indexOf(`${scope} body {`, reset)
    const bodyClone = code.slice(bodyCloneStart, code.indexOf('}', bodyCloneStart) + 1)
    expect(reset, `${skinId}: ${token} root reset`).toBeGreaterThanOrEqual(0)
    expect(bodyCloneStart, `${skinId}: ${token} body clone`).toBeGreaterThan(reset)
    expect(bodyClone, `${skinId}: ${token} cloned token`).toContain(`${token}:`)
  }
}

function declarationsForSelector(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  const out = new Map<string, string>()
  const body = match?.[1]?.replace(/\/\*[\s\S]*?\*\//g, '') ?? ''
  for (const declaration of body.matchAll(/(--dsw-[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = declaration[1]
    const value = declaration[2]
    if (name !== undefined && value !== undefined) out.set(name, value.trim())
  }
  return out
}

function relativeLuminance(hex: string): number {
  const match = hex.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i)
  if (match?.[1] === undefined) throw new Error(`unsupported color ${hex}`)
  const channel = (offset: number): number => {
    const raw = Number.parseInt(match[1]!.slice(offset, offset + 2), 16) / 255
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(foreground)
  const bg = relativeLuminance(background)
  const lighter = Math.max(fg, bg)
  const darker = Math.min(fg, bg)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('built-in v2 skins: catalog and stylesheets', () => {
  it('loads the catalog with no diagnostics and every skin present', () => {
    const catalog = loadSkinCatalog({ builtinDir: SKINS_DIR, userDir: NO_USER_SKINS })
    expect(catalog.diagnostics).toEqual([])
    expect(catalog.skins.map((s) => s.manifest.id).sort()).toEqual(skinIds)
  })

  it('every built-in skin satisfies the primary-action token contract', () => {
    const catalog = loadSkinCatalog({ builtinDir: SKINS_DIR, userDir: NO_USER_SKINS })
    const offenders = catalog.skins
      .map((skin) => ({
        id: skin.manifest.id,
        warnings: skin.warnings.filter((warning) => warning.startsWith('primary action')),
      }))
      .filter((skin) => skin.warnings.length > 0)
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([])
  })

  for (const id of skinIds) {
    it(id + ': manifest validates and stylesheets transform', () => {
      const dir = join(SKINS_DIR, id)
      const raw = JSON.parse(readFileSync(join(dir, 'skin.json'), 'utf8'))
      const result = validateSkinManifestV2(raw)
      expect(result.ok, result.errors.join('; ')).toBe(true)
      const manifest = result.manifest
      expect(manifest).toBeDefined()
      if (!manifest) return
      const css = readFileSync(join(dir, manifest.contributes.stylesheet), 'utf8')
      const transformed = transformSkinCss(css, { skinId: id, filename: 'skin.css' })
      expectRootThemeTokensBodyScoped(css, transformed.code, id)
      if (manifest.contributes.patches !== undefined) {
        const patches = readFileSync(join(dir, manifest.contributes.patches), 'utf8')
        const transformedPatches = transformSkinCss(patches, { skinId: id, filename: 'patches.css' })
        expectRootThemeTokensBodyScoped(patches, transformedPatches.code, id)
      }
    })
  }

  it('mint: tooltip foreground keeps light and dark mode popovers readable (#924)', () => {
    const css = readFileSync(join(SKINS_DIR, 'mint', 'skin.css'), 'utf8')
    for (const selector of [':root', 'body[data-ds-dark-theme]']) {
      const tokens = declarationsForSelector(css, selector)
      const bg = tokens.get('--dsw-alias-tooltip-bg')
      const fg = tokens.get('--dsw-alias-tooltip-fg')
      expect(fg, `${selector}: tooltip foreground token`).toBeDefined()
      expect(bg, `${selector}: tooltip background token`).toBeDefined()
      expect(contrastRatio(fg!, bg!), `${selector}: tooltip contrast`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('built-in v2 skins: hooks lifecycle', () => {
  beforeAll(() => {
    // Hermetic: hooks must never reach the network from a unit test. Every
    // data path in the built-in hooks fails safe on a rejected fetch.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')))
  })

  /** Snapshot of every body attribute (name -> value) for restore checks. */
  const bodyAttributes = () => {
    const out = new Map()
    for (const attr of document.body.attributes) out.set(attr.name, attr.value)
    return out
  }

  for (const id of hookSkinIds) {
    it(id + ': import is side-effect free and apply/cleanup leaves nothing behind', async () => {
      // Six real decoration-layer divs, as the controller mounts them.
      const layers = {}
      for (const name of LAYER_NAMES) {
        const el = document.createElement('div')
        el.setAttribute('data-dsh-skin-layer', name)
        el.setAttribute('aria-hidden', 'true')
        document.body.append(el)
        layers[name] = el
      }

      // Prime the <title> element: jsdom creates it lazily on the first
      // document.title write, and the skins that pin a title would
      // otherwise leave a "new" node behind.
      document.title = 'builtin-skins-spec'
      const beforeNodes = new Set(document.querySelectorAll('*'))
      const beforeTitle = document.title
      const beforeBodyAttrs = bodyAttributes()

      const mod = await import(pathToFileURL(join(SKINS_DIR, id, 'hooks.mjs')).href)
      expect(typeof mod.default).toBe('function')
      // Importing must not have touched the DOM (contract: no top-level
      // side effects).
      expect([...document.querySelectorAll('*')].every((el) => beforeNodes.has(el))).toBe(true)

      const hooks = mod.default()
      const cleanups = []
      const ctx = {
        skinId: id,
        scopeAttr: id,
        assetBase: '/api/skin-center/v2/skins/' + id,
        layers,
        theme: {
          get: () => 'light',
          subscribe: () => () => {},
        },
        onCleanup: (fn) => {
          cleanups.push(fn)
        },
      }

      expect(() => hooks.apply(ctx)).not.toThrow()

      // Dispose path: optional dispose() first, then the cleanups in
      // reverse registration order (the controller's order). Cleanup must
      // be idempotent — run the whole set a second time.
      expect(() => hooks.dispose?.()).not.toThrow()
      for (const cleanup of [...cleanups].reverse()) cleanup()
      for (const cleanup of cleanups) cleanup()

      // No node the activation added may survive teardown.
      const survivors = [...document.querySelectorAll('*')].filter((el) => !beforeNodes.has(el))
      expect(survivors.map((el) => el.outerHTML.slice(0, 120))).toEqual([])
      expect(document.title).toBe(beforeTitle)
      expect(bodyAttributes()).toEqual(beforeBodyAttrs)

      for (const name of LAYER_NAMES) layers[name].remove()
    })
  }
})
