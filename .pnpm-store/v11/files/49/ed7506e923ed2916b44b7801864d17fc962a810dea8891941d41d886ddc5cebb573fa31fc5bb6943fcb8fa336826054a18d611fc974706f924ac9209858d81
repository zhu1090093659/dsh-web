import type { ReactNode } from 'react';
import type { ContextMessageNode, KnownContextForm } from '@deepseek-ai/dsh-client-runtime/client';
import type { ChatViewSlotProps } from '../contract/slots.ts';
type Translate = ChatViewSlotProps['t'];
/**
 * Default presentation: the model-facing text as text, with its real line
 * breaks, and the remaining source fields beneath it. This is what every form
 * this UI version does not recognize renders as.
 * @param props - Durable content, its source, and the locale seat.
 * @returns The opaque context body.
 */
export declare function OpaqueBody({ content, source, t }: {
    content: ContextMessageNode['content'];
    source: unknown;
    t: Translate;
}): ReactNode;
/**
 * `instructions` form: the files this context reconciled, then their text.
 *
 * The text keeps its `<system-reminder>` framing verbatim — the framing is part
 * of what the model read, so hiding it would misreport the request.
 * @param props - Durable content, its source, and the locale seat.
 * @returns The instructions context body, or the opaque body when the change
 * list is unreadable.
 */
export declare function InstructionsBody({ content, source, t }: {
    content: ContextMessageNode['content'];
    source: unknown;
    t: Translate;
}): ReactNode;
/**
 * `catalog` form: the published entries as a list, read from the source rather
 * than re-parsed out of the model-facing prose.
 *
 * A catalog whose source carries no usable entries falls through to the opaque
 * body, so an older or hand-edited log still shows its text.
 * @param props - Durable content, its source, and the locale seat.
 * @returns The catalog context body, or the opaque body when the entry list is
 * unreadable.
 */
export declare function CatalogBody({ content, source, t }: {
    content: ContextMessageNode['content'];
    source: unknown;
    t: Translate;
}): ReactNode;
/**
 * `snapshot` form: the named contributions this snapshot assembled, in order.
 *
 * The sections are the same bytes the model read, split at the boundaries the
 * producer assembled them on, so a reader sees which subsystem contributed
 * which state instead of one undifferentiated wall.
 *
 * One sentence of the model-facing text is NOT in any section: the producer's
 * framing line declaring that this snapshot supersedes earlier ones. Unlike the
 * `<system-reminder>` wrapper an instruction context carries — which wraps
 * content and cannot be separated from it — that line states the form's own
 * semantics, so the body states them as a caption instead of reprinting the
 * joined prose beside the sections it was split from.
 * @param props - Durable content, its source, and the locale seat.
 * @returns The snapshot context body, or the opaque body when unreadable.
 */
export declare function SnapshotBody({ content, source, t }: {
    content: ContextMessageNode['content'];
    source: unknown;
    t: Translate;
}): ReactNode;
/**
 * `notice` form: what just happened, with the model-facing text beneath it.
 *
 * The one-line account also rides the collapsed row ({@link contextBody}), so a
 * notice is usually readable without expanding at all.
 * @param props - Durable content, its source, and the locale seat.
 * @returns The notice context body.
 */
export declare function NoticeBody({ content, t }: {
    content: ContextMessageNode['content'];
    source: unknown;
    t: Translate;
}): ReactNode;
/**
 * `relay` form: which agent sent this, then what it said.
 *
 * The sender is an opaque session id; it is shown as a field rather than a
 * label, because this client cannot resolve it to a title.
 * @param props - Durable content, its source, and the locale seat.
 * @returns The relay context body.
 */
export declare function RelayBody({ content, source, t }: {
    content: ContextMessageNode['content'];
    source: unknown;
    t: Translate;
}): ReactNode;
/**
 * `recall` form: which sessions this material came from and how much of each
 * survived the read, then the material itself.
 *
 * Completeness is the fact a reader needs first: recalled context is bounded on
 * the way in, so a card that hid the omitted count would overstate what the
 * model received.
 * @param props - Durable content, its source, and the locale seat.
 * @returns The recall context body, or the opaque body when unreadable.
 */
export declare function RecallBody({ content, source, t }: {
    content: ContextMessageNode['content'];
    source: unknown;
    t: Translate;
}): ReactNode;
/**
 * Choose the body for one context node.
 *
 * Returns the form the body actually rendered as, which is not always the
 * declared one: a declared form whose fields are unreadable falls back to
 * opaque, and the caller labels the row with what it really shows.
 * `summary` is the collapsed row's one-line account, which only a `notice`
 * records: its whole point is being readable without expanding.
 * @param form - the producer-declared form projected onto the node.
 * @param props - durable content, its source, and the locale seat.
 * @returns the rendered form (null for opaque), its collapsed summary, and its body.
 */
export declare function contextBody(form: ContextMessageNode['form'], props: {
    content: ContextMessageNode['content'];
    source: unknown;
    t: Translate;
}): {
    rendered: KnownContextForm | null;
    summary: string | null;
    body: ReactNode;
};
export {};
//# sourceMappingURL=ContextBody.d.ts.map