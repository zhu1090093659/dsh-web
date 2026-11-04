/**
 * Where the spawned shell comes from: the payload is published OUTSIDE the
 * package before anything runs.
 *
 * The invariant these cases certify is the one Windows imposes: a running
 * executable cannot be renamed or deleted, and a package manager imports a
 * package by renaming a staging directory over it, so a shell started from
 * inside node_modules makes every later update or uninstall of this package
 * fail with ERR_PNPM_EPERM. What runs must therefore be a verified copy under
 * the DSH home, and what fails verification must never be what runs.
 *
 * The fixtures are real directories and real files: the outcome a user's disk
 * sees is the subject, not whether a helper was called.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CACHE_STAGING_PREFIX,
  cacheRoot,
  parseChecksums,
  payloadKey,
  prepareRuntime,
  runtimeRoot,
  verifyPayloadRoot,
} from '../src/runtime.ts'
import { readMandatoryLabel } from '../src/integrity.ts'

/** The platform this package serves, used as the host fact in every case. */
const WINDOWS = { platform: 'win32', arch: 'x64' } as const

/** The files one fixture payload carries, relative to the payload root. */
const FIXTURE_FILES: Record<string, string> = {
  'usr/bin/bash.exe': 'fixture-bash-bytes',
  'usr/bin/ls.exe': 'fixture-ls-bytes',
}

/** SHA256 of one fixture file's contents, lowercase hex. */
function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** A fresh temp directory for one case, in the fixture and cache roles alike. */
function tempRoot(role: string): string {
  return mkdtempSync(join(tmpdir(), 'dsh-win-bash-cache-spec-' + role + '-'))
}

/**
 * Write one payload tree together with the manifest that describes it.
 * @param root - the directory that becomes the payload root.
 * @param files - payload-relative paths and their contents.
 */
