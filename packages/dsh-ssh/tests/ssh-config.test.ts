/**
 * ssh_config reader units: Include expansion order, Match handling, and the
 * block shape the store maps onto a HostPayload.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSshConfigBlocks } from '../src/ssh-config.ts'

const dirs: string[] = []

/** Write a fixture tree and return the path of its top-level config file. */
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-config-'))
  dirs.push(dir)
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text, 'utf8')
  }
  return join(dir, 'config')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('readSshConfigBlocks', () => {
  it('expands Include globs in lexical order and keeps every block', () => {
    const config = fixture({
      config: [
        'Include config.d/*.conf',
        '',
        'Host from-main',
        '    HostName 10.0.0.1',
      ].join('\n'),
      'config.d/20-second.conf': 'Host second\n    HostName 10.0.0.3\n',
      'config.d/10-first.conf': 'Host first\n    HostName 10.0.0.2\n',
    })
    const { blocks, skipped } = readSshConfigBlocks(config)
    expect(skipped).toEqual([])
    expect(blocks.map(block => block.pattern)).toEqual(['first', 'second', 'from-main'])
    expect(blocks[1]?.props['hostname']).toBe('10.0.0.3')
  })

  it('ignores an Include path that matches nothing', () => {
    const config = fixture({
      config: 'Include config.d/*.conf\nInclude /definitely/missing/file\n\nHost only\n    HostName 10.0.0.9\n',
    })
    expect(readSshConfigBlocks(config).blocks.map(block => block.pattern)).toEqual(['only'])
  })

  it('reports Match blocks and ends the block above them', () => {
    const config = fixture({
      config: [
        'Host conditional',
        '    HostName 10.0.0.4',
        'Match host *.internal',
        '    ProxyCommand corp proxy %h %p',
        '',
        'Host plain',
        '    HostName 10.0.0.5',
      ].join('\n'),
    })
    const { blocks, skipped } = readSshConfigBlocks(config)
    expect(skipped).toEqual([{ name: 'Match host *.internal', reason: 'match' }])
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.props['proxycommand']).toBeUndefined()
    expect(blocks[1]?.props['hostname']).toBe('10.0.0.5')
  })

  it('collects case-insensitive keys with the last occurrence winning', () => {
    const config = fixture({
      config: 'Host lower\n    hostname 10.0.0.6\n    USER root\n    User deploy\n',
    })
    const [block] = readSshConfigBlocks(config).blocks
    expect(block?.props['hostname']).toBe('10.0.0.6')
    expect(block?.props['user']).toBe('deploy')
  })

  it('returns nothing for a missing top-level file', () => {
    expect(readSshConfigBlocks(join(tmpdir(), 'dsh-ssh-does-not-exist', 'config')))
      .toEqual({ blocks: [], skipped: [] })
  })
})
