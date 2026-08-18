/**
 * SKILL.md frontmatter lightweight parsing and rewriting (zero dependency).
 *
 * Ported from the local plugin family's shared implementation; the official
 * dsh-skill-filesystem provider parses frontmatter with its own stack, so
 * this module keeps a stable export surface for unit tests to lock behavior.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'

/** Parse a YAML boolean (true/false/yes/no/on/off/1/0, case-insensitive); undefined when not boolean. */
export function parseYamlBool(value: unknown): boolean | undefined {
  const text = String(value).toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(text)) return true
  if (['false', 'no', 'off', '0'].includes(text)) return false
  return undefined
}

/** Strip single or double quotes around a scalar value. */
function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

/** Parsed frontmatter fields consumed by the skill center. */
export interface Frontmatter {
  name?: string
  description?: string
  whenToUse?: string
  hint?: string
  recordInput?: boolean
  disableModelInvocation?: boolean
  userInvocable?: boolean
}

/**
 * Parse scalar fields from the leading frontmatter block (lightweight, zero
 * dependency). Supports name/description/whenToUse (including | / > block
 * scalars), the input nested block (hint / recordInput) and the
 * disable-model-invocation / user-invocable booleans.
 * @param content - raw SKILL.md content.
 * @returns parsed fields (empty object when no frontmatter).
 */
export function parseFrontmatter(content: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (match === null) return {}
  const out: Frontmatter = {}
  const lines = match[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(lines[i])
    if (kv === null) continue
    const key = kv[1]
    const rest = kv[2].trim()
    // Nested block: indented sub-items under "input:" (hint / recordInput).
    if (key === 'input' && rest === '') {
      const nested: { hint?: string; recordInput?: boolean } = {}
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j]
        const sub = /^\s+([a-zA-Z][\w-]*):\s*(.*)$/.exec(line)
        if (sub === null) {
          if (line.trim() === '') continue
          break
        }
        const subKey = sub[1]
        const subValue = sub[2].trim()
        if (subKey === 'hint') nested.hint = unquote(subValue)
        else if (subKey === 'recordInput') nested.recordInput = parseYamlBool(subValue)
      }
      if (nested.hint !== undefined) out.hint = nested.hint
      if (nested.recordInput !== undefined) out.recordInput = nested.recordInput
      continue
    }
    if (rest === '') continue
    // Block scalar (| / > with fold/keep modifiers): collect indented
    // continuation lines and fold them into one line.
    if (/^[|>][-+]?$/.test(rest)) {
      const collected: string[] = []
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j]
        if (line === '' || /^\s/.test(line)) collected.push(line.trim())
        else break
      }
      const text = collected.join(' ').trim()
      if (key === 'name') out.name = text || undefined
      else if (key === 'description') out.description = text || undefined
      else if (key === 'whenToUse') out.whenToUse = text || undefined
      continue
    }
    if (key === 'name') out.name = unquote(rest)
    else if (key === 'description') out.description = unquote(rest)
    else if (key === 'whenToUse') out.whenToUse = unquote(rest)
    else if (key === 'disable-model-invocation') out.disableModelInvocation = parseYamlBool(rest)
    else if (key === 'user-invocable') out.userInvocable = parseYamlBool(rest)
    else if (key === 'recordInput') out.recordInput = parseYamlBool(rest)
  }
  return out
}

/**
 * Rewrite one boolean frontmatter field (appends when absent), atomically.
 * Preserves every other line and the body verbatim.
 * @param file - absolute SKILL.md path.
 * @param field - frontmatter field name (e.g. disable-model-invocation).
 * @param value - target boolean value.
 * @returns the parsed frontmatter of the rewritten content.
 */
export function setFrontmatterField(file: string, field: string, value: boolean): Frontmatter {
  const content = readFileSync(file, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/.exec(content)
  if (match === null) throw new Error(`setFrontmatterField: ${file} has no frontmatter`)
  const blockLines = match[1].split(/\r?\n/)
  const linePattern = new RegExp(`^${field}:`)
  let replaced = false
  const next = blockLines.map((line) => {
    if (linePattern.test(line)) {
      replaced = true
      return `${field}: ${value}`
    }
    return line
  })
  if (!replaced) next.push(`${field}: ${value}`)
  const rewritten = `---\n${next.join('\n')}\n---${match[2]}`
  // Atomic write: tmp file + rename, so a watcher never reads a half-written
  // state. The tmp name is unpredictable and created with O_EXCL ('wx'), so a
  // planted symlink at a guessable name can never redirect the write.
  const tmp = `${file}.${Date.now().toString(36)}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, rewritten, { encoding: 'utf8', flag: 'wx' })
    renameSync(tmp, file)
  } catch (error) {
    // Best-effort cleanup of a half-written tmp file; the original file is untouched.
    try {
      unlinkSync(tmp)
    } catch {
      // ignore
    }
    throw error
  }
  return parseFrontmatter(rewritten)
}
