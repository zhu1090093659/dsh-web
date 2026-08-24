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

  it('keeps the whisper on the shared bubble glass for a unified palette', () => {
    const whisper = css.match(/\.bubbleWhisper\s*\{([^}]*)\}/)?.[1] ?? ''
    // Unified palette: the whisper inherits background/border/shadow/color
    // from .bubble/.bubbleStatus, so a whispering bubble and a status bubble
    // stacked side by side share the same DeepSeek-blue glass; only the mood
    // (quotes, letter-spacing, entrance) is overridden.
    expect(whisper).not.toContain('background')
    expect(whisper).not.toContain('border')
    expect(whisper).not.toContain('box-shadow')
    expect(whisper).not.toContain('color')
    expect(whisper).toContain('animation: pet-whisper-in')
    expect(whisper).not.toContain('font-style: italic')
    expect(whisper).not.toContain('pointer-events')
    expect(whisper).not.toContain('position:')
    expect(css).toContain('@keyframes pet-whisper-in')
    // The mood overrides must be declared after .bubbleStatus to win the cascade.
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

  it('isolates the pet float container and sprite on their own compositor layer (issue #1013)', () => {
    const float = css.match(/\.float\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(float).toContain('will-change: transform')
    expect(float).toContain('contain: layout style')

    const sprite = css.match(/\.sprite\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(sprite).toContain('contain: paint')
  })
})
