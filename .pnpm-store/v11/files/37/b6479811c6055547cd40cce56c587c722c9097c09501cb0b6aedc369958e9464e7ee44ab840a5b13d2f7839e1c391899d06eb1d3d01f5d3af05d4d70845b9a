import type { FocusEventHandler, MouseEventHandler, ReactElement, Ref } from 'react';
/** Bubble placement relative to the anchor. */
export type TooltipSide = 'right' | 'bottom' | 'top';
/** Props Tooltip injects into its anchor child; the child's own handlers are chained ahead of the tooltip's. */
interface AnchorProps {
    ref?: Ref<HTMLElement> | undefined;
    onMouseEnter?: MouseEventHandler | undefined;
    onMouseLeave?: MouseEventHandler | undefined;
    onFocus?: FocusEventHandler | undefined;
    onBlur?: FocusEventHandler | undefined;
}
type TooltipLabel = string | (() => string);
/**
 * Attach a hover/focus tooltip to an anchor element.
 * @param props.label - bubble text, or a resolver evaluated only while the bubble is visible.
 * @param props.side - placement relative to the anchor (default 'right').
 * @param props.delayMs - hover delay in milliseconds; keyboard focus remains immediate.
 * @param props.disabled - suppress the bubble while true; the anchor renders identically so
 * toggling never remounts it (which would cut its CSS transitions).
 * @param props.maxWidth - bubble width cap in pixels, for labels long enough that the default
 * half-viewport cap would render a slab wider than the surface the anchor sits on.
 * @param props.children - a single anchor element; its own ref (callback or object) is forwarded alongside the tooltip's.
 * @returns the cloned anchor plus a fixed-position bubble while hovered/focused.
 */
export declare function Tooltip({ label, side, delayMs, disabled, maxWidth, children }: {
    label: TooltipLabel;
    side?: TooltipSide;
    delayMs?: number;
    disabled?: boolean;
    maxWidth?: number;
    children: ReactElement<AnchorProps>;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=Tooltip.d.ts.map