/**
 * The remote launcher as text and as command construction: the script parses as
 * POSIX sh, installing it is idempotent, every verb's call is quoted, and the
 * one status line each verb prints is read back without throwing.
 */
import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  agentScript,
  buildLauncherCommand,
  buildLauncherInstallCommand,
  buildRunFileCommands,
  launcherScriptHash,
  launcherScriptPath,
  parseLauncherStatus,
  runDirectory,
  runFilePath,
  stateDirForHome,
} from '../src/core/launcher.ts'
import { LAUNCHER_SCRIPT } from '../src/core/launcher-script.ts'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-task-board-ssh-launcher-'))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('launcher script text', () => {
  it('operator installing the launcher on a POSIX host gets a script sh parses', () => {
    // Given the shipped script installed where the provider installs it
    const path = launcherScriptPath(scratch)
    execFileSync('sh', ['-c', buildLauncherInstallCommand(scratch)], { encoding: 'utf8' })

    // When a POSIX sh parses it without running anything
    const parsed = execFileSync('sh', ['-n', path], { encoding: 'utf8' })

    // Then it parses cleanly, is itself sh, and holds every verb
    expect(parsed).toBe('')
    expect(readFileSync(path, 'utf8')).toBe(LAUNCHER_SCRIPT)
    expect(LAUNCHER_SCRIPT.startsWith('#!/bin/sh\n')).toBe(true)
    expect(['start', 'status', 'tail', 'cancel'].every(verb => LAUNCHER_SCRIPT.includes(verb))).toBe(true)
  })

  it('operator reading the shipped script finds no bash-only construct', () => {
    // Given the shipped script
    const text = LAUNCHER_SCRIPT

    // When it is checked for the constructs a plain sh does not have
    const bashisms = ['[[', 'pipefail', 'function ', 'declare ', 'local '].filter(token => text.includes(token))

    // Then none of them appear, so the script runs under dash as well as bash
    expect(bashisms).toEqual([])
  })

  it('operator installing twice targets one file and a changed script targets another', () => {
    // Given one script text and a one-line change to it
    const first = launcherScriptHash(LAUNCHER_SCRIPT)
    const second = launcherScriptHash(LAUNCHER_SCRIPT + '# changed')

    // When the paths are built
    const firstPath = launcherScriptPath(scratch, first)
    const secondPath = launcherScriptPath(scratch, second)

    // Then the unchanged text always resolves to the same file and the change to a new one
    expect(launcherScriptHash(LAUNCHER_SCRIPT)).toBe(first)
    expect(firstPath).toBe(join(scratch, 'runner-' + first + '.sh'))
    expect(secondPath).not.toBe(firstPath)
  })

  it('operator re-installing the launcher leaves one runnable file and no staging leftover', () => {
    // Given a state directory that already holds the installed launcher
    const stateDir = join(scratch, 'reinstall')
    const scriptPath = launcherScriptPath(stateDir)
    execFileSync('sh', ['-c', buildLauncherInstallCommand(stateDir)], { encoding: 'utf8' })

    // When the same script is installed again, as every run does
    execFileSync('sh', ['-c', buildLauncherInstallCommand(stateDir)], { encoding: 'utf8' })

    // Then the one file a run invokes is there, runnable, and nothing else is
    expect(readFileSync(scriptPath, 'utf8')).toBe(LAUNCHER_SCRIPT)
    expect(statSync(scriptPath).mode & 0o777).toBe(0o700)
    expect(readdirSync(stateDir)).toEqual([basename(scriptPath)])
  })

  it('operator installing over whatever sits at the launcher path replaces it instead of writing through it', () => {
    // Given a marker file with the launcher path pointing at it
    const stateDir = join(scratch, 'replace')
    mkdirSync(stateDir, { recursive: true })
    const scriptPath = launcherScriptPath(stateDir)
    const marker = join(stateDir, 'marker.txt')
    writeFileSync(marker, 'not the launcher')
    symlinkSync(marker, scriptPath)

    // When the install command runs, as a run whose wrapper is reading the old file does
    execFileSync('sh', ['-c', buildLauncherInstallCommand(stateDir)], { encoding: 'utf8' })

    // Then the launcher path is a real file holding the script, and the old
    // target is untouched: a wrapper that opened the previous file keeps its
    // bytes instead of reading a truncated script
    expect(lstatSync(scriptPath).isSymbolicLink()).toBe(false)
    expect(readFileSync(scriptPath, 'utf8')).toBe(LAUNCHER_SCRIPT)
    expect(readFileSync(marker, 'utf8')).toBe('not the launcher')
  })

  it('operator installing into a directory with a space ends up with a runnable file there', () => {
    // Given a state directory whose path contains a space
    const stateDir = join(scratch, 'state dir')
    const scriptPath = launcherScriptPath(stateDir)

    // When the install command runs under a real sh
    execFileSync('sh', ['-c', buildLauncherInstallCommand(stateDir)], { encoding: 'utf8' })

    // Then the script is there and only its owner may run it
    expect(readFileSync(scriptPath, 'utf8')).toBe(LAUNCHER_SCRIPT)
    expect(statSync(scriptPath).mode & 0o777).toBe(0o700)
  })
})

