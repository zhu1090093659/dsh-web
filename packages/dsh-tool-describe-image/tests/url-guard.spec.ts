/** URL fence unit tests: the guard must refuse every private/loopback/link-local/reserved host
 * — literal and resolved-answers — while leaving public hosts fetchable, with one generic
 * wording that never echoes HTTP statuses. */

import { describe, expect, it } from 'vitest'
import {
  assertImageUrlAllowed,
  ipv4ToInt,
  ipv6ToInt,
  isBlockedIpv4Value,
  isBlockedIpv6Value,
  isLocalhostVariant,
  IMAGE_URL_NOT_ALLOWED,
  IMAGE_URL_UNRESOLVABLE,
  type ResolvedAddress,
} from '../src/url-guard.ts'

const PUBLIC: readonly ResolvedAddress[] = [{ address: '93.184.216.34', family: 4 }]
let PUBLIC_RESOLVER_CALLS = 0
const PUBLIC_RESOLVER = async (hostname: string): Promise<readonly ResolvedAddress[]> => {
  PUBLIC_RESOLVER_CALLS += 1
  return PUBLIC
}


describe('IPv4 CIDR fence', () => {
  it.each([
    ['0.0.0.0', true],
    ['0.1.2.3', true],
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['100.64.0.1', false],
    ['127.0.0.1', true],
    ['127.255.255.254', true],
    ['169.254.0.1', true],
    ['169.254.169.254', true],
    ['172.15.255.255', false],
    ['172.16.0.0', true],
    ['172.31.255.255', true],
    ['172.32.0.0', false],
    ['192.168.0.1', true],
    ['192.168.255.255', true],
    ['192.169.0.1', false],
    ['8.8.8.8', false],
    ['93.184.216.34', false],
  ])('blocks %s -> %s', (address, blocked) => {
    expect(isBlockedIpv4Value(ipv4ToInt(address)!)).toBe(blocked)
  })

  it('rejects malformed IPv4 literals', () => {
    expect(ipv4ToInt('999.1.1.1')).toBeUndefined()
    expect(ipv4ToInt('1.2.3')).toBeUndefined()
    expect(ipv4ToInt('1.2.3.4.5')).toBeUndefined()
    expect(ipv4ToInt('1.2.3.x')).toBeUndefined()
    expect(ipv4ToInt('')).toBeUndefined()
  })
})

describe('IPv6 CIDR fence', () => {
  it.each([
    ['::', true],
    ['::1', true],
    ['::2', false],
    ['fc00::1', true],
    ['fd12:3456:789a::1', true],
    ['fe80::1', true],
    ['2001:db8::1', false],
    ['2606:4700:4700::1111', false],
    ['::ffff:127.0.0.1', true], // IPv4-mapped loopback
    ['::ffff:10.0.0.1', true], // IPv4-mapped private
    ['::ffff:93.184.216.34', false], // IPv4-mapped public
    ['::ffff:7f00:1', true], // mapped loopback in hex form
  ])('blocks %s -> %s', (address, blocked) => {
    expect(isBlockedIpv6Value(ipv6ToInt(address)!)).toBe(blocked)
  })

  it('parses dotted-quad tails, zones, and double-colon expansions', () => {
    expect(ipv6ToInt('::ffff:8.8.8.8')).toBeDefined()
    expect(isBlockedIpv6Value(ipv6ToInt('::ffff:8.8.8.8')!)).toBe(false)
    expect(ipv6ToInt('fe80::1%eth0')).toBe(ipv6ToInt('fe80::1'))
    expect(ipv6ToInt('1:2:3:4:5:6:7:8')).toBeDefined()
    expect(ipv6ToInt('1:2:3:4:5:6:7')).toBeUndefined()
    expect(ipv6ToInt('1:2:3:4:5:6:7:8:9')).toBeUndefined()
    expect(ipv6ToInt('::')).toBe(0n)
    expect(ipv6ToInt('::1:2:3:4:5:6:7')).toBeDefined()
    expect(ipv6ToInt('1:2::3:4:5:6')).toBeDefined()
  })
})

