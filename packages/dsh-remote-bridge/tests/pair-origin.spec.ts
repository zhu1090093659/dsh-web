/**
 * Where the pairing address comes from, in the order the bridge can vouch for it.
 *
 * The relay identity file used to be a source here. It is not any more: an id on
 * disk proves only that this machine once minted one, not that the Worker's row
 * points at something reachable (the registration may have failed, the lease may
 * never have been claimed, the relay may be off). The second case below pins that
 * as a contract: with an identity file sitting in the DSH home and nothing live,
 * discovery names no subdomain at all.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { relayIdentityFile } from '../src/host/relay-registry.ts'
import { discoverPairOrigin } from '../src/host/pair-origin.ts'

/** Homes created by one case, removed when it ends. */
const homes: string[] = []

/**
 * A throwaway DSH home carrying one relay identity file, the way a previous run
 * of this machine would have left it.
 * @param profile - the profile whose identity file to write.
 * @returns the home path.
 */
function homeWithIdentity(profile: string): string {
  const home = mkdtempSync(join(tmpdir(), 'pair-origin-'))
  homes.push(home)
  const file = relayIdentityFile(profile, home)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ id: 'abc123def456', secret: 'irrelevant' }))
  return home
}

afterEach(() => {
  while (homes.length > 0) rmSync(homes.pop() as string, { recursive: true, force: true })
})

describe('pairing origin discovery', () => {
  it('operator sets the environment contract and that origin is the one discovered', () => {
    // Given the variable dsh-remote-web-ui also reads, with a trailing slash
    const env = { DSH_REMOTE_PUBLIC_BASE_URL: 'wss://typed.example.com/', DSH_PROFILE: 'desktop' }
    // When the origin is discovered
    const facts = discoverPairOrigin({ env })
    // Then it wins over everything else and is normalised to a bare origin
    expect(facts).toEqual({ origin: 'wss://typed.example.com', source: 'env' })
  })

  it('operator has an identity file but nothing live, and no subdomain is invented', () => {
    // Given a home whose relay identity file is still there, and no live face
    const home = homeWithIdentity('desktop')
    // When the origin is discovered with that home as the process home
    const facts = discoverPairOrigin({
      env: { DSH_HOME: home, DSH_PROFILE: 'desktop' },
      realtime: () => undefined,
    })
    // Then nothing is named: an id on disk is not a reachable address
    expect(facts).toBeUndefined()
  })

  it('operator on a LAN has the machine own literal when nothing public is known', () => {
    // Given the same identity file and a LAN address at the same time
    const home = homeWithIdentity('desktop')
    // When the origin is discovered
    const facts = discoverPairOrigin({
      env: { DSH_HOME: home, DSH_PROFILE: 'desktop' },
      realtime: () => undefined,
      lan: () => ({ address: '192.168.1.5', port: 3080 }),
    })
    // Then the LAN literal answers instead of the unregistered subdomain
    expect(facts).toEqual({ origin: 'http://192.168.1.5:3080', source: 'lan' })
  })

  it('operator: a public source still wins over the LAN literal', () => {
    // Given an environment base and a LAN address at the same time
    // When the origin is discovered
    const facts = discoverPairOrigin({
      env: { DSH_REMOTE_PUBLIC_BASE_URL: 'https://typed.example.com' },
      lan: () => ({ address: '192.168.1.5', port: 3080 }),
    })
    // Then the public one is chosen
    expect(facts).toEqual({ origin: 'https://typed.example.com', source: 'env' })
  })

  it('operator has no source at all and no origin is invented', () => {
    // Given no environment base, no live face and no LAN address
    // When the origin is discovered
    const facts = discoverPairOrigin({ env: {}, realtime: () => undefined, lan: () => undefined })
    // Then nothing is invented
    expect(facts).toBeUndefined()
  })

  it('operator: a LAN fallback with no address or no port names nothing', () => {
    // Given two unusable LAN facts
    // When each is discovered
    // Then neither invents an origin
    expect(discoverPairOrigin({ env: {}, lan: () => ({ address: '', port: 3080 }) })).toBeUndefined()
    expect(discoverPairOrigin({ env: {}, lan: () => ({ address: '192.168.1.5', port: Number.NaN }) })).toBeUndefined()
  })
})

describe('the bridge own live face answers first', () => {
  it('operator: a live public face beats the environment contract', () => {
    // Given a live face and the environment base at once
    // When the origin is discovered
    const facts = discoverPairOrigin({
      env: { DSH_REMOTE_PUBLIC_BASE_URL: 'https://typed.example.com' },
      realtime: () => 'https://edge.example.com/',
    })
    // Then the live origin is what the QR carries, normalised to a bare origin
    expect(facts).toEqual({ origin: 'https://edge.example.com', source: 'realtime' })
  })

  it('operator: a blank live origin is not an address', () => {
    // Given a tunnel that has not minted its URL yet
    const facts = discoverPairOrigin({
      env: { DSH_REMOTE_PUBLIC_BASE_URL: 'wss://typed.example.com' },
      realtime: () => '   ',
    })
    // When the origin is discovered
    // Then the next source answers instead of an empty origin reaching the QR
    expect(facts).toEqual({ origin: 'wss://typed.example.com', source: 'env' })
  })
})
