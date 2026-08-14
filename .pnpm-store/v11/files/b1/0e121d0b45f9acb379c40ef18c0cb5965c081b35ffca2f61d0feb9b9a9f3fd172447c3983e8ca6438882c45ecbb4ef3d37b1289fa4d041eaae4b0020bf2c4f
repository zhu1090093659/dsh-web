/** Strict per-session header/body content inserted into the resident conversation layout. */
import type { ConversationSessionHeaderSlotProps, ConversationSessionSlotProps } from '../contract/slots.ts';
/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps;
/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps;
/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns the hidden blank-session header or visible title and tabs.
 */
export declare function ConversationSessionHeader({ sessionId, useSession, useSessions, useStore, actions, renderSlot, views, open, t, }: ConversationSessionHeaderProps): import("react").JSX.Element;
/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export declare function ConversationSession({ sessionId, useSession, useInput, inputActions, useStore, actions, renderSlot, views, bindDraftMirror, releaseSessionImages, }: ConversationSessionProps): import("react").JSX.Element | null;
//# sourceMappingURL=ConversationSession.d.ts.map