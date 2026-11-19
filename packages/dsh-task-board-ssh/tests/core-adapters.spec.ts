/**
 * The four agent adapters: the command line each one builds for a start and for
 * a resume, and the readers that pull the session id and the final summary out
 * of what the CLI actually printed.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildAgentCommandLine, readAgentOutput } from '../src/core/adapters/index.ts'
import { validateCustomTemplate } from '../src/core/adapters/custom.ts'

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/** Read one recorded output fixture. */
function fixture(name: string): string {
  return readFileSync(join(fixtureDirectory, name), 'utf8')
}

/** A run whose prompt and working directory are already resolved on the remote host. */
const baseRun = { promptFile: '/srv/runs/run-1/prompt.txt', cwd: '/srv/work/repo' } as const

/** The one custom template every custom case is built from. */
const customTemplates = {
  command: 'myagent --prompt {prompt_file} --dir {cwd}',
  resumeCommand: 'myagent --prompt {prompt_file} --dir {cwd} --continue {session}',
}

describe('agent command lines', () => {
  it('operator starting a dsh run gets the headless JSON form with the unattended preset', () => {
    // Given a run with no session to continue
    const input = { ...baseRun, agent: 'dsh' as const }

    // When the adapter builds its command
    const built = buildAgentCommandLine(input)

    // Then it is the documented headless form, reading the prompt from stdin
    expect(built.command).toBe("'dsh' 'headless' '--json' '--permission-mode' 'danger-full-access' '-'")
    expect(built.stdinFile).toBe('/srv/runs/run-1/prompt.txt')
  })

  it('operator continuing a dsh run gets the session flag added', () => {
    // Given a run that names the session to continue
    const input = { ...baseRun, agent: 'dsh' as const, resumeSessionId: 'session-4c3bb987' }

    // When the adapter builds its command
    const built = buildAgentCommandLine(input)

    // Then the session flag carries the id and the prompt still arrives on stdin
    expect(built.command).toBe(
      "'dsh' 'headless' '--json' '--permission-mode' 'danger-full-access' '--session-id' 'session-4c3bb987' '-'",
    )
    expect(built.stdinFile).toBe('/srv/runs/run-1/prompt.txt')
  })

  it('operator starting a Claude Code run gets the print form with stream JSON and the bypass flag', () => {
    // Given a run with no session to continue
    const input = { ...baseRun, agent: 'claude' as const }

    // When the adapter builds its command
    const built = buildAgentCommandLine(input)

    // Then it is the documented non-interactive form
    expect(built.command).toBe(
      "'claude' '-p' '--output-format' 'stream-json' '--verbose' '--dangerously-skip-permissions'",
    )
    expect(built.stdinFile).toBe('/srv/runs/run-1/prompt.txt')
  })

  it('operator continuing a Claude Code run gets the resume flag added', () => {
    // Given a run that names the session to continue
    const input = { ...baseRun, agent: 'claude' as const, resumeSessionId: 'e52e6de8-dfdb' }

    // When the adapter builds its command
    const built = buildAgentCommandLine(input)

    // Then the resume flag carries the id
    expect(built.command).toBe(
      "'claude' '-p' '--output-format' 'stream-json' '--verbose' '--dangerously-skip-permissions' '--resume' 'e52e6de8-dfdb'",
    )
  })

  it('operator starting a Codex run gets the exec JSON form with the unrestricted sandbox', () => {
    // Given a run with no session to continue
    const input = { ...baseRun, agent: 'codex' as const }

    // When the adapter builds its command
    const built = buildAgentCommandLine(input)

    // Then it is the documented exec form and the git-repo gate is lifted
    expect(built.command).toBe(
      "'codex' 'exec' '--json' '--sandbox' 'danger-full-access' '--skip-git-repo-check'",
    )
    expect(built.stdinFile).toBe('/srv/runs/run-1/prompt.txt')
  })

  it('operator continuing a Codex run gets the resume subcommand and the thread id', () => {
    // Given a run that names the thread to continue
    const input = { ...baseRun, agent: 'codex' as const, resumeSessionId: '0199a213-81c0' }

    // When the adapter builds its command
    const built = buildAgentCommandLine(input)

    // Then the resume subcommand follows the exec flags
    expect(built.command).toBe(
      "'codex' 'exec' '--json' '--sandbox' 'danger-full-access' '--skip-git-repo-check' 'resume' '0199a213-81c0'",
    )
  })

  it('operator starting a custom agent gets the template with every placeholder quoted', () => {
    // Given a custom agent whose template names all three placeholders
    const input = { ...baseRun, agent: 'custom' as const }

    // When the adapter builds its command
    const built = buildAgentCommandLine(input, customTemplates)

    // Then each placeholder became one quoted word and the template's own words stayed as written
    expect(built.command).toBe(
      "myagent --prompt '/srv/runs/run-1/prompt.txt' --dir '/srv/work/repo'",
    )
    expect(built.stdinFile).toBeUndefined()
  })

  it('operator continuing a custom agent gets the resume template with the session substituted', () => {
    // Given a custom agent with a resume template and a session to continue
    const input = { ...baseRun, agent: 'custom' as const, resumeSessionId: 'sess-9' }

    // When the adapter builds its command
    const built = buildAgentCommandLine(input, customTemplates)

    // Then the resume template is used and the session is one quoted word
    expect(built.command).toBe(
      "myagent --prompt '/srv/runs/run-1/prompt.txt' --dir '/srv/work/repo' --continue 'sess-9'",
    )
  })

  it('operator continuing a custom agent without a resume template falls back to a fresh run', () => {
    // Given a custom agent whose deployment configured only a start template
    const input = { ...baseRun, agent: 'custom' as const, resumeSessionId: 'sess-9' }

    // When it is asked to continue
    const built = buildAgentCommandLine(input, { command: customTemplates.command })

    // Then the start template answers, which is the documented degradation
    expect(built.command).toBe("myagent --prompt '/srv/runs/run-1/prompt.txt' --dir '/srv/work/repo'")
  })

  it('operator configuring a custom template is told what is wrong with it', () => {
    // Given templates with a missing placeholder and an unknown one
    const broken = ['', 'myagent --dir {cwd}', 'myagent --prompt {prompt_file} {nonsense}']

    // When each is validated
    const problems = broken.map(validateCustomTemplate)

    // Then each gets its own diagnosis and a usable template gets none
    expect(problems[0]).toBe('the template must not be empty')
    expect(problems[1]).toBe('the start template must reference {prompt_file}')
    expect(problems[2]).toContain('unknown placeholder {nonsense}')
    expect(validateCustomTemplate(customTemplates.command)).toBeUndefined()
  })
})

