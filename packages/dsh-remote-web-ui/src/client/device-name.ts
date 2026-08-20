/** Derive a short, non-sensitive device label from a browser User-Agent. */
export function deviceNameFromUserAgent(userAgent?: string): string | undefined {
  if (userAgent === undefined || userAgent.trim() === '') return undefined

  const os = /Windows NT/i.test(userAgent)
    ? 'Windows'
    : /Android/i.test(userAgent)
      ? 'Android'
      : /iPhone|iPad|iPod/i.test(userAgent)
        ? 'iOS'
        : /Macintosh|Mac OS X/i.test(userAgent)
          ? 'macOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : undefined

  const browser = /Edg(?:A|iOS)?\//i.test(userAgent)
    ? 'Edge'
    : /(?:OPR|Opera)\//i.test(userAgent)
      ? 'Opera'
      : /(?:Chrome|CriOS)\//i.test(userAgent)
        ? 'Chrome'
        : /(?:Firefox|FxiOS)\//i.test(userAgent)
          ? 'Firefox'
          : /Safari\//i.test(userAgent) && /Version\//i.test(userAgent)
            ? 'Safari'
            : undefined

  if (os !== undefined && browser !== undefined) return `${os} · ${browser}`
  return os ?? browser
}
