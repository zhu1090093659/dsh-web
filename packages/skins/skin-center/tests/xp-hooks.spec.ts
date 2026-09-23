/**
 * Focused tests for the Windows XP Luna (xp) skin hooks: window chrome
 * (titlebar, statusbar), Start button self-healing injection into the sidebar
 * footer strip, settings click delegation, and cleanup. Exercises the real
 * skins/xp/hooks.mjs in jsdom.
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

import defineSkinHooks from '../skins/xp/hooks.mjs'

function xpSkinDir(): string {
  for (const base of [process.cwd(), path.resolve(process.cwd(), 'packages/skins/skin-center')]) {
    const dir = path.join(base, 'skins', 'xp')
    if (existsSync(path.join(dir, 'skin.json'))) return dir
  }
  throw new Error('cannot locate skins/xp directory')
}

function setup() {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.documentElement.setAttribute('data-dsh-skin', 'xp')
  const cleanups: Array<() => void> = []
  const ctx = {
    skinId: 'xp',
    scopeAttr: 'xp',
    onCleanup: (fn: () => void) => cleanups.push(fn),
  }
  const runCleanup = () => {
    for (const fn of cleanups.splice(0).reverse()) fn()
  }
  return { ctx, runCleanup, cleanups }
}

describe('xp hooks: titlebar and statusbar chrome', () => {
  it('mounts titlebar, statusbar, and pinned document title, then cleans up', () => {
    const { ctx, runCleanup } = setup()
    document.title = 'Previous Title'
    defineSkinHooks().apply(ctx)

    const titlebar = document.body.querySelector('[data-skin-chrome="titlebar"]')
    expect(titlebar).not.toBeNull()
    expect(titlebar?.textContent).toContain('Windows XP · DeepSeek 在线')

    const statusbar = document.body.querySelector('[data-skin-chrome="statusbar"]')
    expect(statusbar).not.toBeNull()
    expect(statusbar?.textContent).toContain('就绪')
    expect(statusbar?.textContent).toContain('DeepSeek 在线')

    expect(document.title).toBe('Windows XP · DeepSeek 在线')

    const favicon = document.head.querySelector('link[rel="icon"]') as HTMLLinkElement | null
    expect(favicon).not.toBeNull()
    expect(favicon?.href).toContain('data:image/svg+xml')

    runCleanup()
    expect(document.body.querySelector('[data-skin-chrome="titlebar"]')).toBeNull()
    expect(document.body.querySelector('[data-skin-chrome="statusbar"]')).toBeNull()
    expect(document.head.querySelector('link[rel="icon"]')).toBeNull()
    expect(document.title).toBe('Previous Title')
  })
})

describe('xp hooks: Start button and Taskbar injection', () => {
  it('injects Start button and delegates click to settings button across nested sidebar layouts', () => {
    const { ctx, runCleanup } = setup()

    // Simulate modern DSH sidebar structure with nested columns and a settings button
    const sidebar = document.createElement('aside')
    sidebar.setAttribute('data-slot', 'sidebar')
    const footerStrip = document.createElement('div')
    const settingsBtn = document.createElement('button')
    settingsBtn.setAttribute('aria-label', '用户设置')
    settingsBtn.textContent = '设置'
    const clickSpy = vi.fn()
    settingsBtn.addEventListener('click', clickSpy)
    footerStrip.appendChild(settingsBtn)
    sidebar.appendChild(footerStrip)
    document.body.appendChild(sidebar)

    defineSkinHooks().apply(ctx)

    const startBtn = footerStrip.querySelector('button[class*="xpStart"]') as HTMLButtonElement | null
    expect(startBtn).not.toBeNull()
    expect(startBtn?.textContent).toContain('开始')
    expect(footerStrip.classList.contains('Ce-zfq_xpTaskbar')).toBe(true)

    // Click delegation
    startBtn?.click()
    expect(clickSpy).toHaveBeenCalledTimes(1)

    // Teardown
    runCleanup()
    expect(document.querySelector('button[class*="xpStart"]')).toBeNull()
    expect(footerStrip.classList.contains('Ce-zfq_xpTaskbar')).toBe(false)
  })
})
