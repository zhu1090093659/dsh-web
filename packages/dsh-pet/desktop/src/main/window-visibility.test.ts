import { describe, expect, it, vi } from 'vitest'

import { showPetWindow } from './window-visibility.ts'

describe('showPetWindow', () => {
  it('keeps inactive display on non-Linux platforms', () => {
    const window = {
      isVisible: vi.fn(() => false),
      show: vi.fn(),
      showInactive: vi.fn(),
    }

    showPetWindow(window, 'win32')

    expect(window.showInactive).toHaveBeenCalledOnce()
    expect(window.isVisible).not.toHaveBeenCalled()
    expect(window.show).not.toHaveBeenCalled()
  })

  it('falls back to a regular show when inactive display is ineffective on Linux', () => {
    const window = {
      isVisible: vi.fn(() => false),
      show: vi.fn(),
      showInactive: vi.fn(),
    }

    showPetWindow(window, 'linux')

    expect(window.showInactive).toHaveBeenCalledOnce()
    expect(window.isVisible).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
  })

  it('does not focus a Linux window when inactive display succeeds', () => {
    const window = {
      isVisible: vi.fn(() => true),
      show: vi.fn(),
      showInactive: vi.fn(),
    }

    showPetWindow(window, 'linux')

    expect(window.showInactive).toHaveBeenCalledOnce()
    expect(window.isVisible).toHaveBeenCalledOnce()
    expect(window.show).not.toHaveBeenCalled()
  })
})
