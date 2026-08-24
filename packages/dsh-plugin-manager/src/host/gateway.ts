/**
 * The CLI gateway: installs and removals executed by spawning the official
 * `dsh plugin --profile <name> add|remove` CLI — the single writer for the
 * profile — with a bounded job table the HTTP layer polls. Every run captures
 * a layer snapshot before and after so the caller can render exactly what the
 * CLI changed (the conflict ledger). The npm web runtime has no installer
 * service, so this gateway is its write path; on runtimes with official
 * channels the browser half never calls it.
 * @module @linxin666/dsh-client-ui-plugin-manager/host
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import type { InstalledPluginItem } from '../core/protocol.ts'
import type { ControlChange } from '../core/conflict.ts'
import { diffLayer, overlappingIds, significantChanges, type LayerChange, type LayerSnapshot } from '../core/patch-diff.ts'
import { duplicateMountBundles } from './bundle-guard.ts'
import { readProfileManifest, reorderProfileBundle, stripProfileBundles, type ProfileFacts } from './profile.ts'
import { insertRowsOf, parsePatch, bareRowEnabled, bareRowId } from './rows.ts'
import { buildPluginRow, claimedEntryIdsOf } from './state.ts'

/** Hard deadline for one CLI add (git clones can take minutes). */
const ADD_TIMEOUT_MS = 6 * 60_000
/** Hard deadline for one CLI remove. */
const REMOVE_TIMEOUT_MS = 2 * 60_000
/** Bounded capture of the CLI output (the tail survives). */
const MAX_OUTPUT_CHARS = 32_000
/** Ring cap on finished jobs: the newest 100 settled jobs stay queryable; the oldest finished job is evicted beyond the cap so the job table cannot grow without bound. In-progress jobs are never evicted. */
const MAX_FINISHED_JOBS = 100

/**
 * Shell command-chaining metacharacters that must never reach a spawned CLI
 * argument. The gateway spawns shell-free, but the official CLI forwards to
 * pnpm with a cmd.exe shell on Windows, so a spec carrying these can still be
 * re-parsed one layer down (a failed install reported as success, or worse).
 */
