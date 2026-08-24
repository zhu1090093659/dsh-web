/**
 * Focused tests for the Abyssal Maid Atelier (maid-atelier) skin port:
 * backgroundMedia wiring, character stage mounting, trim layers, and cleanup.
 * Exercises the real skins/maid-atelier/hooks.mjs in jsdom.
 */

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

import defineSkinHooks from '../skins/maid-atelier/hooks.mjs'

function maidAtelierSkinDir(): string {
  for (const base of [process.cwd(), path.resolve(process.cwd(), 'packages/skins/skin-center')]) {
    const dir = path.join(base, 'skins', 'maid-atelier')
    if (existsSync(path.join(dir, 'skin.json'))) return dir
  }
  throw new Error('cannot locate skins/maid-atelier directory')
}

function readManifest() {
  return JSON.parse(readFileSync(path.join(maidAtelierSkinDir(), 'skin.json'), 'utf8')) as {
    contributes: {
      backgroundMedia: {
        light: { type: string; src: string; scrim?: string }
        dark: { type: string; src: string; scrim?: string }
      }
    }
  }
}

function setup() {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.documentElement.setAttribute('data-dsh-skin', 'maid-atelier')
  const cleanups: Array<() => void> = []
  const theme = {
    get: () => (document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'),
    subscribe: () => () => {},
  }
  const ctx = {
    skinId: 'maid-atelier',
    scopeAttr: 'maid-atelier',
    assetBase: '/api/skin-center/v2/skins/maid-atelier',
    theme,
    onCleanup: (fn: () => void) => cleanups.push(fn),
  }
  const runCleanup = () => {
    for (const fn of cleanups.splice(0).reverse()) fn()
  }
  return { ctx, runCleanup, cleanups }
}

describe('maid-atelier: backgroundMedia manifest', () => {
  it('declares light and dark palace backgrounds in backgroundMedia', () => {
    const manifest = readManifest()
    const media = manifest.contributes.backgroundMedia
    expect(media).toBeDefined()
    expect(media.light.src).toBe('assets/maid-atelier-palace-day-v4.webp')
    expect(media.dark.src).toBe('assets/maid-atelier-palace-night-v4.webp')
    expect(media.light.scrim).toContain('linear-gradient')
    expect(media.dark.scrim).toContain('linear-gradient')

    const lightAsset = path.join(maidAtelierSkinDir(), media.light.src)
    const darkAsset = path.join(maidAtelierSkinDir(), media.dark.src)
    expect(existsSync(lightAsset)).toBe(true)
    expect(existsSync(darkAsset)).toBe(true)
  })
})

describe('maid-atelier hooks: character stage and decorative elements', () => {
  it('mounts character stage with left and right maids and removes them on cleanup', () => {
    const { ctx, runCleanup } = setup()
    defineSkinHooks().apply(ctx)

    const stage = document.body.querySelector('[data-skin-chrome="character-stage"]')
    expect(stage).not.toBeNull()
    const leftMaid = stage?.querySelector('[data-maid-character="left"]')
    const rightMaid = stage?.querySelector('[data-maid-character="right"]')
    expect(leftMaid).not.toBeNull()
    expect(rightMaid).not.toBeNull()

    // hooks does not write inline background-image to body (handled declaratively by backgroundMedia)
    expect(document.body.style.backgroundImage).toBe('')

    runCleanup()
    expect(document.body.querySelector('[data-skin-chrome="character-stage"]')).toBeNull()
    expect(document.head.querySelector('[data-skin-chrome="sidebar-width-rule"]')).toBeNull()
  })

  it('mounts trims, sidebar variables, and titlebar brand', () => {
    const { ctx, runCleanup } = setup()
    defineSkinHooks().apply(ctx)

    expect(document.body.querySelector('[data-skin-chrome="top-trim"]')).not.toBeNull()
    expect(document.body.querySelector('[data-skin-chrome="bottom-trim"]')).not.toBeNull()
    expect(document.body.style.getPropertyValue('--maid-top-trim-art')).toContain('maid-top-trim-tile-v1.webp')

    runCleanup()
    expect(document.body.querySelector('[data-skin-chrome="top-trim"]')).toBeNull()
    expect(document.body.querySelector('[data-skin-chrome="bottom-trim"]')).toBeNull()
    expect(document.body.style.getPropertyValue('--maid-top-trim-art')).toBe('')
  })
})
