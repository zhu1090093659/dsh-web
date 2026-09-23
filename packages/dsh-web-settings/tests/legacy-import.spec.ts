/**
 * One-shot adoption of the family sections the 0.1.7 settings subsystem leaves
 * orphaned in `settings.yaml.imported`: section names resolve through the same
 * family namespace aliases the bridge serves, the write lands in the entry the
 * Host addresses for that namespace, a field the entry's own user layer
 * already holds is never overwritten, and the marker under the DSH home makes
 * the import one-shot.
 */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SettingsDescriptor, SettingsDescribeOptions, SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { BridgeProfileEntry } from '../src/bridge.ts'
import type { LegacyImportLogger, LegacyImportOutcome, LegacyImportSettings } from '../src/legacy-import.ts'
import {
  LEGACY_IMPORT_MARKER_FILE,
  LEGACY_IMPORT_MARKER_VERSION,
  importLegacyFamilySections,
  legacyImportMarkerPath,
  readLegacyImportMarkerState,
  writeLegacyImportMarker,
} from '../src/legacy-import.ts'

/** One entry of the fake Host settings surface: the fields it accepts and the layers it holds. */
interface FakeEntry {
  /** Profile entry id, the namespace the Host addresses. */
  id: string
  /** Volatile field names the entry's form declares; a patch outside them is refused. */
  fields: string[]
  /** The entry's own user layer (the profile override). */
  user: Record<string, unknown>
  /** Revision the descriptor reports; a write expecting another one is refused. */
  revision: number
}

/** The fake surface and the writes the Host accepted. */
interface FakeHost {
  settings: LegacyImportSettings
  entries: () => BridgeProfileEntry[]
  /** Patches the Host accepted, in write order. */
  accepted: { entryId: string; patch: Record<string, unknown>; revision: number }[]
}

/** Whether a value is a plain data mapping (never an array or a class instance). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Layer a patch over a section the way the Host's own write path does. */
function mergePatch(under: unknown, over: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...isRecord(under) ? under : {} }
  for (const [key, value] of Object.entries(over)) {
    merged[key] = isRecord(value) && isRecord(merged[key]) ? mergePatch(merged[key], value) : value
  }
  return merged
}

/** A Host settings surface that validates a write the way the real one does. */
function fakeHost(roster: BridgeProfileEntry[], entries: FakeEntry[]): FakeHost {
  const accepted: FakeHost['accepted'] = []
  const project = (entry: FakeEntry): SettingsDescriptor => ({
    ns: entry.id as unknown as SettingsNamespace,
    autoGenerate: true,
    schema: { type: 'object', dict: Object.fromEntries(entry.fields.map(field => [field, { type: 'unknown' }])) },
    value: { ...entry.user },
    user: { ...entry.user },
    revision: entry.revision,
    applies: 'live',
  })
  // A redacted read (the wire default) hides the user layer, exactly like the
  // real surface's role('secret') stripping; only an in-process read sees it.
  const describe = (options?: SettingsDescribeOptions): SettingsDescriptor[] =>
    entries.map(entry => options?.redactSecrets === true ? { ...project(entry), value: {}, user: {} } : project(entry))
  return {
    accepted,
    entries: () => roster,
    settings: {
      describe,
      update: async (entryId, patch, expectedRevision) => {
        const entry = entries.find(candidate => candidate.id === entryId)
        if (entry === undefined) throw new Error('No configurable plugin entry "' + entryId + '"')
        if (expectedRevision !== undefined && expectedRevision !== entry.revision) {
          throw new SettingsConflictError(entryId as unknown as SettingsNamespace, expectedRevision, entry.revision)
        }
        const fields = patch as Record<string, unknown>
        for (const field of Object.keys(fields)) {
          if (!entry.fields.includes(field)) throw new Error('Config field "' + field + '" is not volatile')
        }
        entry.user = mergePatch(entry.user, fields)
        entry.revision += 1
        accepted.push({ entryId, patch: fields, revision: entry.revision })
      },
    },
  }
}

/** A logger that keeps what the Host would have printed. */
function fakeLogger(): LegacyImportLogger & { lines: string[] } {
  const lines: string[] = []
  const record = (format: string, ...params: unknown[]): void => {
    lines.push([format, ...params.map(param => String(param))].join(' '))
  }
  return { lines, info: record, warn: record }
}

