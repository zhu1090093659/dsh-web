// @vitest-environment node
import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { decodeZstdLog, encodeSessionLog, parseSessionLog } from '../src/bsm/legacy-log.ts'

const batch = (n: number) => [
  { type: 'turn/start', seq: n * 10, time: n * 1000 + 1, data: {} },
  { type: 'user/message', seq: n * 10 + 1, time: n * 1000 + 2, data: { text: `m${n}` } },
]

describe('legacy log codec', () => {
  it('splits concatenated frames independently', () => {
    const encoded = encodeSessionLog({ type: 'session', version: 0, id: 'session-frame-walk', createdAt: 1 }, [batch(0), batch(1), batch(2)])
    assert.equal(decodeZstdLog(encoded).chunks.length, 4, 'header frame plus three batch frames')
    assert.equal(decodeZstdLog(encoded).tornTail, false)
  })

  it('flags torn tails and keeps the decodable prefix', () => {
    const encoded = encodeSessionLog({ type: 'session', version: 0, id: 'session-frame-walk', createdAt: 1 }, [batch(0), batch(1), batch(2)])
    const cut = encoded.subarray(0, encoded.length - 24)
    const decoded = decodeZstdLog(cut)
    assert.equal(decoded.tornTail, true)
    assert.ok(decoded.chunks.length >= 2)
  })

  it('parses the header and validates it', () => {
    const good = parseSessionLog(encodeSessionLog({ type: 'session', version: 0, id: 'session-fixture-1', createdAt: 1700000000000 }, []))
    assert.equal(good.header.id, 'session-fixture-1')
    assert.deepEqual(good.events, [])
    assert.throws(() => parseSessionLog(encodeSessionLog({ type: 'not-a-session', version: 0 }, [])), /not a session header/)
    assert.throws(() => parseSessionLog(encodeSessionLog({ type: 'session', id: 'x', version: 7 }, [])), /unsupported format version/)
  })
})
