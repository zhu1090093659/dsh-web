import { describe, expect, it } from 'vitest'
import { NarrationEngine, narrateActivity } from '../src/core/narration.ts'
import type {
  PetAggregateSnapshot,
  PetTaskPhase,
  PetTaskSnapshot,
} from '../src/core/protocol.ts'

function task(
  id: string,
  phase: PetTaskPhase,
  updatedAt: number,
  statusLine?: string,
): PetTaskSnapshot {
  return {
    taskId: id,
    instanceId: 'instance',
    bootId: 'boot',
    sessionId: id,
    phase,
    ...(statusLine === undefined ? {} : { statusLine }),
    startedAt: 0,
    phaseStartedAt: phase === 'thinking' || phase === 'tool' ? 0 : updatedAt,
    updatedAt,
    ...(phase === 'done' || phase === 'failed' ? { finishedAt: updatedAt } : {}),
  }
}

function snapshot(
  emittedAt: number,
  tasks: PetTaskSnapshot[],
  primaryTaskId = tasks[0]?.taskId,
): PetAggregateSnapshot {
  const active = tasks.filter(item => !['idle', 'done', 'failed'].includes(item.phase)).length
  return {
    protocolVersion: 2,
    sequence: emittedAt,
    emittedAt,
    ...(primaryTaskId === undefined ? {} : { primaryTaskId }),
    tasks,
    summary: {
      active,
      waiting: tasks.filter(item => item.phase === 'waiting' || item.phase === 'waiting_input').length,
      blocked: tasks.filter(item => item.phase === 'blocked').length,
      failed: tasks.filter(item => item.phase === 'failed').length,
      completedRecently: tasks.filter(item => item.phase === 'done').length,
    },
  }
}

describe('deterministic narration', () => {
  it('describes two and many active tasks without inventing progress', () => {
    const two = snapshot(100, [
      task('a', 'thinking', 100, '正在分析报错'),
      task('b', 'tool', 90, '正在运行测试'),
    ], 'a')
    const many = snapshot(100, [
      ...two.tasks,
      task('c', 'review', 80, '正在整理回复'),
    ], 'a')

    expect(narrateActivity(two)).toContain('主任务正在分析报错')
    expect(narrateActivity(two)).toContain('另一个任务正在运行测试')
    expect(narrateActivity(many)).toContain('现在有 3 个任务在跑')
    expect(narrateActivity(many)).not.toContain('%')
    expect([...(narrateActivity(many) ?? '')].length).toBeLessThanOrEqual(32)
  })

  it('prioritizes fresh failures and waiting for user input', () => {
    const failed = task('failed', 'failed', 95, '执行失败')
    expect(narrateActivity(snapshot(100, [failed]))).toContain('1 个任务遇到问题')

    const waiting = task('input', 'waiting_input', 100, '等待确认')
    expect(narrateActivity(snapshot(100, [waiting]))).toBe('这个任务正在等你确认。')

    const blocked = task('blocked', 'blocked', 100, '任务受阻')
    expect(narrateActivity(snapshot(100, [blocked]))).toBe('这个任务暂时受阻，正在等待继续。')
  })
})

describe('NarrationEngine scheduling', () => {
  it('holds ordinary phase changes until the cooldown ends', () => {
    const engine = new NarrationEngine()
    const first = engine.next(snapshot(0, [task('a', 'thinking', 0, '正在思考')]))
    expect(first).toMatchObject({ text: '正在思考', emitted: true, reason: 'initial', createdAt: 0 })

    const cooling = engine.next(snapshot(1_000, [task('a', 'review', 1_000, '正在整理回复')]))
    expect(cooling).toMatchObject({ text: '正在思考', emitted: false, createdAt: 0 })

    const ready = engine.next(snapshot(8_000, [task('a', 'review', 1_000, '正在整理回复')]))
    expect(ready).toMatchObject({
      text: '正在整理回复', emitted: true, reason: 'phase', createdAt: 8_000,
    })
  })

  it('lets urgent input and failure messages bypass ordinary cooldown', () => {
    const engine = new NarrationEngine()
    engine.next(snapshot(0, [task('a', 'thinking', 0, '正在思考')]))

    const waiting = engine.next(snapshot(1_000, [task('a', 'waiting_input', 1_000)]))
    expect(waiting).toMatchObject({
      text: '这个任务正在等你确认。',
      emitted: true,
      reason: 'waiting-input',
    })

    const failure = engine.next(snapshot(2_000, [task('a', 'failed', 2_000)]))
    expect(failure).toMatchObject({ emitted: true, reason: 'failure' })
    expect(failure.text).toContain('1 个任务遇到问题')
  })

  it('merges rapid completions and emits the aggregate after three seconds', () => {
    const engine = new NarrationEngine()
    const firstDone = task('a', 'done', 0)
    expect(engine.next(snapshot(0, [firstDone]))).toMatchObject({
      text: '刚刚完成了一个任务。',
      emitted: true,
      reason: 'completion',
    })

    const secondDone = task('b', 'done', 1_000)
    const merging = engine.next(snapshot(1_000, [firstDone, secondDone]))
    expect(merging).toMatchObject({ text: '刚刚完成了一个任务。', emitted: false })

    const merged = engine.next(snapshot(3_000, [firstDone, secondDone]))
    expect(merged).toMatchObject({
      text: '刚刚完成了 2 个任务。',
      emitted: true,
      reason: 'completion',
    })
  })

  it('emits long-running thresholds once without per-poll repetition', () => {
    const engine = new NarrationEngine()
    const thinking = task('a', 'thinking', 0, '正在思考')
    engine.next(snapshot(0, [thinking]))

    expect(engine.next(snapshot(30_000, [thinking]))).toMatchObject({
      emitted: true,
      reason: 'long-running',
    })
    expect(engine.next(snapshot(31_000, [thinking])).emitted).toBe(false)
    expect(engine.next(snapshot(60_000, [thinking]))).toMatchObject({
      text: '任务还在继续，我会帮你盯着。',
      emitted: true,
      reason: 'long-running',
    })
  })

  it('suppresses the same line for sixty seconds', () => {
    const engine = new NarrationEngine()
    engine.next(snapshot(0, [task('a', 'thinking', 0, '正在思考')]))
    engine.next(snapshot(8_000, [task('a', 'review', 8_000, '正在整理回复')]))
    engine.next(snapshot(16_000, [task('a', 'thinking', 16_000, '正在思考')]))

    const decision = engine.next(snapshot(24_000, [task('a', 'thinking', 16_000, '正在思考')]))
    expect(decision).toMatchObject({ text: '正在整理回复', emitted: false })
  })
})
