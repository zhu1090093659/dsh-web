/**
 * Pure-function tests for the host python analysis service: ruff JSON
 * diagnostics mapping (0-based spans + severity ladder) and the AST symbol
 * helper output normalization.
 * @module dsh-aionui-panel/tests/py-service
 */

import { describe, expect, it } from 'vitest'
import { parseRuffJson, parseSymbolsJson, ruffSeverity } from '../src/host/py-service.ts'

describe('ruffSeverity', () => {
  it('classifies E9 syntax and F pyflakes as errors', () => {
    expect(ruffSeverity('E999')).toBe('error')
    expect(ruffSeverity('F401')).toBe('error')
  })

  it('classifies E/W style codes as warnings', () => {
    expect(ruffSeverity('E501')).toBe('warning')
    expect(ruffSeverity('W291')).toBe('warning')
  })

  it('classifies everything else as info', () => {
    expect(ruffSeverity('B008')).toBe('info')
    expect(ruffSeverity('I001')).toBe('info')
  })
})

describe('parseRuffJson', () => {
  it('maps 1-based ruff rows onto 0-based line/col spans', () => {
    const stdout = JSON.stringify([
      {
        code: 'E402',
        message: 'Module level import not at top of file',
        location: { row: 28, column: 1 },
        end_location: { row: 28, column: 19 },
      },
    ])
    const result = parseRuffJson(stdout)
    expect(result).toEqual([
      { fromLine: 27, fromCol: 0, toLine: 27, toCol: 18, severity: 'warning', message: 'Module level import not at top of file', code: 'E402' },
    ])
  })

  it('drops records without a rule code', () => {
    expect(parseRuffJson(JSON.stringify([{ message: 'no code' }]))).toEqual([])
  })

  it('returns empty for a non-array payload', () => {
    expect(parseRuffJson(JSON.stringify({ not: 'an array' }))).toEqual([])
  })
})

describe('parseSymbolsJson', () => {
  it('normalizes defs and refs', () => {
    const stdout = JSON.stringify({
      defs: [
        { name: 'draw_panel', kind: 'function', line: 102, endLine: 264, doc: 'doc', params: ['ax', 'year'], className: null },
        { name: 'plot', kind: 'class', line: 3, endLine: 5, doc: '', params: [], className: null },
      ],
      refs: [
        { name: 'draw_panel', line: 295, targetLine: 102 },
      ],
    })
    const result = parseSymbolsJson(stdout)
    expect(result.tool).toBe('python')
    expect(result.defs).toHaveLength(2)
    expect(result.defs[0]).toMatchObject({ name: 'draw_panel', kind: 'function', line: 102, params: ['ax', 'year'] })
    expect(result.defs[1].kind).toBe('class')
    expect(result.refs).toEqual([{ name: 'draw_panel', line: 295, targetLine: 102 }])
  })

  it('coerces unknown kinds to function and drops malformed entries', () => {
    const stdout = JSON.stringify({
      defs: [{ name: 'x', kind: 'bogus', line: 1, endLine: 1, doc: '', params: null, className: null }, null],
      refs: ['nope'],
    })
    const result = parseSymbolsJson(stdout)
    expect(result.defs).toHaveLength(1)
    expect(result.defs[0].kind).toBe('function')
    expect(result.refs).toHaveLength(0)
  })
})
