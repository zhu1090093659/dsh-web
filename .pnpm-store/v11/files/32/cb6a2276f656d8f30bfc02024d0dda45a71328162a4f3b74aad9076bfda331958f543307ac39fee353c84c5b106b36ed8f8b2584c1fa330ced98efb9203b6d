import type { ReactNode } from 'react';
import type { ChatNodeViewProps, ChatViewSlotProps } from '../contract/slots.ts';
import { type ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment';
/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - Pending message content and conversation translator.
 * @returns the pending steering bubble.
 */
export declare function PendingSteeringBubble({ content, loadImage, t }: {
    content: readonly unknown[];
    loadImage?: ImageLoader;
    t: ChatViewSlotProps['t'];
}): ReactNode;
/** User and admitted-steering keyed Chat renderer. */
export declare const UserMessageNodeView: import("react").MemoExoticComponent<({ node, loadImage, t, }: ChatNodeViewProps<"user" | "steering">) => import("react").JSX.Element>;
/** Injected-context keyed Chat renderer. */
export declare const ContextMessageNodeView: import("react").MemoExoticComponent<({ node, t }: ChatNodeViewProps<"context">) => import("react").JSX.Element>;
/** Automatic compaction keyed Chat renderer. */
export declare const CompactionNodeView: import("react").MemoExoticComponent<({ node, t }: ChatNodeViewProps<"compaction">) => import("react").JSX.Element>;
/** Correlated retry-chain keyed Chat renderer. */
export declare const RetryNodeView: import("react").MemoExoticComponent<({ node, t }: ChatNodeViewProps<"model-retry">) => import("react").JSX.Element>;
/** Terminal turn-error keyed Chat renderer. */
export declare const TurnErrorNodeView: import("react").MemoExoticComponent<({ node, t }: ChatNodeViewProps<"turn-error">) => import("react").JSX.Element>;
/** Max-tokens turn-end notice keyed Chat renderer. */
export declare const TurnMaxTokensNodeView: import("react").MemoExoticComponent<({ t }: ChatNodeViewProps<"turn-max-tokens">) => import("react").JSX.Element>;
/** Explicit unknown-surface keyed Chat renderer. */
export declare const UnknownNodeView: import("react").MemoExoticComponent<({ node, t }: ChatNodeViewProps<"unknown">) => import("react").JSX.Element>;
//# sourceMappingURL=MessageItem.d.ts.map