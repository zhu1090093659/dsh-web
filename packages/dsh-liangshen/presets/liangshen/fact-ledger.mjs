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
 * replaying this tool's calls out of the session log — exactly the way the
 * paging activation state replays, and from both wire shapes a session records
 * them in ({@link factRegisterCall}). A fact is a string the model writes;
 * registering a new fact APPENDS, and registering one already present is a
 * no-op report. REVOCATION is append-only too: a `revoke` entry removes every
 * earlier fact carrying the same tag, so the fold stays deterministic after
 * resume and compaction without any process memory.
 *
 * The tool is deliberately small: it validates and reports, it does not edit
 * the context itself. The projection the model sees next step is the fold of
 * the log the runtime appended for this call.
 *
 * AN ANCHOR, NOT A SOURCE OF TRUTH (2026-10-18): a pinned fact is a reading
 * taken when it was registered, and the projection re-publishes it verbatim
 * afterwards, so a fact whose subject changed is stale the moment it is read
 * again while looking exactly as fresh as it did the first time. That is the
 * one failure this register can introduce on its own, and it is the expensive
 * kind: nothing downstream questions a fact the model supplied. The register
 * therefore stays a pointer with an expiry the model manages -- the tool
 * description tells it to re-read the subject before planning on a fact whose
 * subject moved, and to revoke the entry once the subject is settled -- rather
 * than pretending the projection can detect the change itself. Detecting it
 * would need a reverse index from every fact to every file it names, which is
 * exactly the guessing this preset exists to avoid.
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
 * The call one event contributes to the fold, or undefined when the event is
 * not a `fact_register` call that took effect.
 *
 * The session records the call in one of two shapes, and which one depends on
 * the presentation the session runs. `native` records a top-level `tool/call`
 * whose `arguments` is the JSON string the model emitted. `ptc` — the shipped
 * default — collapses the wire to `run_code` and reaches every other tool from
 * inside a program, which the runtime records as `tool/ptc-dispatch`: its
 * `arguments` is already an object, and a dispatch that failed carries its own
 * `isError` on the dispatch record (`event.data.isError`), not on the event
 * envelope. Reading only `tool/call` therefore folded an empty register in
 * every factory-default session — pin and revoke both reported success while no
 * `key facts` field ever rendered — which is the same gap `paging.mjs` replays
 * both shapes to avoid.
 *
 * A dispatch that reported an error never took effect, so it contributes
 * nothing: a failed pin must not pin, and a failed revoke must not drop a fact
 * that still stands. `tool/ptc-dispatch-start` only announces a dispatch that
 * has not settled yet, so the event-type check below leaves it out. The
 * `native` half keeps its existing semantics untouched: a `tool/call` is read
 * whatever its `tool/result` later reported, exactly as before this change.
 */
function factRegisterCall(event) {
  if (event?.type === 'tool/ptc-dispatch') {
    const dispatch = event.data
    if (dispatch?.name !== FACT_LEDGER_TOOL || dispatch?.isError === true) return undefined
    return dispatch
  }
  if (event?.type !== 'tool/call' || event.data?.name !== FACT_LEDGER_TOOL) return undefined
  return event.data
}

/**
 * Fold the current fact register from the event stream: every successful
 * `fact_register` call appends its fact (or revokes by tag), whichever wire
 * shape recorded it. Facts carry no ids — revocation matches on the optional
 * `tag`, and an untagged fact can only be revoked by revoking its exact text as
 * the tag of last resort.
 */
export function foldFactLedger(events) {
  const facts = []
  for (const event of Array.isArray(events) ? events : []) {
    const data = factRegisterCall(event)
    if (data === undefined) continue
    let args = data.arguments
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
      'A pinned fact is an anchor, not current state: it is republished verbatim, so a fact whose subject later changed reads exactly as fresh as it did when pinned. Before planning on a fact, re-read its subject if that subject moved; once the subject is settled, revoke the entry instead of leaving a stale line pinned.',
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
