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

/**
 * One call dispatched from inside a program, in the shape the `ptc` runtime
 * records instead of a top-level tool/call: object arguments, a settled
 * `isError` flag, and the dispatch ids the ptc wire carries.
 */
function dispatchOf(name, args, isError = false) {
  return {
    type: 'tool/ptc-dispatch',
    data: {
      rootCallId: 'call_root',
      parentCallId: 'call_root',
      subCallId: 'call_root:ptc:1',
      name,
      arguments: args,
      isError,
      content: [{ type: 'text', text: isError ? 'failed' : 'ok' }],
    },
  }
}

/** A fact_register dispatch: how the ptc wire records a pin or a revocation. */
function dispatch(args, isError = false) {
  return dispatchOf(FACT_LEDGER_TOOL, args, isError)
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

describe('fact-ledger foldFactLedger under the ptc wire', () => {
  it('operator sees a fact pinned through the ptc wire land in the register', () => {
    // Given a pin the runtime recorded as a programmatic dispatch, with object arguments.
    // When the fold runs, Then the fact reaches the register under its tag.
    expect(foldFactLedger([dispatch({ fact: 'pin via ptc', tag: 'wire' })])).toEqual([{ text: 'pin via ptc', tag: 'wire' }])
  })

  it('operator can revoke a ptc-pinned fact by tag and by exact text', () => {
    // Given ptc pins followed by ptc revocations, one by tag and one by exact text.
    const byTag = [dispatch({ fact: 'a', tag: 't1' }), dispatch({ fact: 'b' }), dispatch({ revoke: 't1' })]
    const byText = [dispatch({ fact: 'c' }), dispatch({ revoke: 'c' })]
    // When the fold runs, Then each revocation removes exactly its target.
    expect(foldFactLedger(byTag).map(entry => entry.text)).toEqual(['b'])
    expect(foldFactLedger(byText)).toEqual([])
  })

  it('operator does not see a failed ptc dispatch take effect', () => {
    // Given a pinned fact and two errored dispatches: a pin that should never land and a
    // revocation of the fact that already stands.
    const events = [dispatch({ fact: 'keep', tag: 't1' }), dispatch({ fact: 'failed pin' }, true), dispatch({ revoke: 't1' }, true)]
    // When the fold runs, Then the errored pin is absent and the errored revocation dropped nothing.
    expect(foldFactLedger(events).map(entry => entry.text)).toEqual(['keep'])
  })

  it('operator sees both wire shapes fold into one stream in the recorded order', () => {
    // Given native and ptc pins interleaved, with one text repeated across the two shapes.
    const events = [pin('native one'), dispatch({ fact: 'ptc one' }), pin('ptc one'), dispatch({ fact: 'last' })]
    // When the fold runs, Then the order is the stream's own and the repeat is still one fact.
    expect(foldFactLedger(events).map(entry => entry.text)).toEqual(['native one', 'ptc one', 'last'])
  })

  it('operator sees the register cap hold when both wires overflow it', () => {
    // Given more pins than MAX_FACTS, written through both shapes alternately.
    const many = Array.from({ length: MAX_FACTS + 2 }, (_, index) =>
      index % 2 === 0 ? pin(`fact ${index}`) : dispatch({ fact: `fact ${index}` }))
    // When the fold runs, Then the register holds MAX_FACTS and the newest survive.
    const facts = foldFactLedger(many)
    expect(facts.length).toBe(MAX_FACTS)
    expect(facts[0].text).toBe('fact 2')
    expect(facts[facts.length - 1].text).toBe(`fact ${MAX_FACTS + 1}`)
  })

  it('operator does not see an unrelated tool dispatch or an unsettled dispatch-start take effect', () => {
    // Given a dispatch for another tool and a dispatch-start announcement of this one.
    const events = [
      dispatchOf('tool_activate', { namespace: 'github', fact: 'not a fact' }),
      { type: 'tool/ptc-dispatch-start', data: { name: FACT_LEDGER_TOOL, arguments: { fact: 'unsettled' } } },
    ]
    // When the fold runs, Then neither reaches the register.
    expect(foldFactLedger(events)).toEqual([])
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
