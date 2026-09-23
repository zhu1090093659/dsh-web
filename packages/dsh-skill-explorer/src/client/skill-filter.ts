/**
 * Skill center list filtering (pure, browser half): the search box and the
 * workspace picker are two axes over the same grouped payload, so the
 * matching rules live here and stay unit-testable without a DOM.
 */

import type { GroupPayload, SkillEntry } from './api.ts'

/** The list tab's filter state. */
export interface SkillListFilter {
  /** Selected workspace root, or 'all' for no workspace restriction. */
  workspace: string
  /** Raw search text; trimmed and lowercased before matching. */
  query: string
}

/**
 * Match rank of one skill against a lowercased needle: 0 when the name hits,
 * 1 when only the description hits, undefined when neither does. An empty
 * needle matches everything at rank 0.
 */
export function matchRank(skill: SkillEntry, needle: string): 0 | 1 | undefined {
  if (needle === '') return 0
  if (skill.name.toLowerCase().includes(needle)) return 0
  if (skill.description.toLowerCase().includes(needle)) return 1
  return undefined
}

/**
 * Whether a skill survives the workspace axis. Skills without a workspace
 * root are global and stay visible in every selection; that is the pre-search
 * behavior and the search must not change it.
 */
function inWorkspace(skill: SkillEntry, workspace: string): boolean {
  if (workspace === 'all') return true
  return skill.workspaceRoot === undefined || skill.workspaceRoot === workspace
}

/**
 * Apply both axes to a payload's groups: workspace filter first, then the
 * query (name hits ranked before description hits, stable within a rank).
 * Empty groups are dropped so the caller renders only what has content.
 * @param groups - host payload groups in host order.
 * @param filter - workspace + query.
 * @returns the visible groups; the input is never mutated.
 */
export function selectGroups(groups: readonly GroupPayload[], filter: SkillListFilter): GroupPayload[] {
  const needle = filter.query.trim().toLowerCase()
  return groups.map((group) => {
    const ranked = group.skills
      .filter(skill => inWorkspace(skill, filter.workspace))
      .map(skill => ({ skill, rank: matchRank(skill, needle) }))
      .filter((row): row is { skill: SkillEntry; rank: 0 | 1 } => row.rank !== undefined)
    // Array.prototype.sort is stable, so equal ranks keep the host's order.
    if (needle !== '') ranked.sort((left, right) => left.rank - right.rank)
    return { ...group, skills: ranked.map(row => row.skill) }
  }).filter(group => group.skills.length > 0)
}
