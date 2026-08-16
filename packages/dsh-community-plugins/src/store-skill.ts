/** Load the Store skill shipped as a package asset. */

import { readFileSync } from 'node:fs'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

const SKILL_URL = new URL('../skills/search-dsh-store/SKILL.md', import.meta.url)
const INTEGRATION_URL = new URL('../skills/search-dsh-store/references/dsh-web-ui.md', import.meta.url)
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/

function frontmatterValue(frontmatter: string, key: string): string {
  const prefix = `${key}:`
  const line = frontmatter.split(/\r?\n/).find(entry => entry.startsWith(prefix))
  if (line === undefined) throw new Error(`Bundled Store skill is missing ${key}`)
  const value = line.slice(prefix.length).trim()
  if (value.length === 0) throw new Error(`Bundled Store skill has an empty ${key}`)
  return value
}

export function parseBundledStoreSkill(markdown: string, integration = ''): SkillRegistration {
  const match = FRONTMATTER.exec(markdown)
  if (match === null) throw new Error('Bundled Store skill has invalid frontmatter')
  return {
    name: frontmatterValue(match[1], 'name'),
    description: frontmatterValue(match[1], 'description'),
    source: 'bundled',
    content: [match[2].trim(), integration.trim()].filter(Boolean).join('\n\n'),
  }
}

export function loadBundledStoreSkill(): SkillRegistration {
  return parseBundledStoreSkill(readFileSync(SKILL_URL, 'utf8'), readFileSync(INTEGRATION_URL, 'utf8'))
}
