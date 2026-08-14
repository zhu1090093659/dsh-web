/**
 * Scope-addressed conversation send, cancel, and history orchestration.
 *
 * Scope addressing rides the cordis Service tracker: property access through
 * `ctx.conversation` rebinds `this.ctx` to the caller's context, so methods
 * read the session tag with `scopeOf`. Mutable state must remain reachable
 * through one property read; assignment through the tracker proxy and `#`
 * private fields bypass that rebinding.
 */
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { ComposerAttachment } from './contract/slots.ts';
import type { QueueAction, QueueItemId } from './contract/queue.ts';
import type { ComposerBlocks } from './input/blocks.ts';
import type { DraftAttachmentId, SessionInputResolver } from './input/contract.ts';
import type { InputSubmitMode } from './contract/composer-submission.ts';
/**
 * The outward conversation face (`ctx.conversation`): the scope-addressed
 * verbs and the input registry other plugins may reach — and exactly what a
 * test fake must supply.
 */
export interface IConversation {
    /** The per-session input machine registry (SessionInputResolver face). */
    readonly input: SessionInputResolver;
    /**
     * The per-session composer-block registry: how a plugin the composer
     * cannot import makes a session's input inert with its own reason.
     */
    readonly blocks: ComposerBlocks;
    /**
     * Send a prompt into the caller scope's session (queued turn).
     * @param text - prompt text, sent verbatim as one text block.
     * @returns completion; business failures reject (and land in promptError).
     */
    send(text: string): Promise<void>;
    /**
     * Apply one edit, remove, or strict steer operation to a pending queue occurrence.
     * @param itemId - agent-owned inbox occurrence identity.
     * @param action - requested queue operation.
     * @returns completion; converged strict-steer races resolve, while other failures reject.
     */
    updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void>;
    /**
     * Cancel the scoped session's in-flight turn while preserving its pending Queue.
     * @returns completion; failures reject as in send.
     */
    cancel(): Promise<void>;
    /**
     * Pull one older history page for the scoped session.
     * @returns completion of the page pull.
     */
    loadOlder(): Promise<void>;
}
/** Unsupported browser-declared image type, localized by the UI boundary. */
export declare class UnsupportedImageMediaTypeError extends Error {
    /** Browser-declared MIME value, possibly empty. */
    readonly mediaType: string;
    /** @param mediaType - Browser-declared MIME value, possibly empty. */
    constructor(mediaType: string);
}
/** Scope-addressed conversation service (root singleton, provided as `conversation`). */
export declare class ConversationController extends Service implements IConversation {
    /** The per-session input machine registry (SessionInputResolver face). */
    readonly input: SessionInputResolver;
    /** The per-session composer-block registry. */
    readonly blocks: ComposerBlocks;
    private readonly draftAttachments;
    private readonly imageUrls;
    private readonly imageGenerations;
    private readonly createdImageUrls;
    private disposed;
    /**
     * @param ctx - owning root context (the plugin apply context; the service
     * registers itself and follows that fiber's lifetime).
     * @param config - carries the SessionInputResolver and composer-block registry
     * constructed by the plugin apply (the same instances the slot inject
     * factories close over).
     */
    constructor(ctx: Context, config: {
        input: SessionInputResolver;
        blocks: ComposerBlocks;
    });
    /**
     * Send a prompt into the scoped session. Business failures also land in the
     * session snapshot's promptError (object-layer state); the rejection here
     * exists for caller choreography (the composer restores the draft on it).
     * @param text - prompt text, sent verbatim as one text block.
     */
    send(text: string): Promise<void>;
    /**
     * Submit ordered draft images with text through one host admission.
     * @param session - target session.
     * @param text - serialized prompt text.
     * @param imageIds - ordered draft-local attachment ids.
     * @param mode - queue or steer delivery selected by composer policy.
     */
    sendSession(session: SessionFace, text: string, imageIds: readonly DraftAttachmentId[], mode: InputSubmitMode): Promise<void>;
    /**
     * Create runtime-only draft images and their object URLs.
     * @param files - browser files to register after MIME validation.
     * @returns ordered draft descriptors.
     */
    createDraftImages(files: readonly File[]): readonly ComposerAttachment[];
    /**
     * Resolve ordered input-state ids to runtime-owned draft images.
     * @param ids - draft attachment ids.
     * @returns descriptors that remain live, in requested order.
     */
    draftImages(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[];
    /**
     * Release one browser-owned draft image and preview URL.
     * @param id - draft attachment id.
     */
    releaseDraftImage(id: DraftAttachmentId): void;
    /**
     * Release a set of browser-owned draft images.
     * @param attachments - descriptors to release.
     */
    releaseDraftImages(attachments: readonly ComposerAttachment[]): void;
    /**
     * Resolve and cache one session-authorized historical image URL.
     * @param sessionId - owning session authorization scope.
     * @param attachment - durable image reference.
     * @returns browser URL valid until its rendered session is released.
     */
    resolveImage(sessionId: SessionId, attachment: ImageAttachmentRef): Promise<string>;
    /**
     * Release every historical image URL owned by one rendered session.
     * @param sessionId - rendered session scope.
     */
    releaseSessionImages(sessionId: SessionId): void;
    /** Apply one operation to a pending queue occurrence. */
    updateQueue(itemId: QueueItemId, action: QueueAction): Promise<void>;
    /** Cancel the scoped session's in-flight turn while preserving Queue (failures land in promptError and reject, as in send). */
    cancel(): Promise<void>;
    /** Pull one older history page for the scoped Session. */
    loadOlder(): Promise<void>;
    /** Resolve the caller scope's session face or throw on root contexts. */
    private scopedSession;
    /** Read the caller's session scope tag via the sessions service; root contexts fail loud. */
    private scopeId;
    private requireSessions;
    /** Convert browser files to canonical base64 prompt parts. */
    private serializeImages;
}
//# sourceMappingURL=service.d.ts.map