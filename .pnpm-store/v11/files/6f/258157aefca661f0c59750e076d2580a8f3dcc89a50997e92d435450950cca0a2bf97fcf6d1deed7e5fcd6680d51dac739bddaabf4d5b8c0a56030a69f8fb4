/** Busy-Enter preference stored in the Host user-settings document. */
import z from '@deepseek-ai/schemastery';
/** Settings namespace owned by the conversation plugin. */
export declare const CONVERSATION_SETTINGS_NAMESPACE = "ui-conversation";
/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export declare const BUSY_ENTER_FIELD = "busyEnter";
/** Busy-Enter behaviors accepted at settings and input boundaries. */
export declare const BUSY_ENTER_BEHAVIORS: readonly ["queue", "steer"];
/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number];
/** Default preserves Enter-as-Queue for running conversations. */
export declare const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior;
/** Durable conversation section shared by the Host schema and the browser scope. */
export interface ConversationSettings {
    /** Delivery mode for plain Enter while the addressed agent is busy. */
    busyEnter: BusyEnterBehavior;
}
/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export declare const ConversationSettingsSchema: z<ConversationSettings>;
//# sourceMappingURL=submission-settings.d.ts.map