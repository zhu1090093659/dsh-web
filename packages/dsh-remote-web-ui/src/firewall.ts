/**
 * Host firewall management for the LAN bind toggle: while LAN access is on,
 * keep one inbound allow rule for the bound port; when it turns off, remove
 * the rule. Windows manages the Windows Defender Firewall rule via netsh;
 * Linux uses the first available manager among firewalld / ufw / iptables.
 * On every other platform (macOS included) the plugin reports the firewall
 * as unmanaged: the port usually needs no rule there, and managing pf or the
 * application firewall is out of scope for a distributable plugin.
 *
 * Ported from the dsh-LAN reference implementation (MIT), adapted to this
 * package's structure and test seams.
 */

import { spawnSync } from 'node:child_process'

/** Rule name shared by every backend so re-runs recreate the same rule. */
export const FIREWALL_RULE_NAME = 'remote-web-ui (auto)'

/** One command execution result (test seam replaces the runner). */
export interface ToolResult {
  ok: boolean
  out: string
  err: string
  /** true when the binary could not be spawned at all (ENOENT et al). */
  missing?: boolean
}

/** The command runner seam: spawnSync in production, a stub in tests. */
export type CommandRunner = (cmd: string, args: readonly string[]) => ToolResult

/** Production runner: spawn without a shell, capture text, 20s timeout. */
export const spawnRunner: CommandRunner = (cmd, args) => {
  const result = spawnSync(cmd, args, {
    shell: false,
    encoding: 'utf8',
    windowsHide: process.platform === 'win32',
    timeout: 20_000,
  })
  return {
    ok: result.status === 0,
    out: result.stdout ?? '',
    err: result.stderr ?? '',
    missing: result.error !== undefined,
  }
}

/** A firewall backend manages one allow rule for a TCP port. */
export interface FirewallBackend {
  /** Short label surfaced in the settings card (netsh, firewalld, ...). */
  readonly label: string
  ruleExists(port: number): boolean
  addRule(port: number): boolean
  removeRule(port: number): boolean
}

