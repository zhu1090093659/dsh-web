/*
 * Forked from deepseek-harness dsh-v0.2.2-rc.1 (commit 66491b05) packages/experimental/agent-team/src/index.ts
 * MIT licensed; every change this package made is listed in
 * packages/dsh-agents/docs/fork-provenance.md.
 */
/**
 * The five Host services the vendored Agent Teams runtime drives, resolved once.
 *
 * We mount this runtime on the plugin row's own fiber, whose inject list is
 * narrower than the upstream row's: a cordis fiber may read only a service it
 * injected, and a property read of any other service throws
 * `cannot get property "<name>" without inject`. Resolving the faces through
 * `ctx.get` once and handing the same objects to the service, the roster and the
 * journal keeps every read identical to upstream while surviving that narrower
 * fiber.
 */

import type { Context } from '@deepseek-ai/cordis'
import { readService } from '../host/services.ts'

/** The five services the runtime drives, as the Host publishes them. */
export type TeamServiceFaces = Pick<Context, 'agents' | 'sessions' | 'sessionPersistence' | 'sessionProjections' | 'subagents'>

/**
 * Resolve the five faces of one mount.
 * @param ctx - the context the runtime is mounted on.
 * @returns the faces, or undefined when this deployment does not serve all five.
 */
export function serveTeamFaces(ctx: Context): TeamServiceFaces | undefined {
  const agents = readService<Context['agents']>(ctx, 'agents', false)
  const sessions = readService<Context['sessions']>(ctx, 'sessions', false)
  const sessionPersistence = readService<Context['sessionPersistence']>(ctx, 'sessionPersistence', false)
  const sessionProjections = readService<Context['sessionProjections']>(ctx, 'sessionProjections', false)
  const subagents = readService<Context['subagents']>(ctx, 'subagents', false)
  if (
    agents === undefined
    || sessions === undefined
    || sessionPersistence === undefined
    || sessionProjections === undefined
    || subagents === undefined
  ) return undefined
  return { agents, sessions, sessionPersistence, sessionProjections, subagents }
}
