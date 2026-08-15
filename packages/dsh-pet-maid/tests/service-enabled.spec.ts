import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import { loadPetPersist } from '../src/persist.ts'
import { PetService } from '../src/service.ts'

function makeSession(id: string): Session {
  return { id } as unknown as Session
}

function turnEnd(id: string, turn: number, reason: TurnEndReason, seq: number): [Session, SessionEvent] {
  return [makeSession(id), { type: 'turn/end', seq, time: seq, data: { turn, reason } }]
}

function stepStart(id: string, turn: number, step: number, seq: number): [Session, SessionEvent] {
  return [makeSession(id), { type: 'step/start', seq, time: seq, data: { turn, step } }]
}

function toolCall(id: string, name: string, seq: number): [Session, SessionEvent] {
  return [makeSession(id), {
    type: 'tool/call',
    seq,
    time: seq,
    data: { turn: 1, step: 1, callId: 'call-' + seq, name, arguments: '{}' },
  } as unknown as SessionEvent]
}

/** A fresh temp persistence dir per test, so tests never touch the real pet-maid.json. */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-pet-maid-spec-'))
}

describe('PetService (rc.6 session events)', () => {
  it('stops consuming session events while disabled and resumes on re-enable', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { enabled: false, persistDir: dir })
      ctx.emit('session/event', ...turnEnd('s1', 1, { kind: 'completed' }, 1))
      expect((await service.state()).animation).toBe('idle')
      expect((await service.state()).affinity.turns).toBe(0)

      service.setEnabled(true)
      ctx.emit('session/event', ...turnEnd('s1', 1, { kind: 'completed' }, 2))
      expect((await service.state()).animation).toBe('jumping')
      expect((await service.state()).affinity.turns).toBe(1)

      service.setEnabled(false)
      ctx.emit('session/event', ...turnEnd('s1', 2, { kind: 'completed' }, 3))
      expect((await service.state()).animation).toBe('jumping')
      expect((await service.state()).affinity.turns).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('maps core session events onto the pet phases (thinking/tool/done)', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', ...stepStart('s1', 1, 1, 1))
      expect((await service.state()).animation).toBe('thinking')
      ctx.emit('session/event', ...toolCall('s1', 'grep', 2))
      const toolView = await service.state()
      expect(toolView.animation).toBe('running')
      expect(toolView.bubble).toBe('tool: grep')
      ctx.emit('session/event', ...turnEnd('s1', 1, { kind: 'completed' }, 3))
      expect((await service.state()).animation).toBe('jumping')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lights the error pose on an aborted turn without counting it as completed', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', ...toolCall('s1', 'grep', 1))
      ctx.emit('session/event', ...turnEnd('s1', 1, { kind: 'aborted', reason: { kind: 'user' } }, 2))
      const view = await service.state()
      expect(view.animation).toBe('failed')
      expect(view.affinity.turns).toBe(0)
      expect(view.treats.stocked).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('counts each completed turn once and grants a work treat per 3 turns', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir })
      ctx.emit('session/event', ...turnEnd('s1', 1, { kind: 'completed' }, 1))
      ctx.emit('session/event', ...turnEnd('s1', 2, { kind: 'completed' }, 2))
      ctx.emit('session/event', ...turnEnd('s1', 3, { kind: 'completed' }, 3))
      // A duplicate delivery of turn 3 must not double count.
      ctx.emit('session/event', ...turnEnd('s1', 3, { kind: 'completed' }, 4))
      const view = await service.state()
      expect(view.affinity.turns).toBe(3)
      expect(view.affinity.points).toBe(3)
      expect(view.treats.stocked).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('feed consumes a work treat and grants +5 affinity inside the 30s cooldown', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir })
      for (let turn = 1; turn <= 3; turn++) {
        ctx.emit('session/event', ...turnEnd('s1', turn, { kind: 'completed' }, turn))
      }
      const first = await service.interact('feed')
      expect(first.delta).toBe(5)
      expect(first.affinity.feeds).toBe(1)
      expect(first.affinity.points).toBe(8) // 3 turns (1 point each) + 5 feed points
      expect((await service.state()).treats.stocked).toBe(0)
      // Inside the feed cooldown the feed is refused and burns nothing.
      const second = await service.interact('feed')
      expect(second.delta).toBe(0)
      expect(second.reaction).toContain('吃饱啦')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to feed on an empty stock without burning anything', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir })
      const res = await service.interact('feed')
      expect(res.delta).toBe(0)
      expect(res.affinity.feeds).toBe(0)
      expect(res.reaction).toContain('没有小鱼干')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists the time anchor on a zero-gain settlement (anchor deadlock)', async () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir })
      expect(loadPetPersist(dir).treats.lastTreatGrantAt).toBe(0)
      // A state read settles the economy; with no turns and no elapsed time
      // it must still write the clock-start anchor.
      await service.state()
      expect(loadPetPersist(dir).treats.lastTreatGrantAt).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('trims settings names so whitespace-only values cannot persist', () => {
    const ctx = new Context()
    const dir = tempDir()
    try {
      const service = new PetService(ctx, { persistDir: dir })
      service.applySettingsSection({
        visible: true,
        size: 160,
        right: 24,
        bottom: 20,
        name: '  鲸鱼娘  ',
        eyeTracking: true,
        miniMode: true,
      })
      expect(service.petName()).toBe('鲸鱼娘')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