const UNSAFE_SPEC_CHARS = /[&|<>"'`%!\n\r\0]/

/**
 * Validate an install spec or package id against shell metacharacters.
 * @param spec - the user-supplied spec or id.
 * @returns the rejection message, or undefined when the spec is safe.
 */
export function unsafeSpecReason(spec: string): string | undefined {
  return UNSAFE_SPEC_CHARS.test(spec)
    ? 'plugin-manager: spec 含有危险的 shell 元字符或控制字符，已拒绝'
    : undefined
}

/** One CLI-backed operation in flight or settled. */
export interface GatewayJob {
  id: string
  action: 'install' | 'update' | 'migrate' | 'remove'
  spec: string
  /** Installed package ID for an in-place npm update. */
  targetId?: string
  /** Exact registry version the update must land on. */
  targetVersion?: string
  /** Legacy package being migrated away from. */
  sourceId?: string
  /** Exact install spec for the target package. */
  targetSpec?: string
  phase: 'running' | 'done' | 'error'
  /** The installed row on success (install) or the removed row (remove). */
  plugin?: InstalledPluginItem
  /** Layer changes the CLI applied, normalized for the conflict panel. */
  conflicts?: ControlChange[]
  /**
   * Duplicate-mount safeguard notices: bundles entries the CLI's
   * reconciliation added but the composition already mounted through a patch
   * row, stripped back out so the next boot cannot double-mount. Each notice
   * carries the conflict-row shape (the entry left the bundles layer:
   * enabled -> uninstalled) so the tab can render it with the existing rows;
   * the package itself stays installed and row-mounted.
   */
  notices?: ControlChange[]
  error?: string
}

/** The binary search roots for the dsh CLI. */
export function findDshBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  exists: (path: string) => boolean = existsSync,
  hostEntryPath: string | undefined = process.argv[1],
): string | null {
  const candidates: string[] = []
  const separator = platform === 'win32' ? ';' : ':'
  const pathApi = platform === 'win32' ? win32 : posix
  for (const dir of (env.PATH ?? '').split(separator)) {
    if (dir === '') continue
    if (platform === 'win32') {
      candidates.push(`${dir}\\dsh.cmd`, `${dir}\\dsh.exe`)
    } else {
      candidates.push(`${dir}/dsh`)
    }
  }
  // A local wrapper or npx launch may omit its node_modules/.bin directory
  // from PATH. Walk up from the actual host entry script and probe each npm
  // project root without guessing from the DSH_HOME profile location.
  if (hostEntryPath !== undefined && hostEntryPath !== '') {
    let current = pathApi.dirname(hostEntryPath)
    for (let depth = 0; depth < 10; depth += 1) {
      const binDir = pathApi.join(current, 'node_modules', '.bin')
      if (platform === 'win32') candidates.push(pathApi.join(binDir, 'dsh.cmd'), pathApi.join(binDir, 'dsh.exe'))
      else candidates.push(pathApi.join(binDir, 'dsh'))
      const parent = pathApi.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  if (platform === 'darwin') {
    candidates.push('/opt/homebrew/bin/dsh', '/usr/local/bin/dsh')
  }
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return null
}

/** Append bounded CLI output (stdout + stderr interleaved is not preserved; tail wins). */
function capture(chunk: Buffer, buffer: { value: string }): void {
  buffer.value = (buffer.value + chunk.toString()).slice(-MAX_OUTPUT_CHARS)
}

/**
 * The spawn command for the dsh CLI on this platform. Windows runs the
 * npm-generated dsh.cmd wrapper by resolving its node binary and bin.js script
 * and spawning them directly: going through cmd.exe splits unquoted paths with
 * spaces (`'D:\Program' is not recognized`).
 * @param binary - the dsh CLI path found by {@link findDshBinary}.
 * @param platform - process platform (test seam).
 * @param localNodeExists - existence probe (test seam).
 * @param binJsExists - existence probe for the resolved bin script (test seam).
 * @returns the executable and the argument prefix to run the dsh bin script.
 */
export function dshSpawnCommand(
  binary: string,
  platform: string = process.platform,
  localNodeExists: (path: string) => boolean = existsSync,
  binJsExists: (path: string) => boolean = existsSync,
): { command: string; argsPrefix: string[] } {
  if (platform !== 'win32') return { command: binary, argsPrefix: [] }
  // Windows paths must be parsed with win32 semantics even when the probing
  // host is POSIX (unit tests, and any future cross-platform probing).
  const dir = win32.dirname(binary)
  const localNode = win32.join(dir, 'node.exe')
  // The npm-global layout keeps the package next to the dsh.cmd shim
  // (node_modules/@deepseek-ai/dsh); the npx layout puts shims in
  // node_modules/.bin with the package one level above (issue #683). Probe
  // both and fall back to the npm-global shape when neither exists yet.
  const binJsCandidates = [
    win32.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    win32.join(dir, '..', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ]
  const binJs = binJsCandidates.find((candidate) => binJsExists(candidate))
  if (binJs === undefined) return { command: binary, argsPrefix: [] }
  return { command: localNodeExists(localNode) ? localNode : process.execPath, argsPrefix: [binJs] }
}

/** Build the exact cmd.exe command line required to execute a trusted .cmd shim. */
export function windowsCmdShimArgs(binary: string, args: readonly string[]): string[] {
  const unsafe = /[&|<>"'`%!\n\r\0]/
  if (/["%\n\r\0]/.test(binary) || args.some(arg => unsafe.test(arg))) {
    throw new Error('plugin-manager: unsafe Windows command argument')
  }
  const commandLine = `""${binary}" ${args.map(arg => `"${arg}"`).join(' ')}"`
  return ['/d', '/s', '/c', commandLine]
}

/** Spawn the dsh CLI with piped stdio and no shell parsing (see {@link dshSpawnCommand}). */
export function spawnDsh(binary: string, args: string[], env: NodeJS.ProcessEnv) {
  const { command, argsPrefix } = dshSpawnCommand(binary)
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    return spawn('cmd.exe', windowsCmdShimArgs(command, args), {
      env,
      windowsVerbatimArguments: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  return spawn(command, [...argsPrefix, ...args], {
    env: command === process.execPath ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * Entry-id line of the official installer channels in the boot dump. A plain
 * substring probe false-positives on any unrelated entry whose id, name, or
 * config mentions the mark, so only a real `id:` row counts.
 */
const OFFICIAL_INSTALLER_PATTERN = /^\s*-?\s*id:\s*['"]?plugin-(?:installer|control)['"]?\s*$/m

/**
 * Detect whether the official installer channels exist on this runtime by
 * dumping the boot composition once: the npm-published web never contains
 * `plugin-installer` entries, DSHCode and the checkout web do. The browser
 * half reads the verdict from the `/mode` route so its channel probe never
 * has to hit the missing official route (which 405s into the console).
 * @param binary - dsh CLI path.
 * @param profileName - boot profile name.
 * @param env - process environment.
 * @param spawnImpl - spawn seam (test seam).
 * @returns true when the dump names the official installer channels.
 */
export async function detectOfficialChannels(
  binary: string,
  profileName: string,
  env: NodeJS.ProcessEnv = process.env,
  spawnImpl: typeof spawnDsh = spawnDsh,
): Promise<boolean> {
  const output = { value: '' }
  const child = spawnImpl(binary, ['--profile', profileName, '--dump-config'], env)
  child.stdout?.on('data', (chunk: Buffer) => { output.value = (output.value + chunk.toString()).slice(-MAX_OUTPUT_CHARS) })
  child.stderr?.on('data', (chunk: Buffer) => { output.value = (output.value + chunk.toString()).slice(-MAX_OUTPUT_CHARS) })
  const code = await new Promise<number | null>(resolve => { child.on('close', resolve) })
  if (code !== 0) return false
  return OFFICIAL_INSTALLER_PATTERN.test(output.value)
}

/** One layer snapshot plus the profile patch text and dependency list. */
interface CapturedState {
  layer: LayerSnapshot
  bundles: string[]
  /** Raw profile patch text (the duplicate-mount guard reads row names from it). */
  patchText: string
  dependencies: string[]
}

/** The gateway: serializes CLI operations through one job table and one mutation queue. */
export class CliGateway {
  private readonly jobs = new Map<string, GatewayJob>()
  /** Settlement order of finished jobs: the eviction ring keeps the newest {@link MAX_FINISHED_JOBS}. */
  private readonly finishedOrder: string[] = []
  private counter = 0
  /** Mutation queue: two CLI runs must never interleave their before/after captures. */
  private queue: Promise<void> = Promise.resolve()

  /**
   * @param facts - resolved profile locations.
   * @param env - process environment.
   * @param deps - spawn/binary seams (tests only; production uses the real CLI).
   */
  constructor(
    private readonly facts: ProfileFacts,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly deps: {
      spawnImpl?: typeof spawnDsh
      findBinary?: (env: NodeJS.ProcessEnv) => string | null
    } = {},
  ) {}

  /**
   * Run one profile mutation after every mutation already queued. The returned
   * promise keeps the task's own result or rejection, while the queue tail is
   * always recovered so one failed write cannot block later work. Routes that
   * edit profile files directly must use this seam so they cannot overlap the
   * CLI install/remove writer.
   */
  withMutationLock<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  /** Chain one fire-and-forget CLI mutation onto the shared queue. */
  private enqueue(task: () => Promise<void>): void {
    void this.withMutationLock(task).catch(() => {})
  }

  /** Register a settled job and evict the oldest finished one beyond the ring cap. */
  private retainFinished(jobId: string): void {
    this.finishedOrder.push(jobId)
    while (this.finishedOrder.length > MAX_FINISHED_JOBS) {
      const evicted = this.finishedOrder.shift()
      if (evicted !== undefined) this.jobs.delete(evicted)
    }
  }

  /** The dsh CLI path, through the test seam when present. */
  private binary(): string | null {
    return this.deps.findBinary !== undefined ? this.deps.findBinary(this.env) : findDshBinary(this.env)
  }

  /** Run one CLI command to completion and return the bounded output. */
  private async runCli(binary: string, args: string[], timeoutMs: number): Promise<{ code: number | null; output: string }> {
    const output = { value: '' }
    const child = this.spawnCli(binary, args)
    child.stdout?.on('data', (chunk: Buffer) => { capture(chunk, output) })
    child.stderr?.on('data', (chunk: Buffer) => { capture(chunk, output) })
    const timer = setTimeout(() => { child.kill() }, timeoutMs)
    const code = await new Promise<number | null>(resolve => { child.on('close', resolve) })
    clearTimeout(timer)
    return { code, output: output.value.trim() }
  }

  /** Full package spec used when restoring a legacy dependency. */
  private restoreSpec(name: string, spec: string): string {
    if (/^(?:link:|file:|git:|git\+|github:|https?:\/\/|npm:)/.test(spec)) return spec
    if (spec === '') return name
    return `${name}@${spec}`
  }

  /** Execute the legacy aggregate migration and settle the job. */
  private async runMigration(job: GatewayJob): Promise<void> {
    const binary = this.binary()
    if (binary === null) {
      job.phase = 'error'
      job.error = 'plugin-manager: dsh CLI not found on PATH'
      return
    }
    const sourceId = job.sourceId
    const targetId = job.targetId
    const targetVersion = job.targetVersion
    const targetSpec = job.targetSpec
    if (sourceId === undefined || targetId === undefined || targetVersion === undefined || targetSpec === undefined) {
      job.phase = 'error'
      job.error = 'plugin-manager: migration job is missing source/target identity'
      return
    }
    const before = await this.capture()
    if (!before.dependencies.includes(sourceId)) {
      job.phase = 'error'
      job.error = `plugin-manager: legacy aggregate ${sourceId} is not installed`
      return
    }
    const beforeManifest = await readProfileManifest(this.facts.packageJsonPath)
    const oldSpec = beforeManifest.dependencies[sourceId] ?? ''
    const oldIndex = before.bundles.indexOf(sourceId)
    const targetPreviouslyInstalled = before.dependencies.includes(targetId)

    const remove = await this.runCli(
      binary,
      ['plugin', '--profile', this.facts.profileName, 'remove', sourceId],
      REMOVE_TIMEOUT_MS,
    )
    if (remove.code !== 0) {
      job.phase = 'error'
      job.error = remove.output === ''
        ? `plugin-manager: dsh plugin remove ${sourceId} failed with code ${String(remove.code)}`
        : remove.output
      return
    }
    let after = await this.capture()
    if (after.dependencies.includes(sourceId)) {
      job.phase = 'error'
      job.error = `plugin-manager: dsh plugin remove 报告成功，但 ${sourceId} 仍在 profile 中`
      return
    }
    const targetIsLocal = /^(?:link:|file:)/.test(targetSpec)
    const shouldAddTarget = targetPreviouslyInstalled
      ? !targetIsLocal
      : !after.dependencies.includes(targetId)
    if (shouldAddTarget) {
      const add = await this.runCli(
        binary,
        ['plugin', '--profile', this.facts.profileName, 'add', targetSpec],
        ADD_TIMEOUT_MS,
      )
      if (add.code !== 0) {
        await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
        job.error = `plugin-manager: 迁移安装 ${targetSpec} 失败${add.output === '' ? '' : `：\n${add.output}`}`
        return
      }
      after = await this.capture()
    }
    if (!after.dependencies.includes(targetId)) {
      await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
      job.error = `plugin-manager: dsh plugin add 报告成功，但 ${targetId} 未出现在 profile 中`
      return
    }
    const stripped = await this.stripDuplicateMounts(job, before, after)
    if (stripped === undefined) {
      await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
      return
    }
    if (stripped.length > 0) {
      job.notices = stripped.map(name => ({ id: name, name, from: 'enabled', to: 'uninstalled' }))
      after = await this.capture()
    }
    if (oldIndex >= 0) await reorderProfileBundle(this.facts.packageJsonPath, targetId, oldIndex)
    after = await this.capture()

    const verify = await this.runCli(
      binary,
      ['--profile', this.facts.profileName, '--dump-config'],
      90_000,
    )
    if (verify.code !== 0) {
      await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
      job.error = `plugin-manager: 迁移后的启动预检失败${verify.output === '' ? '' : `：\n${verify.output}`}`
      return
    }
    const manifest = await readProfileManifest(this.facts.packageJsonPath)
    const updated = await buildPluginRow(
      this.facts,
      targetId,
      manifest.dependencies[targetId] ?? targetSpec,
      after.layer.rows,
    )
    // A local repository link is the developer checkout source: its version is
    // whatever the checked-out tree contains, not the registry release, so the
    // exact-version gate applies only to npm registry migrations.
    if (!/^(?:link:|file:)/.test(targetSpec) && updated.version !== targetVersion) {
      await this.rollbackMigration(job, sourceId, targetId, oldSpec, oldIndex, targetPreviouslyInstalled)
      job.error = `plugin-manager: 迁移后 ${targetId} 版本为 ${updated.version}，预期 ${targetVersion}`
      return
    }
    job.plugin = updated
    job.conflicts = significantChanges(diffLayer(before.layer, after.layer)).map(change => ({
      id: change.id,
      name: change.id,
      from: change.from,
      to: change.to,
    }))
    job.phase = 'done'
  }

  /** Restore the original legacy package after a failed migration. */
  private async rollbackMigration(
    job: GatewayJob,
    sourceId: string,
    targetId: string,
    oldSpec: string,
    oldIndex: number,
    targetPreviouslyInstalled: boolean,
  ): Promise<void> {
    const binary = this.binary()
    if (binary === null) {
      job.phase = 'error'
      job.error = 'plugin-manager: 迁移失败且无法回滚：dsh CLI not found on PATH'
      return
    }
    const current = await this.capture()
    if (!targetPreviouslyInstalled && current.dependencies.includes(targetId)) {
      await this.runCli(binary, ['plugin', '--profile', this.facts.profileName, 'remove', targetId], REMOVE_TIMEOUT_MS)
    }
    // If the current aggregate already existed before this migration, the
    // profile already had both bundles and was unusable. Keep the single
    // current aggregate on rollback instead of re-adding the legacy duplicate.
    if (targetPreviouslyInstalled) {
      job.phase = 'error'
      job.error = 'plugin-manager: 聚合包迁移失败，已保留当前聚合包并移除旧包'
      return
    }
    const restoreOld = this.restoreSpec(sourceId, oldSpec)
    const restored = await this.runCli(
      binary,
      ['plugin', '--profile', this.facts.profileName, 'add', restoreOld],
      ADD_TIMEOUT_MS,
    )
    if (restored.code !== 0) {
      job.phase = 'error'
      job.error = `plugin-manager: 迁移失败且回滚到 ${restoreOld} 失败${restored.output === '' ? '' : `：\n${restored.output}`}`
      return
    }
    if (oldIndex >= 0) {
      await reorderProfileBundle(this.facts.packageJsonPath, sourceId, oldIndex).catch(() => undefined)
    }
    job.phase = 'error'
    job.error = 'plugin-manager: 聚合包迁移失败，已回滚到旧包'
  }

  /** Spawn the CLI, through the test seam when present. */
  private spawnCli(binary: string, args: string[]) {
    return (this.deps.spawnImpl ?? spawnDsh)(binary, args, this.env)
  }

  /** Start an install; the caller polls {@link status}. */
  install(spec: string): { jobId: string } {
    const job: GatewayJob = { id: `job-${++this.counter}`, action: 'install', spec, phase: 'running' }
    this.jobs.set(job.id, job)
    const unsafe = unsafeSpecReason(spec)
    if (unsafe !== undefined) {
      job.phase = 'error'
      job.error = unsafe
      this.retainFinished(job.id)
      return { jobId: job.id }
    }
    this.enqueue(() => this.run(job, ['plugin', '--profile', this.facts.profileName, 'add', spec], ADD_TIMEOUT_MS))
    return { jobId: job.id }
  }

  /** Start an in-place npm update; the caller polls {@link status}. */
  update(id: string, version: string): { jobId: string } {
    const spec = `${id}@${version}`
    const job: GatewayJob = {
      id: `job-${++this.counter}`,
      action: 'update',
      spec,
      targetId: id,
      targetVersion: version,
      phase: 'running',
    }
    this.jobs.set(job.id, job)
    const unsafe = unsafeSpecReason(spec)
    if (unsafe !== undefined) {
      job.phase = 'error'
      job.error = unsafe
      this.retainFinished(job.id)
      return { jobId: job.id }
    }
    this.enqueue(() => this.run(job, ['plugin', '--profile', this.facts.profileName, 'add', spec], ADD_TIMEOUT_MS))
    return { jobId: job.id }
  }

  /** Start a deterministic legacy aggregate migration. */
  migrate(sourceId: string, targetId: string, targetVersion: string, targetSpec: string): { jobId: string } {
    const job: GatewayJob = {
      id: `job-${++this.counter}`,
      action: 'migrate',
      spec: targetSpec,
      sourceId,
      targetId,
      targetVersion,
      targetSpec,
      phase: 'running',
    }
    this.jobs.set(job.id, job)
    const unsafe = unsafeSpecReason(sourceId) ?? unsafeSpecReason(targetId) ?? unsafeSpecReason(targetSpec)
    if (unsafe !== undefined) {
      job.phase = 'error'
      job.error = unsafe
      this.retainFinished(job.id)
      return { jobId: job.id }
    }
    this.enqueue(async () => {
      try {
        await this.runMigration(job)
      } catch (error) {
        if (job.phase !== 'error') {
          job.phase = 'error'
          job.error = `plugin-manager: unexpected migration failure: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      this.retainFinished(job.id)
    })
    return { jobId: job.id }
  }

  /** Start a removal; the caller polls {@link status}. */
  remove(id: string): { jobId: string } {
    const job: GatewayJob = { id: `job-${++this.counter}`, action: 'remove', spec: id, phase: 'running' }
    this.jobs.set(job.id, job)
    const unsafe = unsafeSpecReason(id)
    if (unsafe !== undefined) {
      job.phase = 'error'
      job.error = unsafe
      this.retainFinished(job.id)
      return { jobId: job.id }
    }
    this.enqueue(() => this.run(job, ['plugin', '--profile', this.facts.profileName, 'remove', id], REMOVE_TIMEOUT_MS))
    return { jobId: job.id }
  }

  /**
   * Read one job's current state (a shallow copy). Finished jobs beyond the
   * ring cap are evicted and read as not-found, the same as an id that never
   * existed.
   */
  status(jobId: string): GatewayJob | undefined {
    const job = this.jobs.get(jobId)
    if (job === undefined) return undefined
    return {
      ...job,
      conflicts: job.conflicts === undefined ? undefined : [...job.conflicts],
      notices: job.notices === undefined ? undefined : [...job.notices],
    }
  }

  /** Capture the layer snapshot and the dependency names (tolerant parse). */
  private async capture(): Promise<CapturedState> {
    const rows = new Map<string, boolean>()
    let patchText = '[]\n'
    try {
      patchText = await readFile(this.facts.patchPath, 'utf8')
    } catch {
      patchText = '[]\n'
    }
    try {
      const { root } = parsePatch(patchText, this.facts.patchPath)
      for (const item of root.items) {
        const id = bareRowId(item)
        if (id !== undefined) rows.set(id, bareRowEnabled(item))
      }
    } catch {
      // A broken patch file must not block an install: the CLI owns the write
      // and the error surfaces through its output.
    }
    let bundles: string[] = []
    let dependencies: string[] = []
    try {
      const manifest = await readProfileManifest(this.facts.packageJsonPath)
      bundles = manifest.bundles
      dependencies = Object.keys(manifest.dependencies)
    } catch {
      bundles = []
      dependencies = []
    }
    return { layer: { rows, bundles }, bundles, patchText, dependencies }
  }

  /** The plugin row a finished operation produced (installed or removed). */
  private async rowFor(action: 'install' | 'remove', spec: string, before: CapturedState, after: CapturedState): Promise<InstalledPluginItem | undefined> {
    let targetName: string | undefined
    if (action === 'install') {
      targetName = after.dependencies.find(name => !before.dependencies.includes(name))
    } else {
      targetName = before.dependencies.find(name => !after.dependencies.includes(name)) ?? spec
    }
    if (targetName === undefined) return undefined
    const specValue = await readProfileManifest(this.facts.packageJsonPath)
      .then(manifest => manifest.dependencies[targetName as string] ?? spec)
      .catch(() => spec)
    return buildPluginRow(this.facts, targetName, specValue, after.layer.rows)
  }

  /** Run one CLI operation to settlement; an unexpected failure settles the job as error. */
  private async run(job: GatewayJob, args: string[], timeoutMs: number): Promise<void> {
    try {
      await this.runInner(job, args, timeoutMs)
    } catch (error) {
      job.phase = 'error'
      job.error = `plugin-manager: unexpected gateway failure: ${error instanceof Error ? error.message : String(error)}`
    }
    this.retainFinished(job.id)
  }

  /** The mutation body of {@link run}. */
  private async runInner(job: GatewayJob, args: string[], timeoutMs: number): Promise<void> {
    const binary = this.binary()
    if (binary === null) {
      job.phase = 'error'
      job.error = 'plugin-manager: dsh CLI not found on PATH'
      return
    }
    const before = await this.capture()
    const output = { value: '' }
    const child = this.spawnCli(binary, args)
    child.stdout?.on('data', (chunk: Buffer) => { capture(chunk, output) })
    child.stderr?.on('data', (chunk: Buffer) => { capture(chunk, output) })
    const timer = setTimeout(() => { child.kill() }, timeoutMs)
    const code = await new Promise<number | null>(resolve => {
      child.on('close', resolve)
    })
    clearTimeout(timer)
    if (code !== 0) {
      job.phase = 'error'
      const tail = output.value.trim()
      job.error = tail === '' ? `plugin-manager: dsh plugin ${job.action} exited with code ${String(code)}` : tail
      return
    }
    let after = await this.capture()
    // B9: the CLI's bundle reconciliation re-adds every bundle-declaring
    // dependency to dsh.profile.bundles — including packages the composition
    // already mounts through a patch row (the aggregate's better-sidebar
    // row), which double-mounts and kills the next boot. Strip exactly the
    // newly added, already-row-mounted entries back out before anything else
    // validates or preflights the result.
    const stripped = await this.stripDuplicateMounts(job, before, after)
    if (stripped === undefined) return
    if (stripped.length > 0) {
      job.notices = stripped.map(name => ({ id: name, name, from: 'enabled', to: 'uninstalled' }))
      after = await this.capture()
    }
    const conflicts = significantChanges(diffLayer(before.layer, after.layer))
    if (job.action === 'install') {
      const name = this.newDependency(before, after)
      if (name === undefined) {
        // B8: a success exit code is not proof the install landed.
        job.phase = 'error'
        job.error = 'plugin-manager: dsh plugin add 报告成功，但 profile 未新增任何依赖（安装未生效）'
        return
      }
      // B5: a duplicate entry id is boot-blocking. Never write disabled rows
      // for a shared id (they cannot stop the loader's duplicate check and
      // they flag the existing owner) — roll the NEW package back instead.
      const duplicate = await this.detectDuplicateClaims(before, after)
      if (duplicate !== undefined) {
        await this.rollbackInstall(job, name, `与现有插件的入口 id 冲突（${duplicate.ids.join(', ')}）`, conflicts)
        return
      }
      // B6 (static part): an insert entry naming an unresolvable package fails
      // the next boot's import; --dump-config cannot see it (composition only).
      const missing = await this.unresolvableInsertNames(name)
      if (missing.length > 0) {
        await this.rollbackInstall(job, name, `入口引用了不可解析的包（${missing.join(', ')}）`, conflicts)
        return
      }
      await this.verifyBoot(job, before, after, conflicts)
      if (job.phase === 'error') return
    } else if (job.action === 'update') {
      const targetId = job.targetId
      const targetVersion = job.targetVersion
      if (targetId === undefined || targetVersion === undefined || !after.dependencies.includes(targetId)) {
        job.phase = 'error'
        job.error = 'plugin-manager: dsh plugin add 报告成功，但目标插件未保留在 profile 中（更新未生效）'
        return
      }
      const manifest = await readProfileManifest(this.facts.packageJsonPath)
      const updated = await buildPluginRow(this.facts, targetId, manifest.dependencies[targetId] ?? job.spec, after.layer.rows)
      if (updated.version !== targetVersion) {
        job.phase = 'error'
        job.error = `plugin-manager: dsh plugin add 报告成功，但 ${targetId} 仍为 ${updated.version}，预期 ${targetVersion}（更新未生效）`
        return
      }
      job.plugin = updated
      await this.verifyBoot(job, before, after, conflicts)
      if (job.phase === 'error') return
    } else {
      // B8 (remove): a success exit code must mean the dependency is gone.
      const removed = before.dependencies.find(candidate => !after.dependencies.includes(candidate))
      if (removed === undefined) {
        job.phase = 'error'
        job.error = 'plugin-manager: dsh plugin remove 报告成功，但依赖仍在 profile 中（卸载未生效）'
        return
      }
    }
    job.conflicts = conflicts.map(change => ({
      id: change.id,
      name: change.id,
      from: change.from,
      to: change.to,
    }))
    if (job.action === 'install' || job.action === 'remove') {
      job.plugin = await this.rowFor(job.action, job.spec, before, after)
    }
    job.phase = 'done'
  }

  /**
   * Post-mutation duplicate-mount safeguard (B9): remove the bundles entries
   * the CLI's reconciliation newly added for packages the before-state
   * composition already mounted through a patch row. The write goes through
   * the manifest's safe path (backup + tmp + atomic rename); entries the
   * user had before and entries with no row mount are never touched. A
   * failure of the guard itself settles the job as an error — a boot-breaking
   * bundles state is never left silently.
   * @param job - the settling job (error target on guard failure).
   * @param before - state captured before the CLI run.
   * @param after - state captured after the CLI run.
   * @returns the stripped entries, or undefined when the job failed.
   */
  private async stripDuplicateMounts(job: GatewayJob, before: CapturedState, after: CapturedState): Promise<string[] | undefined> {
    try {
      const strip = await duplicateMountBundles(
        this.facts,
        { patchText: before.patchText, dependencies: before.dependencies, rowEnabled: before.layer.rows },
        before.layer.bundles,
        after.layer.bundles,
      )
      if (strip.length === 0) return []
      await stripProfileBundles(this.facts.packageJsonPath, strip)
      return strip
    } catch (error) {
      job.phase = 'error'
      job.error = `plugin-manager: 重复挂载保护写回失败：${error instanceof Error ? error.message : String(error)}（profile 的 dsh.profile.bundles 可能仍处于重复挂载状态，下次启动前请手动检查 ${this.facts.packageJsonPath}）`
      return undefined
    }
  }

  /**
   * Roll back a freshly installed dependency through the official remove
   * path (which also drops its bundle), then settle the job as an error.
   * This is the owner-aware conflict resolution: the existing plugin keeps
   * its entry ids and enablement untouched.
   */
  private async rollbackInstall(job: GatewayJob, name: string, reason: string, conflicts: LayerChange[]): Promise<void> {
    let rolledBack = false
    let tail = ''
    const binary = this.binary()
    if (binary !== null) {
      const output = { value: '' }
      const child = this.spawnCli(binary, ['plugin', '--profile', this.facts.profileName, 'remove', name])
      child.stdout?.on('data', (chunk: Buffer) => { capture(chunk, output) })
      child.stderr?.on('data', (chunk: Buffer) => { capture(chunk, output) })
      const timer = setTimeout(() => { child.kill() }, REMOVE_TIMEOUT_MS)
      const code = await new Promise<number | null>(resolve => { child.on('close', resolve) })
      clearTimeout(timer)
      rolledBack = code === 0
      tail = output.value.trim()
    }
    job.phase = 'error'
    job.error = rolledBack
      ? `plugin-manager: ${reason}，已自动回滚 ${name}`
      : `plugin-manager: ${reason}；自动回滚失败，请手动执行 dsh plugin --profile ${this.facts.profileName} remove ${name}${tail === '' ? '' : `：\n${tail}`}`
    conflicts.push({ id: name, from: 'enabled', to: 'uninstalled' })
    job.conflicts = conflicts.map(change => ({ id: change.id, name: change.id, from: change.from, to: change.to }))
  }

  /**
   * Insert-entry package names of one installed dependency that resolve
   * nowhere: not the dependency itself, not another profile dependency, not
   * an official @deepseek-ai/* package, and absent from every node_modules
   * the loader could import them from. Import-time failures beyond this
   * static check still surface only at the first real boot.
   */
  private async unresolvableInsertNames(name: string): Promise<string[]> {
    const moduleDir = join(this.facts.profileDir, 'node_modules', ...name.split('/'))
    let text: string
    try {
      text = await readFile(join(moduleDir, 'cordis.patch.yml'), 'utf8')
    } catch {
      return []
    }
    const missing: string[] = []
    for (const row of insertRowsOf(text)) {
      const target = row.name
      if (target === undefined || target === '') continue
      if (target === name) continue
      if (target.startsWith('@deepseek-ai/')) continue
      if (existsSync(join(this.facts.profileDir, 'node_modules', ...target.split('/')))) continue
      if (existsSync(join(moduleDir, 'node_modules', ...target.split('/')))) continue
      missing.push(target)
    }
    return missing
  }

  /** The new dependency of an install, when one exists. */
  private newDependency(before: CapturedState, after: CapturedState): string | undefined {
    return after.dependencies.find(name => !before.dependencies.includes(name))
  }

  /** The claimed entry ids of one installed dependency (its own bundle patch, or its name). */
  private claimedEntriesOf(name: string): Promise<string[]> {
    return claimedEntryIdsOf(this.facts, name)
  }

  /** Whether the new install claims an entry id another plugin already holds. */
  private async detectDuplicateClaims(before: CapturedState, after: CapturedState): Promise<{ name: string; ids: string[] } | undefined> {
    const name = this.newDependency(before, after)
    if (name === undefined) return undefined
    const claimed = await this.claimedEntriesOf(name)
    const taken = new Set<string>(after.layer.rows.keys())
    for (const dep of after.dependencies) {
      if (dep === name) continue
      for (const id of await this.claimedEntriesOf(dep)) taken.add(id)
    }
    const overlap = overlappingIds(claimed, taken)
    if (overlap.length === 0) return undefined
    return { name, ids: overlap }
  }

  /**
   * Boot preflight after an install: compose the profile with the CLI's
   * `--dump-config` (resolves every entry without binding the port). A failure
   * that implicates the new plugin disables it so the next start cannot fail;
   * an unrelated failure is reported without touching anything.
   */
  private async verifyBoot(job: GatewayJob, before: CapturedState, after: CapturedState, conflicts: LayerChange[]): Promise<void> {
    const binary = this.binary()
    if (binary === null) return
    const name = this.newDependency(before, after)
    const verifyOutput = { value: '' }
    const child = this.spawnCli(binary, ['--profile', this.facts.profileName, '--dump-config'])
    child.stdout?.on('data', (chunk: Buffer) => { capture(chunk, verifyOutput) })
    child.stderr?.on('data', (chunk: Buffer) => { capture(chunk, verifyOutput) })
    const timer = setTimeout(() => { child.kill() }, 90_000)
    const code = await new Promise<number | null>(resolve => {
      child.on('close', resolve)
    })
    clearTimeout(timer)
    if (code === 0) return
    const tail = verifyOutput.value.trim()
    if (name === undefined) {
      job.phase = 'error'
      job.error = tail === '' ? 'plugin-manager: boot preflight failed' : tail
      return
    }
    const claimed = await this.claimedEntriesOf(name)
    const implicated = tail.includes(name) || claimed.some(id => tail.includes(id))
    if (implicated) {
      // Owner-aware: roll the new package back rather than disabling shared
      // rows, which cannot reach every failure shape anyway.
      await this.rollbackInstall(job, name, `启动预检失败${tail === '' ? '' : `：\n${tail}`}`, conflicts)
    } else {
      job.phase = 'error'
      job.error = tail === ''
        ? 'plugin-manager: 启动预检失败（与本次安装无关）'
        : `plugin-manager: 启动预检失败（与本次安装无关）：\n${tail}`
    }
  }
}
