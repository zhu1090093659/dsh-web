/**
 * The /api posture probe: forged-Host target building and the exposed/not
 * verdicts over an injectable transport.
 */
import { describe, expect, it } from 'vitest'
import type { ClientRequest, ClientRequestArgs } from 'node:http'
import { anyExposed, claimPostureKey, postureTargets, probePosture, releasePostureKey, type ProbeRequest } from '../src/posture.ts'

/** A fake transport answering every probe with a fixed status. */
function statusTransport(status: number): ProbeRequest {
  return (options: ClientRequestArgs, onStatus: (code: number) => void) => {
    queueMicrotask(() => { onStatus(status) })
    const fake = {
      destroy() {},
      on() { return fake },
      end() {},
    }
    return fake as unknown as ClientRequest
  }
}

describe('postureTargets', () => {
  it('builds host:port from the public base and bare hosts without a port', () => {
    expect(postureTargets('https://dsh.example.com', [], 3080)).toEqual(['dsh.example.com'])
    expect(postureTargets('https://dsh.example.com:8443', [], 3080)).toEqual(['dsh.example.com:8443'])
  })

  it('appends every LAN literal as address:port and de-duplicates', () => {
    expect(postureTargets(undefined, ['192.168.1.5', '10.0.0.3'], 3080)).toEqual(['192.168.1.5:3080', '10.0.0.3:3080'])
    expect(postureTargets('http://192.168.1.5:3080', ['192.168.1.5'], 3080)).toEqual(['192.168.1.5:3080'])
  })

  it('ignores malformed public bases', () => {
    expect(postureTargets('not a url', ['192.168.1.5'], 3080)).toEqual(['192.168.1.5:3080'])
    expect(postureTargets(undefined, [], 3080)).toEqual([])
  })
})

describe('probePosture', () => {
  it('marks 403 as not exposed (the fence refused)', async () => {
    const snapshot = await probePosture({ port: 3080, targets: ['a.example'], request: statusTransport(403), now: () => 42 })
    expect(snapshot).toEqual({ checkedAt: 42, hosts: [{ host: 'a.example', exposed: false }] })
    expect(anyExposed(snapshot)).toBe(false)
  })

  it('marks 200 (and any other status) as exposed', async () => {
    const snapshot = await probePosture({
      port: 3080,
      targets: ['a.example', 'b.example'],
      request: (options, onStatus) => statusTransport(String(options.headers?.host).startsWith('a') ? 200 : 400)(options, onStatus),
      now: () => 42,
    })
    expect(snapshot.hosts).toEqual([
      { host: 'a.example', exposed: true },
      { host: 'b.example', exposed: true },
    ])
    expect(anyExposed(snapshot)).toBe(true)
  })

  it('treats a transport error as not exposed (unreachable is not open)', async () => {
    const failing: ProbeRequest = (_options, onStatus) => {
      const fake = {
        destroy() {},
        on(event: string, listener: () => void) {
          if (event === 'error') queueMicrotask(listener)
          return fake
        },
        end() {},
      }
      return fake as unknown as ClientRequest
    }
    const snapshot = await probePosture({ port: 3080, targets: ['a.example'], request: failing, now: () => 42 })
    expect(snapshot.hosts).toEqual([{ host: 'a.example', exposed: false }])
  })
})

describe('posture probe key', () => {
  it('skips a second claim for the same targets and retries after release', () => {
    const first = claimPostureKey(undefined, 'a|b')
    expect(first).toEqual({ run: true, next: 'a|b' })
    expect(claimPostureKey(first.next, 'a|b')).toEqual({ run: false, next: 'a|b' })
    expect(releasePostureKey(first.next, 'a|b')).toBeUndefined()
    expect(claimPostureKey(undefined, 'a|b')).toEqual({ run: true, next: 'a|b' })
  })

  it('does not drop a newer in-flight key when an older round fails', () => {
    expect(releasePostureKey('new-targets', 'old-targets')).toBe('new-targets')
  })
})