/** The profile roster of an aggregate install: the row carries the package identity the aliases resolve. */
const AGGREGATE_ROSTER: BridgeProfileEntry[] = [
  { options: { id: 'web-ui-pet', name: '@linxin666/dsh-web-all/pet', config: { plugin: '@linxin666/dsh-pet' } } },
  { options: { id: 'web-ui-usage', name: '@linxin666/dsh-web-all/usage', config: { plugin: '@linxin666/dsh-usage' } } },
  { options: { id: 'web-ui-skin-center', name: '@linxin666/dsh-web-all/skin-center', config: { plugin: '@linxin666/dsh-client-ui-skin-center' } } },
]

/** The Skin Center entry's own Config fields: the three pre-0.1.7 namespaces it folded in. */
const SKIN_CENTER_FIELDS = ['skin-background', 'skin-custom-theme', 'skin-wallpaper']

/** A served Skin Center entry. */
function skinCenter(user: Record<string, unknown> = {}): FakeEntry {
  return { id: 'web-ui-skin-center', fields: [...SKIN_CENTER_FIELDS], user, revision: 5 }
}

/** A marker path inside its own temporary directory. */
function freshMarkerPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsh-legacy-import-')), LEGACY_IMPORT_MARKER_FILE)
}

/** One import run over the given document. */
function runImport(host: FakeHost, markerPath: string, document: string, logger = fakeLogger()): Promise<LegacyImportOutcome> {
  return importLegacyFamilySections({
    settings: host.settings,
    entries: host.entries,
    readSettingsYaml: () => document,
    logger,
    markerPath,
  })
}

