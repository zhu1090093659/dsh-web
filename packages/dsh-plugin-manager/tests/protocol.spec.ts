import { describe, expect, it } from 'vitest'
import {
  parseFailuresSnapshot,
  parseInstallStatus,
  parseInstalledPlugin,
  parsePluginControlSnapshot,
  parsePluginList,
  parseUpdateList,
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

describe('parseInstalledPlugin', () => {
  it('parses a valid plugin wrapper', () => {
    expect(parseInstalledPlugin({ plugin: pluginRow })).toEqual(pluginRow)
  })

  it('rejects a missing plugin row', () => {
    expect(() => parseInstalledPlugin({})).toThrow(/plugin row/)
  })
})

describe('parsePluginControlSnapshot', () => {
  it('parses valid controls', () => {
    const controls = parsePluginControlSnapshot({
      controls: [
        { id: 'web-ui', name: 'dsh-web', repository: 'https://github.com/zhu1090093659/dsh-web', state: 'enabled' },
        { id: 'genui', name: 'dsh-genui', repository: 'https://github.com/omdsh-dev/dsh-genui', state: 'mixed' },
      ],
    })
    expect(controls).toHaveLength(2)
    expect(controls[0].state).toBe('enabled')
  })

  it('rejects an unknown state', () => {
    expect(() => parsePluginControlSnapshot({ controls: [{ id: 'a', name: 'a', repository: 'r', state: 'on' }] })).toThrow(/control row 0/)
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
