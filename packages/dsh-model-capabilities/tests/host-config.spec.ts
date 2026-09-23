/**
 * Host half's settings contract: the plugin's Config IS its settings entry on
 * 0.1.7, so the archive field must resolve, keep stashed profiles verbatim,
 * and carry the volatile flag that makes the Host serve it as a writable form
 * (a schema with no volatile field is served to no one). The browser half also
 * resolves its own entry by the serialized schema shape, so the schema it is
 * served with must resolve back to exactly the archive field.
 */

import { describe, expect, it } from 'vitest'
import { resolveArchiveEntry } from '../src/core/provider-toggle.ts'
import { Config } from '../src/index.ts'

/** The field names the Host projects into this plugin's served settings form. */
function servedFields(): string[] {
  return Object.entries(Config.dict ?? {})
    .filter(([, schema]) => schema.meta.volatile === true)
    .map(([name]) => name)
}

describe('model-capabilities host config', () => {
  it('operator gets an empty archive from a fresh config entry', () => {
    // Given a profile row that carries no config at all
    const resolved = Config({})

    // When the Host resolves the entry's config
    const archive = resolved.disabled?.get()

    // Then the archive is empty and is the only field the settings form serves
    expect(archive).toEqual({})
    expect(servedFields()).toEqual(['disabled'])
  })

  it('operator keeps a stashed provider profile verbatim', () => {
    // Given an archived profile carrying fields this plugin never reads
    const stash = { acme: { profile: { apiKeyEnv: 'ACME_KEY', custom: { a: 1 } }, displayName: 'ACME' } }

    // When the Host resolves the entry's config
    const archive = Config({ disabled: stash }).disabled?.get()

    // Then every field survives, so enabling can restore the profile as stored
    expect(archive).toEqual(stash)
  })

  it('operator edits the archive through the field the settings surface serves', () => {
    // Given the plugin config schema the Host projects for this entry
    // When the settings surface collects the entry's editable fields
    // Then the served form is exactly the archive field, declared volatile
    expect(servedFields()).toEqual(['disabled'])
    expect(Config.dict?.disabled.meta.volatile).toBe(true)
  })

  it('operator resolves this entry back from the serialized form schema', () => {
    // Given the serialized schema envelope the browser half is served with
    const served = { ns: 'my-caps', schema: Config.toJSON() }

    // When the browser half resolves its own settings entry among the served forms
    // Then it finds this entry, even under a row id it does not know
    expect(resolveArchiveEntry([{ ns: 'llm-pi-ai', schema: {} }, served])).toEqual({ entryId: 'my-caps', view: served })
  })
})
