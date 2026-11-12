import { describe, expect, it } from 'vitest'
import { answerOf, makeConnection, requestFrame, type ConnectionHarness } from './support/harness.ts'

/** One row of the gateway's roster answer, as the host writes it. */
function summary(sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { sessionId, updatedAt: 5, running: false, blank: false, agentAvailable: true, ...extra }
}

/** The working directories a real host's roster repeats across its rows. */
const WORKSPACES = [
  '/Users/zcl/code/iphone_remote_use_dsh',
  '/Users/zcl/code/.worktrees/dsh-web/netperf-frame-compression',
  '/Users/zcl/code/dsh-web',
  '/Users/zcl/code/dsh-trading',
]

/** A timestamp inside the window a real roster spans: 2026-10-19, in milliseconds. */
const NOW_MS = 1_792_342_000_000

/**
 * A synthesized roster of 663 rows: the size measured on a real host on 2026-10-19.
 *
 * Every row carries what the host answers: an id, a working directory drawn from
 * a small set of real project paths, a millisecond timestamp, the running and
 * blank flags, and a fifth of them the lineage of a delegated child. No row
 * carries a `projections` block, so every title falls back to the
 * `session.titles` cache — which this connection never fills — and is the empty
 * string. Both sides of every measurement below carry the same titles, so the
 * saving it reports is a lower bound.
 */
function synthesizedRoster(): Record<string, unknown>[] {
  return Array.from({ length: 663 }, (_, index) => {
    const id = 's-' + index.toString(16).padStart(4, '0') + '-6f2a4c'
    const delegated = index % 5 === 0
    return summary(id, {
      // Descending age that does not follow the roster's own order, so a cursor
      // has to be derived from the answer rather than assumed from the listing.
      updatedAt: NOW_MS - ((index * 37) % 663) * 61_000,
      running: index % 11 === 0,
      blank: index % 13 === 0,
      cwd: WORKSPACES[index % WORKSPACES.length],
      ...(delegated ? { parentSessionId: 's-0000-6f2a4c', origin: 'subagent' } : {}),
    })
  })
}

/** Every byte of one answer, as it crossed the wire. */
function answerBytes(harness: ConnectionHarness, id: number): number {
  const text = harness.transport.sent.find(entry => {
    const frame = JSON.parse(entry) as { t?: string; id?: number }
    return frame.t === 'res' && frame.id === id
  })
  if (text === undefined) throw new Error('no response for request ' + String(id))
  return Buffer.byteLength(text, 'utf8')
}

/** One listing's answer payload, as the client reads it. */
interface RosterAnswer {
  readonly mode: string
  readonly token: string
  readonly compact?: boolean
  readonly nextAfter?: string
  readonly sessions: Record<string, unknown>[]
}

/** One listing's answer. */
function rosterOf(harness: ConnectionHarness, id: number): RosterAnswer {
  return answerOf(harness, id).r as RosterAnswer
}

/** Greet the bridge with the capabilities a listing is served under. */
async function greet(harness: ConnectionHarness, cap: readonly string[]): Promise<void> {
  await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [...cap] }))
}

