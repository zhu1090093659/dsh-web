import { describe, expect, it } from 'vitest'
import { ActivityRegistry } from '../src/core/activity-registry.ts'
import { sanitizeActivityText } from '../src/core/sanitize.ts'

describe('activity text privacy', () => {
  it('removes control text, query secrets, credentials, and absolute path prefixes', () => {
    const source = [
      '检查 X:\\Users\\demo\\project\\src\\app.ts',
      '和 /home/demo/project/src/index.ts',
      'URL https://example.com/task?id=42&token=hidden#result',
      'api_key=supersecret sk-abcdefghijk Bearer abcdefghijklmnop',
    ].join('\n')

    const safe = sanitizeActivityText(source, { maxChars: 240 })
    expect(safe).toContain('.../app.ts')
    expect(safe).toContain('.../index.ts')
    expect(safe).toContain('https://example.com/task')
    expect(safe).toContain('api_key=[已脱敏]')
    expect(safe).toContain('Bearer [已脱敏]')
    expect(safe).not.toContain('Users')
    expect(safe).not.toContain('/home/')
    expect(safe).not.toContain('supersecret')
    expect(safe).not.toContain('abcdefghijk')
    expect(safe).not.toContain('?id=')
    expect(safe).not.toMatch(/[\u0000-\u001f]/u)
  })

  it('bounds output by Unicode code points', () => {
    const safe = sanitizeActivityText('正在整理一个很长很长很长的任务状态说明', { maxChars: 12 })
    expect([...safe]).toHaveLength(12)
    expect(safe.endsWith('...')).toBe(true)
  })

  it('sanitizes registry fields before any adapter can consume them', () => {
    const registry = new ActivityRegistry({ now: () => 100 })
    registry.update({
      instanceId: 'instance',
      bootId: 'boot',
      sessionId: 'session',
      profile: 'web\u0000profile',
      workspaceLabel: '/home/demo/private/project',
      title: '修复 https://example.com/a?token=hidden',
      phase: 'tool',
      statusLine: '读取 X:\\Users\\demo\\private\\data.json',
      tool: {
        name: 'shell\u0007runner',
        detail: 'password=not-for-display',
        activeCount: -4,
        completedCount: 2.9,
      },
    })

    expect(registry.snapshot().tasks[0]).toMatchObject({
      profile: 'web profile',
      workspaceLabel: '.../project',
      title: '修复 https://example.com/a',
      statusLine: '读取 .../data.json',
      tool: {
        name: 'shell runner',
        detail: 'password=[已脱敏]',
        activeCount: 0,
        completedCount: 2,
      },
    })
  })
})
