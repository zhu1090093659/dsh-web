/**
 * The pairing-address filter: which interface addresses this plugin may
 * advertise to a scanning phone. The live complaint behind it is a macOS host
 * whose fake-IP proxy samples `198.18.0.1` on `utun4`; the test keeps that exact
 * shape as its anchor and covers the neighbouring classes (link-local, CGNAT,
 * loopback, multicast, VM/container bridges) that would each cost a phone the
 * whole pairing attempt.
 */
import { describe, expect, it } from 'vitest'
import { isAdvertisableIPv4, isUnadvertisableInterface, lanIPv4Addresses, lanIPv4Candidates, type NetworkInterfaceMap } from '../src/host/lan.ts'

/** Build the `networkInterfaces()` shape for one map of name -> address list. */
function sample(entries: Record<string, readonly string[]>): NetworkInterfaceMap {
  const map: NetworkInterfaceMap = {}
  for (const [name, addresses] of Object.entries(entries)) {
    map[name] = addresses.map((address) => {
      const v6 = address.includes(':')
      return {
        address,
        netmask: v6 ? 'ffff:ffff:ffff:ffff::' : '255.255.255.0',
        family: v6 ? 'IPv6' : 'IPv4',
        mac: '00:00:00:00:00:00',
        internal: address === '127.0.0.1' || address === '::1',
        cidr: v6 ? `${address}/64` : `${address}/24`,
      }
    }) as NetworkInterfaceMap[string]
  }
  return map
}

describe('isUnadvertisableInterface', () => {
  it('operator: an interface whose address is a tunnel endpoint is never advertised', () => {
    // Given the adapters a VPN or tunnel installs on this machine,
    const names = ['utun0', 'utun4', 'tun0', 'tap0', 'ppp0', 'ipsec0', 'wg0', 'Tailscale', 'WireGuard Tunnel', 'OpenVPN Wintun', 'nordlynx']
    // When the advertised set is derived, then none of them contributes an address.
    for (const name of names) {
      expect(isUnadvertisableInterface(name), name).toBe(true)
    }
  })

  it('operator: a guest network bridge is dropped while a real LAN bridge is kept', () => {
    // Given a container or VM bridge, whose address serves this host's own guests.
    for (const name of ['docker0', 'veth1a2b3c', 'br-9f8e7d', 'virbr0', 'vmnet8', 'vboxnet0', 'vEthernet (WSL)']) {
      expect(isUnadvertisableInterface(name), name).toBe(true)
    }
    // When the advertised set is derived, then a bridged LAN the phone really
    // dials (macOS Internet Sharing) and a physical NIC stay in it.
    expect(isUnadvertisableInterface('bridge0')).toBe(false)
    expect(isUnadvertisableInterface('br0')).toBe(false)
    expect(isUnadvertisableInterface('en0')).toBe(false)
    expect(isUnadvertisableInterface('Ethernet')).toBe(false)
  })
})

describe('isAdvertisableIPv4', () => {
  it('operator: an address a peer on the network can dial stays advertisable', () => {
    // Given the private-range addresses a LAN hands out, plus a routable literal
    // (a standalone server whose NIC is its only base),
    const addresses = ['192.168.31.220', '10.0.0.3', '172.16.9.4', '172.31.255.254', '203.0.113.7']
    // When the filter judges them, then every one of them survives.
    for (const address of addresses) {
      expect(isAdvertisableIPv4(address), address).toBe(true)
    }
  })

  it('operator: the fake-IP TUN gateway range is dropped and its edge is respected', () => {
    // Given the addresses Clash/Surge/Mihomo sample on their TUN adapter,
    // When the filter judges them, then the reported 198.18.0.1 is dropped and
    // the address just past the range keeps its place in the advertised set.
    expect(isAdvertisableIPv4('198.18.0.1')).toBe(false)
    expect(isAdvertisableIPv4('198.19.255.254')).toBe(false)
    expect(isAdvertisableIPv4('198.20.0.1')).toBe(true)
  })

  it('operator: every range no peer can route to is dropped, CGNAT included', () => {
    // Given this network, loopback, the carrier-grade NAT space a VPN also uses,
    // link-local, the multicast and the reserved blocks,
    const denied = [
      '0.0.0.0', '0.1.2.3',
      '127.0.0.1', '127.1.2.3',
      '100.64.0.1', '100.127.255.255',
      '169.254.1.1',
      '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
    ]
    // When the filter judges them, then each is dropped while the addresses on
    // both sides of the CGNAT range are kept.
    for (const address of denied) {
      expect(isAdvertisableIPv4(address), address).toBe(false)
    }
    expect(isAdvertisableIPv4('100.63.255.255')).toBe(true)
    expect(isAdvertisableIPv4('100.128.0.1')).toBe(true)
  })

  it('operator: a malformed literal is refused instead of guessed', () => {
    // Given truncated, over-long, out-of-range, IPv6 and non-address strings,
    const malformed = ['', '192.168.1', '192.168.1.5.6', '192.168.1.256', 'fd00::1', 'not-an-ip']
    // When the filter judges them, then none is mistaken for an advertisable one.
    for (const address of malformed) {
      expect(isAdvertisableIPv4(address), address).toBe(false)
    }
  })
})

describe('lanIPv4Candidates', () => {
  it('operator: interface order is kept and loopback, IPv6 and internal entries are ignored', () => {
    // Given a map mixing a physical NIC, loopback, an IPv6 entry and a second NIC,
    const candidates = lanIPv4Candidates(sample({
      en0: ['192.168.31.220'],
      lo0: ['127.0.0.1', '::1'],
      en1: ['fe80::1', '10.0.0.3'],
    }))
    // When the advertised set is derived, then it holds one entry per reachable
    // IPv4 address, in the order the OS listed the interfaces.
    expect(candidates).toEqual([
      { iface: 'en0', address: '192.168.31.220' },
      { iface: 'en1', address: '10.0.0.3' },
    ])
  })

  it('operator: the Clash TUN gateway sampled beside the real NIC never gets advertised', () => {
    // Given the shape reported on the affected host: a fake-IP TUN beside the
    // physical interface, sampled in whatever order the OS lists them,
    const interfaces = sample({ utun4: ['198.18.0.1'], en0: ['192.168.31.220'] })
    // When the advertised set is derived, then no address of the phone-hostile
    // interface survives, on the name rule and on the range rule alike.
    expect(lanIPv4Addresses(interfaces)).toEqual(['192.168.31.220'])
    expect(lanIPv4Addresses(sample({ en9: ['198.18.0.1'] }))).toEqual([])
    expect(lanIPv4Candidates(sample({ tailscale0: ['100.101.102.103'] }))).toEqual([])
  })

  it('operator: a host whose only interface is routable keeps its pairing base', () => {
    // Given a standalone server whose NIC carries the routable address — still a
    // base a phone can dial, and one an RFC1918 allowlist would strand,
    // When the advertised set is derived, then that address is the base.
    expect(lanIPv4Addresses(sample({ eth0: ['203.0.113.7'] }))).toEqual(['203.0.113.7'])
  })

  it('operator: a host with no advertisable interface yields an empty set', () => {
    // Given a TUN gateway, a container bridge and loopback as the whole host,
    // When the advertised set is derived, then nothing is advertised at all.
    expect(lanIPv4Addresses(sample({ utun0: ['198.18.0.1'], docker0: ['172.17.0.1'], lo0: ['127.0.0.1'] }))).toEqual([])
    expect(lanIPv4Addresses(sample({}))).toEqual([])
  })
})
