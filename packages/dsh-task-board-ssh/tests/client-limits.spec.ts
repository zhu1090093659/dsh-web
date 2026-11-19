/**
 * The per-host ceiling the settings section offers, against the ceiling the Host
 * actually enforces.
 *
 * The browser half may not import the host half, so the range is restated on the
 * client side; these cases hold the restatement against the two places the Host
 * states its own bound (the Config schema and the queue's clamp), so the two can
 * never drift into a section that offers a value the Host rejects.
 */
import { describe, expect, it } from 'vitest'
import { HOST_CAP } from '../src/client/ssh/settings-section.tsx'
import { Config } from '../src/index.ts'
import { PER_HOST_CAP_MAX, PER_HOST_CAP_MIN, normalizePerHostCap } from '../src/host/queue.ts'
import { parseSshSettings, readConfigField } from '../src/host/settings.ts'

/** The ceiling the Config schema produced, unwrapped from its volatile field. */
function schemaCap(value: number): number {
  return readConfigField<number>(Config({ perHostCap: value }).perHostCap, 0)
}

describe('the per-host ceiling', () => {
  it('operator reading the settings section sees the same bounds the Host enforces', () => {
    // Given the Host's own bounds and the client's restatement of them
    // When they are compared
    // Then the range is identical rather than merely overlapping
    expect(HOST_CAP.min).toBe(PER_HOST_CAP_MIN)
    expect(HOST_CAP.max).toBe(PER_HOST_CAP_MAX)
  })

  it('operator picking any offered value gets a ceiling the deployment accepts unchanged', () => {
    // Given the values the section lets an operator type
    const offered = [HOST_CAP.min, HOST_CAP.fallback, HOST_CAP.max]

    // When the schema and the queue both read them
    const accepted = offered.map(value => schemaCap(value))
    const clamped = offered.map(value => normalizePerHostCap(value))

    // Then neither layer moves any of them
    expect(accepted).toEqual(offered)
    expect(clamped).toEqual(offered)
  })

  it('operator typing past the ceiling is refused by the schema, not silently narrowed', () => {
    // Given one step above what the section offers
    // When the deployment validates it
    // Then the refusal names the same bound the section uses
    expect(() => schemaCap(HOST_CAP.max + 1)).toThrow(String(PER_HOST_CAP_MAX))
    // And the queue's own clamp lands exactly on it
    expect(parseSshSettings({ perHostCap: HOST_CAP.max + 1 }).perHostCap).toBe(PER_HOST_CAP_MAX)
  })
})
