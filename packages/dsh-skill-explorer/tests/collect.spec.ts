/**
 * collectSkills: filesystem scanning + registry merge + grouping tests.
 */
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildPayload, collectSkills, customSkillDirsFromLoader, findProjectRoot, isSkillName, normalizeSkillRoots, writeSkillFile, type RegistrySkill } from '../src/collect.ts'

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
// A file with no frontmatter: the official provider discards it, so the panel
// must not list it (regression input kept deliberately).
write(join(PROJ, '.dsh', 'skills', 'no-frontmatter', 'SKILL.md'), '# 无 frontmatter 的技能\n\n正文。\n')
// A file whose frontmatter name violates the official grammar (trailing hyphen).
write(join(PROJ, '.dsh', 'skills', 'bad-name', 'SKILL.md'), '---\nname: bad-\ndescription: 非法技能名\n---\n')
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
    // The official registry reports the provider's real instruction file in
    // SkillSummary.path (#1842). resourceBase names the resource directory, not
    // the file, so it is deliberately NOT what the panel classifies on.
    path: join(TMP, 'bundled', 'computer-use', 'SKILL.md'),
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
    // The panel shows exactly the skills the model receives: a file the
    // official provider discards (no frontmatter, invalid name) is absent.
    expect(byName['no-frontmatter']).toBeUndefined()
    expect(byName['bad-name']).toBeUndefined()
    expect(byName['agent-proj'].level).toBe('project-agents')
    expect(byName['user-tool'].level).toBe('user-dsh')
    expect(byName['agent-user'].level).toBe('user-agents')
    expect(byName['my-custom'].level).toBe('custom')
    expect(byName['computer-use'].level).toBe('bundled')
    expect(byName['computer-use'].provider).toBe('orca')
    expect(byName['embedded-hello'].level).toBe('runtime')
    expect(byName['block-desc'].description).toBe('块标量的 多行描述。')
    expect(skills.length).toBe(8)
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

  it('queries registry snapshot for all project roots (#1139)', async () => {
    const calledCwds: string[] = []
    const multiRegistry = {
      snapshot: async ({ cwd }: { cwd: string }) => {
        calledCwds.push(cwd)
        if (cwd === '/virtual/proj-b') {
          return { skills: [{ name: 'proj-b-skill', description: 'from project b', source: 'other:project-config' }], complete: true }
        }
        return { skills: [], complete: true }
      },
    }
    const { skills, complete } = await collectSkills({
      cwd: PROJ,
      projectRoots: [PROJ, '/virtual/proj-b'],
      customSkillDirs: [],
      dshHome: HOME,
      agentsHome: AGENTS,
      registry: multiRegistry as never,
    })
    expect(complete).toBe(true)
    expect(calledCwds).toContain(PROJ)
    expect(calledCwds).toContain('/virtual/proj-b')
    expect(skills.some((s) => s.name === 'proj-b-skill')).toBe(true)
  })
})

