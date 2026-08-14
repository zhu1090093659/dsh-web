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
  findProfile,
  isLinkedSpec,
  parseSemver,
  resolveAnchorManifest,
  resolveUpdateTarget,
  runUpdate,
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
  const anchorDir = join(profileDir, 'node_modules', '@linxin666', 'dsh-web-ui-all')
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
    const dir = join(root, 'checkout', 'packages', 'dsh-web-ui-all')
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
})

describe("checkUpdates", () => {
  it("reports an outdated npm install with per-package comparison", async () => {
    const anchor = npmFixture("0.1.10", "0.1.9")
    const status = await checkUpdates({
      anchorManifestPath: anchor,
      resolve: (specifier) => {
        if (specifier === "@linxin666/dsh-ssh/package.json") {
          return join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-ssh", "package.json")
        }
        return join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-web-ui-all", "package.json")
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
  it("reports up-to-date when versions match", async () => {
    const anchor = npmFixture("0.1.10", "0.1.10")
    const status = await checkUpdates({
      anchorManifestPath: anchor,
      resolve: () => join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-web-ui-all", "package.json"),
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
      dependencies: { [AGGREGATE_PACKAGE]: "link:../../../code/dsh-web-ui/packages/dsh-web-ui-all" },
    })
    const anchorDir = join(profileDir, 'node_modules', '@linxin666', 'dsh-web-ui-all')
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
  it("reports registry outage when every probe fails", async () => {
    const anchor = npmFixture()
    const status = await checkUpdates({
      anchorManifestPath: anchor,
      resolve: () => join(fixture!, "profiles", "web", "node_modules", "@linxin666", "dsh-web-ui-all", "package.json"),
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
    const anchorDir = join(profileDir, 'node_modules', '@linxin666', 'dsh-web-ui-all')
    writeManifest(anchorDir, { name: AGGREGATE_PACKAGE, version: "0.1.10" })
    expect(resolveUpdateTarget({ anchorManifestPath: join(anchorDir, "package.json") })).toEqual({ error: "link" })
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
  it("spawns pnpm update with the packages and resolves on success", async () => {
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
    expect(spawned).toEqual({ command: "pnpm", args: ["update", "a", "b"], cwd: "/p" })
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
  it("reports pnpm-missing on ENOENT", async () => {
    const error = Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" })
    const child = new FakeChild(null, error)
    const spawnImpl = (() => child) as never
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl })
    child.fail(error)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("pnpm-missing")
  })
  it("kills and reports timeout", async () => {
    vi.useFakeTimers()
    const child = new FakeChild(null)
    const spawnImpl = (() => child) as never
    const promise = runUpdate({ profileDir: "/p", packages: ["a"], spawnImpl, timeoutMs: 1000 })
    vi.advanceTimersByTime(1000)
    const result = await promise
    expect(child.killed).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe("timeout")
    vi.useRealTimers()
  })
})
