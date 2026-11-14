/**
 * Plugin configuration: what a profile row may supply and what happens when
 * it supplies something the shell's budgets cannot honor.
 */
import { describe, expect, it } from 'vitest'
import {
  CONFIG_DEFAULTS,
  DEFAULT_ENABLE_RUN_IN_BACKGROUND,
  DEFAULT_REPLACE_PWSH,
  DEFAULT_TIMEOUT_MS,
  TIMEOUT_MAX_MS,
  TIMEOUT_MIN_MS,
  resolveConfig,
  validateConfig,
} from '../src/config.ts'

describe('configuration resolution', () => {
  it('operator mounting the row with no config block gets every default', () => {
    // Given a profile row that supplies no config,
    // When the config is resolved,
    const config = resolveConfig(undefined)
    // Then the tool runs with the documented defaults.
    expect(config).toEqual(CONFIG_DEFAULTS)
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('operator overriding one field gets that field and the defaults for the rest', () => {
    // Given a row that sets only the stdout budget,
    // When the config is resolved,
    const config = resolveConfig({ maxStdoutBytes: 4096 })
    // Then the override lands and every other field keeps its default.
    expect(config.maxStdoutBytes).toBe(4096)
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    expect(config.description).toBe(CONFIG_DEFAULTS.description)
  })

  it('operator supplying a description gets it used as the model-facing text', () => {
    // Given a row that replaces the tool description,
    // When the config is resolved,
    const config = resolveConfig({ description: 'Run this project shell command.' })
    // Then the replacement is what the tool advertises.
    expect(config.description).toBe('Run this project shell command.')
  })

  it('operator mounting the shipped default gets the host pwsh replacement on', () => {
    // Given a profile row that supplies no config,
    const config = resolveConfig(undefined)
    // When the config is resolved,
    // Then replacement ships ON: a session with two shells and no stated
    // preference is the state this key exists to remove.
    expect(config.replacePwsh).toBe(DEFAULT_REPLACE_PWSH)
    expect(config.replacePwsh).toBe(true)
  })

  it('operator turning the replacement off gets the two shells listed side by side', () => {
    // Given a row that opts out of replacing the host shell,
    // When the config is resolved,
    const config = resolveConfig({ replacePwsh: false })
    // Then the opt-out survives resolution while the defaults hold elsewhere.
    expect(config.replacePwsh).toBe(false)
  })

  it('operator mounting the shipped default gets the background capability on', () => {
    // Given a profile row that supplies no config,
    const config = resolveConfig(undefined)
    // When the config is resolved,
    // Then the capability ships ON, matching the host's own bash tool; whether
    // it is actually advertised still depends on a composed job registry.
    expect(config.enableRunInBackground).toBe(DEFAULT_ENABLE_RUN_IN_BACKGROUND)
    expect(config.enableRunInBackground).toBe(true)
  })

  it('operator turning the background capability off gets that value through to the running config', () => {
    // Given a row that opts out of background execution,
    const config = resolveConfig({ enableRunInBackground: false })
    // When the config is resolved,
    // Then the opt-out survives while every other field keeps its default.
    expect(config.enableRunInBackground).toBe(false)
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('operator supplying the retired sync switch gets it ignored', () => {
    // Given a profile row that still carries the retired availability key,
    // When the config is resolved,
    const config = resolveConfig({ syncWithLiangShen: false } as never)
    // Then the stray key is not a rejection, and every real field keeps its default.
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    expect(config.replacePwsh).toBe(DEFAULT_REPLACE_PWSH)
  })
})

describe('configuration rejection', () => {
  it('operator supplying a timeout below the floor gets a rejection naming the field and the range', () => {
    // Given a row whose timeout is below the accepted minimum,
    let message = ''
    // When the config is resolved,
    try {
      resolveConfig({ timeoutMs: TIMEOUT_MIN_MS - 1 })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    // Then the rejection names the field and states the accepted range.
    expect(message).toContain('timeoutMs')
    expect(message).toContain(TIMEOUT_MIN_MS.toString())
    expect(message).toContain(TIMEOUT_MAX_MS.toString())
  })

  it('operator supplying a fractional budget gets a rejection, because a NaN budget truncates everything', () => {
    // Given a row whose stdout budget is not a whole number,
    let message = ''
    // When the config is resolved,
    try {
      resolveConfig({ maxStdoutBytes: 1024.5 })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    // Then the violation names the offending field.
    expect(message).toContain('maxStdoutBytes')
  })

  it('operator supplying an empty description gets a rejection', () => {
    // Given a row whose description is blank,
    const violations = validateConfig({ ...CONFIG_DEFAULTS, description: '   ' })
    // When the config is validated,
    // Then the description field is the one rejected.
    expect(violations).toEqual([{ field: 'description', message: 'must be a non-empty string' }])
  })

  it('operator supplying an out-of-range value for every bounded field gets one violation each', () => {
    // Given a config whose three numeric fields are all outside their ranges,
    const violations = validateConfig({
      ...CONFIG_DEFAULTS,
      timeoutMs: 0,
      maxStdoutBytes: Number.MAX_SAFE_INTEGER,
      maxStderrBytes: -1,
    })
    // When the config is validated,
    // Then each offending field is reported separately.
    expect(violations.map(v => v.field)).toEqual(['timeoutMs', 'maxStdoutBytes', 'maxStderrBytes'])
  })

  it('operator supplying a non-boolean replacement switch gets a rejection naming the field', () => {
    // Given a row whose pwsh replacement switch is not a boolean,
    // When the config is validated,
    const violations = validateConfig({ ...CONFIG_DEFAULTS, replacePwsh: 'no' as unknown as boolean })
    // Then the offending field is named, so an operator can fix the row.
    expect(violations).toEqual([{ field: 'replacePwsh', message: 'must be a boolean' }])
  })

  it('operator supplying a non-boolean background switch gets a rejection naming the field', () => {
    // Given a row whose background switch is not a boolean,
    // When the config is validated,
    const violations = validateConfig({ ...CONFIG_DEFAULTS, enableRunInBackground: 'yes' as unknown as boolean })
    // Then the offending field is named, so an operator can fix the row.
    expect(violations).toEqual([{ field: 'enableRunInBackground', message: 'must be a boolean' }])
  })

  it('operator supplying a valid maximum gets acceptance rather than an off-by-one rejection', () => {
    // Given a config sitting exactly on each upper bound,
    const violations = validateConfig({
      ...CONFIG_DEFAULTS,
      timeoutMs: TIMEOUT_MAX_MS,
      maxStdoutBytes: 1024 * 1024,
      maxStderrBytes: 512 * 1024,
    })
    // When it is validated,
    // Then the bounds are inclusive.
    expect(violations).toEqual([])
  })
})