function writePayload(root: string, files: Record<string, string> = FIXTURE_FILES): void {
  const rows = Object.entries(files).map(([rel, content]) => {
    const target = join(root, ...rel.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
    return digest(content) + '  ' + rel
  })
  writeFileSync(join(root, 'checksums.sha256'), '# fixture payload\n' + rows.join('\n') + '\n')
}

/**
 * One package root shaped like the published package: the payload at
 * runtime/win32-x64.
 * @returns the package root and its payload root.
 */
function packageFixture(): { pkg: string, payload: string } {
  const pkg = tempRoot('pkg')
  const payload = runtimeRoot(pkg)
  writePayload(payload)
  return { pkg, payload }
}

/**
 * The key one payload root's manifest produces.
 * @param payload - the payload root.
 * @returns the cache directory name its manifest implies.
 */
function keyOf(payload: string): string {
  return payloadKey(parseChecksums(readFileSync(join(payload, 'checksums.sha256'), 'utf8')))
}

/** Remove the directories one case made, through the same recursive delete it created them with. */
function cleanup(...roots: readonly string[]): void {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}

describe('the payload published outside the package', () => {
  it('operator mounting on Windows gets the shell published under the cache root, not inside the package', () => {
    // Given a package root whose payload verifies and an empty cache root,
    const { pkg, payload } = packageFixture()
    const cache = tempRoot('cache')
    const key = keyOf(payload)
    // When the runtime is prepared for a Windows x64 host,
    const runtime = prepareRuntime({ host: WINDOWS, packageRoot: pkg, cacheRoot: cache })
    // Then the shell is the published copy, named by the payload's own
    // identity, carrying the shipped bytes, and verifiable in its own right.
    expect('code' in runtime).toBe(false)
    if ('code' in runtime) return
    expect(runtime.source).toBe('cache')
    expect(runtime.payloadRoot).toBe(join(cache, key))
    expect(runtime.bash).toBe(join(cache, key, 'usr', 'bin', 'bash.exe'))
    expect(runtime.bin).toBe(join(cache, key, 'usr', 'bin'))
    expect(readFileSync(runtime.bash, 'utf8')).toBe(FIXTURE_FILES['usr/bin/bash.exe'] ?? '')
    expect(verifyPayloadRoot(runtime.payloadRoot).mismatches).toEqual([])
    // And the copy is the only thing in the cache root: no staging directory
    // survives a publication.
    expect(readdirSync(cache)).toEqual([key])
    cleanup(pkg, cache)
  })

  it('operator mounting a second time gets the published copy reused instead of copied again', () => {
    // Given a payload that has already been published,
    const { pkg } = packageFixture()
    const cache = tempRoot('cache')
    const first = prepareRuntime({ host: WINDOWS, packageRoot: pkg, cacheRoot: cache })
    expect('code' in first).toBe(false)
    // When a second mount prepares the same package and the copy step refuses
    // to run at all,
    let copied = 0
    const second = prepareRuntime({
      host: WINDOWS,
      packageRoot: pkg,
      cacheRoot: cache,
      copy: () => { copied += 1; throw new Error('a published payload must not be copied again') },
    })
    // Then it serves the copy already published, which means no copy ran.
    expect('code' in second).toBe(false)
    if ('code' in second || 'code' in first) return
    expect(copied).toBe(0)
    expect(second.source).toBe('cache')
    expect(second.payloadRoot).toBe(first.payloadRoot)
    cleanup(pkg, cache)
  })

  it('operator whose published copy was damaged gets it rebuilt from the packaged payload', () => {
    // Given a published copy whose shell no longer matches the manifest,
    const { pkg, payload } = packageFixture()
    const cache = tempRoot('cache')
    const first = prepareRuntime({ host: WINDOWS, packageRoot: pkg, cacheRoot: cache })
    expect('code' in first).toBe(false)
    if ('code' in first) return
    writeFileSync(join(first.payloadRoot, 'usr', 'bin', 'bash.exe'), 'damaged-bytes')
    // When the runtime is prepared again,
    const second = prepareRuntime({ host: WINDOWS, packageRoot: pkg, cacheRoot: cache })
    // Then the damaged directory was replaced by a fresh copy of the packaged
    // payload, because a running shell must never be an unverified one.
    expect('code' in second).toBe(false)
    if ('code' in second) return
    expect(second.payloadRoot).toBe(join(cache, keyOf(payload)))
    expect(readFileSync(second.bash, 'utf8')).toBe(FIXTURE_FILES['usr/bin/bash.exe'] ?? '')
    expect(verifyPayloadRoot(second.payloadRoot).mismatches).toEqual([])
    cleanup(pkg, cache)
  })

  it('operator whose published copy carries a rewritten manifest gets a miss rather than a match', () => {
    // Given a published copy whose manifest was rewritten to describe its own
    // contents (the shape of a directory someone replaced wholesale),
    const { pkg, payload } = packageFixture()
    const cache = tempRoot('cache')
    const first = prepareRuntime({ host: WINDOWS, packageRoot: pkg, cacheRoot: cache })
    expect('code' in first).toBe(false)
    if ('code' in first) return
    writePayload(first.payloadRoot, { 'usr/bin/bash.exe': 'impostor-bytes' })
    // When the runtime is prepared again,
    const second = prepareRuntime({ host: WINDOWS, packageRoot: pkg, cacheRoot: cache })
    // Then the identity test rejected that directory and the shipped payload
    // was published over it.
    expect('code' in second).toBe(false)
    if ('code' in second) return
    expect(second.payloadRoot).toBe(join(cache, keyOf(payload)))
    expect(readFileSync(join(second.payloadRoot, 'checksums.sha256'), 'utf8'))
      .toBe(readFileSync(join(payload, 'checksums.sha256'), 'utf8'))
    expect(readFileSync(second.bash, 'utf8')).toBe(FIXTURE_FILES['usr/bin/bash.exe'] ?? '')
    cleanup(pkg, cache)
  })

  it('operator whose cache cannot be written gets the packaged shell and one warning naming the cost', () => {
    // Given a cache location that cannot exist, because its parent is a file,
    const { pkg, payload } = packageFixture()
    const blocker = join(tempRoot('blocked'), 'not-a-directory')
    writeFileSync(blocker, 'this path is a file')
    const warnings: string[] = []
    // When the runtime is prepared,
    const runtime = prepareRuntime({
      host: WINDOWS,
      packageRoot: pkg,
      cacheRoot: join(blocker, 'runtime'),
      warn: (message: string) => { warnings.push(message) },
    })
    // Then the verified packaged tree runs instead, and the operator is told
    // that updates and uninstalls will need this host stopped.
    expect('code' in runtime).toBe(false)
    if ('code' in runtime) return
    expect(runtime.source).toBe('package')
    expect(runtime.payloadRoot).toBe(payload)
    expect(warnings.join('\n')).toContain('ERR_PNPM_EPERM')
    expect(warnings.join('\n')).toContain(payload)
    cleanup(pkg, dirname(blocker))
  })

  it('operator whose copy fails partway gets no staging directory left behind', () => {
    // Given a copy step that writes into the staging directory and then fails,
    const { pkg } = packageFixture()
    const cache = tempRoot('cache')
    const warnings: string[] = []
    // When the runtime is prepared,
    const runtime = prepareRuntime({
      host: WINDOWS,
      packageRoot: pkg,
      cacheRoot: cache,
      copy: (source: string, target: string) => {
        mkdirSync(target, { recursive: true })
        writeFileSync(join(target, 'partial-copy'), 'half a payload')
        throw new Error('disk went away mid-copy')
      },
      warn: (message: string) => { warnings.push(message) },
    })
    // Then the packaged tree serves the mount, the operator is told why, and
    // the half-written staging directory is gone rather than left to look like
    // a payload on the next start.
    expect('code' in runtime).toBe(false)
    if ('code' in runtime) return
    expect(runtime.source).toBe('package')
    expect(warnings.join('\n')).toContain('disk went away mid-copy')
    expect(readdirSync(cache).filter(name => name.startsWith(CACHE_STAGING_PREFIX))).toEqual([])
    cleanup(pkg, cache)
  })

  it('operator whose packaged payload fails its manifest gets a refusal and no published copy', () => {
    // Given a package root whose payload no longer matches its manifest,
    const { pkg, payload } = packageFixture()
    writeFileSync(join(payload, 'usr', 'bin', 'bash.exe'), 'tampered-bytes')
    const cache = tempRoot('cache')
    // When the runtime is prepared,
    const runtime = prepareRuntime({ host: WINDOWS, packageRoot: pkg, cacheRoot: cache })
    // Then the mount is refused with the checksum reason, and nothing was
    // copied: an unverified tree never becomes the tree that runs.
    expect('code' in runtime).toBe(true)
    if (!('code' in runtime)) return
    expect(runtime.code).toBe('checksum-mismatch')
    expect(runtime.message).toContain('usr/bin/bash.exe')
    expect(readdirSync(cache)).toEqual([])
    cleanup(pkg, cache)
  })

  it('operator with a published copy keeps it even if the packaged tree was damaged later', () => {
    // Given a payload that has already been published,
    const { pkg, payload } = packageFixture()
    const cache = tempRoot('cache')
    const first = prepareRuntime({ host: WINDOWS, packageRoot: pkg, cacheRoot: cache })
    expect('code' in first).toBe(false)
    if ('code' in first) return
    // When the packaged copy is damaged behind the cache's back,
    writeFileSync(join(payload, 'usr', 'bin', 'bash.exe'), 'damaged-after-publish')
    const second = prepareRuntime({ host: WINDOWS, packageRoot: pkg, cacheRoot: cache })
    // Then the host still serves the verified published copy: what runs is
    // verified, and the packaged tree is only a source, not the runner.
    expect('code' in second).toBe(false)
    if ('code' in second) return
    expect(second.source).toBe('cache')
    expect(readFileSync(second.bash, 'utf8')).toBe(FIXTURE_FILES['usr/bin/bash.exe'] ?? '')
    cleanup(pkg, cache)
  })

  it('operator on a host that cannot run the payload is refused before anything is published', () => {
    // Given a POSIX host and an empty cache root,
    const { pkg } = packageFixture()
    const cache = tempRoot('cache')
    // When the runtime is prepared,
    const runtime = prepareRuntime({ host: { platform: 'linux', arch: 'x64' }, packageRoot: pkg, cacheRoot: cache })
    // Then the platform refusal is the answer and the cache was never touched.
    expect('code' in runtime && runtime.code).toBe('unsupported-platform')
    expect(readdirSync(cache)).toEqual([])
    cleanup(pkg, cache)
  })

  it('operator asking for the default cache gets it under the DSH home', () => {
    // Given an isolated DSH home in the environment,
    const home = tempRoot('home')
    // When the default cache root is resolved,
    const root = cacheRoot({ DSH_HOME: home })
    // Then the cache lives under that home, outside every node_modules tree.
    expect(root).toBe(join(home, 'win-bash', 'runtime'))
    cleanup(home)
  })
})

const RUNNABLE = process.platform === 'win32' && process.arch === 'x64'

describe.skipIf(!RUNNABLE)('the published copy on a real host', () => {
  it('operator running the published payload gets a working shell resolving through the copy', () => {
    // Given the package's own payload published into a fresh cache root,
    const cache = tempRoot('live')
    const runtime = prepareRuntime({ cacheRoot: cache })
    expect('code' in runtime).toBe(false)
    if ('code' in runtime) return
    // When the published shell prints the MSYS root it resolved for itself,
    const run = spawnSync(runtime.bash, ['--norc', '--noprofile', '-c', 'cd /usr/bin && pwd -W'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: runtime.bin + ';' + (process.env.PATH ?? ''),
        MSYSTEM: 'MSYS',
        TERM: 'dumb',
      },
      encoding: 'utf8',
      windowsHide: true,
    })
    // Then it is the pinned bash, and its root is the cache copy rather than
    // the package directory it was copied out of.
    expect(run.status).toBe(0)
    expect(run.stdout.trim().toLowerCase()).toBe(runtime.bin.replace(/\\/g, '/').toLowerCase())
    expect(runtime.payloadRoot.startsWith(cache)).toBe(true)
    cleanup(cache)
  })

  it('operator reading a real Low-labelled directory gets a Low verdict from icacls', () => {
    // Given a disposable directory carrying an inheritable Low label and a
    // bash.exe created under it (the condition reported in issue #2007),
    const parent = tempRoot('acl')
    const image = join(parent, 'usr', 'bin', 'bash.exe')
    mkdirSync(dirname(image), { recursive: true })
    writeFileSync(image, 'fixture-bash-bytes')
    const exe = join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'System32', 'icacls.exe')
    const set = (level: string): number => spawnSync(exe, [parent, '/setintegritylevel', level], {
      windowsHide: true, timeout: 10000, stdio: 'ignore',
    }).status ?? -1
    try {
      // When the label is applied to the directory only,
      expect(set('(OI)(CI)L')).toBe(0)
      // Then the reader sees Low on both the directory and the inherited image,
      // using language-independent SDDL rather than localized icacls output.
      expect(readMandatoryLabel(parent)).toBe('low-or-untrusted')
      expect(readMandatoryLabel(image)).toBe('low-or-untrusted')
      // And a directory with no explicit label reads as Medium-or-higher.
      const clean = tempRoot('clean')
      try {
        expect(readMandatoryLabel(clean)).toBe('medium-or-higher')
      } finally {
        rmSync(clean, { recursive: true, force: true })
      }
    } finally {
      set('(OI)(CI)M')
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('operator whose real cache parent is Low gets the shell from the isolated root', () => {
    // Given a real Low-labelled cache root and a clean isolated root,
    const { pkg, payload } = packageFixture()
    const cache = tempRoot('acl-cache')
    const isolated = tempRoot('acl-isolated')
    const exe = join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'System32', 'icacls.exe')
    const set = (level: string): number => spawnSync(exe, [cache, '/setintegritylevel', level], {
      windowsHide: true, timeout: 10000, stdio: 'ignore',
    }).status ?? -1
    try {
      expect(set('(OI)(CI)L')).toBe(0)
      // When the runtime is prepared with the real (uninjected) label reader,
      const runtime = prepareRuntime({
        host: WINDOWS, packageRoot: pkg, cacheRoot: cache, isolatedCacheRoot: isolated,
      })
      // Then no shell is spawned from the Low-labelled tree: the verified copy
      // lives in the isolated root, so a Medium runner starts a Medium bash.
      expect('code' in runtime).toBe(false)
      if ('code' in runtime) return
      expect(runtime.source).toBe('cache')
      expect(runtime.payloadRoot).toBe(join(isolated, keyOf(payload)))
      expect(readMandatoryLabel(runtime.bash)).toBe('medium-or-higher')
      expect(existsSync(join(cache, keyOf(payload)))).toBe(false)
    } finally {
      set('(OI)(CI)M')
      cleanup(pkg, cache, isolated)
    }
  })
})
