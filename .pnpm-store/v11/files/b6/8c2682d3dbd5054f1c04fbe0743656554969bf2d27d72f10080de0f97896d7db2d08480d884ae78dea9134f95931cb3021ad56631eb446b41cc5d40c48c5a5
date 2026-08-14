import type { ConversationSnapshot, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client';
/**
 * Read one root Tool lifecycle through the internal Chat Node index.
 * @param snapshot - current Conversation snapshot.
 * @param rootCallId - root call identity and Tool Context identity.
 * @returns root lifecycle when it is materialized in the current window.
 */
export declare function rootToolCall(snapshot: ConversationSnapshot, rootCallId: string): ToolCallBlock | undefined;
/**
 * Find any root or nested Tool lifecycle through the internal Node store.
 * @param snapshot - current Conversation snapshot.
 * @param callId - root or nested call identity.
 * @returns current Tool lifecycle when materialized in the loaded window.
 */
export declare function findToolCall(snapshot: ConversationSnapshot, callId: string): ToolCallBlock | undefined;
//# sourceMappingURL=tool-node-reader.d.ts.map