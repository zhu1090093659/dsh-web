import { describe, expect, it } from 'vitest'
import { gitHubSourceGroup } from '../src/client/github/grouping.ts'
import { plainTask } from './support/fake-board.ts'

describe('GitHub source grouping', () => {
  it('operator sees the full original owner/repository with a case-stable id', () => {
    // Given a linked card whose owner and repository use mixed case
    const task = plainTask('linked', {
      integrations: {
        github: {
          provider: 'github', owner: 'DeepSeek-AI', repository: 'DsH', issueNumber: 1,
          issueUrl: 'https://github.com/DeepSeek-AI/DsH/issues/1', remoteLabels: [],
        },
      },
    })

    // When the selector reads the linked card
    // Then the label preserves identity while the id stays stable across case changes
    expect(gitHubSourceGroup(task)).toEqual({ id: 'github:deepseek-ai/dsh', label: 'DeepSeek-AI/DsH' })
  })

  it('operator with local or malformed cards gets no provider group', () => {
    // Given a local card and a malformed provider payload
    const local = plainTask('local')
    const malformed = plainTask('bad', { integrations: { github: { provider: 'github' } } })

    // When the selector evaluates both cards
    // Then neither receives a provider group
    expect(gitHubSourceGroup(local)).toBeUndefined()
    expect(gitHubSourceGroup(malformed)).toBeUndefined()
  })
})
