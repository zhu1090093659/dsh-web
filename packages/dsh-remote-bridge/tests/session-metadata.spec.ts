import { describe, expect, it } from 'vitest'
import { SessionMeta, TITLES_MAX_IDS, type SessionMetaFaces } from '../src/core/session-meta.ts'
import { answerOf, makeConnection, requestFrame, titlesDouble } from './support/harness.ts'

/** One metadata source over fixed faces, for a connection that reads real metadata. */
function metaOver(faces: SessionMetaFaces, now: () => number = () => Date.now(), log: (message: string) => void = () => {}): SessionMeta {
  return new SessionMeta(() => faces, now, log)
}

/** One row of the gateway's roster answer, as the host writes it. */
function summary(sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { sessionId, updatedAt: 5, running: false, blank: false, agentAvailable: true, ...extra }
}

describe('session metadata over protocol v1', () => {
  it('operator listing sessions sees the working directory, lineage and blank flag of every live row', async () => {
    // Given a host whose roster reports a delegated session, a live one and an archived one
    const titles = titlesDouble({ 'sub-1': 'Draft the copy' })
    const harness = makeConnection({
      paired: true,
      sessionMeta: metaOver({ ...titles.faces, archive: { archivedSessionIds: ['s-2'] } }),
    })
    harness.gateway.handler = async () => ({
      items: [
        summary('sub-1', { updatedAt: 7, running: true, cwd: '/Users/zcl/code/x', parentSessionId: 's-1', origin: 'subagent' }),
        summary('s-2', { blank: true, cwd: '/Users/zcl/code/y' }),
        summary('s-3', { blank: true }),
      ],
    })
    // When the operator lists sessions
    await harness.connection.handleText(requestFrame(1, 'session.list'))
    // Then every field the host reported crosses under the protocol's own name,
    // and the archived session is not in the answer at all
    expect(answerOf(harness, 1).r).toEqual({
      mode: 'reset',
      token: '',
      sessions: [
        {
          id: 'sub-1',
          title: '',
          updatedAt: 7,
          agentRunning: true,
          cwd: '/Users/zcl/code/x',
          parentSessionId: 's-1',
          origin: 'subagent',
          blank: false,
          archived: false,
        },
        { id: 's-3', title: '', updatedAt: 5, agentRunning: false, blank: true, archived: false },
      ],
    })
  })

  it('operator listing sessions still sees a live child whose parent is archived, with its parent id', async () => {
    // Given a host that archived a parent session and kept its delegated child live
    const harness = makeConnection({
      paired: true,
      sessionMeta: metaOver({ archive: { archivedSessionIds: ['s-1'] } }),
    })
    harness.gateway.handler = async () => ({
      items: [summary('s-1'), summary('sub-2', { parentSessionId: 's-1', origin: 'subagent' })],
    })
    // When the operator lists sessions
    await harness.connection.handleText(requestFrame(15, 'session.list'))
    // Then the child is still a row and still names the parent the roster no longer carries
    expect(answerOf(harness, 15).r).toEqual({
      mode: 'reset',
      token: '',
      sessions: [
        { id: 'sub-2', title: '', updatedAt: 5, agentRunning: false, parentSessionId: 's-1', origin: 'subagent', blank: false, archived: false },
      ],
    })
  })

  it('operator whose archive set cannot be read is sent the whole roster, with no archive key', async () => {
    // Given a host whose archive set throws when this process reads it
    const logs: string[] = []
    const archive = {
      get archivedSessionIds(): readonly string[] {
        throw new Error('the workspace registry is shutting down')
      },
    }
    const harness = makeConnection({ paired: true, sessionMeta: metaOver({ archive }, () => Date.now(), message => { logs.push(message) }) })
    harness.gateway.handler = async () => ({ items: [summary('s-1'), summary('s-2')] })
    // When the operator lists sessions
    await harness.connection.handleText(requestFrame(16, 'session.list'))
    // Then nothing was dropped for a filter that could not be applied, the rows
    // carry no flag rather than a false one, and the reason was logged
    const answer = answerOf(harness, 16)
    expect((answer.r as { sessions: { id: string }[] }).sessions.map(row => row.id)).toEqual(['s-1', 's-2'])
    expect(Object.keys((answer.r as { sessions: Record<string, unknown>[] }).sessions[0] ?? {})).toEqual(['id', 'title', 'updatedAt', 'agentRunning', 'blank'])
    expect(logs).toEqual(['the session archive set could not be read: the workspace registry is shutting down'])
  })

  it('operator greeting the bridge is told the roster carries no archived session', async () => {
    // Given a paired connection
    const harness = makeConnection({ paired: true })
    // When it greets the bridge
    await harness.connection.handleText(requestFrame(17, 'hello', { proto: 1 }))
    // Then the announcement names the fact and the minor version that carries it
    const hello = answerOf(harness, 17).r as { minor: number; capabilities: string[] }
    expect(hello.minor).toBe(22)
    expect(hello.capabilities).toContain('session.list.omit-archived.v1')
  })

  it('operator whose host reports no optional field gets rows without those keys at all', async () => {
    // Given a host with no archive registry and a roster row carrying nothing optional
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ items: [summary('s-1', { cwd: '', origin: 'root' })] })
    // When the operator lists sessions
    await harness.connection.handleText(requestFrame(2, 'session.list'))
    // Then the row carries only the keys this host can actually answer for
    const answer = answerOf(harness, 2)
    expect(answer.r).toEqual({ mode: 'reset', token: '', sessions: [{ id: 's-1', title: '', updatedAt: 5, agentRunning: false, blank: false }] })
    expect(Object.keys((answer.r as { sessions: Record<string, unknown>[] }).sessions[0] ?? {})).toEqual(['id', 'title', 'updatedAt', 'agentRunning', 'blank'])
  })

  it('operator asking for a batch of titles receives one entry per id, empty for the untitled ones', async () => {
    // Given a host holding one titled session and one live session with no title yet
    const titles = titlesDouble({ 's-1': 'Plan the trip' }, ['s-1', 's-2'])
    const harness = makeConnection({ paired: true, sessionMeta: metaOver(titles.faces) })
    // When the operator asks for those two and one id this host does not hold
    await harness.connection.handleText(requestFrame(3, 'session.titles', { ids: ['s-1', 's-2', 's-9'] }))
    // Then every requested id is a key, the unknown ones answering the empty title
    const answer = answerOf(harness, 3)
    expect(answer.r).toEqual({ titles: { 's-1': 'Plan the trip', 's-2': '', 's-9': '' } })
    expect(Object.keys((answer.r as { titles: Record<string, string> }).titles)).toEqual(['s-1', 's-2', 's-9'])
    expect(titles.reads).toEqual(['s-1', 's-2'])
  })

  it('operator asking twice for the same title reads the title service once', async () => {
    // Given a host holding one titled session
    const titles = titlesDouble({ 's-1': 'Plan the trip' })
    const harness = makeConnection({ paired: true, sessionMeta: metaOver(titles.faces) })
    // When the operator asks for that title twice
    await harness.connection.handleText(requestFrame(4, 'session.titles', { ids: ['s-1'] }))
    await harness.connection.handleText(requestFrame(5, 'session.titles', { ids: ['s-1'] }))
    // Then both answers carry it and the service was read once
    expect(answerOf(harness, 4).r).toEqual({ titles: { 's-1': 'Plan the trip' } })
    expect(answerOf(harness, 5).r).toEqual({ titles: { 's-1': 'Plan the trip' } })
    expect(titles.reads).toEqual(['s-1'])
  })

  it('operator listing sessions after resolving titles sees the names on the roster rows', async () => {
    // Given a host that has already answered one title lookup
    const titles = titlesDouble({ 's-1': 'Plan the trip' })
    const harness = makeConnection({ paired: true, sessionMeta: metaOver(titles.faces) })
    harness.gateway.handler = async () => ({ items: [summary('s-1')] })
    await harness.connection.handleText(requestFrame(6, 'session.titles', { ids: ['s-1'] }))
    // When the operator lists sessions
    await harness.connection.handleText(requestFrame(7, 'session.list'))
    // Then the cached title rides the row and the roster itself read no title
    expect(answerOf(harness, 7).r).toEqual({
      mode: 'reset',
      token: '',
      sessions: [{ id: 's-1', title: 'Plan the trip', updatedAt: 5, agentRunning: false, blank: false }],
    })
    expect(titles.reads).toEqual(['s-1'])
  })

  it('operator sending an empty, oversized or malformed title batch is refused without reading a title', async () => {
    // Given a host whose title service records every read
    const titles = titlesDouble({ 's-1': 'Plan the trip' })
    const harness = makeConnection({ paired: true, sessionMeta: metaOver(titles.faces) })
    const oversized = Array.from({ length: TITLES_MAX_IDS + 1 }, (_value, index) => `s-${index}`)
    // When the operator sends four batches that are not a usable one
    await harness.connection.handleText(requestFrame(8, 'session.titles', { ids: [] }))
    await harness.connection.handleText(requestFrame(9, 'session.titles', { ids: oversized }))
    await harness.connection.handleText(requestFrame(10, 'session.titles', { ids: ['s-1', 7] }))
    await harness.connection.handleText(requestFrame(11, 'session.titles', {}))
    // Then every one of them is refused as arguments and nothing was read
    expect([8, 9, 10, 11].map(id => answerOf(harness, id).e?.code)).toEqual(['invalid-args', 'invalid-args', 'invalid-args', 'invalid-args'])
    expect(answerOf(harness, 8).e?.msg).toBe(`session.titles requires 1 to ${TITLES_MAX_IDS} session ids`)
    expect(titles.reads).toEqual([])
  })

  it('operator sending exactly the largest allowed batch receives a title for every id', async () => {
    // Given a host holding one title per id of a full batch
    const ids = Array.from({ length: TITLES_MAX_IDS }, (_value, index) => `s-${index}`)
    const table = Object.fromEntries(ids.map(id => [id, `Title ${id}`]))
    const titles = titlesDouble(table)
    const harness = makeConnection({ paired: true, sessionMeta: metaOver(titles.faces) })
    // When the operator asks for that whole batch
    await harness.connection.handleText(requestFrame(12, 'session.titles', { ids }))
    // Then every id came back titled
    const answer = answerOf(harness, 12)
    const answered = (answer.r as { titles: Record<string, string> }).titles
    expect(Object.keys(answered)).toHaveLength(TITLES_MAX_IDS)
    expect(answered['s-0']).toBe('Title s-0')
    expect(answered[`s-${TITLES_MAX_IDS - 1}`]).toBe(`Title s-${TITLES_MAX_IDS - 1}`)
  })

  it('operator asking for titles on a host with no title service gets empty titles, not a refusal', async () => {
    // Given a paired connection on a host where no title service is mounted
    const harness = makeConnection({ paired: true })
    // When the operator asks for one title
    await harness.connection.handleText(requestFrame(13, 'session.titles', { ids: ['s-1'] }))
    // Then the answer is still a full map, with the empty title for that id
    expect(answerOf(harness, 13).r).toEqual({ titles: { 's-1': '' } })
  })

  it('operator naming an id that collides with an object prototype still receives that key', async () => {
    // Given a host asked for an id that names an object prototype member
    const titles = titlesDouble({}, [])
    const harness = makeConnection({ paired: true, sessionMeta: metaOver(titles.faces) })
    // When the operator asks for it
    await harness.connection.handleText(requestFrame(14, 'session.titles', { ids: ['__proto__', 'constructor'] }))
    // Then both names came back as ordinary keys
    const answer = answerOf(harness, 14)
    expect(Object.keys((answer.r as { titles: Record<string, string> }).titles)).toEqual(['__proto__', 'constructor'])
    expect(answer.r).toEqual({ titles: { ['__proto__']: '', constructor: '' } })
  })
})

