/**
 * Host-half configuration contract: rescue mode is on by default so a fresh
 * install or a Web UI version update boots protected, while an explicit off
 * choice in the user section stays off. The settings provider resolves a
 * namespace by calling its schemastery schema over the merged
 * base + user section, so this spec asserts that callable resolution.
 */
import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

describe('doctor host config defaults', () => {
  it('enables rescue mode by default', () => {
    expect(Config({})).toMatchObject({ enabled: true, fullProtection: true, autoRepair: false, autoMigrate: true })
  })

  it('preserves an explicit off choice', () => {
    expect(Config({ enabled: false })).toMatchObject({ enabled: false })
  })
})
