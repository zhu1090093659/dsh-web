import { afterEach, describe, expect, it } from 'vitest'
import { t, setRuntimeTranslate } from '../src/client/locales.ts'

describe('task-board localized t runtime wiring', () => {
  afterEach(() => { setRuntimeTranslate(undefined) })

  it('prefers the wired SDK translate seat (reads the active locale at call time)', () => {
    setRuntimeTranslate((key) => `RU(${key})`)
    expect(t('entry.label')).toBe('RU(entry.label)')
  })

  it('falls back to the document-language dictionary when unwired', () => {
    const label = t('entry.label')
    expect(label.startsWith('RU(')).toBe(false)
    expect(label.length).toBeGreaterThan(0)
  })

  it('passes template params through to the wired seat', () => {
    setRuntimeTranslate((key, params) => `${key}:${String(params?.count)}`)
    expect(t('board.archiveView', { count: '3' })).toBe('board.archiveView:3')
  })
})
