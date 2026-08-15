/**
 * collectSkills: filesystem scanning + registry merge + grouping tests.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildPayload, collectSkills, findProjectRoot, type RegistrySkill } from '../src/collect.ts'

const TMP = mkdtempSync(join(tmpdir(), 'skill-explorer-collect-'))
const PROJ = join(TMP, 'proj')
const HOME = join(TMP, 'home')
const AGENTS = join(TMP, 'agents')
const CUSTOM = join(TMP, 'custom')

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

write(join(PROJ, '.git', 'keep'), '')
write(join(PROJ, '.dsh', 'skills', 'poc-first', 'SKILL.md'), '---\nname: poc-first\ndescription: 快速 POC 与先找简单方案的工作方式。\n---\n# 正文\n')
write(join(PROJ, '.dsh', 'skills', 'zebra-skill', 'SKILL.md'), '# 无 frontmatter 的技能\n\n正文。\n')
write(join(PROJ, '.agents', 'skills', 'agent-proj', 'SKILL.md'), '---\nname: agent-proj\ndescription: 项目 agents 技能\n---\n')
write(join(HOME, 'skills', 'user-tool', 'SKILL.md'), '---\nname: user-tool\ndescription: 用户级技能\n---\n')
write(join(AGENTS, 'skills', 'agent-user', 'SKILL.md'), '---\nname: agent-user\ndescription: 用户 agents 技能\n---\n')
write(join(CUSTOM, 'my-custom', 'SKILL.md'), '---\nname: my-custom\ndescription: 自定义目录技能\n---\n')
write(
  join(AGENTS, 'skills', 'block-desc', 'SKILL.md'),
  ['---', 'name: block-desc', 'description: >-', '  块标量的', '  多行描述。', 'whenToUse: >', '  块标量', '  适用场景', '---', ''].join('\n'),
)

const REGISTRY_SKILLS: RegistrySkill[] = [
  {
    name: 'poc-first',
    description: '注册表描述',
    whenToUse: '注册表的 whenToUse',
    provider: 'filesystem',
    source: 'project-dsh',
    resourceBase: { kind: 'directory', path: join(PROJ, '.dsh', 'skills', 'poc-first') },
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    name: 'computer-use',
    description: '操作本地桌面窗口',
    whenToUse: '桌面应用交互',
    provider: 'orca',
    source: 'bundled',
    resourceBase: { kind: 'directory', path: join(TMP, 'bundled', 'computer-use') },
    invocation: { modelInvocable: true, userInvocable: false },
  },
  {
    name: 'embedded-hello',
    description: '运行时注册技能',
    provider: 'runtime',
    source: 'runtime',
    invocation: { modelInvocable: true, userInvocable: true },
  },
]

const registry = {
  snapshot: async () => ({ skills: REGISTRY_SKILLS, complete: true }),
}

afterAll(() => { rmSync(TMP, { recursive: true, force: true }) })

describe('findProjectRoot', () => {
  it('walks up to the nearest .git ancestor', () => {
    expect(findProjectRoot(join(PROJ, 'sub', 'deep'))).toBe(PROJ)
  })
  it('falls back to cwd when no .git is found', () => {
    expect(findProjectRoot(TMP)).toBe(TMP)
  })
})

describe('collectSkills', () => {
  it('scans all roots and merges registry entries', async () => {
    const { skills, complete } = await collectSkills({
      cwd: PROJ,
      projectRoots: [PROJ],
      customSkillDirs: [CUSTOM],
      dshHome: HOME,
      agentsHome: AGENTS,
      registry,
    })
    expect(complete).toBe(true)
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]))
    expect(byName['poc-first'].level).toBe('project-dsh')
    expect(byName['poc-first'].whenToUse).toBe('注册表的 whenToUse')
    expect(byName['poc-first'].path).toBe(join(PROJ, '.dsh', 'skills', 'poc-first', 'SKILL.md'))
    expect(byName['zebra-skill'].description).toBe('(no description)')
    expect(byName['agent-proj'].level).toBe('project-agents')
    expect(byName['user-tool'].level).toBe('user-dsh')
    expect(byName['agent-user'].level).toBe('user-agents')
    expect(byName['my-custom'].level).toBe('custom')
    expect(byName['computer-use'].level).toBe('bundled')
    expect(byName['computer-use'].provider).toBe('orca')
    expect(byName['embedded-hello'].level).toBe('runtime')
    expect(byName['block-desc'].description).toBe('块标量的 多行描述。')
    expect(skills.length).toBe(9)
  })

  it('degrades when the registry snapshot throws', async () => {
    const broken = { snapshot: async () => { throw new Error('registry boom') } }
    const { skills, complete } = await collectSkills({
      cwd: PROJ,
      projectRoots: [PROJ],
      customSkillDirs: [],
      dshHome: HOME,
      agentsHome: AGENTS,
      registry: broken as never,
    })
    expect(complete).toBe(false)
    expect(skills.some((s) => s.name === 'poc-first')).toBe(true)
  })
})

describe('buildPayload', () => {
  it('orders groups by SOURCE_GROUPS and sorts skills by name', () => {
    const entries = [
      { name: 'zebra', description: 'd', level: 'project-dsh', modelInvocable: true, userInvocable: true },
      { name: 'poc', description: 'd', level: 'project-dsh', modelInvocable: true, userInvocable: true },
      { name: 'sys', description: 'd', level: 'bundled', modelInvocable: true, userInvocable: true },
      { name: 'odd', description: 'd', level: 'other:weird', modelInvocable: true, userInvocable: true },
    ]
    const payload = buildPayload(entries as never, true, PROJ, [PROJ])
    expect(payload.groups.map((g) => g.key)).toEqual(['bundled', 'project-dsh', 'other:weird'])
    expect(payload.groups[1].skills.map((s) => s.name)).toEqual(['poc', 'zebra'])
    expect(payload.complete).toBe(true)
  })
})
