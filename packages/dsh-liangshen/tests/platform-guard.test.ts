/**
 * Platform-gate guard (issue #283): agent.cordis.yml must pair the win32 gate
 * polarities exactly — the persistent-shell PTY group disabled on win32, the
 * custom-bash replacement disabled everywhere else — so any platform ends up
 * with exactly one tool named `bash` (a double registration would fail the
 * whole preset mount). Static checks on the committed preset file.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const preset = readFileSync(join(process.cwd(), 'presets/liangshen/agent.cordis.yml'), 'utf8')

describe('win32 bash platform gate', () => {
  it('disables the persistent-shell PTY group on win32', () => {
    const group = preset.match(/- id: persistent-shell\n(?:[^\n]*\n)*?\s+disabled: ([^\n]*)/)
    expect(group).not.toBeNull()
    expect(group?.[1]).toContain("process.platform === 'win32'")
  })

  it('enables the custom-bash replacement everywhere except win32', () => {
    expect(preset).toContain('- id: custom-bash')
    const entry = preset.match(/- id: custom-bash\n  name: \.\/custom-bash\.mjs\n(  [^\n]*\n)*?\s+disabled: ([^\n]*)/)
    expect(entry).not.toBeNull()
    expect(entry?.[2]).toContain("process.platform !== 'win32'")
  })

  it('keeps exactly one bash-named tool per platform', () => {
    // The persistent shell registers `bash` via dsh-tool-bash-persistent on
    // non-win32; custom-bash registers `bash` on win32. No third bash row
    // may appear.
    const bashRows = preset.match(/"bash"/g)
    expect(bashRows?.length ?? 0).toBeLessThanOrEqual(3)
    expect(preset.match(/name: \.\/custom-bash\.mjs/g)?.length).toBe(1)
    expect(preset).toContain("name: '@deepseek-ai/dsh-tool-bash-persistent'")
  })

  it('ships the custom-bash implementation', () => {
    const impl = readFileSync(join(process.cwd(), 'presets/liangshen/custom-bash.mjs'), 'utf8')
    expect(impl).toContain("export const name = 'custom-bash'")
    expect(impl).toContain("name: 'bash'")
  })
})
