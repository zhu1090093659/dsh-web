/**
 * Composition guard for the shipped preset file: the committed
 * `agent.cordis.yml` must stay readable by the declaration reader, mount the
 * preset-local plugins, and keep the persona row on the schema the installed
 * SDK accepts.
 *
 * The persona section-name assertion is the regression guard for the class of
 * defect where a harness rename silently stops matching a hardcoded name —
 * the filter then drops every section and the session runs on an empty system
 * prompt. The names are pinned against the installed SDK constant instead of a
 * copy of it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'

import { PERSONA_SECTION_NAMES, PLAN_POLICY_SECTION_NAME, name as promptName } from '../presets/liangshen/minimal-prompt.mjs'
import { name as catalogName } from '../presets/liangshen/tool-catalog.mjs'
import { type CompositionRow, readCompositionRows } from '../src/composition.ts'

const preset = readFileSync(join(process.cwd(), 'presets/liangshen/agent.cordis.yml'), 'utf8')
const presetDir = join(process.cwd(), 'presets', 'liangshen')

/** Whether the composition parses into the rows a registry declaration takes. */
function readable(text: string): boolean {
  try {
    readCompositionRows(text, presetDir)
    return true
  } catch {
    return false
  }
}

/**
 * The text of one top-level `- id: <id>` row: its own line and the indented
 * block under it. The row ends at the next top-level line of any kind, so a
 * comment block following the row is not mistaken for part of its YAML.
 */
function row(id: string): string {
  const start = preset.indexOf(`- id: ${id}\n`)
  if (start < 0) return ''
  const rest = preset.slice(start + 1)
  const next = rest.search(/^\S/m)
  return next < 0 ? rest : rest.slice(0, next)
}

/** Every leaf row of the composition, descending into each group's entry list. */
function leafRows(rows: readonly CompositionRow[]): CompositionRow[] {
  return rows.flatMap((row) =>
    Array.isArray(row.config) ? leafRows(row.config as CompositionRow[]) : [row])
}

