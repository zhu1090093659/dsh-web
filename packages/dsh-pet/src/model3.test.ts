import { describe, expect, it } from 'vitest'
import { collectModel3References, model3HitAreas, model3MotionGroups } from './model3.ts'

/** Fixture mirroring the real Haru sample's FileReferences shape. */
const HARU_LIKE = {
  Version: 3,
  FileReferences: {
    Moc: 'haru.moc3',
    Textures: ['haru.2048/texture_00.png', 'haru.2048/texture_01.png'],
    Physics: 'haru.physics3.json',
    Pose: 'haru.pose3.json',
    DisplayInfo: 'haru.cdi3.json',
    Expressions: [
      { Name: 'f01', File: 'expressions/f01.exp3.json' },
      { Name: 'f02', File: 'expressions/f02.exp3.json' },
    ],
    Motions: {
      Idle: [{ File: 'motions/idle_00.motion3.json' }],
      TapBody: [{ File: 'motions/tap_00.motion3.json' }, { File: 'motions/tap_01.motion3.json' }],
    },
    UserData: 'haru.userdata3.json',
  },
  Groups: [{ Name: 'EyeBlink' }, { Name: 'LipSync' }],
  HitAreas: [{ Id: 'Head', Name: 'Head' }, { Id: 'Body', Name: 'Body' }],
}

describe('collectModel3References', () => {
  it('collects the complete reference closure of the eight Cubism file families', () => {
    const { references, errors } = collectModel3References(HARU_LIKE)
    expect(errors).toEqual([])
    expect(references).toEqual([
      'expressions/f01.exp3.json',
      'expressions/f02.exp3.json',
      'haru.2048/texture_00.png',
      'haru.2048/texture_01.png',
      'haru.cdi3.json',
      'haru.moc3',
      'haru.physics3.json',
      'haru.pose3.json',
      'haru.userdata3.json',
      'motions/idle_00.motion3.json',
      'motions/tap_00.motion3.json',
      'motions/tap_01.motion3.json',
    ])
  })
  it('rejects unsafe references instead of collecting them', () => {
    const bad = {
      FileReferences: {
        Moc: '../escape.moc3',
        Textures: ['/abs/path.png', 'ok.png'],
        Motions: { Idle: [{ File: 'https://evil.example/x.motion3.json' }] },
      },
    }
    const { references, errors } = collectModel3References(bad)
    expect(references).toEqual(['ok.png'])
    expect(errors).toHaveLength(3)
  })
  it('tolerates missing optional families', () => {
    const minimal = { FileReferences: { Moc: 'a.moc3', Textures: ['a.png'] } }
    const { references, errors } = collectModel3References(minimal)
    expect(errors).toEqual([])
    expect(references).toEqual(['a.moc3', 'a.png'])
  })
  it('reports malformed model3 roots', () => {
    expect(collectModel3References(null).errors.length).toBeGreaterThan(0)
    expect(collectModel3References({}).errors.length).toBeGreaterThan(0)
  })
})

describe('model3MotionGroups / model3HitAreas', () => {
  it('reads motion groups and hit areas for diagnostics', () => {
    expect(model3MotionGroups(HARU_LIKE)).toEqual(['Idle', 'TapBody'])
    expect(model3HitAreas(HARU_LIKE)).toEqual(['Body', 'Head'])
  })
  it('returns empty lists for malformed models', () => {
    expect(model3MotionGroups(null)).toEqual([])
    expect(model3HitAreas({})).toEqual([])
  })
})
