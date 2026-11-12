import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { apply } from '../src/index.ts'

/**
 * The packaged Desktop launcher boots the running profile through
 * `runProfile()` with neither a `--profile` flag nor a DSH_PROFILE variable,
 * so the host half used to throw "cannot determine the boot profile" and
 * return BEFORE registering a single gateway route. Every
 * `/api/plugin-manager/*` request then answered 404 while the family row
 * stayed listed as active (the browser half reported "gateway
 * api/plugin-manager/check-updates failed: HTTP 404").
 *
 * These cases drive the real `apply()` with a context that provides the
 * webServer seam, and assert the registered route table - the observable host
 * behaviour the browser half depends on. Three launcher shapes are covered:
 * the `profileContext` service the current runtime publishes; a runtime that
 * publishes NO service but whose argv carries the profile directory the host
 * passes its own profile loader; and a host that names a profile through
 * neither.
 */
const ROUTES = [
  '/api/plugin-manager/check-updates',
  '/api/plugin-manager/failures',
  '/api/plugin-manager/install',
  '/api/plugin-manager/list',
  '/api/plugin-manager/mode',
  '/api/plugin-manager/remove',
  '/api/plugin-manager/restart',
  '/api/plugin-manager/set-enabled',
  '/api/plugin-manager/status',
  '/api/plugin-manager/update',
  '/api/plugin-manager/updates',
]

/**
 * The packaged Desktop argv for one profile directory. Electron under
 * ELECTRON_RUN_AS_NODE strips exec switches, so `--expose-internals` never
 * reaches `process.argv`; the profile directory is the positional argument
 * the launcher passes the desktop host alongside the dsh install.
 * @param profileDir - the profile directory the launcher boots.
 */
function desktopArgv(profileDir: string): string[] {
  return [
    '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',
    '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js',
    '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh',
    profileDir,
    '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime',
    '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/pnpm/bin/pnpm.mjs',
    '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/bin',
  ]
}

/** An ordinary CLI argv that names no profile and no desktop launcher. */
const PLAIN_ARGV = ['/usr/local/bin/node', '/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js']

/** The published profileContext the packaged Desktop host provides. */
function publishedContext(profileDir: string): Record<string, string> {
  return { name: 'desktop', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml') }
}

/** One case's launcher shape. */
interface Case {
  /** Whether the host publishes the launched profile service. */
  publish: boolean
  /** Whether argv is the packaged Desktop launcher carrying the profile dir. */
  desktopArgv: boolean
  /** Whether the resolved profile directory holds a package.json. */
  realizeProfile: boolean
}

/**
 * Run the real host half against a temp DSH_HOME with the given launcher
 * shape and report the route table it registered. The snapshot is taken before
 * teardown, because disposing the fiber retracts the routes.
 * @param shape - the launcher facts this case provides.
 * @returns the registered route paths, sorted.
 */
async function applyOn(shape: Case): Promise<string[]> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-launch-'))
  const profileDir = join(home, 'profiles', 'desktop')
  const registered = new Map<string, WebRoute>()
  const disposers: Array<() => void> = []
  // Every variable the persisted-selection fallback reads is saved and
  // neutralized: the case must not inherit a desktop selection from the
  // machine running the suite, and it must restore exactly what it found.
  const saved = {
    argv: process.argv,
    profile: process.env.DSH_PROFILE,
    home: process.env.DSH_HOME,
    envHome: process.env.HOME,
    appData: process.env.APPDATA,
    xdg: process.env.XDG_CONFIG_HOME,
    desktopDefault: process.env.DSH_DESKTOP_DEFAULT_PROFILE,
  }
  try {
    if (shape.realizeProfile) {
      mkdirSync(profileDir, { recursive: true })
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', private: true }), 'utf8')
      writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n', 'utf8')
    }
    const ctx = {
      get: (name: string) => (name === 'profileContext' && shape.publish ? publishedContext(profileDir) : undefined),
      effect: (fn: () => unknown) => {
        const disposer = fn()
        disposers.push(typeof disposer === 'function' ? disposer as () => void : () => {})
        return disposer
      },
      webServer: {
        register: (route: WebRoute) => {
          registered.set(route.path, route)
          return () => { registered.delete(route.path) }
        },
      },
    } as unknown as Context

    process.argv = shape.desktopArgv ? desktopArgv(profileDir) : PLAIN_ARGV
    delete process.env.DSH_PROFILE
    process.env.DSH_HOME = home
    process.env.HOME = home
    delete process.env.APPDATA
    delete process.env.XDG_CONFIG_HOME
    delete process.env.DSH_DESKTOP_DEFAULT_PROFILE
    await apply(ctx)
    return [...registered.keys()].sort()
  } finally {
    process.argv = saved.argv
    if (saved.profile === undefined) delete process.env.DSH_PROFILE
    else process.env.DSH_PROFILE = saved.profile
    if (saved.home === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved.home
    if (saved.envHome === undefined) delete process.env.HOME
    else process.env.HOME = saved.envHome
    if (saved.appData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = saved.appData
    if (saved.xdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = saved.xdg
    if (saved.desktopDefault === undefined) delete process.env.DSH_DESKTOP_DEFAULT_PROFILE
    else process.env.DSH_DESKTOP_DEFAULT_PROFILE = saved.desktopDefault
    for (const disposer of disposers.reverse()) disposer()
    rmSync(home, { recursive: true, force: true })
  }
}

describe('plugin-manager host half on the packaged Desktop launcher', () => {
  it('operator: registers every gateway route from the published launched profile', async () => {
    // Given the packaged Desktop argv and the profileContext the runtime publishes
    // When the host half applies
    // Then every gateway route the browser half calls is registered
    const routes = await applyOn({ publish: true, desktopArgv: true, realizeProfile: true })
    expect(routes).toEqual(ROUTES)
  })

  it('operator: registers every gateway route from the argv fact when no service is published', async () => {
    // Given a runtime that publishes NO profileContext, whose Desktop argv
    // carries the profile directory the launcher booted
    // When the host half applies
    // Then the routes are still registered, so an older runtime is not a 404
    const routes = await applyOn({ publish: false, desktopArgv: true, realizeProfile: true })
    expect(routes).toEqual(ROUTES)
  })

  it('operator: leaves the routes unregistered when no launcher fact names a profile', async () => {
    // Given an ordinary CLI argv, no published service, and no persisted selection
    // When the host half applies
    // Then it stays dormant instead of mounting against a guessed profile
    const routes = await applyOn({ publish: false, desktopArgv: false, realizeProfile: true })
    expect(routes).toEqual([])
  })

  it('operator: leaves the routes unregistered when the named profile is not initialized', async () => {
    // Given the Desktop argv naming a directory that carries no package.json
    // When the host half applies
    // Then the gateway declines to mount on an uninitialized profile
    const routes = await applyOn({ publish: true, desktopArgv: true, realizeProfile: false })
    expect(routes).toEqual([])
  })
})
