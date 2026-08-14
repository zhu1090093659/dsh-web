/**
 * Which model-facing role a logged non-user message plays.
 *
 * `recall` marks material lifted out of another session's log; `inject` marks
 * every other producer-supplied context. Mid-turn steering is the third role
 * the transcript distinguishes, but it has its own event and node kind
 * (`steering/message` / `SteeringMessageNode`) and never reaches here.
 */
export type ContextRole = 'inject' | 'recall';
/** Role and producer name presented for one logged non-user message. */
export interface ContextProvenanceView {
    /** The role this context plays in the model-facing conversation. */
    role: ContextRole;
    /**
     * Producer name for the row header, taken from the durable source: the
     * instruction paths, the referenced session titles, the plugin id, or the
     * bare source kind for a producer this UI version does not know. Null only
     * when the source carries no readable kind at all.
     */
    label: string | null;
}
/**
 * Project one durable message source onto its transcript role and producer name.
 *
 * The source arrives over the wire as opaque JSON (`MessageSource` is
 * merge-extensible, so no client-side union can be exhaustive), and a durable
 * log may predate or postdate this UI; every unreadable shape therefore
 * degrades to `inject` with whatever name the record still carries.
 * @param source - the logged `user/message` source, exactly as recorded.
 * @returns the role and producer name to present for this context.
 */
export declare function contextProvenance(source: unknown): ContextProvenanceView;
/**
 * Context forms this UI version renders with a dedicated presentation. The
 * durable vocabulary (`ContextForm` in `dsh-llm`) may already be wider — an
 * unrecognized or absent value degrades to the opaque presentation rather than
 * dropping the row, so a log written by a newer or foreign producer still
 * renders.
 */
declare const KNOWN_FORMS: readonly ["instructions", "catalog", "snapshot", "notice", "relay", "recall"];
/** One durable context form this UI version knows how to present. */
export type KnownContextForm = typeof KNOWN_FORMS[number];
/**
 * Read the producer-declared form off one durable message source.
 * @param source - the logged `user/message` source, exactly as recorded.
 * @returns the form when this UI version presents it, otherwise null (opaque).
 */
export declare function contextForm(source: unknown): KnownContextForm | null;
export {};
//# sourceMappingURL=context-provenance.d.ts.map