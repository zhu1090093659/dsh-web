import { describe, expect, it } from 'vitest'
import { defaultTreatConfig } from './treats.ts'
import { defaultAffinityConfig } from './affinity.ts'
import { emptyPersist } from './persist.ts'
import { PetLedger } from './ledger.ts'

describe('PetLedger', () => {
  it('settles the economy on completed turns (work treat per 30 turns)', () => {
    const ledger = new PetLedger(emptyPersist())
    const n = 1_000_000
    for (let turn = 1; turn <= 30; turn++) ledger.rewardTurn('s1', turn, n + turn)
    expect(ledger.snapshot.affinity.turns).toBe(30)
    expect(ledger.snapshot.treats.treats).toBe(1)
    expect(ledger.takeDirty()).toBe(true)
  })

  it('rewards each completed turn once per session (idempotent)', () => {
    const ledger = new PetLedger(emptyPersist())
    const n = 1_000_000
    expect(ledger.rewardTurn('s1', 3, n)).toBe(true)
    // A duplicate delivery of the same turn must not double count.
    expect(ledger.rewardTurn('s1', 3, n + 1)).toBe(false)
    expect(ledger.snapshot.affinity.turns).toBe(1)
  })

  it('forgetSession re-arms a session so a repeated reward can award again', () => {
    const ledger = new PetLedger(emptyPersist())
    const n = 1_000_000
    ledger.rewardTurn('s1', 1, n)
    expect(ledger.snapshot.affinity.turns).toBe(1)
    // The disposed-session eviction drops only the per-session bookkeeping.
    ledger.forgetSession('s1')
    // The same turn number is now treated as fresh: a same-turn retry on a
    // new session lifecycle re-awards rather than being deduplicated.
    expect(ledger.rewardTurn('s1', 1, n + 1)).toBe(true)
    expect(ledger.snapshot.affinity.turns).toBe(2)
  })

  it('a read of the view does not mark dirty (no settle on read)', () => {
    const ledger = new PetLedger(emptyPersist())
    ledger.affinityView(1_000_000)
    expect(ledger.takeDirty()).toBe(false)
  })

  it('feed consumes a treat and applies the feed reward', () => {
    const ledger = new PetLedger(emptyPersist())
    const n = 1_000_000
    for (let turn = 1; turn <= 30; turn++) ledger.rewardTurn('s1', turn, n + turn)
    expect(ledger.snapshot.treats.treats).toBe(1)
    const res = ledger.interact('feed', n + 40)
    expect(res.delta).toBe(defaultAffinityConfig.feedReward)
    expect(ledger.snapshot.treats.treats).toBe(0)
    expect(ledger.snapshot.affinity.feeds).toBe(1)
  })

  it('cycles per-pet custom remarks per slot and falls back to built-ins', () => {
    const ledger = new PetLedger(emptyPersist(), {
      remarks: { pet: ['第一句', '第二句'] },
    })
    const n = 1_000_000
    expect(ledger.interact('pet', n).reaction).toBe('第一句')
    // Per-slot counters: the cooldown refusal still opens with the built-in
    // legacy line, not the custom pool above.
    expect(ledger.interact('pet', n + 1).reaction).toBe('摸过头啦，让鲸鱼娘歇口气～')
    // Feeding falls back to the built-in pool when the pet declares none.
    expect(ledger.interact('feed', n + 2).reaction).toBe('没有小鱼干了，多陪我工作一会儿吧～')
  })

  it('swaps remark pools when the selected pet changes', () => {
    const ledger = new PetLedger(emptyPersist(), { remarks: { pet: ['旧宠物台词'] } })
    expect(ledger.interact('pet', 1_000_000).reaction).toBe('旧宠物台词')
    ledger.setRemarks({ pet: ['新宠物台词'] })
    expect(ledger.interact('pet', 1_011_000).reaction).toBe('新宠物台词')
    ledger.setRemarks(undefined)
    expect(ledger.interact('pet', 1_022_000).reaction).toBe('咕噜咕噜～被摸摸好舒服！')
  })

  it('refuses a feed on an empty stock without burning anything', () => {
    const ledger = new PetLedger(emptyPersist())
    const res = ledger.interact('feed', 1_000_000)
    expect(res.delta).toBe(0)
    expect(res.reaction).toContain('没有小鱼干')
    expect(ledger.snapshot.affinity.feeds).toBe(0)
    // The empty-stock feed still marks dirty because the first settlement
    // starts the time clock, mirroring the service-level behavior.
    expect(ledger.takeDirty()).toBe(true)
  })

  it('exposes the treat stock cap and display/pet/name setters', () => {
    const ledger = new PetLedger(emptyPersist())
    expect(ledger.treatMax).toBe(defaultTreatConfig.maxTreats)
    ledger.setDisplay({ ...ledger.snapshot.display, visible: false })
    ledger.setPetId('otter')
    ledger.setPetName('otter', '泡泡')
    expect(ledger.snapshot.display.visible).toBe(false)
    expect(ledger.snapshot.petId).toBe('otter')
    expect(ledger.snapshot.names).toEqual({ otter: '泡泡' })
    expect(ledger.takeDirty()).toBe(true)
  })
})
