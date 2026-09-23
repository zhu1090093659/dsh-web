/**
 * Announcement default (issue #839): announceToAgent resolves to false so
 * agent system prompts stay clean unless the user opts in, and every schema
 * field is a live reference the Host commits settings edits through.
 */
import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

/**
 * The shared reference protocol cosmokit commits a volatile value through
 * (`Symbol.for` keys it so an ESM and a CJS copy agree on the same slot).
 * The loader writes through it; the test stands in for the loader.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

describe('announcement default (issue #839)', () => {
  it('operator gets announceToAgent false and the plugin enabled from the schema defaults', () => {
    // Given a profile entry that declares no config at all
    const value = Config({})

    // When the schema resolves it
    // Then the announcement stays off, the plugin stays on, and the font defers to the CSS chain
    expect(value.announceToAgent.get()).toBe(false)
    expect(value.enabled.get()).toBe(true)
    expect(value.terminalFontFamily.get()).toBe('')
  })

  it('operator keeps an explicit true override', () => {
    // Given a profile entry that asks for the announcement
    const value = Config({ announceToAgent: true })

    // When the schema resolves it
    // Then the resolved field carries the declared value
    expect(value.announceToAgent.get()).toBe(true)
  })

  it('operator reads every settings field as a reference the Host updates in place', () => {
    // Given a resolved config and the reference protocol a settings edit commits through
    const value = Config({ terminalFontFamily: 'Fira Code' })
    const reference = value.enabled as unknown as Record<symbol, (next: boolean) => void>

    // When the Host commits a new value
    reference[VOLATILE_WRITE](false)

    // Then the same reference reports the new value and the other fields keep theirs
    expect(value.enabled.get()).toBe(false)
    expect(value.terminalFontFamily.get()).toBe('Fira Code')
  })
})
