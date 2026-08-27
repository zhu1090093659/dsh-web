// @vitest-environment node
import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { eventDimensions, insertSession, openStore, projectPersistedEvents } from '../src/bsm/migration-core.ts'

const event = (type: string, seq: number, time: number, data: unknown, extra: Record<string, unknown> = {}) => ({ type, seq, time, data, ...extra })

describe('projection semantics (mirrors @morlay/session-rdb@0.0.11)', () => {
  it('drops ephemeral/ignorable/packed rows and prunes provenance', () => {
    const events = [
      { type: 'text-chunks', seq0: 3, time0: 300, data: { turn: 1, step: 1, index: 3, dt: [], texts: ['a', 'b'] } },
      event('assistant/chunk', 4, 400, { text: 'delta' }),
      event('request/header', 5, 500, {}, { ignorable: true }),
      event('user/message', 6, 600, { text: 'hi' }),
      event('assistant/message', 7, 700, { text: 'full body' }, { sourceEventSeqs: [4, 6] }),
      event('tool/call', 8, 800, { callId: 'call-9', name: 'bash' }),
      event('tool/result', 9, 900, { message: { content: [{ toolCallId: 'call-9' }] } }),
    ]
    const projected = projectPersistedEvents(events)
    assert.deepEqual(projected.rows.map((r) => r.kind), ['user/message', 'assistant/message', 'tool/call', 'tool/result'])
    assert.deepEqual([...projected.droppedSeqs].sort((a, b) => a - b), [3, 4, 5])
    assert.equal(projected.rows[1].sourceEventSeqs, JSON.stringify([6]), 'provenance to the dropped delta is pruned')
    assert.equal(projected.rows[2].role, 'function')
    assert.equal(projected.rows[2].name, 'bash')
    assert.equal(projected.rows[2].actionId, 'call-9')
    assert.equal(projected.rows[3].actionId, 'call-9')
  })

  it('maps playpen dimensions with defaults for unknown kinds', () => {
    assert.deepEqual(eventDimensions(event('custom/plugin-event', 1, 1, {})), { role: '', name: '', actionId: '' })
    assert.deepEqual(eventDimensions(event('todo/write', 1, 1, {})), { role: 'state', name: 'todos', actionId: '' })
    assert.equal(eventDimensions(event('tool/result', 1, 1, {})).actionId, '')
  })
})

describe('insertSession store writes', () => {
  it('renumbers densely, maintains the head cursor, and is idempotent per session id', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'dsh-bs-')), 'store.sqlite')
    const db = openStore(dbPath, { createStore: true })
    try {
      const projection = projectPersistedEvents([
        event('user/message', 0, 10, { text: 'a' }),
        event('assistant/chunk', 1, 11, {}),
        event('assistant/message', 2, 12, { text: 'b' }),
      ])
      assert.deepEqual(insertSession(db, { id: 'session-a', version: 0, createdAt: 5, cwd: '/p' }, projection), { inserted: true })
      insertSession(db, { id: 'session-a' }, projection)
      const head = db.prepare("SELECT f_head_sequence AS s FROM t_sessions WHERE f_session_id='session-a'").get() as { s: number }
      assert.equal(head.s, 1)
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM t_events WHERE f_kind=?').get('assistant/message') as { n: number }).n, 1)
      assert.equal((db.prepare('SELECT f_revision AS r FROM t_sessions').get() as { r: number }).r, 1)
      const chain = db.prepare(`SELECT t_events.f_parent_id AS parent
        FROM t_session_events JOIN t_events ON t_events.f_event_id = t_session_events.f_event_id
        WHERE f_session_id='session-a' ORDER BY f_sequence`).all() as Array<{ parent: string }>
      assert.equal(chain[0].parent, '')
      assert.notEqual(chain[1].parent, '')
    } finally {
      db.close()
      rmSync(dbPath, { force: true })
    }
  })
})
