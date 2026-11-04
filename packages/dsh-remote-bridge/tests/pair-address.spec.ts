/**
 * The kind of address a located origin is, tested once because two halves read
 * it: the panel states it to the operator and the Host log names it beside the
 * machine-local link. The suite pins both directions — the literals a host can
 * hand back, and the public names built to look like one.
 */
import { describe, expect, it } from 'vitest'
import { isLanOrigin, type PairOriginSource } from '../src/core/pair-address.ts'

describe('the kind of address a located origin is', () => {
  it('operator with a private literal reads a local address whatever the host called it', () => {
    // Given every shape a located origin can take, with the source the host named
    const cases: Array<[string | null, PairOriginSource | null, boolean]> = [
      ['wss://abc.dsh-market.com', 'realtime', false],
      ['https://relay.example', 'env', false],
      ['http://192.168.1.5:3080', 'env', true],
      ['http://10.0.0.4:3080', 'realtime', true],
      ['http://172.20.0.9:3080', null, true],
      ['http://172.31.255.254:3080', null, true],
      ['http://172.32.0.9:3080', null, false],
      ['ws://127.0.0.1:3080', null, true],
      ['http://localhost:3080', null, true],
      ['http://0.0.0.0:3080', null, true],
      ['http://169.254.1.1:3080', null, true],
      ['wss://[::1]:3080', null, true],
      ['http://[fd00::1]:3080', 'env', true],
      ['http://[fe90::1]:3080', null, true],
      ['http://[2001:db8::1]:3080', null, false],
      ['http://192.168.1.5:3080', 'lan', true],
      [null, null, false],
      ['not a url', 'env', false],
    ]
    // When each one is classified
    // Then only the private literals and the host's own LAN answer read as local
    for (const [origin, source, expected] of cases) {
      expect([origin, source, isLanOrigin(origin, source)]).toEqual([origin, source, expected])
    }
  })

  it('operator with a public name that starts like a private one reads it as public', () => {
    // Given public names built to look like a private literal
    const impostors = [
      'https://localhost.evil.com:3080',
      'https://10.example.com',
      'https://127.0.0.1.evil.com',
      'https://192.168.evil.com',
      'https://172.20.evil.com:8443',
      'https://169.254.evil.com',
    ]
    // When each one is classified
    // Then none of them is local: the pattern is anchored to the whole hostname,
    // so a name that merely starts like one stays public and is never printed
    for (const origin of impostors) {
      expect([origin, isLanOrigin(origin, 'env')]).toEqual([origin, false])
    }
  })
})
