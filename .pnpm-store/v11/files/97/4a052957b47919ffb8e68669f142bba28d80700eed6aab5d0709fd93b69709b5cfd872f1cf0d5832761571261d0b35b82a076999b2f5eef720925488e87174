/** Bridges the `conversation` locale namespace to the zero-cordis attachment
 * atoms' label props (`@deepseek-ai/dsh-client-ui-attachment` reads no
 * application state; owners resolve every string). */
import type { AttachmentRailLabels, DropOverlayLabels, ImageLightboxLabels, MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment';
import type { ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment';
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots';
import type { ConversationKey } from './locales.ts';
/**
 * Byte count as user-facing megabytes (`10MB`, `2.5MB`).
 * @param bytes - the byte count.
 * @returns the rounded megabyte text.
 */
export declare function imageSizeText(bytes: number): string;
/**
 * Product copy for a host attachment rejection (the `attachment-error`
 * `details.reason`). User-solvable reasons name the limit and the way out;
 * reasons the user cannot act on fold into one send-failed line carrying the
 * reason code for a bug report.
 * @param t - the conversation-namespace translate.
 * @param reason - the wire `details.reason` code.
 * @param limits - projected limits interpolated into count/size copy, when known.
 * @returns the banner text.
 */
export declare function attachmentErrorText(t: Translate<ConversationKey>, reason: string, limits?: ImageAttachmentLimits): string;
/**
 * Resolve the original-image lightbox strings.
 * @param t - the conversation-namespace translate.
 * @returns the lightbox dialog and close-control labels.
 */
export declare function lightboxLabels(t: Translate<ConversationKey>): ImageLightboxLabels;
/**
 * Resolve the chat-history image strings.
 * @param t - the conversation-namespace translate.
 * @returns the message-image labels including the forwarded lightbox strings.
 */
export declare function messageImageLabels(t: Translate<ConversationKey>): MessageImageLabels;
/**
 * Resolve the full-page drop overlay strings.
 * @param t - the conversation-namespace translate.
 * @param accepting - whether drops are currently accepted.
 * @param limits - per-message limits for the desc line, when known.
 * @returns the overlay title, with the limits desc while accepting.
 */
export declare function dropOverlayLabels(t: Translate<ConversationKey>, accepting: boolean, limits?: {
    count: number;
    size: string;
}): DropOverlayLabels;
/**
 * Resolve the composer draft-image rail strings.
 * @param t - the conversation-namespace translate.
 * @returns the rail group, open-tooltip, and paging-arrow labels.
 */
export declare function attachmentRailLabels(t: Translate<ConversationKey>): AttachmentRailLabels;
//# sourceMappingURL=image-labels.d.ts.map