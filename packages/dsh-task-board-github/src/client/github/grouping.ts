/**
 * GitHub repository source groups for the board's generic grouping contract.
 * The board receives only an opaque id and a display label; all GitHub
 * metadata interpretation stays inside this provider package.
 */
import type { TaskBoardSourceGroup } from '../../core/contract.ts'
import type { TaskRecord } from '../../core/task-record.ts'
import { readTaskGitHubMetadata } from '../../core/types.ts'

/** Return the full repository group for a GitHub-linked card. */
export function gitHubSourceGroup(task: TaskRecord): TaskBoardSourceGroup | undefined {
  const metadata = readTaskGitHubMetadata(task)
  if (metadata === undefined) return undefined
  const owner = metadata.owner.trim()
  const repository = metadata.repository.trim()
  if (owner === '' || repository === '') return undefined
  return {
    id: `github:${owner.toLowerCase()}/${repository.toLowerCase()}`,
    label: `${owner}/${repository}`,
  }
}