describe('the compact roster over protocol v1', () => {
  it('user that did not declare the capability is answered today\'s body for a request carrying compact parameters', async () => {
    // Given a paired connection that declared nothing, over a host holding two sessions
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ items: [summary('s-1', { cwd: '/Users/zcl/code/x', updatedAt: 7 }), summary('s-2')] })
    await greet(harness, [])
    // When it lists twice, the second time naming every compact parameter
    await harness.connection.handleText(requestFrame(2, 'session.list'))
    await harness.connection.handleText(requestFrame(3, 'session.list', { cwd: true, maxRows: 1, after: 's-1' }))
    // Then the two answers are the same bytes and carry the whole roster: the
    // parameters are not part of a protocol this client declared
    expect(answerBytes(harness, 3)).toBe(answerBytes(harness, 2))
    expect(rosterOf(harness, 3)).toEqual({
      mode: 'reset',
      token: '',
      sessions: [
        { id: 's-1', title: '', updatedAt: 7, agentRunning: false, cwd: '/Users/zcl/code/x', blank: false },
        { id: 's-2', title: '', updatedAt: 5, agentRunning: false, blank: false },
      ],
    })
  })

  it('user that declared the capability but names no parameter is answered today\'s body byte for byte', async () => {
    // Given two connections over the same host, one of them declaring the compact form
    const plain = makeConnection({ paired: true })
    const declaring = makeConnection({ paired: true })
    for (const harness of [plain, declaring]) {
      harness.gateway.handler = async () => ({ items: [summary('s-1', { cwd: '/Users/zcl/code/x', updatedAt: 7, running: true }), summary('s-2')] })
    }
    await greet(declaring, ['session.list.compact.v1'])
    // When both list with no parameter at all
    await plain.connection.handleText(requestFrame(2, 'session.list'))
    await declaring.connection.handleText(requestFrame(2, 'session.list'))
    // Then the capability alone changed nothing: same bytes, same rows, no
    // compact marker and no cursor
    expect(answerBytes(declaring, 2)).toBe(answerBytes(plain, 2))
    expect(rosterOf(declaring, 2).compact).toBeUndefined()
    expect('nextAfter' in rosterOf(declaring, 2)).toBe(false)
  })

  it('operator listing a 663-row roster pays fewer bytes for a compact page and the same fields per row', async () => {
    // Given a host whose roster is the size measured on a real one, and a client
    // that declared the compact capability
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ items: synthesizedRoster() })
    await greet(harness, ['session.list.compact.v1'])
    // When it lists the whole roster twice: once as today, once compact
    await harness.connection.handleText(requestFrame(2, 'session.list'))
    await harness.connection.handleText(requestFrame(3, 'session.list', { cwd: false, maxRows: 663 }))
    const whole = rosterOf(harness, 2)
    const compact = rosterOf(harness, 3)
    // Then every session is still there, with today's own field values, and the
    // body is smaller by the absolute working directory on every row
    expect(compact.sessions).toHaveLength(663)
    expect(compact.mode).toBe('reset')
    expect(compact.token).toBe('')
    expect(compact.compact).toBe(true)
    expect(compact.sessions.map(row => row.id).sort()).toEqual(whole.sessions.map(row => row.id).sort())
    for (const row of compact.sessions) {
      const original = whole.sessions.find(candidate => candidate.id === row.id)
      expect(row).toMatchObject({
        id: original?.id,
        title: original?.title,
        updatedAt: original?.updatedAt,
        agentRunning: original?.agentRunning,
        blank: original?.blank,
      })
      expect(row.parentSessionId).toBe(original?.parentSessionId)
      expect(row.origin).toBe(original?.origin)
      expect('cwd' in row).toBe(false)
    }
    // When it lists once more with nothing changed, and then asks for one screen
    await harness.connection.handleText(requestFrame(4, 'session.list', { cwd: false, maxRows: 663 }))
    await harness.connection.handleText(requestFrame(5, 'session.list', { cwd: false, maxRows: 100 }))
    // Then the four measured bodies are, in bytes: the whole roster as today
    // (100470), the whole roster compact on a first answer where every timestamp
    // still has to cross (70143), the same listing repeated once the client holds
    // those timestamps (52905), and one screenful of 100 rows (8024)
    expect(answerBytes(harness, 2)).toBe(100470)
    expect(answerBytes(harness, 3)).toBe(70143)
    expect(answerBytes(harness, 4)).toBe(52905)
    expect(answerBytes(harness, 5)).toBe(8024)
    // The cursor of a page is that page's own last row, so the next request can
    // continue from it without any second field
    const screen = rosterOf(harness, 5)
    expect(screen.nextAfter).toBe(screen.sessions[screen.sessions.length - 1]?.id)
  })

  it('operator walking the roster with the cursor sees every session exactly once', async () => {
    // Given a declaring client over the synthesized roster
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ items: synthesizedRoster() })
    await greet(harness, ['session.list.compact.v1'])
    // When it asks for page after page of 100 rows, each from the cursor it was given
    const seen: string[] = []
    let after: string | undefined
    let pages = 0
    for (let id = 2; id < 20; id += 1) {
      await harness.connection.handleText(requestFrame(id, 'session.list', after === undefined ? { maxRows: 100 } : { maxRows: 100, after }))
      const page = rosterOf(harness, id)
      pages += 1
      expect(page.sessions.length).toBeGreaterThan(0)
      expect(page.sessions.length).toBeLessThanOrEqual(100)
      seen.push(...page.sessions.map(row => String(row.id)))
      after = page.nextAfter
      if (after === undefined) break
    }
    // Then the pages tile the roster: nothing repeated, nothing lost, and the
    // walk is ordered most recent first
    expect(pages).toBe(7)
    expect(seen).toHaveLength(663)
    expect(new Set(seen).size).toBe(663)
    expect(seen[0]).toBe('s-0000-6f2a4c')
    expect(seen[662]).toBe('s-00d7-6f2a4c')
    expect(after).toBeUndefined()
  })

  it('operator asking for the working directory receives it on every compact row that has one', async () => {
    // Given a declaring client over a host that reports a directory for one session only
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ items: [summary('s-1', { cwd: '/Users/zcl/code/x' }), summary('s-2')] })
    await greet(harness, ['session.list.compact.v1'])
    // When it asks for the directory in a compact page
    await harness.connection.handleText(requestFrame(2, 'session.list', { cwd: true, maxRows: 2 }))
    // Then the row that has one carries it, and one that has none omits the key
    const rows = rosterOf(harness, 2).sessions
    expect(rows.find(row => row.id === 's-1')?.cwd).toBe('/Users/zcl/code/x')
    expect(rows.find(row => row.id === 's-2') ?? {}).not.toHaveProperty('cwd')
  })

  it('operator listing the same roster twice is not sent the updatedAt it already holds', async () => {
    // Given a declaring client that already received a compact page
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ items: [summary('s-1', { updatedAt: 7 }), summary('s-2')] })
    await greet(harness, ['session.list.compact.v1'])
    await harness.connection.handleText(requestFrame(2, 'session.list', { maxRows: 10 }))
    // When it lists again with nothing changed, and then after one session moved
    await harness.connection.handleText(requestFrame(3, 'session.list', { maxRows: 10 }))
    harness.gateway.handler = async () => ({ items: [summary('s-1', { updatedAt: 9 }), summary('s-2')] })
    await harness.connection.handleText(requestFrame(4, 'session.list', { maxRows: 10 }))
    // Then the first answer carried every value, the second carried none, and
    // the third carried only the value that moved
    expect(rosterOf(harness, 2).sessions.map(row => row.updatedAt)).toEqual([7, 5])
    expect(rosterOf(harness, 3).sessions.map(row => 'updatedAt' in row)).toEqual([false, false])
    expect(rosterOf(harness, 4).sessions.map(row => row.updatedAt)).toEqual([9, undefined])
    // And the repeated listing is the shorter one
    expect(answerBytes(harness, 3)).toBeLessThan(answerBytes(harness, 2))
  })

  it('operator whose cursor names a session the roster no longer holds is answered a first page', async () => {
    // Given a declaring client over a roster that dropped the row its cursor names
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ items: [summary('s-3'), summary('s-2'), summary('s-1')] })
    await greet(harness, ['session.list.compact.v1'])
    // When it pages from an id this roster does not carry
    await harness.connection.handleText(requestFrame(2, 'session.list', { maxRows: 2, after: 's-gone' }))
    // Then it is answered from the top again, with the cursor it needs to continue.
    // Every row carries the same timestamp here, so the page shows the id
    // tiebreak the compact order falls back to.
    const page = rosterOf(harness, 2)
    expect(page.sessions.map(row => row.id)).toEqual(['s-1', 's-2'])
    expect(page.nextAfter).toBe('s-2')
  })

  it('operator that declared both capabilities still receives an increment when it sends only a since token', async () => {
    // Given a client that declared the compact form and the delta capability
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ items: [summary('s-1', { updatedAt: 7 })] })
    await greet(harness, ['session.list.compact.v1', 'delta.v1'])
    // When it lists, then lists again with the token it was given
    await harness.connection.handleText(requestFrame(2, 'session.list'))
    const token = rosterOf(harness, 2).token
    await harness.connection.handleText(requestFrame(3, 'session.list', { since: token }))
    // Then the compact capability did not hijack the increment: the second
    // answer is a delta with no rows changed and no page cursor
    const answer = answerOf(harness, 3).r as { mode: string; changed: unknown[]; removed: string[]; compact?: boolean }
    expect(answer.mode).toBe('delta')
    expect(answer.changed).toEqual([])
    expect(answer.removed).toEqual([])
    expect(answer.compact).toBeUndefined()
  })

  it('operator naming both a compact page and a since token is refused before any roster read', async () => {
    // Given a declaring client that also declared the delta capability
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ items: [summary('s-1')] })
    await greet(harness, ['session.list.compact.v1', 'delta.v1'])
    // When it asks for a compact page and an increment in one request
    await harness.connection.handleText(requestFrame(2, 'session.list', { maxRows: 10, since: 'd1.x.y.1' }))
    // Then the two bases are refused rather than one of them answered silently
    expect(answerOf(harness, 2).e?.code).toBe('invalid-args')
    expect(harness.gateway.countOf('session', 'list')).toBe(0)
  })

  it('operator naming a compact parameter no listing could honour is refused', async () => {
    // Given a declaring client over a host it has already listed once
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ items: [summary('s-1')] })
    await greet(harness, ['session.list.compact.v1'])
    await harness.connection.handleText(requestFrame(2, 'session.list'))
    // When each unusable value is sent
    await harness.connection.handleText(requestFrame(3, 'session.list', { maxRows: 0 }))
    await harness.connection.handleText(requestFrame(4, 'session.list', { maxRows: 5001 }))
    await harness.connection.handleText(requestFrame(5, 'session.list', { after: '' }))
    await harness.connection.handleText(requestFrame(6, 'session.list', { cwd: 'yes' }))
    // Then each is refused as malformed arguments rather than answered with a guess
    expect([3, 4, 5, 6].map(id => answerOf(harness, id).e?.code)).toEqual(['invalid-args', 'invalid-args', 'invalid-args', 'invalid-args'])
  })
})
