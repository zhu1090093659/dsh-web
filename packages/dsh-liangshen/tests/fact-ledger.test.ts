import { describe, expect, it } from 'vitest'
import { foldFactLedger, renderLedgerField, FACT_LEDGER_TOOL, MAX_FACT_CHARS, MAX_FACTS, name } from '../presets/liangshen/fact-ledger.mjs'

/** A fact_register tool/call event with plain-object arguments. */
function pin(fact, tag) {
  const args = tag === undefined ? { fact } : { fact, tag }
  return { type: 'tool/call', data: { name: FACT_LEDGER_TOOL, arguments: JSON.stringify(args) } }
}

/** A fact_register revocation call. */
function revoke(tag) {
  return { type: 'tool/call', data: { name: FACT_LEDGER_TOOL, arguments: JSON.stringify({ revoke: tag }) } }
}

describe('fact-ledger foldFactLedger', () => {
  it('operator sees an empty register on an empty or unrelated stream', () => {
    // Given no ledger calls in the stream.
    // When the fold runs, Then the register is empty.
    expect(foldFactLedger([])).toEqual([])
    expect(foldFactLedger([{ type: 'tool/call', data: { name: 'read', arguments: '{}' } }])).toEqual([])
  })

  it('operator sees pinned facts appended in order and identical text deduped', () => {
    // Given three pins, the third repeating the first fact's text.
    const events = [
      pin('User requires strict TypeScript', 'constraints'),
      pin('Auth decided: JWT, not sessions', 'auth'),
      pin('User requires strict TypeScript', 'constraints'),
    ]
    // When the fold runs, Then the facts append in order and the duplicate is dropped.
    const facts = foldFactLedger(events)
    expect(facts.map(entry => entry.text)).toEqual([
      'User requires strict TypeScript',
      'Auth decided: JWT, not sessions',
    ])
    expect(facts[0].tag).toBe('constraints')
  })

  it('operator can revoke by tag and by exact text', () => {
    // Given three facts, one revoked by tag and one by exact text.
    const events = [
      pin('User requires strict TypeScript', 'constraints'),
      pin('Auth decided: JWT', 'auth'),
      pin('no external deps'),
      revoke('constraints'),
      revoke('no external deps'),
    ]
    // When the fold runs, Then only the untouched fact remains.
    const facts = foldFactLedger(events)
    expect(facts.map(entry => entry.text)).toEqual(['Auth decided: JWT'])
  })

  it('operator sees facts clipped to the per-fact budget and the register capped', () => {
    // Given an over-long fact and more pins than the register holds.
    const long = 'x'.repeat(MAX_FACT_CHARS + 50)
    const many = []
    for (let index = 0; index < MAX_FACTS + 5; index += 1) many.push(pin(`fact ${index}`))
    // When the fold runs, Then the fact clips to the budget and the oldest facts drop off.
    const clipped = foldFactLedger([pin(long)])
    expect(clipped[0].text.length).toBe(MAX_FACT_CHARS)
    const capped = foldFactLedger(many)
    expect(capped.length).toBe(MAX_FACTS)
    expect(capped[0].text).toBe(`fact 5`)
  })

  it('operator sees the fold replay identically from the durable log (resume/compaction safe)', () => {
    // Given one event log.
    const events = [pin('a', 't1'), pin('b', 't2'), revoke('t1'), pin('c')]
    // When it is folded twice, Then both runs agree and the revocation held.
    expect(foldFactLedger(events)).toEqual(foldFactLedger(events))
    expect(foldFactLedger(events).map(entry => entry.text)).toEqual(['b', 'c'])
  })
})

describe('fact-ledger renderLedgerField', () => {
  it('operator sees no field on an empty register and tags rendered inline otherwise', () => {
    // Given an empty register and a register with one tagged fact.
    // When the field renders, Then the empty register yields nothing and the tag annotates its fact.
    expect(renderLedgerField([])).toBeUndefined()
    const field = renderLedgerField([
      { text: 'strict TS', tag: 'constraints' },
      { text: 'JWT decided' },
    ])
    expect(field).toBe('key facts: strict TS [constraints] ; JWT decided')
  })
})

describe('fact-ledger plugin identity', () => {
  it('operator can rely on the stable cordis plugin name and tool name', () => {
    // Given the plugin module, When its ids are read, Then both are the stable names.
    expect(name).toBe('liangshen-fact-ledger')
    expect(FACT_LEDGER_TOOL).toBe('fact_register')
  })
})
