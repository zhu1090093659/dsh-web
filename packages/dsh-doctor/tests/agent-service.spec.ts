import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path/posix'
import { describe, expect, it } from 'vitest'
import { ensureServiceInstalled, removeService, servicePlan, type ServiceRunner } from '../src/agent/service.ts'

const base = { label: 'com.dsh.doctor', executable: '/usr/local/bin/node', args: ['/usr/local/lib/cli.js', 'supervisor'], doctorHome: '/Users/u/.dsh-doctor' }

describe('service adapters', () => {
  it('renders a macOS LaunchAgent', () => {
    const plan = servicePlan({ ...base, platform: 'darwin' }, { HOME: '/Users/u' })
    expect(plan.files[0]!.path).toBe('/Users/u/Library/LaunchAgents/com.dsh.doctor.plist')
    expect(plan.files[0]!.content).toContain('<key>Label</key>')
    expect(plan.files[0]!.content).toContain('RunAtLoad')
    expect(plan.files[0]!.content).toContain('KeepAlive')
    expect(plan.install[0]).toBe('launchctl')
    expect(plan.install[1]).toBe('bootstrap')
  })

  it('escapes XML entities in LaunchAgent paths', () => {
    const plan = servicePlan({ ...base, executable: '/Users/Anders & Co/node', doctorHome: '/Users/Anders & Co/.dsh-doctor', platform: 'darwin' }, { HOME: '/Users/Anders & Co' })
    expect(plan.files[0]!.content).toContain('Anders &amp; Co')
  })

  it('renders a systemd user unit with restart policy', () => {
    const plan = servicePlan({ ...base, platform: 'linux' }, { XDG_CONFIG_HOME: '/home/u/.config' })
    expect(plan.files[0]!.path).toBe('/home/u/.config/systemd/user/com.dsh.doctor.service')
    expect(plan.files[0]!.content).toContain('[Service]')
    expect(plan.files[0]!.content).toContain('Restart=on-failure')
    expect(plan.files[0]!.content).toContain('NoNewPrivileges=true')
    expect(plan.install[0]).toBe('systemctl')
  })

  it('renders a per-user Windows scheduled task', () => {
    const plan = servicePlan({ ...base, executable: 'C:\\Program Files\\nodejs\\node.exe', platform: 'win32' }, { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' })
    expect(plan.files[0]!.path).toBe('C:\\Users\\u\\AppData\\Local\\DSH Doctor\\supervisor.cmd')
    expect(plan.files[0]!.content).toContain('@echo off')
    expect(plan.files[0]!.content).toContain('"C:\\Program Files\\nodejs\\node.exe"')
    expect(plan.files[1]!.path).toBe('C:\\Users\\u\\AppData\\Local\\DSH Doctor\\supervisor.vbs')
    expect(plan.files[1]!.content).toContain('WScript.Shell')
    expect(plan.files[1]!.content).toContain('supervisor.cmd')
    expect(plan.install).toEqual([
      'schtasks',
      '/Create',
      '/F',
      '/SC',
      'ONLOGON',
      '/TN',
      'DSH Doctor Supervisor',
      '/TR',
      'wscript.exe "C:\\Users\\u\\AppData\\Local\\DSH Doctor\\supervisor.vbs"',
    ])
    expect(plan.uninstall).toEqual(['schtasks', '/Delete', '/F', '/TN', 'DSH Doctor Supervisor'])
    expect(plan.restart).toEqual(['schtasks', '/Run', '/TN', 'DSH Doctor Supervisor'])
  })

  it('rejects unknown platforms', () => {
    expect(() => servicePlan({ ...base, platform: 'freebsd' as never })).toThrow(/unsupported service platform/)
  })

  it('carries a restart command for every platform', () => {
    expect(servicePlan({ ...base, platform: 'darwin' }, { HOME: '/Users/u' }).restart[1]).toBe('kickstart')
    expect(servicePlan({ ...base, platform: 'linux' }, { XDG_CONFIG_HOME: '/home/u/.config' }).restart[2]).toBe('restart')
    expect(servicePlan({ ...base, platform: 'win32' }, { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }).restart[0]).toBe('schtasks')
  })
})

describe('service redeploy', () => {
  it('boots out the previous registration, writes files, bootstraps and restarts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-doctor-svc-'))
    const plan = servicePlan({ ...base, platform: 'darwin' }, { HOME: dir })
    const calls: string[][] = []
    const runner: ServiceRunner = async command => { calls.push(command) }
    try {
      await ensureServiceInstalled(plan, runner)
      expect(calls.map(call => call.slice(0, 2))).toEqual([
        ['launchctl', 'bootout'],
        ['launchctl', 'bootstrap'],
        ['launchctl', 'kickstart'],
      ])
      await expect(readFile(plan.files[0]!.path, 'utf8')).resolves.toContain('com.dsh.doctor')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('tolerates a missing previous registration and a failed restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-doctor-svc-'))
    const plan = servicePlan({ ...base, platform: 'darwin' }, { HOME: dir })
    let called = 0
    const runner: ServiceRunner = async () => {
      called += 1
      if (called === 1) throw new Error('no such service')
      if (called === 3) throw new Error('not loaded')
    }
    try {
      await expect(ensureServiceInstalled(plan, runner)).resolves.toBeUndefined()
      expect(called).toBe(3)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('unregisters and removes the definition files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-doctor-svc-'))
    const plan = servicePlan({ ...base, platform: 'darwin' }, { HOME: dir })
    await ensureServiceInstalled(plan, async () => {})
    const calls: string[][] = []
    try {
      await removeService(plan, async command => { calls.push(command) })
      expect(calls.map(call => call.slice(0, 2))).toEqual([['launchctl', 'bootout']])
      await expect(stat(plan.files[0]!.path)).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
