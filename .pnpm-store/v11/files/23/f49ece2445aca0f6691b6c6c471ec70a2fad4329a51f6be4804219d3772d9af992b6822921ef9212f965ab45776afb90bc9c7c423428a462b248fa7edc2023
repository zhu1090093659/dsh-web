/**
 * Per-session chat store shared by conversation and details registrations.
 * The plugin creates its handle at apply time so identity follows the fiber.
 */
import { type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client';
import type { CallId, ChatStoreState, SelectionTarget } from './contract/views.ts';
/** Declared action shape used to give the exported factory a stable return type. */
type ChatActions = {
    select: (draft: ChatStoreState, target: SelectionTarget | null) => void;
    setDraft: (draft: ChatStoreState, text: string) => void;
    setView: (draft: ChatStoreState, view: string) => void;
    setInspect: (draft: ChatStoreState, target: {
        callId: CallId;
    } | null) => void;
};
/**
 * Declares the per-session chat state and write surface.
 * @returns the store handle.
 */
export declare function createChatStore(): EngineStoreHandle<ChatStoreState, ChatActions>;
export {};
//# sourceMappingURL=stores.d.ts.map