/**
 * Windows mandatory-integrity-label checks around the published payload cache.
 *
 * A byte-perfect cache is not automatically safe to run: if the data tree that
 * holds it carries an inheritable Low Mandatory Level label, the inherited
 * bash.exe starts a Low-integrity process on a Medium host and cannot write an
 * ordinary workspace. These cases certify that a hash match alone never keeps
 * such a tree alive, that a Low tree is never spawned from, and that the #1996
 * guarantee (the running tree is outside the package) still holds.
 *
 * The fixtures are real files; the mandatory-label reader is injected through
 * PrepareRuntimeOptions.readLabel, so every case is deterministic on any host.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MEDIUM_INTEGRITY_RID,
  type IntegrityLabel,
  type LabelReader,
  existingAncestors,
  parseIntegritySddl,
} from '../src/integrity.ts'
import {
  CACHE_DIR_PARTS,
  ISOLATED_CACHE_DIR_PARTS,
  RUNTIME_ROOT_ENV,
  cacheRoot,
  isolatedCacheRoot,
  payloadKey,
  parseChecksums,
  prepareRuntime,
  runtimeRoot,
  verifyPayloadRoot,
  type PrepareRuntimeOptions,
} from '../src/runtime.ts'

/** The host this package serves. */
const WINDOWS = { platform: 'win32', arch: 'x64' } as const

/** A reader that reports a normal Medium-or-higher label for every path. */
const MEDIUM: LabelReader = () => 'medium-or-higher'

/** One fixture payload: two files and the manifest that describes them. */
const FILES: Record<string, string> = {
  'usr/bin/bash.exe': 'fixture-bash-bytes',
  'usr/bin/ls.exe': 'fixture-ls-bytes',
}

/** SHA256 of one fixture file, lowercase hex. */
function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** A fresh temp directory for one case. */
function tempRoot(role: string): string {
  return mkdtempSync(join(tmpdir(), 'dsh-win-bash-integrity-' + role + '-'))
}

/**
 * Write one payload tree and its checksum manifest.
 * @param root - the payload root.
 * @param files - payload-relative paths and their contents.
 */