describe('roster row titles over protocol v1', () => {
  it('operator listing sessions sees the name a cold session carries in its own projection', async () => {
    // Given a host whose roster carries the projection title of a session this
    // process does not hold live, and which has resolved no title through session.titles
    const titles = titlesDouble({}, [])
    const harness = makeConnection({ paired: true, sessionMeta: metaOver(titles.faces) })
    harness.gateway.handler = async () => ({
      items: [
        summary('s-cold', { projections: { values: { title: 'Plan the trip' } } }),
        summary('s-live', { projections: { values: { title: 'Draft the copy', status: 'idle' } }, running: true }),
      ],
    })
    // When the operator lists sessions
    await harness.connection.handleText(requestFrame(1, 'session.list'))
    // Then every row carries the name its own projection carried, cold or live,
    // and no title lookup was spent on the listing
    expect((answerOf(harness, 1).r as { sessions: { id: string; title: string }[] }).sessions).toEqual([
      { id: 's-cold', title: 'Plan the trip', updatedAt: 5, agentRunning: false, blank: false },
      { id: 's-live', title: 'Draft the copy', updatedAt: 5, agentRunning: true, blank: false },
    ])
    expect(titles.reads).toEqual([])
  })

  it('operator listing a row whose projection carries no name sees the title this connection already resolved', async () => {
    // Given two live sessions whose titles this connection has resolved, and three
    // rows whose projection block carries a null, no title key, or no projection at all
    const titles = titlesDouble({ 's-1': 'Plan the trip', 's-2': 'Draft the copy' }, ['s-1', 's-2'])
    const harness = makeConnection({ paired: true, sessionMeta: metaOver(titles.faces) })
    harness.gateway.handler = async () => ({
      items: [
        summary('s-1', { projections: { values: { title: null } } }),
        summary('s-2', { projections: { values: { status: 'idle' } } }),
        summary('s-3'),
      ],
    })
    await harness.connection.handleText(requestFrame(1, 'session.titles', { ids: ['s-1', 's-2'] }))
    // When the operator lists sessions
    await harness.connection.handleText(requestFrame(2, 'session.list'))
    // Then each row falls back to the cache, and the session with neither source is empty
    expect((answerOf(harness, 2).r as { sessions: { id: string; title: string }[] }).sessions.map(row => [row.id, row.title])).toEqual([
      ['s-1', 'Plan the trip'],
      ['s-2', 'Draft the copy'],
      ['s-3', ''],
    ])
  })

  it('operator listing a roster whose projection block is malformed is still sent every row', async () => {
    // Given four live sessions whose titles this connection has resolved, and a host
    // that answers a projection block in four shapes none of them has
    const ids = ['s-1', 's-2', 's-3', 's-4']
    const titles = titlesDouble(Object.fromEntries(ids.map(id => [id, 'Plan the trip'])), ids)
    const harness = makeConnection({ paired: true, sessionMeta: metaOver(titles.faces) })
    harness.gateway.handler = async () => ({
      items: [
        summary('s-1', { projections: 'Plan the trip' }),
        summary('s-2', { projections: { values: 'Plan the trip' } }),
        summary('s-3', { projections: { values: { title: 41 } } }),
        summary('s-4', { projections: [] }),
      ],
    })
    await harness.connection.handleText(requestFrame(5, 'session.titles', { ids }))
    // When the operator lists sessions
    await harness.connection.handleText(requestFrame(6, 'session.list'))
    // Then no row failed the listing and every one of them fell back to the cache
    expect((answerOf(harness, 6).r as { sessions: { title: string }[] }).sessions.map(row => row.title)).toEqual([
      'Plan the trip',
      'Plan the trip',
      'Plan the trip',
      'Plan the trip',
    ])
  })

  it('operator listing a row that carries both a projected name and a resolved one sees the projected name', async () => {
    // Given a live session whose resolved title differs from the one its row projects
    const titles = titlesDouble({ 's-1': 'Name from the live service' }, ['s-1'])
    const harness = makeConnection({ paired: true, sessionMeta: metaOver(titles.faces) })
    harness.gateway.handler = async () => ({ items: [summary('s-1', { projections: { values: { title: 'Name from the projection' } } })] })
    await harness.connection.handleText(requestFrame(5, 'session.titles', { ids: ['s-1'] }))
    // When the operator lists sessions
    await harness.connection.handleText(requestFrame(6, 'session.list'))
    // Then the row carries its own projected name, and session.titles keeps
    // answering the live service's name for that same id
    expect((answerOf(harness, 6).r as { sessions: { title: string }[] }).sessions[0]?.title).toBe('Name from the projection')
    await harness.connection.handleText(requestFrame(7, 'session.titles', { ids: ['s-1'] }))
    expect(answerOf(harness, 7).r).toEqual({ titles: { 's-1': 'Name from the live service' } })
  })

  it('operator paging a compact roster sees the projected names on the page it is sent', async () => {
    // Given a host whose rows carry projection titles and a client that declared the compact form
    const titles = titlesDouble({}, [])
    const harness = makeConnection({ paired: true, sessionMeta: metaOver(titles.faces) })
    harness.gateway.handler = async () => ({
      items: [
        summary('s-1', { updatedAt: 9, cwd: '/Users/zcl/code/x', projections: { values: { title: 'Plan the trip' } } }),
        summary('s-2', { updatedAt: 7, cwd: '/Users/zcl/code/x', projections: { values: { title: 'Draft the copy' } } }),
        summary('s-3', { updatedAt: 5, cwd: '/Users/zcl/code/y' }),
      ],
    })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: ['session.list.compact.v1'] }))
    // When the operator reads one compact page of two rows
    await harness.connection.handleText(requestFrame(2, 'session.list', { cwd: true, maxRows: 2 }))
    // Then the page carries both projected names, the empty one for the row that has none,
    // and the cursor for the rest
    expect(answerOf(harness, 2).r).toEqual({
      mode: 'reset',
      token: '',
      compact: true,
      sessions: [
        { id: 's-1', title: 'Plan the trip', updatedAt: 9, agentRunning: false, cwd: '/Users/zcl/code/x', blank: false },
        { id: 's-2', title: 'Draft the copy', updatedAt: 7, agentRunning: false, cwd: '/Users/zcl/code/x', blank: false },
      ],
      nextAfter: 's-2',
    })
  })
})
