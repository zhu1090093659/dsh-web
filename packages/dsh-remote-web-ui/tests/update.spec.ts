/** The host-side update logic: version precedence, profile detection,
 * registry checks, and the pnpm run (all seams injected — no real disk,
 * network, or process access beyond the temporary fixture directory). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from "node:events"
import {
  AGGREGATE_PACKAGE,
  checkUpdates,
  compareVersions,
  familyChildren,
  fetchGitHubReleaseNotes,
  fetchLatestVersion,
  findProfile,
  isLinkedSpec,
  parseReleaseNotesBody,
  parseSemver,
  resolveAnchorManifest,
  resolveUpdateTarget,
  runUpdate,
  runUpdateVerified,
  SELF_PACKAGE,
} from "../src/update.ts"

/** One temp fixture root per suite; removed after each test. */
let fixture: string | undefined

function makeFixture(): string {
  fixture = mkdtempSync(join(tmpdir(), 'dsh-update-test-'))
  return fixture
}

afterEach(() => {
  if (fixture !== undefined) {
    rmSync(fixture, { recursive: true, force: true })
    fixture = undefined
  }
})

/** Write one package manifest under the fixture. */
function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest))
}

/** The standard npm-style profile fixture (aggregate + one child). */
function npmFixture(anchorVersion = "0.1.10", childVersion = "0.1.10"): string {
  const root = makeFixture()
  const profileDir = join(root, 'profiles', 'web')
  writeManifest(join(profileDir), {
    name: "dsh-profile-web",
    private: true,
    dependencies: { [AGGREGATE_PACKAGE]: "^0.1.10" },
  })
  const anchorDir = join(profileDir, 'node_modules', '@linxin666', 'dsh-web-all')
  writeManifest(anchorDir, {
    name: AGGREGATE_PACKAGE,
    version: anchorVersion,
    dependencies: { '@linxin666/dsh-ssh': '^0.1.10' },
  })
  writeManifest(join(profileDir, 'node_modules', '@linxin666', 'dsh-ssh'), {
    name: '@linxin666/dsh-ssh',
    version: childVersion,
  })
  return join(anchorDir, "package.json")
}

/** A profile with family plugins installed directly and no aggregate package. */
function standaloneFixture(): { anchor: string; profileDir: string } {
  const root = makeFixture()
  const profileDir = join(root, "profiles", "web")
  writeManifest(profileDir, {
    name: "dsh-profile-web",
    private: true,
    dependencies: {
      [SELF_PACKAGE]: "^0.1.19",
      "@linxin666/dsh-client-ui-git-graph": "^0.1.19",
      "@linxin666/dsh-pet": "link:../../../code/dsh-web-ui/packages/dsh-pet",
      "@linxin666/dsh-ssh": "^0.1.19",
      react: "^18.2.0",
    },
  })
  for (const name of [SELF_PACKAGE, "@linxin666/dsh-client-ui-git-graph", "@linxin666/dsh-ssh"]) {
    writeManifest(join(profileDir, "node_modules", ...name.split("/")), { name, version: "0.1.19" })
  }
  return {
    anchor: join(profileDir, "node_modules", ...SELF_PACKAGE.split("/"), "package.json"),
    profileDir,
  }
}

describe("parseSemver", () => {
  it("parses release and prerelease versions", () => {
    expect(parseSemver("0.1.10")).toEqual({ major: 0, minor: 1, patch: 10, prerelease: [] })
    expect(parseSemver("v1.2.3-rc.1")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: ["rc", "1"] })
    expect(parseSemver("1.2.3+build.5")?.prerelease).toEqual([])
  })
  it("rejects malformed versions", () => {
    expect(parseSemver("abc")).toBeUndefined()
    expect(parseSemver("1.2")).toBeUndefined()
    expect(parseSemver("1.2.3.4")).toBeUndefined()
  })
})

describe("compareVersions", () => {
  it("orders releases numerically", () => {
    expect(compareVersions("0.1.9", "0.1.10")).toBeLessThan(0)
    expect(compareVersions("0.1.10", "0.1.10")).toBe(0)
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0)
  })
  it("orders prereleases below their release", () => {
    expect(compareVersions("0.1.11-rc.1", "0.1.11")).toBeLessThan(0)
    expect(compareVersions("0.1.10", "0.1.11-rc.1")).toBeLessThan(0)
  })
  it("orders prerelease identifiers per semver", () => {
    expect(compareVersions("0.1.11-rc.1", "0.1.11-rc.2")).toBeLessThan(0)
    expect(compareVersions("0.1.11-rc.10", "0.1.11-rc.9")).toBeGreaterThan(0)
    // Alphanumeric identifiers compare lexicographically: beta < rc.
    expect(compareVersions("0.1.11-rc.1", "0.1.11-beta.1")).toBeGreaterThan(0)
    expect(compareVersions("0.1.11-alpha", "0.1.11-rc")).toBeLessThan(0)
  })
  it("sorts unparseable versions below parseable ones", () => {
    expect(compareVersions("garbage", "0.1.10")).toBeLessThan(0)
    expect(compareVersions("garbage", "junk")).toBe(0)
  })
})

