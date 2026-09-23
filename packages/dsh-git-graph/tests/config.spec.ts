/**
 * The plugin-config contract with the 0.1.7 settings subsystem: the Host
 * generates this row's settings page from the Config schema and commits an
 * edit into the runtime's live references instead of remounting the row.
 * These tests pin both halves of that contract, because a field that stops
 * being volatile silently leaves the settings page and drops every write.
 */
import { describe, expect, it } from 'vitest'
import type { Volatile } from '@deepseek-ai/cordis'
import { Config, effectiveConfig } from '../src/host/config.ts'

/** The shared reference protocol the Loader's `updateVolatile` writes through. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** Commit a value into a live reference the way the settings subsystem does. */
function commit<T>(reference: Volatile<T>, value: T): void {
  (reference as unknown as Record<symbol, (next: T) => void>)[VOLATILE_WRITE](value)
}

describe('plugin config schema', () => {
  it('operator keeps all three gates editable because every field is volatile', () => {
    // Given the schema the Host projects the settings page from
    // When its fields are inspected
    // Then every gate declares itself volatile, the marker that keeps it in
    // the generated form and admits a live write
    const fields = Object.entries(Config.dict ?? {})
      .map(([name, field]) => [name, field.meta.volatile])
    expect(fields).toEqual([
      ['autoIsolate', true],
      ['autoBaseline', true],
      ['agentTool', true],
    ])
  })
})

describe('effectiveConfig', () => {
  it('operator runs with both gates off and the current-HEAD baseline before any edit', () => {
    // Given a row the Host resolved without profile values
    // When the effective config is read
    // Then the documented defaults stand
    expect(effectiveConfig(Config({}))).toEqual({
      autoIsolate: false,
      autoBaseline: 'current',
      agentTool: false,
    })
  })

  it('operator turns a gate on and the runtime reports it without a remount', () => {
    // Given a resolved row config whose fields are live references
    const config = Config({})

    // When the settings subsystem commits the operator's edit into the reference
    commit(config.agentTool, true)

    // Then the same config object reports the new value on the next read
    expect(effectiveConfig(config).agentTool).toBe(true)
  })

  it('operator edits the baseline and every later read sees the newer value', () => {
    // Given a resolved row config already edited once
    const config = Config({})
    commit(config.autoBaseline, 'default')

    // When the same field is edited again
    commit(config.autoBaseline, 'current')

    // Then the later value wins, not the first committed one
    expect(effectiveConfig(config).autoBaseline).toBe('current')
  })
})
