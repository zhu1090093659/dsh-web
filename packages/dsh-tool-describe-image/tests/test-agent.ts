/** Minimal agent facade the describe_image tool reads: only the session header cwd is used. */
import type { Agent } from '@deepseek-ai/dsh-agent'

export function agentForWorkspace(workspace: string | undefined): Agent | undefined {
  if (workspace === undefined) return undefined
  return { session: { header: { cwd: workspace } } } as unknown as Agent
}
