import { describe, expect, it } from 'vitest'
import {
  parseFailuresSnapshot,
  parseInstallStatus,
  parseInstalledPlugin,
  parsePluginList,
  parseRestartRequired,
  parseUpdateList,
  parseUpdateOutcomes,
  batchUpdateResult,
} from '../src/core/protocol.ts'

const pluginRow = {
  id: '@scope/pkg',
  name: 'pkg',
  version: '1.2.3',
  source: { kind: 'npm', spec: '@scope/pkg' },
  installedAt: '2026-08-18T00:00:00.000Z',
  enabled: true,
}

describe('parsePluginList', () => {
  it('parses a valid plugins array', () => {
    const items = parsePluginList({ plugins: [pluginRow, { ...pluginRow, id: 'b', source: { kind: 'git', spec: 'https://github.com/a/b', }, commit: 'abc123' }] })
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual(pluginRow)
    expect(items[1].source).toEqual({ kind: 'git', spec: 'https://github.com/a/b' })
    expect(items[1].commit).toBe('abc123')
  })

  it('rejects a non-record or missing plugins array', () => {
    expect(() => parsePluginList(null)).toThrow(/plugins array/)
    expect(() => parsePluginList({ plugins: 'no' })).toThrow(/plugins array/)
  })

  it('rejects an invalid row and names its index', () => {
    expect(() => parsePluginList({ plugins: [pluginRow, { id: 42 }] })).toThrow(/row 1/)
  })
})

  it('parses aggregate children rows with locked flags', () => {
    const row = {
      ...pluginRow,
      children: [
        { id: 'web-ui-pet', name: '@linxin666/dsh-pet', enabled: false },
        { id: 'web-ui-plugin-manager', name: '@linxin666/dsh-client-ui-plugin-manager', enabled: true, locked: true },
      ],
    }
    const [item] = parsePluginList({ plugins: [row] })
    expect(item.children).toEqual([
      { id: 'web-ui-pet', name: '@linxin666/dsh-pet', enabled: false },
      { id: 'web-ui-plugin-manager', name: '@linxin666/dsh-client-ui-plugin-manager', enabled: true, locked: true },
    ])
  })

  it('rejects malformed children with row and child indexes', () => {
    expect(() => parsePluginList({ plugins: [{ ...pluginRow, children: 'no' }] })).toThrow(/children/)
    expect(() => parsePluginList({ plugins: [{ ...pluginRow, children: [{ id: 42 }] }] })).toThrow(/row 0 child 0/)
  })

  it('parses a row without children exactly as before', () => {
    const [item] = parsePluginList({ plugins: [pluginRow] })
    expect(item.children).toBeUndefined()
  })


describe('parseRestartRequired', () => {
  it('user keeps the restart fact the host lists and loses nothing when it cannot be read', () => {
    // Given the values a gateway job can carry for the restart-required list
    // When each one is read
    // Then names are kept and an unusable value degrades to "no restart needed",
    // because the update already landed and this is only its hint
    expect(parseRestartRequired(['dsh-memoir', 'dsh-pet'])).toEqual(['dsh-memoir', 'dsh-pet'])
    expect(parseRestartRequired(['dsh-memoir', '', 42])).toEqual(['dsh-memoir'])
    expect(parseRestartRequired(undefined)).toEqual([])
    expect(parseRestartRequired('dsh-memoir')).toEqual([])
  })
})

describe('parseInstalledPlugin', () => {
  it('parses a valid plugin wrapper', () => {
    expect(parseInstalledPlugin({ plugin: pluginRow })).toEqual(pluginRow)
  })

  it('rejects a missing plugin row', () => {
    expect(() => parseInstalledPlugin({})).toThrow(/plugin row/)
  })
})

describe('parseInstallStatus', () => {
  it('parses a valid progress', () => {
    expect(parseInstallStatus({ progress: { kind: 'install', stage: 'download', percent: 42 } }))
      .toEqual({ kind: 'install', stage: 'download', percent: 42 })
  })

  it('rejects a bad stage', () => {
    expect(() => parseInstallStatus({ progress: { kind: 'install', stage: 'boom' } })).toThrow(/progress state/)
  })

  it('rejects a non-finite percent', () => {
    expect(() => parseInstallStatus({ progress: { kind: 'install', stage: 'download', percent: Number.NaN } })).toThrow(/progress state/)
    expect(() => parseInstallStatus({ progress: { kind: 'install', stage: 'download', percent: Number.POSITIVE_INFINITY } })).toThrow(/progress state/)
  })
})

