import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
//#region lib/types/submission-settings.js
/** Busy-Enter preference stored in the Host user-settings document. */
/** Settings namespace owned by the conversation plugin. */
const CONVERSATION_SETTINGS_NAMESPACE = "ui-conversation";
/** Field carrying the delivery mode for plain Enter while an agent is busy. */
const BUSY_ENTER_FIELD = "busyEnter";
/** Busy-Enter behaviors accepted at settings and input boundaries. */
const BUSY_ENTER_BEHAVIORS = ["queue", "steer"];
/** Default preserves Enter-as-Queue for running conversations. */
const DEFAULT_BUSY_ENTER_BEHAVIOR = "queue";
/** Durable conversation schema; also the wire envelope the browser scope validates against. */
const ConversationSettingsSchema = z.object({ [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR) });
//#endregion
//#region lib/types/index.js
/** Host registration for browser conversation preferences. */
/**
* Register the durable conversation section when a settings provider exists.
* @param ctx - Host context whose optional settings service owns the section.
*/
function apply(ctx) {
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.register(settingsNamespace(CONVERSATION_SETTINGS_NAMESPACE), ConversationSettingsSchema);
	});
}
//#endregion
export { BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, CONVERSATION_SETTINGS_NAMESPACE, DEFAULT_BUSY_ENTER_BEHAVIOR, apply };
