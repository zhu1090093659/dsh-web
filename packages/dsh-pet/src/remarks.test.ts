import { describe, expect, it } from 'vitest'
import {
  BUILTIN_REMARKS,
  REMARK_KINDS,
  REMARK_LINE_MAX,
  REMARK_LINES_MAX,
  RemarkPicker,
  builtinRemark,
  normalizePetRemarks,
} from './remarks.ts'

describe('BUILTIN_REMARKS', () => {
  it('carries a generous pool for every slot, with the legacy line first', () => {
    for (const kind of REMARK_KINDS) {
      const pool = BUILTIN_REMARKS[kind]
      expect(pool.length).toBeGreaterThanOrEqual(8)
      expect(pool.every(line => line.trim() !== '')).toBe(true)
    }
    // The legacy first lines keep the plugin's original wording so existing
    // installs and tests never see a different opening reaction.
    expect(BUILTIN_REMARKS.pet[0]).toBe('咕噜咕噜～被摸摸好舒服！')
    expect(BUILTIN_REMARKS.petCooldown[0]).toBe('摸过头啦，让鲸鱼娘歇口气～')
    expect(BUILTIN_REMARKS.feed[0]).toBe('呜哇！小鱼干好好吃！')
    expect(BUILTIN_REMARKS.feedCooldown[0]).toBe('吃饱啦，晚点再喂～')
    expect(BUILTIN_REMARKS.noTreats[0]).toBe('没有小鱼干了，多陪我工作一会儿吧～')
    // Repo-wide ban on emoji characters: the pools must stay plain text.
    const emoji = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/u
    for (const kind of REMARK_KINDS) {
      for (const line of BUILTIN_REMARKS[kind]) expect(line).not.toMatch(emoji)
    }
  })
})

describe('RemarkPicker', () => {
  it('picks the built-in pool round-robin, per slot, deterministically', () => {
    const picker = new RemarkPicker()
    const first = picker.pick('pet')
    const second = picker.pick('pet')
    expect(first).toBe(BUILTIN_REMARKS.pet[0])
    expect(second).toBe(BUILTIN_REMARKS.pet[1])
    // Per-slot counters: the feed slot still opens with its own first line.
    expect(picker.pick('feed')).toBe(BUILTIN_REMARKS.feed[0])
  })

  it('cycles back to the start after exhausting a pool', () => {
    const picker = new RemarkPicker({ pet: ['A', 'B'] })
    expect(picker.pick('pet')).toBe('A')
    expect(picker.pick('pet')).toBe('B')
    expect(picker.pick('pet')).toBe('A')
  })

  it('lets a custom slot override only its own pool', () => {
    const picker = new RemarkPicker({ pet: ['专属摸头台词'] })
    expect(picker.pick('pet')).toBe('专属摸头台词')
    expect(picker.pick('feed')).toBe(BUILTIN_REMARKS.feed[0])
  })
})

describe('normalizePetRemarks', () => {
  it('accepts single lines and line pools and trims them', () => {
    const remarks = normalizePetRemarks({
      pet: '  单句台词  ',
      feed: ['第一句', ' 第二句 ', 42],
      petCooldown: [],
    })
    expect(remarks).toEqual({ pet: ['单句台词'], feed: ['第一句', '第二句'] })
  })

  it('rejects non-object blocks and unknown slots with warnings', () => {
    const warnings: string[] = []
    expect(normalizePetRemarks('nope', message => warnings.push(message))).toBeUndefined()
    expect(normalizePetRemarks({ wat: ['x'] }, message => warnings.push(message))).toBeUndefined()
    expect(normalizePetRemarks({ pet: [1, null] }, message => warnings.push(message))).toBeUndefined()
    expect(warnings.length).toBe(3)
  })

  it('caps pool size and line length at the contract bounds', () => {
    const lines = Array.from({ length: REMARK_LINES_MAX + 10 }, (_, i) => 'line-' + i)
    const remarks = normalizePetRemarks({ pet: lines, feed: 'x'.repeat(REMARK_LINE_MAX + 50) })
    expect(remarks?.pet?.length).toBe(REMARK_LINES_MAX)
    expect(remarks?.feed?.[0]?.length).toBe(REMARK_LINE_MAX)
  })
})

describe('builtinRemark', () => {
  it('returns the legacy first line of every slot', () => {
    expect(builtinRemark('noTreats')).toBe('没有小鱼干了，多陪我工作一会儿吧～')
  })
})
