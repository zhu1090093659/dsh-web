import { type ReactNode } from 'react';
import type { ChatViewSlotProps } from '../contract/slots.ts';
export interface MessageIconActionsProps {
    /** Plain text the copy action writes. */
    text: string;
    /** Unix epoch ms for the clock label; omitted for transient messages. */
    time?: number | undefined;
    /** Turn wall time in ms, appended to the clock as `· Ran for 15s`; omitted when the turn's start is unknown. */
    runMs?: number | undefined;
    /** Turn first-step TTFT in ms, appended as `· TTFT 1.2s`; omitted when unrecorded. */
    ttftMs?: number | undefined;
    /** Turn decode throughput, appended as `· 34 tok/s`; omitted when unrecorded. */
    tokensPerSecond?: number | undefined;
    /** Clock before icons (user) or after (assistant). */
    clock: 'start' | 'end';
    /** Fork the session at this message; omission hides the branch action. */
    onBranch?: (() => void) | undefined;
    /** The message is not a completed transcript tail, so branch stays visible but unavailable. */
    branchUnavailable?: boolean | undefined;
    /** Parent layout class composed onto the actions row. */
    className?: string | undefined;
    /**
     * Slot-rendered actions owned by independent plugins, placed between the
     * built-in copy and branch controls.
     */
    extraActions?: ReactNode;
    /** The owning view's locale seat, passed down as a plain prop. */
    t: ChatViewSlotProps['t'];
}
/**
 * Copy / branch (/ clock) IconActions row shared by user and assistant chrome.
 * @param props - Copy text, event time, clock side, branch callback, className.
 * @returns The actions row element.
 */
export declare function MessageIconActions({ text, time, runMs, ttftMs, tokensPerSecond, clock, onBranch, branchUnavailable, className, extraActions, t, }: MessageIconActionsProps): import("react").JSX.Element;
//# sourceMappingURL=MessageIconActions.d.ts.map