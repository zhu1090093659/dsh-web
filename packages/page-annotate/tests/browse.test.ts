import { describe, expect, it } from 'vitest'
import { iframeSandboxForUrl } from '../src/client/browse.ts'

describe('iframeSandboxForUrl', () => {
  it('keeps the remote page origin so sign-in cookies and storage work', () => {
    expect(iframeSandboxForUrl('https://example.com/login', 'http://127.0.0.1:63274')).toContain('allow-same-origin')
  })

  it('does not grant same-origin privileges to the DSH shell itself', () => {
    expect(iframeSandboxForUrl('http://127.0.0.1:63274/session/1', 'http://127.0.0.1:63274')).not.toContain('allow-same-origin')
  })
})
