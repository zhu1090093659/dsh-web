/**
 * SDK contract pins: the remote desktop channel mirrors two client-connection
 * internals (the loopback-only method set, the /api transport paths and
 * envelope type strings). If a future SDK release changes either, this test
 * fails before the channel silently drifts open or breaks.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { LOOPBACK_ONLY_METHODS, REMOTE_API_PATHS } from '../src/remote-methods.ts'

const require = createRequire(import.meta.url)
const dist = readFileSync(require.resolve('@deepseek-ai/dsh-client-connection'), 'utf8')
const clientDist = readFileSync(require.resolve('@deepseek-ai/dsh-client-connection/client'), 'utf8')
const apiproxyDist = readFileSync(require.resolve('@deepseek-ai/dsh-host-apiproxy'), 'utf8')

/** The privileged set exactly as the installed SDK spells it. */
function installedPrivilegedMethods(): string[] {
  const match = dist.match(/PRIVILEGED_METHODS = new Set\(\[([\s\S]*?)\]\)/)
  if (match === null) throw new Error('PRIVILEGED_METHODS not found in the installed client-connection dist')
  return [...match[1].matchAll(/"([^"]+)"/g)].map(hit => hit[1])
}

describe('client-connection contract pins (rc line)', () => {
  it('the loopback-only method set matches the installed SDK exactly', () => {
    expect([...LOOPBACK_ONLY_METHODS].sort()).toEqual(installedPrivilegedMethods().sort())
  })

  it('the browser event streams still live at /api/events.{mux,host}', () => {
    // The connection dist composes the paths from API_PATH; the client half
    // mounts the same two downlink paths against the page origin.
    expect(dist).toContain('API_PATH = "/api"')
    expect(dist).toContain('${API_PATH}/events.mux')
    expect(dist).toContain('${API_PATH}/events.host')
    expect(clientDist).toContain('${API_PATH}/events')
    expect(REMOTE_API_PATHS.mux).toBe('/remote/api/events.mux')
    expect(REMOTE_API_PATHS.host).toBe('/remote/api/events.host')
  })

  it('the unary envelope still uses the client-request/server-response pair', () => {
    // The envelope schema lives in the apiproxy package (the carrier both
    // halves share); the literals pin the wire vocabulary.
    expect(apiproxyDist).toContain('"client-request"')
    expect(apiproxyDist).toContain('"server-response"')
  })

  it('the browser client still issues unary calls as POST /api/<method>', () => {
    expect(clientDist).toContain('`/api/${method}`')
    // The browser carrier resolves the WebSocket downlinks against the page
    // origin with the two fixed /api paths (the rewrite surface).
    expect(clientDist).toContain('new WebSocket(url)')
  })
})
