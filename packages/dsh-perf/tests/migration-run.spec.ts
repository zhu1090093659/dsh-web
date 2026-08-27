// @vitest-environment node
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { discoverLegacySessions } from '../src/bsm/migration-run.ts'
import { encodeSessionLog } from '../src/bsm/legacy-log.ts'
import { runImport } from '../src/bsm/migration-run.ts'
import { openStore } from '../src/bsm/migration-core.ts'

const event = (type: string, seq: number, time: number, data: unknown, extra: Record<string, unknown> = {}) => ({ type, seq, time, data, ...extra })

function buildFakeRoot(root: string): void {
  const addSession = (project: string, dirName: string, headerId: string, events: Array<Record<string, unknown>>): void => {
    const dir = join(root, project, dirName)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'session.jsonl.zstd'),
      encodeSessionLog({ type: 'session', version: 0, id: headerId, createdAt: 42, cwd: `/work/${project}` }, [events]),
    )
  }
  addSession('--proj-a--', 'session-one', 'session-one', [event('user/message', 0, 1, { text: 'hello' }), event('assistant/chunk', 1, 2, {})])
  // Older writers stored sessions under the bare uuid without a `session-` prefix.
  addSession('--proj-a--', 'deadbeef-bare', 'bare-two', [event('user/message', 0, 3, { text: 'bare uuid era' })])
  addSession('--proj-b--', 'with-surface', 'session-three', [
    event('user/message', 4, 40, { text: 'ctx' }),
    event('assistant/message', 5, 50, { text: 'surface' }, { sourceEventSeqs: [4], surfaceOp: 'append' }),
    event('user/message', 6, 60, { text: 'tail' }),
  ])
}

describe('legacy discovery', () => {
  it('walks bare-uuid dirs and flags encoding mismatches', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-bs-root-'))
    try {
      buildFakeRoot(root)
      mkdirSync(join(root, '--proj-c--', 'conflicted'), { recursive: true })
      writeFileSync(join(root, '--proj-c--', 'conflicted', 'session.jsonl.zstd'), Buffer.alloc(0))
      writeFileSync(join(root, '--proj-c--', 'conflicted', 'session.jsonl'), '{}')
      const found = discoverLegacySessions(root)
      assert.equal(found.length, 4)
      assert.ok(found.some((s) => s.sessionId === 'deadbeef-bare'))
      assert.ok(found.find((s) => s.projectKey === '--proj-c--')?.encodingMismatch)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('runImport pipeline', () => {
  it('dry-run parses without writes; --apply imports idempotently across naming eras', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-bs-run-'))
    const sessionsDir = join(tmp, 'sessions')
    const dbPath = join(tmp, 'sessions.sqlite')
    try {
      buildFakeRoot(sessionsDir)

      const dry = runImport({ sessionsDir, dbPath, apply: false })
      assert.equal(dry.totalScanned, 3)
      assert.equal(dry.imported, 0)
      assert.equal(dry.details.find((d) => d.sessionId === 'deadbeef-bare')?.status, 'would-import')
      assert.ok(dry.details.every((d) => d.torn === false))

      const applied = runImport({ sessionsDir, dbPath, apply: true, createStore: true })
      assert.equal(applied.imported, 3)

      const rerun = runImport({ sessionsDir, dbPath, apply: true })
      assert.equal(rerun.skippedExisting, 3, 'reruns converge on the unique anchors')
      assert.equal(rerun.imported, 0)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('keeps surface provenance verbatim when nothing was dropped in that log', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-bs-surf-'))
    const sessionsDir = join(tmp, 'sessions')
    const dbPath = join(tmp, 'sessions.sqlite')
    try {
      buildFakeRoot(sessionsDir)
      runImport({ sessionsDir, dbPath, apply: true, createStore: true })
      const db = openStore(dbPath)
      try {
        const row = db.prepare("SELECT f_source_event_seqs AS refs FROM t_events WHERE f_surface_op = '\"append\"'").get() as { refs: string | null }
        assert.equal(row.refs, JSON.stringify([4]))
      } finally {
        db.close()
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
