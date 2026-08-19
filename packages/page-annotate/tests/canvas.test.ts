import { describe, expect, it, vi } from 'vitest'
import { drawAnnotation } from '../src/client/canvas.ts'

describe('rectangle comment rendering', () => {
  it('clips a long comment to its selected region', () => {
    const ctx = {
      save: vi.fn(), restore: vi.fn(), strokeRect: vi.fn(), fillRect: vi.fn(),
      beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fill: vi.fn(),
      moveTo: vi.fn(), arcTo: vi.fn(), closePath: vi.fn(), fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 800 })),
    } as unknown as CanvasRenderingContext2D
    drawAnnotation(ctx, { id: 'r', kind: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.2, color: '#f00', strokeWidth: 4, comment: '这是一段很长很长的区域说明' }, 1000, 800, 2)
    expect(ctx.rect).toHaveBeenCalledWith(100, 160, 300, 160)
    expect(ctx.clip).toHaveBeenCalled()
  })
})
