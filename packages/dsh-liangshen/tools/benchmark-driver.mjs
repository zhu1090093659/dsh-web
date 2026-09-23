/**
 * Benchmark multi-turn agent driver.
 *
 * Replaces the one-shot \`headless-runner\` row so a benchmark run can drive
 * SEVERAL turns through ONE session: the preset's anchor turn and the promoted
 * turn are a single session's first and second turn, so a one-shot driver could
 * never observe the handoff.
 *
 * The composition it runs under is the real one: the profile's own registry,
 * sandbox, persistence, and model rows, plus the preset mounted through
 * \`agentPresets.mount\` exactly as the production session controller does
 * (\`packages/api/session-controller/src/agent.ts\`, \`composeAgent\`).
 *
 * Nothing here is model-facing; it is evaluation scaffolding.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Stable Cordis plugin name. */
export const name = 'benchmark-driver'

/** The official services this driver drives. */
export const inject = ['agents', 'sessions', 'agentDefaultModel']

/** One synthetic session id; uniqueness only has to hold within one run. */
function sessionIdFor(runId) {
  return runId ?? `bench-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

/**
 * Run every configured turn through one freshly created agent.
 * @param ctx - host context carrying the driver's injected services.
 * @param config - resolved driver config.
 * @param io - process-facing effects.
 */
async function run(ctx, config, io) {
  // Loader siblings mount concurrently: await the whole application before
  // creating an agent, or its scoped tools and adapters are half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  const defaultModel = ctx.get('agentDefaultModel')
  if (agents === undefined || sessions === undefined || defaultModel === undefined) {
    throw new Error('benchmark-driver: agents, sessions, and agentDefaultModel must all be mounted')
  }

  const turns = Array.isArray(config?.turns) ? config.turns : []
  if (turns.length === 0) throw new Error('benchmark-driver: at least one turn is required')

  const presetId = typeof config?.preset === 'string' && config.preset.length > 0 ? config.preset : undefined
  const cwd = typeof config?.cwd === 'string' && config.cwd.length > 0 ? config.cwd : process.cwd()
  const selection = defaultModel.currentSelection()
  const presets = ctx.get('agentPresets')

  const { agent, dispose } = await agents.create({
    sessionId: sessionIdFor(config?.sessionId),
    meta: { cwd, ...presetId === undefined ? {} : { agentPreset: presetId } },
    agentOptions: {
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
    },
    setup: async (agentCtx) => {
      // Joining the preset is what makes its rows (persona filter, tool catalog,
      // shell) cover this agent. Without a roster the agent keeps host-plane rows,
      // which is exactly the 'standard' baseline variant.
      if (presetId === undefined) return
      if (presets === undefined) {
        throw new Error(`benchmark-driver: preset "${presetId}" was requested but no agentPresets roster is mounted`)
      }
      await presets.mount(agentCtx, presetId)
    },
  })

  const outcome = { ok: true, preset: presetId ?? null, cwd, turns: [], provider: selection.provider, model: selection.model }
  try {
    await agent.whenIdle()
    outcome.sessionId = String(agent.session.header.id)
    for (const turn of turns) {
      const before = agent.session.seq
      agent.followup(createUserMessage({ content: [{ type: 'text', text: String(turn) }], source: { kind: 'user' } }))
      await agent.whenIdle()
      outcome.turns.push({ fromSeq: before, toSeq: agent.session.seq })
    }
    await sessions.flush(agent.session)
  } finally {
    try {
      await dispose()
    } catch {
      // Disposal is best-effort: the run's evidence is already persisted.
    }
  }

  writeFileSync(join(cwd, 'benchmark-driver-outcome.json'), JSON.stringify(outcome, null, 2))
  return outcome
}

/**
 * Mount the multi-turn driver.
 * @param ctx - plugin context carrying core services and the launcher's exit.
 * @param config - validated driver config.
 */
export function apply(ctx, config) {
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('benchmark-driver: the launcher must provide ctx.appExit before the tree mounts')
  const io = { stdout: process.stdout, stderr: process.stderr, exit }
  void run(ctx, config, io).then(
    () => { exit(0) },
    (error) => {
      io.stderr.write(`benchmark-driver: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
      try {
        writeFileSync(join(process.cwd(), 'benchmark-driver-outcome.json'), JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }, null, 2))
      } catch {
        // The failure is already on stderr.
      }
      exit(1)
    },
  )
}
