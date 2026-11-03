import { describe, expect, it } from 'vitest'
import { PLATFORM_MODULES } from '../web-platform.ts'

/**
 * Mirrors the shell's frozen module table (dsh-web-frontend staticModules,
 * verified against the 0.2.2-alpha.3 cohort dist bundle). The 0.1.2 shell
 * removed the dsh-client-runtime row (package deleted upstream) and added
 * dsh-client-store as the replacement static module; 0.1.5-rc.1 added
 * dsh-client-ui-dockkit, and 0.2.1-rc.2 adds zod plus
 * @tanstack/react-virtual.
 */
const TARGET_SHELL_STATIC_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

describe('platform seed mirrors the shell frozen module table', () => {
  it('contains exactly the target shell static modules', () => {
    expect([...PLATFORM_MODULES].sort()).toEqual([...TARGET_SHELL_STATIC_MODULES].sort())
  })

  it('keeps modules removed from the static table excluded', () => {
    expect(PLATFORM_MODULES).not.toContain('@deepseek-ai/dsh-client-runtime')
    expect(PLATFORM_MODULES).not.toContain('@deepseek-ai/dsh-client-web-react')
    expect(PLATFORM_MODULES).not.toContain('@deepseek-ai/dsh-client-schema-form')
  })
})
