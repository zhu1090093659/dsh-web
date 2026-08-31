/** Firewall backend detection and summary semantics with a fake runner. */
import { describe, expect, it } from 'vitest'
import { computeFirewallSummary, detectFirewallBackend, FIREWALL_RULE_NAME, type CommandRunner, type FirewallBackend, type ToolResult } from '../src/firewall.ts'

/** A runner scripted per command prefix. */
function fakeRunner(responses: Record<string, ToolResult>): CommandRunner {
  return (cmd, args) => {
    const key = [cmd, ...args].join(' ')
    for (const [pattern, result] of Object.entries(responses)) {
      if (key.includes(pattern)) return result
    }
    return { ok: false, out: '', err: 'not scripted' }
  }
}

describe('detectFirewallBackend', () => {
  it('uses netsh on Windows', () => {
    const backend = detectFirewallBackend('win32', fakeRunner({ netsh: { ok: true, out: '', err: '' } }))
    expect(backend?.label).toBe('netsh')
  })

  it('prefers a running firewalld, then ufw, then iptables on Linux', () => {
    const firewalld = detectFirewallBackend('linux', fakeRunner({
      'firewall-cmd --state': { ok: true, out: 'running', err: '' },
    }))
    expect(firewalld?.label).toBe('firewalld')
    const ufw = detectFirewallBackend('linux', fakeRunner({
      'firewall-cmd --state': { ok: false, out: '', err: 'not running' },
      'ufw --version': { ok: true, out: 'ufw 0.36', err: '' },
    }))
    expect(ufw?.label).toBe('ufw')
    const iptables = detectFirewallBackend('linux', fakeRunner({
      'firewall-cmd --state': { ok: false, out: '', err: 'not running' },
      ufw: { ok: false, out: '', err: '', missing: true },
    }))
    expect(iptables?.label).toBe('iptables')
  })

  it('skips an installed-but-idle firewalld', () => {
    const backend = detectFirewallBackend('linux', fakeRunner({
      'firewall-cmd --state': { ok: false, out: '', err: 'FirewallD is not running' },
    }))
    // No ufw/iptables scripted => falls through to the (always-scriptable)
    // iptables backend in the fake; the point is it is NOT firewalld.
    expect(backend?.label).not.toBe('firewalld')
  })

  it('reports nothing to manage on macOS', () => {
    expect(detectFirewallBackend('darwin', fakeRunner({}))).toBeUndefined()
  })
})

describe('rule maintenance (netsh shape)', () => {
  it('recreates the rule delete-and-add, and removes it when LAN turns off', () => {
    const calls: string[] = []
    let exists = false
    const run: CommandRunner = (cmd, args) => {
      const key = [cmd, ...args].join(' ')
      calls.push(key)
      if (key.includes('show rule')) return { ok: true, out: exists ? `Rule Name:                            ${FIREWALL_RULE_NAME}` : 'No rules match the specified criteria.', err: '' }
      if (key.includes('delete rule')) {
        exists = false
        return { ok: true, out: '', err: '' }
      }
      if (key.includes('add rule')) {
        exists = true
        return { ok: true, out: '', err: '' }
      }
      return { ok: false, out: '', err: 'unexpected' }
    }
    const backend = detectFirewallBackend('win32', run)
    expect(backend).toBeDefined()
    expect(backend?.addRule(3080)).toBe(true)
    expect(calls.some(key => key.includes('localport=3080'))).toBe(true)
    expect(backend?.ruleExists(3080)).toBe(true)
    expect(backend?.removeRule(3080)).toBe(true)
    expect(exists).toBe(false)
  })

  it('reports the rule absent when netsh answers the localized no-match note with exit 0', () => {
    const run: CommandRunner = () => ({ ok: true, out: 'No rules match the specified criteria.', err: '' })
    const backend = detectFirewallBackend('win32', run)
    expect(backend?.ruleExists(3080)).toBe(false)
  })
})

describe('ufw rule probe', () => {
  const ufwBackendWith = (statusOutput: string): FirewallBackend => detectFirewallBackend('linux', fakeRunner({
    'firewall-cmd --state': { ok: false, out: '', err: 'not running' },
    ufw: { ok: true, out: statusOutput, err: '' },
  }))!

  it('anchors the port match so a superset port cannot satisfy the probe', () => {
    const backend = ufwBackendWith('Status: active\n\n1443/tcp                     ALLOW       Anywhere\n')
    expect(backend.ruleExists(443)).toBe(false)
    expect(backend.ruleExists(1443)).toBe(true)
  })
})

describe('computeFirewallSummary', () => {
  it('reflects the rule state against the LAN toggle with an injected backend', () => {
    const backend: FirewallBackend = {
      label: 'test',
      ruleExists: (port) => port === 3080,
      addRule: () => true,
      removeRule: () => true,
    }
    expect(computeFirewallSummary(3080, true, backend)).toEqual({ ok: true, managed: true, note: 'test' })
    expect(computeFirewallSummary(3080, false, backend)).toEqual({ ok: false, managed: true, note: 'test' })
    expect(computeFirewallSummary(3191, true, backend)).toEqual({ ok: false, managed: true, note: 'test' })
  })

  it('reports unmanaged platforms as ok', () => {
    expect(computeFirewallSummary(3080, true, undefined)).toEqual({ ok: true, managed: false })
  })
})
