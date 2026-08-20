/**
 * collectSkills: filesystem scanning + registry merge + grouping tests.
 */
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildPayload, collectSkills, findProjectRoot, writeSkillFile, type RegistrySkill } from '../src/collect.ts'

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

// Symlink support is environment-dependent: Windows needs Developer Mode and
// some sandboxed Linux runners disallow symlinks, so probe once and skip the
// linked-skill cases when creation fails instead of failing the suite.
const LINK_PROBE = join(TMP, 'link-probe')
let CAN_SYMLINK = false
try {
  write(join(LINK_PROBE, 'target', 'SKILL.md'), '---\nname: probe\ndescription: probe\n---\n')
  symlinkSync(join(LINK_PROBE, 'target'), join(LINK_PROBE, 'linked'), 'dir')
  CAN_SYMLINK = true
} catch {
  CAN_SYMLINK = false
}
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

describe('cross-root precedence', () => {
  it('project wins over custom wins over user, deterministically across repeated scans', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'skill-explorer-prec-'))
    const proj = join(tmp, 'proj')
    const home = join(tmp, 'home')
    const custom = join(tmp, 'custom')
    write(join(proj, '.git', 'keep'), '')
    write(join(proj, '.dsh', 'skills', 'shared-name', 'SKILL.md'), '---\nname: shared-name\ndescription: 项目版本\n---\n')
    write(join(home, 'skills', 'shared-name', 'SKILL.md'), '---\nname: shared-name\ndescription: 用户版本\n---\n')
    write(join(custom, 'shared-name', 'SKILL.md'), '---\nname: shared-name\ndescription: 自定义版本\n---\n')
    const registry = { snapshot: async () => ({ skills: [] as RegistrySkill[], complete: true }) }
    for (let round = 0; round < 8; round += 1) {
      const { skills } = await collectSkills({
        cwd: proj,
        projectRoots: [proj],
        customSkillDirs: [custom],
        dshHome: home,
        agentsHome: join(tmp, 'agents'),
        registry,
      })
      const winner = skills.find((s) => s.name === 'shared-name')
      expect(winner?.level).toBe('project-dsh')
      expect(winner?.description).toBe('项目版本')
    }
    rmSync(tmp, { recursive: true, force: true })
  })

  it('registry-only entries expose no editable path (no phantom toggle/delete)', async () => {
    const { skills } = await collectSkills({
      cwd: PROJ,
      projectRoots: [PROJ],
      customSkillDirs: [CUSTOM],
      dshHome: HOME,
      agentsHome: AGENTS,
      registry,
    })
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]))
    expect(byName['computer-use'].path).toBeUndefined()
    expect(byName['embedded-hello'].path).toBeUndefined()
    // Filesystem entries keep their scanned path even when the registry merges metadata.
    expect(byName['poc-first'].path).toBe(join(PROJ, '.dsh', 'skills', 'poc-first', 'SKILL.md'))
  })
})

describe('linked skill roots (symlink directories/files)', () => {
  const run = () =>
    collectSkills({
      cwd: PROJ,
      projectRoots: [PROJ],
      customSkillDirs: [CUSTOM],
      dshHome: HOME,
      agentsHome: AGENTS,
      registry,
    })

  it('discovers skills behind symlinked directories and symlinked .md files', async () => {
    if (!CAN_SYMLINK) return
    const tmp = mkdtempSync(join(tmpdir(), 'skill-explorer-link-'))
    // A real shared skill directory, linked into the user skills root.
    const shared = join(tmp, 'shared', 'linked-skill')
    mkdirSync(shared, { recursive: true })
    writeFileSync(join(shared, 'SKILL.md'), '---\nname: linked-skill\ndescription: 通过符号链接挂进来的技能\n---\n', 'utf8')
    // A real shared .md file, linked individually.
    const sharedFile = join(tmp, 'shared', 'linked-file.md')
    mkdirSync(join(tmp, 'shared'), { recursive: true })
    writeFileSync(sharedFile, '---\nname: linked-file\ndescription: 单文件符号链接技能\n---\n', 'utf8')
    const userSkills = join(HOME, 'skills')
    mkdirSync(userSkills, { recursive: true })
    symlinkSync(shared, join(userSkills, 'linked-skill'), 'dir')
    symlinkSync(sharedFile, join(userSkills, 'linked-file.md'), 'file')

    try {
      const { skills } = await run()
      const byName = Object.fromEntries(skills.map((s) => [s.name, s]))
      expect(byName['linked-skill']).toBeDefined()
      expect(byName['linked-skill'].level).toBe('user-dsh')
      expect(byName['linked-skill'].path).toBe(join(userSkills, 'linked-skill', 'SKILL.md'))
      expect(byName['linked-skill'].linked).toBe(true)
      expect(byName['linked-file']).toBeDefined()
      expect(byName['linked-file'].level).toBe('user-dsh')
      expect(byName['linked-file'].path).toBe(join(userSkills, 'linked-file.md'))
      expect(byName['linked-file'].linked).toBe(true)
      // Non-linked skills stay unflagged (deletable).
      expect(byName['poc-first'].linked).not.toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
      rmSync(join(userSkills, 'linked-skill'), { recursive: true, force: true })
      rmSync(join(userSkills, 'linked-file.md'), { recursive: true, force: true })
    }
  })

  it('skips symlink loops without failing the scan', async () => {
    if (!CAN_SYMLINK) return
    const userSkills = join(HOME, 'skills')
    mkdirSync(userSkills, { recursive: true })
    const loopA = join(userSkills, 'loop-a')
    const loopB = join(userSkills, 'loop-b')
    symlinkSync(loopB, loopA, 'dir')
    symlinkSync(loopA, loopB, 'dir')
    try {
      const { skills } = await run()
      expect(skills.map((s) => s.name)).not.toContain('loop-a')
      expect(skills.map((s) => s.name)).not.toContain('loop-b')
    } finally {
      rmSync(loopA, { recursive: true, force: true })
      rmSync(loopB, { recursive: true, force: true })
    }
  })

  it('skips dangling symlinks without failing the scan', async () => {
    if (!CAN_SYMLINK) return
    const userSkills = join(HOME, 'skills')
    mkdirSync(userSkills, { recursive: true })
    const danglingDir = join(userSkills, 'dangling-skill')
    const danglingFile = join(userSkills, 'dangling-file.md')
    symlinkSync(join(TMP, 'does-not-exist-dir'), danglingDir, 'dir')
    symlinkSync(join(TMP, 'does-not-exist.md'), danglingFile, 'file')
    try {
      const { skills } = await run()
      const names = skills.map((s) => s.name)
      expect(names).not.toContain('dangling-skill')
      expect(names).not.toContain('dangling-file')
      expect(skills.some((s) => s.name === 'poc-first')).toBe(true)
    } finally {
      rmSync(danglingDir, { recursive: true, force: true })
      rmSync(danglingFile, { recursive: true, force: true })
    }
  })
})

describe('writeSkillFile', () => {
  it('single-quotes free-text scalars so colons and quotes stay parseable', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'skill-explorer-write-'))
    const target = await writeSkillFile(join(tmp, 'base'), 'quoted-skill', '任务: 分析 a: b', "it's 引号", '正文')
    const raw = readFileSync(target, 'utf8')
    expect(raw).toContain("description: '任务: 分析 a: b'")
    expect(raw).toContain("whenToUse: 'it''s 引号'")
    expect(raw).toContain('name: quoted-skill')
    rmSync(tmp, { recursive: true, force: true })
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
