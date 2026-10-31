/**
 * The lan-bind patch block: parse, strip, and the legacy cleanup (issue #1917).
 *
 * Up to 0.4.8 the toggle wrote a managed `- id: webserver` row into the
 * profile's patch file. That row is retired: the plugin never writes a bind any
 * more, and its only remaining file operation is removing the block an older
 * version left behind. The invariants this file pins are the ones the incident
 * was about - the official row keeps its own bind expression byte for byte, the
 * cleanup happens once, and a second run writes nothing at all.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { parseAllDocuments } from 'yaml'
import { LAN_BIND_BLOCK_BEGIN, LAN_BIND_BLOCK_END, lanBindState, managedBindOf, profilePatchFile, removeManagedBlock, stripManagedBlock } from '../src/host/lan-bind.ts'

const tempDirs: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'remote-web-ui-lan-bind-'))
  tempDirs.push(dir)
  return dir
}

/** Single patch list per file, in plain values, the way the harness reads it. */
function parsePatch(content: string): Record<string, unknown>[] {
  const docs = parseAllDocuments(content)
  expect(docs.map(doc => doc.errors.map(error => error.message))).toEqual([[]])
  const roots = docs.map(doc => doc.toJS() as unknown).filter(root => root !== null)
  expect(roots).toHaveLength(1)
  expect(Array.isArray(roots[0])).toBe(true)
  return roots[0] as Record<string, unknown>[]
}

/** The legacy block a previous version wrote, verbatim. */
function legacyBlock(host: string, port: number): string {
  return [
    LAN_BIND_BLOCK_BEGIN,
    '- id: webserver',
    "  name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    `    host: '${host}'`,
    `    port: ${String(port)}`,
    '    compression: gzip',
    '    compressionLevel: 1',
    '    compressionThresholdBytes: 1024',
    LAN_BIND_BLOCK_END,
    '',
  ].join('\n')
}

/** The profile patch every DSH profile carries: the official web server row. */
const OFFICIAL_ROW = [
  '- insert:',
  '    - id: webserver',
  "      name: '@deepseek-ai/dsh-host-webserver'",
  '      config:',
  "        host: !!js ctx.webStartup.host ?? '127.0.0.1'",
  '        port: !!js ctx.webStartup.port ?? 3000',
  '        compression: gzip',
  '',
].join('\n')

