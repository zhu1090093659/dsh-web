/**
 * Freeze-snapshot parser + redaction/taint security gate specs.
 * Pure-function tests only: no session, network, or filesystem access.
 */
import { describe, expect, it } from 'vitest'
import { FREEZE_FIELD_BYTE_LIMIT, parseFreezeRequest } from '../src/core/freeze-snapshot.ts'

function freeze(goal: string, progress: string, next: string): string {
  return [
    '<<<FREEZE',
    '目标:',
    goal,
    '进度:',
    progress,
    '下一步:',
    next,
    '>>>FREEZE',
    '',
  ].join('\n')
}

const VALID = freeze('修复登录按钮样式', '已完成红色按钮', '处理暗色主题')

describe('parseFreezeRequest happy path', () => {
  it('parses a well-formed request into goal/progress/next', () => {
    const result = parseFreezeRequest(VALID)
    expect(result).toMatchObject({
      ok: true,
      snapshot: { goal: '修复登录按钮样式', progress: '已完成红色按钮', next: '处理暗色主题' },
    })
  })

  it('is a pure function: same input gives same output, input untouched', () => {
    const input = freeze('a', 'b', 'c')
    const first = parseFreezeRequest(input)
    const second = parseFreezeRequest(input)
    expect(second).toEqual(first)
    expect(input).toBe(freeze('a', 'b', 'c'))
  })

  it('ignores text outside the freeze block', () => {
    const text = '前置说明\n' + VALID + '后续说明'
    const result = parseFreezeRequest(text)
    expect(result).toMatchObject({ ok: true, snapshot: { goal: '修复登录按钮样式' } })
  })

  it('supports multi-line section bodies', () => {
    const text = freeze('目标一\n目标二', '步骤1\n步骤2', '下一步A')
    const result = parseFreezeRequest(text)
    expect(result).toMatchObject({
      ok: true,
      snapshot: { goal: '目标一\n目标二', progress: '步骤1\n步骤2', next: '下一步A' },
    })
  })
})

describe('parseFreezeRequest structure errors', () => {
  it('rejects text without any freeze block', () => {
    const result = parseFreezeRequest('没有冻结块')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('missing-block')
  })

  it('rejects an unterminated freeze block', () => {
    const result = parseFreezeRequest('<<<FREEZE\n目标:\nx')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('unterminated-block')
  })

  it('rejects a block missing a required section', () => {
    const result = parseFreezeRequest(['<<<FREEZE', '目标:', 'x', '进度:', 'y', '>>>FREEZE'].join('\n'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('missing-section')
      expect(result.error.message).toContain('下一步')
    }
  })

  it('rejects duplicated sections', () => {
    const result = parseFreezeRequest(['<<<FREEZE', '目标:', 'x', '目标:', 'y', '进度:', 'z', '下一步:', 'w', '>>>FREEZE'].join('\n'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('duplicate-section')
  })
})

describe('redaction gate', () => {
  it('redacts Bearer credentials into a marker, keeping the rest', () => {
    const text = freeze('调用 API', '带 Authorization: Bearer abc123XYZdef456 请求成功', '重试')
    const result = parseFreezeRequest(text)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.progress).not.toContain('abc123XYZdef456')
      expect(result.snapshot.progress).toContain('[REDACTED]')
      expect(result.snapshot.progress).toContain('请求成功')
      expect(result.warnings).toEqual(['redacted'])
    }
  })

  it('redacts common token shapes (sk-, ghp_, glpat-, xoxb-, AKIA)', () => {
    const secrets = [
      'sk-proj-AbCdEf1234567890',
      'ghp_AbCdEf1234567890abcdefGHIJ',
      'glpat-AbCdEf1234567890',
      'xoxb-123456789012-AbCdEf',
      'AKIAIOSFODNN7EXAMPLE',
    ]
    for (const secret of secrets) {
      const result = parseFreezeRequest(freeze('g', 'token: ' + secret, 'n'))
      expect(result.ok, secret).toBe(true)
      if (result.ok) {
        expect(result.snapshot.progress, secret).not.toContain(secret)
        expect(result.snapshot.progress, secret).toContain('[REDACTED]')
      }
    }
  })

  it('redacts PEM private key blocks entirely', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
    const result = parseFreezeRequest(freeze('g', '密钥如下 ' + pem, 'n'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.progress).not.toContain('MIIEowIBAAKCAQEA')
      expect(result.snapshot.progress).not.toContain('BEGIN RSA PRIVATE KEY')
      expect(result.snapshot.progress).toContain('[REDACTED]')
    }
  })

  it('does not redact ordinary prose without secrets', () => {
    const result = parseFreezeRequest(VALID)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings).toEqual([])
  })
})

describe('taint gate: slash-prefixed DSH command lines', () => {
  it('rejects the whole snapshot when any line starts with /', () => {
    for (const field of ['目标', '进度', '下一步']) {
      const text = freeze(field === '目标' ? '/implement 开始' : 'g', field === '进度' ? '/kill 123' : 'p', field === '下一步' ? '/stop' : 'n')
      const result = parseFreezeRequest(text)
      expect(result.ok, field).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('dsh-command-line')
    }
  })

  it('allows slashes that are not at line start', () => {
    const result = parseFreezeRequest(freeze('读 /etc/hosts 文件', '路径 a/b/c', 'n'))
    expect(result.ok).toBe(true)
  })

  it('rejects slash lines with leading whitespace', () => {
    const result = parseFreezeRequest(freeze('g', '  /kill 123', 'n'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('dsh-command-line')
  })

  it('keeps body lines named like Object prototype keys as content', () => {
    const result = parseFreezeRequest(freeze('constructor', 'toString', 'valueOf'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.goal).toBe('constructor')
      expect(result.snapshot.progress).toBe('toString')
      expect(result.snapshot.next).toBe('valueOf')
    }
  })
})

describe('size gate: 8 KiB per field', () => {
  it('rejects a field larger than the byte limit with a clear error', () => {
    const big = '字'.repeat(Math.ceil(FREEZE_FIELD_BYTE_LIMIT / 3) + 10)
    const result = parseFreezeRequest(freeze(big, 'p', 'n'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('field-too-large')
      expect(result.error.message).toContain('8 KiB')
    }
  })

  it('accepts a field exactly at the byte limit', () => {
    // 'a' is 1 byte; build goal to exactly the limit in bytes.
    const goal = 'a'.repeat(FREEZE_FIELD_BYTE_LIMIT)
    const result = parseFreezeRequest(freeze(goal, 'p', 'n'))
    expect(result.ok).toBe(true)
  })

  it('measures UTF-8 bytes, not UTF-16 code units', () => {
    const bytes = (s: string) => new TextEncoder().encode(s).length
    const goal = '汉'
    expect(bytes(goal)).toBe(3)
    const result = parseFreezeRequest(freeze(goal.repeat(2731), 'p', 'n')) // 8193 bytes
    expect(result.ok).toBe(false)
  })
})
