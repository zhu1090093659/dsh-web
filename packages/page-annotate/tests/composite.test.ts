import { describe, expect, it } from 'vitest'
import { annotationToPixels, estimateTextWidth, fontSizePixels, numberLabel, strokeToPixels } from '../src/core/composite.ts'

describe('annotationToPixels', () => {
  it('scales normalized coordinates to pixel space', () => {
    const rect = annotationToPixels({ id: 'a', kind: 'rect', x: 0.25, y: 0.5, w: 0.5, h: 0.25, color: '#f00', strokeWidth: 4 }, 1000, 800)
    expect(rect).toEqual({ x: 250, y: 400, w: 500, h: 200 })
  })
})

describe('strokeToPixels / fontSizePixels', () => {
  it('scales with the export factor and never collapses', () => {
    expect(strokeToPixels(4, 2)).toBe(8)
    expect(strokeToPixels(1, 0.1)).toBe(1)
    expect(fontSizePixels(16, 2)).toBe(32)
    expect(fontSizePixels(16, 0.1)).toBe(8)
  })
})

describe('numberLabel', () => {
  it('formats and caps', () => {
    expect(numberLabel(1)).toBe('1')
    expect(numberLabel(42)).toBe('42')
    expect(numberLabel(150)).toBe('99')
    expect(numberLabel(0)).toBe('1')
  })
})

describe('estimateTextWidth', () => {
  it('grows with text length and font size', () => {
    expect(estimateTextWidth('ab', 20)).toBeGreaterThan(estimateTextWidth('a', 20))
    expect(estimateTextWidth('a', 30)).toBeGreaterThan(estimateTextWidth('a', 20))
  })
})
