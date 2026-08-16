/**
 * Service orchestration: session lookup, catalog decoration, frontmatter
 * toggles, installs, and ledger-guarded uninstalls against injected fakes
 * and temp directories.
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SkillDefinition, SkillSummary } from '@deepseek-ai/dsh-skill'
import { SkillInstaller } from '../src/core/install.ts'
import { SkillLedger } from '../src/core/ledger.ts'
import { SkillManagerService, type SkillManagerDeps } from '../src/core/service.ts'

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

/** One fake registry skill. */
interface FakeSkill {
  summary: SkillSummary
  definition: SkillDefinition
}

function makeSkill(name: string, path: string | undefined, invocation?: Partial<SkillSummary['invocation']>): FakeSkill {
  const invocationFull = {
    modelInvocable: invocation?.modelInvocable ?? true,
    userInvocable: invocation?.userInvocable ?? true,
  }
  const summary: SkillSummary = {
    name,
    description: `Description of ${name}.`,
    invocation: invocationFull,
    source: path === undefined ? 'bundled' : 'user-dsh',
    provider: path === undefined ? 'filesystem' : 'filesystem',
  }
  const definition: SkillDefinition = {
    ...summary,
    content: 'body',
    ...path === undefined ? {} : { path },
  }
  return { summary, definition }
}

function fakeRegistry(skills: FakeSkill[]) {
  const byName = new Map(skills.map(skill => [skill.summary.name, skill]))
  return {
    async list() {
      return [...byName.values()].map(skill => skill.summary)
    },
    async get(name: string) {
      return byName.get(name)?.definition
    },
  }
}

interface Env {
  service: SkillManagerService
  dshHome: string
  ledger: SkillLedger
  cwd: string
  deps: SkillManagerDeps
}

async function makeEnv(skills: FakeSkill[], cwd?: string, live = false): Promise<Env> {
  const dshHome = await tempDir('dsh-sm-service-')
  const cwdDir = cwd ?? await tempDir('dsh-sm-service-cwd-')
  const ledger = new SkillLedger(join(dshHome, 'skill-manager.json'))
  const installer = new SkillInstaller({ dshHome, ledger })
  const deps: SkillManagerDeps = {
    sessions: {
      get(sessionId: string) {
        return sessionId === 's1' ? { header: { cwd: cwdDir } } : undefined
      },
    },
    agents: {
      get() {
        return live ? { session: { header: { cwd: cwdDir } } } : undefined
      },
    },
    skills: fakeRegistry(skills),
    ledger,
    dshHome,
    installer,
  }
  return { service: new SkillManagerService(deps), dshHome, ledger, cwd: cwdDir, deps }
}

async function writeSkillFile(dir: string, name: string, frontmatter = ''): Promise<string> {
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'SKILL.md')
  await writeFile(file, [
    '---',
    `name: ${name}`,
    'description: A demo skill.',
    frontmatter,
    '---',
    'body',
  ].filter(line => line !== '').join('\n'), 'utf8')
  return file
}

describe('SkillManagerService.list', () => {
  it('decorates rows with path, toggle, and install state', async () => {
    const dir = await tempDir('dsh-sm-service-skill-')
    const file = await writeSkillFile(dir, 'alpha')
    const env = await makeEnv([makeSkill('alpha', file), makeSkill('beta', undefined)])
    await env.ledger.record({ name: 'alpha', path: file, installedAt: 1 })
    const result = await env.service.list('s1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const alpha = result.value.skills.find(skill => skill.name === 'alpha')
    expect(alpha).toMatchObject({
      path: file,
      toggleable: true,
      installed: true,
      modelInvocable: true,
      userInvocable: true,
    })
    const beta = result.value.skills.find(skill => skill.name === 'beta')
    expect(beta).toMatchObject({ toggleable: false, installed: false })
  })

  it('fails for unknown sessions', async () => {
    const env = await makeEnv([])
    const result = await env.service.list('nope')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('session-not-found')
  })

  it('fails for sessions without a cwd', async () => {
    const env = await makeEnv([])
    env.deps.sessions.get = () => ({ header: {} })
    const result = await env.service.list('s1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('no-cwd')
  })
})

describe('SkillManagerService.toggle', () => {
  it('disables and re-enables a filesystem skill', async () => {
    const dir = await tempDir('dsh-sm-service-skill-')
    const file = await writeSkillFile(dir, 'alpha')
    const env = await makeEnv([makeSkill('alpha', file)])
    const off = await env.service.toggle('s1', 'alpha', false)
    expect(off).toMatchObject({ ok: true })
    const offText = await readFile(file, 'utf8')
    expect(offText).toContain('disable-model-invocation: true')
    expect(offText).toContain('user-invocable: false')
    const on = await env.service.toggle('s1', 'alpha', true)
    expect(on.ok).toBe(true)
    const onText = await readFile(file, 'utf8')
    expect(onText).not.toContain('disable-model-invocation')
    expect(onText).not.toContain('user-invocable')
  })

  it('rejects path-less skills', async () => {
    const env = await makeEnv([makeSkill('beta', undefined)])
    const result = await env.service.toggle('s1', 'beta', false)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('not-toggleable')
  })

  it('rejects unknown skills', async () => {
    const env = await makeEnv([])
    const result = await env.service.toggle('s1', 'nope', false)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('unknown-skill')
  })
})

describe('SkillManagerService.install', () => {
  it('installs and records the ledger', async () => {
    const src = await tempDir('dsh-sm-service-src-')
    await writeSkillFile(join(src, 'gamma'), 'gamma')
    const env = await makeEnv([])
    const result = await env.service.install('s1', { kind: 'dir', value: src }, 'user')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.entries[0]?.name).toBe('gamma')
    expect(existsSync(join(env.dshHome, 'skills', 'gamma', 'SKILL.md'))).toBe(true)
    expect(await env.ledger.has(join(env.dshHome, 'skills', 'gamma'))).toBe(true)
  })

  it('rejects bad source kinds', async () => {
    const env = await makeEnv([])
    const result = await env.service.install('s1', { kind: 'git', value: '' }, 'user')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('install-failed')
  })
})

describe('SkillManagerService.uninstall', () => {
  it('removes only ledger-recorded skills', async () => {
    const dir = await tempDir('dsh-sm-service-skill-')
    await writeSkillFile(dir, 'alpha')
    const file = join(dir, 'SKILL.md')
    const env = await makeEnv([makeSkill('alpha', file)])
    await env.ledger.record({ name: 'alpha', path: file, installedAt: 1 })
    const result = await env.service.uninstall('s1', 'alpha')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(existsSync(file)).toBe(false)
    expect(await env.ledger.has(file)).toBe(false)
  })

  it('uninstalls a directory bundle recorded by its directory path', async () => {
    const dir = await tempDir('dsh-sm-service-skill-')
    await writeSkillFile(dir, 'alpha')
    const file = join(dir, 'SKILL.md')
    const env = await makeEnv([makeSkill('alpha', file)])
    await env.ledger.record({ name: 'alpha', path: dir, installedAt: 1 })
    const result = await env.service.uninstall('s1', 'alpha')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.path).toBe(dir)
    expect(existsSync(dir)).toBe(false)
    expect(await env.ledger.has(file)).toBe(false)
  })

  it('refuses to delete skills the manager did not install', async () => {
    const dir = await tempDir('dsh-sm-service-skill-')
    const file = await writeSkillFile(dir, 'alpha')
    const env = await makeEnv([makeSkill('alpha', file)])
    const result = await env.service.uninstall('s1', 'alpha')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('not-installed')
    expect(existsSync(file)).toBe(true)
  })
})