/**
 * The restart verdict and its execution. The mode decides whether a plugin
 * update can be made effective in place (a relaunch), must be handed to the
 * packaged Desktop shell that owns the process tree, or cannot be done at all;
 * every case is asserted on the returned mode, not on a string in a message.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  performRestart,
  planRestart,
  RESTART_EXIT_DELAY_MS,
  type RelaunchCommand,
  type RestartFacts,
} from '../src/host/restart.ts'

/** Launch facts for a plain interactive CLI run. */
function facts(overrides: Partial<RestartFacts> = {}): RestartFacts {
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

describe('restart planning', () => {
  it('operator on a packaged Desktop host whose shell replaces a stopped host: the shell carries the restart', () => {
    // Given a host the packaged Desktop launcher booted, with the shell's
    // restart guarantee in the environment
    const launch = facts({ desktop: true, env: { DSH_SHELL_RESTARTS_HOST: '1' } })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then this process only stops: the shell brings a fresh host back
    expect(plan.mode).toBe('shell')
    expect(plan.command).toBeUndefined()
  })

  it('operator on a packaged Desktop host without the restart guarantee: the host keeps serving', () => {
    // Given a packaged Desktop host whose shell only reports a stopped host
    const launch = facts({ desktop: true })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then nothing stops: a self-exit here would leave a dead window with no
    // host, which is worse than deferring the restart to the user
    expect(plan.mode).toBe('manual')
    expect(plan.command).toBeUndefined()
  })

  it('operator on an Electron-spawned host with the restart guarantee gets the shell restart', () => {
    // Given a host whose environment marks it as an Electron child of a shell
    // that replaces a stopped host
    const launch = facts({
      env: { ELECTRON_RUN_AS_NODE: '1', DSH_SHELL_RESTARTS_HOST: '1' },
      interactive: false,
    })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then the shell owns it, not a detached respawn
    expect(plan.mode).toBe('shell')
  })

  it('operator on an Electron-spawned host without the restart guarantee: the host keeps serving', () => {
    // Given a host whose environment only marks it as an Electron child
    const launch = facts({ env: { ELECTRON_RUN_AS_NODE: '1' }, interactive: false })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then it does not stop itself for a shell that never promised a respawn
    expect(plan.mode).toBe('manual')
  })

  it('operator on a terminal launch: the host re-executes its own command line', () => {
    // Given an interactive CLI run with an extra runtime flag
    const launch = facts({ execArgv: ['--enable-source-maps'] })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then the replacement runs the same interpreter, script and arguments
    expect(plan.mode).toBe('relaunch')
    expect(plan.command).toEqual({
      execPath: '/usr/local/bin/node',
      argv: [
        '--enable-source-maps',
        '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
        'web',
      ],
      cwd: '/Users/example/work',
      env: {},
    } satisfies RelaunchCommand)
  })

  it('operator restarting a launch with inspector flags: they are dropped from the replacement', () => {
    // Given a launch carrying inspector flags
    const launch = facts({ execArgv: ['--inspect=127.0.0.1:9229', '--trace-warnings'] })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then the port-binding flags are gone and everything else survives
    expect(plan.command?.argv).toEqual([
      '--trace-warnings',
      '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js',
      'web',
    ])
  })

  it('operator on a supervised launch without a terminal: nothing is restarted', () => {
    // Given a host started by something that watches it (piped stdio)
    const launch = facts({ interactive: false })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then no replacement is created and this process keeps serving
    expect(plan.mode).toBe('manual')
  })

  it('operator on a systemd user service without a terminal: systemd restarts the unit', () => {
    // Given a host systemd started as a user service, so it has no terminal of
    // its own and a manager that restarts the unit on request
    const launch = facts({ interactive: false, systemd: { unit: 'dsh-web.service', scope: 'user' } })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then the manager carries the restart and the plan names the unit it asks
    expect(plan).toEqual({ mode: 'systemd', unit: 'dsh-web.service' })
  })

  it('operator on a packaged Desktop host that is also a systemd service: the shell still owns it', () => {
    // Given a packaged Desktop launch, which the shell owns, that systemd also
    // started as a unit
    const launch = facts({
      desktop: true,
      interactive: false,
      env: { DSH_SHELL_RESTARTS_HOST: '1' },
      systemd: { unit: 'dsh-web.service', scope: 'user' },
    })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then the party that owns the process tree is unchanged: the shell restarts
    expect(plan).toEqual({ mode: 'shell' })
  })

  it('operator on a system-scope service: nothing is restarted', () => {
    // Given a service the system manager owns, which this process cannot ask
    const launch = facts({ interactive: false, systemd: { unit: 'dsh-web.service', scope: 'system' } })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then the answer stays manual, exactly like any other supervised launch
    expect(plan).toEqual({ mode: 'manual' })
  })

  it('operator on a launch with no script in argv: nothing is restarted', () => {
    // Given a host whose argv carries no entry script
    const launch = facts({ argv: [] })

    // When the restart is planned
    const plan = planRestart(launch)

    // Then there is no command line to re-execute
    expect(plan).toEqual({ mode: 'manual' })
  })
})

describe('restart execution', () => {
  it('operator carrying out a manual plan: nothing is spawned and nothing exits', () => {
    // Given a manual verdict
    const exit = vi.fn()
    const schedule = vi.fn()

    // When it is carried out
    const mode = performRestart({ mode: 'manual' }, { exit, schedule })

    // Then nothing is spawned and nothing is scheduled to exit
    expect(mode).toBe('manual')
    expect(schedule).not.toHaveBeenCalled()
  })

  it('operator carrying out a shell plan: the process exits after the answer can flush', () => {
    // Given a shell verdict
    const exit = vi.fn()
    const schedule = vi.fn((run: () => void) => { run() })
    const startHelper = vi.fn(() => true)

    // When it is carried out
    const mode = performRestart({ mode: 'shell' }, { exit, schedule, startHelper })

    // Then the process exits on the restart delay, with no helper spawned
    expect(mode).toBe('shell')
    expect(startHelper).not.toHaveBeenCalled()
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), RESTART_EXIT_DELAY_MS)
    expect(exit).toHaveBeenCalled()
  })

  it('operator carrying out a relaunch plan: the helper starts before the process exits', () => {
    // Given a relaunch verdict
    const command: RelaunchCommand = { execPath: '/usr/local/bin/node', argv: ['web'], cwd: '/work', env: {} }
    const exit = vi.fn()
    const startHelper = vi.fn(() => true)
    const schedule = vi.fn((run: () => void) => { run() })

    // When it is carried out
    const mode = performRestart({ mode: 'relaunch', command }, { exit, schedule, startHelper })

    // Then the helper was started with that command and the process exits
    expect(mode).toBe('relaunch')
    expect(startHelper).toHaveBeenCalledWith(command)
    expect(exit).toHaveBeenCalled()
  })

  it('operator carrying out a systemd plan: the unit is asked only after the answer can go out', () => {
    // Given a systemd verdict whose scheduled request is held back
    const exit = vi.fn()
    const requestUnit = vi.fn()
    const pending: (() => void)[] = []
    const schedule = vi.fn((run: () => void) => { pending.push(run) })

    // When it is carried out
    const mode = performRestart({ mode: 'systemd', unit: 'dsh-web.service' }, { exit, schedule, requestUnit })

    // Then the response can be written first: nothing has been asked of systemd
    // yet, and this process has not exited on its own
    expect(mode).toBe('systemd')
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), RESTART_EXIT_DELAY_MS)
    expect(requestUnit).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()

    // When the restart delay elapses
    for (const run of pending) run()

    // Then the unit the plan named is the one asked to restart
    expect(requestUnit).toHaveBeenCalledWith('dsh-web.service')
  })

  it('operator carrying out a systemd plan whose request fails: the mode stays systemd', () => {
    // Given a systemd verdict and a request seam that reports failure
    const requestUnit = vi.fn(() => false)
    const schedule = vi.fn((run: () => void) => { run() })

    // When it is carried out
    const mode = performRestart({ mode: 'systemd', unit: 'dsh-web.service' }, { schedule, requestUnit })

    // Then the accepted request is what the browser is told: a failed delivery
    // is journaled by the real seam, not reported as a different restart mode
    expect(mode).toBe('systemd')
    expect(requestUnit).toHaveBeenCalledWith('dsh-web.service')
  })

  it('operator carrying out a systemd plan that names no unit: it degrades to manual', () => {
    // Given a systemd verdict with no unit to ask
    const requestUnit = vi.fn()
    const schedule = vi.fn()

    // When it is carried out
    const mode = performRestart({ mode: 'systemd' }, { schedule, requestUnit })

    // Then nothing is scheduled and the answer says a human must restart
    expect(mode).toBe('manual')
    expect(schedule).not.toHaveBeenCalled()
  })

  it('operator carrying out a relaunch plan whose helper cannot start: it degrades to manual', () => {
    // Given a relaunch verdict whose helper cannot be created
    const command: RelaunchCommand = { execPath: '/usr/local/bin/node', argv: ['web'], cwd: '/work', env: {} }
    const exit = vi.fn()
    const schedule = vi.fn()

    // When it is carried out
    const mode = performRestart({ mode: 'relaunch', command }, { exit, schedule, startHelper: () => false })

    // Then this process stays up and reports that a human must restart
    expect(mode).toBe('manual')
    expect(schedule).not.toHaveBeenCalled()
  })
})
