/**
 * Contract tests: client route literals mirror the host ROUTES, and the host
 * entry exposes the cordis contract (name / inject) — the drift guard the
 * original local plugin smoke asserted.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROUTES, name, inject } from '../src/index.ts'

describe('host plugin contract', () => {
  it('exposes the stable cordis name and inject list', () => {
    expect(name).toBe('skill-explorer')
    expect(inject).toEqual(['webServer', 'skills', 'sessions'])
  })

  it('client bundle /api/ literals are a subset of host ROUTES (no drift)', () => {
    const clientSrc = readFileSync(join(process.cwd(), 'src/client/api.ts'), 'utf8')
    const clientPaths = [...clientSrc.matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]).sort()
    const hostPaths = [...new Set(Object.values(ROUTES))].sort()
    // The client mirrors the business routes; health is host-only.
    expect(clientPaths).toEqual(['/api/dsh-skill-explorer/create', '/api/dsh-skill-explorer/delete', '/api/dsh-skill-explorer/list', '/api/dsh-skill-explorer/set-enabled'])
    for (const path of clientPaths) expect(hostPaths).toContain(path)
    expect(hostPaths).toContain('/api/dsh-skill-explorer/health')
  })
})
