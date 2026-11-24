import { describe, expect, it } from 'vitest'
import {
  CODE_BLOCK_CLASS,
  DIAGRAM_CLASS,
  FENCE_LAYER_ID,
  FENCE_SLOT_NAME,
  INFOSTRING_CLASS_FRAGMENT,
  LANGUAGE_CLASS_FRAGMENT,
  RENDERED_LANGUAGE,
  RUNTIME_ROUTE,
} from '../src/core/contract.ts'

describe('renderer DOM contract', () => {
  it('operator gets a failing pin when the renderer renames a hook', () => {
    // Given the official markdown renderer (ui-primitives CodeBlock) emits
    // these exact names across both legacy _<local>_<hash> and 0.2.3-alpha.2
    // <hash>_<local> CSS Modules class patterns, and ui-chat exposes the
    // conversation.chat.markdown.fence hoc slot
    // When this package's constants are read
    // Then they still match: a renderer rename must fail here, not silently
    // disable diagrams in production.
    expect(FENCE_SLOT_NAME).toBe('conversation.chat.markdown.fence')
    expect(FENCE_LAYER_ID).toBe('@linxin666/dsh-client-ui-diagrams/fence/mermaid')
    expect(CODE_BLOCK_CLASS).toBe('md-code-block')
    expect(INFOSTRING_CLASS_FRAGMENT).toBe('_infostring')
    expect(LANGUAGE_CLASS_FRAGMENT).toBe('_language')
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
