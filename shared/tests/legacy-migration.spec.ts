import { describe, expect, it } from 'vitest'
import {
  CURRENT_AGGREGATE,
  LEGACY_AGGREGATE,
  isLegacyAggregate,
  legacyMigrationFor,
  targetSpecForLegacy,
} from '../host/legacy-migration.ts'

describe('legacy aggregate migration registry', () => {
  it('maps only the known legacy aggregate', () => {
    expect(legacyMigrationFor(LEGACY_AGGREGATE)).toMatchObject({ from: LEGACY_AGGREGATE, to: CURRENT_AGGREGATE })
    expect(legacyMigrationFor('dsh-other')).toBeUndefined()
    expect(isLegacyAggregate(LEGACY_AGGREGATE)).toBe(true)
    expect(isLegacyAggregate(CURRENT_AGGREGATE)).toBe(false)
  })

  it('rewrites local repository links to the new package directory', () => {
    expect(targetSpecForLegacy('link:/home/zcl/code/dsh-web-ui/packages/dsh-web-ui-all', '0.3.3'))
      .toBe('link:/home/zcl/code/dsh-web-ui/packages/dsh-web-all')
    expect(targetSpecForLegacy('file:/home/zcl/code/dsh-web-ui/packages/dsh-web-ui-all', '0.3.3'))
      .toBe('file:/home/zcl/code/dsh-web-ui/packages/dsh-web-all')
    expect(targetSpecForLegacy('link:../dsh-web-ui-all', '0.3.3'))
      .toBe('link:../dsh-web-all')
    expect(targetSpecForLegacy('link:./packages/dsh-web-ui-all', '0.3.3'))
      .toBe('link:./packages/dsh-web-all')
  })

  it('pins registry migrations to the family version', () => {
    expect(targetSpecForLegacy('0.3.2', '0.3.3')).toBe(`${CURRENT_AGGREGATE}@0.3.3`)
    expect(targetSpecForLegacy('^0.3.2', '0.3.3')).toBe(`${CURRENT_AGGREGATE}@0.3.3`)
    expect(targetSpecForLegacy('link:/tmp/unrelated', '0.3.3')).toBeUndefined()
  })
})
