import { describe, expect, it } from 'vitest'
import { clampViewport, MAX_VIEWPORT_EDGE, MIN_VIEWPORT_EDGE, normalizeUrl, validateScreenshotUrl } from '../src/core/url.ts'

describe('normalizeUrl', () => {
  it('adds https to bare hostnames', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/')
  })

  it('adds http to localhost', () => {
    expect(normalizeUrl('localhost:3000/orders')).toBe('http://localhost:3000/orders')
  })

  it('keeps an explicit scheme', () => {
    expect(normalizeUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000/')
  })

  it('strips the fragment', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page')
  })

  it('rejects empty and garbage input', () => {
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('   ')).toBeNull()
    expect(normalizeUrl('not a url')).toBeNull()
  })

  it('rejects non-http schemes', () => {
    expect(normalizeUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('data:text/plain,hi')).toBeNull()
  })
})

describe('validateScreenshotUrl', () => {
  it('accepts http(s) pages', () => {
    expect(validateScreenshotUrl('https://example.com')).toEqual({ ok: true, url: 'https://example.com/' })
    expect(validateScreenshotUrl('http://localhost:3000')).toEqual({ ok: true, url: 'http://localhost:3000/' })
  })

  it('rejects file/data/javascript schemes', () => {
    for (const input of ['file:///etc/passwd', 'data:text/plain,hi', 'javascript:void(0)']) {
      expect(validateScreenshotUrl(input).ok).toBe(false)
    }
  })
})

describe('clampViewport', () => {
  it('applies fallbacks and clamps edges', () => {
    expect(clampViewport({ width: 1280, height: 800 })).toEqual({ width: 1280, height: 800 })
    expect(clampViewport({ width: 1, height: 99999 })).toEqual({ width: MIN_VIEWPORT_EDGE, height: MAX_VIEWPORT_EDGE })
    expect(clampViewport(null)).toEqual({ width: 1280, height: 800 })
    expect(clampViewport({ width: 'wide' })).toEqual({ width: 1280, height: 800 })
  })
})
