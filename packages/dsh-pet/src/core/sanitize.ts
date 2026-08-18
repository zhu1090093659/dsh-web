/** Privacy-safe text normalization for every activity transport boundary. */

export interface ActivityTextOptions {
  /** Maximum Unicode code points in the returned text. */
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 48
const REDACTED = '[已脱敏]'

function truncate(text: string, maxChars: number): string {
  const chars = [...text]
  if (chars.length <= maxChars) return text
  if (maxChars <= 3) return chars.slice(0, maxChars).join('')
  return `${chars.slice(0, maxChars - 3).join('')}...`
}

function stripUrlSecrets(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s<>"']+/giu, (raw) => {
    const suffix = raw.match(/[),.;!?，。！？]+$/u)?.[0] ?? ''
    const source = suffix === '' ? raw : raw.slice(0, -suffix.length)
    try {
      const url = new URL(source)
      return `${url.origin}${url.pathname}${suffix}`
    } catch {
      return raw
    }
  })
}

function shortenPaths(text: string): string {
  const windows = text.replace(
    /\b[A-Za-z]:\\(?:[^\\\s"'<>|]+\\){2,}[^\\\s"'<>|]*/gu,
    (path) => `.../${path.split('\\').at(-1) ?? 'path'}`,
  )
  return windows.replace(
    /(^|[\s(])\/(?:[^/\s"'<>]+\/){2,}[^/\s"'<>),.;!?]*/gu,
    (_path, prefix: string) => {
      const source = _path.slice(prefix.length)
      return `${prefix}.../${source.split('/').at(-1) ?? 'path'}`
    },
  )
}

function redactCredentials(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/giu, REDACTED)
    .replace(
      /\b(token|api[-_ ]?key|secret|password)\s*[:=]\s*[^\s,;]+/giu,
      (_match, label: string) => `${label}=${REDACTED}`,
    )
}

/**
 * Remove transport-unsafe and sensitive fragments, normalize whitespace,
 * shorten absolute paths, strip URL queries/fragments, and enforce a bound.
 */
export function sanitizeActivityText(
  input: string,
  options: ActivityTextOptions = {},
): string {
  const withoutControls = input.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
  const withoutUrlSecrets = stripUrlSecrets(withoutControls)
  const withoutCredentials = redactCredentials(withoutUrlSecrets)
  const withoutPaths = shortenPaths(withoutCredentials)
  const compact = withoutPaths.replace(/\s+/gu, ' ').trim()
  return truncate(compact, Math.max(0, options.maxChars ?? DEFAULT_MAX_CHARS))
}
