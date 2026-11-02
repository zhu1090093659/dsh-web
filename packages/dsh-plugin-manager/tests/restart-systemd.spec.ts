/** @vitest-environment jsdom */

/**
 * The systemd restart path, end to end within this package's own units: how the
 * host recognises a systemd user service as its own launch and refuses to do so
 * from anything weaker than proof, how the wire carries the unit a systemd
 * restart targets, what the confirmation says to the reader, and what happens
 * when the request cannot be delivered.
 *
 * Every case is asserted on returned facts, plans and rendered copy; the
 * toolbar cases read its own state attributes, so a plan that names no unit, or
 * a confirmation that hides which unit restarts, fails the test.
 */

import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, type ComponentProps } from 'react'
import { isSystemdUnitName, parseRestartMode, parseRestartPlan, type RestartMode, type RestartPlanWire } from '../src/core/protocol.ts'
import {
  parseSystemdFacts,
  readSystemdFacts,
  requestUnitRestart,
  type SystemdFacts,
  type UnitRestartRuntime,
} from '../src/host/restart.ts'
import { PluginListToolbar } from '../src/client/PluginListToolbar.tsx'
import { en, type PluginManagerKey } from '../src/client/locales.ts'

afterEach(cleanup)

/** A cgroup path of the shape systemd writes for a user service. */
const USER_SERVICE_CGROUP = '/user.slice/user-1000.slice/user@1000.service/app.slice/dsh-web.service'

/** The environment systemd gives every service invocation it starts. */
const SERVICE_ENV: NodeJS.ProcessEnv = { INVOCATION_ID: 'b0a1c2d3', XDG_RUNTIME_DIR: '/run/user/1000' }

/** English translate stub with {param} interpolation (the package's en dictionary). */
const t: ComponentProps<typeof PluginListToolbar>['t'] = (key, params) => {
  const text = (en as Record<string, string>)[key as PluginManagerKey] ?? String(key)
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
}

/** Render the toolbar over one plan answer and hand back the document it renders into. */
function renderToolbar(
  restartPlan: () => Promise<RestartPlanWire>,
  restart: () => Promise<RestartMode> = async () => 'relaunch',
): void {
  const injected = {
    isLoopback: true,
    checkUpdates: async () => [],
    update: async () => { throw new Error('the systemd restart path never updates a plugin') },
    restartPlan,
    restart,
  }
  render(createElement(PluginListToolbar, { ...injected, t } as unknown as ComponentProps<typeof PluginListToolbar>))
}

