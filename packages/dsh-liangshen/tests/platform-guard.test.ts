/**
 * Platform-gate guard (issue #283): the shipped preset must mount exactly ONE
 * shell tool on every host, with platform gates whose polarities pair exactly —
 * the bash stack (terminal-bash + persistent-bash) disabled on win32, its pwsh
 * twin (terminal-pwsh + persistent-pwsh) disabled on POSIX — so a platform
 * never double-registers a shell (a second `bash`/`pwsh` registration fails
 * the whole preset mount) and never ends up without one.
 *
 * The gates are evaluated here as the loader evaluates them: `!!js` expressions
 * are executed against a stubbed `process.platform`, so the assertions are
 * about what each platform actually MOUNTS, not about the text that encodes it.
 * Static checks on the committed preset file.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const preset = readFileSync(join(process.cwd(), 'presets/liangshen/agent.cordis.yml'), 'utf8')

/** Evaluate one `!!js` gate expression for a given platform. */
function gateFor(expression: string, platform: string): boolean {
  const source = expression.trim()
  return Boolean(Function('process', `return (${source})`)({ platform }))
}

/**
 * Every preset row as `{ id, name, disabled }` plus the group nesting: the
 * shell rows all live inside `persistent-shell`, so the group's own gate
 * (none) and its children's gates are what decide the mount.
 */
interface Row {
  id: string
  name: string
  disabled?: string
  indent: number
}

function rows(): Row[] {
  const found: Row[] = []
  const lines = preset.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)- id: (\S+)\s*$/.exec(lines[index])
    if (match === null) continue
    const indent = match[1].length
    const row: Row = { id: match[2], name: '', indent }
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      // A nested `- id:` row (a group's children) belongs to itself, not to
      // the row being scanned: stop before absorbing its keys.
      if (/^\s*- id: /.test(line)) break
      if (line.trim() !== '' && !line.startsWith(' '.repeat(indent + 1))) break
      const name = /^\s+name: (\S+)\s*$/.exec(line)
      if (row.name === '' && name !== null) row.name = name[1].replace(/^['"]|['"]$/g, '')
      const disabled = /^\s+disabled: (.*)$/.exec(line)
      if (disabled !== null) row.disabled = disabled[1].trim()
    }
    found.push(row)
  }
  return found
}

/** Whether a row mounts on `platform`, honouring its own `!!js` gate. */
function mountsOn(row: Row, platform: string): boolean {
  if (row.disabled === undefined) return true
  if (!row.disabled.startsWith('!!js ')) return row.disabled !== 'true'
  return !gateFor(row.disabled.slice('!!js '.length), platform)
}

/** The shell rows that actually mount on one platform. */
function mountedShellRows(platform: string): Row[] {
  return rows().filter(row => mountsOn(row, platform))
}

const BASH_ROWS = ['tool-bash']
const PWSH_ROWS = ['tool-pwsh']

describe('per-platform shell mount', () => {
  it('mounts the bash tool on POSIX and the pwsh tool on win32', () => {
    for (const platform of ['linux', 'darwin']) {
      const mounted = mountedShellRows(platform).map(row => row.id)
      for (const id of BASH_ROWS) expect(mounted, `${platform} mounts ${id}`).toContain(id)
      for (const id of PWSH_ROWS) expect(mounted, `${platform} omits ${id}`).not.toContain(id)
    }
    const windows = mountedShellRows('win32').map(row => row.id)
    for (const id of PWSH_ROWS) expect(windows, `win32 mounts ${id}`).toContain(id)
    for (const id of BASH_ROWS) expect(windows, `win32 omits ${id}`).not.toContain(id)
  })

  it('pairs each gate polarity exactly, so no platform can double-mount a shell', () => {
    const byId = new Map(rows().map(row => [row.id, row]))
    for (const id of BASH_ROWS) {
      expect(byId.get(id)?.disabled, id).toContain("process.platform === 'win32'")
    }
    for (const id of PWSH_ROWS) {
      expect(byId.get(id)?.disabled, id).toContain("process.platform !== 'win32'")
    }
  })

  it('keeps exactly one shell TOOL name per platform', () => {
    const bashTool = rows().find(row => row.id === 'tool-bash')
    const pwshTool = rows().find(row => row.id === 'tool-pwsh')
    expect(bashTool?.name).toBe('@deepseek-ai/dsh-tool-bash')
    expect(pwshTool?.name).toBe('@deepseek-ai/dsh-tool-pwsh')
    for (const platform of ['linux', 'darwin', 'win32']) {
      const tools = [bashTool, pwshTool].filter(row => row !== undefined && mountsOn(row, platform))
      expect(tools, `${platform} shell tool count`).toHaveLength(1)
    }
  })

  it('mounts upstream tool-bash and tool-pwsh rows', () => {
    const bash = rows().find(row => row.id === 'tool-bash')
    const pwsh = rows().find(row => row.id === 'tool-pwsh')
    expect(bash?.name).toBe('@deepseek-ai/dsh-tool-bash')
    expect(pwsh?.name).toBe('@deepseek-ai/dsh-tool-pwsh')
  })
})

describe('retired custom-bash surface', () => {
  it('has no custom-bash row or plugin reference left', () => {
    expect(preset).not.toContain('custom-bash')
    expect(preset).not.toContain('./custom-bash.mjs')
    expect(preset).not.toMatch(/custom-bash/i)
  })

  it('does not resurrect an ephemeral win32 bash through another row', () => {
    // The retired tool was an ordinary subprocess `bash -c`; the preset must
    // not name any preset-local .mjs shell in its place.
    expect(preset).not.toMatch(/name: \.\/[a-z-]*(bash|shell)[a-z-]*\.mjs/)
  })
})
