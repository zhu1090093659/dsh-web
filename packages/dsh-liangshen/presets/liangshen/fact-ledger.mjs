/**
 * fact-ledger — the LiangShen preset's key-fact register: a lightweight tool
 * the model uses to pin the facts that must survive a long session, and a
 * fold that re-derives the current register from the durable event stream.
 *
 * Why this exists: community feedback on DeepSeek-V4.1 (r/DeepSeek 1wlssvo,
 * and the architecture's own numbers) is that long conversations forget —
 * CSA2's sparse index only guarantees a query the most recent local window,
 * and a hard constraint the user stated eighty turns ago competes for Top-K
 * slots with every tool schema and log line since. The working-context
 * projection is the one surface that lands inside that guaranteed window
 * every step, so the register rides it: the sibling working-context plugin
 * renders the current facts as one of its fields, republished only on change.
 *
 * The register itself is a list of single-line facts, newest last, rebuilt by
 * replaying `tool/call` events for this tool from the session log — exactly
 * the way the paging activation state replays. A fact is a string the model
 * writes; registering a new fact APPENDS, and registering one already present
 * is a no-op report. REVOCATION is append-only too: a `revoke` entry removes
 * every earlier fact carrying the same tag, so the fold stays deterministic
 * after resume and compaction without any process memory.
 *
 * The tool is deliberately small: it validates and reports, it does not edit
 * the context itself. The projection the model sees next step is the fold of
 * the log the runtime appended for this call.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'liangshen-fact-ledger'

/** The tools registry must exist before the ledger tool can register. */
export const inject = ['tools']

/** The model-facing registration tool this plugin mounts. */
export const FACT_LEDGER_TOOL = 'fact_register'

/** Cap one fact so a single entry stays a glance, not a paragraph. */
export const MAX_FACT_CHARS = 160

/** Cap the register so the ledger cannot itself flood the local window. */
export const MAX_FACTS = 12

/**
 * Fold the current fact register from the event stream: every successful
 * `fact_register` call appends its fact (or revokes by tag). Facts carry no
 * ids — revocation matches on the optional `tag`, and an untagged fact can
 * only be revoked by revoking its exact text as the tag of last resort.
 */
export function foldFactLedger(events) {
  const facts = []
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== 'tool/call' || event.data?.name !== FACT_LEDGER_TOOL) continue
    let args = event.data?.arguments
    if (typeof args === 'string') {
      try { args = JSON.parse(args) } catch { args = undefined }
    }
    if (args === undefined || args === null) continue
    if (typeof args.revoke === 'string' && args.revoke.trim() !== '') {
      const tag = args.revoke.trim()
      for (let index = facts.length - 1; index >= 0; index -= 1) {
        if (facts[index].tag === tag || facts[index].text === tag) facts.splice(index, 1)
      }
      continue
    }
    if (typeof args.fact !== 'string' || args.fact.trim() === '') continue
    const text = args.fact.trim().slice(0, MAX_FACT_CHARS)
    if (facts.some(entry => entry.text === text)) continue
    const tag = typeof args.tag === 'string' && args.tag.trim() !== '' ? args.tag.trim() : undefined
    facts.push({ text, tag })
    if (facts.length > MAX_FACTS) facts.splice(0, facts.length - MAX_FACTS)
  }
  return facts
}

/**
 * Render the register as the working-context field value, or undefined when
 * the register is empty. Tags annotate their fact inline.
 */
export function renderLedgerField(facts) {
  if (!Array.isArray(facts) || facts.length === 0) return undefined
  const rendered = facts.map(entry => entry.tag === undefined ? entry.text : `${entry.text} [${entry.tag}]`)
  return `key facts: ${rendered.join(' ; ')}`
}

/** Register the `fact_register` tool. */
export function apply(ctx) {
  ctx.tools.register({
    name: FACT_LEDGER_TOOL,
    description: [
      'Pin one key fact into this session working context — the line the runtime projects next to the newest message every step. Use it for the facts a long session must not lose: a hard user constraint, a confirmed architecture decision, a path that already failed.',
      `A fact is one short line (<= ${MAX_FACT_CHARS} chars); at most ${MAX_FACTS} stay pinned, the oldest dropping off. Pass the same text again to no-op; pass the revoke field with a fact tag (or its exact text) to unpin everything under it.`,
      'Pin sparingly: the register rides the guaranteed-attention window, and flooding it dilutes every other fact.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        fact: {
          type: 'string',
          description: 'The single-line fact to pin (for example "User requires TypeScript strict mode, no any"). Omit when revoking.',
        },
        tag: {
          type: 'string',
          description: 'An optional short tag naming the fact\'s topic (for example "constraints", "auth-decision") so it can be revoked by tag later.',
        },
        revoke: {
          type: 'string',
          description: 'Revoke every pinned fact under this tag (or matching this exact text). When set, the fact field is ignored.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    /**
     * Concurrency-safe: the handler only validates and reports; the register
     * itself is the fold of the durable log the runtime appends for the call,
     * so overlapping registrations cannot corrupt shared state.
     */
    isConcurrencySafe: () => true,
    async execute(args) {
      if (typeof args?.revoke === 'string' && args.revoke.trim() !== '') {
        return { text: `Revocation recorded for "${args.revoke.trim()}": every pinned fact under that tag (or matching that text) is dropped from the next step\'s working context.` }
      }
      if (typeof args?.fact !== 'string' || args.fact.trim() === '') {
        throw new Error('fact_register requires either a non-empty `fact` to pin or a non-empty `revoke` tag/text to unpin')
      }
      const text = args.fact.trim().slice(0, MAX_FACT_CHARS)
      const tagged = typeof args?.tag === 'string' && args.tag.trim() !== '' ? ` under tag "${args.tag.trim()}"` : ''
      return { text: `Pinned${tagged}: "${text}". It rides the working-context line from the next step on.` }
    },
  })
}
