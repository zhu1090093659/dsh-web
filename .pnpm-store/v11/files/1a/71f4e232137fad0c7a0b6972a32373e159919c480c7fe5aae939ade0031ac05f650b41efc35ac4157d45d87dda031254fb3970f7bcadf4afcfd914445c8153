import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
//#region lib/types/index.js
/**
* Default model selection for an Agent without a session-specific selection.
*
* @module @deepseek-ai/dsh-agent-default-model
*/
/** Settings namespace carrying the default model selection for future Agents. */
const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = settingsNamespace("agent-default-model");
/** Schema of the default Agent model settings section. */
const AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA = z.object({
	provider: z.string().required(),
	model: z.string().required(),
	reasoningEffort: z.string()
});
/** Project stored settings onto the Agent-facing selection type. */
function selection(settings) {
	return {
		provider: settings.provider,
		model: settings.model,
		...settings.reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) }
	};
}
/**
* Owns the default model selection independently of any Host or transport.
* The composition entry remains usable without a settings provider; when one
* is mounted, its user layer is read live.
*/
var AgentDefaultModelConfig = class extends Service {
	static Config = z.object({
		provider: z.string().required(),
		model: z.string().required()
	});
	source;
	constructor(ctx, config) {
		super(ctx, "agentDefaultModel");
		const entry = {
			provider: config.provider,
			model: config.model
		};
		this.source = () => entry;
		installSettingsSection(ctx, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, entry, {
			setSource: (current) => {
				this.source = current;
			},
			onChange: () => {}
		});
	}
	/**
	* Read the current default model selection.
	* @returns a detached provider, model, and optional reasoning selection.
	*/
	currentSelection() {
		return selection(this.source());
	}
	/**
	* Save the complete default model selection. A deployment without a settings
	* provider keeps its composition entry.
	* @param next - resolved selection accepted by an entry point.
	* @returns fulfillment after the optional settings write settles.
	*/
	async saveSelection(next) {
		await this.ctx.get("settings")?.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
			provider: next.provider,
			model: next.model,
			...next.reasoningEffort === void 0 ? {} : { reasoningEffort: String(next.reasoningEffort) }
		});
	}
};
//#endregion
export { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, AgentDefaultModelConfig, AgentDefaultModelConfig as default };
