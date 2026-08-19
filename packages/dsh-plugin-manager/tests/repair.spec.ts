import { describe, expect, it } from 'vitest'
import type { PluginFailureItem } from '../src/core/protocol.ts'
import { conflictRepairMessage, DEFAULT_REPAIR_COPY, failureRepairMessage, installRepairMessage } from '../src/core/repair.ts'

const failure: PluginFailureItem = {
  pluginId: 'pkg', kind: 'load-failure', message: 'boom', stack: 'at x', installPath: '/x/pkg', at: '2026-08-18T00:00:00.000Z',
}

describe('installRepairMessage', () => {
  it('contains the target, the error, and the ask', () => {
    const text = installRepairMessage('@scope/pkg', 'ENOENT: no such file', DEFAULT_REPAIR_COPY)
    expect(text).toContain('@scope/pkg')
    expect(text).toContain('ENOENT: no such file')
    expect(text).toContain(DEFAULT_REPAIR_COPY.installAsk)
    expect(text.startsWith(DEFAULT_REPAIR_COPY.installTitle)).toBe(true)
  })

  it('respects custom copy', () => {
    const text = installRepairMessage('x', 'e', { ...DEFAULT_REPAIR_COPY, installTitle: 'TITLE' })
    expect(text.startsWith('TITLE')).toBe(true)
  })
})

describe('failureRepairMessage', () => {
  it('contains every failure field and the ask', () => {
    const text = failureRepairMessage(failure, DEFAULT_REPAIR_COPY)
    expect(text).toContain('pkg')
    expect(text).toContain('加载失败')
    expect(text).toContain('boom')
    expect(text).toContain('at x')
    expect(text).toContain('/x/pkg')
    expect(text).toContain('2026-08-18T00:00:00.000Z')
    expect(text).toContain(DEFAULT_REPAIR_COPY.failureAsk)
  })

  it('omits empty stack and path sections, and renders an unattributable plugin as -', () => {
    const text = failureRepairMessage({ ...failure, pluginId: '', stack: '', installPath: '' }, DEFAULT_REPAIR_COPY)
    expect(text).toContain('插件: -')
    expect(text).not.toContain('堆栈')
    expect(text).not.toContain('安装路径')
  })

  it('never appends credential-shaped content beyond the failure fields', () => {
    const text = failureRepairMessage(failure, DEFAULT_REPAIR_COPY)
    expect(text).not.toMatch(/token|secret|password|authorization|Bearer|sk-[A-Za-z0-9]/i)
    const installText = installRepairMessage('@scope/pkg', 'boom', DEFAULT_REPAIR_COPY)
    expect(installText).not.toMatch(/token|secret|password|authorization|Bearer|sk-[A-Za-z0-9]/i)
  })
})

describe('conflictRepairMessage', () => {
  it('names the entry and its state change', () => {
    const text = conflictRepairMessage({ id: 'ui-x', name: 'x', from: 'enabled', to: 'disabled' }, DEFAULT_REPAIR_COPY)
    expect(text).toContain('x (ui-x)')
    expect(text).toContain('已开启 -> 已关闭')
    expect(text).toContain(DEFAULT_REPAIR_COPY.conflictAsk)
  })

  it('never appends credential-shaped content', () => {
    const text = conflictRepairMessage({ id: 'a', name: 'a', from: 'uninstalled', to: 'enabled' }, DEFAULT_REPAIR_COPY)
    expect(text).not.toMatch(/token|secret|password|authorization|Bearer|sk-[A-Za-z0-9]/i)
  })
})