describe('recognising a systemd user service', () => {
  it('operator on a service systemd started: the unit this host runs as is named', () => {
    // Given a service invocation and a cgroup inside the user slice
    // When the facts are parsed out of them
    const facts = parseSystemdFacts(USER_SERVICE_CGROUP, SERVICE_ENV, true)

    // Then the unit and the manager that owns it are reported
    expect(facts).toEqual({ unit: 'dsh-web.service', scope: 'user' } satisfies SystemdFacts)
  })

  it('operator on a process started by hand inside a service cgroup: no systemd facts', () => {
    // Given the cgroup of a service but no invocation marker of its own
    // When the facts are parsed
    const facts = parseSystemdFacts(USER_SERVICE_CGROUP, {}, true)

    // Then nothing is claimed: no manager would restart this process
    expect(facts).toBeUndefined()
  })

  it('operator whose process sits in a scope instead of a unit: no systemd facts', () => {
    // Given the cgroup of a transient scope, not of a service
    // When the facts are parsed
    const facts = parseSystemdFacts('/user.slice/user-1000.slice/user@1000.service/app.slice/dsh-subprocess-1-2.scope', SERVICE_ENV, true)

    // Then the last segment is not a unit and nothing is claimed
    expect(facts).toBeUndefined()
  })

  it('operator whose cgroup is the user manager itself: no systemd facts', () => {
    // Given a cgroup that ends in the manager's own unit, which owns every
    // service that manager runs
    // When the facts are parsed
    const facts = parseSystemdFacts('/user.slice/user-1000.slice/user@1000.service', SERVICE_ENV, true)

    // Then nothing is claimed: restarting that unit would take down far more
    // than this host, which is not the consequence the confirmation promises
    expect(facts).toBeUndefined()
  })

  it('operator whose cgroup last segment is not a unit name: no systemd facts', () => {
    // Given a cgroup whose last segment cannot be a unit name at all
    // When the facts are parsed
    const spaced = parseSystemdFacts('/user.slice/user@1000.service/app.slice/dsh web.service', SERVICE_ENV, true)
    const traversed = parseSystemdFacts('/user.slice/user@1000.service/app.slice/..', SERVICE_ENV, true)

    // Then neither is accepted as a unit this host could ask for a restart
    expect(spaced).toBeUndefined()
    expect(traversed).toBeUndefined()
  })

  it('operator on a system-scope service: the system manager is reported, not the user manager', () => {
    // Given a cgroup inside the system slice
    // When the facts are parsed
    const facts = parseSystemdFacts('/system.slice/dsh-web.service', SERVICE_ENV, false)

    // Then the unit is named with the scope that owns it, whatever the user manager does
    expect(facts).toEqual({ unit: 'dsh-web.service', scope: 'system' } satisfies SystemdFacts)
  })

  it('operator whose user manager socket is gone: no systemd facts', () => {
    // Given a user service whose manager cannot be reached
    // When the facts are parsed
    const facts = parseSystemdFacts(USER_SERVICE_CGROUP, SERVICE_ENV, false)

    // Then nothing is claimed: there is no one to ask for the restart
    expect(facts).toBeUndefined()
  })

  it('operator whose cgroup is in neither slice: no systemd facts', () => {
    // Given a cgroup a container runtime wrote
    // When the facts are parsed
    const facts = parseSystemdFacts('/machine.slice/libpod-1.scope', SERVICE_ENV, true)

    // Then the launch is not attributed to a systemd unit
    expect(facts).toBeUndefined()
  })

  it('operator on a cgroup v1 host: the whole cgroup line is read, not just the path', () => {
    // Given a v1 hierarchy line, which carries an id and controllers before the path
    // When the facts are parsed
    const facts = parseSystemdFacts('1:name=systemd:/user.slice/user-1000.slice/user@1000.service/app.slice/dsh-web.service', SERVICE_ENV, true)

    // Then the unit is read off the path half of the line
    expect(facts).toEqual({ unit: 'dsh-web.service', scope: 'user' } satisfies SystemdFacts)
  })
})