/** The parsed rows whose own config owns the `list_subagent_models` discovery tool. */
function discoveryOwners(text = preset): CompositionRow[] {
  return leafRows(readCompositionRows(text, presetDir))
    .filter((entry) =>
      typeof entry.config === 'object' && entry.config !== null && !Array.isArray(entry.config)
      && (entry.config as Record<string, unknown>).modelDiscovery === true)
}
describe('liangshen preset composition', () => {
  it('is structurally valid for the preset loader', () => {
    expect(readable(preset)).toBe(true)
  })

  it('mounts the minimal-prompt and tool-catalog plugins', () => {
    expect(promptName).toBe('liangshen-minimal-prompt')
    expect(catalogName).toBe('liangshen-tool-catalog')
    expect(row('minimal-prompt')).toContain('name: ./minimal-prompt.mjs')
    expect(row('tool-catalog')).toContain('name: ./tool-catalog.mjs')
    expect(preset).not.toContain('tool-bootstrap')
  })

  it('keeps the persona row on the current schema with the discipline prefix', () => {
    const persona = row('persona')
    expect(persona).toContain("name: '@deepseek-ai/dsh-persona'")
    expect(persona).toContain('prefix: |-')
    expect(persona).toContain('You are a helpful software engineer assistant.')
    // The standing working discipline ships inside the persona prefix: the
    // thinking-disruption fuse, action-oriented steps, and YAGNI/PDCA.
    expect(persona).toContain('Thinking Disruption: Never reason through the same hypothesis more than twice')
    expect(persona).toContain('stop thinking and call a native inspection tool')
    expect(persona).toContain('Action-Oriented: Use thinking only to pick the next concrete operation')
    expect(persona).toContain('Parallel Inspection: When several independent inspections, searches, or checks are needed')
    // The same discipline line carries the batching pointer: two or more targets
    // of the same kind belong in one run_code program. It rides the SAME line so
    // the discipline block does not grow a bullet, and it is the only place the
    // persona names the transport — the contract text lives in the catalog.
    expect(persona).toContain('batch them into one run_code program instead and keep only its conclusion')
    const discipline = persona.split('\n').filter(line => line.trim().startsWith('- '))
    expect(discipline).toHaveLength(7)
    expect(persona).toContain('Follow YAGNI and the PDCA loop')
    expect(persona).toContain('Do not write redundant comments.')
    expect(persona).toContain('Bounded Inspection & Convergence: Do not traverse dependency chains unbounded')
    // The convergence bound names the repetition it forbids, not a turn count:
    // a numeric cap is read at its strictest end and swallows the cheap check
    // that would settle an open question (2026-10-18).
    expect(persona).toContain('Stop repeating an inspection whose answer you already hold')
    expect(persona).toContain('A concrete hypothesis with a cheap check is different: run it.')
    expect(persona).not.toContain('at most 2-3 inspection turns')
    expect(persona).not.toContain('text:')
    expect(persona).not.toContain('complete:')
    // Runtime contexts are durable user-role messages, not prompt text: they
    // stay enabled.
    expect(persona).not.toContain('includeRuntimeContext')
  })

  it('declares the plugin configs explicitly', () => {
    expect(row('minimal-prompt')).toContain('keepPlanPolicy: true')
    // The shipped default hands workspace instructions back to the harness's
    // own agent-instructions row; the other two sources stay opt-in.
    expect(row('minimal-prompt')).toContain('instructionSource: host')
    expect(row('minimal-prompt')).toContain('instructionMaxBytes: 65536')
    // The dispatcher block ships on: the factory row pins the switch ON, and
    // the switch shapes the prompt only, never the wire presentation.
    expect(row('minimal-prompt')).toContain('dispatcher: true')
    expect(row('tool-catalog')).toContain('descriptionMaxLength: 200')
  })

  it("declares the 'ptc' presentation with MCP paging on by default, and no retired keys", () => {
    expect(row('tool-catalog')).toContain("presentation: 'ptc'")
    expect(row('tool-catalog')).toContain("pagedToolPatterns: ['mcp__*']")
    expect(row('tool-catalog')).not.toContain('ptcPresentation')
    expect(row('tool-catalog')).not.toContain('anchorTools')
  })

  it('mounts working-context, tool-activate and both preset-plane guards, and no retired guard row', () => {
    expect(row('tool-activate')).toContain('name: ./tool-activate.mjs')
    expect(row('working-context')).toContain('name: ./working-context.mjs')
    // The subagent route guard is its own row: the retired row below was a
    // runtime-degeneration breaker, not this policy guard.
    expect(row('subagent-routes')).toContain('name: ./subagent-routes.mjs')
    expect(row('subagent-routes')).not.toContain('disabled: true')
    // The dispatch execution guard is the second preset-plane guard: it refuses
    // a coordinator-only tool called by a delegated child and a foreground sleep
    // while a child is running, on `ctx.tools.guard()` alone.
    expect(row('dispatch-guard')).toContain('name: ./dispatch-guard.mjs')
    expect(row('dispatch-guard')).not.toContain('disabled: true')
    // The runtime degeneration circuit breaker is retired: the composition
    // carries no guard row, so no session mounts its pre-step channel.
    expect(row('guard')).toBe('')
  })

  it('does not mount reasoning-effort plugin', () => {
    expect(row('reasoning-effort')).toBe('')
  })

  it('operator gets the human /goal command beside the goal tool from the preset', () => {
    // Given: the shipped composition, read the way the preset loader reads it.
    const rows = readCompositionRows(preset, presetDir) as CompositionRow[]
    // When: the goals section's rows are inspected.
    const commandGoal = rows.filter((entry) => entry.id === 'command-goal')
    const goalTool = rows.filter((entry) => entry.id === 'tool-goal')
    // Then: the human /goal command is one TOP-LEVEL row. The builtin
    // standard, ptc, and cordis presets declare it exactly that way, so it
    // resolves the host `commands` service; an entry-local realm would hide
    // that service and the command would never register.
    expect(commandGoal.map((entry) => entry.name)).toEqual(['@deepseek-ai/dsh-command-goal'])
    // Then: the model-facing goal tool stays mounted beside it, so the preset
    // keeps both consumers of the one host goal domain.
    expect(goalTool.map((entry) => entry.name)).toEqual(['@deepseek-ai/dsh-tool-goal'])
    // Then: the file declares the command exactly once, and no group holds a
    // second copy of the row.
    expect(preset.match(/name: '@deepseek-ai\/dsh-command-goal'/gu)).toHaveLength(1)
    const nested = rows
      .filter((entry) => Array.isArray(entry.config))
      .flatMap((entry) => leafRows(entry.config as CompositionRow[]))
    expect(nested.map((entry) => entry.id)).not.toContain('command-goal')
    // Then: the guard is not vacuous - the exact edit that drops the row reads
    // back as its absence instead of passing silently.
    const stripped = preset.replace("- id: command-goal\n  name: '@deepseek-ai/dsh-command-goal'\n", '')
    expect(stripped).not.toBe(preset)
    expect((readCompositionRows(stripped, presetDir) as CompositionRow[]).map((entry) => entry.id))
      .not.toContain('command-goal')
  })

  it('keeps the native and ptc presentation variants structurally valid', () => {
    for (const mode of ['native', 'ptc']) {
      const variant = preset.replace("presentation: 'ptc'", `presentation: '${mode}'`)
      // 'ptc' IS the shipped line, so only the 'native' rewrite changes the text.
      if (mode !== 'ptc') expect(variant).not.toBe(preset)
      expect(readable(variant), mode).toBe(true)
    }
  })

  it('ships the balanced tool-result pruning budgets', () => {
    const pruner = row('compaction')
    expect(pruner).toContain('thresholdChars: 4096')
    expect(pruner).toContain('headChars: 2048')
    expect(pruner).toContain('tailChars: 1024')
  })

  it('keeps run_code the only model-authored orchestration surface', () => {
    // The builtin PTC preset's one roster difference: the engine row stays for
    // `ralph`, the workflow tool does not publish beside `run_code`.
    const workflow = row('workflow-ptc')
    expect(workflow).toContain("name: '@deepseek-ai/dsh-tool-workflow'")
    expect(workflow).toContain('disabled: true')
  })

  it('accepts the persona section name the installed SDK registers', () => {
    expect(PERSONA_SECTION_NAMES).toContain(PERSONA_PREFIX_SECTION)
    expect(PERSONA_SECTION_NAMES).not.toContain(PERSONA_SUFFIX_SECTION)
    expect(PLAN_POLICY_SECTION_NAME).toBe('plan:policy')
  })

  it('operator gets child-model selection from the spawn delegation row alone', () => {
    // Given: the shipped composition, read the way the preset loader reads it.
    // When: the delegation rows are inspected for the child-model opt-in.
    // Then: the spawn row sets both current upstream knobs, so the tool
    // publishes its route parameters and the `list_subagent_models`
    // discovery tool the settings toggle depends on.
    const spawn = row('tool-subagent')
    expect(spawn).toContain('modelSelection: true')
    expect(spawn).toContain('modelDiscovery: true')
    // Then: the pre-split spelling rides along. The SDK pinned in
    // devDependencies reads only that key, and the harness checkout this
    // repository runs against silently drops it as an unknown field, so the
    // row carries both and either generation finds its opt-in.
    expect(spawn).toContain('modelSelectionSettings: true')
    // Then: the fork row stays out of both, because the discovery flag
    // registers one tool under a FIXED name per composed scope and a second
    // owner fails the whole session composition with the duplicate
    // tool-name error instead of adding a second opt-in. The official
    // Standard, PTC, and Cordis rosters ship the route fields off there too.
    const fork = row('tool-subagent-fork')
    expect(fork).not.toMatch(/\bmodelSelection(?:Settings)?: true/)
    expect(fork).not.toContain('modelDiscovery')
    // Then: the parsed composition carries exactly one discovery owner, so
    // the invariant survives a row being added, renamed, or moved.
    expect(discoveryOwners().map((owner) => owner.id)).toEqual(['tool-subagent'])
    // Then: the guard is not vacuous - giving the fork row the discovery
    // flag, the exact edit a maintainer would make to complete the opt-in,
    // is counted as a second owner instead of passing silently.
    const forked = preset.replace(
      '        provider: fork\n        toolName: subagent_fork\n',
      '        provider: fork\n        toolName: subagent_fork\n        modelDiscovery: true\n',
    )
    expect(forked).not.toBe(preset)
    expect(discoveryOwners(forked).map((owner) => owner.id))
      .toEqual(['tool-subagent', 'tool-subagent-fork'])
  })
})