/**
 * Permission-policy tests: the pure resolver behind the SSH agent-tool
 * permission modes (allow / readonly / deny / ask).
 */

import { describe, expect, it } from 'vitest'
import {
  resolveSshPermission,
  SSH_PERMISSION_TOOLS,
  SSH_READONLY_TOOLS,
} from '../src/permission.ts'

describe('SSH permission defaults', () => {
  it('governs every SSH agent tool', () => {
    expect(SSH_PERMISSION_TOOLS).toEqual([
      'ssh_list',
      'ssh_exec',
      'ssh_upload',
      'ssh_download',
      'ssh_tunnel',
      'ssh_cluster',
    ])
  })

  it('keeps ssh_list as the readonly tool', () => {
    expect(SSH_READONLY_TOOLS).toEqual(['ssh_list'])
  })
})

describe('resolveSshPermission', () => {
  it('allows every governed tool under the default allow mode', () => {
    for (const name of SSH_PERMISSION_TOOLS) {
      expect(resolveSshPermission(name)).toEqual({ kind: 'allow' })
      expect(resolveSshPermission(name, { mode: 'allow' })).toEqual({ kind: 'allow' })
    }
  })

  it('does not touch tools outside the governed list', () => {
    const decision = resolveSshPermission('bash', { mode: 'deny' })
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('denies every governed tool under deny mode', () => {
    const decision = resolveSshPermission('ssh_exec', { mode: 'deny' })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.reason).toContain('ssh_exec')
      expect(decision.reason).toContain('deny')
    }
  })

  it('allows only readonly tools under readonly mode', () => {
    expect(resolveSshPermission('ssh_list', { mode: 'readonly' })).toEqual({ kind: 'allow' })
    const denied = resolveSshPermission('ssh_exec', { mode: 'readonly' })
    expect(denied.kind).toBe('deny')
    if (denied.kind === 'deny') {
      expect(denied.reason).toContain('readonly')
    }
  })

  it('asks for governed tools under ask mode and leaves others alone', () => {
    const decision = resolveSshPermission('ssh_upload', { mode: 'ask' })
    expect(decision.kind).toBe('ask')
    if (decision.kind === 'ask') {
      expect(decision.reason).toContain('ssh_upload')
    }
    expect(resolveSshPermission('bash', { mode: 'ask' })).toEqual({ kind: 'allow' })
  })

  it('honours custom tool lists and readonly lists', () => {
    const tools = ['ssh_exec', 'ssh_tunnel']
    expect(resolveSshPermission('ssh_upload', { mode: 'deny', tools })).toEqual({ kind: 'allow' })
    expect(resolveSshPermission('ssh_exec', { mode: 'deny', tools })).toMatchObject({ kind: 'deny' })
    expect(resolveSshPermission('ssh_exec', {
      mode: 'readonly',
      tools,
      readonlyTools: ['ssh_exec'],
    })).toEqual({ kind: 'allow' })
  })
})
