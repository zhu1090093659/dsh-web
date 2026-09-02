import { describe, expect, it } from 'vitest'
import { attributeBootFailure } from '../src/core/boot-attribution.ts'

const ROWS = ['web-ui-usage', 'web-ui-pet', 'web-ui-compat', 'web-ui-i18n'] as const
const NAMES = { 'web-ui-usage': '@linxin666/dsh-usage', 'web-ui-pet': '@linxin666/dsh-pet' }

describe('attributeBootFailure', () => {
  it('attributes a loader apply message to its row id', () => {
    const trace = [
      'dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): failed to apply loader entry web-ui-usage (@linxin666/dsh-usage): real plugin start boom',
      'Error: real plugin start boom',
    ].join('\n')
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS })
    expect(verdict?.rowId).toBe('web-ui-usage')
    expect(verdict?.source).toBe('apply-message')
    expect(verdict?.evidence).toContain('web-ui-usage')
  })

  it('attributes a loader import message', () => {
    const trace = 'dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): failed to import loader entry web-ui-pet (@linxin666/dsh-pet): Cannot find package'
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS })
    expect(verdict?.rowId).toBe('web-ui-pet')
    expect(verdict?.source).toBe('import-message')
  })

  it('attributes the failed-to-load audit list', () => {
    const trace = 'dsh: plugin(s) failed to load: web-ui-usage, web-ui-pet; Cordis startup failed because these plugin(s) could not be resolved'
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS })
    expect(verdict?.rowId).toBe('web-ui-usage')
    expect(verdict?.source).toBe('failed-to-load-list')
  })

  it('attributes an activation line via the row name', () => {
    const trace = 'dsh: 1 entry did not activate\n@linxin666/dsh-usage: pending (waiting for service: ghost)'
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS, namesByRowId: NAMES })
    expect(verdict?.rowId).toBe('web-ui-usage')
    expect(verdict?.source).toBe('activation-line')
  })

  it('returns undefined for unknown rows (never guesses)', () => {
    const trace = 'dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): failed to apply loader entry something-else (@x/y): boom'
    expect(attributeBootFailure({ stderrTail: trace, rowIds: ROWS })).toBeUndefined()
  })

  it('returns undefined for noise without any shape', () => {
    expect(attributeBootFailure({ stderrTail: 'EACCES: permission denied, open /x\n', rowIds: ROWS })).toBeUndefined()
    expect(attributeBootFailure({ stderrTail: '', rowIds: ROWS })).toBeUndefined()
  })

  it('ignores rows this profile does not own', () => {
    const trace = 'failed to apply loader entry include (cordis:include): failed to apply loader entry other-row (@x): boom'
    expect(attributeBootFailure({ stderrTail: trace, rowIds: ROWS })).toBeUndefined()
  })
})