describe('legacy family settings import', () => {
  it('user setting values of an orphaned family section reach the entry that serves its namespace', async () => {
    // Given a legacy document whose pet section matches no profile entry id,
    // and a pet entry the Host serves with an empty user layer
    const pet: FakeEntry = { id: 'web-ui-pet', fields: ['visible', 'size'], user: {}, revision: 3 }
    const host = fakeHost(AGGREGATE_ROSTER, [pet])
    const marker = freshMarkerPath()

    // When the import runs
    const outcome = await runImport(host, marker, 'pet:\n  visible: false\n  size: 128\n')

    // Then the section's fields land flat in the pet entry — the entry declares
    // no field of the section's own name, so it takes them at its root — fenced
    // by the revision the Host reported, and the marker records the import
    expect(outcome.imported).toEqual(['pet'])
    expect(host.accepted).toEqual([{ entryId: 'web-ui-pet', patch: { visible: false, size: 128 }, revision: 4 }])
    expect(pet.user).toEqual({ visible: false, size: 128 })
    expect(readLegacyImportMarkerState(marker)).toEqual({
      status: 'recorded',
      marker: {
        version: LEGACY_IMPORT_MARKER_VERSION,
        sections: { pet: { entryId: 'web-ui-pet', path: [], fields: ['visible', 'size'], importedAt: expect.any(String) } },
      },
    })
  })

  it('user edits the entry already holds are never overwritten by the import', async () => {
    // Given a pet entry whose user layer holds one field and one nested key
    const pet: FakeEntry = {
      id: 'web-ui-pet',
      fields: ['visible', 'size', 'window'],
      user: { visible: true, window: { scale: 2 } },
      revision: 1,
    }
    const host = fakeHost(AGGREGATE_ROSTER, [pet])

    // When the import runs over a section carrying values for all three fields
    const outcome = await runImport(host, freshMarkerPath(), 'pet:\n  visible: false\n  size: 96\n  window:\n    scale: 4\n    offset: 5\n')

    // Then only the unheld field and the untouched nested sibling are written,
    // and every path the user holds keeps its value
    expect(outcome.imported).toEqual(['pet'])
    expect(host.accepted).toEqual([{ entryId: 'web-ui-pet', patch: { size: 96, window: { offset: 5 } }, revision: 2 }])
    expect(pet.user).toEqual({ visible: true, size: 96, window: { scale: 2, offset: 5 } })
  })

  it('user settings in a section no family namespace resolves are left alone', async () => {
    // Given a document section owned by the official settings surface
    const host = fakeHost(AGGREGATE_ROSTER, [{ id: 'ui-settings', fields: ['preference'], user: {}, revision: 0 }])

    // When the import runs
    const outcome = await runImport(host, freshMarkerPath(), 'ui-theme:\n  preference: dark\n')

    // Then nothing is written, the section is reported as skipped, and it is
    // not reported as a family section left unserved
    expect(outcome.imported).toEqual([])
    expect(outcome.skipped).toEqual(['ui-theme'])
    expect(outcome.unserved).toEqual([])
    expect(host.accepted).toEqual([])
  })

  it('user settings for an entry the host does not serve are skipped rather than written blind', async () => {
    // Given a profile that serves only the usage row, and a document carrying a
    // pet section whose plugin row is absent
    const usage: FakeEntry = { id: 'web-ui-usage', fields: ['pollIntervalSec'], user: {}, revision: 0 }
    const host = fakeHost([AGGREGATE_ROSTER[1]], [usage])
    const marker = freshMarkerPath()

    // When the import runs over both sections
    const outcome = await runImport(host, marker, 'pet:\n  visible: false\ndsh-usage:\n  pollIntervalSec: 120\n')

    // Then only the served entry is written, the unserved family section is
    // reported as skipped and as unserved, and the marker holds nothing for it
    expect(outcome.imported).toEqual(['dsh-usage'])
    expect(outcome.skipped).toEqual(['pet'])
    expect(outcome.unserved).toEqual(['pet'])
    expect(host.accepted).toEqual([{ entryId: 'web-ui-usage', patch: { pollIntervalSec: 120 }, revision: 1 }])
    expect(readLegacyImportMarkerState(marker)).toEqual({
      status: 'recorded',
      marker: {
        version: LEGACY_IMPORT_MARKER_VERSION,
        sections: { 'dsh-usage': { entryId: 'web-ui-usage', path: [], fields: ['pollIntervalSec'], importedAt: expect.any(String) } },
      },
    })
  })

  it('user clearing a field after the first run keeps the cleared value on a later boot', async () => {
    // Given a pet entry the import already adopted
    const pet: FakeEntry = { id: 'web-ui-pet', fields: ['visible', 'size'], user: {}, revision: 1 }
    const host = fakeHost(AGGREGATE_ROSTER, [pet])
    const marker = freshMarkerPath()
    const document = 'pet:\n  visible: false\n  size: 128\n'
    await runImport(host, marker, document)
    const writesAfterFirstRun = host.accepted.length

    // When the user clears both fields and the next boot imports again
    pet.user = {}
    const outcome = await runImport(host, marker, document)

    // Then the second run writes nothing and reports the section as recorded
    expect(outcome.imported).toEqual([])
    expect(outcome.done).toEqual(['pet'])
    expect(host.accepted.length).toBe(writesAfterFirstRun)
    expect(pet.user).toEqual({})
  })

  it('user sees a refused write stay unrecorded so a later boot retries the section', async () => {
    // Given a served pet entry whose form does not declare one of the fields
    // the legacy section carries
    const pet: FakeEntry = { id: 'web-ui-pet', fields: ['visible'], user: {}, revision: 7 }
    const host = fakeHost(AGGREGATE_ROSTER, [pet])
    const marker = freshMarkerPath()
    const logger = fakeLogger()

    // When the import runs over that section
    const outcome = await runImport(host, marker, 'pet:\n  visible: false\n  legacyOnly: 3\n', logger)

    // Then the Host's refusal is reported, nothing lands, and the marker holds
    // no record of the section
    expect(outcome.imported).toEqual([])
    expect(outcome.refused).toHaveLength(1)
    expect(outcome.refused[0].section).toBe('pet')
    expect(outcome.refused[0].reason).toContain('legacyOnly')
    expect(host.accepted).toEqual([])
    expect(pet.user).toEqual({})
    expect(readLegacyImportMarkerState(marker)).toEqual({ status: 'absent' })
    const refusals = logger.lines.filter(line => line.includes('was not imported into entry'))
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toContain('pet')
    expect(refusals[0]).toContain('web-ui-pet')
  })

  it('user finds the marker document under the DSH home, small and versioned', () => {
    // Given a DSH home the operator points at and the exported path helper
    const home = join(tmpdir(), 'dsh-legacy-import-home')
    const dshHome = join(home, 'dsh-data')
    const env = { DSH_HOME: dshHome } as NodeJS.ProcessEnv
    const marker = legacyImportMarkerPath(env, home)

    // When one run's record is written through the exported writer
    writeLegacyImportMarker(marker, {
      version: LEGACY_IMPORT_MARKER_VERSION,
      sections: { pet: { entryId: 'web-ui-pet', path: [], fields: ['size'], importedAt: '2026-09-22T00:00:00.000Z' } },
    })

    // Then the helper resolves inside that DSH home and the document reads back
    // as a versioned JSON record of the one section
    expect(marker).toBe(join(dshHome, LEGACY_IMPORT_MARKER_FILE))
    expect(readLegacyImportMarkerState(marker)).toEqual({
      status: 'recorded',
      marker: {
        version: LEGACY_IMPORT_MARKER_VERSION,
        sections: { pet: { entryId: 'web-ui-pet', path: [], fields: ['size'], importedAt: '2026-09-22T00:00:00.000Z' } },
      },
    })
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual({
      version: LEGACY_IMPORT_MARKER_VERSION,
      sections: { pet: { entryId: 'web-ui-pet', path: [], fields: ['size'], importedAt: '2026-09-22T00:00:00.000Z' } },
    })
    rmSync(home, { recursive: true, force: true })
  })

  it('user sees an aliased section whose entry declares the same field name land at that field path', async () => {
    // Given a legacy skin-background section, whose namespace the profile
    // serves through the Skin Center entry, and whose name that entry also
    // declares as one of its own Config fields
    const center = skinCenter()
    const host = fakeHost(AGGREGATE_ROSTER, [center])
    const marker = freshMarkerPath()

    // When the import runs over that section
    const outcome = await runImport(host, marker, 'skin-background:\n  image: night-city\n  blur: 6\n')

    // Then the aliased section lands inside that field rather than flat at the
    // entry root, and the marker records the entry id and that path
    expect(outcome.imported).toEqual(['skin-background'])
    expect(host.accepted).toEqual([{
      entryId: 'web-ui-skin-center',
      patch: { 'skin-background': { image: 'night-city', blur: 6 } },
      revision: 6,
    }])
    expect(center.user).toEqual({ 'skin-background': { image: 'night-city', blur: 6 } })
    expect(readLegacyImportMarkerState(marker)).toEqual({
      status: 'recorded',
      marker: {
        version: LEGACY_IMPORT_MARKER_VERSION,
        sections: {
          'skin-background': {
            entryId: 'web-ui-skin-center',
            path: ['skin-background'],
            fields: ['image', 'blur'],
            importedAt: expect.any(String),
          },
        },
      },
    })
  })

  it('user sees a section named after a declared top-level field land at that field path', async () => {
    // Given the Skin Center entry declaring the pre-0.1.7 namespace names as
    // its own Config fields, and a legacy section named after one of them that
    // no alias of the family namespace table serves as an entry
    const center = skinCenter()
    const host = fakeHost(AGGREGATE_ROSTER, [center])
    const marker = freshMarkerPath()

    // When the import runs over that section
    const outcome = await runImport(host, marker, 'skin-custom-theme:\n  applied: true\n  dark:\n    accent: "#7c91ff"\n')

    // Then the section lands as that field's value, and the marker records the
    // entry id together with the field path it wrote
    expect(outcome.imported).toEqual(['skin-custom-theme'])
    expect(host.accepted).toEqual([{
      entryId: 'web-ui-skin-center',
      patch: { 'skin-custom-theme': { applied: true, dark: { accent: '#7c91ff' } } },
      revision: 6,
    }])
    expect(center.user).toEqual({ 'skin-custom-theme': { applied: true, dark: { accent: '#7c91ff' } } })
    expect(readLegacyImportMarkerState(marker)).toEqual({
      status: 'recorded',
      marker: {
        version: LEGACY_IMPORT_MARKER_VERSION,
        sections: {
          'skin-custom-theme': {
            entryId: 'web-ui-skin-center',
            path: ['skin-custom-theme'],
            fields: ['applied', 'dark'],
            importedAt: expect.any(String),
          },
        },
      },
    })
  })

  it('user settings for a section named after a field no served entry declares are skipped', async () => {
    // Given a served roster whose entries declare no such field
    const host = fakeHost(AGGREGATE_ROSTER, [{ id: 'web-ui-usage', fields: ['pollIntervalSec'], user: {}, revision: 0 }])
    const marker = freshMarkerPath()

    // When the import runs over that section
    const outcome = await runImport(host, marker, 'skin-wallpaper:\n  selection: stripes\n')

    // Then nothing is written, the section stays in the document, and it is
    // reported as unserved rather than guessed into some entry
    expect(outcome.imported).toEqual([])
    expect(outcome.skipped).toEqual(['skin-wallpaper'])
    expect(outcome.unserved).toEqual(['skin-wallpaper'])
    expect(outcome.ambiguous).toEqual([])
    expect(host.accepted).toEqual([])
    expect(readLegacyImportMarkerState(marker)).toEqual({ status: 'absent' })
  })

  it('user settings for a field name two served entries declare are skipped instead of written twice', async () => {
    // Given two served entries whose Config both declare the same field name
    const center = skinCenter()
    const pet: FakeEntry = { id: 'web-ui-pet', fields: ['visible', 'skin-wallpaper'], user: {}, revision: 2 }
    const host = fakeHost(AGGREGATE_ROSTER, [center, pet])
    const marker = freshMarkerPath()
    const logger = fakeLogger()

    // When the import runs over that section
    const outcome = await runImport(host, marker, 'skin-wallpaper:\n  selection: stripes\n', logger)

    // Then neither entry is written and the ambiguity is reported
    expect(outcome.imported).toEqual([])
    expect(outcome.skipped).toEqual(['skin-wallpaper'])
    expect(outcome.ambiguous).toEqual(['skin-wallpaper'])
    expect(host.accepted).toEqual([])
    expect(center.user).toEqual({})
    expect(pet.user).toEqual({})
    expect(readLegacyImportMarkerState(marker)).toEqual({ status: 'absent' })
    expect(logger.lines.filter(line => line.includes('more than one served entry'))).toHaveLength(1)
  })

  it('user edits inside a folded-in field survive the section landing beside them', async () => {
    // Given the Skin Center entry whose user layer already holds one key of the
    // field the legacy section carries
    const center = skinCenter({ 'skin-wallpaper': { dim: 30 } })
    const host = fakeHost(AGGREGATE_ROSTER, [center])

    // When the import adopts the legacy skin-wallpaper section
    const outcome = await runImport(host, freshMarkerPath(), 'skin-wallpaper:\n  selection: stripes\n  dim: 55\n')

    // Then the user's nested key keeps its value and the untouched sibling
    // lands, both inside the same field
    expect(outcome.imported).toEqual(['skin-wallpaper'])
    expect(host.accepted).toEqual([{
      entryId: 'web-ui-skin-center',
      patch: { 'skin-wallpaper': { selection: 'stripes' } },
      revision: 6,
    }])
    expect(center.user).toEqual({ 'skin-wallpaper': { dim: 30, selection: 'stripes' } })
  })

  it('user keeps the alias rule when a section name could be claimed by both rules', async () => {
    // Given a pet namespace the profile serves as an entry, and another served
    // entry whose Config happens to declare a field of the same name
    const pet: FakeEntry = { id: 'web-ui-pet', fields: ['visible', 'size'], user: {}, revision: 4 }
    const other: FakeEntry = { id: 'web-ui-usage', fields: ['pollIntervalSec', 'pet'], user: {}, revision: 1 }
    const host = fakeHost(AGGREGATE_ROSTER, [pet, other])

    // When the import runs over the pet section
    const outcome = await runImport(host, freshMarkerPath(), 'pet:\n  visible: false\n  size: 128\n')

    // Then the entry that serves the namespace takes the section's fields at
    // its root, and the entry that merely declares the name is left alone
    expect(outcome.imported).toEqual(['pet'])
    expect(host.accepted).toEqual([{ entryId: 'web-ui-pet', patch: { visible: false, size: 128 }, revision: 5 }])
    expect(pet.user).toEqual({ visible: false, size: 128 })
    expect(other.user).toEqual({})
  })
})
