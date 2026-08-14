import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client';
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives';
import { type ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment';
import type { ChatViewSlotProps } from '../contract/slots.ts';
export interface AssistantMarkdownProps {
    blocks: readonly AssistantBlock[];
    streaming: boolean;
    /** Frozen partial of an aborted turn: rendered with a stopped marker. */
    interrupted?: boolean | undefined;
    /** Session-authorized durable image loader. */
    loadImage?: ImageLoader;
    /** Resolved prose file mentions for this Assistant's closing turn. */
    mentions?: MarkdownFileMentions | undefined;
    /** The owning view's locale seat, passed down as a plain prop. */
    t: ChatViewSlotProps['t'];
}
/** Reasoning block as the Think variant summary row (figma 39:28304). */
export declare const AssistantMarkdown: import("react").MemoExoticComponent<({ blocks, streaming, interrupted, loadImage, mentions, t, }: AssistantMarkdownProps) => import("react").JSX.Element | null>;
//# sourceMappingURL=AssistantMarkdown.d.ts.map