describe("isLinkedSpec", () => {
  it("recognizes link/file/relative specs", () => {
    expect(isLinkedSpec("link:../packages/x")).toBe(true)
    expect(isLinkedSpec("file:../x")).toBe(true)
    expect(isLinkedSpec("../x")).toBe(true)
    expect(isLinkedSpec("./x")).toBe(true)
  })
  it("leaves registry specs alone", () => {
    expect(isLinkedSpec("^0.1.10")).toBe(false)
    expect(isLinkedSpec("0.1.10")).toBe(false)
    expect(isLinkedSpec(undefined)).toBe(false)
  })
})

describe("familyChildren", () => {
  it("collects family-scope dependencies only", () => {
    expect(familyChildren({
      dependencies: {
        "@linxin666/dsh-ssh": "^0.1.10",
        "react": "^18.2.0",
      },
    })).toEqual(["@linxin666/dsh-ssh"])
    expect(familyChildren({})).toEqual([])
  })
})

describe("findProfile", () => {
  it("walks up to the dsh-profile-* manifest", () => {
    const anchor = npmFixture()
    expect(findProfile(anchor)).toEqual({ name: "web", dir: join(fixture!, "profiles", "web") })
  })
  it("returns undefined outside a profile", () => {
    const root = makeFixture()
    const dir = join(root, 'checkout', 'packages', 'dsh-web-all')
    writeManifest(dir, { name: AGGREGATE_PACKAGE, version: "0.1.10" })
    expect(findProfile(join(dir, "package.json"))).toBeUndefined()
  })
})

describe("resolveAnchorManifest", () => {
  it("prefers the aggregate over the self package", () => {
    const resolve = (specifier: string) => {
      if (specifier.startsWith(AGGREGATE_PACKAGE)) return "/pkg/all/package.json"
      throw new Error("missing")
    }
    expect(resolveAnchorManifest(resolve)).toBe("/pkg/all/package.json")
  })
  it("falls back to the self package", () => {
    const resolve = (specifier: string) => {
      if (specifier.includes("dsh-remote-web-ui")) return "/pkg/self/package.json"
      throw new Error("missing")
    }
    expect(resolveAnchorManifest(resolve)).toBe("/pkg/self/package.json")
  })
  it("returns undefined when nothing resolves", () => {
    expect(resolveAnchorManifest(() => { throw new Error("missing") })).toBeUndefined()
  })
  it("falls back to the self package when resolve returns undefined", () => {
    // A resolve seam may signal "not installed" with undefined instead of
    // throwing; both must move on to the next candidate.
    const resolve = (specifier: string) => {
      if (specifier.startsWith(AGGREGATE_PACKAGE)) return undefined
      if (specifier.includes("dsh-remote-web-ui")) return "/pkg/self/package.json"
      return undefined
    }
    expect(resolveAnchorManifest(resolve)).toBe("/pkg/self/package.json")
  })
})

describe("release notes", () => {
  it("parses the Chinese release body into features, fixes, and other changes", () => {
    const notes = parseReleaseNotesBody("0.1.11", `本次发布包含 1 项新功能、1 项修复、1 项其他改动。

### 新功能

- [market] add a new catalog page ([#123](https://github.com/zhu1090093659/dsh-web/issues/123))

### 修复

- [doctor] fix policy sync

### 其他改动

- [docs] update release notes

<details>
<summary>English</summary>

### New Features

- ignored English feature

</details>`)
    expect(notes).toEqual({
      version: "0.1.11",
      features: ["[market] add a new catalog page (#123)"],
      fixes: ["[doctor] fix policy sync"],
      other: ["[docs] update release notes"],
    })
  })

  it("fetches and parses the GitHub Release body", async () => {
    let requested = ""
    const notes = await fetchGitHubReleaseNotes("0.1.11", async (url, init) => {
      requested = url
      expect(init?.headers).toMatchObject({ accept: "application/vnd.github+json" })
      return {
        ok: true,
        json: async () => ({ body: "### 新功能\n- Add feature\n" }),
      }
    })
    expect(requested).toBe("https://api.github.com/repos/zhu1090093659/dsh-web/releases/tags/v0.1.11")
    expect(notes).toEqual({ version: "0.1.11", features: ["Add feature"], fixes: [], other: [] })
  })
})