describe('reading the cgroup of this process', () => {
  let dir = ''

  /** One fresh scratch directory per case; nothing outside it is touched. */
  const scratch = (): string => {
    dir = mkdtempSync(join(tmpdir(), 'plugin-manager-systemd-'))
    return dir
  }

  afterEach(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  it('operator whose cgroup cannot be read: no systemd facts and no exception', () => {
    // Given a cgroup file that does not exist
    const missing = join(scratch(), 'missing-cgroup')

    // When the facts are read
    const facts = readSystemdFacts(SERVICE_ENV, missing)

    // Then the read answers "not a systemd service" instead of throwing
    expect(facts).toBeUndefined()
  })

  it('operator on a host whose cgroup names a service but whose manager is unreachable: no systemd facts', () => {
    // Given a cgroup file naming a user service and no manager socket beside it
    const root = scratch()
    const cgroupFile = join(root, 'cgroup')
    writeFileSync(cgroupFile, '0::' + USER_SERVICE_CGROUP + '\n')
    mkdirSync(join(root, 'runtime', 'systemd'), { recursive: true })

    // When the facts are read
    const facts = readSystemdFacts({ INVOCATION_ID: 'b0a1c2d3', XDG_RUNTIME_DIR: join(root, 'runtime') }, cgroupFile)

    // Then the missing socket keeps the launch unclaimed
    expect(facts).toBeUndefined()
  })

  it('operator on a Linux host running as a user service: the unit is read from the cgroup file', () => {
    // Given a cgroup file naming the service and a reachable user manager socket
    const root = scratch()
    const cgroupFile = join(root, 'cgroup')
    writeFileSync(cgroupFile, '0::' + USER_SERVICE_CGROUP + '\n')
    mkdirSync(join(root, 'runtime', 'systemd'), { recursive: true })
    writeFileSync(join(root, 'runtime', 'systemd', 'private'), '')

    // When the facts are read
    const facts = readSystemdFacts({ INVOCATION_ID: 'b0a1c2d3', XDG_RUNTIME_DIR: join(root, 'runtime') }, cgroupFile)

    // Then the unit is reported. The reader is Linux-only by design, so the
    // same read elsewhere answers "not a systemd service".
    expect(facts).toEqual(process.platform === 'linux' ? { unit: 'dsh-web.service', scope: 'user' } : undefined)
  })

  it('operator on a host whose cgroup lists several hierarchies: the service line answers', () => {
    // Given a v1-style cgroup file whose lines carry different paths
    const root = scratch()
    const cgroupFile = join(root, 'cgroup')
    writeFileSync(cgroupFile, ['12:cpu,cpuacct:/user.slice/user-1000.slice/user@1000.service/app.slice/dsh-subprocess-9.scope', '1:name=systemd:' + USER_SERVICE_CGROUP, ''].join('\n'))
    mkdirSync(join(root, 'runtime', 'systemd'), { recursive: true })
    writeFileSync(join(root, 'runtime', 'systemd', 'private'), '')

    // When the facts are read
    const facts = readSystemdFacts({ INVOCATION_ID: 'b0a1c2d3', XDG_RUNTIME_DIR: join(root, 'runtime') }, cgroupFile)

    // Then the line that names the service answers, not the scope above it
    expect(facts).toEqual(process.platform === 'linux' ? { unit: 'dsh-web.service', scope: 'user' } : undefined)
  })
})

describe('the restart plan on the wire', () => {
  it('operator reading a systemd plan: the mode and the unit are both read', () => {
    // Given a plan answer naming a systemd unit
    // When the plan is parsed
    const plan = parseRestartPlan({ restart: { mode: 'systemd', unit: 'dsh-web.service' } })

    // Then the unit travels with the mode
    expect(plan).toEqual({ mode: 'systemd', unit: 'dsh-web.service' } satisfies RestartPlanWire)
  })

  it('operator reading a systemd plan with no unit: the read fails instead of promising a restart', () => {
    // Given a systemd plan that names nothing to restart
    // When the plan is parsed
    // Then it fails closed rather than inventing a unit
    expect(() => parseRestartPlan({ restart: { mode: 'systemd' } })).toThrow(/unit/)
  })

  it('operator reading a systemd plan with an unusable unit: the read fails', () => {
    // Given systemd plans whose unit is not a unit name this package would ask for
    const cases = [
      { restart: { mode: 'systemd', unit: 'dsh web.service' } },
      { restart: { mode: 'systemd', unit: '../../etc/dsh-web.service' } },
      { restart: { mode: 'systemd', unit: 'dsh-web.scope' } },
      { restart: { mode: 'systemd', unit: 42 } },
    ]

    // When each plan is parsed, then every one fails closed
    for (const value of cases) expect(() => parseRestartPlan(value)).toThrow(/unit/)
  })

  it('operator reading a plan of an unknown mode: the read fails', () => {
    // Given a plan answer whose mode this package does not know
    // When the plan is parsed
    // Then it is refused instead of being treated as a restart
    expect(() => parseRestartPlan({ restart: { mode: 'reboot' } })).toThrow(/restart mode/)
    expect(() => parseRestartPlan({})).toThrow(/restart mode/)
  })

  it('operator reading an in-place or supervised plan: only the mode travels', () => {
    // Given plan answers of the three modes that name no unit
    // When each plan is parsed
    // Then the answer carries the mode alone
    expect(parseRestartPlan({ restart: { mode: 'relaunch' } })).toEqual({ mode: 'relaunch' })
    expect(parseRestartPlan({ restart: { mode: 'shell' } })).toEqual({ mode: 'shell' })
    expect(parseRestartPlan({ restart: { mode: 'manual' } })).toEqual({ mode: 'manual' })
  })

  it('operator reading the accepted-restart answer of a systemd host: the mode alone is enough', () => {
    // Given the POST answer shape (no unit: the plan read already named it)
    // When the answer is parsed
    // Then the mode is read without demanding a unit
    expect(parseRestartMode({ restart: { mode: 'systemd' } })).toBe('systemd')
  })

  it('operator reading unit names: only the conservative service shape is accepted', () => {
    // Given names a hostile or drifted wire might carry
    // When each is tested
    // Then only plain service units pass
    expect(isSystemdUnitName('dsh-web.service')).toBe(true)
    expect(isSystemdUnitName('dsh-web@1.service')).toBe(true)
    // systemd accepts a leading underscore and a leading colon, so neither is
    // wire drift this package may refuse.
    expect(isSystemdUnitName('_x.service')).toBe(true)
    expect(isSystemdUnitName(':x.service')).toBe(true)
    expect(isSystemdUnitName('dsh-web.service.unit')).toBe(false)
    // A leading flag marker would reach systemctl as another option, not a unit.
    expect(isSystemdUnitName('-H.service')).toBe(false)
    expect(isSystemdUnitName('--user.service')).toBe(false)
    expect(isSystemdUnitName('dsh web.service')).toBe(false)
    expect(isSystemdUnitName('')).toBe(false)
  })
})

/** A stand-in for the systemctl process: the case drives its events itself. */
function fakeUnit(pid: number | undefined): ChildProcess & EventEmitter {
  return Object.assign(new EventEmitter(), { pid, unref: () => {} }) as unknown as ChildProcess & EventEmitter
}

/** One recorded spawn call: what the request asked to run, and how. */
interface SpawnCall {
  executable: string
  args: readonly string[]
  options: SpawnOptions
}

/** A spawn seam over one fake child, recording every call it receives. */
function spawnSeam(
  child: ChildProcess,
  onSpawn?: (options: SpawnOptions) => void,
): { spawn: NonNullable<UnitRestartRuntime['spawn']>; calls: SpawnCall[] } {
  const calls: SpawnCall[] = []
  return {
    calls,
    spawn: (executable, args, options) => {
      calls.push({ executable, args, options })
      onSpawn?.(options)
      return child
    },
  }
}

/** The descriptor a spawned command inherits on one stream of its stdio. */
function inheritedDescriptor(stdio: SpawnOptions['stdio'], stream: 1 | 2): number {
  const fd = Array.isArray(stdio) ? stdio[stream] : undefined
  if (typeof fd !== 'number') throw new Error('the request left systemctl no stream to report on')
  return fd
}

/** The journal this package promises to record a failed request in. */
function journalOf(root: string): string {
  return join(root, 'logs', 'plugin-manager-restart.log')
}

describe('asking systemd for the restart', () => {
  let dir = ''

  /** One fresh scratch directory per case; nothing outside it is touched. */
  const scratch = (): string => {
    dir = mkdtempSync(join(tmpdir(), 'plugin-manager-restart-'))
    return dir
  }

  afterEach(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  it('operator whose systemctl refuses the unit: its own complaint is in the restart journal', () => {
    // Given a manager command that explains the refusal on the stream it inherits
    const logPath = journalOf(scratch())
    const seam = spawnSeam(fakeUnit(4242), (options) => {
      writeSync(inheritedDescriptor(options.stdio, 1), 'Failed to restart dsh-web.service: Unit not found.\n')
    })

    // When the restart is requested
    const created = requestUnitRestart('dsh-web.service', logPath, { spawn: seam.spawn })

    // Then the request was the user manager asked for that one unit, both of
    // its streams are the one journal file, and what it said is in that journal
    expect(created).toBe(true)
    expect(seam.calls[0]).toMatchObject({
      executable: 'systemctl',
      args: ['--user', 'restart', '--no-block', 'dsh-web.service'],
    })
    const stdio = seam.calls[0]?.options.stdio
    expect(inheritedDescriptor(stdio, 1)).toBe(inheritedDescriptor(stdio, 2))
    expect(readFileSync(logPath, 'utf8')).toContain('Failed to restart dsh-web.service: Unit not found.')
  })

  it('operator whose systemctl exits non-zero: the exit code is journaled as the reason the host kept running', () => {
    // Given a manager command that ends with a failure code
    const logPath = journalOf(scratch())
    const unit = fakeUnit(4242)
    const seam = spawnSeam(unit)

    // When the restart is requested and the command then exits 2
    const created = requestUnitRestart('dsh-web.service', logPath, { spawn: seam.spawn })
    unit.emit('exit', 2, null)

    // Then the request did go out, and the journal records that the command
    // finished with that code instead of leaving a refused restart looking queued
    expect(created).toBe(true)
    expect(readFileSync(logPath, 'utf8')).toContain('systemctl --user restart dsh-web.service exited with code 2')
  })

  it('operator whose systemctl exits cleanly: the journal records no failure line', () => {
    // Given a manager command that accepts the request and queues it
    const logPath = journalOf(scratch())
    const unit = fakeUnit(4242)
    const seam = spawnSeam(unit)

    // When the restart is requested and the command exits 0
    const created = requestUnitRestart('dsh-web.service', logPath, { spawn: seam.spawn })
    unit.emit('exit', 0, null)

    // Then the journal exists but says nothing: a queued restart is not a
    // failure, and the record is only for what went wrong
    expect(created).toBe(true)
    expect(readFileSync(logPath, 'utf8')).toBe('')
  })

  it('operator whose systemctl is killed by the stop job this request queued: no failure line is journaled', () => {
    // Given a manager command that never gets to exit on its own, which is what
    // the unit's own stop job (KillMode=control-group) does to every process in
    // its cgroup, systemctl included
    const logPath = journalOf(scratch())
    const unit = fakeUnit(4242)
    const seam = spawnSeam(unit)

    // When the restart is requested and the command is killed by SIGTERM
    const created = requestUnitRestart('dsh-web.service', logPath, { spawn: seam.spawn })
    unit.emit('exit', null, 'SIGTERM')

    // Then the journal stays silent: that signal is the requested restart being
    // carried out, so recording it would report a success as a failure
    expect(created).toBe(true)
    expect(readFileSync(logPath, 'utf8')).toBe('')
  })

  it('operator on a host with no systemctl: the failure is journaled and nothing is thrown', () => {
    // Given a spawn that reports the missing executable after it returns
    const logPath = journalOf(scratch())
    const unit = fakeUnit(undefined)
    const seam = spawnSeam(unit)

    // When the restart is requested and the failure arrives as an event
    const created = requestUnitRestart('dsh-web.service', logPath, { spawn: seam.spawn })
    unit.emit('error', new Error('spawn systemctl ENOENT'))

    // Then no process exists, and the journal carries the reason the unit keeps
    // running the old host
    expect(created).toBe(false)
    expect(readFileSync(logPath, 'utf8')).toContain('systemctl --user restart dsh-web.service failed: spawn systemctl ENOENT')
  })

  it('operator whose restart journal cannot be opened: the request still goes out and nothing is thrown', () => {
    // Given a journal path below a regular file, so its directory cannot exist
    const root = scratch()
    const blocker = join(root, 'not-a-directory')
    writeFileSync(blocker, '')
    const seam = spawnSeam(fakeUnit(4242))

    // When the restart is requested
    const created = requestUnitRestart('dsh-web.service', join(blocker, 'logs', 'plugin-manager-restart.log'), { spawn: seam.spawn })

    // Then systemctl still ran, with no stream to report on: the restart matters
    // more than the record this process cannot make
    expect(created).toBe(true)
    expect(seam.calls.map(call => call.options.stdio)).toEqual(['ignore'])
  })
})

describe('the systemd confirmation', () => {
  it('operator on a systemd user service is told which unit restarts', async () => {
    // Given a host that would ask systemd to restart its own unit
    renderToolbar(async () => ({ mode: 'systemd', unit: 'dsh-verify-restart.service' }))

    // When the user asks to restart
    fireEvent.click(screen.getByRole('button', { name: t('restartNow') }))

    // Then the confirmation names that unit and still offers the action
    await waitFor(() => {
      expect(document.querySelector('[data-restart-plan-hint]')?.textContent)
        .toBe(t('restartPlanSystemd', { unit: 'dsh-verify-restart.service' }))
    })
    expect(document.querySelector('[data-restart-plan]')?.getAttribute('data-restart-plan')).toBe('systemd')
    expect(document.querySelector('[data-restart-confirm]')?.textContent).toBe(t('restartConfirm'))
  })

  it('operator confirming a systemd restart sees the action spent, because the host leaves', async () => {
    // Given a host whose plan and accepted restart are both systemd
    renderToolbar(
      async () => ({ mode: 'systemd', unit: 'dsh-verify-restart.service' }),
      async () => 'systemd',
    )
    fireEvent.click(screen.getByRole('button', { name: t('restartNow') }))
    await waitFor(() => {
      expect(document.querySelector('[data-restart-confirm]')?.textContent).toBe(t('restartConfirm'))
    })

    // When the user confirms
    fireEvent.click(document.querySelector('[data-restart-confirm]') as HTMLElement)

    // Then the accepted mode is on screen, the hint reuses the relaunch wording,
    // and the button reads as in progress and is disabled
    await waitFor(() => {
      expect(document.querySelector('[data-update-restart-hint]')?.getAttribute('data-update-restart-hint')).toBe('systemd')
    })
    expect(document.querySelector('[data-update-restart-hint]')?.textContent).toBe(t('restartRelaunchHint'))
    const button = document.querySelector('[data-update-restart]') as HTMLButtonElement
    expect(button.textContent).toBe(t('restarting'))
    expect(button.disabled).toBe(true)
  })
})
