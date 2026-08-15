/**
 * Package invariants — cheap structural checks run at import time on the
 * host side. Mirrors the pattern used by other dsh plugin packages.
 * @module @linxin666/dsh-client-ui-mermaid/invariant
 */

import { MERMAID_THEMES } from './core/themes.ts'

/** Assert a condition; throws a descriptive Error when violated. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[dsh-mermaid] ${message}`)
  }
}

/** Run every package invariant once; throws on the first violation. */
export function runMermaidInvariants(): void {
  invariant(MERMAID_THEMES.length > 0, 'MERMAID_THEMES must not be empty')
  invariant(new Set(MERMAID_THEMES).size === MERMAID_THEMES.length, 'MERMAID_THEMES must be unique')
  invariant(MERMAID_THEMES[0] === 'auto', 'MERMAID_THEMES must start with auto')
}

// Run once on import (host half only; cheap and side-effect free).
runMermaidInvariants()
