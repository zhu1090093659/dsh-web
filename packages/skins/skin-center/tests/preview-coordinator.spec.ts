import { describe, expect, it, vi } from 'vitest'
import { PreviewCoordinator } from '../src/client/preview-coordinator.ts'

describe('PreviewCoordinator', () => {
  it('waits for a skin preview to exit before applying a wallpaper', async () => {
    let release!: () => void
    const exited = new Promise<void>(resolve => { release = resolve })
    const calls: string[] = []
    const skin = {
      getState: () => ({ previewing: true }),
      exitTryOn: vi.fn(async () => { calls.push('skin-exit-start'); await exited; calls.push('skin-exit-end'); return null }),
    }
    const wallpaper = { trying: () => false, exitTryOn: vi.fn() }
    const coordinator = new PreviewCoordinator(skin, wallpaper)
    const pending = coordinator.runWallpaper(() => { calls.push('wallpaper-apply') })
    await Promise.resolve()
    expect(calls).toEqual(['skin-exit-start'])
    release()
    await pending
    expect(calls).toEqual(['skin-exit-start', 'skin-exit-end', 'wallpaper-apply'])
  })

  it('retires the wallpaper preview before starting a skin transition', async () => {
    const calls: string[] = []
    const skin = { getState: () => ({ previewing: false }), exitTryOn: vi.fn(async () => null) }
    const wallpaper = { trying: () => true, exitTryOn: vi.fn(() => { calls.push('wallpaper-exit') }) }
    const coordinator = new PreviewCoordinator(skin, wallpaper)
    await coordinator.runSkin(async () => { calls.push('skin-start'); return null })
    expect(calls).toEqual(['wallpaper-exit', 'skin-start'])
  })

  it('serializes rapid cross-dimension actions in click order', async () => {
    const calls: string[] = []
    const skin = { getState: () => ({ previewing: false }), exitTryOn: vi.fn(async () => null) }
    const wallpaper = { trying: () => false, exitTryOn: vi.fn() }
    const coordinator = new PreviewCoordinator(skin, wallpaper)
    const first = coordinator.runSkin(async () => { calls.push('skin'); return null })
    const second = coordinator.runWallpaper(() => { calls.push('wallpaper') })
    await Promise.all([first, second])
    expect(calls).toEqual(['skin', 'wallpaper'])
  })

  it('suspends an applied custom theme for a skin preview and resumes it on exit', async () => {
    const calls: string[] = []
    let skinPreviewing = false
    const skin = {
      getState: () => ({ previewing: skinPreviewing }),
      exitTryOn: async () => { skinPreviewing = false; calls.push('skin-exit'); return null },
    }
    const wallpaper = { trying: () => false, exitTryOn: () => {} }
    const customTheme = {
      getState: () => ({ previewing: false }),
      exitTryOn: () => { calls.push('custom-exit') },
      suspend: () => { calls.push('custom-suspend') },
      resume: () => { calls.push('custom-resume') },
    }
    const coordinator = new PreviewCoordinator(skin, wallpaper, customTheme)

    await coordinator.runSkin(async () => { skinPreviewing = true; calls.push('skin-preview'); return null })
    expect(calls).toEqual(['custom-suspend', 'skin-preview'])

    await coordinator.runSkin(() => skin.exitTryOn())
    expect(calls).toEqual(['custom-suspend', 'skin-preview', 'custom-suspend', 'skin-exit', 'custom-resume'])
  })

  it('fully retires a custom-theme preview before starting a wallpaper preview', async () => {
    const calls: string[] = []
    let skinPreviewing = true
    const skin = {
      getState: () => ({ previewing: skinPreviewing }),
      exitTryOn: async () => { skinPreviewing = false; calls.push('skin-exit'); return null },
    }
    const wallpaper = { trying: () => false, exitTryOn: () => {} }
    const customTheme = {
      getState: () => ({ previewing: true }),
      exitTryOn: () => { calls.push('custom-exit') },
      suspend: () => { calls.push('custom-suspend') },
      resume: () => { calls.push('custom-resume') },
    }
    const coordinator = new PreviewCoordinator(skin, wallpaper, customTheme)

    await coordinator.runWallpaper(() => { calls.push('wallpaper-preview') })

    expect(calls).toEqual(['custom-exit', 'skin-exit', 'custom-resume', 'wallpaper-preview'])
  })

  it('retires skin and wallpaper previews before starting a custom-theme action', async () => {
    const calls: string[] = []
    let skinPreviewing = true
    const skin = {
      getState: () => ({ previewing: skinPreviewing }),
      exitTryOn: async () => { skinPreviewing = false; calls.push('skin-exit'); return null },
    }
    const wallpaper = { trying: () => true, exitTryOn: () => { calls.push('wallpaper-exit') } }
    const customTheme = {
      getState: () => ({ previewing: false }),
      exitTryOn: () => { calls.push('custom-exit') },
      suspend: () => { calls.push('custom-suspend') },
      resume: () => { calls.push('custom-resume') },
    }
    const coordinator = new PreviewCoordinator(skin, wallpaper, customTheme)

    await coordinator.runCustomTheme(async () => { calls.push('custom-preview'); return null })

    expect(calls).toEqual(['wallpaper-exit', 'skin-exit', 'custom-resume', 'custom-preview'])
  })

  it('commits an existing custom-theme preview without restoring the underlying skin first', async () => {
    const calls: string[] = []
    const skin = {
      getState: () => ({ previewing: true }),
      exitTryOn: async () => { calls.push('skin-exit'); return null },
    }
    const wallpaper = { trying: () => false, exitTryOn: () => {} }
    const customTheme = {
      getState: () => ({ previewing: true }),
      exitTryOn: () => { calls.push('custom-exit') },
      suspend: () => {},
      resume: () => { calls.push('custom-resume') },
    }
    const coordinator = new PreviewCoordinator(skin, wallpaper, customTheme)

    await coordinator.runCustomTheme(async () => { calls.push('custom-apply'); return null })

    expect(calls).toEqual(['custom-resume', 'custom-apply'])
  })
})
