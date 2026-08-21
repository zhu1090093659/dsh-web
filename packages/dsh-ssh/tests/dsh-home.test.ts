import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveDshHome } from '../src/dsh-home.ts'

describe('resolveDshHome', () => {
  it('uses DSH_HOME when configured', () => {
    const home = join(tmpdir(), 'dsh-home-test')
    const custom = join(home, 'custom-dsh')
    expect(resolveDshHome({ DSH_HOME: custom }, home)).toBe(custom)
  })

  it('expands a leading tilde in DSH_HOME', () => {
    const home = join(tmpdir(), 'dsh-home-test')
    expect(resolveDshHome({ DSH_HOME: '~/custom-dsh' }, home)).toBe(join(home, 'custom-dsh'))
  })

  it('falls back to the legacy ~/.dsh location', () => {
    const home = join(tmpdir(), 'dsh-home-test')
    expect(resolveDshHome({}, home)).toBe(join(home, '.dsh'))
  })
})