describe("checkUpdates", () => {
  it("checks every directly installed family package when the aggregate is absent", async () => {
    const { anchor } = standaloneFixture()
    const status = await checkUpdates({
      anchorManifestPath: anchor,
      // Package-scoped resolution cannot see sibling direct dependencies in
      // pnpm's strict layout; their profile manifests are the fallback.
      resolve: specifier => specifier === SELF_PACKAGE + "/package.json" ? anchor : undefined,
      fetchLatest: async () => "0.1.20",
    })
    expect(status.mode).toBe("npm")
    expect(status.anchor).toBe(SELF_PACKAGE)
    expect(status.packages.map(item => item.name)).toEqual([
      SELF_PACKAGE,
      "@linxin666/dsh-client-ui-git-graph",
      "@linxin666/dsh-ssh",
    ])
    expect(status.packages.map(item => item.current)).toEqual(["0.1.19", "0.1.19", "0.1.19"])
  })

  it("reports an outdated npm install with per-package comparison", async () => {
    const anchor = npmFixture("0.1.10", "0.1.9")
    const status = await checkUpdates({
      anchorManifestPath: anchor,
      resolve: (specifier) => {
        if (specifier === "@linxin666/dsh-ssh/package.json") {
          return join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-ssh", "package.json")
        }
        return join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-web-all", "package.json")
      },
      fetchLatest: async (name) => name === AGGREGATE_PACKAGE ? "0.1.11" : "0.1.10",
    })
    expect(status.mode).toBe("npm")
    expect(status.profileName).toBe("web")
    expect(status.anchor).toBe(AGGREGATE_PACKAGE)
    expect(status.outdated).toBe(true)
    expect(status.packages).toEqual([
      { name: AGGREGATE_PACKAGE, current: "0.1.10", latest: "0.1.11", outdated: true },
      { name: "@linxin666/dsh-ssh", current: "0.1.9", latest: "0.1.10", outdated: true },
    ])
  })
  it("includes structured release notes when the seam returns them", async () => {
    const anchor = npmFixture("0.1.10", "0.1.10")
    const status = await checkUpdates({
      anchorManifestPath: anchor,
      resolve: () => join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-web-all", "package.json"),
      fetchLatest: async () => "0.1.11",
      fetchReleaseNotes: async version => ({ version, features: ["new"], fixes: ["fix"], other: ["other"] }),
    })
    expect(status.outdated).toBe(true)
    expect(status.notes).toEqual({ version: "0.1.11", features: ["new"], fixes: ["fix"], other: ["other"] })
  })

  it("keeps the status usable when release-note fetching fails", async () => {
    const anchor = npmFixture("0.1.10", "0.1.10")
    const status = await checkUpdates({
      anchorManifestPath: anchor,
      resolve: () => join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-web-all", "package.json"),
      fetchLatest: async () => "0.1.11",
      fetchReleaseNotes: async () => { throw new Error("github unavailable") },
    })
    expect(status.outdated).toBe(true)
    expect(status.notes).toBeUndefined()
  })

  it("reports up-to-date when versions match", async () => {
    const anchor = npmFixture("0.1.10", "0.1.10")
    const status = await checkUpdates({
      anchorManifestPath: anchor,
      resolve: () => join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-web-all", "package.json"),
      fetchLatest: async () => "0.1.10",
    })
    expect(status.mode).toBe("npm")
    expect(status.outdated).toBe(false)
  })
  it("flags a link install as dev mode", async () => {
    const root = makeFixture()
    const profileDir = join(root, 'profiles', 'web')
    writeManifest(join(profileDir), {
      name: "dsh-profile-web",
      dependencies: { [AGGREGATE_PACKAGE]: "link:../../../code/dsh-web-ui/packages/dsh-web-all" },
    })
    const anchorDir = join(profileDir, 'node_modules', '@linxin666', 'dsh-web-all')
    writeManifest(anchorDir, { name: AGGREGATE_PACKAGE, version: "0.1.10", dependencies: {} })
    const status = await checkUpdates({
      anchorManifestPath: join(anchorDir, "package.json"),
      resolve: () => join(anchorDir, "package.json"),
      fetchLatest: async () => "0.1.11",
    })
    expect(status.mode).toBe("link")
    // The version comparison still reports the npm release honestly; only the
    // update itself is refused for dev installs.
    expect(status.outdated).toBe(true)
  })
  it("flags a linked aggregate child as dev mode", async () => {
    const anchor = npmFixture()
    const profileDir = join(fixture!, 'profiles', 'web')
    writeManifest(profileDir, {
      name: "dsh-profile-web",
      dependencies: {
        [AGGREGATE_PACKAGE]: "^0.1.10",
        "@linxin666/dsh-ssh": "link:../../../code/dsh-web-ui/packages/dsh-ssh",
      },
    })
    const status = await checkUpdates({
      anchorManifestPath: anchor,
      resolve: () => anchor,
      fetchLatest: async () => "0.1.11",
    })
    expect(status.mode).toBe("link")
  })
  it("reports registry outage when every probe fails", async () => {
    const anchor = npmFixture()
    const status = await checkUpdates({
      anchorManifestPath: anchor,
      resolve: () => join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-web-all", "package.json"),
      fetchLatest: async () => undefined,
    })
    expect(status.error).toBe("registry-unreachable")
    expect(status.outdated).toBe(false)
  })
  it("reports missing when the anchor is absent", async () => {
    const status = await checkUpdates({
      anchorManifestPath: undefined,
      resolve: () => undefined,
      fetchLatest: async () => "0.1.11",
    })
    expect(status.mode).toBe("missing")
  })
})

