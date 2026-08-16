/**
 * SKILL.md frontmatter parsing and enable/disable patching.
 *
 * The DSH filesystem skill provider reads `disable-model-invocation` and
 * `user-invocable` from the YAML frontmatter of a skill file. Toggling a
 * skill therefore means patching those two keys in place; the provider's
 * watcher invalidates the catalog and the next agent pre-step republishes
 * the model-facing catalog, so the change applies without a restart.
 *
 * Patching uses the `yaml` package's document API (the same parser the
 * provider uses) so untouched keys, comments, and formatting survive.
 * @module @linxin666/dsh-skill-manager/frontmatter
 */

import { parseDocument } from 'yaml'
import { isSkillName } from '@deepseek-ai/dsh-skill'

/** Invocation controls parsed out of one skill file. */
export interface SkillInvocation {
  /** Whether the model-facing catalog and skill tool may include the skill. */
  modelInvocable: boolean
  /** Whether the user-facing slash (`/name`) surface may include the skill. */
  userInvocable: boolean
}

/** The subset of a parsed skill file the manager acts on. */
export interface SkillFrontmatter {
  /** Kebab-case skill identifier. */
  name: string
  /** Short routing description. */
  description: string
  /** Optional extra routing guidance. */
  whenToUse?: string
  /** Resolved invocation controls. */
  invocation: SkillInvocation
}

/** One split of a skill file into its YAML frontmatter block and body. */
export interface SkillFileParts {
  /** The frontmatter block text, without the surrounding `---` lines. */
  frontmatter: string
  /** The body text after the closing `---` line. */
  body: string
}

/** The delimiter line that opens and closes a skill frontmatter block. */
const FRONTMATTER_DELIMITER = '---'

/**
 * Split a skill file into frontmatter and body, mirroring the provider's
 * parser: the first line must be `---`, and the block ends at the next
 * line that is exactly `---`.
 * @param text - the raw skill file text.
 * @returns the frontmatter block and body, or undefined when the file has no
 *   parseable frontmatter.
 */
export function splitSkillFile(text: string): SkillFileParts | undefined {
  const firstLineEnd = text.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = text.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== FRONTMATTER_DELIMITER) return undefined
  const start = firstLineEnd + 1
  let lineStart = start
  while (lineStart <= text.length) {
    const nextNewline = text.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? text.length : nextNewline
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === FRONTMATTER_DELIMITER) {
      return {
        frontmatter: text.slice(start, lineStart),
        body: nextNewline < 0 ? '' : text.slice(nextNewline + 1),
      }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

/**
 * Parse and validate a skill file's frontmatter with the provider's contract:
 * a YAML object carrying a non-empty `name` (kebab-case), a non-empty
 * `description`, and optional `whenToUse`, `disable-model-invocation`,
 * `user-invocable`, and `metadata` fields.
 * @param text - the raw skill file text.
 * @returns the validated frontmatter, or undefined when the file is not a
 *   valid skill file.
 */
export function parseSkillText(text: string): SkillFrontmatter | undefined {
  const parts = splitSkillFile(text)
  if (parts === undefined) return undefined
  const doc = parseDocument(parts.frontmatter)
  if (doc.errors.length > 0) return undefined
  const data = doc.toJS() as unknown
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const record = data as Record<string, unknown>
  const name = stringField(record, 'name')
  const description = stringField(record, 'description')
  if (name === undefined || description === undefined) return undefined
  if (!isSkillName(name)) return undefined
  const whenToUse = optionalString(record, 'whenToUse')
  const invocation = parseInvocation(record)
  return {
    name,
    description,
    ...whenToUse === undefined ? {} : { whenToUse },
    invocation,
  }
}

/**
 * Patch a skill file's frontmatter to enable or disable it. Disabling sets
 * `disable-model-invocation: true` and `user-invocable: false`; enabling
 * deletes both keys so the defaults (both surfaces available) apply again.
 * @param text - the raw skill file text.
 * @param enabled - whether the skill should be enabled.
 * @returns the patched file text, or undefined when the file has no
 *   parseable frontmatter.
 */
export function setSkillEnabled(text: string, enabled: boolean): string | undefined {
  const parts = splitSkillFile(text)
  if (parts === undefined) return undefined
  const doc = parseDocument(parts.frontmatter)
  if (doc.errors.length > 0) return undefined
  if (enabled) {
    doc.deleteIn(['disable-model-invocation'])
    doc.deleteIn(['user-invocable'])
  } else {
    doc.setIn(['disable-model-invocation'], true)
    doc.setIn(['user-invocable'], false)
  }
  const patched = doc.toString().replace(/\n$/, '')
  const body = parts.body
  const separator = body === '' ? '' : (body.startsWith('\n') ? '' : '\n')
  const ending = body === '' ? (text.endsWith('\n') ? '\n' : '') : (body.endsWith('\n') ? '' : '')
  return FRONTMATTER_DELIMITER + '\n' + patched + '\n' + FRONTMATTER_DELIMITER + separator + body + ending
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function parseInvocation(data: Record<string, unknown>): SkillInvocation {
  const disableModel = booleanField(data, 'disable-model-invocation')
  const userInvocable = booleanField(data, 'user-invocable')
  return {
    modelInvocable: disableModel !== true,
    userInvocable: userInvocable !== false,
  }
}

function booleanField(data: Record<string, unknown>, key: string): boolean | undefined {
  const value = data[key]
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
    }
  }
  return undefined
}