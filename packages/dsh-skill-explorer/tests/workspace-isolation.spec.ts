/**
 * Workspace isolation and multi-workspace presentation tests (#1407).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { buildPayload, collectSkills } from '../src/collect.ts'
import { SkillPanel } from '../src/client/SkillPanel.tsx'
import type { ListPayload } from '../src/client/api.ts'

const TMP = mkdtempSync(join(tmpdir(), 'skill-ws-test-'))
const PROJ_A = join(TMP, 'workspace-a')
const PROJ_B = join(TMP, 'workspace-b')
const HOME = join(TMP, 'home')
const AGENTS = join(TMP, 'agents')

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

// Workspace A (Active)
write(join(PROJ_A, '.git', 'keep'), '')
write(join(PROJ_A, '.dsh', 'skills', 'skill-a', 'SKILL.md'), '---\nname: skill-a\ndescription: Skill in Workspace A\n---\n# Code A\n')
// Conflict skill in both A and B
write(join(PROJ_A, '.dsh', 'skills', 'conflict-skill', 'SKILL.md'), '---\nname: conflict-skill\ndescription: Conflict skill from Workspace A\n---\n')

// Workspace B (Inactive)
write(join(PROJ_B, '.git', 'keep'), '')
write(join(PROJ_B, '.dsh', 'skills', 'skill-b', 'SKILL.md'), '---\nname: skill-b\ndescription: Skill in Workspace B\n---\n# Code B\n')
write(join(PROJ_B, '.dsh', 'skills', 'conflict-skill', 'SKILL.md'), '---\nname: conflict-skill\ndescription: Conflict skill from Workspace B\n---\n')

// User skill
write(join(HOME, 'skills', 'global-user', 'SKILL.md'), '---\nname: global-user\ndescription: Global user skill\n---\n')

const dummyRegistry = {
  snapshot: async () => ({ skills: [], complete: true }),
}

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('collectSkills and buildPayload workspace awareness', () => {
  it('identifies active and inactive workspaces and resolves conflict towards active workspace', async () => {
    const result = await collectSkills({
      cwd: PROJ_A,
      projectRoots: [PROJ_A, PROJ_B],
      dshHome: HOME,
      agentsHome: AGENTS,
      registry: dummyRegistry,
    })

    const skillA = result.skills.find((s) => s.name === 'skill-a')
    expect(skillA).toBeDefined()
    expect(skillA?.workspaceRoot).toBe(PROJ_A)
    expect(skillA?.workspaceName).toBe('workspace-a')
    expect(skillA?.isActiveWorkspace).toBe(true)

    const skillB = result.skills.find((s) => s.name === 'skill-b')
    expect(skillB).toBeDefined()
    expect(skillB?.workspaceRoot).toBe(PROJ_B)
    expect(skillB?.workspaceName).toBe('workspace-b')
    expect(skillB?.isActiveWorkspace).toBe(false)

    // Conflict resolution: active workspace skill should win
    const conflict = result.skills.find((s) => s.name === 'conflict-skill')
    expect(conflict).toBeDefined()
    expect(conflict?.description).toBe('Conflict skill from Workspace A')
    expect(conflict?.isActiveWorkspace).toBe(true)

    // Global skill has no workspace
    const globalSkill = result.skills.find((s) => s.name === 'global-user')
    expect(globalSkill).toBeDefined()
    expect(globalSkill?.workspaceRoot).toBeUndefined()
    expect(globalSkill?.isActiveWorkspace).toBeUndefined()

    // buildPayload generates workspace descriptors
    const payload = buildPayload(result.skills, result.complete, PROJ_A, [PROJ_A, PROJ_B])
    expect(payload.workspaces).toBeDefined()
    expect(payload.workspaces?.length).toBe(2)
    const wsA = payload.workspaces?.find((w) => w.root === PROJ_A)
    const wsB = payload.workspaces?.find((w) => w.root === PROJ_B)
    expect(wsA?.active).toBe(true)
    expect(wsB?.active).toBe(false)
  })
})

describe('SkillPanel workspace presentation and filtering', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders workspace badges, isolation tags, and dropdown filter', async () => {
    const testPayload: ListPayload = {
      cwd: '/path/ws-a',
      projectRoots: ['/path/ws-a', '/path/ws-b'],
      complete: true,
      workspaces: [
        { root: '/path/ws-a', name: 'ws-a', active: true },
        { root: '/path/ws-b', name: 'ws-b', active: false },
      ],
      groups: [
        {
          key: 'project-dsh',
          title: 'Project skills',
          hint: 'project hint',
          skills: [
            {
              name: 'proj-skill-a',
              description: 'Skill in A',
              level: 'project-dsh',
              path: '/path/ws-a/.dsh/skills/proj-skill-a/SKILL.md',
              modelInvocable: true,
              userInvocable: true,
              workspaceRoot: '/path/ws-a',
              workspaceName: 'ws-a',
              isActiveWorkspace: true,
            },
            {
              name: 'proj-skill-b',
              description: 'Skill in B',
              level: 'project-dsh',
              path: '/path/ws-b/.dsh/skills/proj-skill-b/SKILL.md',
              modelInvocable: true,
              userInvocable: true,
              workspaceRoot: '/path/ws-b',
              workspaceName: 'ws-b',
              isActiveWorkspace: false,
            },
          ],
        },
      ],
    }

    const fakeApi = {
      list: async () => testPayload,
      setEnabled: async () => ({ name: '', enabled: true, modelInvocable: true }),
      remove: async () => ({ ok: true as const, name: '', moved: '' }),
      create: async () => { throw new Error('unused') },
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(SkillPanel, { api: fakeApi as never, onClose: () => {} }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Dropdown filter rendered
    const select = container.querySelector('#dsh-skill-workspace-filter') as HTMLSelectElement
    expect(select).not.toBeNull()
    expect(select.options.length).toBe(3) // All + ws-a + ws-b

    // Skills rendered
    const rows = container.querySelectorAll('[data-dsh-part="skill-row"]')
    expect(rows.length).toBe(2)

    // Check workspace badge and isolation badge
    const rowB = Array.from(rows).find((r) => r.textContent?.includes('proj-skill-b'))
    expect(rowB).toBeDefined()
    expect(rowB?.textContent).toContain('ws-b')
    expect(rowB?.textContent).toContain('工作区隔离')

    const rowA = Array.from(rows).find((r) => r.textContent?.includes('proj-skill-a'))
    expect(rowA).toBeDefined()
    expect(rowA?.textContent).toContain('ws-a')
    expect(rowA?.textContent).not.toContain('工作区隔离')

    // Test filter selection
    await act(async () => {
      select.value = '/path/ws-a'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const filteredRows = container.querySelectorAll('[data-dsh-part="skill-row"]')
    expect(filteredRows.length).toBe(1)
    expect(filteredRows[0].textContent).toContain('proj-skill-a')

    root.unmount()
    container.remove()
  })
})