describe("resolveUpdateTarget", () => {
  it("updates every directly installed family package when the aggregate is absent", () => {
    const { anchor, profileDir } = standaloneFixture()
    expect(resolveUpdateTarget({ anchorManifestPath: anchor })).toEqual({
      profileName: "web",
      profileDir,
      packages: [
        SELF_PACKAGE,
        "@linxin666/dsh-client-ui-git-graph",
        "@linxin666/dsh-ssh",
      ],
    })
  })

  it("resolves the npm target with anchor + children", () => {
    const anchor = npmFixture()
    const target = resolveUpdateTarget({ anchorManifestPath: anchor })
    expect(target).toEqual({
      profileName: "web",
      profileDir: join(fixture!, "profiles", "web"),
      packages: [AGGREGATE_PACKAGE, "@linxin666/dsh-ssh"],
    })
  })
  it("rejects a link install", () => {
    const root = makeFixture()
    const profileDir = join(root, 'profiles', 'web')
    writeManifest(join(profileDir), {
      name: "dsh-profile-web",
      dependencies: { [AGGREGATE_PACKAGE]: "link:../x" },
    })
    const anchorDir = join(profileDir, 'node_modules', '@linxin666', 'dsh-web-all')
    writeManifest(anchorDir, { name: AGGREGATE_PACKAGE, version: "0.1.10" })
    expect(resolveUpdateTarget({ anchorManifestPath: join(anchorDir, "package.json") })).toEqual({ error: "link" })
  })
  it("rejects a linked aggregate child override", () => {
    const anchor = npmFixture()
    const profileDir = join(fixture!, 'profiles', 'web')
    writeManifest(profileDir, {
      name: "dsh-profile-web",
      dependencies: {
        [AGGREGATE_PACKAGE]: "^0.1.10",
        "@linxin666/dsh-ssh": "link:../../../code/dsh-web-ui/packages/dsh-ssh",
      },
    })
    expect(resolveUpdateTarget({ anchorManifestPath: anchor })).toEqual({ error: "link" })
  })
  it("rejects a missing anchor", () => {
    expect(resolveUpdateTarget({ anchorManifestPath: undefined })).toEqual({ error: "not-found" })
  })
})

