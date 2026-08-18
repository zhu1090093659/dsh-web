import { describe, expect, it } from 'vitest'
import {
  animationForPhase,
  defaultPetStateConfig,
  PetStateMachine,
  rowOf,
  type PetAnimation,
} from './state.ts'

describe('animationForPhase', () => {
  it('maps each activity phase onto the animation contract', () => {
    expect(animationForPhase('thinking')).toBe('running')
    expect(animationForPhase('tool')).toBe('running-right')
    expect(animationForPhase('review')).toBe('review')
    expect(animationForPhase('waiting')).toBe('waiting')
    expect(animationForPhase('done')).toBe('jumping')
    expect(animationForPhase('failed')).toBe('failed')
    expect(animationForPhase('idle')).toBe('idle')
  })
})

describe('PetStateMachine', () => {
  it('celebrates for celebrateMs after done, then settles to idle', () => {
    let now = 1_000_000
    const machine = new PetStateMachine({ celebrateMs: 2400 }, () => now)
    machine.onSessionActive()
    machine.onActivityStatus({ phase: 'done', line: '完成' })
    expect(machine.render().animation).toBe('jumping')
    now += 2399
    expect(machine.render().animation).toBe('jumping')
    now += 2
    expect(machine.render()).toMatchObject({ animation: 'idle' })
    expect(machine.render().bubble).toBeUndefined()
  })

  it('shows failure briefly, then clears its bubble', () => {
    let now = 1_000_000
    const machine = new PetStateMachine({ celebrateMs: 2400, failureMs: 2400 }, () => now)
    machine.onSessionActive()
    machine.onActivityStatus({ phase: 'failed', line: '执行失败' })
    expect(machine.render()).toMatchObject({ animation: 'failed', bubble: '执行失败' })
    now += 2399
    expect(machine.render()).toMatchObject({ animation: 'failed', bubble: '执行失败' })
    now += 1
    expect(machine.render()).toMatchObject({ animation: 'idle' })
    expect(machine.render().bubble).toBeUndefined()
  })

  it('shows the phrase bubble when present, else the line', () => {
    const machine = new PetStateMachine(defaultPetStateConfig, () => 1_000)
    machine.onActivityStatus({ phase: 'thinking', phrase: '查资料中', line: 'tool: grep' })
    expect(machine.render().bubble).toBe('查资料中')
    machine.onActivityStatus({ phase: 'thinking', line: 'tool: grep' })
    expect(machine.render().bubble).toBe('tool: grep')
    machine.onActivityStatus({ phase: 'waiting' })
    expect(machine.render().bubble).toBeUndefined()
  })

  it('never bubbles a settled idle session, even with a projected line', () => {
    // An aborted turn projects idle + '已停止'; a stopped session must not
    // linger in the bubble stack.
    const machine = new PetStateMachine(defaultPetStateConfig, () => 1_000)
    machine.onActivityStatus({ phase: 'idle', line: '已停止' })
    expect(machine.render().bubble).toBeUndefined()
    expect(machine.render()).toMatchObject({ animation: 'idle', phase: 'idle' })
  })

  it('resets on session dispose', () => {
    const machine = new PetStateMachine(defaultPetStateConfig, () => 1_000)
    machine.onSessionActive()
    machine.onActivityStatus({ phase: 'done' })
    machine.onSessionDisposed()
    const s = machine.render()
    expect(s.sessionActive).toBe(false)
    expect(s.animation).toBe('idle')
    expect(s.phase).toBe('idle')
  })

  it('keeps every animation on a known spritesheet row', () => {
    const animations: readonly PetAnimation[] = [
      'idle', 'running-right', 'running-left', 'waving', 'jumping',
      'failed', 'waiting', 'running', 'review',
    ]
    for (const animation of animations) {
      const row = rowOf(animation)
      expect(row).toBeGreaterThanOrEqual(0)
      expect(row).toBeLessThanOrEqual(8)
    }
  })
})
