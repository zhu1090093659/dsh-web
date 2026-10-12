/**
 * The panel's provider-skill switch store (#1854): where it lives, what a
 * toggle writes, that repeating one is idempotent, that the state survives a
 * restart, and that a damaged document degrades instead of taking the panel
 * down.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deserializeProviderToggles,
  providerSkillIdentity,
  providerToggleFile,
  readProviderToggles,
  setProviderSkillEnabled,
} from '../src/provider-toggles.ts'

const HOMES: string[] = []

/** One scratch DSH home per case, removed after the case. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'skill-explorer-toggles-'))
  HOMES.push(home)
  return home
}

/** Write a store document as an earlier run (or a hand edit) would leave it. */
function seedStore(home: string, raw: string): void {
  const file = providerToggleFile(home)
  mkdirSync(join(home, 'dsh-skill-explorer'), { recursive: true })
  writeFileSync(file, raw, 'utf8')
}

afterEach(() => {
  for (const home of HOMES.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('the provider-skill switch store (#1854)', () => {
  it('user switching off a plugin-provided skill finds one record written under the DSH home', async () => {
    // Given a DSH home where no switch was ever used
    const home = tempHome()
    const identity = { name: 'computer-use', provider: 'orca' }

    // When the panel records the switch
    const doc = await setProviderSkillEnabled(home, identity, false)

    // Then exactly that identity is recorded
    expect(doc).toEqual({ version: 1, disabled: [identity] })
    // And it is on disk, not only in the response, so a restart keeps it
    expect(JSON.parse(readFileSync(providerToggleFile(home), 'utf8'))).toEqual({ version: 1, disabled: [identity] })
    expect(await readProviderToggles(home)).toEqual({ version: 1, disabled: [identity] })
  })

  it('user switching the same skill off twice keeps a single record', async () => {
    // Given a skill the panel already recorded as switched off
    const home = tempHome()
    const identity = { name: 'computer-use', provider: 'orca' }
    await setProviderSkillEnabled(home, identity, false)
    const before = readFileSync(providerToggleFile(home), 'utf8')

    // When the same switch is recorded again (a double click, a retried request)
    const doc = await setProviderSkillEnabled(home, identity, false)

    // Then the record is not duplicated and the document is left byte-identical
    expect(doc.disabled).toEqual([identity])
    expect(readFileSync(providerToggleFile(home), 'utf8')).toBe(before)
  })

  it('user switching one skill back on keeps the other one switched off', async () => {
    // Given two plugin-provided skills, both switched off
    const home = tempHome()
    const kept = { name: 'computer-use', provider: 'orca' }
    const restored = { name: 'screen-reader', provider: 'orca' }
    await setProviderSkillEnabled(home, kept, false)
    await setProviderSkillEnabled(home, restored, false)

    // When the user switches one of them back on
    const doc = await setProviderSkillEnabled(home, restored, true)

    // Then only the record it targeted is gone
    expect(doc.disabled).toEqual([kept])
    expect(await readProviderToggles(home)).toEqual({ version: 1, disabled: [kept] })
  })

  it('user returning after a restart still sees the skill it switched off', async () => {
    // Given a store file left on disk by an earlier run of the host
    const home = tempHome()
    seedStore(home, JSON.stringify({ version: 1, disabled: [{ name: 'computer-use', provider: 'orca' }] }))

    // When the panel reads its switches back after the restart
    const doc = await readProviderToggles(home)

    // Then the stored switch is still honored
    expect(doc.disabled).toEqual([{ name: 'computer-use', provider: 'orca' }])
  })

  it('user enabling a skill that was never switched off leaves the document absent', async () => {
    // Given a DSH home that never had a store written
    const home = tempHome()

    // When the panel records an enable for a skill it holds no record of
    const doc = await setProviderSkillEnabled(home, { name: 'computer-use', provider: 'orca' }, true)

    // Then nothing is created and the panel reads the state it already had
    expect(doc.disabled).toEqual([])
    expect(await readProviderToggles(home)).toEqual({ version: 1, disabled: [] })
  })

  it('user whose store file is damaged sees every plugin-provided skill as enabled', async () => {
    // Given a store file truncated by an interrupted write
    const home = tempHome()
    seedStore(home, '{"version":1,"disabled":[{"name":"compu')

    // When the panel reads it
    const doc = await readProviderToggles(home)

    // Then the panel degrades to "nothing switched off" instead of failing
    expect(doc).toEqual({ version: 1, disabled: [] })
  })

  it('user whose store carries a foreign document shape sees it as empty', async () => {
    // Given a document written by a future or unrelated version
    const home = tempHome()
    seedStore(home, JSON.stringify({ version: 2, disabled: [{ name: 'computer-use', provider: 'orca' }] }))

    // When the panel reads it
    const doc = deserializeProviderToggles(JSON.stringify({ version: 2, disabled: [{ name: 'computer-use', provider: 'orca' }] }))

    // Then no record is trusted, so no row silently changes its state
    expect(doc).toEqual({ version: 1, disabled: [] })
  })

  it('user whose store lists a record no row could match sees it dropped', async () => {
    // Given a hand-edited document mixing a valid record with a duplicate, a
    // name the official skill grammar rejects, and a record missing the
    // provider field this writer always emits
    const raw = JSON.stringify({
      version: 1,
      disabled: [
        { name: 'computer-use', provider: 'orca' },
        { name: 'computer-use', provider: 'orca' },
        { name: 'Not_A_Skill', provider: 'orca' },
        { name: 'screen-reader' },
        { name: 'screen-reader', provider: '' },
      ],
    })

    // When the panel reads it
    const doc = deserializeProviderToggles(raw)

    // Then only the two addressable, distinct records survive
    expect(doc.disabled).toEqual([
      { name: 'computer-use', provider: 'orca' },
      { name: 'screen-reader', provider: '' },
    ])
  })

  it('user whose store carries more records than the store keeps is capped', async () => {
    // Given a document with far more records than any panel can hold
    const disabled = Array.from({ length: 600 }, (_, index) => ({ name: `skill-${index}`, provider: 'orca' }))

    // When the panel reads it
    const doc = deserializeProviderToggles(JSON.stringify({ version: 1, disabled }))

    // Then reading is bounded instead of trusting the file's size
    expect(doc.disabled).toHaveLength(512)
    expect(doc.disabled[0]).toEqual({ name: 'skill-0', provider: 'orca' })
  })

  it('user submitting a skill identity outside the official grammar gets no record', async () => {
    // Given candidate identities typed into the switch request
    const grammarFailures = ['Not_A_Skill', 'trailing-', '', 'UPPER']
    const oversizedProvider = providerSkillIdentity('computer-use', 'p'.repeat(201))

    // When the panel normalizes them
    const accepted = providerSkillIdentity('computer-use', ' orca ')

    // Then only a well-formed pair becomes a record, and the provider is trimmed
    for (const name of grammarFailures) expect(providerSkillIdentity(name, 'orca')).toBeUndefined()
    expect(oversizedProvider).toBeUndefined()
    expect(accepted).toEqual({ name: 'computer-use', provider: 'orca' })
  })

  it('user storing a switch keeps it inside the plugin own home directory', () => {
    // Given a DSH home
    const home = tempHome()

    // When the panel resolves where its store lives
    const file = providerToggleFile(home)

    // Then it is the plugin's own file there, never a skill directory
    expect(file).toBe(join(home, 'dsh-skill-explorer', 'provider-toggles.json'))
  })
})