function netshBackend(run: CommandRunner): FirewallBackend {
  // `show rule name=` exits 0 even when nothing matches (the localized "no
  // rules match" note), so exit-code-only probes always report the rule as
  // present. The verbose listing echoes the full rule name — the one
  // locale-independent field — and is matched literally instead.
  const show = (): boolean => {
    const result = run('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE_NAME}`, 'verbose'])
    return result.ok && result.out.includes(FIREWALL_RULE_NAME)
  }
  return {
    label: 'netsh',
    ruleExists: show,
    addRule: (port) => run('netsh', [
      'advfirewall', 'firewall', 'add', 'rule', `name=${FIREWALL_RULE_NAME}`,
      'dir=in', 'action=allow', 'protocol=TCP', `localport=${String(port)}`, 'profile=private,domain',
    ]).ok,
    removeRule: () => {
      if (!show()) return true
      return run('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${FIREWALL_RULE_NAME}`]).ok
    },
  }
}

function firewalldBackend(run: CommandRunner): FirewallBackend {
  return {
    label: 'firewalld',
    ruleExists: (port) => run('firewall-cmd', ['--permanent', '--query-port', `${String(port)}/tcp`]).ok,
    addRule: (port) => {
      const add = run('firewall-cmd', ['--permanent', '--add-port', `${String(port)}/tcp`])
      const reload = run('firewall-cmd', ['--reload'])
      return add.ok && reload.ok
    },
    removeRule: (port) => {
      const del = run('firewall-cmd', ['--permanent', '--remove-port', `${String(port)}/tcp`])
      const reload = run('firewall-cmd', ['--reload'])
      return del.ok && reload.ok
    },
  }
}

function ufwBackend(run: CommandRunner): FirewallBackend {
  return {
    label: 'ufw',
    ruleExists: (port) => {
      const result = run('ufw', ['status'])
      // Anchored so a superset port's row (1443/tcp) cannot satisfy the
      // probe for a shorter one (443/tcp).
      return result.ok && new RegExp(`(^|\\s)${String(port)}/tcp\\s+ALLOW`, 'i').test(result.out)
    },
    addRule: (port) => run('ufw', ['allow', `${String(port)}/tcp`]).ok,
    removeRule: (port) => run('ufw', ['delete', 'allow', `${String(port)}/tcp`]).ok,
  }
}

function iptablesBackend(run: CommandRunner): FirewallBackend {
  const rule = (port: number): string[] => ['INPUT', '-p', 'tcp', '--dport', String(port), '-j', 'ACCEPT']
  return {
    label: 'iptables',
    ruleExists: (port) => run('iptables', ['-C', ...rule(port)]).ok,
    addRule: (port) => run('iptables', ['-A', ...rule(port)]).ok,
    removeRule: (port) => run('iptables', ['-D', ...rule(port)]).ok,
  }
}

function toolAvailable(run: CommandRunner, cmd: string): boolean {
  try {
    // A missing binary reports through the runner's missing flag (spawnSync
    // sets result.error for ENOENT); any graceful answer counts as present.
    return run(cmd, ['--version']).missing !== true
  } catch {
    return false
  }
}

/**
 * Detect the platform firewall manager. Returns undefined when the platform
 * has no supported manager (macOS, unknown Linux without tools): the port
 * then usually needs no rule and the UI reports "unmanaged".
 */
export function detectFirewallBackend(
  platform: NodeJS.Platform,
  run: CommandRunner = spawnRunner,
): FirewallBackend | undefined {
  if (platform === 'win32') return netshBackend(run)
  if (platform !== 'linux') return undefined
  if (toolAvailable(run, 'firewall-cmd')) {
    // firewalld only counts when its daemon answers; an installed-but-idle
    // firewall-cmd would otherwise claim management it cannot exercise.
    if (run('firewall-cmd', ['--state']).ok) return firewalldBackend(run)
  }
  if (toolAvailable(run, 'ufw')) return ufwBackend(run)
  if (toolAvailable(run, 'iptables')) return iptablesBackend(run)
  return undefined
}

let cachedBackend: { platform: NodeJS.Platform; backend: FirewallBackend | undefined } | undefined

/** Cached detection for the running platform (per process). */
export function firewallBackend(): FirewallBackend | undefined {
  const platform = process.platform
  if (cachedBackend === undefined || cachedBackend.platform !== platform) {
    cachedBackend = { platform, backend: detectFirewallBackend(platform) }
  }
  return cachedBackend.backend
}

/** Firewall state reported to the settings card. */
export interface FirewallSummary {
  /** true when the rule state matches the LAN toggle (or nothing to manage). */
  ok: boolean
  /** false when no supported firewall manager exists on this platform. */
  managed: boolean
  /** Backend label or an explanation for unmanaged platforms. */
  note?: string
}

/**
 * Delete-and-add: recreating the rule is idempotent and locale-proof (netsh
 * output is localized, so parsing the live rule's port is fragile; the Linux
 * backends follow the same recreate pattern).
 */
export function ensureFirewallRule(port: number): boolean {
  invalidateFirewallSummary()
  const backend = firewallBackend()
  if (backend === undefined) return true
  backend.removeRule(port)
  return backend.addRule(port)
}

export function removeFirewallRule(port: number): boolean {
  invalidateFirewallSummary()
  const backend = firewallBackend()
  if (backend === undefined) return true
  return backend.removeRule(port)
}

/**
 * Human-readable firewall state for the status endpoint. A missing backend
 * means the platform has nothing to manage; detection stays at the call site
 * so an explicit undefined cannot silently re-probe the real OS mid-test.
 */
export function computeFirewallSummary(
  port: number,
  lanEnabled: boolean,
  backend: FirewallBackend | undefined,
): FirewallSummary {
  if (backend === undefined) return { ok: true, managed: false }
  return { ok: lanEnabled ? backend.ruleExists(port) : !backend.ruleExists(port), managed: true, note: backend.label }
}

/** How long a firewallSummary answer is reused before the backend is probed again. */
export const FIREWALL_SUMMARY_TTL_MS = 30_000

let summaryCache: { key: string; at: number; value: FirewallSummary } | undefined

/** Forget the cached summary (rule mutations call this). */
export function invalidateFirewallSummary(): void {
  summaryCache = undefined
}

/**
 * The settings card polls this every ten seconds; the probes are blocking
 * spawnSync subprocesses on managed platforms, so short-TTL memoization
 * keeps one poll from freezing the host event loop per request.
 */
export function firewallSummary(port: number, lanEnabled: boolean): FirewallSummary {
  const key = `${String(port)}|${lanEnabled ? '1' : '0'}`
  const now = Date.now()
  if (summaryCache !== undefined && summaryCache.key === key && now - summaryCache.at < FIREWALL_SUMMARY_TTL_MS) {
    return summaryCache.value
  }
  const value = computeFirewallSummary(port, lanEnabled, firewallBackend())
  summaryCache = { key, at: now, value }
  return value
}
