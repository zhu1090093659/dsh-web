/**
 * Install planning and copying: directory bundles, flat files, git staging,
 * conflict and validation rejections, and ledger recording.
 */

import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillInstaller } from '../src/core/install.ts'
import { SkillLedger } from '../src/core/ledger.ts'

const dirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function writeSkillDir(root: string, name: string, extra = ''): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    'description: A demo skill.',
    '---',
    'body',
    extra,
  ].join('\n'), 'utf8')
  return dir
}

function makeInstaller(deps: Partial<{ runGit: (args: readonly string[]) => Promise<void>; tempDir: string }> = {}) {
  return async (): Promise<{ installer: SkillInstaller; dshHome: string; ledgerFile: string; ledger: SkillLedger }> => {
    const dshHome = await tempDir('dsh-sm-install-home-')
    const ledgerFile = join(dshHome, 'skill-manager.json')
    const ledger = new SkillLedger(ledgerFile)
    const installer = new SkillInstaller({
      dshHome,
      ledger,
      runGit: deps.runGit,
      tempDir: deps.tempDir,
    })
    return { installer, dshHome, ledgerFile, ledger }
  }
}

describe('SkillInstaller', () => {
  it('installs one directory bundle into the user root', async () => {
    const src = await tempDir('dsh-sm-install-src-')
    await writeSkillDir(src, 'alpha')
    const env = await makeInstaller()()
    const outcome = await env.installer.install({ kind: 'dir', value: src }, 'user', env.dshHome)
    expect(outcome).toMatchObject({ ok: true })
    if (!outcome.ok) return
    expect(outcome.entries[0]).toMatchObject({ name: 'alpha', kind: 'dir' })
    const target = join(env.dshHome, 'skills', 'alpha', 'SKILL.md')
    expect(existsSync(target)).toBe(true)
    expect(await env.ledger.has(join(env.dshHome, 'skills', 'alpha'))).toBe(true)
  })

  it('installs flat .md files keeping their file names', async () => {
    const src = await tempDir('dsh-sm-install-src-')
    await writeFile(join(src, 'flat.md'), '---\nname: flat-one\ndescription: Flat skill.\n---\nbody', 'utf8')
    const env = await makeInstaller()()
    const outcome = await env.installer.install({ kind: 'dir', value: src }, 'user', env.dshHome)
    expect(outcome).toMatchObject({ ok: true })
    if (!outcome.ok) return
    expect(existsSync(join(env.dshHome, 'skills', 'flat.md'))).toBe(true)
    expect(outcome.entries[0]).toMatchObject({ name: 'flat-one', kind: 'file' })
  })

  it('installs multiple subdirectories from one source', async () => {
    const src = await tempDir('dsh-sm-install-src-')
    await writeSkillDir(src, 'alpha')
    await writeSkillDir(src, 'beta')
    const env = await makeInstaller()()
    const outcome = await env.installer.install({ kind: 'dir', value: src }, 'user', env.dshHome)
    expect(outcome).toMatchObject({ ok: true })
    if (!outcome.ok) return
    expect(outcome.entries.map(entry => entry.name).sort()).toEqual(['alpha', 'beta'])
  })

  it('never copies .git directories', async () => {
    const src = await tempDir('dsh-sm-install-src-')
    const skill = await writeSkillDir(src, 'alpha')
    await mkdir(join(skill, '.git'), { recursive: true })
    await writeFile(join(skill, '.git', 'config'), 'x', 'utf8')
    const env = await makeInstaller()()
    const outcome = await env.installer.install({ kind: 'dir', value: src }, 'user', env.dshHome)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(existsSync(join(env.dshHome, 'skills', 'alpha', '.git'))).toBe(false)
  })

  it('rejects invalid skill files', async () => {
    const src = await tempDir('dsh-sm-install-src-')
    await writeFile(join(src, 'bad.md'), 'no frontmatter here', 'utf8')
    const env = await makeInstaller()()
    const outcome = await env.installer.install({ kind: 'dir', value: src }, 'user', env.dshHome)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('invalid skill')
  })

  it('rejects duplicate names inside one source', async () => {
    const src = await tempDir('dsh-sm-install-src-')
    await writeSkillDir(src, 'alpha')
    await writeFile(join(src, 'alpha.md'), '---\nname: alpha\ndescription: Duplicate.\n---\nbody', 'utf8')
    const env = await makeInstaller()()
    const outcome = await env.installer.install({ kind: 'dir', value: src }, 'user', env.dshHome)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('duplicate skill name')
  })

  it('rejects a name conflict with existing skills in the target root', async () => {
    const src = await tempDir('dsh-sm-install-src-')
    await writeSkillDir(src, 'alpha')
    const env = await makeInstaller()()
    await writeSkillDir(join(env.dshHome, 'skills'), 'alpha')
    const outcome = await env.installer.install({ kind: 'dir', value: src }, 'user', env.dshHome)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('name conflict')
  })

  it('installs into the workspace root under the project .agents/skills', async () => {
    const project = await tempDir('dsh-sm-install-project-')
    await mkdir(join(project, '.git'))
    await mkdir(join(project, 'work'), { recursive: true })
    const src = await tempDir('dsh-sm-install-src-')
    await writeSkillDir(src, 'alpha')
    const env = await makeInstaller()()
    const outcome = await env.installer.install({ kind: 'dir', value: src }, 'workspace', join(project, 'work'))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(existsSync(join(project, '.agents', 'skills', 'alpha', 'SKILL.md'))).toBe(true)
  })

  it('clones git sources through the injected runner and cleans staging', async () => {
    const staging = await tempDir('dsh-sm-install-staging-')
    const clones: string[][] = []
    const runGit = async (args: readonly string[]): Promise<void> => {
      clones.push([...args])
      const target = args[4]
      if (target === undefined) throw new Error('no clone target')
      await writeSkillDir(target, 'alpha')
    }
    const env = await makeInstaller({ runGit, tempDir: staging })()
    const outcome = await env.installer.install({ kind: 'git', value: 'https://example.com/repo.git' }, 'user', env.dshHome)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(clones[0]).toEqual(['clone', '--depth', '1', 'https://example.com/repo.git', expect.stringContaining('repo')])
    expect(existsSync(join(env.dshHome, 'skills', 'alpha', 'SKILL.md'))).toBe(true)
    expect(readdirSync(staging)).toHaveLength(0)
  })

  it('rejects git sources without a git runner', async () => {
    const env = await makeInstaller()()
    const outcome = await env.installer.install({ kind: 'git', value: 'https://example.com/repo.git' }, 'user', env.dshHome)
    expect(outcome.ok).toBe(false)
  })

  it('rejects a missing source directory', async () => {
    const env = await makeInstaller()()
    const outcome = await env.installer.install({ kind: 'dir', value: join(env.dshHome, 'nope') }, 'user', env.dshHome)
    expect(outcome.ok).toBe(false)
  })
})