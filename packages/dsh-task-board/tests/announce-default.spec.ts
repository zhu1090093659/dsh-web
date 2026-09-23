/**
 * Announcement default (issue #839): announceToAgent resolves to false so
 * agent system prompts stay clean unless the user opts in.
 *
 * On the 0.1.7 cohort the three fields the settings card edits are
 * schema-volatile: the Loader hands them to the plugin as stable references it
 * commits in place, and the Host generates this row's settings page from
 * exactly the volatile fields of its Config — so the defaults are read through
 * those references, and the markers themselves are asserted.
 */
import { describe, expect, it } from 'vitest'
import { Config, readConfigField } from '../src/index.ts'

/** The fields the browser settings card edits. */
const CARD_FIELDS = ['enabled', 'announceToAgent', 'preventIdleSleep'] as const

/** Deployment-level fields the profile patch carries instead of the settings page. */
const DEPLOYMENT_FIELDS = ['trustedProxyHosts', 'proxyTokenEnv', 'sessionDefaultPermission'] as const

/**
 * The schema node one Config field declares, as the Host reads it when it
 * decides which fields the settings page may hold and write.
 * @param field - field name inside the Config object schema.
 * @returns the field's schema node, or undefined when the schema has no such field.
 */
function configField(field: string): { meta?: { volatile?: boolean } } | undefined {
  const dict: Record<string, { meta?: { volatile?: boolean } }> = Config.dict ?? {}
  return dict[field]
}

describe('announcement default (issue #839)', () => {
  it('resolves announceToAgent to false by default', () => {
    const value = Config({})
    expect(readConfigField(value.announceToAgent, true)).toBe(false)
    expect(readConfigField(value.enabled, false)).toBe(true)
  })

  it('keeps an explicit true override', () => {
    const value = Config({ announceToAgent: true })
    expect(readConfigField(value.announceToAgent, false)).toBe(true)
  })

  it('admin sees every field the settings card edits served as live-editable', () => {
    // Given the Config schema the Host serves as this profile entry's settings page
    // When the schema node of each card field is read
    // Then every one of them is volatile, which is what a settings write is fenced on
    for (const field of CARD_FIELDS) {
      expect(configField(field)?.meta?.volatile, field).toBe(true)
    }
  })

  it('admin sees the deployment-level fields stay outside the settings page', () => {
    // Given the same schema
    // When the proxy and permission fields are read
    // Then they are ordinary fields: editing one reloads the row instead of being written live
    for (const field of DEPLOYMENT_FIELDS) {
      expect(configField(field)?.meta?.volatile, field).toBeUndefined()
    }
  })
})
