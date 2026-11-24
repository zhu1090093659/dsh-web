/** @vitest-environment jsdom */

/**
 * Built client bundles hand compiled CSS Modules to DocumentStyles through
 * `window.__ModuleLoader__.load({ id, factory, meta })` instead of writing
 * `<style>` tags inside `factory`.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

interface LoadedRegistration {
  readonly id: string
  readonly factory: (require: (specifier: string) => unknown) => {
    readonly apply?: unknown
    readonly inject?: unknown
  }
  readonly meta?: () => {
    readonly stylesheets?: Readonly<Record<string, { readonly text: (ctx: { asset: (ref: string) => string }) => string }>>
  }
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Minimal platform stub sufficient for module-body materialization without DOM side effects. */
function makeExternalStub(): unknown {
  const fn = (): Record<string, unknown> => ({})
  const proxy: unknown = new Proxy(fn, {
    get(_target, prop) {
      if (prop === '__esModule') return true
      if (prop === Symbol.toPrimitive) return () => ''
      return proxy
    },
    apply() {
      return proxy
    },
    construct() {
      return {}
    },
  })
  return proxy
}

/** Evaluate one built client bundle against a recording loader. */
function evaluateBuiltBundle(bundleRelPath: string): LoadedRegistration {
  const bundleSource = readFileSync(resolve(REPO_ROOT, bundleRelPath), 'utf8')
  const captured: LoadedRegistration[] = []
  const loader = {
    load(entry: LoadedRegistration): void {
      captured.push(entry)
    },
  }
  const sandbox = {
    window: { __ModuleLoader__: loader },
    document,
    console,
    URL,
    TextEncoder,
    TextDecoder,
  }
  runInNewContext(bundleSource, sandbox)
  if (captured.length !== 1) {
    throw new Error(`Expected one __ModuleLoader__.load call in ${bundleRelPath}, got ${captured.length}`)
  }
  return captured[0]
}

describe('client bundle stylesheets meta contract', () => {
  it('developer building a CSS-Modules plugin gets meta().stylesheets registered without head mutations in factory', () => {
    // Given a built plugin bundle that imports CSS Modules (packages/dsh-market/lib/client.js)
    const beforeStyleCount = document.head.querySelectorAll('style').length
    const entry = evaluateBuiltBundle('packages/dsh-market/lib/client.js')
    const externalStub = makeExternalStub()

    // When the loader evaluates its meta descriptor and materializes its factory
    const meta = entry.meta?.()
    const stylesheets = meta?.stylesheets ?? {}
    const keys = Object.keys(stylesheets)
    const exportsObject = entry.factory(() => externalStub)

    // Then compiled CSS is exposed through deterministic repo-relative stylesheet entries
    expect(entry.id).toBe('@linxin666/dsh-client-ui-market')
    expect(typeof entry.meta).toBe('function')
    expect(keys).toEqual([
      'packages/dsh-market/src/client/market.module.css',
      'packages/dsh-market/src/client/settings-card.module.css',
    ])
    for (const key of keys) {
      const css = stylesheets[key].text({ asset: (reference) => `/assets/${reference}` })
      expect(css.length).toBeGreaterThan(20)
    }

    // And materializing the factory leaves document.head untouched (DocumentStyles owns DOM tags)
    expect(document.head.querySelectorAll('style')).toHaveLength(beforeStyleCount)
    expect(typeof exportsObject.apply).toBe('function')
    expect(Array.isArray(exportsObject.inject)).toBe(true)
  })

  it('developer building a CSS-free client bundle emits no unnecessary stylesheets metadata', () => {
    // Given a built bundle without CSS Modules (packages/dsh-web-all/lib/client.js)
    const entry = evaluateBuiltBundle('packages/dsh-web-all/lib/client.js')

    // When its registration is inspected
    // Then no meta function is needed and the bundle registers cleanly under its package id
    expect(entry.id).toBe('@linxin666/dsh-web-all')
    expect(entry.meta).toBeUndefined()
  })
})
