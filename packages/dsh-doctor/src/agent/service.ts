import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { spawn } from 'node:child_process'

export interface ServiceSpec { platform: NodeJS.Platform; label: string; executable: string; args: string[]; doctorHome: string }
export interface ServicePlan { files: Array<{ path: string; content: string; mode?: number }>; install: string[]; uninstall: string[]; restart: string[] }
const quoteXml = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const quoteExec = (value: string): string => JSON.stringify(value)

export function servicePlan(spec: ServiceSpec, env: NodeJS.ProcessEnv = process.env): ServicePlan {
  const isWin = spec.platform === 'win32'
  const pathMod = isWin ? win32 : posix
  const executable = pathMod.resolve(spec.executable)
  const home = env.HOME?.trim() || homedir()

  if (spec.platform === 'darwin') {
    const path = posix.join(home, 'Library', 'LaunchAgents', `${spec.label}.plist`)
    const args = [executable, ...spec.args].map(value => `<string>${quoteXml(value)}</string>`).join('')
    const content = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${quoteXml(spec.label)}</string><key>ProgramArguments</key><array>${args}</array><key>EnvironmentVariables</key><dict><key>DSH_DOCTOR_HOME</key><string>${quoteXml(spec.doctorHome)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ProcessType</key><string>Background</string></dict></plist>
`
    const user = `gui/${process.getuid?.() ?? 0}`
    return { files: [{ path, content, mode: 0o600 }], install: ['launchctl', 'bootstrap', user, path], uninstall: ['launchctl', 'bootout', user, path], restart: ['launchctl', 'kickstart', '-k', `${user}/${spec.label}`] }
  }
  if (spec.platform === 'linux') {
    const config = env.XDG_CONFIG_HOME?.trim() || posix.join(home, '.config')
    const path = posix.join(config, 'systemd', 'user', `${spec.label}.service`)
    const command = [executable, ...spec.args].map(quoteExec).join(' ')
    const content = `[Unit]\nDescription=DSH Doctor Supervisor\nAfter=default.target\n\n[Service]\nType=simple\nExecStart=${command}\nEnvironment=DSH_DOCTOR_HOME=${quoteExec(spec.doctorHome)}\nRestart=on-failure\nRestartSec=2\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=default.target\n`
    const unit = posix.basename(path)
    return { files: [{ path, content, mode: 0o600 }], install: ['systemctl', '--user', 'enable', '--now', unit], uninstall: ['systemctl', '--user', 'disable', '--now', unit], restart: ['systemctl', '--user', 'restart', unit] }
  }
  if (spec.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || win32.join(home, 'AppData', 'Local')
    const cmdPath = win32.join(localAppData, 'DSH Doctor', 'supervisor.cmd')
    const vbsPath = win32.join(localAppData, 'DSH Doctor', 'supervisor.vbs')
    const cmdContent = `@echo off\r\nset "DSH_DOCTOR_HOME=${spec.doctorHome}"\r\n"${executable}" ${spec.args.map(quoteExec).join(' ')}\r\n`
    const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run Chr(34) & "${cmdPath}" & Chr(34), 0, False\r\n`
    const task = 'DSH Doctor Supervisor'
    return {
      files: [
        { path: cmdPath, content: cmdContent, mode: 0o600 },
        { path: vbsPath, content: vbsContent, mode: 0o600 },
      ],
      install: ['schtasks', '/Create', '/F', '/SC', 'ONLOGON', '/TN', task, '/TR', `wscript.exe "${vbsPath}"`],
      uninstall: ['schtasks', '/Delete', '/F', '/TN', task],
      restart: ['schtasks', '/Run', '/TN', task],
    }
  }
  throw new Error(`doctor: unsupported service platform ${spec.platform}`)
}

export async function writeServiceFiles(plan: ServicePlan): Promise<void> {
  for (const file of plan.files) {
    const dir = file.path.includes('\\') ? win32.dirname(file.path) : posix.dirname(file.path)
    await mkdir(dir, { recursive: true })
    await writeFile(file.path, file.content, { mode: file.mode ?? 0o600 })
  }
}

export async function removeServiceFiles(plan: ServicePlan): Promise<void> { for (const file of plan.files) await rm(file.path, { force: true }) }

export type ServiceRunner = (command: string[]) => Promise<void>

/**
 * Idempotent service redeploy: drop any previous registration (a first
 * install fails harmlessly), write the definition, bootstrap it, then restart
 * it so the running process picks up the current package code.
 */
export async function ensureServiceInstalled(plan: ServicePlan, run: ServiceRunner = runCommand): Promise<void> {
  await run(plan.uninstall).catch(() => undefined)
  await writeServiceFiles(plan)
  await run(plan.install)
  await run(plan.restart).catch(() => undefined)
}

/** Unregister the service and remove its definition files (tolerates absence). */
export async function removeService(plan: ServicePlan, run: ServiceRunner = runCommand): Promise<void> {
  await run(plan.uninstall).catch(() => undefined)
  await removeServiceFiles(plan)
}

export async function runCommand(command: string[], timeoutMs = 30_000): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command[0]!, command.slice(1), { stdio: 'inherit' })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolvePromise() : reject(new Error(`doctor: command failed (${code ?? 'signal'}): ${command.join(' ')}`)) })
    child.once('error', reject)
  })
}
