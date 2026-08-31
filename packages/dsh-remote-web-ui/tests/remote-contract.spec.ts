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
import { LOCAL_ONLY_PREFIXES, REMOTE_API_PATHS, REMOTE_UPGRADE_PATHS, localOnlyDenial } from '../src/remote-methods.ts'

describe('remote channel contract pins (0.1.2 line)', () => {
  it('the channel rewrite surface keeps its own fixed path constants', () => {
    // The official client opens the Typert gateway mux at /api/remote.mux;
    // its gated mirror is the one stream socket a paired device must reach.
    expect(REMOTE_API_PATHS.mux).toBe('/remote/api/remote.mux')
    expect(REMOTE_UPGRADE_PATHS).toContain('/remote/api/remote.mux')
    expect(REMOTE_UPGRADE_PATHS).toContain('/remote/api/dsh-ssh/terminal')
  })

  it('exactly four control planes stay physically local', () => {
    expect(LOCAL_ONLY_PREFIXES).toEqual([
      '/api/pair',
      '/api/update',
      '/api/plugin-manager',
      '/api/dsh-desktop-launcher',
    ])
    for (const prefix of LOCAL_ONLY_PREFIXES) {
      expect(localOnlyDenial(prefix)).toBeDefined()
    }
  })
})
