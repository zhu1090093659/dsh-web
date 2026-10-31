/**
 * Pure LAN-edge decisions (issue #1917): which address the forwarder may listen
 * on, plus the profile resolution and firewall gate that still apply.
 *
 * The plugin no longer plans a bind for the web server's own row, so the
 * flags-win precedence this file used to pin is gone with it: a `--host` now
 * simply wins in the harness itself, and the forwarder steps aside instead of
 * competing for that address:port.
 */
import { describe, expect, it } from 'vitest'
import { firewallActionNeeded, forwardPlanOf, isLanReachableBind, resolveManagedProfile, type LanBindCapability } from '../src/host/lan-bind-plan.ts'

describe('resolveManagedProfile', () => {
  it('operator: an explicit config wins over the launched profile and the environment', () => {
    // Given an explicit profile config beside a launched profile and an
    // environment value
    // When the managed profile resolves
    // Then the explicit config wins
    expect(resolveManagedProfile('qa', 'desktop', 'web')).toBe('qa')
  })

  it('operator: the launched profile wins over the environment (the Desktop client)', () => {
    // Given the Desktop client, which boots "desktop" without exporting
    // DSH_PROFILE (an environment-only resolution edited profiles/web there)
    // When no explicit config is set
    // Then the launched profile is the managed one, environment or not
    expect(resolveManagedProfile(undefined, 'desktop', undefined)).toBe('desktop')
    expect(resolveManagedProfile(undefined, 'desktop', 'web')).toBe('desktop')
  })

  it('operator: resolution falls back to the environment, then to web', () => {
    // Given neither an explicit config nor a launched profile
    // When the environment names a profile, or names nothing
    // Then the environment wins, and the default managed profile is web
    expect(resolveManagedProfile(undefined, undefined, 'web')).toBe('web')
    expect(resolveManagedProfile(undefined, undefined, undefined)).toBe('web')
  })
})

/** A host whose webserver schema still accepts the wildcard bind. */
const WILDCARD_HOST: LanBindCapability = { wildcardSupported: true, candidates: ['192.168.1.5', '10.0.0.3'] }

/** A host whose webserver schema rejects the wildcard (0.2.1-rc.2 and later). */
const CONCRETE_HOST: LanBindCapability = { wildcardSupported: false, candidates: ['192.168.1.5', '10.0.0.3'] }

/** A machine with no network interface to listen on. */
const NO_CANDIDATE_HOST: LanBindCapability = { wildcardSupported: false, candidates: [] }

describe('forwardPlanOf', () => {
  it('operator: the toggle off leaves the LAN edge off', () => {
    // Given the toggle off, or never flipped at all
    // When the LAN edge is planned
    // Then nothing listens and the reason says so
    expect(forwardPlanOf(false, undefined, WILDCARD_HOST)).toEqual({ host: undefined, reason: 'off' })
    expect(forwardPlanOf(undefined, undefined, WILDCARD_HOST)).toEqual({ host: undefined, reason: 'off' })
  })

  it('operator: the toggle on listens on this machine first LAN IPv4', () => {
    // Given the toggle on and a machine with interfaces
    // When the LAN edge is planned
    // Then the first sampled candidate is the listener, and the wildcard is
    // never chosen even on a host that would accept it: it would collide with
    // the loopback listener on the same port
    expect(forwardPlanOf(true, undefined, WILDCARD_HOST)).toEqual({ host: '192.168.1.5', reason: undefined })
    expect(forwardPlanOf(true, undefined, CONCRETE_HOST)).toEqual({ host: '192.168.1.5', reason: undefined })
    expect(forwardPlanOf(true, undefined, { wildcardSupported: false, candidates: ['10.0.0.3'] }))
      .toEqual({ host: '10.0.0.3', reason: undefined })
  })

  // Issue #1917 (f): a --host the operator passed IS the LAN listener; a
  // forwarder fighting it for the same address:port would fail to bind and
  // would leave two competing answers for one authority.
  it('operator: a non-loopback --host makes the forwarder yield the port', () => {
    // Given the toggle on and a CLI host that already binds the network
    // When the LAN edge is planned
    // Then nothing is planned here and the reason names the yield
    expect(forwardPlanOf(true, '192.168.1.5', CONCRETE_HOST)).toEqual({ host: undefined, reason: 'host-bind' })
    expect(forwardPlanOf(true, '0.0.0.0', WILDCARD_HOST)).toEqual({ host: undefined, reason: 'host-bind' })
    expect(forwardPlanOf(true, '::', CONCRETE_HOST)).toEqual({ host: undefined, reason: 'host-bind' })
  })

  it('operator: a loopback --host does not make the forwarder yield', () => {
    // Given the toggle on and a CLI host that binds loopback (the LAN edge is
    // still this plugin's job then)
    // When the LAN edge is planned
    // Then the forwarder listens on the LAN candidate
    expect(forwardPlanOf(true, '127.0.0.1', CONCRETE_HOST)).toEqual({ host: '192.168.1.5', reason: undefined })
    expect(forwardPlanOf(true, 'localhost', CONCRETE_HOST)).toEqual({ host: '192.168.1.5', reason: undefined })
    expect(forwardPlanOf(true, '::1', CONCRETE_HOST)).toEqual({ host: '192.168.1.5', reason: undefined })
  })

  it('operator: a machine with no LAN IPv4 address reports why LAN stays off', () => {
    // Given the toggle on and no advertisable interface
    // When the LAN edge is planned
    // Then nothing is planned and the reason is the missing address, which the
    // caller reports instead of failing
    expect(forwardPlanOf(true, undefined, NO_CANDIDATE_HOST)).toEqual({ host: undefined, reason: 'no-address' })
  })
})

describe('isLanReachableBind', () => {
  it('operator: a wildcard and a concrete interface address both reach the LAN', () => {
    // Given the literals a listener may name
    // When the reachability decision runs
    // Then both are LAN reachable, so a host that refuses the wildcard does
    // not silently drop LAN access for the only bind it permits
    expect(isLanReachableBind('0.0.0.0')).toBe(true)
    expect(isLanReachableBind('192.168.1.5')).toBe(true)
    expect(isLanReachableBind('::')).toBe(true)
  })

  it('operator: loopback and an unsettled bind never reach the LAN', () => {
    // Given the loopback literals, a localhost token and an absent bind
    // When the reachability decision runs
    // Then none counts as LAN access
    expect(isLanReachableBind('127.0.0.1')).toBe(false)
    expect(isLanReachableBind('127.0.0.5')).toBe(false)
    expect(isLanReachableBind('::1')).toBe(false)
    expect(isLanReachableBind('localhost')).toBe(false)
    expect(isLanReachableBind(undefined)).toBe(false)
  })
})

describe('firewallActionNeeded', () => {
  it('applies once, then only on state movement', () => {
    expect(firewallActionNeeded(undefined, { enabled: true, port: 3080 })).toBe(true)
    const applied = { enabled: true, port: 3080 }
    expect(firewallActionNeeded(applied, { enabled: true, port: 3080 })).toBe(false)
    expect(firewallActionNeeded(applied, { enabled: false, port: 3080 })).toBe(true)
    expect(firewallActionNeeded(applied, { enabled: true, port: 3191 })).toBe(true)
  })

  it('skips entirely when the next state is not derivable', () => {
    expect(firewallActionNeeded(undefined, undefined)).toBe(false)
    expect(firewallActionNeeded({ enabled: true, port: 3080 }, undefined)).toBe(false)
  })
})
