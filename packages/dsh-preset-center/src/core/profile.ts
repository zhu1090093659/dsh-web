/**
 * What a preset's composition will actually load, read from the installed
 * bytes on the host — never from the market catalog, which a client could
 * restate.
 *
 * The profile answers three questions the install confirmation needs: which
 * plugins the composition names, which of those are files that travel inside
 * the preset directory, and whether the file carries inline `!!js`
 * expressions. All three are execution surfaces: a relative row and an inline
 * expression both run inside the host process once the preset is declared to
 * the registry, exactly like an npm plugin does.
 *
 * The scan is deliberately shallow (line-oriented) and is a display signal,
 * not a sandbox: what the registry actually mounts comes from the parsed
 * definition (`core/definition.ts`), and the health verdict from the registry
 * roster after the declaration. A preset that hides a row from this scan is
 * still gated by the downloaded-but-undeclared state and the operator's
 * confirmation.
 * @module @linxin666/dsh-client-ui-preset-center/core/profile
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { COMPOSITION_FILE } from './paths.ts'
import { listFiles } from './provenance.ts'

/** The strongest execution surface a preset carries. */
export type CodeExecution = 'none' | 'inline' | 'local'

/** One preset's composition profile. */
export interface CompositionProfile {
  /** npm package names the composition names (resolved against the harness). */
  plugins: string[]
  /** Rows naming a relative module inside the preset directory. */
  relativeNames: string[]
  /** Count of inline `!!js` expressions. */
  inlineExpressions: number
  /** Code files shipped inside the preset directory. */
  codeFiles: string[]
  /** Strongest execution surface: local code beats inline expressions. */
  codeExecution: CodeExecution
  /** Rows the scan counted (display only). */
  rows: number
}

const CODE_FILE_RE = /\.(?:mjs|cjs|js)$/

/** Unquote a YAML scalar the shallow way (the profile is not a parser). */
function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** Profile one composition document. */
export function profileComposition(text: string, codeFiles: readonly string[]): CompositionProfile {
  const plugins: string[] = []
  const relativeNames: string[] = []
  let inlineExpressions = 0
  let rows = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '')
    if (line.includes('!!js')) inlineExpressions += 1
    const match = /^\s*-?\s*name:\s*(.+?)\s*$/.exec(line)
    if (match === null) continue
    rows += 1
    const name = unquote(match[1])
    if (name === '' || name === 'cordis:group') continue
    if (name.startsWith('.')) relativeNames.push(name)
    else plugins.push(name)
  }
  const localCode = codeFiles.filter((rel) => CODE_FILE_RE.test(rel))
  const codeExecution: CodeExecution = localCode.length > 0 || relativeNames.length > 0
    ? 'local'
    : inlineExpressions > 0 ? 'inline' : 'none'
  return {
    plugins: [...new Set(plugins)],
    relativeNames: [...new Set(relativeNames)],
    inlineExpressions,
    codeFiles: localCode,
    codeExecution,
    rows,
  }
}

/** Profile one installed preset directory; an unreadable composition yields an empty profile. */
export function profilePresetDir(dir: string): CompositionProfile {
  let text = ''
  try {
    text = readFileSync(join(dir, COMPOSITION_FILE), 'utf8')
  } catch {
    text = ''
  }
  return profileComposition(text, listFiles(dir))
}

/** Whether enabling this profile needs an explicit confirmation from the operator. */
export function needsConfirmation(profile: CompositionProfile): boolean {
  return profile.codeExecution !== 'none'
}
