import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  currentActive,
  currentPet,
  DEFAULT_PET,
  MANAGED_END,
  MANAGED_START,
  PETS,
  renderManaged,
  stripManaged,
  usePet,
} from '../src/pet-switch.ts'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'pet-center-test-'))
}

function rmHome(home: string): void {
  rmSync(home, { recursive: true, force: true })
}

/** The managed section as written into a config patch. */
function readManaged(home: string): string {
  const patch = readFileSync(join(home, '.dsh', 'cordis.patch.yml'), 'utf8')
  const start = patch.indexOf(MANAGED_START)
  const end = patch.indexOf(MANAGED_END)
  return patch.slice(start, end + MANAGED_END.length)
}

describe('renderManaged', () => {
  it('disables every pet except the active one', () => {
    const out = renderManaged('pet-maid')
    expect(out).toContain('- id: pet\n  disabled: true')
    expect(out).not.toContain('- id: pet-maid\n  disabled: true')
    const forPet = renderManaged('pet')
    expect(forPet).toContain('- id: pet-maid\n  disabled: true')
    expect(forPet).not.toContain('- id: pet\n  disabled: true')
  })
})

describe('currentActive', () => {
  it('reports the pet the managed section does not disable', () => {
    expect(currentActive(`${MANAGED_START}\n- id: pet\n  disabled: true\n${MANAGED_END}`)).toBe('pet-maid')
    expect(currentActive(`${MANAGED_START}\n- id: pet-maid\n  disabled: true\n${MANAGED_END}`)).toBe('pet')
  })

  it('reports the default when neither is disabled (or the section is absent)', () => {
    expect(currentActive('', DEFAULT_PET)).toBe('pet')
    expect(currentActive(`${MANAGED_START}\n${MANAGED_END}`)).toBe('pet')
  })
})

describe('stripManaged', () => {
  it('removes the managed section, keeping surrounding content', () => {
    const p = `# a comment\n- id: something\n  config: 1\n${MANAGED_START}\n- id: pet\n  disabled: true\n${MANAGED_END}`
    expect(stripManaged(p)).toBe('# a comment\n- id: something\n  config: 1\n')
  })

  it('throws on an unterminated section', () => {
    expect(() => stripManaged(`x\n${MANAGED_START}\n- id: pet`)).toThrow()
  })
})

describe('usePet / currentPet', () => {
  it('writes the managed section so exactly one pet stays enabled', () => {
    const home = tempHome()
    try {
      usePet('pet-maid', { home })
      expect(readManaged(home)).toContain('- id: pet\n  disabled: true')
      expect(currentPet(undefined, { home })).toBe('pet-maid')

      usePet('pet', { home })
      expect(readManaged(home)).toContain('- id: pet-maid\n  disabled: true')
      expect(currentPet(undefined, { home })).toBe('pet')
    } finally {
      rmHome(home)
    }
  })

  it('preserves a pre-existing managed section across a switch', () => {
    const home = tempHome()
    try {
      // Simulate surrounding user content in the same patch. The pet switch
      // must not clobber it.
      mkdirSync(join(home, '.dsh'), { recursive: true })
      writeFileSync(join(home, '.dsh', 'cordis.patch.yml'), '# user comment\n', 'utf8')
      usePet('pet-maid', { home })
      const all = readFileSync(join(home, '.dsh', 'cordis.patch.yml'), 'utf8')
      expect(all).toContain('# user comment')
      expect(readManaged(home)).toContain('- id: pet\n  disabled: true')
    } finally {
      rmHome(home)
    }
  })

  it('rejects an unknown pet', () => {
    const home = tempHome()
    try {
      expect(() => usePet('bogus', { home })).toThrow(/unknown pet/)
    } finally {
      rmHome(home)
    }
  })
})

describe('PETS', () => {
  it('exactly matches the two selectable pets', () => {
    expect(PETS.map(pet => pet.id)).toEqual(['pet', 'pet-maid'])
  })
})