/** Write one profile patch and return its path. */
function profileFile(home: string, profile: string, content: string): string {
  const patch = join(home, 'profiles', profile, 'cordis.patch.yml')
  mkdirSync(join(home, 'profiles', profile), { recursive: true })
  writeFileSync(patch, content)
  return patch
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('managedBindOf', () => {
  it('parses the pinned bind out of the block', () => {
    expect(managedBindOf(legacyBlock('0.0.0.0', 3080))).toEqual({ host: '0.0.0.0', port: 3080 })
    expect(managedBindOf(legacyBlock('127.0.0.1', 3191))).toEqual({ host: '127.0.0.1', port: 3191 })
  })

  it('returns undefined without a managed block', () => {
    expect(managedBindOf('- id: other\n  config:\n    host: 0.0.0.0\n')).toBeUndefined()
    expect(managedBindOf('')).toBeUndefined()
  })

  it('surfaces hand-edited values instead of claiming a known state', () => {
    const handEdited = legacyBlock('0.0.0.0', 3080).replace("'0.0.0.0'", "'192.168.1.5'")
    expect(managedBindOf(handEdited)?.host).toBe('192.168.1.5')
  })
})

describe('stripManagedBlock', () => {
  it('removes the block and keeps surrounding content byte-identical', () => {
    const before = '- id: a\n  config:\n    x: 1\n'
    const content = `${before}${LAN_BIND_BLOCK_BEGIN}\n- id: webserver\n  config:\n    host: '0.0.0.0'\n    port: 3080\n${LAN_BIND_BLOCK_END}\n- id: b\n`
    expect(stripManagedBlock(content)).toBe(`${before}- id: b\n`)
  })

  it('leaves content without a block untouched', () => {
    const content = '- id: only\n'
    expect(stripManagedBlock(content)).toBe(content)
  })

  // The plugin manager appends rows through the YAML document API, so
  // they land at the end of the sequence - before a trailing END marker that
  // was written last. Stripping the whole region deleted the user's rows.
  it('operator: every row a YAML writer appended inside the displaced markers survives', () => {
    // Given a patch holding the block plus rows appended after it.
    const content = [
      '- id: before',
      LAN_BIND_BLOCK_BEGIN,
      '- id: webserver',
      "  name: '@deepseek-ai/dsh-host-webserver'",
      '  config:',
      "    host: '0.0.0.0'",
      '    port: 19387',
      '- id: web-ui-remote-web-ui',
      '  config:',
      '    lanBind: true',
      '- id: after',
      LAN_BIND_BLOCK_END,
      '',
    ].join('\n')
    // When the block is stripped.
    const stripped = stripManagedBlock(content)
    // Then only the markers and the managed row are gone.
    expect(stripped).toBe([
      '- id: before',
      '- id: web-ui-remote-web-ui',
      '  config:',
      '    lanBind: true',
      '- id: after',
      '',
    ].join('\n'))
  })

  it('operator: the pinned bind is read from the managed row, not a displaced one', () => {
    // Given a region whose first row belongs to another plugin.
    const content = [
      LAN_BIND_BLOCK_BEGIN,
      '- id: other-plugin',
      '  config:',
      "    host: '10.0.0.9'",
      '    port: 9',
      '- id: webserver',
      "  name: '@deepseek-ai/dsh-host-webserver'",
      '  config:',
      "    host: '0.0.0.0'",
      '    port: 19387',
      LAN_BIND_BLOCK_END,
      '',
    ].join('\n')
    // When the pinned bind is read back.
    // Then the foreign row's host and port are ignored.
    expect(managedBindOf(content)).toEqual({ host: '0.0.0.0', port: 19387 })
  })
})

describe('removeManagedBlock / lanBindState', () => {
  // Issue #1917 (a): the failure the whole change exists for. The official row's
  // bind expression and port must survive the cleanup byte for byte - the legacy
  // block replaced that config wholesale, which ate --host/--port.
  it('operator: the official web server row is byte-identical after the legacy block is removed', () => {
    // Given a profile the old toggle wrote to: the official row plus the block.
    const home = tempHome()
    const patch = profileFile(home, 'web', `${OFFICIAL_ROW}\n${legacyBlock('192.168.1.5', 3080)}`)
    const before = readFileSync(patch, 'utf8')
    expect(before).toContain("host: !!js ctx.webStartup.host ?? '127.0.0.1'")
    // When the plugin removes its block.
    const result = removeManagedBlock('web', home)
    // Then only the block is gone and the official row is untouched.
    const after = readFileSync(patch, 'utf8')
    expect(result).toEqual({ removed: true, host: '192.168.1.5', port: 3080 })
    expect(after).toBe(`${OFFICIAL_ROW}\n`)
    expect(after).toContain(OFFICIAL_ROW)
    expect(after).toContain(`port: !!js ctx.webStartup.port ?? 3000`)
    expect(after).not.toContain(LAN_BIND_BLOCK_BEGIN)
    expect(after).not.toContain('- id: webserver\n  name')
    // The file is still exactly one valid patch document.
    expect(parsePatch(after)).toHaveLength(1)
  })

  // Issue #1917 (b): one removal, then silence. A second boot must not rewrite
  // the file (an equivalent write is what the HMR watcher reacted to).
  it('operator: the legacy block is removed once and a second run changes nothing', () => {
    // Given a profile carrying the block.
    const home = tempHome()
    const patch = profileFile(home, 'web', `${OFFICIAL_ROW}\n${legacyBlock('0.0.0.0', 3080)}`)
    // When the cleanup runs twice.
    const first = removeManagedBlock('web', home)
    const afterFirst = readFileSync(patch, 'utf8')
    const statFirst = statSync(patch).mtimeMs
    const second = removeManagedBlock('web', home)
    // Then the first run reports the removal and the second one writes nothing.
    expect(first.removed).toBe(true)
    expect(second).toEqual({ removed: false, host: undefined, port: undefined })
    expect(readFileSync(patch, 'utf8')).toBe(afterFirst)
    expect(statSync(patch).mtimeMs).toBe(statFirst)
    expect(lanBindState('web', home)).toEqual({ blockPresent: false })
  })

  it('operator: rows a YAML writer displaced inside the markers survive the cleanup', () => {
    // Given a Desktop profile whose remote-control row and model rows were
    // appended through the YAML document API while the block was last.
    const home = tempHome()
    const patch = profileFile(home, 'desktop', [
      '- id: keep-before',
      LAN_BIND_BLOCK_BEGIN,
      '- id: webserver',
      "  name: '@deepseek-ai/dsh-host-webserver'",
      '  config:',
      "    host: '0.0.0.0'",
      '    port: 19387',
      '- id: web-ui-remote-web-ui',
      '  config:',
      "    plugin: '@linxin666/dsh-remote-web-ui'",
      '    lanBind: true',
      '- id: llm-verifier',
      '  config:',
      '    model: gpt-6-sol',
      LAN_BIND_BLOCK_END,
      '',
    ].join('\n'))
    // When the cleanup runs.
    removeManagedBlock('desktop', home)
    // Then every foreign row survives, the managed row and markers are gone,
    // and the toggle's own value is still readable from the patch.
    const content = readFileSync(patch, 'utf8')
    expect(parsePatch(content).map(item => item.id)).toEqual([
      'keep-before',
      'web-ui-remote-web-ui',
      'llm-verifier',
    ])
    expect(content).not.toContain(LAN_BIND_BLOCK_BEGIN)
    expect(managedBindOf(content)).toBeUndefined()
  })

  it('operator: a hand-truncated block is removed without eating the rows after it', () => {
    // Given a BEGIN marker with no END and rows on both sides of it.
    const home = tempHome()
    const patch = profileFile(home, 'web', '- id: keep\n' + `${LAN_BIND_BLOCK_BEGIN}\n- id: webserver\n  config:\n    host: '0.0.0.0'\n- id: keep-after\n`)
    // When the cleanup runs.
    removeManagedBlock('web', home)
    // Then both surrounding rows stay and the orphan is gone.
    const content = readFileSync(patch, 'utf8')
    expect(content).toBe('- id: keep\n- id: keep-after\n')
    expect(content).not.toContain('webserver')
  })

  it('reports a missing file as untouched', () => {
    const home = tempHome()
    expect(lanBindState('web', home)).toEqual({ blockPresent: false })
    expect(removeManagedBlock('web', home)).toEqual({ removed: false, host: undefined, port: undefined })
    expect(existsSync(join(home, 'profiles', 'web', 'cordis.patch.yml'))).toBe(false)
  })

  it('reports a file without the block as untouched', () => {
    const home = tempHome()
    const patch = profileFile(home, 'web', OFFICIAL_ROW)
    expect(removeManagedBlock('web', home).removed).toBe(false)
    expect(readFileSync(patch, 'utf8')).toBe(OFFICIAL_ROW)
  })

  it('refuses profiles that escape the profiles directory', () => {
    const home = tempHome()
    expect(() => removeManagedBlock('../elsewhere', home)).toThrow(/unsafe lan-bind profile/)
    expect(() => removeManagedBlock('a/b', home)).toThrow(/unsafe lan-bind profile/)
    expect(() => removeManagedBlock('..', home)).toThrow(/unsafe lan-bind profile/)
    expect(() => profilePatchFile('../../elsewhere', home)).toThrow(/unsafe lan-bind profile/)
  })

  it.skipIf(process.platform === 'win32')('preserves the original file permissions instead of resetting to umask', () => {
    // Given a profile patch only the owner can read.
    const home = tempHome()
    const patch = join(home, 'profiles', 'web', 'cordis.patch.yml')
    mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
    writeFileSync(patch, `${OFFICIAL_ROW}\n${legacyBlock('0.0.0.0', 3080)}`, { mode: 0o600 })
    // When the cleanup rewrites it.
    removeManagedBlock('web', home)
    // Then the mode is the file's own, not the umask default.
    expect(statSync(patch).mode & 0o777).toBe(0o600)
  })
})
