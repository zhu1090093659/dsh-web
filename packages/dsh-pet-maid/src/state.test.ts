import { describe, expect, it } from 'vitest'
import {
  animationForPhase,
  defaultPetStateConfig,
  PetStateMachine,
  rowOf,
  workingTierOf,
  WORKING_TIER_MAX,
  type PetAnimation,
} from './state.ts'

describe('animationForPhase', () => {
  it('maps each activity phase onto the animation contract', () => {
    expect(animationForPhase('thinking')).toBe('thinking')
    expect(animationForPhase('tool')).toBe('running')
    expect(animationForPhase('waiting')).toBe('waiting')
    expect(animationForPhase('done')).toBe('jumping')
    expect(animationForPhase('failed')).toBe('failed')
    expect(animationForPhase('idle')).toBe('idle')
  })
})

describe('workingTierOf', () => {
  it('maps live sessions onto tiers 1..4, capped at the max', () => {
    expect(workingTierOf(0)).toBe(1)
    expect(workingTierOf(1)).toBe(1)
    expect(workingTierOf(2)).toBe(2)
    expect(workingTierOf(4)).toBe(WORKING_TIER_MAX)
    expect(workingTierOf(9)).toBe(WORKING_TIER_MAX)
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
    expect(machine.render().animation).toBe('idle')
  })

  it('counts concurrent sessions into the working tier', () => {
    let now = 1_000
    const machine = new PetStateMachine(defaultPetStateConfig, () => now)
    machine.onSessionCreated()
    machine.onSessionCreated()
    machine.onActivityStatus({ phase: 'tool' })
    const s = machine.render()
    expect(s.sessionActive).toBe(true)
    expect(s.activeSessions).toBe(2)
    expect(s.workingTier).toBe(2)
    // A third session pushes the tier up.
    machine.onSessionCreated()
    expect(machine.render().workingTier).toBe(3)
    // Idle phases carry no tier.
    machine.onActivityStatus({ phase: 'idle' })
    expect(machine.render().workingTier).toBe(0)
  })

  it('stops counting on session dispose; the last one idles the pet', () => {
    const machine = new PetStateMachine(defaultPetStateConfig, () => 1_000)
    machine.onSessionCreated()
    machine.onSessionCreated()
    machine.onActivityStatus({ phase: 'tool' })
    machine.onSessionDisposed()
    expect(machine.render().activeSessions).toBe(1)
    machine.onSessionDisposed()
    const s = machine.render()
    expect(s.sessionActive).toBe(false)
    expect(s.activeSessions).toBe(0)
    expect(s.animation).toBe('idle')
    expect(s.phase).toBe('idle')
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

  it('keeps every animation on a known spritesheet row', () => {
    const animations: readonly PetAnimation[] = [
      'idle', 'running-right', 'running-left', 'waving', 'jumping',
      'failed', 'waiting', 'running', 'review', 'thinking', 'sleeping', 'attention',
    ]
    for (const animation of animations) {
      const row = rowOf(animation)
      expect(row).toBeGreaterThanOrEqual(0)
      expect(row).toBeLessThanOrEqual(8)
    }
  })
})
