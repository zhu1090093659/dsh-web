/**
 * Service orchestration: inventory decoration and toggle flows (live apply,
 * patch persistence, ledger fallback, protection, and group refusal) against
 * injected fakes and temp directories.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginLedger } from '../src/core/ledger.ts'
import { PatchFileEditor, type PatchFileIo } from '../src/core/patch-file.ts'
import { PluginManagerService, type PluginManagerDeps } from '../src/core/service.ts'
import type { LoaderEntryLike, LoaderLike } from '../src/loader-types.ts'

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

function entry(id: string, name: string, extra: Partial<LoaderEntryLike> = {}): LoaderEntryLike {
  return {
    id,
    disabled: false,
    options: { name },
    update: vi.fn(async () => {}),
    ...extra,
  } as LoaderEntryLike
}

function failingPatchIo(): PatchFileIo {
  return {
    readFile: async () => { throw new Error('disk gone') },
    writeFileAtomic: async () => { throw new Error('disk gone') },
  }
}

interface Env {
  service: PluginManagerService
  deps: PluginManagerDeps
  entries: LoaderEntryLike[]
  patchFiles: Map<string, string>
  patchPath: string
}

async function makeEnv(entries: LoaderEntryLike[], options: { patchIo?: PatchFileIo } = {}): Promise<Env> {
  const dshHome = await tempDir('dsh-pm-service-')
  const patchFiles = new Map<string, string>()
  const deps: PluginManagerDeps = {
    loader: { entries: () => entries, await: async () => {} } as LoaderLike,
    ownEntryId: 'plugin-manager',
    protectedEntryIds: ['include'],
    protectedModuleNames: ['cordis:include', 'cordis:group', '@deepseek-ai/cordis-plugin-hmr'],
    patch: new PatchFileEditor(join(dshHome, 'cordis.patch.yml'), options.patchIo ?? {
      readFile: async (path) => {
        const text = patchFiles.get(path)
        if (text === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return text
      },
      writeFileAtomic: async (path, text) => { patchFiles.set(path, text) },
    }),
    ledger: new PluginLedger(join(dshHome, 'plugin-manager.json')),
  }
  return {
    service: new PluginManagerService(deps),
    deps,
    entries,
    patchFiles,
    patchPath: join(dshHome, 'cordis.patch.yml'),
  }
}

describe('PluginManagerService.list', () => {
  it('decorates rows and skips group entries', async () => {
    const entries = [
      entry('ui-task-board', '@linxin666/dsh-client-ui-task-board', { fiber: { state: 2 } }),
      entry('include', 'cordis:include', { disabled: true }),
      entry('group', 'cordis:group', { options: { name: 'cordis:group', group: true } }),
    ]
    const env = await makeEnv(entries)
    const result = env.service.list()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.entries).toHaveLength(2)
    const board = result.value.entries.find(row => row.entryId === 'ui-task-board')
    expect(board).toMatchObject({
      moduleName: '@linxin666/dsh-client-ui-task-board',
      enabled: true,
      fiberPhase: 'active',
      protected: false,
      official: false,
    })
    const include = result.value.entries.find(row => row.entryId === 'include')
    expect(include).toMatchObject({ enabled: false, protected: true })
  })

  it('projects disabled and failed states', async () => {
    const env = await makeEnv([
      entry('a', './a.mjs', { disabled: true }),
      entry('b', './b.mjs', { fiber: { state: 3 } }),
    ])
    const result = env.service.list()
    if (!result.ok) return
    expect(result.value.entries.find(row => row.entryId === 'a')?.enabled).toBe(false)
    expect(result.value.entries.find(row => row.entryId === 'b')?.fiberPhase).toBe('failed')
  })
})

describe('PluginManagerService.setEnabled', () => {
  it('disables live and persists through the patch layer', async () => {
    const target = entry('ui-task-board', '@linxin666/dsh-client-ui-task-board')
    const env = await makeEnv([target])
    const result = await env.service.setEnabled('ui-task-board', false)
    expect(result).toMatchObject({ ok: true, value: { applied: true, persisted: true, deferred: false } })
    expect(target.update).toHaveBeenCalledWith({ disabled: true })
    expect([...env.patchFiles.values()][0]).toContain('disabled: true')
  })

  it('enables by removing the override', async () => {
    const target = entry('ui-task-board', '@linxin666/dsh-client-ui-task-board', { disabled: true })
    const env = await makeEnv([target])
    env.patchFiles.set(env.patchPath, '- id: ui-task-board\n  disabled: true\n')
    const result = await env.service.setEnabled('ui-task-board', true)
    expect(result).toMatchObject({ ok: true, value: { applied: true, persisted: true } })
    expect(target.update).toHaveBeenCalledWith({ disabled: false })
    expect(env.patchFiles.get(env.patchPath)).toBe('[]\n')
  })

  it('falls back to the ledger when live disable fails but the patch write works', async () => {
    const target = entry('ui-task-board', '@linxin666/dsh-client-ui-task-board')
    target.update = vi.fn(async () => { throw new Error('dispose failed') })
    const env = await makeEnv([target])
    const result = await env.service.setEnabled('ui-task-board', false)
    expect(result).toMatchObject({ ok: true, value: { applied: false, persisted: true, deferred: true } })
    expect([...env.patchFiles.values()][0]).toContain('disabled: true')
    expect(await env.deps.ledger.disableIntents()).toHaveLength(0)
  })

  it('falls back to the ledger when both live and patch fail for a disable', async () => {
    const target = entry('ui-task-board', '@linxin666/dsh-client-ui-task-board')
    target.update = vi.fn(async () => { throw new Error('dispose failed') })
    const env = await makeEnv([target], { patchIo: failingPatchIo() })
    const result = await env.service.setEnabled('ui-task-board', false)
    expect(result).toMatchObject({ ok: true, value: { applied: false, persisted: true, deferred: true } })
    expect(await env.deps.ledger.disableIntents()).toHaveLength(1)
  })

  it('refuses to defer an enable that failed live', async () => {
    const target = entry('ui-task-board', '@linxin666/dsh-client-ui-task-board', { disabled: true })
    target.update = vi.fn(async () => { throw new Error('apply failed') })
    const env = await makeEnv([target])
    const result = await env.service.setEnabled('ui-task-board', true)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('toggle-failed')
    expect(await env.deps.ledger.disableIntents()).toEqual([])
  })

  it('reports persisted false when live works but nothing durable lands', async () => {
    const target = entry('ui-task-board', '@linxin666/dsh-client-ui-task-board')
    const env = await makeEnv([target], { patchIo: failingPatchIo() })
    const result = await env.service.setEnabled('ui-task-board', true)
    expect(result).toMatchObject({ ok: true, value: { applied: true, persisted: false } })
  })

  it('refuses protected, unknown, and group entries', async () => {
    const group = entry('g', 'cordis:group', { options: { name: 'cordis:group', group: true } })
    const env = await makeEnv([entry('include', 'cordis:include'), group])
    const protectedResult = await env.service.setEnabled('include', false)
    expect(protectedResult.ok).toBe(false)
    if (protectedResult.ok) return
    expect(protectedResult.error.code).toBe('protected')
    const groupResult = await env.service.setEnabled('g', false)
    expect(groupResult.ok).toBe(false)
    if (groupResult.ok) return
    expect(groupResult.error.code).toBe('not-toggleable')
    const unknown = await env.service.setEnabled('nope', false)
    expect(unknown.ok).toBe(false)
    if (unknown.ok) return
    expect(unknown.error.code).toBe('unknown-entry')
  })
})