function writePayload(root: string, files: Record<string, string> = FILES): void {
  const rows = Object.entries(files).map(([rel, data]) => {
    const target = join(root, ...rel.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
    return digest(data) + '  ' + rel
  })
  writeFileSync(join(root, 'checksums.sha256'), '# fixture payload\n' + rows.join('\n') + '\n')
}

/**
 * One package root with its payload at runtime/win32-x64.
 * @returns the package root and its payload root.
 */
function packageFixture(): { pkg: string, payload: string } {
  const pkg = tempRoot('pkg')
  const payload = runtimeRoot(pkg)
  writePayload(payload)
  return { pkg, payload }
}

/**
 * The cache-key one payload root implies.
 * @param payload - the payload root.
 * @returns the payload key.
 */
function keyOf(payload: string): string {
  return payloadKey(parseChecksums(readFileSync(join(payload, 'checksums.sha256'), 'utf8')))
}

/** Remove the directories one case made, by the exact roots it created. */
function cleanup(...roots: readonly string[]): void {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}

/**
 * Prepare a runtime with an explicit primary and isolated root.
 * @param options - the seams one case varies.
 * @returns the prepared runtime.
 */
function prepare(options: PrepareRuntimeOptions): ReturnType<typeof prepareRuntime> {
  return prepareRuntime({ host: WINDOWS, readLabel: MEDIUM, ...options })
}

/**
 * A reader that reports `low-or-untrusted` for paths under one root.
 * @param root - the unsafe root.
 * @returns the reader.
 */
function lowUnder(root: string): LabelReader {
  return (target: string): IntegrityLabel => target.startsWith(root) ? 'low-or-untrusted' : 'medium-or-higher'
}

describe('the SDDL mandatory label parser', () => {
  it('operator reading an inheritable Low label gets a Low verdict', () => {
    // Given an icacls /save blob whose SACL carries (ML;OICI;NW;;;LW),
    const sddl = 'bash.exe\r\nD:AI(A;ID;FA;;;SY)S:AI(ML;OICI;NW;;;LW)\r\n'
    // When the descriptor is classified,
    const verdict = parseIntegritySddl(sddl)
    // Then it is refused as Low, because children inherit that label.
    expect(verdict).toBe('low-or-untrusted')
  })

  it('operator reading an inherited Low label on bash.exe gets a Low verdict', () => {
    // Given an image that inherited Low from its parent directory,
    const sddl = 'D:AI(A;ID;FA;;;SY)S:AI(ML;ID;NW;;;LW)'
    // When the descriptor is classified,
    const verdict = parseIntegritySddl(sddl)
    // Then the inherited label is not mistaken for a clean one.
    expect(verdict).toBe('low-or-untrusted')
  })

  it('operator reading an Untrusted numeric SID gets a Low verdict', () => {
    // Given S-1-16-0, below Low and below Medium,
    const sddl = 'S:AI(ML;;NW;;;S-1-16-0)'
    // When the descriptor is classified,
    const verdict = parseIntegritySddl(sddl)
    // Then it is refused, and the Medium RID is the boundary.
    expect(verdict).toBe('low-or-untrusted')
    expect(MEDIUM_INTEGRITY_RID).toBe(8192)
  })

  it('operator reading Medium, High or System labels gets a clean verdict', () => {
    // Given descriptors at or above Medium integrity,
    const clean = [
      'S:AI(ML;;NW;;;ME)',
      'S:P(ML;OINPIO;NW;;;HI)',
      'S:AI(ML;;NW;;;SI)',
      'S:AI(ML;;NW;;;S-1-16-8192)',
      'D:AI(A;ID;FA;;;SY)',
    ]
    // When each is classified,
    const verdicts = clean.map(parseIntegritySddl)
    // Then none is treated as a downgrade.
    expect(verdicts).toEqual(Array.from({ length: clean.length }, () => 'medium-or-higher'))
  })

  it('operator reading a descriptor with no SACL gets a clean verdict', () => {
    // Given an ordinary object with no mandatory label ACE at all,
    // When the descriptor is classified,
    // Then it inherits Medium by default and is clean.
    expect(parseIntegritySddl('D:AI(A;ID;FA;;;S-1-5-21-1-2-3-1001)')).toBe('medium-or-higher')
  })

  it('operator reading a Low label among several ACEs still gets a Low verdict', () => {
    // Given a SACL with a harmless ACE before the Low one,
    const sddl = 'S:AI(AU;SAFA;FA;;;SY)(ML;OICIID;NW;;;LW)'
    // When the descriptor is classified,
    // Then the Low ACE wins over the others.
    expect(parseIntegritySddl(sddl)).toBe('low-or-untrusted')
  })
})

describe('the isolated cache root', () => {
  it('operator on a Low-labelled DSH home gets a cache root outside that data tree', () => {
    // Given a DSH home and a per-user app-data directory,
    const home = tempRoot('home')
    const appData = tempRoot('app')
    const env = { DSH_HOME: home, LOCALAPPDATA: appData }
    // When the two roots are resolved,
    const primary = cacheRoot(env)
    const isolated = isolatedCacheRoot(env)
    // Then the isolated root is outside the DSH home and uses its own parts.
    expect(primary).toBe(join(home, ...CACHE_DIR_PARTS))
    expect(isolated.startsWith(home)).toBe(false)
    expect(isolated.startsWith(join(appData, ...ISOLATED_CACHE_DIR_PARTS))).toBe(true)
    cleanup(home, appData)
  })

  it('operator running two probe hosts gets a distinct isolated cache for each', () => {
    // Given two isolated DSH homes sharing one app-data directory,
    const first = tempRoot('first')
    const second = tempRoot('second')
    const appData = tempRoot('app')
    // When both isolated roots are resolved,
    const one = isolatedCacheRoot({ DSH_HOME: first, LOCALAPPDATA: appData })
    const two = isolatedCacheRoot({ DSH_HOME: second, LOCALAPPDATA: appData })
    // Then they differ, so probes never share a cache.
    expect(one).not.toBe(two)
    cleanup(first, second, appData)
  })

  it('operator setting the runtime-root override gets that exact directory', () => {
    // Given an explicit override of the isolated root parent,
    const override = tempRoot('override')
    // When the root is resolved,
    const root = isolatedCacheRoot({ [RUNTIME_ROOT_ENV]: override })
    // Then the override is honoured verbatim.
    expect(root).toBe(override)
    cleanup(override)
  })
})

describe('the payload published outside the package under a Low label', () => {
  it('operator with a Medium cache root gets the shell published under that root', () => {
    // Given a package and a clean default cache root,
    const { pkg, payload } = packageFixture()
    const cache = tempRoot('cache')
    const isolated = tempRoot('isolated')
    // When the runtime is prepared,
    const runtime = prepare({ packageRoot: pkg, cacheRoot: cache, isolatedCacheRoot: isolated })
    // Then the running tree is the verified copy outside the package,
    // and the isolated fallback was not needed.
    expect('code' in runtime).toBe(false)
    if ('code' in runtime) return
    expect(runtime.source).toBe('cache')
    expect(runtime.payloadRoot).toBe(join(cache, keyOf(payload)))
    expect(runtime.payloadRoot.startsWith(pkg)).toBe(false)
    expect(verifyPayloadRoot(runtime.payloadRoot).mismatches).toEqual([])
    expect(existsSync(join(isolated, keyOf(payload)))).toBe(false)
    cleanup(pkg, cache, isolated)
  })

  it('operator whose cache parent is Low gets the payload published into the isolated root', () => {
    // Given a DSH home tree labelled Low and a clean isolated root,
    const { pkg, payload } = packageFixture()
    const cache = tempRoot('cache')
    const isolated = tempRoot('isolated')
    const warnings: string[] = []
    // When the runtime is prepared with the Low label reported on the primary tree,
    const runtime = prepareRuntime({
      host: WINDOWS,
      packageRoot: pkg,
      cacheRoot: cache,
      isolatedCacheRoot: isolated,
      readLabel: lowUnder(cache),
      warn: (message: string) => { warnings.push(message) },
    })
    // Then the shell runs from a verified copy in the isolated root,
    // not from the Low tree, and still not from inside the package.
    expect('code' in runtime).toBe(false)
    if ('code' in runtime) return
    expect(runtime.source).toBe('cache')
    expect(runtime.payloadRoot).toBe(join(isolated, keyOf(payload)))
    expect(runtime.payloadRoot.startsWith(cache)).toBe(false)
    expect(runtime.payloadRoot.startsWith(pkg)).toBe(false)
    expect(readFileSync(runtime.bash, 'utf8')).toBe(FILES['usr/bin/bash.exe'] ?? '')
    expect(verifyPayloadRoot(runtime.payloadRoot).mismatches).toEqual([])
    expect(existsSync(join(cache, keyOf(payload)))).toBe(false)
    expect(warnings).toEqual([])
    cleanup(pkg, cache, isolated)
  })

  it('operator with an existing byte-perfect Low cache gets it abandoned, not reused', () => {
    // Given a cache published by an older release whose files are byte-perfect
    // but whose image has since inherited a Low label,
    const { pkg, payload } = packageFixture()
    const cache = tempRoot('cache')
    const isolated = tempRoot('isolated')
    prepare({ packageRoot: pkg, cacheRoot: cache, isolatedCacheRoot: isolated })
    const stale = join(cache, keyOf(payload))
    expect(existsSync(stale)).toBe(true)
    // When the host mounts again (restart, plugin reload or update),
    const second = prepareRuntime({
      host: WINDOWS,
      packageRoot: pkg,
      cacheRoot: cache,
      isolatedCacheRoot: isolated,
      readLabel: (target: string): IntegrityLabel => target.startsWith(stale) ? 'low-or-untrusted' : 'medium-or-higher',
    })
    // Then a hash match alone did not keep that tree alive: the shell now
    // runs from a freshly verified copy in the isolated root.
    expect('code' in second).toBe(false)
    if ('code' in second) return
    expect(second.source).toBe('cache')
    expect(second.payloadRoot).toBe(join(isolated, keyOf(payload)))
    expect(second.payloadRoot).not.toBe(stale)
    cleanup(pkg, cache, isolated)
  })

  it('operator whose freshly published image inherits Low gets no shell from that tree', () => {
    // Given a clean primary root whose parent label is propagated onto a
    // newly created image during publication,
    const { pkg, payload } = packageFixture()
    const cache = tempRoot('cache')
    const isolated = tempRoot('isolated')
    const freshImage = join(cache, keyOf(payload), 'usr', 'bin', 'bash.exe')
    // When the runtime is prepared,
    const runtime = prepareRuntime({
      host: WINDOWS,
      packageRoot: pkg,
      cacheRoot: cache,
      isolatedCacheRoot: isolated,
      readLabel: (target: string): IntegrityLabel => target === freshImage ? 'low-or-untrusted' : 'medium-or-higher',
    })
    // Then the freshly published Low image was rejected and the isolated
    // root's clean copy is what runs.
    expect('code' in runtime).toBe(false)
    if ('code' in runtime) return
    expect(runtime.source).toBe('cache')
    expect(runtime.payloadRoot).toBe(join(isolated, keyOf(payload)))
    expect(runtime.bash).not.toBe(freshImage)
    cleanup(pkg, cache, isolated)
  })

  it('operator whose payload is updated gets a new key verified in the isolated root', () => {
    // Given a payload already published into the isolated root,
    const { pkg, payload } = packageFixture()
    const cache = tempRoot('cache')
    const isolated = tempRoot('isolated')
    const first = prepareRuntime({
      host: WINDOWS, packageRoot: pkg, cacheRoot: cache,
      isolatedCacheRoot: isolated, readLabel: lowUnder(cache),
    })
    expect('code' in first).toBe(false)
    if ('code' in first) return
    // When a payload file changes and the host mounts again,
    writePayload(payload, { ...FILES, 'usr/bin/bash.exe': 'new-bash-bytes' })
    const second = prepareRuntime({
      host: WINDOWS, packageRoot: pkg, cacheRoot: cache,
      isolatedCacheRoot: isolated, readLabel: lowUnder(cache),
    })
    // Then the new key gets its own verified copy, still outside the package.
    expect('code' in second).toBe(false)
    if ('code' in second) return
    expect(second.payloadRoot).toBe(join(isolated, keyOf(payload)))
    expect(second.payloadRoot).not.toBe(first.payloadRoot)
    expect(readFileSync(second.bash, 'utf8')).toBe('new-bash-bytes')
    expect(verifyPayloadRoot(second.payloadRoot).mismatches).toEqual([])
    cleanup(pkg, cache, isolated)
  })

  it('operator restarting twice with a Low cache never falls back to a hash-only hit', () => {
    // Given a primary tree that stays Low across restarts,
    const { pkg, payload } = packageFixture()
    const cache = tempRoot('cache')
    const isolated = tempRoot('isolated')
    const runs = [1, 2, 3].map(() => prepareRuntime({
      host: WINDOWS, packageRoot: pkg, cacheRoot: cache,
      isolatedCacheRoot: isolated, readLabel: lowUnder(cache),
    }))
    // When each mount is inspected,
    // Then every one reports the isolated copy and none reports the Low tree.
    for (const runtime of runs) {
      expect('code' in runtime).toBe(false)
      if ('code' in runtime) return
      expect(runtime.payloadRoot).toBe(join(isolated, keyOf(payload)))
    }
    cleanup(pkg, cache, isolated)
  })

  it('operator with every cache root Low gets the verified packaged tree and one warning', () => {
    // Given both candidate roots labelled Low but a clean packaged image,
    const { pkg, payload } = packageFixture()
    const cache = tempRoot('cache')
    const isolated = tempRoot('isolated')
    const warnings: string[] = []
    // When the runtime is prepared,
    const runtime = prepareRuntime({
      host: WINDOWS, packageRoot: pkg, cacheRoot: cache, isolatedCacheRoot: isolated,
      readLabel: (target: string): IntegrityLabel => target.startsWith(pkg) ? 'medium-or-higher' : 'low-or-untrusted',
      warn: (message: string) => { warnings.push(message) },
    })
    // Then the tool still mounts from the verified packaged tree and says
    // exactly what it costs, rather than silently running a Low shell.
    expect('code' in runtime).toBe(false)
    if ('code' in runtime) return
    expect(runtime.source).toBe('package')
    expect(runtime.payloadRoot).toBe(payload)
    expect(warnings.join('\n')).toContain('Low or Untrusted')
    expect(warnings.join('\n')).toContain('ERR_PNPM_EPERM')
    expect(warnings.join('\n')).toContain(payload)
    expect(existsSync(join(cache, keyOf(payload)))).toBe(false)
    cleanup(pkg, cache, isolated)
  })

  it('operator with a Low packaged image too gets an explicit refusal', () => {
    // Given no tree at all that can produce a Medium-integrity process,
    const { pkg } = packageFixture()
    const cache = tempRoot('cache')
    const isolated = tempRoot('isolated')
    // When the runtime is prepared,
    const runtime = prepareRuntime({
      host: WINDOWS, packageRoot: pkg, cacheRoot: cache, isolatedCacheRoot: isolated,
      readLabel: () => 'low-or-untrusted',
    })
    // Then the mount is refused with a specific diagnosis naming the pwsh
    // fallback and the override, instead of spawning a broken shell.
    expect('code' in runtime).toBe(true)
    if (!('code' in runtime)) return
    expect(runtime.code).toBe('unsafe-integrity')
    expect(runtime.message).toContain('pwsh')
    expect(runtime.message).toContain(RUNTIME_ROOT_ENV)
    expect(runtime.message).toContain('Low')
    expect(existsSync(join(cache, 'usr'))).toBe(false)
    cleanup(pkg, cache, isolated)
  })

  it('operator whose cache cannot be written still gets the packaged shell with the EPERM warning', () => {
    // Given a cache root whose parent is a file, so publication fails,
    const { pkg, payload } = packageFixture()
    const blocker = join(tempRoot('blocked'), 'not-a-directory')
    writeFileSync(blocker, 'this path is a file')
    const warnings: string[] = []
    // When the runtime is prepared,
    const runtime = prepare({
      packageRoot: pkg,
      cacheRoot: join(blocker, 'runtime'),
      warn: (message: string) => { warnings.push(message) },
    })
    // Then the existing availability rule still holds.
    expect('code' in runtime).toBe(false)
    if ('code' in runtime) return
    expect(runtime.source).toBe('package')
    expect(runtime.payloadRoot).toBe(payload)
    expect(warnings.join('\n')).toContain('ERR_PNPM_EPERM')
    cleanup(pkg, dirname(blocker))
  })

  it('operator on a restricted host is still refused before any cache is touched', () => {
    // Given a POSIX host and an empty cache root,
    const { pkg } = packageFixture()
    const cache = tempRoot('cache')
    // When the runtime is prepared,
    const runtime = prepareRuntime({
      host: { platform: 'linux', arch: 'x64' },
      packageRoot: pkg, cacheRoot: cache, readLabel: () => 'low-or-untrusted',
    })
    // Then the platform refusal wins and no label check or publication ran.
    expect('code' in runtime && runtime.code).toBe('unsupported-platform')
    expect(existsSync(join(cache, 'usr'))).toBe(false)
    cleanup(pkg, cache)
  })

  it('operator whose packaged payload fails its manifest still gets a hard refusal', () => {
    // Given a tampered packaged payload and a Low primary cache,
    const { pkg } = packageFixture()
    const cache = tempRoot('cache')
    const isolated = tempRoot('isolated')
    writeFileSync(join(runtimeRoot(pkg), 'usr', 'bin', 'bash.exe'), 'tampered-bytes')
    // When the runtime is prepared,
    const runtime = prepareRuntime({
      host: WINDOWS, packageRoot: pkg, cacheRoot: cache,
      isolatedCacheRoot: isolated, readLabel: lowUnder(cache),
    })
    // Then the byte check still refuses the mount before publishing anything.
    expect('code' in runtime && runtime.code).toBe('checksum-mismatch')
    expect(existsSync(join(isolated, 'usr'))).toBe(false)
    cleanup(pkg, cache, isolated)
  })
})

describe('the ancestor chain of a cache root', () => {
  it('operator inspecting a cache root gets every existing ancestor up to the volume root', () => {
    // Given a nested path whose deepest directory does not exist yet,
    const root = tempRoot('chain')
    const nested = join(root, 'win-bash', 'runtime', 'key')
    // When the existing ancestors are listed,
    const chain = existingAncestors(nested)
    // Then the nearest existing directory is first and the volume root last,
    // so an inheritable Low label anywhere above cannot be missed.
    expect(chain[0]).toBe(root)
    expect(chain.includes(root)).toBe(true)
    expect(chain[chain.length - 1]).toBe(dirname(chain[chain.length - 1] ?? ''))
    cleanup(root)
  })
})
