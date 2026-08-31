import { describe, expect, it } from 'vitest'
import {
  desktopFileName,
  renderDesktopEntry,
  renderLauncherScript,
  renderShortcutInstaller,
  resolveLauncherSpec,
  scriptFileName,
} from '../src/core/launcher.ts'

describe('launcher spec resolution', () => {
  it('fills defaults and drops an empty profile', () => {
    expect(resolveLauncherSpec({})).toEqual({ dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })
    expect(resolveLauncherSpec({ profile: '' })).toEqual({ dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })
    expect(resolveLauncherSpec({ dshCommand: 'dsh-dev', url: 'http://localhost:4000', profile: 'web' }))
      .toEqual({ dshCommand: 'dsh-dev', url: 'http://localhost:4000', profile: 'web' })
  })
})

describe('file names', () => {
  it('names launcher scripts and desktop icons per platform', () => {
    expect(scriptFileName('win32')).toBe('launcher.ps1')
    expect(scriptFileName('darwin')).toBe('launcher.command')
    expect(scriptFileName('linux')).toBe('launcher.sh')
    expect(desktopFileName('win32')).toBe('DeepSeek-Harness.lnk')
    expect(desktopFileName('darwin')).toBe('DeepSeek-Harness.command')
    expect(desktopFileName('linux')).toBe('deepseek-harness.desktop')
  })
})

describe('launcher script rendering', () => {
  it('renders a PowerShell launcher with the spec values and poll loop', () => {
    const script = renderLauncherScript('win32', { dshCommand: 'dsh', url: 'http://127.0.0.1:3080', profile: 'web' })
    expect(script).toContain("$dshCommand = 'dsh'")
    expect(script).toContain("$url = 'http://127.0.0.1:3080'")
    expect(script).toContain("$profile = 'web'")
    expect(script).toContain("@('--profile', $profile, '--no-open')")
    expect(script).toContain('Open-DshUrl')
    expect(script).toContain('explorer.exe')
    expect(script).toContain('Start-Sleep -Milliseconds 250')
    expect(script).toContain('DeepSeek Harness')
    expect(script).toContain('正在启动')
    expect(script).toContain('XamlReader')
    expect(script).toContain('Get-Command $dshCommand -All')
    expect(script).toContain("CommandType -eq 'Application'")
    expect(script).toContain("-match '\\.(?:cmd|exe|bat|com)$'")
    expect(script).toContain("Start-Process -FilePath 'powershell.exe'")
    expect(script).toContain("@('-NoProfile', '-File', $command.Source)")
    expect(script).toContain("@('web', '--no-open')")
    expect(script).toContain('-PassThru')
    expect(script).toContain('$dshProcess.HasExited')
    expect(script).not.toContain('DSH_DESKTOP_LAUNCHER_TOKEN')
    expect(script).not.toContain('$managedUrl')
  })

  it('omits the profile flag when no profile is set', () => {
    const script = renderLauncherScript('win32', { dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })
    expect(script).toContain("$profile = ''")
    expect(script).toContain("@('web', '--no-open')")
    expect(script).toContain("if ($profile -eq '')")
  })

  it('renders POSIX launchers with the platform open command', () => {
    const mac = renderLauncherScript('darwin', { dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })
    expect(mac).toContain('open "$URL"')
    expect(mac).toContain('command -v "$DASH"')
    const linux = renderLauncherScript('linux', { dshCommand: 'dsh', url: 'http://127.0.0.1:3080' })
    expect(linux).toContain('xdg-open "$URL"')
    expect(linux).toContain('"$DASH" web --no-open')
    expect(linux).toContain('"$DASH" --profile "$PROFILE" --no-open')
    expect(linux).not.toContain('DSH_DESKTOP_LAUNCHER_TOKEN')
    expect(linux).not.toContain('$MANAGED_URL')
  })

  it('escapes single quotes in embedded values', () => {
    const script = renderLauncherScript('win32', { dshCommand: "d'sh", url: 'http://127.0.0.1:3080' })
    expect(script).toContain("$dshCommand = 'd''sh'")
  })
})

describe('desktop file rendering', () => {
  it('renders a Linux desktop entry pointing at the launcher', () => {
    const entry = renderDesktopEntry('/home/u/.dsh/desktop-launcher/launcher.sh')
    expect(entry).toContain('[Desktop Entry]')
    expect(entry).toContain('Type=Application')
    expect(entry).toContain('Exec="/home/u/.dsh/desktop-launcher/launcher.sh"')
    expect(entry).toContain('Icon=utilities-terminal')

    const withIcon = renderDesktopEntry('/home/u/.dsh/desktop-launcher/launcher.sh', '/home/u/.dsh/desktop-launcher/dsh.ico')
    expect(withIcon).toContain('Icon=/home/u/.dsh/desktop-launcher/dsh.ico')
    expect(withIcon).not.toContain('Icon=utilities-terminal')
  })

  it('renders a Windows shortcut installer with the icon location and working directory', () => {
    const ps = renderShortcutInstaller({
      launcherPath: 'C:/Users/u/.dsh/desktop-launcher/launcher.ps1',
      desktopPath: 'C:/Users/u/Desktop/DSH.lnk',
      workingDirectory: 'C:/Users/u/.dsh/desktop-launcher',
      iconLocation: 'C:/Users/u/.dsh/desktop-launcher/dsh.ico',
    })
    expect(ps).toContain("$shortcut.TargetPath = 'powershell.exe'")
    expect(ps).toContain('-WindowStyle Hidden -File C:/Users/u/.dsh/desktop-launcher/launcher.ps1')
    expect(ps).toContain("$shortcut.WorkingDirectory = 'C:/Users/u/.dsh/desktop-launcher'")
    expect(ps).toContain("$shortcut.IconLocation = 'C:/Users/u/.dsh/desktop-launcher/dsh.ico'")
    expect(ps).toContain("$shortcut.Save()")
  })

  it('falls back to the shell icon when no icon is given', () => {
    const ps = renderShortcutInstaller({
      launcherPath: 'C:/launcher.ps1',
      desktopPath: 'C:/Desktop/DSH.lnk',
      homeDir: 'C:/',
      iconLocation: 'powershell.exe,0',
    })
    expect(ps).toContain("$shortcut.WorkingDirectory = 'C:/'")
    expect(ps).toContain("$shortcut.IconLocation = 'powershell.exe,0'")
  })
})
