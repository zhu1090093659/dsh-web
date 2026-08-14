import { NamedEntries, ScopedLayers } from "@deepseek-ai/dsh-scope";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region lib/types/brand.js
/**
* dsh-commands' owned branded id: command lifecycle pairing across the
* session log, the wire admission response, and client-side flow pairing.
*
* The `Branded<B>` primitive lives in `@deepseek-ai/dsh-brand`; this module
* is a pure type/constructor outlet (no cordis imports, no module
* augmentation) so wire and client programs can name the brand without
* loading the host plugin's Context merges — the `dsh-llm/brand` shape.
*
* @module @deepseek-ai/dsh-commands/brand
*/
/**
* Brand a string as a {@link CommandId}.
* @param id - the executor-minted pairing id.
* @returns the same string, branded; no validation is performed.
*/
function CommandId(id) {
	return id;
}
//#endregion
//#region lib/types/index.js
/**
* Plugin-owned human-command registry shared by interactive UI adapters.
* @module @deepseek-ai/dsh-commands
*/
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
const name = "commands";
const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u;
/** All command registrations owned by one global or scoped layer. */
var CommandLayer = class {
	commands;
	/**
	* Create one command layer with diagnostics specific to its ownership scope.
	* @param scope - the scoped owner, or `undefined` for global registrations.
	*/
	constructor(scope) {
		this.commands = new NamedEntries((name) => /* @__PURE__ */ new Error(scope === void 0 ? `command "${name}" is already registered (for a per-agent variant, mount a command-injected plugin under that agent's \`agent.ctx\`)` : `command "${name}" is already registered in this scope`));
	}
	/** @returns whether this layer owns no command registrations. */
	isEmpty() {
		return this.commands.isEmpty();
	}
};
/**
* Parse an exact slash command without normalizing its trailing input.
*
* @param line - Complete candidate command line.
* @returns The parsed command, or `undefined` when the line is not a command.
*/
function parseCommand(line) {
	const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line);
	if (match === null) return void 0;
	const name = match[1];
	/* v8 ignore next -- the first capture is required whenever the regular expression matches */
	if (name === void 0) return void 0;
	return Object.freeze({
		name,
		rawInput: line.slice(match[0].length)
	});
}
/** Convert arbitrary abort reasons to one stable rejected Error. */
function abortError(signal) {
	if (signal.reason instanceof Error) return signal.reason;
	return new Error(typeof signal.reason === "string" ? signal.reason : "command aborted");
}
/** Render arbitrary thrown values without trusting their string coercion. */
function renderThrown(value) {
	try {
		return String(value);
	} catch {
		return "<unrenderable thrown value>";
	}
}
/** Stop awaiting an uncooperative handler once its owning UI request aborts. */
function withAbort(promise, signal) {
	if (signal.aborted) return Promise.reject(abortError(signal));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			signal.removeEventListener("abort", onAbort);
			reject(abortError(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(error instanceof Error ? error : new Error(`command handler rejected with a non-Error value: ${renderThrown(error)}`, { cause: error }));
		});
	});
}
/** Reject invalid command metadata before it can reach a UI protocol. */
function normalizeDefinition(definition) {
	if (!COMMAND_NAME.test(definition.name)) throw new TypeError(`command name "${definition.name}" must match ${String(COMMAND_NAME)}`);
	if (typeof definition.description !== "string") throw new TypeError(`command "${definition.name}" description must be a string`);
	if (definition.description.trim().length === 0) throw new TypeError(`command "${definition.name}" description must not be empty`);
	if (typeof definition.handler !== "function") throw new TypeError(`command "${definition.name}" handler must be a function`);
	const rawInput = definition.input;
	let input;
	if (rawInput !== void 0) {
		if (typeof rawInput !== "object" || rawInput === null || !("hint" in rawInput) || typeof rawInput.hint !== "string") throw new TypeError(`command "${definition.name}" input hint must be a string`);
		if (rawInput.hint.trim().length === 0) throw new TypeError(`command "${definition.name}" input hint must not be empty`);
		input = Object.freeze({ hint: rawInput.hint });
	}
	const normalized = Object.freeze({
		name: definition.name,
		description: definition.description,
		...input === void 0 ? {} : { input },
		...definition.recordInput === void 0 ? {} : { recordInput: definition.recordInput },
		handler: definition.handler
	});
	return {
		definition: normalized,
		descriptor: Object.freeze({
			name: normalized.name,
			description: normalized.description,
			...normalized.input === void 0 ? {} : { input: normalized.input }
		})
	};
}
/** Validate and detach an untrusted handler result at the registry boundary. */
function normalizeResult(command, value) {
	if (typeof value !== "object" || value === null || !("kind" in value)) throw new TypeError(`command "${command}" handler must return a CommandResult`);
	const result = value;
	if (result.kind === "success") {
		if (result.text !== void 0 && typeof result.text !== "string") throw new TypeError(`command "${command}" success text must be a string when supplied`);
		if (result.sourceEventSeq !== void 0 && (!Number.isSafeInteger(result.sourceEventSeq) || result.sourceEventSeq < 0)) throw new TypeError(`command "${command}" success sourceEventSeq must be a non-negative safe integer when supplied`);
		return Object.freeze({
			kind: "success",
			...result.text === void 0 ? {} : { text: result.text },
			...result.sourceEventSeq === void 0 ? {} : { sourceEventSeq: result.sourceEventSeq }
		});
	}
	if (result.kind === "error") {
		if (typeof result.text !== "string" || result.text.trim().length === 0) throw new TypeError(`command "${command}" error text must be a non-empty string`);
		return Object.freeze({
			kind: "error",
			text: result.text
		});
	}
	throw new TypeError(`command "${command}" returned unknown result kind "${String(result.kind)}"`);
}
/**
* Human-command registry. Plain-context definitions are global; definitions
* registered through a command-injected child of an agent context shadow
* globals for that agent.
*/
let CommandRuntime = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _list_decorators;
	let _execute_decorators;
	return class CommandRuntime extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_list_decorators = [Remote];
			_execute_decorators = [Remote];
			__esDecorate(this, null, _list_decorators, {
				kind: "method",
				name: "list",
				static: false,
				private: false,
				access: {
					has: (obj) => "list" in obj,
					get: (obj) => obj.list
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _execute_decorators, {
				kind: "method",
				name: "execute",
				static: false,
				private: false,
				access: {
					has: (obj) => "execute" in obj,
					get: (obj) => obj.execute
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		layers = (__runInitializers(this, _instanceExtraInitializers), new ScopedLayers((scope) => new CommandLayer(scope), () => {
			this.notifyChange();
		}));
		/** Monotonic per-instance counter behind {@link mintCommandId}. */
		commandSeq = 0;
		/** Instance token keeping minted ids unique across process restarts over one resumed log. */
		instanceToken = crypto.randomUUID().slice(0, 8);
		constructor(ctx) {
			super(ctx, "commands");
		}
		/**
		* Register a global or calling-agent-scoped command.
		* @param definition - discovery metadata and direct UI handler.
		* @returns the exact effect disposer that unregisters this definition.
		*/
		register(definition) {
			const registered = normalizeDefinition(definition);
			return this.layers.effect(this.ctx, (layer) => layer.commands.insert(registered.definition.name, registered), { label: "commands.register()" });
		}
		/**
		* List the effective immutable command descriptors for one agent.
		* @param agent - exact receiving agent and scoped-layer key.
		* @returns name-sorted descriptors after scoped shadowing.
		*/
		list(agent) {
			return Object.freeze([...this.view(agent).values()].map((command) => command.descriptor).sort((left, right) => left.name < right.name ? -1 : 1));
		}
		/**
		* Resolve one effective command definition.
		* @param agent - exact receiving agent and scoped-layer key.
		* @param name - command name without a slash.
		* @returns the scoped shadow or global definition.
		*/
		find(agent, name) {
			return this.view(agent).get(name)?.definition;
		}
		/**
		* Parse and execute a known command without sending it to the model.
		*
		* A resolved command's lifecycle is logged: `command/run` is appended
		* before the handler is invoked and `command/done` after settlement (a
		* thrown or aborted handler settles as `kind: 'error'`). Both are direct
		* log-only appends — no turn wraps them, and persistence drains them at
		* ordinary checkpoints. Admission misses (syntax or unknown name) log
		* nothing — they never entered a handler. A `command/run` append failure
		* fails the execution loud; a `command/done` append failure on the
		* handler-failure path is contained so the handler's own error stays the
		* reported failure.
		*
		* @param agent - exact receiving agent.
		* @param line - complete slash-command line.
		* @param signal - cancellation signal owned by the UI request.
		* @returns the settled execution (result + lifecycle pairing id), or
		*   `undefined` when syntax or name does not resolve.
		*/
		async execute(agent, line, signal) {
			const parsed = parseCommand(line);
			if (parsed === void 0) return void 0;
			const command = this.view(agent).get(parsed.name);
			if (command === void 0) return void 0;
			if (signal.aborted) throw abortError(signal);
			const commandId = this.mintCommandId();
			this.appendLifecycle(agent.session, "command/run", {
				commandId,
				name: parsed.name,
				...command.definition.recordInput === false ? {} : { args: parsed.rawInput },
				source: { kind: "user" }
			});
			const invocation = Object.freeze({
				commandId,
				agent,
				rawInput: parsed.rawInput,
				signal
			});
			let result;
			try {
				const output = command.definition.handler(invocation);
				result = normalizeResult(parsed.name, await withAbort(Promise.resolve(output), signal));
			} catch (error) {
				try {
					this.appendLifecycle(agent.session, "command/done", {
						commandId,
						kind: "error",
						text: error instanceof Error ? error.message : renderThrown(error)
					});
				} catch (appendError) {
					this.ctx.logger.warn(`command "${parsed.name}": command/done append failed: ${renderThrown(appendError)}`);
				}
				throw error;
			}
			this.appendLifecycle(agent.session, "command/done", {
				commandId,
				kind: result.kind,
				...result.text === void 0 ? {} : { text: result.text },
				...result.kind === "success" && result.sourceEventSeq !== void 0 ? { sourceEventSeq: result.sourceEventSeq } : {}
			});
			return Object.freeze({
				commandId,
				result
			});
		}
		/** Mint the next pairing id (monotonic; instance-token-prefixed so a resumed log never repeats one). */
		mintCommandId() {
			this.commandSeq += 1;
			return CommandId(`cmd-${this.instanceToken}-${this.commandSeq}`);
		}
		/**
		* Append one log-only lifecycle event directly: no turn is opened for it and
		* no flush is forced — persistence observes the eager `session/event` path
		* and drains at ordinary checkpoints and teardown, like every other
		* standalone plugin event.
		*/
		appendLifecycle(session, type, data) {
			return session.append.bind(session)(type, data);
		}
		/** Resolve global definitions followed by exact scoped shadows. */
		view(agent) {
			return this.layers.merge(agent, (layer) => layer.commands);
		}
		/** Notify every registry observer without making UI refresh load-bearing. */
		notifyChange() {
			for (const callback of this.ctx.events.dispatch("emit", ["commands/change"])) try {
				const returned = callback();
				Promise.resolve(returned).catch((error) => {
					this.ctx.logger.warn(`commands/change listener rejected: ${renderThrown(error)}`);
				});
			} catch (error) {
				this.ctx.logger.warn(`commands/change listener threw: ${renderThrown(error)}`);
			}
		}
	};
})();
//#endregion
export { CommandId, CommandRuntime, CommandRuntime as default, name, parseCommand };
