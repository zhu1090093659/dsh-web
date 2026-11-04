import { describe, expect, it } from 'vitest'
import {
  CODE_BLOCK_CLASS,
  DIAGRAM_CLASS,
  INFOSTRING_CLASS_FRAGMENT,
  RENDERED_LANGUAGE,
  RUNTIME_ROUTE,
} from '../src/core/contract.ts'

describe('renderer DOM contract', () => {
  it('operator gets a failing pin when the renderer renames a hook', () => {
    // Given the official markdown renderer (ui-primitives CodeBlock at
    // 0.2.2-rc.1) emits these exact names
    // When this package's constants are read
    // Then they still match: a renderer rename must fail here, not silently
    // disable diagrams in production.
    expect(CODE_BLOCK_CLASS).toBe('md-code-block')
    expect(INFOSTRING_CLASS_FRAGMENT).toBe('_infostring_')
    expect(RENDERED_LANGUAGE).toBe('mermaid')
    expect(DIAGRAM_CLASS).toBe('dsh-diagrams-figure')
  })

  it('operator sees the vendor route stay on this package namespace', () => {
    // Given the route the browser half injects a script from
    // When its shape is read
    // Then it is this package's Api namespace and an absolute path
    expect(RUNTIME_ROUTE.startsWith('/api/dsh-diagrams/')).toBe(true)
    expect(RUNTIME_ROUTE.endsWith('.js')).toBe(true)
  })
})
