/**
 * LAN address derivation for the pairing URLs. Mirrors the dsh CLI's
 * boot-time sampling (apps/cli/src/app-cli-entry.ts `resolveLanTrust`): the
 * pairing links may only name addresses the /api trust fence was configured
 * with, so the same non-internal IPv4 derivation applies here — an external
 * plugin cannot read the CLI's sampled snapshot, but the fence accepts
 * exactly these literals, which is the property that matters.
 *
 * One derivation is deliberately narrower than the CLI's: everything this
 * module returns is advertised to a phone (the QR base, the landing page's
 * LAN probe, and the fence's trusted-literal list), and an advertised literal
 * the peer can never reach costs a phone the whole pairing attempt. A macOS
 * host running a fake-IP proxy (Clash/Surge/Mihomo) samples its TUN gateway as
 * `198.18.0.1`, which is a benchmarking-range address no LAN peer can route
 * to; the old derivation advertised it like any other interface. The filter
 * below drops the interface kinds and address ranges a peer cannot reach, and
 * keeps everything else — RFC1918, ULA-side IPv4 and a routable public literal
 * (a VPS whose NIC is its only reachable base must stay advertisable).
 *
 * @module @linxin666/dsh-remote-web-ui/lan
 */

import { networkInterfaces } from 'node:os'

/**
 * Interface-name stems of tunnels and VPN adapters: interfaces whose address
 * is a private point-to-point endpoint on this machine, never an authority a
 * peer on the local network can dial. Matching is case-insensitive and
 * anchored at the start, so `utun0`/`utun4` both match while a hypothetical
 * `en0utun` does not. Windows reports adapter *descriptions* rather than POSIX
 * stems (`Tailscale`, `WireGuard Tunnel`, `OpenVPN Wintun`), which the same
 * list covers by prefix.
 */
const TUNNEL_INTERFACE_PREFIXES: readonly string[] = [
  'utun', 'tun', 'tap', 'ppp', 'ipsec', 'wg', 'wireguard', 'tailscale', 'nordlynx', 'proton', 'openvpn', 'zt',
]

/**
 * Interface-name stems of virtual machine and container bridges: `docker0`,
 * `vethXXXX`, `br-<id>`, `virbr0`, `vmnet8`, `vboxnet0` and the Hyper-V
 * `vEthernet` adapters. Their RFC1918 addresses belong to a NAT the host
 * shares with its own guests, so a phone on the physical LAN cannot reach
 * them; `bridge0`/`br0` are deliberately absent because a real bridged LAN
 * (macOS Internet Sharing) is exactly the address a phone does reach.
 */
const VIRTUAL_INTERFACE_PREFIXES: readonly string[] = [
  'docker', 'veth', 'virbr', 'vmnet', 'vboxnet', 'vethernet', 'br-',
]

/**
 * IPv4 ranges no peer on the local network can reach. The list is a denial
 * list rather than an RFC1918 allowlist on purpose: a host whose only
 * interface is a routable public literal (a VPS, a standalone server) would
 * otherwise lose its only constructible base and fall back to the
 * `lan-required` banner.
 * @param octets - the four address octets, in order.
 * @returns true when an address in this range must not be advertised.
 */
function isUnreachableIPv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0] = octets
  // 0.0.0.0/8 "this network": never a usable address.
  if (a === 0) return true
  // 127.0.0.0/8 loopback (node already marks it internal; kept as the belt).
  if (a === 127) return true
  // 100.64.0.0/10 carrier-grade NAT: Tailscale and ISP-level NAT hand out
  // addresses here, and a peer on the physical LAN cannot route to them.
  if (a === 100 && b >= 64 && b <= 127) return true
  // 169.254.0.0/16 link-local (APIPA / self-assigned).
  if (a === 169 && b === 254) return true
  // 198.18.0.0/15 benchmarking: the range a fake-IP TUN gateway takes.
  if (a === 198 && (b === 18 || b === 19)) return true
  // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved (includes the broadcast).
  if (a >= 224) return true
  return false
}

/**
 * Whether an interface name belongs to a tunnel, VPN adapter, or virtual
 * machine/container bridge, so its address is not an authority a LAN peer
 * can dial.
 * @param name - the interface name from `os.networkInterfaces()`.
 * @returns true when the interface must not be advertised.
 */
export function isUnadvertisableInterface(name: string): boolean {
  const lower = name.toLowerCase()
  return [...TUNNEL_INTERFACE_PREFIXES, ...VIRTUAL_INTERFACE_PREFIXES].some(prefix => lower.startsWith(prefix))
}

/**
 * Whether an IPv4 literal can be advertised to a pairing peer.
 * @param address - a dotted-quad IPv4 literal.
 * @returns true when a peer could plausibly reach it.
 */
export function isAdvertisableIPv4(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map(part => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN))
  if (octets.some(octet => !Number.isInteger(octet) || octet > 255)) return false
  return !isUnreachableIPv4(octets)
}

/** One sampled interface address. */
export interface LanCandidate {
  /** The interface name the address was sampled from. */
  iface: string
  /** The IPv4 literal. */
  address: string
}

/** The `networkInterfaces()` shape, injectable so the filter is testable. */
export type NetworkInterfaceMap = ReturnType<typeof networkInterfaces>

/**
 * Every IPv4 interface address this machine can advertise to a pairing peer:
 * non-internal, on a non-tunnel and non-virtual interface, outside the ranges
 * no peer can route to.
 * @param interfaces - the sampled interface map (defaults to the live one).
 * @returns the candidates in interface order (possibly empty).
 */
export function lanIPv4Candidates(interfaces: NetworkInterfaceMap = networkInterfaces()): LanCandidate[] {
  const candidates: LanCandidate[] = []
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (isUnadvertisableInterface(name)) continue
    for (const iface of addresses ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      if (!isAdvertisableIPv4(iface.address)) continue
      candidates.push({ iface: name, address: iface.address })
    }
  }
  return candidates
}

/**
 * Non-internal, reachable IPv4 interface addresses of this machine — the
 * IP-literal authorities an all-interfaces bind is reachable by on the LAN.
 * @param interfaces - the sampled interface map (defaults to the live one).
 * @returns the addresses in interface order (possibly empty).
 */
export function lanIPv4Addresses(interfaces: NetworkInterfaceMap = networkInterfaces()): string[] {
  return lanIPv4Candidates(interfaces).map(candidate => candidate.address)
}
