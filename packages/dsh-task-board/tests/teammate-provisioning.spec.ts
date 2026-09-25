import { describe, expect, it } from 'vitest'
import { teammateName } from '../src/core/subtask.ts'

/**
 * The Agent Teams service's own acceptance rule, restated so a name this module
 * produces is judged by the contract the service enforces: lower-kebab-case, at
 * most 64 characters, never "lead", and unique inside one Team.
 */
function provision(names: readonly string[]): Array<{ ok: true } | { ok: false; code: string }> {
  const taken = new Set<string>()
  return names.map(name => {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64 || name === 'lead') {
      return { ok: false as const, code: 'TEAM_INVALID_MEMBER_NAME' }
    }
    if (taken.has(name)) return { ok: false as const, code: 'TEAM_MEMBER_NAME_TAKEN' }
    taken.add(name)
    return { ok: true as const }
  })
}

/** The pre-fix derivation, kept as the control arm of the regression. */
function legacyTeammateName(title: string, token: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/g, '')
  const suffix = token.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()
  return `${slug === '' ? 'subtask' : slug}-${suffix === '' ? 'run' : suffix}`
}

/**
 * The six stage containers of the 生物词典 project run and the eight children of
 * 后续内容与平台发展: the two real cascades whose members were refused. Titles
 * are copied from the live board so the fixture reproduces production.
 */
const STAGE_MEMBERS = [
  { id: 'stage-1', title: '多学科术语内容建设' },
  { id: 'stage-2', title: '人工 Reviewer 与学生志愿者' },
  { id: 'stage-3', title: '人工核验 SOP 与质量控制' },
  { id: 'stage-4', title: '生物医学术语词典 App 开发' },
  { id: 'stage-5', title: '志愿者项目运营与 Recognition' },
  { id: 'stage-6', title: '后续内容与平台发展' },
] as const

const LATER_STAGE_MEMBERS = [
  { id: 'later-1', title: '持续扩展神经科学术语' },
  { id: 'later-2', title: '扩展 Molecular Biology 内容' },
  { id: 'later-3', title: '扩展 Physiology 内容' },
  { id: 'later-4', title: '扩展 AP Biology 内容' },
  { id: 'later-5', title: '扩展 Pre-med / MCAT 内容' },
  { id: 'later-6', title: '完善词条插图与 Visual 内容' },
  { id: 'later-7', title: '建立术语知识图谱' },
  { id: 'later-8', title: '推进自适应学习系统' },
] as const

const GROUP = 'e048c604-da23-4ad1-97f4-56913036f820'

describe('teammate provisioning over a CJK cascade', () => {
  it('operator running a six-member CJK cascade gets every member provisioned', () => {
    // Given a real six-member cascade whose titles are all CJK except one
    // When each member is named and handed to the service's acceptance rule
    const outcomes = provision(STAGE_MEMBERS.map(member => teammateName(member.title, GROUP, member.id)))

    // Then no member is refused as invalid or already used
    expect(outcomes).toEqual(STAGE_MEMBERS.map(() => ({ ok: true })))
  })

  it('operator running the eight-member stage container gets every member provisioned', () => {
    // Given the eight-member run that collapsed three titles onto one name
    const group = '8dd00e0e-0000-0000-0000-000000000000'

    // When each member is named and handed to the same rule
    const outcomes = provision(LATER_STAGE_MEMBERS.map(member => teammateName(member.title, group, member.id)))

    // Then every member is accepted
    expect(outcomes).toEqual(LATER_STAGE_MEMBERS.map(() => ({ ok: true })))
  })

  it('operator sees the derivation this replaced collide on the same members', () => {
    // Given the pre-fix derivation
    // When it names the same members of one run
    const legacyNames = LATER_STAGE_MEMBERS.map(member => legacyTeammateName(member.title, 'dd00e0e'))

    // Then it collapses distinct members onto one name — the production refusal
    expect(new Set(legacyNames).size).toBeLessThan(LATER_STAGE_MEMBERS.length)
    const collisions = legacyNames.filter((name, index) => legacyNames.indexOf(name) !== index)
    expect(new Set(collisions).size).toBe(1)
    expect(collisions[0]).toContain('subtask-')

    // And the same collapse hits the six stage containers
    const legacyStageNames = STAGE_MEMBERS.map(member => legacyTeammateName(member.title, 'e048c604'))
    expect(new Set(legacyStageNames).size).toBe(5)
  })
})
