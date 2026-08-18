/** Safe local Web DSH origin accepted by the desktop companion. */

export const DEFAULT_WEB_DSH_URL = 'http://127.0.0.1:3080'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** Normalize one loopback HTTP(S) origin and reject paths, credentials, and remote hosts. */
export function normalizeWebDshUrl(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('invalid Web DSH URL')
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new TypeError('invalid Web DSH URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
    || url.username !== '' || url.password !== ''
    || (url.pathname !== '' && url.pathname !== '/')
    || url.search !== '' || url.hash !== '') {
    throw new TypeError('invalid Web DSH URL')
  }
  return url.origin
}