describe('localhost hostname variants', () => {
  it('refuses localhost and its variants', () => {
    for (const name of ['localhost', 'localhost.', 'LOCALHOST', 'localhost.localdomain', 'foo.localhost', 'svc.localhost']) {
      expect(isLocalhostVariant(name.toLowerCase().replace(/\.$/, ''))).toBe(true)
    }
  })

  it('keeps ordinary public hostnames', () => {
    expect(isLocalhostVariant('example.com')).toBe(false)
    expect(isLocalhostVariant('images.example.com')).toBe(false)
    expect(isLocalhostVariant('notlocalhost.com')).toBe(false)
  })
})

describe('assertImageUrlAllowed', () => {
  it.each([
    'http://127.0.0.1/x.png',
    'http://127.0.0.1.nip.io/x.png', // resolved below via resolver
    'http://localhost/x.png',
    'http://localhost.localdomain/x.png',
    'http://foo.localhost/x.png',
    'http://10.0.0.5/x.png',
    'http://172.16.1.1/x.png',
    'http://192.168.1.1/x.png',
    'http://169.254.169.254/latest/meta-data/',
    'http://0.0.0.0/x.png',
    'http://[::1]/x.png',
    'http://[::]/x.png',
    'http://[fc00::1]/x.png',
    'http://[fe80::1]/x.png',
    'http://[::ffff:127.0.0.1]/x.png',
    'http://2130706433/x.png', // legacy decimal 127.0.0.1
    'http://0x7f000001/x.png', // legacy hex 127.0.0.1
    'http://0177.0.0.1/x.png', // legacy octal 127.0.0.1
  ])('rejects %s', async (url) => {
    await expect(assertImageUrlAllowed(url, async () => [{ address: '127.0.0.1', family: 4 }]))
      .rejects.toThrow(IMAGE_URL_NOT_ALLOWED)
  })

  it('rejects a domain whose resolution is private, before any fetch', async () => {
    await expect(assertImageUrlAllowed('http://internal.example.test/img.png', async () => [{ address: '10.1.2.3', family: 4 }]))
      .rejects.toThrow(IMAGE_URL_NOT_ALLOWED)
    await expect(assertImageUrlAllowed('http://meta.example.test/img.png', async () => [{ address: '169.254.169.254', family: 4 }]))
      .rejects.toThrow(IMAGE_URL_NOT_ALLOWED)
    await expect(assertImageUrlAllowed('http://v6.example.test/img.png', async () => [{ address: 'fd00::1', family: 6 }]))
      .rejects.toThrow(IMAGE_URL_NOT_ALLOWED)
  })

  it('rejects a domain with any private answer among several', async () => {
    await expect(assertImageUrlAllowed('http://mixed.example.test/img.png', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.9.9.9', family: 4 },
    ])).rejects.toThrow(IMAGE_URL_NOT_ALLOWED)
  })

  it('rejects an unresolvable domain (fail closed)', async () => {
    await expect(assertImageUrlAllowed('http://gone.example.test/img.png', async () => { throw new Error('ENOTFOUND') }))
      .rejects.toThrow(IMAGE_URL_UNRESOLVABLE)
  })

  it('allows a public literal IP and a public domain', async () => {
    await expect(assertImageUrlAllowed('https://8.8.8.8/img.png', async () => PUBLIC)).resolves.toBeUndefined()
    await expect(assertImageUrlAllowed('https://example.com/img.png', PUBLIC_RESOLVER)).resolves.toBeUndefined()
    expect(PUBLIC_RESOLVER_CALLS).toBe(1)
  })

  it('refuses non-http(s) schemes and malformed URLs', async () => {
    for (const url of ['ftp://example.com/x.png', 'file:///etc/passwd', 'http://', 'http://[not-ipv6/x.png']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(assertImageUrlAllowed(url, async () => PUBLIC)).rejects.toThrow(IMAGE_URL_NOT_ALLOWED)
    }
  })
})