describe('parseUpdateList', () => {
  it('parses valid updates', () => {
    expect(parseUpdateList({ updates: [{ id: 'a', current: '1.0.0', latest: '1.1.0' }] }))
      .toEqual([{ id: 'a', current: '1.0.0', latest: '1.1.0' }])
  })

  it('parses a legacy migration row', () => {
    expect(parseUpdateList({ updates: [{
      id: '@linxin666/dsh-web-ui-all', current: '0.3.2', latest: '0.3.3',
      kind: 'migrate', target: '@linxin666/dsh-web-all', targetVersion: '0.3.3',
    }] }))
      .toEqual([{
        id: '@linxin666/dsh-web-ui-all', current: '0.3.2', latest: '0.3.3',
        kind: 'migrate', target: '@linxin666/dsh-web-all', targetVersion: '0.3.3',
      }])
  })

  it('rejects a migration row without target metadata', () => {
    expect(() => parseUpdateList({ updates: [{
      id: 'a', current: '1', latest: '2', kind: 'migrate', target: 'b',
    }] })).toThrow(/update row 0/)
  })

  it('parses optional DSH compatibility fields', () => {
    expect(parseUpdateList({ updates: [{ id: 'a', current: '1.0.0', latest: '1.1.0', requiresDsh: '>=0.1.0-rc.8', compatible: false }] }))
      .toEqual([{ id: 'a', current: '1.0.0', latest: '1.1.0', requiresDsh: '>=0.1.0-rc.8', compatible: false }])
  })

  it('rejects a bad row', () => {
    expect(() => parseUpdateList({ updates: [{ id: 'a' }] })).toThrow(/update row 0/)
  })

  it('rejects a malformed compatibility field', () => {
    expect(() => parseUpdateList({ updates: [{ id: 'a', current: '1.0.0', latest: '1.1.0', compatible: 'no' }] })).toThrow(/update row 0/)
    expect(() => parseUpdateList({ updates: [{ id: 'a', current: '1.0.0', latest: '1.1.0', requiresDsh: 7 }] })).toThrow(/update row 0/)
  })
})

describe('parseFailuresSnapshot', () => {
  it('parses a valid snapshot', () => {
    const snapshot = parseFailuresSnapshot({
      items: [{
        pluginId: 'pkg', kind: 'load-failure', message: 'boom', stack: 'at x', installPath: '/x/pkg', at: '2026-08-18T00:00:00.000Z',
      }],
      pluginRoot: '/x', safeMode: false,
    })
    expect(snapshot.items[0].kind).toBe('load-failure')
    expect(snapshot.pluginRoot).toBe('/x')
  })

  it('rejects a snapshot missing the root or safeMode', () => {
    expect(() => parseFailuresSnapshot({ items: [] })).toThrow(/failures snapshot/)
  })

  it('rejects a bad failure row', () => {
    expect(() => parseFailuresSnapshot({ items: [{ pluginId: 1 }], pluginRoot: '/', safeMode: false })).toThrow(/failure row 0/)
  })
})

describe('parseUpdateOutcomes', () => {
  it('operator: keeps every usable batch row and drops only the unusable ones', () => {
    // Given a job whose rows mix the usable shapes with rows no renderer can place
    const reported = [
      { id: 'dsh-usage', phase: 'done', landed: '0.9.2', targetVersion: '0.9.2' },
      { id: 'dsh-weather', phase: 'error', error: 'pnpm refused it', targetVersion: '1.1.0' },
      { id: 'dsh-pending', phase: 'pending' },
      { id: 42, phase: 'done' },
      { id: 'dsh-unknown-phase', phase: 'applied' },
      null,
    ]

    // When the job's rows are read through the parser
    const rows = parseUpdateOutcomes(reported)

    // Then the usable rows survive in order and the unusable ones are dropped
    expect(rows.map(row => row.id)).toEqual(['dsh-usage', 'dsh-weather', 'dsh-pending'])
    expect(rows[0]).toEqual({ id: 'dsh-usage', phase: 'done', landed: '0.9.2', targetVersion: '0.9.2' })
    expect(rows[1]?.error).toBe('pnpm refused it')
  })

  it('operator: reads an unreadable results value as no rows instead of rejecting the update', () => {
    // Given a job value that carries no readable row list
    // When each of those values is read
    // Then none of them yields a row, so the caller shows a run without verdicts
    expect(parseUpdateOutcomes(undefined)).toEqual([])
    expect(parseUpdateOutcomes('rows')).toEqual([])
    expect(parseUpdateOutcomes({})).toEqual([])
  })

  it('operator: splits a finished run by outcome, leaving an in-flight row out of both halves', () => {
    // Given a finished run whose last row is still marked in flight
    // When the run is split by outcome
    const result = batchUpdateResult([
      { id: 'dsh-usage', phase: 'done', landed: '0.9.2' },
      { id: 'dsh-weather', phase: 'error', error: 'refused' },
      { id: 'dsh-running', phase: 'running' },
    ])

    // Then each row is in exactly the half its outcome names
    expect(result.applied.map(row => row.id)).toEqual(['dsh-usage'])
    expect(result.failed.map(row => row.id)).toEqual(['dsh-weather'])
  })
})