/** A fake child process with piped stdio for runUpdate seam tests. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  pid = 1000
  constructor(public exit: number | null, public spawnError?: Error) {
    super()
  }
  kill(): boolean {
    this.killed = true
    return true
  }
  run(exit: number | null): void {
    this.emit("close", exit)
  }
  fail(error: Error): void {
    this.emit("error", error)
  }
  emitOutput(text: string): void {
    this.stdout.emit("data", Buffer.from(text))
  }
}

describe("runUpdate", () => {
  /** Dispatch one fake child per spawned command for fallback-chain tests. */
  function dispatchFake(spawns: Readonly<Record<string, FakeChild>>) {
    const order: string[] = []
    const argo: Array<{ command: string; args: unknown }> = []
    const spawnImpl = ((command: string, args: unknown, _options: unknown) => {
      order.push(command)
      argo.push({ command, args })
      const child = spawns[command]
      if (child === undefined) throw new Error("unexpected command: " + command)
      return child
    }) as never
    return { spawnImpl, order, argo }
  }
  it("spawns pnpm update --latest with the packages and resolves on success", async () => {
    let spawned: { command: string; args: string[]; cwd: string } | undefined
    const child = new FakeChild(0)
    const spawnImpl = ((command: string, args: string[], options: { cwd: string }) => {
      spawned = { command, args, cwd: options.cwd }
      return child
    }) as never
    const promise = runUpdate({ profileDir: "/p", packages: ["a", "b"], spawnImpl })
    child.emitOutput("Progress 1/2")
    child.run(0)
    const result = await promise
    expect(spawned).toEqual({ command: "pnpm", args: ["update", "--latest", "--config.minimumReleaseAge=0", "a", "b"], cwd: "/p" })
    expect(result).toEqual({ ok: true, exitCode: 0, output: "Progress 1/2" })
  })
  it("reports pnpm-failed on a non-zero exit", async () => {
    const child = new FakeChild(1)
    const spawnImpl = (() => child) as never
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl })
    child.run(1)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("pnpm-failed")
    expect(result.exitCode).toBe(1)
  })
  it("falls back to corepack when pnpm is missing and succeeds", async () => {
    const pnpmError = Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" })
    const pnpm = new FakeChild(null)
    const corepack = new FakeChild(0)
    const { spawnImpl, order, argo } = dispatchFake({ pnpm, corepack })
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl })
    pnpm.fail(pnpmError)
    corepack.emitOutput("corepack pnpm 1/2")
    corepack.run(0)
    const result = await promise
    expect(order).toEqual(["pnpm", "corepack"])
    // Every fallback candidate must keep --latest (exact specs in the profile
    // are otherwise treated as pinned and never move) and the release-age
    // override (pnpm 11's minimumReleaseAge gate would silently skip
    // same-day releases); corepack prefixes the pnpm subcommand.
    expect(argo.map(entry => entry.args)).toEqual([
      ["update", "--latest", "--config.minimumReleaseAge=0", "a"],
      ["pnpm", "update", "--latest", "--config.minimumReleaseAge=0", "a"],
    ])
    expect(result).toEqual({ ok: true, exitCode: 0, output: "corepack pnpm 1/2" })
  })
  it("falls back to npx when pnpm and corepack are missing and succeeds", async () => {
    const error = Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    const pnpm = new FakeChild(null)
    const corepack = new FakeChild(null)
    const npx = new FakeChild(0)
    const { spawnImpl, order, argo } = dispatchFake({ pnpm, corepack, npx })
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl })
    pnpm.fail(error)
    corepack.fail(error)
    npx.emitOutput("npx pnpm ok")
    npx.run(0)
    const result = await promise
    expect(order).toEqual(["pnpm", "corepack", "npx"])
    // Every fallback candidate keeps --latest and the release-age override
    // (npx prefixes --yes before pnpm).
    expect(argo.map(entry => entry.args)).toEqual([
      ["update", "--latest", "--config.minimumReleaseAge=0", "a"],
      ["pnpm", "update", "--latest", "--config.minimumReleaseAge=0", "a"],
      ["--yes", "pnpm", "update", "--latest", "--config.minimumReleaseAge=0", "a"],
    ])
    expect(result.ok).toBe(true)
    expect(result.output).toBe("npx pnpm ok")
  })
  it("reports pnpm-missing once pnpm, corepack and npx are all ENOENT", async () => {
    const error = Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    const pnpm = new FakeChild(null)
    const corepack = new FakeChild(null)
    const npx = new FakeChild(null)
    const { spawnImpl, order } = dispatchFake({ pnpm, corepack, npx })
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl })
    pnpm.fail(error)
    corepack.fail(error)
    npx.fail(error)
    const result = await promise
    expect(order).toEqual(["pnpm", "corepack", "npx"])
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("pnpm-missing")
    expect(result.error).toContain("pnpm")
  })
  it("kills and reports timeout", async () => {
    vi.useFakeTimers()
    const child = new FakeChild(null)
    const spawnImpl = (() => child) as never
    // Pin the POSIX SIGTERM kill path (darwin): on win32 the timeout routes
    // through taskkill and never touches child.kill(), which would fail the
    // assertion on Windows hosts.
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl, timeoutMs: 1000, platform: "darwin" })
    vi.advanceTimersByTime(1000)
    const result = await promise
    expect(child.killed).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("timeout")
    vi.useRealTimers()
  })
  it("routes .cmd shims through the shell on win32", async () => {
    const optionsSeen: unknown[] = []
    const child = new FakeChild(0)
    const spawnImpl = ((_command: string, _args: unknown[], options: unknown) => {
      optionsSeen.push(options)
      return child
    }) as never
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl, platform: "win32" })
    child.run(0)
    await promise
    expect(optionsSeen[0]).toMatchObject({ shell: true })
  })
  it("keeps POSIX spawns shell-free", async () => {
    const optionsSeen: unknown[] = []
    const child = new FakeChild(0)
    const spawnImpl = ((_command: string, _args: unknown[], options: unknown) => {
      optionsSeen.push(options)
      return child
    }) as never
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl, platform: "darwin" })
    child.run(0)
    await promise
    expect(optionsSeen[0]).not.toHaveProperty("shell")
  })
  it("falls back on win32 when cmd reports the shim missing", async () => {
    const pnpm = new FakeChild(1)
    const corepack = new FakeChild(0)
    const { spawnImpl, order } = dispatchFake({ pnpm, corepack })
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl, platform: "win32" })
    pnpm.stderr.emit("data", Buffer.from("'pnpm' is not recognized as an internal or external command, operable program or batch file."))
    pnpm.run(1)
    corepack.emitOutput("corepack pnpm ok")
    corepack.run(0)
    const result = await promise
    expect(order).toEqual(["pnpm", "corepack"])
    expect(result.ok).toBe(true)
    // Output accumulates across candidates (the cmd "not recognized" stderr
    // stays in the tail) — the success output must be present.
    expect(result.output).toContain("corepack pnpm ok")
  })
  it("keeps pnpm-failed on win32 for non-missing errors", async () => {
    const child = new FakeChild(1)
    const spawnImpl = (() => child) as never
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl, platform: "win32" })
    child.stderr.emit("data", Buffer.from("ERR_PNPM_OUTDATED_LOCKFILE Cannot proceed"))
    child.run(1)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("pnpm-failed")
  })
  it("does not misclassify a real corepack failure after pnpm missing on win32", async () => {
    // pnpm's 'not recognized' stderr must not bleed into corepack's own
    // diagnostic window and turn a real failure into a (wrong) fallback to npx.
    const pnpm = new FakeChild(1)
    const corepack = new FakeChild(1)
    const npx = new FakeChild(0)
    const { spawnImpl, order } = dispatchFake({ pnpm, corepack, npx })
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl, platform: "win32" })
    pnpm.stderr.emit("data", Buffer.from("'pnpm' is not recognized as an internal or external command, operable program or batch file."))
    pnpm.run(1)
    corepack.stderr.emit("data", Buffer.from("ERR_PNPM_OUTDATED_LOCKFILE Cannot proceed"))
    corepack.run(1)
    const result = await promise
    expect(order).toEqual(["pnpm", "corepack"])
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("pnpm-failed")
  })
  it("does not advance two candidates when error precedes close", async () => {
    // error(ENOENT) then close(null) is the same missing-command event twice:
    // the once/settled guard must only advance the chain one level, then the
    // next candidate runs to success.
    const pnpmError = Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" })
    const pnpm = new FakeChild(null)
    const corepack = new FakeChild(0)
    const { spawnImpl, order } = dispatchFake({ pnpm, corepack })
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl })
    pnpm.fail(pnpmError)
    pnpm.run(null)
    corepack.emitOutput("corepack pnpm ok")
    corepack.run(0)
    const result = await promise
    expect(order).toEqual(["pnpm", "corepack"])
    expect(result.ok).toBe(true)
    expect(result.output).toContain("corepack pnpm ok")
  })
  it("kills the process tree on win32 timeout and never respawns the next candidate", async () => {
    vi.useFakeTimers()
    const pnpmError = Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" })
    const pnpm = new FakeChild(null)
    const corepack = new FakeChild(null)
    const taskkill = new FakeChild(0)
    const { spawnImpl, order, argo } = dispatchFake({ pnpm, corepack, taskkill })
    corepack.pid = 4242
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl, platform: "win32", timeoutMs: 1000 })
    pnpm.fail(pnpmError)
    vi.advanceTimersByTime(1000)
    const result = await promise
    expect(order).toEqual(["pnpm", "corepack", "taskkill"])
    const killed = argo.find(entry => entry.command === "taskkill")
    expect(killed?.args).toEqual(["/pid", "4242", "/t", "/f"])
    // The killed corepack's late close must not spawn a third candidate.
    corepack.run(null)
    expect(order).toEqual(["pnpm", "corepack", "taskkill"])
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("timeout")
    vi.useRealTimers()
  })
})

