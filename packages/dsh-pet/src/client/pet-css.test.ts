import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./pet.module.css', import.meta.url), 'utf8')

describe('pet hover panel css', () => {
  it('anchors the panel below the pet', () => {
    const panel = css.match(/\.panel\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(panel).toContain('top: 100%')
    expect(panel).toContain('margin-top: 8px')
    expect(panel).not.toContain('right: 100%')
  })

  it('extends the hover bridge upward across the panel gap', () => {
    const bridge = css.match(/\.panel::after\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(bridge).toContain('bottom: 100%')
    expect(bridge).toContain('height: 14px')
  })

  it('styles the whisper as a high-contrast tone of the shared bubble', () => {
    const whisper = css.match(/\.bubbleWhisper\s*\{([^}]*)\}/)?.[1] ?? ''
    // A tone variant, not a standalone bubble: it carries only the mood
    // overrides (violet glass + entrance) and inherits geometry/interaction
    // from .bubble/.bubbleStatus.
    expect(whisper).toContain('background: linear-gradient')
    expect(whisper).not.toContain('font-style: italic')
    expect(whisper).not.toContain('pointer-events')
    expect(whisper).not.toContain('position:')
    expect(css).toContain('@keyframes pet-whisper-in')
    // The tone must be declared after .bubbleStatus to win the cascade.
    expect(css.indexOf('.bubbleWhisper {')).toBeGreaterThan(css.indexOf('.bubbleStatus {'))
  })

  it('gives the panel and status bubbles entrance animations', () => {
    expect(css).toContain('@keyframes pet-panel-in')
    expect(css).toContain('@keyframes pet-bubble-in')
    const panel = css.match(/\.panel\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(panel).toContain('animation: pet-panel-in')
  })

  it('can place the panel above and bridge the lower gap', () => {
    const panel = css.match(/\.panelAbove\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(panel).toContain('bottom: 100%')
    expect(panel).toContain('margin-bottom: 8px')
    const bridge = css.match(/\.panelAbove::after\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(bridge).toContain('top: 100%')
    expect(bridge).toContain('bottom: auto')
  })
})
