/**
 * The gateway restart route: loopback-fenced like every other route, and it
 * reports the mode the host actually used (in-place relaunch, the packaged
 * Desktop shell, or a manual restart the user must perform).
 */

import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { makeGatewayRoutes } from '../src/host/routes.ts'
import type { CliGateway } from '../src/host/gateway.ts'
import type { ProfileFacts } from '../src/host/profile.ts'
import type { RestartFacts } from '../src/host/restart.ts'

/** Profile facts for a bare directory: the restart route reads none of it. */
function facts(): ProfileFacts {
  return {
    profileName: 'web',
    profileDir: '/tmp/does-not-matter',
    patchPath: '/tmp/does-not-matter/cordis.patch.yml',
    packageJsonPath: '/tmp/does-not-matter/package.json',
  }
}

/** A request from the given address and method. */
function request(remoteAddress = '127.0.0.1', method = 'POST'): IncomingMessage {
  const stream = Readable.from([Buffer.from('{}')]) as unknown as IncomingMessage
  stream.socket = { remoteAddress } as IncomingMessage['socket']
  stream.headers = { host: '127.0.0.1:19387' }
  stream.method = method
  return stream
}

function response(): { res: ServerResponse; status: () => number; body: () => unknown } {
  let code = 200
  let text = ''
  return {
    res: { writeHead(value: number) { code = value }, end(value: string) { text = value } } as unknown as ServerResponse,
    status: () => code,
    body: () => JSON.parse(text),
  }
}

/** The restart route over injected launch facts and effects. */
function restartRoute(
  launch: RestartFacts,
  runtime: {
    startHelper?: () => boolean
    requestUnit?: (unit: string) => void
    exit?: () => void
    schedule?: (run: () => void) => void
  },
) {
  const gateway = {} as unknown as CliGateway
  const handler = makeGatewayRoutes({
    facts: facts(),
    gateway,
    cliAvailable: () => true,
    restartFacts: () => launch,
    // A fake exit: a test must never take the runner down with the host.
    restartRuntime: { schedule: (run: () => void) => { run() }, exit: () => {}, ...runtime },
  }).find(route => route.path === '/api/plugin-manager/restart')!.handler
  return handler
}

/** Launch facts for a terminal CLI run. */
function launch(overrides: Partial<RestartFacts> = {}): RestartFacts {
  return {
    env: {},
    execPath: '/usr/local/bin/node',
    argv: ['/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web'],
    execArgv: [],
    cwd: '/Users/example/work',
    interactive: true,
    ...overrides,
  }
}

