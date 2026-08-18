import { describe, expect, it } from 'vitest'

import { compatibilityIntent } from './compatibility-intent.ts'

describe('legacy animation compatibility Intent', () => {
  it('keeps legacy work and failure states renderer-neutral', () => {
    expect(compatibilityIntent('running-right')).toMatchObject({
      id: 'compatibility:running-right',
      motion: 'working',
      expression: 'focused',
      playback: 'loop',
    })
    expect(compatibilityIntent('failed')).toMatchObject({
      motion: 'failure',
      expression: 'worried',
      playback: 'once',
    })
  })

  it('uses the semantic key supplied by the bridge instead of transport timing', () => {
    expect(compatibilityIntent('waiting', 'activity:stable').id).toBe('compatibility:activity:stable')
  })
})