describe('invocation policy resolution (#1204)', () => {
  const INVOCATION_TMP = join(TMP, 'invocation')
  const INVOCATION_PROJ = join(INVOCATION_TMP, 'proj')
  const INVOCATION_HOME = join(INVOCATION_TMP, 'home')

  function writeInvocationFixtures(): void {
    write(join(INVOCATION_PROJ, '.git', 'keep'), '')
    // Declares neither user-invocable nor disable-model-invocation: the
    // official rule is "omitted means allowed".
    write(
      join(INVOCATION_PROJ, '.dsh', 'skills', 'plain', 'SKILL.md'),
      '---\nname: plain\ndescription: no invocation fields\n---\n# body\n',
    )
    write(
      join(INVOCATION_PROJ, '.dsh', 'skills', 'model-off', 'SKILL.md'),
      '---\nname: model-off\ndescription: model invocation disabled\ndisable-model-invocation: true\n---\n# body\n',
    )
    write(
      join(INVOCATION_PROJ, '.dsh', 'skills', 'user-off', 'SKILL.md'),
      '---\nname: user-off\ndescription: user invocation disabled\nuser-invocable: false\n---\n# body\n',
    )
  }

  const collectWith = async (registrySkills: RegistrySkill[]) => {
    const { skills } = await collectSkills({
      cwd: INVOCATION_PROJ,
      projectRoots: [INVOCATION_PROJ],
      customSkillDirs: [],
      dshHome: INVOCATION_HOME,
      agentsHome: join(INVOCATION_TMP, 'agents'),
      registry: { snapshot: async () => ({ skills: registrySkills, complete: true }) },
    })
    return Object.fromEntries(skills.map((s) => [s.name, s]))
  }

  it('operator sees a skill stay invocable when its frontmatter omits both invocation fields', async () => {
    // Given a skill file declaring only name and description, and a registry
    // that contributes nothing
    writeInvocationFixtures()
    // When the skill center collects the roots
    const byName = await collectWith([])
    // Then it is reported as invocable on both surfaces (omitted means allowed)
    expect(byName['plain'].modelInvocable).toBe(true)
    expect(byName['plain'].userInvocable).toBe(true)
    rmSync(INVOCATION_TMP, { recursive: true, force: true })
  })

  it('operator sees explicit invocation fields honored from frontmatter', async () => {
    // Given skills that disable exactly one surface each
    writeInvocationFixtures()
    // When the skill center collects the roots
    const byName = await collectWith([])
    // Then only the declared surface is denied
    expect(byName['model-off'].modelInvocable).toBe(false)
    expect(byName['model-off'].userInvocable).toBe(true)
    expect(byName['user-off'].modelInvocable).toBe(true)
    expect(byName['user-off'].userInvocable).toBe(false)
    rmSync(INVOCATION_TMP, { recursive: true, force: true })
  })

  it('operator sees registry entries without a policy leave the parsed frontmatter untouched', async () => {
    // Given scanned skills plus registry candidates that carry no invocation
    // policy at all (the official registry accepts an undefined policy)
    writeInvocationFixtures()
    // When the skill center merges the registry over the scan
    const byName = await collectWith([
      { name: 'plain', description: 'registry', source: 'project-dsh', provider: 'filesystem' },
      { name: 'model-off', description: 'registry', source: 'project-dsh', provider: 'filesystem' },
      { name: 'user-off', description: 'registry', source: 'project-dsh', provider: 'filesystem' },
    ])
    // Then the frontmatter values survive instead of being replaced by a default
    expect(byName['plain'].modelInvocable).toBe(true)
    expect(byName['plain'].userInvocable).toBe(true)
    expect(byName['model-off'].modelInvocable).toBe(false)
    expect(byName['user-off'].userInvocable).toBe(false)
    rmSync(INVOCATION_TMP, { recursive: true, force: true })
  })

  it('operator sees an explicit registry policy refine an existing entry', async () => {
    // Given a scanned skill and a registry candidate stating a real policy
    writeInvocationFixtures()
    // When the skill center merges them
    const byName = await collectWith([
      {
        name: 'plain',
        description: 'registry',
        source: 'project-dsh',
        provider: 'filesystem',
        invocation: { modelInvocable: false, userInvocable: true },
      },
    ])
    // Then the stated policy wins over the parsed default
    expect(byName['plain'].modelInvocable).toBe(false)
    expect(byName['plain'].userInvocable).toBe(true)
    rmSync(INVOCATION_TMP, { recursive: true, force: true })
  })

  it('operator sees registry-only skills default to invocable when no policy is stated', async () => {
    // Given bundled skills with no editable file, one silent and one denied
    writeInvocationFixtures()
    // When the skill center serves the bundled group
    const byName = await collectWith([
      { name: 'bundled-bare', description: 'no policy', source: 'bundled', provider: 'orca' },
      {
        name: 'bundled-denied',
        description: 'explicitly denied',
        source: 'bundled',
        provider: 'orca',
        invocation: { modelInvocable: false, userInvocable: false },
      },
    ])
    // Then the silent one is invocable and the denied one is not
    expect(byName['bundled-bare'].modelInvocable).toBe(true)
    expect(byName['bundled-bare'].userInvocable).toBe(true)
    expect(byName['bundled-denied'].modelInvocable).toBe(false)
    expect(byName['bundled-denied'].userInvocable).toBe(false)
    rmSync(INVOCATION_TMP, { recursive: true, force: true })
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

describe('provider file vs virtual classification (#1842)', () => {
  /** Collect the shared fixture registry over the shared roots. */
  const collect = async () => {
    const { skills } = await collectSkills({
      cwd: PROJ,
      projectRoots: [PROJ],
      customSkillDirs: [CUSTOM],
      dshHome: HOME,
      agentsHome: AGENTS,
      registry,
    })
    return Object.fromEntries(skills.map((s) => [s.name, s]))
  }

  it('operator sees a provider-supplied file classified apart from a virtual registration', async () => {
    // Given a bundled entry whose provider reports a real instruction file and
    // a runtime entry that reports none
    const byName = await collect()

    // When the panel classifies them
    // Then they are told apart instead of both claiming "no local file"
    expect(byName['computer-use'].fileState).toBe('provider-file')
    expect(byName['embedded-hello'].fileState).toBe('virtual')
    expect(byName['computer-use'].fileState).not.toBe(byName['embedded-hello'].fileState)
  })

  it('operator sees a scanned skill classified editable', async () => {
    // Given a skill the filesystem scan resolved
    const byName = await collect()

    // When the panel classifies it
    // Then it is editable, which is the only state that carries a writable path
    expect(byName['poc-first'].fileState).toBe('editable')
    expect(byName['poc-first'].path).toBe(join(PROJ, '.dsh', 'skills', 'poc-first', 'SKILL.md'))
  })

  it('operator gets no writable path for either pathless classification', async () => {
    // Given the provider-file entry and the virtual entry
    const byName = await collect()

    // When the panel serves them
    // Then neither carries a path, so the write routes cannot be addressed at
    // all — the classification is display-only and never widens that trust
    expect(byName['computer-use'].path).toBeUndefined()
    expect(byName['embedded-hello'].path).toBeUndefined()
  })

  it('operator sees a provider resource directory alone not misread as a file', async () => {
    // Given a registration that reports only a resourceBase directory (the
    // official shape names relative resources, not an instruction file)
    const { skills } = await collectSkills({
      cwd: PROJ,
      projectRoots: [PROJ],
      customSkillDirs: [],
      dshHome: HOME,
      agentsHome: AGENTS,
      registry: {
        snapshot: async () => ({
          skills: [{
            name: 'resource-only',
            description: '资源目录但不是文件',
            source: 'bundled',
            provider: 'orca',
            resourceBase: { kind: 'directory', path: join(TMP, 'resources', 'resource-only') },
          }],
          complete: true,
        }),
      },
    })

    // When the panel classifies it
    // Then it stays virtual rather than claiming a file it does not have
    expect(skills.find((s) => s.name === 'resource-only')?.fileState).toBe('virtual')
    expect(skills.find((s) => s.name === 'resource-only')?.path).toBeUndefined()
  })

  it('operator sees a blank provider path treated as no file', async () => {
    // Given a provider that reports an empty path string
    const { skills } = await collectSkills({
      cwd: PROJ,
      projectRoots: [PROJ],
      customSkillDirs: [],
      dshHome: HOME,
      agentsHome: AGENTS,
      registry: {
        snapshot: async () => ({
          skills: [{ name: 'blank-path', description: '空路径', source: 'runtime', provider: 'runtime', path: '   ' }],
          complete: true,
        }),
      },
    })

    // When the panel classifies it
    // Then the blank is not a file
    expect(skills.find((s) => s.name === 'blank-path')?.fileState).toBe('virtual')
  })
})

describe('panel switches for plugin-provided skills (#1854)', () => {
  /** Collect the shared fixture registry over the shared roots, plus a store. */
  const collectWithStore = async (providerDisabledSkills: Array<{ name: string; provider: string }>) => {
    const { skills } = await collectSkills({
      cwd: PROJ,
      projectRoots: [PROJ],
      customSkillDirs: [CUSTOM],
      dshHome: HOME,
      agentsHome: AGENTS,
      registry,
      providerDisabledSkills,
    })
    return Object.fromEntries(skills.map((s) => [s.name, s]))
  }

  it('operator sees a switched-off plugin-provided skill reported as not model invocable', async () => {
    // Given the panel store holding the provider skill the user switched off
    const byName = await collectWithStore([{ name: 'computer-use', provider: 'orca' }])

    // When the collection is served
    // Then the row reads as switched off, exactly like a skill whose own
    // frontmatter disables model invocation, and it keeps its own classification
    expect(byName['computer-use'].modelInvocable).toBe(false)
    expect(byName['computer-use'].fileState).toBe('provider-file')
    // And the provider's own user-invocable policy is untouched
    expect(byName['computer-use'].userInvocable).toBe(false)
    // Meanwhile the rows with no record stay invocable
    expect(byName['embedded-hello'].modelInvocable).toBe(true)
    expect(byName['poc-first'].modelInvocable).toBe(true)
  })

  it('operator sees a store record never reach a skill that has its own file', async () => {
    // Given a store record naming a scanned skill (whose own switch rewrites
    // the SKILL.md frontmatter instead)
    const byName = await collectWithStore([{ name: 'user-tool', provider: 'filesystem' }])

    // When the collection is served
    // Then the scanned row is untouched: the store speaks only for provider rows
    expect(byName['user-tool'].modelInvocable).toBe(true)
    expect(byName['user-tool'].fileState).toBe('editable')
    expect(byName['user-tool'].path).toBe(join(HOME, 'skills', 'user-tool', 'SKILL.md'))
  })

  it('operator sees a store record naming a virtual registration change nothing', async () => {
    // Given a store record for a registration that reports no file at all
    const byName = await collectWithStore([{ name: 'embedded-hello', provider: 'runtime' }])

    // When the collection is served
    // Then it stays as the registry reported it
    expect(byName['embedded-hello'].modelInvocable).toBe(true)
    expect(byName['embedded-hello'].fileState).toBe('virtual')
  })

  it('operator sees a store record naming a skill the panel does not list change nothing', async () => {
    // Given a stale record for a plugin that is no longer installed
    const byName = await collectWithStore([{ name: 'gone-skill', provider: 'orca' }])

    // When the collection is served
    // Then no listed row is affected, including the same-named one
    expect(byName['computer-use'].modelInvocable).toBe(true)
    expect(byName['gone-skill']).toBeUndefined()
  })

  it('operator sees a store record from a different provider leave the row alone', async () => {
    // Given a record for the same skill name but another provider
    const byName = await collectWithStore([{ name: 'computer-use', provider: 'other-plugin' }])

    // When the collection is served
    // Then the identity is the pair, so the listed row keeps its state
    expect(byName['computer-use'].modelInvocable).toBe(true)
  })
})

describe('official acceptance and precedence (aligned with dsh-skill)', () => {
  it('operator sees a file the official provider discards left out of the panel', async () => {
    // Given project roots holding one valid skill, one file without
    // frontmatter, and one whose frontmatter omits the description
    const tmp = mkdtempSync(join(tmpdir(), 'skill-explorer-accept-'))
    const proj = join(tmp, 'proj')
    write(join(proj, '.git', 'keep'), '')
    write(join(proj, '.dsh', 'skills', 'good-skill', 'SKILL.md'), '---\nname: good-skill\ndescription: 合法技能\n---\n')
    write(join(proj, '.dsh', 'skills', 'no-front', 'SKILL.md'), '# 无 frontmatter\n')
    write(join(proj, '.dsh', 'skills', 'no-desc', 'SKILL.md'), '---\nname: no-desc\n---\n')
    // When the skill center collects the roots
    const { skills } = await collectSkills({
      cwd: proj,
      projectRoots: [proj],
      customSkillDirs: [],
      dshHome: join(tmp, 'home'),
      agentsHome: join(tmp, 'agents'),
      registry: { snapshot: async () => ({ skills: [], complete: true }) },
    })
    // Then only the officially loadable skill is listed
    const names = skills.map((s) => s.name)
    expect(names).toEqual(['good-skill'])
    rmSync(tmp, { recursive: true, force: true })
  })

  it('operator sees the official skill-name grammar honoured across the routes and the scan', () => {
    // Given names the official isSkillName accepts and rejects
    // When the shared guard is consulted
    // Then it matches the official grammar exactly (no leading/trailing/doubled hyphen)
    expect(isSkillName('ok-skill')).toBe(true)
    expect(isSkillName('a')).toBe(true)
    expect(isSkillName('1x-2y')).toBe(true)
    expect(isSkillName('a-')).toBe(false)
    expect(isSkillName('-a')).toBe(false)
    expect(isSkillName('a--b')).toBe(false)
    expect(isSkillName('A-b')).toBe(false)
    expect(isSkillName('a_b')).toBe(false)
  })

  it('operator sees a runtime registration outrank a scanned user skill of the same name', async () => {
    // Given a user skill and a same-name runtime candidate the official
    // registry ranks higher (runtime 250 < user-agents 500)
    const tmp = mkdtempSync(join(tmpdir(), 'skill-explorer-rank-'))
    const proj = join(tmp, 'proj')
    const agents = join(tmp, 'agents')
    write(join(proj, '.git', 'keep'), '')
    write(join(agents, 'skills', 'dup-skill', 'SKILL.md'), '---\nname: dup-skill\ndescription: 用户版本\n---\n')
    // When the skill center merges the registry over the scan
    const { skills } = await collectSkills({
      cwd: proj,
      projectRoots: [proj],
      customSkillDirs: [],
      dshHome: join(tmp, 'home'),
      agentsHome: agents,
      registry: {
        snapshot: async () => ({
          skills: [{ name: 'dup-skill', description: '运行时版本', source: 'runtime', provider: 'runtime' }],
          complete: true,
        }),
      },
    })
    // Then the official winner (runtime) is the entry shown
    const winner = skills.find((s) => s.name === 'dup-skill')
    expect(winner?.level).toBe('runtime')
    expect(winner?.description).toBe('运行时版本')
    rmSync(tmp, { recursive: true, force: true })
  })

  it('operator still sees a scanned project skill outrank a same-name bundled candidate', async () => {
    // Given a project skill and a same-name bundled candidate the official
    // registry ranks lower (project-dsh 100 < bundled 600)
    const tmp = mkdtempSync(join(tmpdir(), 'skill-explorer-rank2-'))
    const proj = join(tmp, 'proj')
    write(join(proj, '.git', 'keep'), '')
    write(join(proj, '.dsh', 'skills', 'dup2-skill', 'SKILL.md'), '---\nname: dup2-skill\ndescription: 项目版本\n---\n')
    // When the skill center merges the registry over the scan
    const { skills } = await collectSkills({
      cwd: proj,
      projectRoots: [proj],
      customSkillDirs: [],
      dshHome: join(tmp, 'home'),
      agentsHome: join(tmp, 'agents'),
      registry: {
        snapshot: async () => ({
          skills: [{ name: 'dup2-skill', description: '内置版本', source: 'bundled', provider: 'dsh-office' }],
          complete: true,
        }),
      },
    })
    // Then the project entry wins and keeps its editable path
    const winner = skills.find((s) => s.name === 'dup2-skill')
    expect(winner?.level).toBe('project-dsh')
    expect(winner?.description).toBe('项目版本')
    expect(winner?.path).toBe(join(proj, '.dsh', 'skills', 'dup2-skill', 'SKILL.md'))
    rmSync(tmp, { recursive: true, force: true })
  })

  it('operator never sees the user .dsh .system directory listed', async () => {
    // Given a user dsh root carrying the reserved .system directory beside a real skill
    const tmp = mkdtempSync(join(tmpdir(), 'skill-explorer-system-'))
    const proj = join(tmp, 'proj')
    const home = join(tmp, 'home')
    write(join(proj, '.git', 'keep'), '')
    write(join(home, 'skills', 'real-skill', 'SKILL.md'), '---\nname: real-skill\ndescription: 真实技能\n---\n')
    // The reserved entry is a directory literally named .system under the user
    // root, holding its own SKILL.md at that level — the shape the official
    // provider's skipSystem guards. Nesting it any deeper would make the case
    // pass vacuously, because neither reader descends two levels.
    write(join(home, 'skills', '.system', 'SKILL.md'), '---\nname: internal-skill\ndescription: 内部记录\n---\n')
    // When the skill center collects the roots
    const { skills } = await collectSkills({
      cwd: proj,
      projectRoots: [proj],
      customSkillDirs: [],
      dshHome: home,
      agentsHome: join(tmp, 'agents'),
      registry: { snapshot: async () => ({ skills: [], complete: true }) },
    })
    // Then only the real skill is listed
    expect(skills.map((s) => s.name)).toEqual(['real-skill'])
    rmSync(tmp, { recursive: true, force: true })
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


describe('custom skill roots from the live skill-filesystem row (#1801)', () => {
  it('operator sees the provider row customSkillDirs scanned with an editable path', async () => {
    // Given custom roots declared on the skill-filesystem loader row (the
    // official documented placement) and NOT on this plugin's own config
    const rowRoot = join(TMP, 'row-custom')
    write(join(rowRoot, 'row-alpha', 'SKILL.md'), '---\nname: row-alpha\ndescription: 行配置的技能\n---\n')
    write(join(rowRoot, 'row-beta', 'SKILL.md'), '---\nname: row-beta\ndescription: 另一个行配置技能\n---\n')
    const loaderEntries = [
      {
        options: { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem', config: { customSkillDirs: [rowRoot] } },
        fiber: { config: { customSkillDirs: [rowRoot] } },
      },
    ]

    // When the host resolves the custom roots the panel must scan
    const dirs = normalizeSkillRoots(customSkillDirsFromLoader(loaderEntries))
    const { skills } = await collectSkills({
      cwd: PROJ,
      projectRoots: [PROJ],
      customSkillDirs: dirs,
      dshHome: HOME,
      agentsHome: AGENTS,
      registry,
    })

    // Then both row-declared skills are listed in the custom group WITH the
    // path the write routes need, so the row controls are not dead
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]))
    expect(byName['row-alpha'].level).toBe('custom')
    expect(byName['row-alpha'].path).toBe(join(rowRoot, 'row-alpha', 'SKILL.md'))
    expect(byName['row-beta'].level).toBe('custom')
    expect(byName['row-beta'].path).toBe(join(rowRoot, 'row-beta', 'SKILL.md'))
  })

  it('operator sees blank and duplicated custom roots collapse to one absolute scan', () => {
    // Given a list mixing blanks, a relative entry and a duplicate
    const configured = ['', '   ', CUSTOM, CUSTOM, 'relative-skills']

    // When the host normalizes the configured roots
    const dirs = normalizeSkillRoots(configured)

    // Then blanks are dropped, duplicates collapse, and each root is absolute
    expect(dirs).toEqual([CUSTOM, join(process.cwd(), 'relative-skills')])
  })

  it('operator on a host whose loader row is not skill-filesystem sees no borrowed roots', () => {
    // Given rows that belong to other plugins
    const entries = [
      { options: { id: 'skill-badge', name: '@deepseek-ai/dsh-skill-badge', config: { customSkillDirs: ['/should/not/leak'] } } },
      { options: { id: 'no-name' } },
    ]

    // When the host reads custom roots off those rows
    const dirs = customSkillDirsFromLoader(entries)

    // Then nothing is borrowed from them
    expect(dirs).toEqual([])
  })

  it('operator whose loader tree throws mid-reload still gets a served list', () => {
    // Given an entry tree that throws while being enumerated
    function* throwing(): Generator<never> {
      throw new Error('loader mid-reload')
    }

    // When the host reads custom roots off that tree
    const dirs = customSkillDirsFromLoader(throwing())

    // Then the extractor degrades instead of failing the scan
    expect(dirs).toEqual([])
  })

  it('operator sees the resolved fiber config contribute a root the raw config cannot express', () => {
    // Given a row whose customSkillDirs arrives only through the resolved
    // fiber config (the loader interpolates a !!js expression there)
    const resolvedRoot = join(TMP, 'resolved-custom')
    const entries = [
      {
        options: { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem', config: { customSkillDirs: [] } },
        fiber: { config: { customSkillDirs: [resolvedRoot] } },
      },
    ]

    // When the host reads custom roots off the row
    const dirs = normalizeSkillRoots(customSkillDirsFromLoader(entries))

    // Then the resolved root is read
    expect(dirs).toEqual([resolvedRoot])
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