describe('launcher command construction', () => {
  it('operator invoking each verb gets one quoted call on the installed script', () => {
    // Given an installed script path
    const stateDir = stateDirForHome('/home/deploy')
    const scriptPath = launcherScriptPath(stateDir)

    // When each verb is built
    const calls = ['start', 'status', 'cancel'].map(verb =>
      buildLauncherCommand({ stateDir, verb: verb as 'start' | 'status' | 'cancel', runId: 'run-1' }),
    )

    // Then each call pins TASK_BOARD_SSH_STATE and quotes the script, verb and run id separately
    expect(calls).toEqual([
      "TASK_BOARD_SSH_STATE='" + stateDir + "' 'sh' '" + scriptPath + "' 'start' 'run-1'",
      "TASK_BOARD_SSH_STATE='" + stateDir + "' 'sh' '" + scriptPath + "' 'status' 'run-1'",
      "TASK_BOARD_SSH_STATE='" + stateDir + "' 'sh' '" + scriptPath + "' 'cancel' 'run-1'",
    ])
    expect(stateDir).toBe('/home/deploy/.dsh/task-board-ssh')
  })

  it('operator tailing a run passes the byte offset as its own word', () => {
    // Given a run to tail
    const stateDir = stateDirForHome('/home/deploy')

    // When the tail call is built from a byte offset
    const call = buildLauncherCommand({ stateDir, verb: 'tail', runId: 'run-1', offset: 4_096 })

    // Then the offset arrives as a separate argument with state dir pinned
    expect(call).toBe("TASK_BOARD_SSH_STATE='" + stateDir + "' 'sh' '" + launcherScriptPath(stateDir) + "' 'tail' 'run-1' '4096'")
  })

  it('operator passing a run id or an offset the script would refuse is refused here first', () => {
    // Given a run id that could escape the state directory and two impossible offsets
    const stateDir = stateDirForHome('/home/deploy')

    // When each is used to build a call
    // Then nothing leaves the host
    expect(() => buildLauncherCommand({ stateDir, verb: 'start', runId: '../etc' })).toThrow(RangeError)
    expect(() => buildLauncherCommand({ stateDir, verb: 'tail', runId: 'run-1', offset: -1 })).toThrow(RangeError)
    expect(() => buildLauncherCommand({ stateDir, verb: 'tail', runId: 'run-1', offset: 1.5 })).toThrow(RangeError)
  })

  it('operator preparing a run gets the prompt, the command, the directory and the spec on the host', () => {
    // Given a run whose command reads its prompt from stdin
    const stateDir = join(scratch, 'prepare state')
    const commands = buildRunFileCommands({
      stateDir,
      runId: 'run-7',
      prompt: "line one\nline 'two'\n",
      command: { command: "'myagent' '--json'", stdinFile: '/srv/runs/run-7/prompt.txt' },
      cwd: '/srv/work/repo',
      spec: { agent: 'dsh', host: 'build-box' },
    })

    // When they run under a real sh
    execFileSync('sh', ['-c', commands.join(' && ')], { encoding: 'utf8' })

    // Then each file holds what the launcher reads
    const directory = runDirectory(stateDir, 'run-7')
    expect(readFileSync(runFilePath(stateDir, 'run-7', 'prompt.txt'), 'utf8')).toBe("line one\nline 'two'\n")
    expect(readFileSync(runFilePath(stateDir, 'run-7', 'cmd.sh'), 'utf8')).toBe(
      "'myagent' '--json' < '/srv/runs/run-7/prompt.txt'",
    )
    expect(readFileSync(runFilePath(stateDir, 'run-7', 'cwd'), 'utf8')).toBe('/srv/work/repo')
    expect(JSON.parse(readFileSync(runFilePath(stateDir, 'run-7', 'spec.json'), 'utf8'))).toEqual({
      agent: 'dsh',
      host: 'build-box',
    })
    expect(statSync(directory).isDirectory()).toBe(true)
  })

  it('operator running a custom template without stdinFile keeps pipes and redirections intact', () => {
    // Given a custom command template (launcher run_exec already binds cmd.sh stdin to /dev/null)
    // When the run script is built
    const script = agentScript({ command: "'myagent' '--once'" })
    const piped = agentScript({ command: "cat '/tmp/prompt.txt' | myagent" })

    // Then the template is kept verbatim without appending a trailing `< /dev/null`
    expect(script).toBe("'myagent' '--once'")
    expect(piped).toBe("cat '/tmp/prompt.txt' | myagent")
  })
})

describe('launcher status grammar', () => {
  it('operator reading a status line gets the state, process group, exit code and byte count', () => {
    // Given the lines the four verbs can print
    const lines = [
      'state=running pid=2484087 bytes=12',
      'state=exited exit=3 bytes=64',
      'state=cancelled exit=143 bytes=8',
      'state=lost bytes=0',
      'state=missing',
      'state=not-running',
      'state=running pid=9 bytes=0 started=1',
    ]

    // When each is parsed
    const parsed = lines.map(parseLauncherStatus)

    // Then every value comes out typed
    expect(parsed).toEqual([
      { state: 'running', pid: 2_484_087, bytes: 12 },
      { state: 'exited', exitCode: 3, bytes: 64 },
      { state: 'cancelled', exitCode: 143, bytes: 8 },
      { state: 'lost', bytes: 0 },
      { state: 'missing' },
      { state: 'not-running' },
      { state: 'running', pid: 9, bytes: 0, started: true },
    ])
  })

  it('operator reading output that is not a status line gets an unknown state instead of an exception', () => {
    // Given a shell that printed something unexpected
    const outputs = ['', 'sh: 1: Syntax error', 'state=', 'exit=3', 'state=bogus pid=1']

    // When each is parsed
    const parsed = outputs.map(parseLauncherStatus)

    // Then none of them claims a run state
    expect(parsed).toEqual(outputs.map(() => ({ state: 'unknown' })))
  })
})
