import { describe, expect, it } from 'vitest'
import { clampUnitRect, createAnnotationStore, hitTest, normalizeRect, type Annotation } from '../src/core/annotate.ts'

describe('normalizeRect', () => {
  it('normalizes any drag direction', () => {
    expect(normalizeRect(0.1, 0.2, 0.5, 0.8)).toEqual({ x: 0.1, y: 0.2, w: 0.4, h: 0.6 })
    expect(normalizeRect(0.5, 0.8, 0.1, 0.2)).toEqual({ x: 0.1, y: 0.2, w: 0.4, h: 0.6 })
  })
})

describe('clampUnitRect', () => {
  it('clamps into the unit square', () => {
    expect(clampUnitRect({ x: -0.2, y: 0.5, w: 2, h: 0.3 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.3 })
  })
})

describe('createAnnotationStore', () => {
  it('adds annotations and notifies subscribers', () => {
    const store = createAnnotationStore()
    const seen: number[] = []
    store.subscribe(() => seen.push(store.getSnapshot().length))
    const id = store.add({ kind: 'rect', rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, color: '#f00', strokeWidth: 4 })
    expect(store.getSnapshot().length).toBe(1)
    expect(store.getSnapshot()[0].id).toBe(id)
    expect(seen).toEqual([1])
  })

  it('auto-increments number markers', () => {
    const store = createAnnotationStore()
    store.add({ kind: 'number', rect: { x: 0.1, y: 0.1, w: 0.05, h: 0.05 }, color: '#000', strokeWidth: 2 })
    store.add({ kind: 'number', rect: { x: 0.2, y: 0.2, w: 0.05, h: 0.05 }, color: '#000', strokeWidth: 2 })
    const items = store.getSnapshot()
    expect(items[0].number).toBe(1)
    expect(items[1].number).toBe(2)
  })

  it('undo restores the previous snapshot and clear empties', () => {
    const store = createAnnotationStore()
    store.add({ kind: 'rect', rect: { x: 0, y: 0, w: 1, h: 1 }, color: '#f00', strokeWidth: 2 })
    store.add({ kind: 'rect', rect: { x: 0, y: 0, w: 1, h: 1 }, color: '#00f', strokeWidth: 2 })
    store.undo()
    expect(store.getSnapshot().length).toBe(1)
    store.clear()
    expect(store.getSnapshot().length).toBe(0)
    // undo after clear restores the pre-clear snapshot
    store.undo()
    expect(store.getSnapshot().length).toBe(1)
  })

  it('remove deletes a single annotation', () => {
    const store = createAnnotationStore()
    const a = store.add({ kind: 'rect', rect: { x: 0, y: 0, w: 1, h: 1 }, color: '#f00', strokeWidth: 2 })
    store.add({ kind: 'rect', rect: { x: 0, y: 0, w: 1, h: 1 }, color: '#00f', strokeWidth: 2 })
    store.remove(a)
    expect(store.getSnapshot().length).toBe(1)
    expect(store.getSnapshot()[0].color).toBe('#00f')
  })
})

describe('hitTest', () => {
  it('finds the topmost annotation at a point', () => {
    const items: Annotation[] = [
      { id: 'a', kind: 'rect', x: 0, y: 0, w: 0.5, h: 0.5, color: '#f00', strokeWidth: 2 },
      { id: 'b', kind: 'rect', x: 0.2, y: 0.2, w: 0.5, h: 0.5, color: '#00f', strokeWidth: 2 },
    ]
    expect(hitTest(items, 0.3, 0.3)).toBe('b')
    expect(hitTest(items, 0.9, 0.9)).toBeUndefined()
  })
})
