/**
 * List filtering rules (#1423): the search box and the workspace picker are
 * pure functions over the host payload, so they are tested without a DOM.
 */
import { describe, expect, it } from 'vitest'
import { matchRank, selectGroups } from '../src/client/skill-filter.ts'
import type { GroupPayload, SkillEntry } from '../src/client/api.ts'

function skill(name: string, description: string, extra: Partial<SkillEntry> = {}): SkillEntry {
  return {
    name,
    description,
    provider: 'filesystem',
    level: 'user-dsh',
    path: '/work/' + name + '/SKILL.md',
    modelInvocable: true,
    userInvocable: true,
    ...extra,
  }
}

function group(key: string, skills: SkillEntry[]): GroupPayload {
  return { key, title: key, hint: '', skills }
}

describe('matchRank', () => {
  it('ranks a name hit above a description hit', () => {
    expect(matchRank(skill('alpha-skill', 'plain'), 'alpha')).toBe(0)
    expect(matchRank(skill('plain', 'alpha helper'), 'alpha')).toBe(1)
  })

  it('matches case-insensitively and reports no hit as undefined', () => {
    expect(matchRank(skill('Alpha-Skill', 'x'), 'alpha')).toBe(0)
    expect(matchRank(skill('plain', 'X'), 'x')).toBe(1)
    expect(matchRank(skill('plain', 'plain'), 'nope')).toBeUndefined()
  })

  it('treats an empty needle as a match', () => {
    expect(matchRank(skill('plain', 'plain'), '')).toBe(0)
  })
})

describe('selectGroups', () => {
  const groups = [
    group('user-dsh', [
      skill('gamma-skill', 'unrelated'),
      skill('beta-skill', 'alpha related'),
      skill('alpha-skill', 'first helper'),
    ]),
    group('runtime', [skill('runtime-only', 'plugin embedded')]),
  ]

  it('returns every group in host order when neither axis is set', () => {
    const visible = selectGroups(groups, { workspace: 'all', query: '' })
    expect(visible.map(item => item.key)).toEqual(['user-dsh', 'runtime'])
    expect(visible[0].skills.map(item => item.name)).toEqual(['gamma-skill', 'beta-skill', 'alpha-skill'])
  })

  it('keeps name hits before description hits and drops non-matches', () => {
    const visible = selectGroups(groups, { workspace: 'all', query: 'alpha' })
    expect(visible.map(item => item.key)).toEqual(['user-dsh'])
    expect(visible[0].skills.map(item => item.name)).toEqual(['alpha-skill', 'beta-skill'])
  })

  it('reports no group when nothing matches', () => {
    expect(selectGroups(groups, { workspace: 'all', query: 'zzz' })).toEqual([])
  })

  it('combines the workspace axis with the query and keeps global skills', () => {
    const mixed = [
      group('project-dsh', [
        skill('project-alpha', 'alpha project', { workspaceRoot: '/repo/one', workspaceName: 'one' }),
        skill('project-beta', 'alpha other', { workspaceRoot: '/repo/two', workspaceName: 'two' }),
        skill('global-alpha', 'alpha global'),
      ]),
    ]
    const visible = selectGroups(mixed, { workspace: '/repo/one', query: 'alpha' })
    expect(visible[0].skills.map(item => item.name)).toEqual(['project-alpha', 'global-alpha'])
  })

  it('drops empty groups without mutating the payload', () => {
    const before = JSON.stringify(groups)
    const visible = selectGroups(groups, { workspace: 'all', query: 'runtime' })
    expect(visible.map(item => item.key)).toEqual(['runtime'])
    expect(JSON.stringify(groups)).toBe(before)
  })
})
