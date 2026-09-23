import { describe, expect, it } from 'vitest'
import { attributeBootFailure } from '../src/core/boot-attribution.ts'

const ROWS = ['web-ui-usage', 'web-ui-pet', 'web-ui-compat', 'web-ui-i18n'] as const
const NAMES = { 'web-ui-usage': '@linxin666/dsh-usage', 'web-ui-pet': '@linxin666/dsh-pet' }

describe('attributeBootFailure', () => {
  it('operator attributes a loader apply message to its row id', () => {
    // Given a boot trace whose include row wraps one apply failure for a row this profile owns
    const trace = [
      'dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): failed to apply loader entry web-ui-usage (@linxin666/dsh-usage): real plugin start boom',
      'Error: real plugin start boom',
    ].join('\n')

    // When the operator attributes the captured tail
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS })

    // Then the wrapped row id is named, with the failing line as evidence
    expect(verdict?.rowId).toBe('web-ui-usage')
    expect(verdict?.source).toBe('apply-message')
    expect(verdict?.evidence).toContain('web-ui-usage')
  })

  it('operator attributes a loader import message', () => {
    // Given a boot trace whose include row wraps one import failure
    const trace = 'dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): failed to import loader entry web-ui-pet (@linxin666/dsh-pet): Cannot find package'

    // When the operator attributes the captured tail
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS })

    // Then the row is attributed as an import failure
    expect(verdict?.rowId).toBe('web-ui-pet')
    expect(verdict?.source).toBe('import-message')
  })

  it('operator attributes the legacy failed-to-load audit list', () => {
    // Given a pre-alpha.2 audit line listing bare row ids
    const trace = 'dsh: plugin(s) failed to load: web-ui-usage, web-ui-pet; Cordis startup failed because these plugin(s) could not be resolved'

    // When the operator attributes the captured tail
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS })

    // Then the first owned id in the list is attributed
    expect(verdict?.rowId).toBe('web-ui-usage')
    expect(verdict?.source).toBe('failed-to-load-list')
  })

  it('operator attributes a legacy activation line via the row name', () => {
    // Given a pre-alpha.2 activation audit line that spells the package name
    const trace = 'dsh: 1 entry did not activate\n@linxin666/dsh-usage: pending (waiting for service: ghost)'

    // When the operator attributes the captured tail with the composed tree names
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS, namesByRowId: NAMES })

    // Then the name resolves back to its row
    expect(verdict?.rowId).toBe('web-ui-usage')
    expect(verdict?.source).toBe('activation-line')
  })

  it('operator attributes an alpha.2 activation line by its row id', () => {
    // Given an alpha.2 audit line spelling `<id> (<name>): failed: <cause>`
    const trace = [
      'dsh: warning: 1 entry did not activate',
      'web-ui-pet (@linxin666/dsh-pet): failed: Cannot find package',
    ].join('\n')

    // When the operator attributes the captured tail
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS, namesByRowId: NAMES })

    // Then the leading row id is attributed
    expect(verdict?.rowId).toBe('web-ui-pet')
    expect(verdict?.source).toBe('activation-line')
  })

  it('operator attributes an alpha.2 activation line by its package name alone', () => {
    // Given an alpha.2 audit line whose id is not a row this profile owns
    const trace = 'dsh: warning: 1 entry did not activate\nweb-ui-something (@linxin666/dsh-usage): pending (waiting for services: ghost)'

    // When the operator attributes the captured tail with the composed tree names
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS, namesByRowId: NAMES })

    // Then the parenthesized package name resolves back to its row
    expect(verdict?.rowId).toBe('web-ui-usage')
    expect(verdict?.source).toBe('activation-line')
  })

  it('operator attributes an alpha.2 startup-report block by its Package line', () => {
    // Given an alpha.2 startup report that names the row and then its package
    const trace = [
      'dsh: startup failed: 1 required plugin did not activate',
      '',
      ' web-ui-usage',
      ' Package: @linxin666/dsh-usage',
      '  real plugin start boom',
    ].join('\n')

    // When the operator attributes the captured tail
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS, namesByRowId: NAMES })

    // Then the Package line attributes the row, and stays as the evidence
    expect(verdict?.rowId).toBe('web-ui-usage')
    expect(verdict?.source).toBe('activation-line')
    expect(verdict?.evidence).toContain('Package: @linxin666/dsh-usage')
  })

  it('operator ignores an alpha.2 report block naming an unowned package', () => {
    // Given an alpha.2 startup report for a package this profile does not own
    const trace = 'dsh: startup failed: 1 required plugin did not activate\n other-row\n Package: @x/other'

    // When the operator attributes the captured tail
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS, namesByRowId: NAMES })

    // Then nothing is attributed
    expect(verdict).toBeUndefined()
  })

  it('operator never attributes an unknown row', () => {
    // Given a boot trace that names only rows this profile does not own
    const trace = 'dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): failed to apply loader entry something-else (@x/y): boom'

    // When the operator attributes the captured tail
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS })

    // Then no attribution is guessed
    expect(verdict).toBeUndefined()
  })

  it('operator returns no attribution for noise without any shape', () => {
    // Given tails that carry no boot-failure shape at all
    // When the operator attributes them
    // Then both stay unattributed
    expect(attributeBootFailure({ stderrTail: 'EACCES: permission denied, open /x\n', rowIds: ROWS })).toBeUndefined()
    expect(attributeBootFailure({ stderrTail: '', rowIds: ROWS })).toBeUndefined()
  })

  it('operator ignores rows this profile does not own', () => {
    // Given a loader wrapper naming an unowned row
    const trace = 'failed to apply loader entry include (cordis:include): failed to apply loader entry other-row (@x): boom'

    // When the operator attributes the captured tail
    const verdict = attributeBootFailure({ stderrTail: trace, rowIds: ROWS })

    // Then the unowned row is refused
    expect(verdict).toBeUndefined()
  })
})
