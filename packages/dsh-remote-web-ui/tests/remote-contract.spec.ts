/**
 * SDK contract pins: on the 0.1.2-alpha.2 line the host /api surface carries
 * no per-method privilege table — the "configuration plane is local"
 * behavior lives in the browser (client plugins branch on
 * connection.isLoopback), and the paired remote desktop flips into host mode
 * via the transport ownsHost hook installed by the boot script. The channel
 * therefore pins its own path constants and the physically-local control
 * planes instead.
 */
import { describe, expect, it } from 'vitest'
import { LOCAL_ONLY_PREFIXES, REMOTE_API_PATHS, REMOTE_PREFIX, REMOTE_UPGRADE_PATHS, localOnlyDenial } from '../src/remote-methods.ts'
import { REMOTE_CHANNEL_RULES } from '../src/remote-channel-rules.ts'

describe('remote channel contract pins (0.1.2 line)', () => {
  it('the channel rewrite surface keeps its own fixed path constants', () => {
    // The official client opens the Typert gateway mux at /api/remote.mux;
    // its gated mirror is the one stream socket a paired device must reach.
    expect(REMOTE_API_PATHS.mux).toBe('/remote/api/remote.mux')
    expect(REMOTE_UPGRADE_PATHS).toContain('/remote/api/remote.mux')
    expect(REMOTE_UPGRADE_PATHS).toContain('/remote/api/dsh-ssh/terminal')
    // Every sidebar socket the plugin proxies needs a host-side upgrade route
    // registered here; the sidebar family is /sidebar/ws/{terminal,
    // agent-terminals,agent-opens} (issue #1646).
    expect(REMOTE_UPGRADE_PATHS).toContain('/remote/sidebar/ws/terminal')
    expect(REMOTE_UPGRADE_PATHS).toContain('/remote/sidebar/ws/agent-terminals')
    expect(REMOTE_UPGRADE_PATHS).toContain('/remote/sidebar/ws/agent-opens')
  })

  it('operator rewriting a WebSocket path gets a matching host upgrade route', () => {
    // Given the browser patch's rewrite list and the host's exact-path upgrade
    // routes; when a path is rewritten; then the host has a route for it.
    // Drift guard: a path in the first without the second is rewritten to a
    // dead route and the socket dies silently on a paired device (issue #1646).
    const expected = REMOTE_CHANNEL_RULES.wsPaths.map(path => `${REMOTE_PREFIX}${path}`)
    expect([...REMOTE_UPGRADE_PATHS].sort()).toEqual([...expected].sort())
  })

  it('operator pairing a device gets exactly three physically-local control planes', () => {
    // Given a paired remote desktop; when it probes the control planes; then
    // exactly pairing, self-update and plugin install/remove stay local.
    expect(LOCAL_ONLY_PREFIXES).toEqual([
      '/api/pair',
      '/api/update',
      '/api/plugin-manager',
    ])
    for (const prefix of LOCAL_ONLY_PREFIXES) {
      expect(localOnlyDenial(prefix), prefix).toBeDefined()
    }
  })
})
