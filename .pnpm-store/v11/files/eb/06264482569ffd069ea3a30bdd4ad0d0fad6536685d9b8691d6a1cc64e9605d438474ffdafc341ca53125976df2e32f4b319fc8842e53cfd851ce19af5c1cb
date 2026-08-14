/** Durable attachment storage seam (`ctx.attachments`). @module @deepseek-ai/dsh-attachment */
import { Context, Service } from '@deepseek-ai/cordis';
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from './types.ts';
export { AttachmentId } from './brand.ts';
export { AttachmentError } from './error.ts';
export type { AttachmentId as AttachmentIdType, ImageAttachmentLimits, ImageAttachmentRef, ImageMediaType, SaveImageAttachment, StoredImageAttachment, } from './types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        attachments: AttachmentStore;
    }
}
/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
export declare abstract class AttachmentStore extends Service {
    constructor(ctx: Context);
    /** Deployment-resolved image policy used by authoritative and fast-path validation. */
    abstract readonly imageLimits: ImageAttachmentLimits;
    /**
     * Validate one image without persisting it.
     * Batch callers validate every member before saving any member.
     * @param input - encoded bytes, declared media type, and optional display name.
     * @returns completion after the encoded raster has been fully decoded.
     */
    abstract validateImage(input: SaveImageAttachment): Promise<void>;
    /**
     * Validate and durably commit one image before its owning session event is appended.
     * @param input - encoded bytes, declared media type, and optional display name.
     * @returns a durable content-addressed reference.
     */
    abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>;
    /**
     * Read one image and verify that bytes still match the recorded reference.
     * @param ref - durable reference from the session log.
     * @param signal - optional cancellation for backend read and verification work.
     * @returns the verified bytes and canonical reference.
     * @throws the signal reason when aborted, or a storage error when verification fails.
     */
    abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>;
}
export default AttachmentStore;
//# sourceMappingURL=index.d.ts.map