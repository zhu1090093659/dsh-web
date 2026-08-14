import type { CompactionSummaryNode } from '@deepseek-ai/dsh-client-runtime/client';
import type { ChatViewSlotProps } from '../contract/slots.ts';
interface CompactionItemProps {
    node: CompactionSummaryNode;
    /** Optional command title for a manual compaction folded into this marker. */
    title?: string;
    /** Command settlement text used when structured compaction counts are unavailable. */
    fallbackSummary?: string | null;
    /** The owning view's locale seat. */
    t: ChatViewSlotProps['t'];
}
/**
 * The collapsed-by-default compaction marker.
 * @param props - the marker node off the snapshot cache.
 * @returns the marker row, with the summary disclosure when one is available.
 */
export declare const CompactionItem: import("react").MemoExoticComponent<({ node, title, fallbackSummary, t, }: CompactionItemProps) => import("react").JSX.Element>;
export {};
//# sourceMappingURL=CompactionItem.d.ts.map