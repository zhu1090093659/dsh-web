/**
 * The panel's token read: the one wire call the browser half makes, and every
 * way it can end. The transport is injected, so these suites drive the reader
 * against a fake response instead of patching the global fetch.
 */
import { describe, expect, it } from 'vitest'
import { PAIR_TOKEN_URL, readPairToken, type PairTokenFetch } from '../src/client/pair-token.ts'

/** A transport that answers once with the given status and body. */
function answering(status: number, body: unknown, _contentType = 'application/json'): PairTokenFetch {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

/** A transport that never answers. */
const refusing: PairTokenFetch = async () => {
  throw new TypeError('fetch failed')
}

describe('protocol v1 pairing code read', () => {
  it('operator reads the one-shot code from this package own Host route', async () => {
    // Given a host that answers with a live token and its expiry
    let asked = ''
    const transport: PairTokenFetch = async (url) => {
      asked = url
      return { ok: true, status: 200, json: async () => ({ token: 'Zm9vYmFy', expiresAt: 1_760_000_030_000, url: 'ws://h/ios/v1?token=Zm9vYmFy' }) }
    }
    // When the panel reads one
    const outcome = await readPairToken({ fetchImpl: transport })
    // Then the token and its deadline cross, and the route is this package's own
    expect(outcome).toEqual({ kind: 'ok', token: 'Zm9vYmFy', expiresAt: 1_760_000_030_000, origin: null, originSource: null, pairingUrl: null })
    expect(asked).toBe(PAIR_TOKEN_URL)
    expect(asked).toBe('remote-bridge/pair/token')
  })

  it('operator on a host that knows its public origin gets the one-scan code', async () => {
    // Given a body that also names the origin a phone should dial
    const pairingUrl = 'wss://abc.dsh-market.com/ios/v1?token=Zm9vYmFy'
    const transport = answering(200, {
      token: 'Zm9vYmFy',
      expiresAt: 1_760_000_030_000,
      url: 'ws://127.0.0.1:3000/ios/v1?token=Zm9vYmFy',
      origin: 'wss://abc.dsh-market.com',
      originSource: 'realtime',
      pairingUrl,
    })
    // When the panel reads it
    const outcome = await readPairToken({ fetchImpl: transport })
    // Then both halves cross, so the panel can encode {token,url} instead of a bare code,
    // together with the source that decides which located line renders
    expect(outcome).toEqual({
      kind: 'ok',
      token: 'Zm9vYmFy',
      expiresAt: 1_760_000_030_000,
      origin: 'wss://abc.dsh-market.com',
      originSource: 'realtime',
      pairingUrl,
    })
  })

  it('operator on a host that named its address by configuration gets the same one-scan code', async () => {
    // Given a body whose origin came from the configured public base
    const pairingUrl = 'wss://relay.example/ios/v1?token=Zm9vYmFy'
    const transport = answering(200, {
      token: 'Zm9vYmFy',
      expiresAt: 1_760_000_030_000,
      origin: 'wss://relay.example',
      originSource: 'env',
      pairingUrl,
    })
    // When the panel reads it
    const outcome = await readPairToken({ fetchImpl: transport })
    // Then the source crosses as the configured one, which the panel renders as public
    expect(outcome).toEqual({
      kind: 'ok',
      token: 'Zm9vYmFy',
      expiresAt: 1_760_000_030_000,
      origin: 'wss://relay.example',
      originSource: 'env',
      pairingUrl,
    })
  })

  it('operator reads a code from a host whose source this panel does not know', async () => {
    // Given a body naming a source no version of this panel has ever heard of
    const transport = answering(200, {
      token: 'Zm9vYmFy',
      expiresAt: 1_760_000_030_000,
      origin: 'wss://abc.dsh-market.com',
      originSource: 'registry',
      pairingUrl: 'wss://abc.dsh-market.com/ios/v1?token=Zm9vYmFy',
    })
    // When the panel reads it
    const outcome = await readPairToken({ fetchImpl: transport })
    // Then the address still crosses as an unknown source, which the panel renders
    // as a public one instead of trusting a name it cannot read
    expect(outcome).toEqual({
      kind: 'ok',
      token: 'Zm9vYmFy',
      expiresAt: 1_760_000_030_000,
      origin: 'wss://abc.dsh-market.com',
      originSource: null,
      pairingUrl: 'wss://abc.dsh-market.com/ios/v1?token=Zm9vYmFy',
    })
  })

  it('operator scans a code whose address is not a websocket origin and the panel falls back', async () => {
    // Given a body whose pairingUrl is not a dialable ws(s) URL
    const transport = answering(200, {
      token: 'Zm9vYmFy',
      expiresAt: 1_760_000_030_000,
      origin: 'wss://abc.dsh-market.com',
      pairingUrl: 'https://elsewhere.example/steal?token=Zm9vYmFy',
    })
    // When the panel reads it
    const outcome = await readPairToken({ fetchImpl: transport })
    // Then the code falls back to the bare token instead of pointing the phone elsewhere
    expect(outcome).toEqual({
      kind: 'ok',
      token: 'Zm9vYmFy',
      expiresAt: 1_760_000_030_000,
      origin: 'wss://abc.dsh-market.com',
      originSource: null,
      pairingUrl: null,
    })
  })

  it('operator opens the page from another machine and the loopback gate refuses it', async () => {
    // Given the gate answering 403 for a page that is not on this machine
    const transport = answering(403, { ok: false, error: 'forbidden', reason: 'the request names a Host that is not this machine' })
    // When the panel reads a token
    const outcome = await readPairToken({ fetchImpl: transport })
    // Then the refusal is its own outcome, not a generic failure
    expect(outcome).toEqual({ kind: 'forbidden' })
  })

  it('operator host answers with a body that carries no token', async () => {
    // Given a 200 whose body is not a token document
    const transport = answering(200, { ok: true })
    // When the panel reads a token
    const outcome = await readPairToken({ fetchImpl: transport })
    // Then the read is a failure rather than an empty code on screen
    expect(outcome).toEqual({ kind: 'failed', status: 200 })
  })

  it('operator host answers with an unexpected status', async () => {
    // Given a host route that fails with 500
    const transport = answering(500, { error: 'internal' })
    // When the panel reads a token
    const outcome = await readPairToken({ fetchImpl: transport })
    // Then the status crosses so the panel can name it
    expect(outcome).toEqual({ kind: 'failed', status: 500 })
  })

  it('operator host never answers because the request cannot be sent', async () => {
    // Given a transport that fails before any response exists
    // When the panel reads a token
    const outcome = await readPairToken({ fetchImpl: refusing })
    // Then the read reports an unreachable host instead of throwing
    expect(outcome).toEqual({ kind: 'unreachable' })
  })

  it('operator host answers with a body that is not JSON', async () => {
    // Given a 200 whose body cannot be parsed
    const transport: PairTokenFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token <') },
    })
    // When the panel reads a token
    const outcome = await readPairToken({ fetchImpl: transport })
    // Then the read is a failure rather than an unhandled rejection
    expect(outcome).toEqual({ kind: 'failed', status: 200 })
  })
})