describe('agent output readers', () => {
  it('operator reading a recorded dsh start gets the session id and the final text', () => {
    // Given the stdout of a real dsh run
    const output = fixture('dsh-start.jsonl')

    // When it is read
    const read = readAgentOutput({ ...baseRun, agent: 'dsh' }, output)

    // Then both the session and the summary come out
    expect(read).toEqual({ sessionId: 'session-4c3bb987-8042-4d3f-9085-795188303693', outcome: { ok: true, text: 'pong' } })
  })

  it('operator reading a recorded dsh resume gets the same session back', () => {
    // Given the stdout of a real dsh resume
    const output = fixture('dsh-resume.jsonl')

    // When it is read
    const read = readAgentOutput({ ...baseRun, agent: 'dsh' }, output)

    // Then the session is the continued one and the summary is the new answer
    expect(read).toEqual({ sessionId: 'session-4c3bb987-8042-4d3f-9085-795188303693', outcome: { ok: true, text: 'pong' } })
  })

  it('operator reading a recorded dsh failure gets the message the agent reported', () => {
    // Given a real stdout whose turn ended in an error
    const output = fixture('dsh-account-sign-in.jsonl')

    // When it is read
    const read = readAgentOutput({ ...baseRun, agent: 'dsh' }, output)

    // Then the failure is reported with the agent's text, not swallowed
    expect(read.outcome?.ok).toBe(false)
    expect(read.outcome).toEqual({
      ok: false,
      error: 'Sign in to DeepSeek to use the account provider. The request destination must allow account authentication.',
    })
  })

  it('operator reading a dsh preset refusal gets the message that names the known presets', () => {
    // Given the stdout of a run whose permission preset did not exist
    const output = fixture('dsh-unknown-preset.jsonl')

    // When it is read
    const read = readAgentOutput({ ...baseRun, agent: 'dsh' }, output)

    // Then the refusal text is preserved verbatim
    expect(read.outcome).toEqual({
      ok: false,
      error: 'permission: unknown preset "not-a-preset" (known: read-only, workspace-write, danger-full-access)',
    })
  })

  it('operator reading a recorded Claude Code start gets the session id and the result text', () => {
    // Given the stdout of a real Claude Code run
    const output = fixture('claude-start.jsonl')

    // When it is read
    const read = readAgentOutput({ ...baseRun, agent: 'claude' }, output)

    // Then both the session and the summary come out
    expect(read).toEqual({ sessionId: 'e52e6de8-dfdb-43c2-a455-40c1943c485c', outcome: { ok: true, text: 'pong' } })
  })

  it('operator reading a recorded Claude Code resume gets the same session back', () => {
    // Given the stdout of a real Claude Code resume
    const output = fixture('claude-resume.jsonl')

    // When it is read
    const read = readAgentOutput({ ...baseRun, agent: 'claude' }, output)

    // Then the continued session and the new answer come out
    expect(read).toEqual({ sessionId: 'e52e6de8-dfdb-43c2-a455-40c1943c485c', outcome: { ok: true, text: 'pong' } })
  })

  it('operator reading the documented Codex stream gets the thread id and the final message', () => {
    // Given the event stream Codex documents for a non-interactive run
    const output = fixture('codex-documented.jsonl')

    // When it is read
    const read = readAgentOutput({ ...baseRun, agent: 'codex' }, output)

    // Then the thread id and the closing agent message come out
    expect(read).toEqual({
      sessionId: '0199a213-81c0-7800-8aa1-bbab2a035a53',
      outcome: { ok: true, text: 'Repo contains docs, sdk, and examples directories.' },
    })
  })

  it('operator reading output cut off mid-line still gets what was written', () => {
    // Given a stream whose last line never finished
    const output = fixture('dsh-start.jsonl') + '{"type":"final","sessionId":"session-x"'

    // When it is read
    const read = readAgentOutput({ ...baseRun, agent: 'dsh' }, output)

    // Then the complete events still answer, and the truncated tail is ignored
    expect(read.sessionId).toBe('session-4c3bb987-8042-4d3f-9085-795188303693')
    expect(read.outcome).toEqual({ ok: true, text: 'pong' })
  })

  it('operator reading an empty stream is told the run reported nothing', () => {
    // Given no output at all
    const output = ''

    // When it is read
    const read = readAgentOutput({ ...baseRun, agent: 'dsh' }, output)

    // Then the reader reports a failure instead of pretending success
    expect(read).toEqual({ outcome: { ok: false, error: 'the dsh event stream ended without a final event' } })
  })

  it('operator reading a custom agent run gets nothing parsed, because its output is unknown', () => {
    // Given output from a command this package does not know
    const output = 'whatever that tool prints'

    // When it is read
    const read = readAgentOutput({ ...baseRun, agent: 'custom' }, output)

    // Then nothing is claimed about a session or a summary
    expect(read).toEqual({})
  })
})
