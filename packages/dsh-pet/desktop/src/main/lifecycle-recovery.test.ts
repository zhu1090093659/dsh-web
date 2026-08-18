import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { installDesktopRecoveryEvents } from './lifecycle-recovery.ts'

describe('desktop lifecycle recovery events', () => {
  it('reconnects after wake, handles only GPU loss, and disposes every listener', () => {
    const app = new EventEmitter()
    const power = new EventEmitter()
    const onResume = vi.fn()
    const onGpuProcessGone = vi.fn()
    const dispose = installDesktopRecoveryEvents(app, power, { onResume, onGpuProcessGone })

    power.emit('resume')
    app.emit('child-process-gone', {}, { type: 'Utility' })
    app.emit('child-process-gone', {}, { type: 'GPU' })
    expect(onResume).toHaveBeenCalledOnce()
    expect(onGpuProcessGone).toHaveBeenCalledOnce()

    dispose()
    power.emit('resume')
    app.emit('child-process-gone', {}, { type: 'GPU' })
    expect(onResume).toHaveBeenCalledOnce()
    expect(onGpuProcessGone).toHaveBeenCalledOnce()
    expect(app.listenerCount('child-process-gone')).toBe(0)
    expect(power.listenerCount('resume')).toBe(0)
  })
})
