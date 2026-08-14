import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { AnonymousEntries, NamedEntries, ScopedLayers, scopeTarget } from "@deepseek-ai/dsh-scope";
//#region lib/types/index.js
/**
* Registry for ordered system sections, dynamic context, tool schemas, and prompt variables.
*
* @module @deepseek-ai/dsh-system-prompt
*/
/**
* The deployment persona's section name and order. Exported because a
* composition can replace this slot — an agent preset shadows the
* deployment's persona with its own — and both sides naming the same section
* is what makes the replacement work rather than duplicate.
*/
const PERSONA_SECTION = "deployment:persona";
/** Prompt order of the persona slot; the first section a model reads. */
const PERSONA_ORDER = 0;
/** Valid variable names: how they are written between the braces. */
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/;
/** A complete `{{...}}` reference group at the scan position (validated after). */
const GROUP_AT = /^\{\{([^{}]*)\}\}/;
/** Reserved {@link Config.toolOrder} marker for unlisted tools. */
const TOOL_ORDER_REST = "<unlisted-tools>";
/**
* Validate duplicate names and the required {@link TOOL_ORDER_REST} marker.
* Registered names are checked later because plugins have not loaded yet.
*/
function validateToolOrder(toolOrder) {
	if (toolOrder === void 0) return void 0;
	const seen = /* @__PURE__ */ new Set();
	for (const name of toolOrder) {
		if (seen.has(name)) throw new Error(`toolOrder lists "${name}" more than once`);
		seen.add(name);
	}
	if (!seen.has("<unlisted-tools>")) throw new Error(`toolOrder must contain the "${TOOL_ORDER_REST}" rest entry (where unlisted tools are inserted)`);
	return toolOrder;
}
/**
* Apply configured tool order, inserting unlisted tools lexicographically at
* {@link TOOL_ORDER_REST}. Unknown configured names fail; known but restricted
* names may be absent.
*/
function orderTools(tools, toolOrder, knownNames) {
	if (tools.find((tool) => tool.name === "<unlisted-tools>") !== void 0) throw new Error(`tool provider returned reserved tool name "${TOOL_ORDER_REST}" (reserved for toolOrder's rest entry)`);
	if (toolOrder === void 0) return tools.sort(compareToolNames);
	const unknown = toolOrder.filter((name) => name !== "<unlisted-tools>" && !knownNames.has(name));
	if (unknown.length > 0) throw new Error(`toolOrder lists unregistered tool${unknown.length > 1 ? "s" : ""} ${unknown.map((name) => `"${name}"`).join(", ")}; known tools: ${[...knownNames].sort().join(", ") || "(none)"}`);
	const listed = new Set(toolOrder);
	const rest = tools.filter((tool) => !listed.has(tool.name)).sort(compareToolNames);
	return toolOrder.flatMap((name) => name === "<unlisted-tools>" ? rest : tools.filter((tool) => tool.name === name));
}
/** Lexicographic (code-unit) name comparison — locale-independent, so the order is identical on every machine. */
function compareToolNames(a, b) {
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
/**
* Interpolate strict `{{variable}}` references, drop empty sections, and join
* the rest with blank lines. Malformed, unknown, or undefined references throw;
* a lone `{{` without any later `}}` is literal prose, and substituted values
* are not scanned again.
* @param assembly - the assembly whose sections and variables to render.
* @returns the rendered prompt, or `''` when all sections are empty.
*/
function renderPrompt(assembly) {
	return assembly.sections.map((section) => interpolate(section, assembly.variables, "section")).filter((text) => text.length > 0).join("\n\n");
}
/**
* Render the complete dynamic context snapshot.
* @param assembly - the assembly whose contexts and variables to render.
* @returns the current full snapshot, or `''` when no context is active.
*/
function renderContextSnapshot(assembly) {
	return joinContextSections(renderContextSections(assembly));
}
/**
* The model-facing snapshot text for an already-rendered section list.
*
* A caller that also needs the sections renders them once and joins here, so a
* request does not interpolate every context twice.
* @param sections - sections from {@link renderContextSections}.
* @returns the current full snapshot, or `''` when no context is active.
*/
function joinContextSections(sections) {
	const body = sections.map((section) => section.text).join("\n\n");
	if (body.length === 0) return "";
	return `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${body}`;
}
/**
* The same snapshot, kept as the named contributions it was assembled from.
*
* {@link renderContextSnapshot} joins these for the model; a consumer that
* presents the snapshot uses them to attribute each part to the subsystem that
* contributed it, without re-splitting the joined prose.
* @param assembly - the assembly whose contexts and variables to render.
* @returns one entry per contributing context that rendered to non-empty text.
*/
function renderContextSections(assembly) {
	return assembly.contexts.map((context) => ({
		name: context.name,
		text: interpolate(context, assembly.variables, "context")
	})).filter((section) => section.text.length > 0);
}
/** Interpolate one section or context and attribute diagnostics to its owning input. */
function interpolate(input, variables, kind) {
	const text = input.text;
	let result = "";
	let last = 0;
	for (let open = text.indexOf("{{"); open >= 0; open = text.indexOf("{{", last)) {
		const group = GROUP_AT.exec(text.slice(open));
		if (group === null) {
			if (text.indexOf("}}", open + 2) >= 0) throw new Error(`malformed prompt variable reference at "${text.slice(open, open + 16)}…" in ${kind} "${input.name}" (references are complete simple {{name}} groups)`);
			result += text.slice(last, open + 2);
			last = open + 2;
			continue;
		}
		const name = group[0].slice(2, -2);
		if (!VARIABLE_NAME.test(name)) throw new Error(`malformed prompt variable reference "{{${name}}}" in ${kind} "${input.name}" (variable names match ${String(VARIABLE_NAME)})`);
		if (!Object.hasOwn(variables, name)) {
			const known = Object.keys(variables);
			throw new Error(`unknown prompt variable "{{${name}}}" in ${kind} "${input.name}"; registered variables: ${known.length > 0 ? known.join(", ") : "(none)"}`);
		}
		const value = variables[name];
		if (value === void 0) throw new Error(`prompt variable "{{${name}}}" has no value for this assembly (${kind} "${input.name}")`);
		result += text.slice(last, open) + value;
		last = open + group[0].length;
	}
	return result + text.slice(last);
}
/** All prompt registrations owned by one global or scoped layer. */
var PromptLayer = class {
	sections;
	contexts;
	runtimeContextSuppressors = new AnonymousEntries();
	toolProviders = new AnonymousEntries();
	variables;
	/**
	* Create one prompt layer with diagnostics specific to its ownership scope.
	* @param scope - the scoped owner, or `undefined` for global registrations.
	*/
	constructor(scope) {
		this.sections = new NamedEntries((name) => /* @__PURE__ */ new Error(scope === void 0 ? `prompt section "${name}" is already registered (for a per-agent override, register through that agent's \`agent.ctx\` instead)` : `prompt section "${name}" is already registered in this scope`));
		this.contexts = new NamedEntries((name) => /* @__PURE__ */ new Error(scope === void 0 ? `prompt context "${name}" is already registered (for a per-agent override, register through that agent's \`agent.ctx\` instead)` : `prompt context "${name}" is already registered in this scope`));
		this.variables = new NamedEntries((name) => /* @__PURE__ */ new Error(scope === void 0 ? `prompt variable "${name}" is already registered (for a per-agent value, register through that agent's \`agent.ctx\` instead)` : `prompt variable "${name}" is already registered in this scope`));
	}
	/** @returns whether this layer owns no prompt registrations. */
	isEmpty() {
		return this.sections.isEmpty() && this.contexts.isEmpty() && this.runtimeContextSuppressors.isEmpty() && this.toolProviders.isEmpty() && this.variables.isEmpty();
	}
};
/** Registry service for the prompt inputs assembled before each model step. */
var SystemPrompt = class extends Service {
	static Config = z.object({
		includeHarnessIdentity: z.boolean().default(true),
		includeRuntimeContext: z.boolean().default(true),
		persona: z.string().default(""),
		toolOrder: z.array(z.string()).default(void 0)
	});
	layers = new ScopedLayers((scope) => new PromptLayer(scope), () => {
		this.ctx.emit("system-prompt/change");
	});
	toolOrder;
	constructor(ctx, config) {
		super(ctx, "systemPrompt");
		this.toolOrder = validateToolOrder(config.toolOrder);
		if (config.includeHarnessIdentity ?? true) this.section({
			name: "harness:identity",
			order: -100,
			text: "You are an AI agent powered by DeepSeek Harness."
		});
		this.section({
			name: PERSONA_SECTION,
			order: 0,
			text: config.persona ?? ""
		});
		if (!(config.includeRuntimeContext ?? true)) this.suppressRuntimeContext();
	}
	/**
	* Register an ordered prompt section in the calling context's scope. A scoped
	* section shadows a global section with the same name; duplicates within one
	* layer and non-finite orders throw. Registration and disposal emit
	* `system-prompt/change`.
	* @param section - the section to register.
	* @returns the exact Cordis effect disposer.
	*/
	section(section) {
		if (!Number.isFinite(section.order)) throw new TypeError(`prompt section "${section.name}" order must be a finite number`);
		return this.layers.effect(this.ctx, (layer) => layer.sections.insert(section.name, section), { label: "systemPrompt.section()" });
	}
	/**
	* Register ordered dynamic context in the calling context's scope. Scoped
	* entries shadow global entries with the same name.
	* @param context - the context contribution to register.
	* @returns the exact Cordis effect disposer.
	*/
	context(context) {
		if (!Number.isFinite(context.order)) throw new TypeError(`prompt context "${context.name}" order must be a finite number`);
		return this.layers.effect(this.ctx, (layer) => layer.contexts.insert(context.name, context), { label: "systemPrompt.context()" });
	}
	/**
	* Suppress every dynamic runtime-context contribution in the calling
	* context's scope without changing the services that own or enforce those
	* facts. Multiple suppressors remain independently disposable.
	* @returns the exact Cordis effect disposer.
	*/
	suppressRuntimeContext() {
		return this.layers.effect(this.ctx, (layer) => layer.runtimeContextSuppressors.append(true), { label: "systemPrompt.suppressRuntimeContext()" });
	}
	/**
	* Register a tool-schema provider in the calling context's scope. Global and
	* matching scoped providers both contribute; returning the reserved
	* {@link TOOL_ORDER_REST} name makes assembly fail.
	* @param provider - evaluated for each assembly with its context.
	* @returns the exact Cordis effect disposer.
	*/
	tools(provider) {
		return this.layers.effect(this.ctx, (layer) => layer.toolProviders.append(provider), { label: "systemPrompt.tools()" });
	}
	/**
	* Register a prompt variable in the calling context's scope. Scoped values
	* shadow globals; invalid or duplicate names throw. A provider may return
	* `undefined`, but rendering a section that references that value then fails.
	* @param name - the `[a-z][a-z0-9_]*` reference name.
	* @param provider - evaluated for each assembly.
	* @returns the exact Cordis effect disposer.
	*/
	variable(name, provider) {
		if (!VARIABLE_NAME.test(name)) throw new Error(`invalid prompt variable name "${name}" (must match ${String(VARIABLE_NAME)})`);
		return this.layers.effect(this.ctx, (layer) => layer.variables.insert(name, provider), { label: "systemPrompt.variable()" });
	}
	/**
	* Assemble global and scoped providers, detach tool parameters, apply
	* canonical ordering, then run the assembly waterfall. Scoped sections and
	* variables shadow globals. The returned waterfall value is authoritative
	* except that an effective complete section is restored afterwards as the
	* sole prompt section.
	* @param context - the optional scope and plugin-defined assembly fields.
	* @returns the post-waterfall assembly with any complete prompt enforced.
	*/
	async assemble(context = {}) {
		const scope = context.scope;
		const scopeLayers = this.layers.chainLayers(scope);
		const runtimeContextSuppressed = !this.layers.global.runtimeContextSuppressors.isEmpty() || scopeLayers.some((layer) => !layer.runtimeContextSuppressors.isEmpty());
		const variables = {};
		for (const [name, provider] of this.layers.global.variables.entries()) variables[name] = provider(context);
		for (const layer of scopeLayers) for (const [name, provider] of layer.variables.entries()) variables[name] = provider(context);
		const sectionByName = this.layers.merge(scope, (layer) => layer.sections);
		const contextByName = this.layers.merge(scope, (layer) => layer.contexts);
		const providers = [...this.layers.global.toolProviders.values(), ...scopeLayers.flatMap((layer) => [...layer.toolProviders.values()])];
		const collected = [];
		const knownNames = /* @__PURE__ */ new Set();
		for (const provider of providers) {
			const result = provider(context);
			const schemas = result.schemas.map(({ name, description, parameters }) => ({
				name,
				description,
				parameters: structuredClone(parameters)
			}));
			const acceptedKnownNames = result.knownNames ?? schemas.map((tool) => tool.name);
			collected.push(...schemas);
			for (const name of acceptedKnownNames) knownNames.add(name);
		}
		const sectionDefinitions = [...sectionByName.values()].sort((a, b) => a.order - b.order);
		const completeSections = sectionDefinitions.filter((section) => section.complete === true);
		if (completeSections.length > 1) throw new Error(`multiple complete prompt sections are active: ${completeSections.map((section) => JSON.stringify(section.name)).join(", ")}`);
		let completeSection;
		const assembly = {
			sections: sectionDefinitions.map((section) => {
				const assembled = {
					name: section.name,
					text: typeof section.text === "function" ? section.text(context) : section.text
				};
				if (section.complete === true) completeSection = { ...assembled };
				return assembled;
			}),
			contexts: runtimeContextSuppressed ? [] : [...contextByName.values()].sort((a, b) => a.order - b.order).map((entry) => ({
				name: entry.name,
				text: typeof entry.text === "function" ? entry.text(context) : entry.text
			})),
			tools: orderTools(collected, this.toolOrder, knownNames),
			variables
		};
		const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));
		if (completeSection === void 0 && !runtimeContextSuppressed) return transformed;
		return {
			...transformed,
			sections: completeSection === void 0 ? transformed.sections : [completeSection],
			contexts: runtimeContextSuppressed ? [] : transformed.contexts
		};
	}
};
//#endregion
export { PERSONA_ORDER, PERSONA_SECTION, SystemPrompt, SystemPrompt as default, TOOL_ORDER_REST, joinContextSections, renderContextSections, renderContextSnapshot, renderPrompt };