describe("runUpdateVerified", () => {
  /** The standard check seam for the npm fixture. */
  function fixtureCheck(fetchLatest: (name: string) => Promise<string | undefined>) {
    return {
      anchorManifestPath: npmFixture("0.1.10", "0.1.10"),
      resolve: (specifier: string) => {
        if (specifier === "@linxin666/dsh-ssh/package.json") {
          return join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-ssh", "package.json")
        }
        return join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-web-all", "package.json")
      },
      fetchLatest,
    }
  }

  it("verifies version movement for directly installed family packages", async () => {
    const { anchor, profileDir } = standaloneFixture()
    const packages = [SELF_PACKAGE, "@linxin666/dsh-client-ui-aionui-panel", "@linxin666/dsh-ssh"]
    const child = new FakeChild(0)
    const promise = runUpdateVerified({
      run: { profileDir, packages, spawnImpl: (() => child) as never },
      check: {
        anchorManifestPath: anchor,
        resolve: specifier => specifier === SELF_PACKAGE + "/package.json" ? anchor : undefined,
        fetchLatest: async () => "0.1.20",
      },
    })
    for (const name of packages) {
      writeManifest(join(profileDir, "node_modules", ...name.split("/")), { name, version: "0.1.20" })
    }
    child.run(0)
    await expect(promise).resolves.toEqual({ ok: true, exitCode: 0, output: "" })
  })

  it("reports stale when pnpm exits 0 but the installed versions did not move", async () => {
    // Registry carries 0.1.11 while the installed anchor stays 0.1.10 — the
    // pnpm 11 minimumReleaseAge gate can produce exactly this "green exit,
    // nothing changed" outcome, and the panel must not claim success.
    const child = new FakeChild(0)
    const spawnImpl = (() => child) as never
    const promise = runUpdateVerified({
      run: { profileDir: "/p", packages: [AGGREGATE_PACKAGE], spawnImpl },
      check: fixtureCheck(async name => name === AGGREGATE_PACKAGE ? "0.1.11" : "0.1.10"),
    })
    child.emitOutput("Already up to date")
    child.run(0)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("stale")
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe("Already up to date")
    expect(result.error).toContain("did not change")
  })

  it("resolves ok when the post-run check sees every package current", async () => {
    const child = new FakeChild(0)
    const spawnImpl = (() => child) as never
    const promise = runUpdateVerified({
      run: { profileDir: "/p", packages: [AGGREGATE_PACKAGE], spawnImpl },
      check: fixtureCheck(async () => "0.1.10"),
    })
    child.run(0)
    const result = await promise
    expect(result).toEqual({ ok: true, exitCode: 0, output: "" })
  })

  it("returns the run result unchanged when pnpm fails", async () => {
    const child = new FakeChild(1)
    const spawnImpl = (() => child) as never
    const promise = runUpdateVerified({
      run: { profileDir: "/p", packages: ["a"], spawnImpl },
      check: { anchorManifestPath: undefined, resolve: () => undefined, fetchLatest: async () => "0.1.11" },
    })
    child.run(1)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("pnpm-failed")
  })

  it("reports verify-failed when every post-run registry probe fails", async () => {
    // pnpm exits 0 but the verification has nothing to compare — every
    // registry probe failed. This must not collapse into a false success.
    const child = new FakeChild(0)
    const spawnImpl = (() => child) as never
    const promise = runUpdateVerified({
      run: { profileDir: "/p", packages: [AGGREGATE_PACKAGE], spawnImpl },
      check: fixtureCheck(async () => undefined),
    })
    child.run(0)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("verify-failed")
    expect(result.exitCode).toBe(0)
  })

  it("reports verify-failed when the post-run anchor cannot be resolved", async () => {
    // pnpm exits 0, then the post-run check loses the anchor entirely
    // (mode 'missing') — the boot-time captured path pointed at the old
    // version's .pnpm directory and nothing re-resolves. Not a success.
    const child = new FakeChild(0)
    const spawnImpl = (() => child) as never
    const promise = runUpdateVerified({
      run: { profileDir: "/p", packages: [AGGREGATE_PACKAGE], spawnImpl },
      check: { anchorManifestPath: undefined, resolve: () => undefined, fetchLatest: async () => "0.1.11" },
    })
    child.run(0)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("verify-failed")
  })

  it("accepts a partial update as success when versions moved", async () => {
    // Lenient minimumReleaseAge gate: pnpm moves 0.1.10 -> 0.1.13 while the
    // registry latest is 0.1.15 — versions moved, so this is a real update,
    // not a stale failure (the stale decision anchors on the pre-run
    // versions, not on the registry latest).
    const anchor = npmFixture("0.1.10", "0.1.10")
    const child = new FakeChild(0)
    const spawnImpl = (() => child) as never
    const promise = runUpdateVerified({
      run: { profileDir: "/p", packages: [AGGREGATE_PACKAGE], spawnImpl },
      check: {
        anchorManifestPath: anchor,
        resolve: (specifier: string) => {
          if (specifier === "@linxin666/dsh-ssh/package.json") {
            return join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-ssh", "package.json")
          }
          return anchor
        },
        fetchLatest: async () => "0.1.15",
      },
    })
    // pnpm actually updates the installed anchor on disk (the gate allowed a
    // partial move to 0.1.13) before it exits 0.
    writeManifest(join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-web-all"), {
      name: AGGREGATE_PACKAGE,
      version: "0.1.13",
      dependencies: { "@linxin666/dsh-ssh": "^0.1.10" },
    })
    child.run(0)
    const result = await promise
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
  })

  it("reports verify-failed when a non-npm mode follows a green exit", async () => {
    // The post-run check resolves into a link install (no profile walk) —
    // there is no registry comparison to trust, so the run must not claim
    // success.
    const root = makeFixture()
    const anchorDir = join(root, 'checkout', 'node_modules', '@linxin666', 'dsh-web-all')
    writeManifest(anchorDir, { name: AGGREGATE_PACKAGE, version: "0.1.10", dependencies: {} })
    const child = new FakeChild(0)
    const spawnImpl = (() => child) as never
    const promise = runUpdateVerified({
      run: { profileDir: "/p", packages: [AGGREGATE_PACKAGE], spawnImpl },
      check: {
        anchorManifestPath: join(anchorDir, "package.json"),
        resolve: () => join(anchorDir, "package.json"),
        fetchLatest: async () => "0.1.11",
      },
    })
    child.run(0)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("verify-failed")
  })

  it("reports stale rather than success when a package becomes unreadable and nothing moved", async () => {
    // A green exit that re-lays node_modules can leave a family child's
    // manifest unreadable at the post-run check. An unreadable version reads
    // as the unknown sentinel, which is NOT evidence of movement — a no-op
    // update must not collapse into "update complete". The anchor still being
    // outdated is what drives the stale verdict.
    const anchor = npmFixture("0.1.10", "0.1.10")
    const childDir = join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-ssh")
    const child = new FakeChild(0)
    const spawnImpl = (() => child) as never
    const promise = runUpdateVerified({
      run: { profileDir: "/p", packages: [AGGREGATE_PACKAGE], spawnImpl },
      check: {
        anchorManifestPath: anchor,
        resolve: (specifier: string) => {
          if (specifier === "@linxin666/dsh-ssh/package.json") {
            return join(childDir, "package.json")
          }
          return anchor
        },
        fetchLatest: async name => name === AGGREGATE_PACKAGE ? "0.1.11" : "0.1.10",
      },
    })
    // pre-run snapshot reads the child fine; pnpm then (green) removes it.
    rmSync(childDir, { recursive: true, force: true })
    child.run(0)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("stale")
  })

  it("reports verify-failed when nothing moved and a post-run probe failed", async () => {
    // The panel launches the update because a package was outdated; pnpm
    // exits 0 without moving anything, and the post-run probe for that very
    // package now fails. status.outdated is false only because the probe has
    // no latest to compare against, so "update complete" would be a false
    // success — verify-failed is the honest verdict.
    const anchor = npmFixture("0.1.10", "0.1.10")
    const child = new FakeChild(0)
    const spawnImpl = (() => child) as never
    const promise = runUpdateVerified({
      run: { profileDir: "/p", packages: [AGGREGATE_PACKAGE], spawnImpl },
      check: {
        anchorManifestPath: anchor,
        resolve: (specifier: string) => {
          if (specifier === "@linxin666/dsh-ssh/package.json") {
            return join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-ssh", "package.json")
          }
          return anchor
        },
        // The anchor probe fails while the child succeeds — a partial probe
        // failure (probeFailures < names.length), so status.error stays unset
        // and this must route through the verify-failed branch, not success.
        fetchLatest: async name => name === AGGREGATE_PACKAGE ? undefined : "0.1.10",
      },
    })
    child.run(0)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("verify-failed")
    expect(result.exitCode).toBe(0)
  })
})

describe('fetchLatestVersion', () => {
  it('passes the abort signal to the fetch implementation', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ version: '1.2.3' }),
    }))
    const version = await fetchLatestVersion('@linxin666/dsh-remote-web-ui', fetchImpl)
    expect(version).toBe('1.2.3')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit | undefined]
    expect(String(url)).toContain('/latest')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('returns undefined when the registry probe rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(fetchLatestVersion('@linxin666/dsh-remote-web-ui', fetchImpl)).resolves.toBeUndefined()
  })
})