describe('gateway restart route', () => {
  it('user reading the restart plan: the mode is answered and nothing is touched', async () => {
    // Given a terminal-launched host with a working helper
    const startHelper = vi.fn(() => true)
    const exit = vi.fn()
    const handler = restartRoute(launch(), { startHelper, exit })
    const captured = response()

    // When the plan is read with a GET
    await handler(request('127.0.0.1', 'GET'), captured.res)

    // Then the mode is reported without spawning anything or leaving the process
    expect(captured.status()).toBe(200)
    expect(captured.body()).toEqual({ restart: { mode: 'relaunch' } })
    expect(startHelper.mock.calls).toHaveLength(0)
    expect(exit.mock.calls).toHaveLength(0)
  })

  it('user sending another method: the route refuses it instead of restarting', async () => {
    // Given a host that a GET would have restarted before the method guard
    const startHelper = vi.fn(() => true)
    const handler = restartRoute(launch(), { startHelper })
    const captured = response()

    // When the route is called with DELETE
    await handler(request('127.0.0.1', 'DELETE'), captured.res)

    // Then it is refused and no replacement was started
    expect(captured.status()).toBe(405)
    expect(startHelper.mock.calls).toHaveLength(0)
  })

  it('user restarting a terminal-launched host: the route answers relaunch and a helper starts', async () => {
    // Given a terminal-launched host whose helper starts
    const startHelper = vi.fn(() => true)
    const handler = restartRoute(launch(), { startHelper })
    const captured = response()

    // When the restart route is called
    await handler(request(), captured.res)

    // Then a replacement was spawned and the browser is told it relaunches
    expect(captured.status()).toBe(202)
    expect(captured.body()).toEqual({ restart: { mode: 'relaunch' } })
    expect(startHelper).toHaveBeenCalledTimes(1)
  })

  it('user on a packaged Desktop host whose shell replaces a stopped host: the route answers shell and nothing is spawned', async () => {
    // Given a host the Desktop shell owns and promises to respawn
    const startHelper = vi.fn(() => true)
    const handler = restartRoute(
      launch({ desktop: true, env: { DSH_SHELL_RESTARTS_HOST: '1' } }),
      { startHelper },
    )
    const captured = response()

    // When the restart route is called
    await handler(request(), captured.res)

    // Then no helper runs and the mode is the shell's own restart
    expect(captured.status()).toBe(202)
    expect(captured.body()).toEqual({ restart: { mode: 'shell' } })
    expect(startHelper).not.toHaveBeenCalled()
  })

  it('user on a packaged Desktop host whose shell only reports a stopped host: the route answers manual and the host keeps serving', async () => {
    // Given a host the Desktop shell owns but does not respawn
    const startHelper = vi.fn(() => true)
    const handler = restartRoute(launch({ desktop: true }), { startHelper })
    const captured = response()

    // When the restart route is called
    await handler(request(), captured.res)

    // Then the host declines to stop itself: no helper, no shell exit
    expect(captured.status()).toBe(202)
    expect(captured.body()).toEqual({ restart: { mode: 'manual' } })
    expect(startHelper).not.toHaveBeenCalled()
  })

  it('user on a host that cannot be replaced: the route answers manual', async () => {
    // Given a supervised launch with no terminal
    const handler = restartRoute(launch({ interactive: false }), {})
    const captured = response()

    // When the restart route is called
    await handler(request(), captured.res)

    // Then the answer says a human must restart, and the host was not scheduled to exit
    expect(captured.body()).toEqual({ restart: { mode: 'manual' } })
  })

  it('user on a systemd user service: the plan names the unit that would restart the host', async () => {
    // Given a host systemd started as a user service
    const startHelper = vi.fn(() => true)
    const handler = restartRoute(
      launch({ interactive: false, systemd: { unit: 'dsh-web.service', scope: 'user' } }),
      { startHelper },
    )
    const captured = response()

    // When the plan is read with a GET
    await handler(request('127.0.0.1', 'GET'), captured.res)

    // Then the mode and the unit are answered and nothing has been asked of systemd
    expect(captured.status()).toBe(200)
    expect(captured.body()).toEqual({ restart: { mode: 'systemd', unit: 'dsh-web.service' } })
    expect(startHelper.mock.calls).toHaveLength(0)
  })

  it('user restarting a systemd user service: the route answers systemd and asks that unit', async () => {
    // Given a host systemd started as a user service
    const requestUnit = vi.fn()
    const handler = restartRoute(
      launch({ interactive: false, systemd: { unit: 'dsh-web.service', scope: 'user' } }),
      { requestUnit },
    )
    const captured = response()

    // When the restart route is called
    await handler(request(), captured.res)

    // Then the browser is told systemd does it, and the unit was asked to restart
    expect(captured.status()).toBe(202)
    expect(captured.body()).toEqual({ restart: { mode: 'systemd' } })
    expect(requestUnit).toHaveBeenCalledWith('dsh-web.service')
  })

  it('user waiting for the answer while systemd is asked: the answer is written first', async () => {
    // Given a systemd restart whose scheduled request is held back
    const requestUnit = vi.fn()
    const pending: (() => void)[] = []
    const handler = restartRoute(
      launch({ interactive: false, systemd: { unit: 'dsh-web.service', scope: 'user' } }),
      { requestUnit, schedule: (run: () => void) => { pending.push(run) } },
    )
    const captured = response()

    // When the restart route is called
    await handler(request(), captured.res)

    // Then the 202 the browser needs is already written and systemd is not asked yet
    expect(captured.status()).toBe(202)
    expect(captured.body()).toEqual({ restart: { mode: 'systemd' } })
    expect(requestUnit).not.toHaveBeenCalled()

    // When the restart delay elapses
    for (const run of pending) run()

    // Then the unit is asked to restart
    expect(requestUnit).toHaveBeenCalledWith('dsh-web.service')
  })

  it('user calling from a non-loopback origin: the route is refused like every other one', async () => {
    // Given a request from another host
    const handler = restartRoute(launch(), {})
    const captured = response()

    // When the restart route is called
    await handler(request('10.0.0.5'), captured.res)

    // Then the fence answers 403 and nothing is restarted
    expect(captured.status()).toBe(403)
  })
})
