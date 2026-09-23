/**
 * ProxyCommand transport tests: token expansion, the stdio bridge, and the
 * failure paths that must never leave a child process behind.
 */

import { describe, expect, it } from 'vitest'
import { expandProxyTokens, startProxyCommand } from '../src/engine/proxy-command.ts'

const target = { host: 'target.internal', port: 2222, user: 'deploy', alias: 'devbox' }

/** Wait until the predicate holds; fail loudly instead of hanging. */
async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the condition')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

/** A portable command that pipes stdin back to stdout through node itself. */
function echoCommand(): string {
  return '"' + process.execPath + '" -e "process.stdin.pipe(process.stdout)"'
}

/** A command that writes to stderr and exits non-zero, per platform shell. */
function failingCommand(): string {
  return process.platform === 'win32'
    ? 'echo bastion down 1>&2 && exit /b 7'
    : 'echo bastion down >&2; exit 7'
}

describe('expandProxyTokens', () => {
  it('expands %h %p %r %n and a literal %%', () => {
    expect(expandProxyTokens('corp proxy %h %p %r %n %%', target))
      .toBe('corp proxy target.internal 2222 deploy devbox %')
  })

  it('leaves an unknown token untouched', () => {
    expect(expandProxyTokens('nc %h %p %x', target)).toBe('nc target.internal 2222 %x')
  })
})

describe('startProxyCommand', () => {
  it('bridges stdio in both directions and reaps the child on destroy', async () => {
    const { stream, child } = startProxyCommand(echoCommand(), target)
    let received = ''
    stream.on('data', (chunk: Buffer) => { received += chunk.toString('utf8') })
    stream.write('hello proxy\n')
    await waitFor(() => received.includes('hello proxy'))
    expect(received).toContain('hello proxy')
    // The echo keeps running until its stdin closes, so the destroy path is
    // what has to reap it.
    stream.destroy()
    await waitFor(() => child.exitCode !== null || child.signalCode !== null)
  })

  it('fails with the exit status and the stderr of a command that dies first', async () => {
    const { stream } = startProxyCommand(failingCommand(), target)
    const error = await new Promise<Error>(resolve => { stream.on('error', resolve) })
    expect(error.message).toContain('ProxyCommand exited')
    expect(error.message).toContain('bastion down')
  })

  it('fails clearly when the command does not exist', async () => {
    const { stream } = startProxyCommand('definitely-not-a-real-binary-xyz %h', target)
    const error = await new Promise<Error>(resolve => { stream.on('error', resolve) })
    expect(error.message).toContain('ProxyCommand')
  })

  it('surfaces contextual errors without unhandled EPIPE when writing to a dead command', async () => {
    const { stream, child } = startProxyCommand('definitely-not-a-real-binary-xyz %h', target)
    const errorPromise = new Promise<Error>(resolve => { stream.on('error', resolve) })
    for (let i = 0; i < 5; i++) {
      stream.write('SSH-2.0-test\r\n', () => { /* no-op */ })
    }
    const error = await errorPromise
    expect(error.message).toContain('ProxyCommand')
    await waitFor(() => child.exitCode !== null || child.signalCode !== null)
  })
})
