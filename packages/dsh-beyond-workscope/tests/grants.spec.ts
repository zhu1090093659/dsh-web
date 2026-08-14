/**
 * GrantRegistry unit tests: lifecycle, path boundary, scope semantics,
 * session isolation, limits, expiry, and auto-release.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GrantError, GrantRegistry } from '../src/grants.ts'
import type { GrantScope } from '../src/protocol.ts'

/** Moderate confirm timeout (long enough that tests outlive registration). */
const SLOW = { confirmTimeoutMs: 5000, maxActivePerSession: 4, maxPendingPerSession: 2, auditCap: 100 }
/** Short confirm timeout for the expiry test. */
const EXPIRY = { confirmTimeoutMs: 80, maxActivePerSession: 4, maxPendingPerSession: 2, auditCap: 100 }

describe('GrantRegistry', () => {
  let base: string
  let registry: GrantRegistry

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'workscope-test-'))
    registry = new GrantRegistry(SLOW)
  })

  afterEach(async () => {
    registry.dispose()
    await rm(base, { recursive: true, force: true })
  })

  /** Wait until `count` pending grants are registered (registration is async). */
  const waitPending = async (count: number): Promise<void> => {
    await vi.waitFor(() => {
      expect(registry.pendingGrants('s1')).toHaveLength(count)
    })
  }

  it('rejects invalid requests without creating pending state', async () => {
    await expect(registry.requestGrant('s1', 'relative/path', 'read', 'r')).rejects.toBeInstanceOf(GrantError)
    await expect(registry.requestGrant('s1', '/definitely/not/here', 'read', 'r')).rejects.toBeInstanceOf(GrantError)
    await expect(registry.requestGrant('s1', '/', 'read', 'r')).rejects.toBeInstanceOf(GrantError)
    await expect(registry.requestGrant('s1', base, 'both' as GrantScope, 'r')).rejects.toBeInstanceOf(GrantError)
    expect(registry.pendingGrants('s1')).toHaveLength(0)
    expect(registry.auditEntries()).toHaveLength(0)
  })

  it('approves a pending grant and enforces its path boundary', async () => {
    const dir = join(base, 'target')
    await mkdir(dir)
    const promise = registry.requestGrant('s1', dir, 'write', '需要整理合同')
    await waitPending(1)

    const pending = registry.pendingGrants('s1')[0]
    expect(registry.approve(pending.id)).toBeUndefined()

    const outcome = await promise
    expect(outcome.status).toBe('active')
    expect(outcome.grantId).toBe(pending.id)

    // Inside the grant: allowed.
    await expect(registry.isAllowed('s1', join(dir, 'a.txt'), 'read')).resolves.toBe(true)
    await expect(registry.isAllowed('s1', join(dir, 'sub', 'b.txt'), 'write')).resolves.toBe(true)
    // Boundary: sibling and parent prefixes must NOT match.
    await expect(registry.isAllowed('s1', join(base, 'target2'), 'read')).resolves.toBe(false)
    await expect(registry.isAllowed('s1', join(base, 'target-extra', 'c.txt'), 'read')).resolves.toBe(false)
    // Root itself is inside.
    await expect(registry.isAllowed('s1', dir, 'read')).resolves.toBe(true)
    // Path-based check: a missing file INSIDE the grant is allowed (the read
    // tool then fails with a clear ENOENT), a missing path outside is not.
    await expect(registry.isAllowed('s1', join(dir, 'missing.txt'), 'read')).resolves.toBe(true)
    await expect(registry.isAllowed('s1', join(base, 'outside-missing.txt'), 'read')).resolves.toBe(false)
  })

  it('enforces scope: read grants never allow writes', async () => {
    const dir = join(base, 'ro')
    await mkdir(dir)
    const promise = registry.requestGrant('s1', dir, 'read', '只读')
    await waitPending(1)
    const pending = registry.pendingGrants('s1')[0]
    registry.approve(pending.id)
    await promise
    await expect(registry.isAllowed('s1', join(dir, 'x.txt'), 'read')).resolves.toBe(true)
    await expect(registry.isAllowed('s1', join(dir, 'x.txt'), 'write')).resolves.toBe(false)
  })

  it('lets the user tighten a requested write grant to read', async () => {
    const dir = join(base, 'tighten')
    await mkdir(dir)
    const promise = registry.requestGrant('s1', dir, 'write', '改成只读')
    await waitPending(1)
    const pending = registry.pendingGrants('s1')[0]
    registry.approve(pending.id, 'read')
    const outcome = await promise
    expect(outcome.status).toBe('active')
    expect(outcome.scope).toBe('read')
    await expect(registry.isAllowed('s1', dir, 'write')).resolves.toBe(false)
    await expect(registry.isAllowed('s1', dir, 'read')).resolves.toBe(true)
  })

  it('denies on user deny and on timeout expiry', async () => {
    const dir = join(base, 'deny')
    await mkdir(dir)
    const denied = registry.requestGrant('s1', dir, 'read', '将被拒绝')
    await waitPending(1)
    registry.deny(registry.pendingGrants('s1')[0].id)
    await expect(denied).resolves.toMatchObject({ status: 'denied' })

    // Timeout expiry uses its own short-timeout registry.
    const expiring = new GrantRegistry(EXPIRY)
    const dir2 = join(base, 'expire')
    await mkdir(dir2)
    const expired = expiring.requestGrant('s1', dir2, 'read', '将超时')
    await expect(expired).resolves.toMatchObject({ status: 'expired' })
    expect(expiring.pendingGrants('s1')).toHaveLength(0)
    expiring.dispose()
  })

  it('revokes by id and by path', async () => {
    const dir = join(base, 'revoke')
    const sub = join(dir, 'sub')
    await mkdir(sub, { recursive: true })
    const p1 = registry.requestGrant('s1', dir, 'write', '目录')
    await waitPending(1)
    const p2 = registry.requestGrant('s1', sub, 'read', '子目录')
    await waitPending(2)
    registry.approve(registry.pendingGrants('s1')[0].id)
    registry.approve(registry.pendingGrants('s1')[0].id)
    await p1
    await p2
    expect(registry.activeGrants('s1')).toHaveLength(2)

    // By path: revoking the parent also removes the nested grant.
    const revoked = await registry.revoke(dir)
    expect(revoked).toHaveLength(2)
    await expect(registry.isAllowed('s1', dir, 'read')).resolves.toBe(false)
    expect(registry.activeGrants('s1')).toHaveLength(0)

    // By id.
    const again = join(base, 'again')
    await mkdir(again)
    const p3 = registry.requestGrant('s1', again, 'read', '再来')
    await waitPending(1)
    registry.approve(registry.pendingGrants('s1')[0].id)
    await p3
    const active = registry.activeGrants('s1')[0]
    await registry.revoke(active.id)
    expect(registry.activeGrants('s1')).toHaveLength(0)
  })

  it('isolates sessions', async () => {
    const dir = join(base, 'iso')
    await mkdir(dir)
    const promise = registry.requestGrant('s1', dir, 'write', 's1 的授权')
    await waitPending(1)
    registry.approve(registry.pendingGrants('s1')[0].id)
    await promise
    await expect(registry.isAllowed('s1', dir, 'read')).resolves.toBe(true)
    await expect(registry.isAllowed('s2', dir, 'read')).resolves.toBe(false)
    expect(registry.activeGrants('s2')).toHaveLength(0)
  })

  it('releases everything on session end', async () => {
    const dir = join(base, 'release')
    await mkdir(dir)
    const promise = registry.requestGrant('s1', dir, 'write', '会话结束即撤销')
    await waitPending(1)
    const pending = registry.pendingGrants('s1')[0]
    registry.approve(pending.id)
    await promise
    expect(registry.activeGrants('s1')).toHaveLength(1)

    registry.releaseSession('s1')
    expect(registry.activeGrants('s1')).toHaveLength(0)
    await expect(registry.isAllowed('s1', dir, 'read')).resolves.toBe(false)
    expect(registry.auditEntries().some(entry => entry.kind === 'session_released')).toBe(true)
  })

  it('enforces per-session pending and active caps', async () => {
    const dirs: string[] = []
    for (let i = 0; i < 3; i++) {
      const dir = join(base, `cap${i}`)
      await mkdir(dir)
      dirs.push(dir)
    }
    // Pending cap = 2.
    const p1 = registry.requestGrant('s1', dirs[0], 'read', '1')
    await waitPending(1)
    const p2 = registry.requestGrant('s1', dirs[1], 'read', '2')
    await waitPending(2)
    await expect(registry.requestGrant('s1', dirs[2], 'read', '3')).rejects.toBeInstanceOf(GrantError)
    registry.deny(registry.pendingGrants('s1')[0].id)
    registry.deny(registry.pendingGrants('s1')[0].id)
    await p1.catch(() => undefined)
    await p2.catch(() => undefined)

    // Active cap = 4 (from SLOW): approve each grant as it registers (the
    // pending cap stays at 2), then a fifth request is rejected.
    const active: Promise<unknown>[] = []
    for (let i = 0; i < 4; i++) {
      const dir = join(base, `active${i}`)
      await mkdir(dir)
      const promise = registry.requestGrant('s1', dir, 'read', 'a')
      active.push(promise)
      await vi.waitFor(() => { expect(registry.pendingGrants('s1')).toHaveLength(1) })
      registry.approve(registry.pendingGrants('s1')[0].id)
    }
    await Promise.all(active)
    expect(registry.activeGrants('s1')).toHaveLength(4)
    const fifthDir = join(base, 'active4')
    await mkdir(fifthDir)
    await expect(registry.requestGrant('s1', fifthDir, 'read', 'a5')).rejects.toBeInstanceOf(GrantError)
  })

  it('writes audit entries for every transition', async () => {
    const dir = join(base, 'audit')
    await mkdir(dir)
    const promise = registry.requestGrant('s1', dir, 'write', '审计')
    await waitPending(1)
    registry.approve(registry.pendingGrants('s1')[0].id)
    await promise
    await registry.revoke(registry.activeGrants('s1')[0].id)
    const entries = registry.auditEntries()
    const kinds = entries.map(entry => entry.kind)
    expect(kinds).toContain('grant_requested')
    expect(kinds).toContain('grant_approved')
    expect(kinds).toContain('grant_revoked')
  })

  it('resolves a write target through a symlinked parent without escaping', async () => {
    const dir = join(base, 'symlink-target')
    await mkdir(dir)
    const link = join(base, 'link')
    await import('node:fs/promises').then(fs => fs.symlink(dir, link))
    const promise = registry.requestGrant('s1', dir, 'write', 'symlink')
    await waitPending(1)
    registry.approve(registry.pendingGrants('s1')[0].id)
    await promise
    // Writing through the symlink resolves to the granted real directory.
    await expect(registry.isAllowed('s1', join(link, 'new.txt'), 'write')).resolves.toBe(true)
  })

  it('keeps a fresh file readable as a write target', async () => {
    const dir = join(base, 'fresh')
    await mkdir(dir)
    const promise = registry.requestGrant('s1', dir, 'write', '新文件')
    await waitPending(1)
    registry.approve(registry.pendingGrants('s1')[0].id)
    await promise
    const file = join(dir, 'brand-new.txt')
    await writeFile(file, 'hello')
    await expect(registry.isAllowed('s1', file, 'write')).resolves.toBe(true)
  })

  it('registers workspace requests as their own pending kind, not grants', async () => {
    const dir = join(base, 'ws')
    await mkdir(dir)
    const promise = registry.requestWorkspace('s1', dir, '我的工作区', '持续干活')
    await waitPending(1)
    const pending = registry.pendingGrants('s1')[0]
    expect(pending.kind).toBe('workspace')
    expect(pending.title).toBe('我的工作区')
    expect(registry.pendingInfo(pending.id)).toMatchObject({ kind: 'workspace', path: dir, sessionId: 's1' })

    registry.approve(pending.id)
    const outcome = await promise
    expect(outcome.status).toBe('active')
    // A workspace confirmation is not a grant: no read/write boundary opens.
    expect(registry.activeGrants('s1')).toHaveLength(0)
    await expect(registry.isAllowed('s1', dir, 'read')).resolves.toBe(false)
    const kinds = registry.auditEntries().map(entry => entry.kind)
    expect(kinds).toContain('workspace_requested')
    expect(kinds).toContain('workspace_registered')
  })

  it('defaults the workspace title to the directory basename and settles deny', async () => {
    const dir = join(base, 'unnamed-dir')
    await mkdir(dir)
    const promise = registry.requestWorkspace('s1', dir, '', '无标题')
    await waitPending(1)
    const pending = registry.pendingGrants('s1')[0]
    expect(pending.title).toBe('unnamed-dir')
    registry.deny(pending.id)
    await expect(promise).resolves.toMatchObject({ status: 'denied' })
    const kinds = registry.auditEntries().map(entry => entry.kind)
    expect(kinds).toContain('workspace_denied')
  })
})
