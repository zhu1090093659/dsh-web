window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-connection",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region lib/types/client/connection.js
		const CONNECTION_DEFAULTS = {
			backoffBaseMs: 500,
			backoffFactor: 2,
			backoffMaxMs: 1e4,
			streamOpenTimeoutMs: 3e3
		};
		function sleep(ms, signal) {
			return new Promise((resolve) => {
				const t = setTimeout(done, ms);
				signal.addEventListener("abort", done, { once: true });
				function done() {
					clearTimeout(t);
					signal.removeEventListener("abort", done);
					resolve();
				}
			});
		}
		/**
		* Opens both streams and keeps iterating (pull mode: nothing reads the socket and the tap
		* never fires unless someone for-awaits), reconnecting with exponential backoff on loss.
		* State (generation/attempt) is instance-private, never in the store.
		* The pump body feeds each frame to a sink (sink exceptions must
		* not kill the pump — a broken business layer must not drag down the connection layer).
		*/
		var ConnectionController = class {
			api;
			sinks;
			generation = 0;
			attempt = 0;
			current = null;
			running = false;
			lastState = null;
			config;
			constructor(api, sinks = {}, config = {}) {
				this.api = api;
				this.sinks = sinks;
				this.config = {
					...CONNECTION_DEFAULTS,
					...config
				};
			}
			/** Idempotent: begin the connect/pump/reconnect loop. */
			start() {
				if (this.running) return;
				this.running = true;
				this.loop();
			}
			/** Stop the loop and abort the current generation's streams. */
			stop() {
				this.running = false;
				this.current?.abort();
				this.current = null;
			}
			backoffDelay(attempt) {
				const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.config;
				const cap = Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, attempt - 1));
				return cap / 2 + Math.random() * (cap / 2);
			}
			/** Read through a method: stop() flips the flag across awaits, so narrowing from the loop condition must not stick. */
			isRunning() {
				return this.running;
			}
			/** Re-read both mutable liveness guards after a potentially reentrant sink. */
			isGenerationActive(controller) {
				return this.isRunning() && !controller.signal.aborted;
			}
			async loop() {
				while (this.running) {
					const gen = ++this.generation;
					const ac = new AbortController();
					this.current = ac;
					/* v8 ignore next -- initializer placeholder: the Promise executor
					* below runs synchronously and replaces it before anyone can call it. */
					let muxOpened = () => {};
					/* v8 ignore next -- same placeholder pattern as muxOpened. */
					let hostOpened = () => {};
					const streamsOpen = Promise.all([new Promise((resolve) => {
						muxOpened = resolve;
					}), new Promise((resolve) => {
						hostOpened = resolve;
					})]);
					const failed = new Promise((resolve) => {
						const settle = () => {
							if (gen === this.generation && !ac.signal.aborted) ac.abort();
							resolve();
						};
						this.pumpStream(this.api.events.mux({}, ac.signal, muxOpened), this.sinks.onMuxEnvelope, settle);
						this.pumpStream(this.api.events.host({}, ac.signal, hostOpened), this.sinks.onHostEnvelope, settle);
					});
					try {
						const timeout = new AbortController();
						const [description] = await Promise.all([this.api.host.describe({}), Promise.race([streamsOpen, sleep(this.config.streamOpenTimeoutMs, timeout.signal)])]);
						timeout.abort();
						const descriptionResult = description.result;
						if (!descriptionResult.ok) throw new Error(`host.describe failed: ${descriptionResult.error.code}: ${descriptionResult.error.message}`);
						if (ac.signal.aborted) throw new Error("generation aborted during readiness handshake");
						this.attempt = 0;
						this.emitState("connected");
						if (this.isGenerationActive(ac)) this.callSink(() => {
							this.sinks.onConnected?.(descriptionResult.value);
						});
					} catch {
						if (!ac.signal.aborted) ac.abort();
					}
					await failed;
					if (!this.isRunning()) return;
					this.emitState("reconnecting");
					this.attempt += 1;
					console.warn(`[web-runtime] connection lost, retry #${this.attempt}`);
					const idle = new AbortController();
					await sleep(this.backoffDelay(this.attempt), idle.signal);
				}
			}
			/** Deduplicated state emission (sink isolation applies). */
			emitState(state) {
				if (this.lastState === state) return;
				this.lastState = state;
				this.callSink(() => this.sinks.onStateChange?.(state));
			}
			async pumpStream(stream, sink, onEnd) {
				try {
					for await (const envelope of stream) {
						if (envelope.payload.type === "stream/error") break;
						if (sink !== void 0) this.callSink(() => {
							sink(envelope);
						});
					}
				} catch {}
				onEnd();
			}
			/** Sink exception isolation: a business-layer throw is logged only, never affecting pump or reconnect semantics. */
			callSink(fn) {
				try {
					fn();
				} catch (error) {
					console.error("[web-runtime] connection sink threw:", error);
				}
			}
		};
		//#endregion
		//#region ../../llm/llm/lib/types/brand.js
		/**
		* dsh-llm's owned branded ids: tool-call correlation and provider request
		* diagnostics.
		*
		* The `Branded<B>` primitive itself lives in `@deepseek-ai/dsh-brand` (a
		* zero-dependency type-only package) so every owner of a cross-boundary id can
		* brand it without depending on dsh-llm; see that package's README for the
		* nominal-typing policy.
		*
		* @module @deepseek-ai/dsh-llm/brand
		*/
		/**
		* Brand a message identifier.
		* @param id - the opaque message identifier.
		* @returns the same string, branded; no validation is performed.
		*/
		function MessageId(id) {
			return id;
		}
		/**
		* Brand a string as a {@link CallId}.
		* @param id - the provider-issued (or synthesized) call id.
		* @returns the same string, branded; no validation is performed.
		*/
		function CallId(id) {
			return id;
		}
		//#endregion
		//#region ../../llm/llm/lib/types/call-config.js
		/**
		* Deep-freeze a value in place with an iterative traversal, guarding cycles,
		* so later mutation throws without imposing a JavaScript call-stack depth cap.
		* {@link AbortSignal} objects are deliberately skipped because they are the
		* request's live cancellation channel and freezing them breaks abort.
		* @param value - the value to freeze in place.
		* @returns the same value, frozen.
		*/
		function deepFreeze(value) {
			const seen = /* @__PURE__ */ new WeakSet();
			const pending = [{
				kind: "visit",
				node: value
			}];
			while (pending.length > 0) {
				const task = pending.pop();
				/* v8 ignore next -- the loop condition guarantees one pending task. */
				if (task === void 0) continue;
				if (task.kind === "property") {
					pending.push({
						kind: "visit",
						node: task.source[task.key]
					});
					continue;
				}
				const node = task.node;
				if (node === null || typeof node !== "object") continue;
				if (node instanceof AbortSignal) continue;
				if (seen.has(node)) continue;
				seen.add(node);
				Object.freeze(node);
				const keys = Object.keys(node);
				for (let index = keys.length - 1; index >= 0; index--) {
					const key = keys[index];
					/* v8 ignore next -- the loop is bounded by the captured key count. */
					if (key === void 0) continue;
					pending.push({
						kind: "property",
						source: node,
						key
					});
				}
			}
			return value;
		}
		//#endregion
		//#region ../../llm/llm/lib/types/message.js
		/** Message value types, identity, and immutable construction helpers. */
		/**
		* Detach and deep-freeze a message whose identity already exists.
		* @param message - complete message, including its stable identity.
		* @returns an immutable snapshot that preserves the identity.
		*/
		function freezeMessage(message) {
			return deepFreeze(structuredClone(message));
		}
		/**
		* Create one identified message and freeze it before publication.
		* @param input - complete role, content, and source for a new message.
		* @returns an immutable message with a fresh stable identity.
		*/
		function createMessage(input) {
			return freezeMessage({
				...input,
				id: MessageId(crypto.randomUUID())
			});
		}
		/**
		* Create one identified user-role message and freeze it before publication.
		* @param input - complete content and source for a new user message.
		* @returns an immutable user message with a fresh stable identity.
		*/
		function createUserMessage(input) {
			return createMessage({
				...input,
				role: "user"
			});
		}
		/**
		* Create one identified model-produced assistant message and freeze it before publication.
		* @param input - complete content plus the provider, model, and optional replay state for a new assistant message.
		* @returns an immutable assistant message with fixed role/source tags and a fresh stable identity.
		*/
		function createAssistantMessage(input) {
			return createMessage({
				role: "assistant",
				content: input.content,
				source: {
					kind: "model",
					...input.source
				}
			});
		}
		/**
		* Create and freeze one identified tool-result message.
		* @param input - call identity, raw result blocks, and outcome.
		* @returns an immutable user-role tool-result message.
		*/
		function createToolResultMessage(input) {
			return createUserMessage({
				source: {
					kind: "tool",
					callId: input.callId
				},
				content: [{
					type: "tool-result",
					toolCallId: input.callId,
					content: input.content,
					isError: input.isError
				}]
			});
		}
		/**
		* Whether a stream chunk carries visible model output (the first-token
		* boundary shared by client step timing and the whole-log sessionStats
		* projection). Empty deltas (heartbeats, empty tool-call frames) do not count
		* as a first token.
		* @param chunk - the stream chunk to test.
		* @returns true when the chunk contains a non-empty text/reasoning/tool delta.
		*/
		function isTokenDelta(chunk) {
			switch (chunk.type) {
				case "text-delta":
				case "reasoning-delta": return chunk.text !== "";
				case "tool-call-delta": return chunk.argumentsDelta !== "" || chunk.name !== void 0;
				default: return false;
			}
		}
		//#endregion
		//#region ../../core/session/lib/types/surface.js
		/**
		* Surface layer on top of the session event log: an ordered view of events
		* that produce LLM messages. The append-only log remains the source of truth.
		*
		* Browser-safe: web clients consume this subpath export, so it must stay free
		* of `node:` imports (they break the vite bundle).
		*
		* @module @deepseek-ai/dsh-session/surface
		*/
		/** Runtime counterpart of the message-producing event union. */
		const SURFACE_EVENT_TYPES = new Set([
			"user/message",
			"assistant/message",
			"tool/result"
		]);
		/**
		* Whether an event type can join the model-visible surface.
		* @param type - event type to test.
		* @returns true for one of the three message-producing event types.
		*/
		function isSurfaceEligibleType(type) {
			return SURFACE_EVENT_TYPES.has(type);
		}
		/**
		* Project a single event into the LLM message it derives to, or null when it
		* produces none — a non-surface event (chunk, boundary, log-only record) or an
		* empty-content assistant/message (which exists only to host usage). This is
		* THE per-node projection rule: `Session.deriveMessages` folds it over the
		* live surface, external reconstructors and pure projections fold the same
		* function over a log prefix's surface to rebuild the exact messages any
		* request was built from. The returned message is the already frozen message
		* nested in the event wrapper and shared by delivery, durable history, and
		* model requests.
		* @param event - the event to project.
		* @returns the derived message, or null when the event produces none.
		*/
		function deriveEventMessage(event) {
			switch (event.type) {
				case "user/message": return event.data;
				case "assistant/message":
					if (event.data.message.content.length === 0) return null;
					return event.data.message;
				case "tool/result": return event.data.message;
				default: return null;
			}
		}
		/** Create an empty surface fold state. */
		function createFoldState() {
			return {
				nodes: [],
				replaceGeneration: 0
			};
		}
		/** Whether a runtime value is a non-negative safe event sequence. */
		function isEventSeq(value) {
			return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
		}
		/** Whether a runtime value is the exact positional-replacement shape. */
		function isReplaceOp(value) {
			const op = value;
			return Object.keys(op).length === 3 && Object.hasOwn(op, "op") && Object.hasOwn(op, "start") && Object.hasOwn(op, "end") && op["op"] === "replace" && isEventSeq(op["start"]) && isEventSeq(op["end"]);
		}
		/** Validate event-local surface eligibility and return its operation. */
		function surfaceOpOf(event) {
			const raw = event;
			if (!isSurfaceEligibleType(event.type)) {
				if (raw.surfaceOp !== void 0) throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry surfaceOp`);
				if (raw.sourceEventSeqs !== void 0) throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry sourceEventSeqs`);
				return;
			}
			const op = raw.surfaceOp;
			if (op === void 0) throw new Error(`session event "${event.type}" is surface-eligible and requires a surfaceOp marker`);
			if (op === "append") return op;
			if (op === null || typeof op !== "object" || Array.isArray(op)) throw new Error(`session event "${event.type}" carries an invalid surfaceOp`);
			if (!isReplaceOp(op)) throw new Error(`session event "${event.type}" carries an invalid replace surfaceOp`);
			return op;
		}
		/** Validate cited source-event seqs against prior log entries and the replacement range. */
		function assertProvenance(event, shadowedSeqs) {
			const raw = event.sourceEventSeqs;
			const sources = /* @__PURE__ */ new Set();
			if (raw !== void 0) {
				if (!Array.isArray(raw)) throw new Error(`sourceEventSeqs on event at seq ${event.seq} must be an array when present`);
				if (raw.length === 0 && event.type !== "assistant/message") throw new Error("sourceEventSeqs must not be empty except on assistant/message");
				let nonEarlierSource;
				for (const source of raw) {
					if (!isEventSeq(source)) throw new Error(`session event "${event.type}" sourceEventSeqs must densely contain non-negative safe integers`);
					sources.add(source);
					if (nonEarlierSource === void 0 && source >= event.seq) nonEarlierSource = source;
				}
				if (sources.size !== raw.length) throw new Error("sourceEventSeqs must not contain duplicates");
				if (nonEarlierSource !== void 0) throw new Error(`sourceEventSeqs must reference earlier events: ${nonEarlierSource} >= current seq ${event.seq}`);
			}
			const missing = shadowedSeqs.filter((seq) => !sources.has(seq));
			if (missing.length > 0) throw new Error(`surface replace: sourceEventSeqs must include every shadowed surface node; missing ${missing.join(", ")}`);
		}
		/** Locate one replacement range without mutating the current fold state. */
		function replacementRange(state, op) {
			const startIdx = state.nodes.indexOf(op.start);
			if (startIdx === -1) throw new Error(`surface replace: start seq ${op.start} not found in surface`);
			const endIdx = state.nodes.indexOf(op.end);
			if (endIdx === -1) throw new Error(`surface replace: end seq ${op.end} not found in surface`);
			if (startIdx > endIdx) throw new Error(`surface replace: start seq ${op.start} (index ${startIdx}) is after end seq ${op.end} (index ${endIdx})`);
			return {
				startIdx,
				endIdx,
				shadowedSeqs: state.nodes.slice(startIdx, endIdx + 1)
			};
		}
		/**
		* Deep structural equality over the session-event JSON value domain
		* (null/boolean/number/string, arrays, plain objects). Replaces
		* `node:util`'s isDeepStrictEqual to keep this module browser-safe.
		*/
		function isDeepEqualJson(a, b) {
			if (a === b) return true;
			if (Array.isArray(a) || Array.isArray(b)) {
				if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
				return a.every((item, i) => isDeepEqualJson(item, b[i]));
			}
			if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
			const aKeys = Object.keys(a);
			const bRecord = b;
			if (aKeys.length !== Object.keys(b).length) return false;
			return aKeys.every((key) => Object.hasOwn(b, key) && isDeepEqualJson(a[key], bRecord[key]));
		}
		/** Restrict a tool-result replacement to one current result's content. */
		function assertToolResultRewrite(event, shadowedSeqs, events, baseSeq) {
			if (event.type !== "tool/result") return;
			if (shadowedSeqs.length !== 1) throw new Error("tool/result surface replacement must rewrite exactly one current node");
			for (const originalSeq of shadowedSeqs) {
				const original = events[originalSeq - baseSeq];
				if (original?.type !== "tool/result") throw new Error("tool/result surface replacement must target a current tool/result");
				const originalRest = { ...original.data };
				const replacementRest = { ...event.data };
				const originalResult = original.data.message.content[0];
				const replacementResult = event.data.message.content[0];
				originalRest["message"] = {
					...original.data.message,
					content: [{
						...originalResult,
						content: null
					}]
				};
				replacementRest["message"] = {
					...event.data.message,
					content: [{
						...replacementResult,
						content: null
					}]
				};
				if (!isDeepEqualJson(originalRest, replacementRest)) throw new Error("tool/result surface replacement may change only content");
			}
		}
		/** Validate one event at its replay boundary and prepare its atomic fold transition. */
		function planSurfaceEvent(state, event, expectedSeq, events, baseSeq) {
			if (event.seq !== expectedSeq) throw new Error(`session event seq ${event.seq} is not contiguous; expected ${expectedSeq}`);
			const surfaceOp = surfaceOpOf(event);
			if (surfaceOp === void 0) return;
			if (surfaceOp === "append") {
				assertProvenance(event, []);
				return {
					kind: "append",
					seq: event.seq
				};
			}
			const range = replacementRange(state, surfaceOp);
			assertProvenance(event, range.shadowedSeqs);
			assertToolResultRewrite(event, range.shadowedSeqs, events, baseSeq);
			return {
				kind: "replace",
				seq: event.seq,
				start: surfaceOp.start,
				end: surfaceOp.end,
				...range
			};
		}
		/** Apply one event and return replacement metadata only when one occurred. */
		function applySurfaceEvent(state, event, expectedSeq, events, baseSeq) {
			return applySurfacePlan(state, planSurfaceEvent(state, event, expectedSeq, events, baseSeq));
		}
		/** Commit one previously validated surface transition. */
		function applySurfacePlan(state, plan) {
			if (plan?.kind === "append") state.nodes.push(plan.seq);
			else if (plan?.kind === "replace") {
				state.nodes.splice(plan.startIdx, plan.endIdx - plan.startIdx + 1, plan.seq);
				state.replaceGeneration += 1;
			}
			if (plan?.kind !== "replace") return;
			return {
				seq: plan.seq,
				start: plan.start,
				end: plan.end,
				shadowedSeqs: plan.shadowedSeqs
			};
		}
		/**
		* Replay a complete session log through the canonical surface fold.
		* @param events - session events in contiguous seq order.
		* @returns detached current sequences and replacement history.
		* @throws when an event violates surface metadata, source-event references, range, or tool-result rewrite rules.
		*/
		function foldSurface(events) {
			const state = createFoldState();
			const replacements = [];
			for (const [index, event] of events.entries()) {
				const replacement = applySurfaceEvent(state, event, index, events, 0);
				if (replacement !== void 0) replacements.push(replacement);
			}
			return {
				nodes: [...state.nodes],
				replacements
			};
		}
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/rpc.js
		/**
		* Four-quadrant RPC message model. Channels and messages are decoupled: HTTP,
		* WebSocket, and in-process SSE are physical carriers, while logical messages
		* are channel-independent and form a four-member discriminated union.
		* api/ contract layer: zero Node dependencies, importable from the browser.
		*/
		/**
		* Brands a string as RpcId (same precedent as core `SessionId()`). Minted by the initiator:
		* client-request → client mints; server-request → host mints (answerable frames get a stable
		* logical id, pure pushes mint a fresh one each time).
		* @param id - Raw id string (implementations mint UUIDs; tests may pass fixtures).
		* @returns The same string, branded (compile-time cast, zero runtime cost).
		*/
		function RpcId(id) {
			return id;
		}
		/**
		* Fold a transport exception into the RpcResult error branch (unified error
		* API; 'internal' as the catch-all code). Lives with RpcResult so every
		* carrier consumer folds the same way.
		* @param error - the thrown value from the carrier.
		* @returns the error branch of an RpcResult.
		*/
		function transportError(error) {
			return {
				ok: false,
				error: {
					code: "internal",
					message: error instanceof Error ? error.message : String(error),
					details: {}
				}
			};
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
		var _a$1;
		function $constructor(name, initializer, params) {
			function init(inst, def) {
				if (!inst._zod) Object.defineProperty(inst, "_zod", {
					value: {
						def,
						constr: _,
						traits: /* @__PURE__ */ new Set()
					},
					enumerable: false
				});
				if (inst._zod.traits.has(name)) return;
				inst._zod.traits.add(name);
				initializer(inst, def);
				const proto = _.prototype;
				const keys = Object.keys(proto);
				for (let i = 0; i < keys.length; i++) {
					const k = keys[i];
					if (!(k in inst)) inst[k] = proto[k].bind(inst);
				}
			}
			const Parent = params?.Parent ?? Object;
			class Definition extends Parent {}
			Object.defineProperty(Definition, "name", { value: name });
			function _(def) {
				var _a;
				const inst = params?.Parent ? new Definition() : this;
				init(inst, def);
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				for (const fn of inst._zod.deferred) fn();
				return inst;
			}
			Object.defineProperty(_, "init", { value: init });
			Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
				if (params?.Parent && inst instanceof params.Parent) return true;
				return inst?._zod?.traits?.has(name);
			} });
			Object.defineProperty(_, "name", { value: name });
			return _;
		}
		var $ZodAsyncError = class extends Error {
			constructor() {
				super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
			}
		};
		var $ZodEncodeError = class extends Error {
			constructor(name) {
				super(`Encountered unidirectional transform during encode: ${name}`);
				this.name = "ZodEncodeError";
			}
		};
		(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
		const globalConfig = globalThis.__zod_globalConfig;
		function config(newConfig) {
			if (newConfig) Object.assign(globalConfig, newConfig);
			return globalConfig;
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
		function getEnumValues(entries) {
			const numericValues = Object.values(entries).filter((v) => typeof v === "number");
			return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
		}
		function jsonStringifyReplacer(_, value) {
			if (typeof value === "bigint") return value.toString();
			return value;
		}
		function cached(getter) {
			return { get value() {
				{
					const value = getter();
					Object.defineProperty(this, "value", { value });
					return value;
				}
				throw new Error("cached value already set");
			} };
		}
		function nullish(input) {
			return input === null || input === void 0;
		}
		function cleanRegex(source) {
			const start = source.startsWith("^") ? 1 : 0;
			const end = source.endsWith("$") ? source.length - 1 : source.length;
			return source.slice(start, end);
		}
		function floatSafeRemainder(val, step) {
			const ratio = val / step;
			const roundedRatio = Math.round(ratio);
			const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
			if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
			return ratio - roundedRatio;
		}
		const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
		function defineLazy(object, key, getter) {
			let value = void 0;
			Object.defineProperty(object, key, {
				get() {
					if (value === EVALUATING) return;
					if (value === void 0) {
						value = EVALUATING;
						value = getter();
					}
					return value;
				},
				set(v) {
					Object.defineProperty(object, key, { value: v });
				},
				configurable: true
			});
		}
		function assignProp(target, prop, value) {
			Object.defineProperty(target, prop, {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			});
		}
		function mergeDefs(...defs) {
			const mergedDescriptors = {};
			for (const def of defs) Object.assign(mergedDescriptors, Object.getOwnPropertyDescriptors(def));
			return Object.defineProperties({}, mergedDescriptors);
		}
		function esc(str) {
			return JSON.stringify(str);
		}
		function slugify(input) {
			return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
		}
		const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
		function isObject(data) {
			return typeof data === "object" && data !== null && !Array.isArray(data);
		}
		const allowsEval = /* @__PURE__*/ cached(() => {
			if (globalConfig.jitless) return false;
			if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
			try {
				new Function("");
				return true;
			} catch (_) {
				return false;
			}
		});
		function isPlainObject(o) {
			if (isObject(o) === false) return false;
			const ctor = o.constructor;
			if (ctor === void 0) return true;
			if (typeof ctor !== "function") return true;
			const prot = ctor.prototype;
			if (isObject(prot) === false) return false;
			if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
			return true;
		}
		function shallowClone(o) {
			if (isPlainObject(o)) return { ...o };
			if (Array.isArray(o)) return [...o];
			if (o instanceof Map) return new Map(o);
			if (o instanceof Set) return new Set(o);
			return o;
		}
		const propertyKeyTypes = /* @__PURE__*/ new Set([
			"string",
			"number",
			"symbol"
		]);
		function escapeRegex(str) {
			return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		function clone(inst, def, params) {
			const cl = new inst._zod.constr(def ?? inst._zod.def);
			if (!def || params?.parent) cl._zod.parent = inst;
			return cl;
		}
		function normalizeParams(_params) {
			const params = _params;
			if (!params) return {};
			if (typeof params === "string") return { error: () => params };
			if (params?.message !== void 0) {
				if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
				params.error = params.message;
			}
			delete params.message;
			if (typeof params.error === "string") return {
				...params,
				error: () => params.error
			};
			return params;
		}
		function optionalKeys(shape) {
			return Object.keys(shape).filter((k) => {
				return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
			});
		}
		const NUMBER_FORMAT_RANGES = {
			safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
			int32: [-2147483648, 2147483647],
			uint32: [0, 4294967295],
			float32: [-34028234663852886e22, 34028234663852886e22],
			float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
		};
		function pick(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = {};
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						newShape[key] = currDef.shape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function omit(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = { ...schema._zod.def.shape };
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						delete newShape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function extend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) {
				const existingShape = schema._zod.def.shape;
				for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
			}
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function safeExtend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function merge(a, b) {
			if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
			return clone(a, mergeDefs(a._zod.def, {
				get shape() {
					const _shape = {
						...a._zod.def.shape,
						...b._zod.def.shape
					};
					assignProp(this, "shape", _shape);
					return _shape;
				},
				get catchall() {
					return b._zod.def.catchall;
				},
				checks: b._zod.def.checks ?? []
			}));
		}
		function partial(Class, schema, mask) {
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const oldShape = schema._zod.def.shape;
					const shape = { ...oldShape };
					if (mask) for (const key in mask) {
						if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						shape[key] = Class ? new Class({
							type: "optional",
							innerType: oldShape[key]
						}) : oldShape[key];
					}
					else for (const key in oldShape) shape[key] = Class ? new Class({
						type: "optional",
						innerType: oldShape[key]
					}) : oldShape[key];
					assignProp(this, "shape", shape);
					return shape;
				},
				checks: []
			}));
		}
		function required(Class, schema, mask) {
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const oldShape = schema._zod.def.shape;
				const shape = { ...oldShape };
				if (mask) for (const key in mask) {
					if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
					if (!mask[key]) continue;
					shape[key] = new Class({
						type: "nonoptional",
						innerType: oldShape[key]
					});
				}
				else for (const key in oldShape) shape[key] = new Class({
					type: "nonoptional",
					innerType: oldShape[key]
				});
				assignProp(this, "shape", shape);
				return shape;
			} }));
		}
		function aborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
			return false;
		}
		function explicitlyAborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
			return false;
		}
		function prefixIssues(path, issues) {
			return issues.map((iss) => {
				var _a;
				(_a = iss).path ?? (_a.path = []);
				iss.path.unshift(path);
				return iss;
			});
		}
		function unwrapMessage(message) {
			return typeof message === "string" ? message : message?.message;
		}
		function finalizeIssue(iss, ctx, config) {
			const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
			const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
			rest.path ?? (rest.path = []);
			rest.message = message;
			if (ctx?.reportInput) rest.input = _input;
			return rest;
		}
		function getLengthableOrigin(input) {
			if (Array.isArray(input)) return "array";
			if (typeof input === "string") return "string";
			return "unknown";
		}
		function issue(...args) {
			const [iss, input, inst] = args;
			if (typeof iss === "string") return {
				message: iss,
				code: "custom",
				input,
				inst
			};
			return { ...iss };
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
		const initializer$1 = (inst, def) => {
			inst.name = "$ZodError";
			Object.defineProperty(inst, "_zod", {
				value: inst._zod,
				enumerable: false
			});
			Object.defineProperty(inst, "issues", {
				value: def,
				enumerable: false
			});
			inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
			Object.defineProperty(inst, "toString", {
				value: () => inst.message,
				enumerable: false
			});
		};
		const $ZodError = $constructor("$ZodError", initializer$1);
		const $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
		function flattenError(error, mapper = (issue) => issue.message) {
			const fieldErrors = {};
			const formErrors = [];
			for (const sub of error.issues) if (sub.path.length > 0) {
				fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
				fieldErrors[sub.path[0]].push(mapper(sub));
			} else formErrors.push(mapper(sub));
			return {
				formErrors,
				fieldErrors
			};
		}
		function formatError(error, mapper = (issue) => issue.message) {
			const fieldErrors = { _errors: [] };
			const processError = (error, path = []) => {
				for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
				else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else {
					const fullpath = [...path, ...issue.path];
					if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
					else {
						let curr = fieldErrors;
						let i = 0;
						while (i < fullpath.length) {
							const el = fullpath[i];
							if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
							else {
								curr[el] = curr[el] || { _errors: [] };
								curr[el]._errors.push(mapper(issue));
							}
							curr = curr[el];
							i++;
						}
					}
				}
			};
			processError(error);
			return fieldErrors;
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
		const _parse = (_Err) => (schema, value, _ctx, _params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			if (result.issues.length) {
				const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, _params?.callee);
				throw e;
			}
			return result.value;
		};
		const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			if (result.issues.length) {
				const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, params?.callee);
				throw e;
			}
			return result.value;
		};
		const _safeParse = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length ? {
				success: false,
				error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
		const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length ? {
				success: false,
				error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
		const _encode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parse(_Err)(schema, value, ctx);
		};
		const _decode = (_Err) => (schema, value, _ctx) => {
			return _parse(_Err)(schema, value, _ctx);
		};
		const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parseAsync(_Err)(schema, value, ctx);
		};
		const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _parseAsync(_Err)(schema, value, _ctx);
		};
		const _safeEncode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParse(_Err)(schema, value, ctx);
		};
		const _safeDecode = (_Err) => (schema, value, _ctx) => {
			return _safeParse(_Err)(schema, value, _ctx);
		};
		const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParseAsync(_Err)(schema, value, ctx);
		};
		const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _safeParseAsync(_Err)(schema, value, _ctx);
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/regexes.js
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const cuid = /^[cC][0-9a-z]{6,}$/;
		const cuid2 = /^[0-9a-z]+$/;
		const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
		const xid = /^[0-9a-vA-V]{20}$/;
		const ksuid = /^[A-Za-z0-9]{27}$/;
		const nanoid = /^[a-zA-Z0-9_-]{21}$/;
		/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
		const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
		/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
		const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
		/** Returns a regex for validating an RFC 9562/4122 UUID.
		*
		* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
		const uuid = (version) => {
			if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
			return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
		};
		/** Practical email validation */
		const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
		const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
		function emoji() {
			return new RegExp(_emoji$1, "u");
		}
		const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
		const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
		const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
		const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
		const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
		const base64url = /^[A-Za-z0-9_-]*$/;
		const httpProtocol = /^https?$/;
		const e164 = /^\+[1-9]\d{6,14}$/;
		const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
		const date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
		function timeSource(args) {
			const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
			return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
		}
		function time$1(args) {
			return new RegExp(`^${timeSource(args)}$`);
		}
		function datetime$1(args) {
			const time = timeSource({ precision: args.precision });
			const opts = ["Z"];
			if (args.local) opts.push("");
			if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
			const timeRegex = `${time}(?:${opts.join("|")})`;
			return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
		}
		const string$1 = (params) => {
			const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
			return new RegExp(`^${regex}$`);
		};
		const integer = /^-?\d+$/;
		const number$1 = /^-?\d+(?:\.\d+)?$/;
		const boolean$1 = /^(?:true|false)$/i;
		const lowercase = /^[^A-Z]*$/;
		const uppercase = /^[^a-z]*$/;
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.js
		const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
			var _a;
			inst._zod ?? (inst._zod = {});
			inst._zod.def = def;
			(_a = inst._zod).onattach ?? (_a.onattach = []);
		});
		const numericOriginMap = {
			number: "number",
			bigint: "bigint",
			object: "date"
		};
		const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
				if (def.value < curr) if (def.inclusive) bag.maximum = def.value;
				else bag.exclusiveMaximum = def.value;
			});
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
				if (def.value > curr) if (def.inclusive) bag.minimum = def.value;
				else bag.exclusiveMinimum = def.value;
			});
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				var _a;
				(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
			});
			inst._zod.check = (payload) => {
				if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
				if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
				payload.issues.push({
					origin: typeof payload.value,
					code: "not_multiple_of",
					divisor: def.value,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
			$ZodCheck.init(inst, def);
			def.format = def.format || "float64";
			const isInt = def.format?.includes("int");
			const origin = isInt ? "int" : "number";
			const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				bag.minimum = minimum;
				bag.maximum = maximum;
				if (isInt) bag.pattern = integer;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (isInt) {
					if (!Number.isInteger(input)) {
						payload.issues.push({
							expected: origin,
							format: def.format,
							code: "invalid_type",
							continue: false,
							input,
							inst
						});
						return;
					}
					if (!Number.isSafeInteger(input)) {
						if (input > 0) payload.issues.push({
							input,
							code: "too_big",
							maximum: Number.MAX_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						else payload.issues.push({
							input,
							code: "too_small",
							minimum: Number.MIN_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						return;
					}
				}
				if (input < minimum) payload.issues.push({
					origin: "number",
					input,
					code: "too_small",
					minimum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
				if (input > maximum) payload.issues.push({
					origin: "number",
					input,
					code: "too_big",
					maximum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
				if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length <= def.maximum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: def.maximum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
				if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length >= def.minimum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: def.minimum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.minimum = def.length;
				bag.maximum = def.length;
				bag.length = def.length;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				const length = input.length;
				if (length === def.length) return;
				const origin = getLengthableOrigin(input);
				const tooBig = length > def.length;
				payload.issues.push({
					origin,
					...tooBig ? {
						code: "too_big",
						maximum: def.length
					} : {
						code: "too_small",
						minimum: def.length
					},
					inclusive: true,
					exact: true,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
			var _a, _b;
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				if (def.pattern) {
					bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
					bag.patterns.add(def.pattern);
				}
			});
			if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: def.format,
					input: payload.value,
					...def.pattern ? { pattern: def.pattern.toString() } : {},
					inst,
					continue: !def.abort
				});
			});
			else (_b = inst._zod).check ?? (_b.check = () => {});
		});
		const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "regex",
					input: payload.value,
					pattern: def.pattern.toString(),
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
			def.pattern ?? (def.pattern = lowercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
			def.pattern ?? (def.pattern = uppercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
			$ZodCheck.init(inst, def);
			const escapedRegex = escapeRegex(def.includes);
			const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
			def.pattern = pattern;
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.includes(def.includes, def.position)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "includes",
					includes: def.includes,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.startsWith(def.prefix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "starts_with",
					prefix: def.prefix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.endsWith(def.suffix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "ends_with",
					suffix: def.suffix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				payload.value = def.tx(payload.value);
			};
		});
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/doc.js
		var Doc = class {
			constructor(args = []) {
				this.content = [];
				this.indent = 0;
				if (this) this.args = args;
			}
			indented(fn) {
				this.indent += 1;
				fn(this);
				this.indent -= 1;
			}
			write(arg) {
				if (typeof arg === "function") {
					arg(this, { execution: "sync" });
					arg(this, { execution: "async" });
					return;
				}
				const lines = arg.split("\n").filter((x) => x);
				const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
				const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
				for (const line of dedented) this.content.push(line);
			}
			compile() {
				const F = Function;
				const args = this?.args;
				const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
				return new F(...args, lines.join("\n"));
			}
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
		const version = {
			major: 4,
			minor: 4,
			patch: 3
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js
		const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
			var _a;
			inst ?? (inst = {});
			inst._zod.def = def;
			inst._zod.bag = inst._zod.bag || {};
			inst._zod.version = version;
			const checks = [...inst._zod.def.checks ?? []];
			if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
			for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
			if (checks.length === 0) {
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred?.push(() => {
					inst._zod.run = inst._zod.parse;
				});
			} else {
				const runChecks = (payload, checks, ctx) => {
					let isAborted = aborted(payload);
					let asyncResult;
					for (const ch of checks) {
						if (ch._zod.def.when) {
							if (explicitlyAborted(payload)) continue;
							if (!ch._zod.def.when(payload)) continue;
						} else if (isAborted) continue;
						const currLen = payload.issues.length;
						const _ = ch._zod.check(payload);
						if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
						if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
							await _;
							if (payload.issues.length === currLen) return;
							if (!isAborted) isAborted = aborted(payload, currLen);
						});
						else {
							if (payload.issues.length === currLen) continue;
							if (!isAborted) isAborted = aborted(payload, currLen);
						}
					}
					if (asyncResult) return asyncResult.then(() => {
						return payload;
					});
					return payload;
				};
				const handleCanaryResult = (canary, payload, ctx) => {
					if (aborted(canary)) {
						canary.aborted = true;
						return canary;
					}
					const checkResult = runChecks(payload, checks, ctx);
					if (checkResult instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
					}
					return inst._zod.parse(checkResult, ctx);
				};
				inst._zod.run = (payload, ctx) => {
					if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
					if (ctx.direction === "backward") {
						const canary = inst._zod.parse({
							value: payload.value,
							issues: []
						}, {
							...ctx,
							skipChecks: true
						});
						if (canary instanceof Promise) return canary.then((canary) => {
							return handleCanaryResult(canary, payload, ctx);
						});
						return handleCanaryResult(canary, payload, ctx);
					}
					const result = inst._zod.parse(payload, ctx);
					if (result instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return result.then((result) => runChecks(result, checks, ctx));
					}
					return runChecks(result, checks, ctx);
				};
			}
			defineLazy(inst, "~standard", () => ({
				validate: (value) => {
					try {
						const r = safeParse$1(inst, value);
						return r.success ? { value: r.data } : { issues: r.error?.issues };
					} catch (_) {
						return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
					}
				},
				vendor: "zod",
				version: 1
			}));
		});
		const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
			inst._zod.parse = (payload, _) => {
				if (def.coerce) try {
					payload.value = String(payload.value);
				} catch (_) {}
				if (typeof payload.value === "string") return payload;
				payload.issues.push({
					expected: "string",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			$ZodString.init(inst, def);
		});
		const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
			def.pattern ?? (def.pattern = guid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
			if (def.version) {
				const v = {
					v1: 1,
					v2: 2,
					v3: 3,
					v4: 4,
					v5: 5,
					v6: 6,
					v7: 7,
					v8: 8
				}[def.version];
				if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
				def.pattern ?? (def.pattern = uuid(v));
			} else def.pattern ?? (def.pattern = uuid());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
			def.pattern ?? (def.pattern = email);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				try {
					const trimmed = payload.value.trim();
					if (!def.normalize && def.protocol?.source === httpProtocol.source) {
						if (!/^https?:\/\//i.test(trimmed)) {
							payload.issues.push({
								code: "invalid_format",
								format: "url",
								note: "Invalid URL format",
								input: payload.value,
								inst,
								continue: !def.abort
							});
							return;
						}
					}
					const url = new URL(trimmed);
					if (def.hostname) {
						def.hostname.lastIndex = 0;
						if (!def.hostname.test(url.hostname)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid hostname",
							pattern: def.hostname.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.protocol) {
						def.protocol.lastIndex = 0;
						if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid protocol",
							pattern: def.protocol.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.normalize) payload.value = url.href;
					else payload.value = trimmed;
					return;
				} catch (_) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
			def.pattern ?? (def.pattern = emoji());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
			def.pattern ?? (def.pattern = nanoid);
			$ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
			def.pattern ?? (def.pattern = cuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
			def.pattern ?? (def.pattern = cuid2);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
			def.pattern ?? (def.pattern = ulid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
			def.pattern ?? (def.pattern = xid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
			def.pattern ?? (def.pattern = ksuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
			def.pattern ?? (def.pattern = datetime$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
			def.pattern ?? (def.pattern = date$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
			def.pattern ?? (def.pattern = time$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
			def.pattern ?? (def.pattern = duration$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
			def.pattern ?? (def.pattern = ipv4);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv4`;
		});
		const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
			def.pattern ?? (def.pattern = ipv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv6`;
			inst._zod.check = (payload) => {
				try {
					new URL(`http://[${payload.value}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "ipv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv4);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				const parts = payload.value.split("/");
				try {
					if (parts.length !== 2) throw new Error();
					const [address, prefix] = parts;
					if (!prefix) throw new Error();
					const prefixNum = Number(prefix);
					if (`${prefixNum}` !== prefix) throw new Error();
					if (prefixNum < 0 || prefixNum > 128) throw new Error();
					new URL(`http://[${address}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "cidrv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		function isValidBase64(data) {
			if (data === "") return true;
			if (/\s/.test(data)) return false;
			if (data.length % 4 !== 0) return false;
			try {
				atob(data);
				return true;
			} catch {
				return false;
			}
		}
		const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
			def.pattern ?? (def.pattern = base64);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64";
			inst._zod.check = (payload) => {
				if (isValidBase64(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		function isValidBase64URL(data) {
			if (!base64url.test(data)) return false;
			const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
			return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		}
		const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
			def.pattern ?? (def.pattern = base64url);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64url";
			inst._zod.check = (payload) => {
				if (isValidBase64URL(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
			def.pattern ?? (def.pattern = e164);
			$ZodStringFormat.init(inst, def);
		});
		function isValidJWT(token, algorithm = null) {
			try {
				const tokensParts = token.split(".");
				if (tokensParts.length !== 3) return false;
				const [header] = tokensParts;
				if (!header) return false;
				const parsedHeader = JSON.parse(atob(header));
				if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
				if (!parsedHeader.alg) return false;
				if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
				return true;
			} catch {
				return false;
			}
		}
		const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidJWT(payload.value, def.alg)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "jwt",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Number(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
				const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
				payload.issues.push({
					expected: "number",
					code: "invalid_type",
					input,
					inst,
					...received ? { received } : {}
				});
				return payload;
			};
		});
		const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
			$ZodCheckNumberFormat.init(inst, def);
			$ZodNumber.init(inst, def);
		});
		const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = boolean$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Boolean(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "boolean") return payload;
				payload.issues.push({
					expected: "boolean",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload) => payload;
		});
		const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _ctx) => {
				payload.issues.push({
					expected: "never",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		function handleArrayResult(result, final, index) {
			if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
			final.value[index] = result.value;
		}
		const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!Array.isArray(input)) {
					payload.issues.push({
						expected: "array",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = Array(input.length);
				const proms = [];
				for (let i = 0; i < input.length; i++) {
					const item = input[i];
					const result = def.element._zod.run({
						value: item,
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
					else handleArrayResult(result, payload, i);
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
			const isPresent = key in input;
			if (result.issues.length) {
				if (isOptionalIn && isOptionalOut && !isPresent) return;
				final.issues.push(...prefixIssues(key, result.issues));
			}
			if (!isPresent && !isOptionalIn) {
				if (!result.issues.length) final.issues.push({
					code: "invalid_type",
					expected: "nonoptional",
					input: void 0,
					path: [key]
				});
				return;
			}
			if (result.value === void 0) {
				if (isPresent) final.value[key] = void 0;
			} else final.value[key] = result.value;
		}
		function normalizeDef(def) {
			const keys = Object.keys(def.shape);
			for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
			const okeys = optionalKeys(def.shape);
			return {
				...def,
				keys,
				keySet: new Set(keys),
				numKeys: keys.length,
				optionalKeys: new Set(okeys)
			};
		}
		function handleCatchall(proms, input, payload, ctx, def, inst) {
			const unrecognized = [];
			const keySet = def.keySet;
			const _catchall = def.catchall._zod;
			const t = _catchall.def.type;
			const isOptionalIn = _catchall.optin === "optional";
			const isOptionalOut = _catchall.optout === "optional";
			for (const key in input) {
				if (key === "__proto__") continue;
				if (keySet.has(key)) continue;
				if (t === "never") {
					unrecognized.push(key);
					continue;
				}
				const r = _catchall.run({
					value: input[key],
					issues: []
				}, ctx);
				if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
				else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
			}
			if (unrecognized.length) payload.issues.push({
				code: "unrecognized_keys",
				keys: unrecognized,
				input,
				inst
			});
			if (!proms.length) return payload;
			return Promise.all(proms).then(() => {
				return payload;
			});
		}
		const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
			$ZodType.init(inst, def);
			if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
				const sh = def.shape;
				Object.defineProperty(def, "shape", { get: () => {
					const newSh = { ...sh };
					Object.defineProperty(def, "shape", { value: newSh });
					return newSh;
				} });
			}
			const _normalized = cached(() => normalizeDef(def));
			defineLazy(inst._zod, "propValues", () => {
				const shape = def.shape;
				const propValues = {};
				for (const key in shape) {
					const field = shape[key]._zod;
					if (field.values) {
						propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
						for (const v of field.values) propValues[key].add(v);
					}
				}
				return propValues;
			});
			const isObject$1 = isObject;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$1(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = {};
				const proms = [];
				const shape = value.shape;
				for (const key of value.keys) {
					const el = shape[key];
					const isOptionalIn = el._zod.optin === "optional";
					const isOptionalOut = el._zod.optout === "optional";
					const r = el._zod.run({
						value: input[key],
						issues: []
					}, ctx);
					if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
					else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
				}
				if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
				return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
			};
		});
		const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
			$ZodObject.init(inst, def);
			const superParse = inst._zod.parse;
			const _normalized = cached(() => normalizeDef(def));
			const generateFastpass = (shape) => {
				const doc = new Doc([
					"shape",
					"payload",
					"ctx"
				]);
				const normalized = _normalized.value;
				const parseStr = (key) => {
					const k = esc(key);
					return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
				};
				doc.write(`const input = payload.value;`);
				const ids = Object.create(null);
				let counter = 0;
				for (const key of normalized.keys) ids[key] = `key_${counter++}`;
				doc.write(`const newResult = {};`);
				for (const key of normalized.keys) {
					const id = ids[key];
					const k = esc(key);
					const schema = shape[key];
					const isOptionalIn = schema?._zod?.optin === "optional";
					const isOptionalOut = schema?._zod?.optout === "optional";
					doc.write(`const ${id} = ${parseStr(key)};`);
					if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
					else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
					else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
				}
				doc.write(`payload.value = newResult;`);
				doc.write(`return payload;`);
				const fn = doc.compile();
				return (payload, ctx) => fn(shape, payload, ctx);
			};
			let fastpass;
			const isObject$2 = isObject;
			const jit = !globalConfig.jitless;
			const fastEnabled = jit && allowsEval.value;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$2(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
					if (!fastpass) fastpass = generateFastpass(def.shape);
					payload = fastpass(payload, ctx);
					if (!catchall) return payload;
					return handleCatchall([], input, payload, ctx, value, inst);
				}
				return superParse(payload, ctx);
			};
		});
		function handleUnionResults(results, final, inst, ctx) {
			for (const result of results) if (result.issues.length === 0) {
				final.value = result.value;
				return final;
			}
			const nonaborted = results.filter((r) => !aborted(r));
			if (nonaborted.length === 1) {
				final.value = nonaborted[0].value;
				return nonaborted[0];
			}
			final.issues.push({
				code: "invalid_union",
				input: final.value,
				inst,
				errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			});
			return final;
		}
		const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "values", () => {
				if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
			});
			defineLazy(inst._zod, "pattern", () => {
				if (def.options.every((o) => o._zod.pattern)) {
					const patterns = def.options.map((o) => o._zod.pattern);
					return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
				}
			});
			const first = def.options.length === 1 ? def.options[0]._zod.run : null;
			inst._zod.parse = (payload, ctx) => {
				if (first) return first(payload, ctx);
				let async = false;
				const results = [];
				for (const option of def.options) {
					const result = option._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) {
						results.push(result);
						async = true;
					} else {
						if (result.issues.length === 0) return result;
						results.push(result);
					}
				}
				if (!async) return handleUnionResults(results, payload, inst, ctx);
				return Promise.all(results).then((results) => {
					return handleUnionResults(results, payload, inst, ctx);
				});
			};
		});
		const $ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
			def.inclusive = false;
			$ZodUnion.init(inst, def);
			const _super = inst._zod.parse;
			defineLazy(inst._zod, "propValues", () => {
				const propValues = {};
				for (const option of def.options) {
					const pv = option._zod.propValues;
					if (!pv || Object.keys(pv).length === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
					for (const [k, v] of Object.entries(pv)) {
						if (!propValues[k]) propValues[k] = /* @__PURE__ */ new Set();
						for (const val of v) propValues[k].add(val);
					}
				}
				return propValues;
			});
			const disc = cached(() => {
				const opts = def.options;
				const map = /* @__PURE__ */ new Map();
				for (const o of opts) {
					const values = o._zod.propValues?.[def.discriminator];
					if (!values || values.size === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
					for (const v of values) {
						if (map.has(v)) throw new Error(`Duplicate discriminator value "${String(v)}"`);
						map.set(v, o);
					}
				}
				return map;
			});
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!isObject(input)) {
					payload.issues.push({
						code: "invalid_type",
						expected: "object",
						input,
						inst
					});
					return payload;
				}
				const opt = disc.value.get(input?.[def.discriminator]);
				if (opt) return opt._zod.run(payload, ctx);
				if (def.unionFallback || ctx.direction === "backward") return _super(payload, ctx);
				payload.issues.push({
					code: "invalid_union",
					errors: [],
					note: "No matching discriminator",
					discriminator: def.discriminator,
					options: Array.from(disc.value.keys()),
					input,
					path: [def.discriminator],
					inst
				});
				return payload;
			};
		});
		const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				const left = def.left._zod.run({
					value: input,
					issues: []
				}, ctx);
				const right = def.right._zod.run({
					value: input,
					issues: []
				}, ctx);
				if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
					return handleIntersectionResults(payload, left, right);
				});
				return handleIntersectionResults(payload, left, right);
			};
		});
		function mergeValues(a, b) {
			if (a === b) return {
				valid: true,
				data: a
			};
			if (a instanceof Date && b instanceof Date && +a === +b) return {
				valid: true,
				data: a
			};
			if (isPlainObject(a) && isPlainObject(b)) {
				const bKeys = Object.keys(b);
				const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
				const newObj = {
					...a,
					...b
				};
				for (const key of sharedKeys) {
					const sharedValue = mergeValues(a[key], b[key]);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
					};
					newObj[key] = sharedValue.data;
				}
				return {
					valid: true,
					data: newObj
				};
			}
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return {
					valid: false,
					mergeErrorPath: []
				};
				const newArray = [];
				for (let index = 0; index < a.length; index++) {
					const itemA = a[index];
					const itemB = b[index];
					const sharedValue = mergeValues(itemA, itemB);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
					};
					newArray.push(sharedValue.data);
				}
				return {
					valid: true,
					data: newArray
				};
			}
			return {
				valid: false,
				mergeErrorPath: []
			};
		}
		function handleIntersectionResults(result, left, right) {
			const unrecKeys = /* @__PURE__ */ new Map();
			let unrecIssue;
			for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
				unrecIssue ?? (unrecIssue = iss);
				for (const k of iss.keys) {
					if (!unrecKeys.has(k)) unrecKeys.set(k, {});
					unrecKeys.get(k).l = true;
				}
			} else result.issues.push(iss);
			for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
				if (!unrecKeys.has(k)) unrecKeys.set(k, {});
				unrecKeys.get(k).r = true;
			}
			else result.issues.push(iss);
			const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
			if (bothKeys.length && unrecIssue) result.issues.push({
				...unrecIssue,
				keys: bothKeys
			});
			if (aborted(result)) return result;
			const merged = mergeValues(left.value, right.value);
			if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
			result.value = merged.data;
			return result;
		}
		const $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!isPlainObject(input)) {
					payload.issues.push({
						expected: "record",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				const proms = [];
				const values = def.keyType._zod.values;
				if (values) {
					payload.value = {};
					const recordKeys = /* @__PURE__ */ new Set();
					for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
						recordKeys.add(typeof key === "number" ? key.toString() : key);
						const keyResult = def.keyType._zod.run({
							value: key,
							issues: []
						}, ctx);
						if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
						if (keyResult.issues.length) {
							payload.issues.push({
								code: "invalid_key",
								origin: "record",
								issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
								input: key,
								path: [key],
								inst
							});
							continue;
						}
						const outKey = keyResult.value;
						const result = def.valueType._zod.run({
							value: input[key],
							issues: []
						}, ctx);
						if (result instanceof Promise) proms.push(result.then((result) => {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[outKey] = result.value;
						}));
						else {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[outKey] = result.value;
						}
					}
					let unrecognized;
					for (const key in input) if (!recordKeys.has(key)) {
						unrecognized = unrecognized ?? [];
						unrecognized.push(key);
					}
					if (unrecognized && unrecognized.length > 0) payload.issues.push({
						code: "unrecognized_keys",
						input,
						inst,
						keys: unrecognized
					});
				} else {
					payload.value = {};
					for (const key of Reflect.ownKeys(input)) {
						if (key === "__proto__") continue;
						if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
						let keyResult = def.keyType._zod.run({
							value: key,
							issues: []
						}, ctx);
						if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
						if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
							const retryResult = def.keyType._zod.run({
								value: Number(key),
								issues: []
							}, ctx);
							if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
							if (retryResult.issues.length === 0) keyResult = retryResult;
						}
						if (keyResult.issues.length) {
							if (def.mode === "loose") payload.value[key] = input[key];
							else payload.issues.push({
								code: "invalid_key",
								origin: "record",
								issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
								input: key,
								path: [key],
								inst
							});
							continue;
						}
						const result = def.valueType._zod.run({
							value: input[key],
							issues: []
						}, ctx);
						if (result instanceof Promise) proms.push(result.then((result) => {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[keyResult.value] = result.value;
						}));
						else {
							if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
							payload.value[keyResult.value] = result.value;
						}
					}
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
			$ZodType.init(inst, def);
			const values = getEnumValues(def.entries);
			const valuesSet = new Set(values);
			inst._zod.values = valuesSet;
			inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (valuesSet.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
			$ZodType.init(inst, def);
			if (def.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
			const values = new Set(def.values);
			inst._zod.values = values;
			inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (values.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values: def.values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				const _out = def.transform(payload.value, payload);
				if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				if (_out instanceof Promise) throw new $ZodAsyncError();
				payload.value = _out;
				payload.fallback = true;
				return payload;
			};
		});
		function handleOptionalResult(result, input) {
			if (input === void 0 && (result.issues.length || result.fallback)) return {
				issues: [],
				value: void 0
			};
			return result;
		}
		const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.optout = "optional";
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? new Set([...def.innerType._zod.values, void 0]) : void 0;
			});
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (def.innerType._zod.optin === "optional") {
					const input = payload.value;
					const result = def.innerType._zod.run(payload, ctx);
					if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
					return handleOptionalResult(result, input);
				}
				if (payload.value === void 0) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
			inst._zod.parse = (payload, ctx) => {
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
			});
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === null) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) {
					payload.value = def.defaultValue;
					/**
					* $ZodDefault returns the default value immediately in forward direction.
					* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
					return payload;
				}
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
				return handleDefaultResult(result, def);
			};
		});
		function handleDefaultResult(payload, def) {
			if (payload.value === void 0) payload.value = def.defaultValue;
			return payload;
		}
		const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) payload.value = def.defaultValue;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => {
				const v = def.innerType._zod.values;
				return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
				return handleNonOptionalResult(result, inst);
			};
		});
		function handleNonOptionalResult(payload, inst) {
			if (!payload.issues.length && payload.value === void 0) payload.issues.push({
				code: "invalid_type",
				expected: "nonoptional",
				input: payload.value,
				inst
			});
			return payload;
		}
		const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => {
					payload.value = result.value;
					if (result.issues.length) {
						payload.value = def.catchValue({
							...payload,
							error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
							input: payload.value
						});
						payload.issues = [];
						payload.fallback = true;
					}
					return payload;
				});
				payload.value = result.value;
				if (result.issues.length) {
					payload.value = def.catchValue({
						...payload,
						error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
						input: payload.value
					});
					payload.issues = [];
					payload.fallback = true;
				}
				return payload;
			};
		});
		const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => def.in._zod.values);
			defineLazy(inst._zod, "optin", () => def.in._zod.optin);
			defineLazy(inst._zod, "optout", () => def.out._zod.optout);
			defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") {
					const right = def.out._zod.run(payload, ctx);
					if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
					return handlePipeResult(right, def.in, ctx);
				}
				const left = def.in._zod.run(payload, ctx);
				if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
				return handlePipeResult(left, def.out, ctx);
			};
		});
		function handlePipeResult(left, next, ctx) {
			if (left.issues.length) {
				left.aborted = true;
				return left;
			}
			return next._zod.run({
				value: left.value,
				issues: left.issues,
				fallback: left.fallback
			}, ctx);
		}
		const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
			defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then(handleReadonlyResult);
				return handleReadonlyResult(result);
			};
		});
		function handleReadonlyResult(payload) {
			payload.value = Object.freeze(payload.value);
			return payload;
		}
		const $ZodLazy = /*@__PURE__*/ $constructor("$ZodLazy", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "innerType", () => {
				const d = def;
				if (!d._cachedInner) d._cachedInner = def.getter();
				return d._cachedInner;
			});
			defineLazy(inst._zod, "pattern", () => inst._zod.innerType?._zod?.pattern);
			defineLazy(inst._zod, "propValues", () => inst._zod.innerType?._zod?.propValues);
			defineLazy(inst._zod, "optin", () => inst._zod.innerType?._zod?.optin ?? void 0);
			defineLazy(inst._zod, "optout", () => inst._zod.innerType?._zod?.optout ?? void 0);
			inst._zod.parse = (payload, ctx) => {
				return inst._zod.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
			$ZodCheck.init(inst, def);
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _) => {
				return payload;
			};
			inst._zod.check = (payload) => {
				const input = payload.value;
				const r = def.fn(input);
				if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
				handleRefineResult(r, payload, input, inst);
			};
		});
		function handleRefineResult(result, payload, input, inst) {
			if (!result) {
				const _iss = {
					code: "custom",
					input,
					inst,
					path: [...inst._zod.def.path ?? []],
					continue: !inst._zod.def.abort
				};
				if (inst._zod.def.params) _iss.params = inst._zod.def.params;
				payload.issues.push(issue(_iss));
			}
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
		var _a;
		var $ZodRegistry = class {
			constructor() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
			}
			add(schema, ..._meta) {
				const meta = _meta[0];
				this._map.set(schema, meta);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
				return this;
			}
			clear() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
				return this;
			}
			remove(schema) {
				const meta = this._map.get(schema);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
				this._map.delete(schema);
				return this;
			}
			get(schema) {
				const p = schema._zod.parent;
				if (p) {
					const pm = { ...this.get(p) ?? {} };
					delete pm.id;
					const f = {
						...pm,
						...this._map.get(schema)
					};
					return Object.keys(f).length ? f : void 0;
				}
				return this._map.get(schema);
			}
			has(schema) {
				return this._map.has(schema);
			}
		};
		function registry() {
			return new $ZodRegistry();
		}
		(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
		const globalRegistry = globalThis.__zod_globalRegistry;
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
		// @__NO_SIDE_EFFECTS__
		function _string(Class, params) {
			return new Class({
				type: "string",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _email(Class, params) {
			return new Class({
				type: "string",
				format: "email",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _guid(Class, params) {
			return new Class({
				type: "string",
				format: "guid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuid(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv4(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v4",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv6(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v6",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv7(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v7",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _url(Class, params) {
			return new Class({
				type: "string",
				format: "url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _emoji(Class, params) {
			return new Class({
				type: "string",
				format: "emoji",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _nanoid(Class, params) {
			return new Class({
				type: "string",
				format: "nanoid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link _cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		// @__NO_SIDE_EFFECTS__
		function _cuid(Class, params) {
			return new Class({
				type: "string",
				format: "cuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cuid2(Class, params) {
			return new Class({
				type: "string",
				format: "cuid2",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ulid(Class, params) {
			return new Class({
				type: "string",
				format: "ulid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _xid(Class, params) {
			return new Class({
				type: "string",
				format: "xid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ksuid(Class, params) {
			return new Class({
				type: "string",
				format: "ksuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv4(Class, params) {
			return new Class({
				type: "string",
				format: "ipv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv6(Class, params) {
			return new Class({
				type: "string",
				format: "ipv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv4(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv6(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64(Class, params) {
			return new Class({
				type: "string",
				format: "base64",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64url(Class, params) {
			return new Class({
				type: "string",
				format: "base64url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _e164(Class, params) {
			return new Class({
				type: "string",
				format: "e164",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _jwt(Class, params) {
			return new Class({
				type: "string",
				format: "jwt",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDateTime(Class, params) {
			return new Class({
				type: "string",
				format: "datetime",
				check: "string_format",
				offset: false,
				local: false,
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDate(Class, params) {
			return new Class({
				type: "string",
				format: "date",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoTime(Class, params) {
			return new Class({
				type: "string",
				format: "time",
				check: "string_format",
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDuration(Class, params) {
			return new Class({
				type: "string",
				format: "duration",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _number(Class, params) {
			return new Class({
				type: "number",
				checks: [],
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _int(Class, params) {
			return new Class({
				type: "number",
				check: "number_format",
				abort: false,
				format: "safeint",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _boolean(Class, params) {
			return new Class({
				type: "boolean",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _unknown(Class) {
			return new Class({ type: "unknown" });
		}
		// @__NO_SIDE_EFFECTS__
		function _never(Class, params) {
			return new Class({
				type: "never",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lt(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lte(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gt(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gte(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _multipleOf(value, params) {
			return new $ZodCheckMultipleOf({
				check: "multiple_of",
				...normalizeParams(params),
				value
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _maxLength(maximum, params) {
			return new $ZodCheckMaxLength({
				check: "max_length",
				...normalizeParams(params),
				maximum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _minLength(minimum, params) {
			return new $ZodCheckMinLength({
				check: "min_length",
				...normalizeParams(params),
				minimum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _length(length, params) {
			return new $ZodCheckLengthEquals({
				check: "length_equals",
				...normalizeParams(params),
				length
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _regex(pattern, params) {
			return new $ZodCheckRegex({
				check: "string_format",
				format: "regex",
				...normalizeParams(params),
				pattern
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lowercase(params) {
			return new $ZodCheckLowerCase({
				check: "string_format",
				format: "lowercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uppercase(params) {
			return new $ZodCheckUpperCase({
				check: "string_format",
				format: "uppercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _includes(includes, params) {
			return new $ZodCheckIncludes({
				check: "string_format",
				format: "includes",
				...normalizeParams(params),
				includes
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _startsWith(prefix, params) {
			return new $ZodCheckStartsWith({
				check: "string_format",
				format: "starts_with",
				...normalizeParams(params),
				prefix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _endsWith(suffix, params) {
			return new $ZodCheckEndsWith({
				check: "string_format",
				format: "ends_with",
				...normalizeParams(params),
				suffix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _overwrite(tx) {
			return new $ZodCheckOverwrite({
				check: "overwrite",
				tx
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _normalize(form) {
			return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
		}
		// @__NO_SIDE_EFFECTS__
		function _trim() {
			return /* @__PURE__ */ _overwrite((input) => input.trim());
		}
		// @__NO_SIDE_EFFECTS__
		function _toLowerCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _toUpperCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _slugify() {
			return /* @__PURE__ */ _overwrite((input) => slugify(input));
		}
		// @__NO_SIDE_EFFECTS__
		function _array(Class, element, params) {
			return new Class({
				type: "array",
				element,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _custom(Class, fn, _params) {
			const norm = normalizeParams(_params);
			norm.abort ?? (norm.abort = true);
			return new Class({
				type: "custom",
				check: "custom",
				fn,
				...norm
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _refine(Class, fn, _params) {
			return new Class({
				type: "custom",
				check: "custom",
				fn,
				...normalizeParams(_params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _superRefine(fn, params) {
			const ch = /* @__PURE__ */ _check((payload) => {
				payload.addIssue = (issue$2) => {
					if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
					else {
						const _issue = issue$2;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = ch);
						_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
						payload.issues.push(issue(_issue));
					}
				};
				return fn(payload.value, payload);
			}, params);
			return ch;
		}
		// @__NO_SIDE_EFFECTS__
		function _check(fn, params) {
			const ch = new $ZodCheck({
				check: "custom",
				...normalizeParams(params)
			});
			ch._zod.check = fn;
			return ch;
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
		function initializeContext(params) {
			let target = params?.target ?? "draft-2020-12";
			if (target === "draft-4") target = "draft-04";
			if (target === "draft-7") target = "draft-07";
			return {
				processors: params.processors ?? {},
				metadataRegistry: params?.metadata ?? globalRegistry,
				target,
				unrepresentable: params?.unrepresentable ?? "throw",
				override: params?.override ?? (() => {}),
				io: params?.io ?? "output",
				counter: 0,
				seen: /* @__PURE__ */ new Map(),
				cycles: params?.cycles ?? "ref",
				reused: params?.reused ?? "inline",
				external: params?.external ?? void 0
			};
		}
		function process(schema, ctx, _params = {
			path: [],
			schemaPath: []
		}) {
			var _a;
			const def = schema._zod.def;
			const seen = ctx.seen.get(schema);
			if (seen) {
				seen.count++;
				if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
				return seen.schema;
			}
			const result = {
				schema: {},
				count: 1,
				cycle: void 0,
				path: _params.path
			};
			ctx.seen.set(schema, result);
			const overrideSchema = schema._zod.toJSONSchema?.();
			if (overrideSchema) result.schema = overrideSchema;
			else {
				const params = {
					..._params,
					schemaPath: [..._params.schemaPath, schema],
					path: _params.path
				};
				if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
				else {
					const _json = result.schema;
					const processor = ctx.processors[def.type];
					if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
					processor(schema, ctx, _json, params);
				}
				const parent = schema._zod.parent;
				if (parent) {
					if (!result.ref) result.ref = parent;
					process(parent, ctx, params);
					ctx.seen.get(parent).isParent = true;
				}
			}
			const meta = ctx.metadataRegistry.get(schema);
			if (meta) Object.assign(result.schema, meta);
			if (ctx.io === "input" && isTransforming(schema)) {
				delete result.schema.examples;
				delete result.schema.default;
			}
			if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
			delete result.schema._prefault;
			return ctx.seen.get(schema).schema;
		}
		function extractDefs(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const idToSchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.entries()) {
				const id = ctx.metadataRegistry.get(entry[0])?.id;
				if (id) {
					const existing = idToSchema.get(id);
					if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
					idToSchema.set(id, entry[0]);
				}
			}
			const makeURI = (entry) => {
				const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
				if (ctx.external) {
					const externalId = ctx.external.registry.get(entry[0])?.id;
					const uriGenerator = ctx.external.uri ?? ((id) => id);
					if (externalId) return { ref: uriGenerator(externalId) };
					const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
					entry[1].defId = id;
					return {
						defId: id,
						ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
					};
				}
				if (entry[1] === root) return { ref: "#" };
				const defUriPrefix = `#/${defsSegment}/`;
				const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
				return {
					defId,
					ref: defUriPrefix + defId
				};
			};
			const extractToDef = (entry) => {
				if (entry[1].schema.$ref) return;
				const seen = entry[1];
				const { ref, defId } = makeURI(entry);
				seen.def = { ...seen.schema };
				if (defId) seen.defId = defId;
				const schema = seen.schema;
				for (const key in schema) delete schema[key];
				schema.$ref = ref;
			};
			if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (schema === entry[0]) {
					extractToDef(entry);
					continue;
				}
				if (ctx.external) {
					const ext = ctx.external.registry.get(entry[0])?.id;
					if (schema !== entry[0] && ext) {
						extractToDef(entry);
						continue;
					}
				}
				if (ctx.metadataRegistry.get(entry[0])?.id) {
					extractToDef(entry);
					continue;
				}
				if (seen.cycle) {
					extractToDef(entry);
					continue;
				}
				if (seen.count > 1) {
					if (ctx.reused === "ref") {
						extractToDef(entry);
						continue;
					}
				}
			}
		}
		function finalize(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const flattenRef = (zodSchema) => {
				const seen = ctx.seen.get(zodSchema);
				if (seen.ref === null) return;
				const schema = seen.def ?? seen.schema;
				const _cached = { ...schema };
				const ref = seen.ref;
				seen.ref = null;
				if (ref) {
					flattenRef(ref);
					const refSeen = ctx.seen.get(ref);
					const refSchema = refSeen.schema;
					if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
						schema.allOf = schema.allOf ?? [];
						schema.allOf.push(refSchema);
					} else Object.assign(schema, refSchema);
					Object.assign(schema, _cached);
					if (zodSchema._zod.parent === ref) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (!(key in _cached)) delete schema[key];
					}
					if (refSchema.$ref && refSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
					}
				}
				const parent = zodSchema._zod.parent;
				if (parent && parent !== ref) {
					flattenRef(parent);
					const parentSeen = ctx.seen.get(parent);
					if (parentSeen?.schema.$ref) {
						schema.$ref = parentSeen.schema.$ref;
						if (parentSeen.def) for (const key in schema) {
							if (key === "$ref" || key === "allOf") continue;
							if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
						}
					}
				}
				ctx.override({
					zodSchema,
					jsonSchema: schema,
					path: seen.path ?? []
				});
			};
			for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
			const result = {};
			if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
			else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
			else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
			else if (ctx.target === "openapi-3.0") {}
			if (ctx.external?.uri) {
				const id = ctx.external.registry.get(schema)?.id;
				if (!id) throw new Error("Schema is missing an `id` property");
				result.$id = ctx.external.uri(id);
			}
			Object.assign(result, root.def ?? root.schema);
			const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
			if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
			const defs = ctx.external?.defs ?? {};
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.def && seen.defId) {
					if (seen.def.id === seen.defId) delete seen.def.id;
					defs[seen.defId] = seen.def;
				}
			}
			if (ctx.external) {} else if (Object.keys(defs).length > 0) if (ctx.target === "draft-2020-12") result.$defs = defs;
			else result.definitions = defs;
			try {
				const finalized = JSON.parse(JSON.stringify(result));
				Object.defineProperty(finalized, "~standard", {
					value: {
						...schema["~standard"],
						jsonSchema: {
							input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
							output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
						}
					},
					enumerable: false,
					writable: false
				});
				return finalized;
			} catch (_err) {
				throw new Error("Error converting schema to JSON.");
			}
		}
		function isTransforming(_schema, _ctx) {
			const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
			if (ctx.seen.has(_schema)) return false;
			ctx.seen.add(_schema);
			const def = _schema._zod.def;
			if (def.type === "transform") return true;
			if (def.type === "array") return isTransforming(def.element, ctx);
			if (def.type === "set") return isTransforming(def.valueType, ctx);
			if (def.type === "lazy") return isTransforming(def.getter(), ctx);
			if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
			if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
			if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
			if (def.type === "pipe") {
				if (_schema._zod.traits.has("$ZodCodec")) return true;
				return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
			}
			if (def.type === "object") {
				for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
				return false;
			}
			if (def.type === "union") {
				for (const option of def.options) if (isTransforming(option, ctx)) return true;
				return false;
			}
			if (def.type === "tuple") {
				for (const item of def.items) if (isTransforming(item, ctx)) return true;
				if (def.rest && isTransforming(def.rest, ctx)) return true;
				return false;
			}
			return false;
		}
		/**
		* Creates a toJSONSchema method for a schema instance.
		* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
		*/
		const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
			const ctx = initializeContext({
				...params,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
			const { libraryOptions, target } = params ?? {};
			const ctx = initializeContext({
				...libraryOptions ?? {},
				target,
				io,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
		const formatMap = {
			guid: "uuid",
			url: "uri",
			datetime: "date-time",
			json_string: "json-string",
			regex: ""
		};
		const stringProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			json.type = "string";
			const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
			if (typeof minimum === "number") json.minLength = minimum;
			if (typeof maximum === "number") json.maxLength = maximum;
			if (format) {
				json.format = formatMap[format] ?? format;
				if (json.format === "") delete json.format;
				if (format === "time") delete json.format;
			}
			if (contentEncoding) json.contentEncoding = contentEncoding;
			if (patterns && patterns.size > 0) {
				const regexes = [...patterns];
				if (regexes.length === 1) json.pattern = regexes[0].source;
				else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
					...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
					pattern: regex.source
				}))];
			}
		};
		const numberProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
			if (typeof format === "string" && format.includes("int")) json.type = "integer";
			else json.type = "number";
			const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
			const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
			const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
			if (exMin) if (legacy) {
				json.minimum = exclusiveMinimum;
				json.exclusiveMinimum = true;
			} else json.exclusiveMinimum = exclusiveMinimum;
			else if (typeof minimum === "number") json.minimum = minimum;
			if (exMax) if (legacy) {
				json.maximum = exclusiveMaximum;
				json.exclusiveMaximum = true;
			} else json.exclusiveMaximum = exclusiveMaximum;
			else if (typeof maximum === "number") json.maximum = maximum;
			if (typeof multipleOf === "number") json.multipleOf = multipleOf;
		};
		const booleanProcessor = (_schema, _ctx, json, _params) => {
			json.type = "boolean";
		};
		const neverProcessor = (_schema, _ctx, json, _params) => {
			json.not = {};
		};
		const enumProcessor = (schema, _ctx, json, _params) => {
			const def = schema._zod.def;
			const values = getEnumValues(def.entries);
			if (values.every((v) => typeof v === "number")) json.type = "number";
			if (values.every((v) => typeof v === "string")) json.type = "string";
			json.enum = values;
		};
		const literalProcessor = (schema, ctx, json, _params) => {
			const def = schema._zod.def;
			const vals = [];
			for (const val of def.values) if (val === void 0) {
				if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
			} else if (typeof val === "bigint") if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
			else vals.push(Number(val));
			else vals.push(val);
			if (vals.length === 0) {} else if (vals.length === 1) {
				const val = vals[0];
				json.type = val === null ? "null" : typeof val;
				if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
				else json.const = val;
			} else {
				if (vals.every((v) => typeof v === "number")) json.type = "number";
				if (vals.every((v) => typeof v === "string")) json.type = "string";
				if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
				if (vals.every((v) => v === null)) json.type = "null";
				json.enum = vals;
			}
		};
		const customProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
		};
		const transformProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
		};
		const arrayProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const { minimum, maximum } = schema._zod.bag;
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
			json.type = "array";
			json.items = process(def.element, ctx, {
				...params,
				path: [...params.path, "items"]
			});
		};
		const objectProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			json.properties = {};
			const shape = def.shape;
			for (const key in shape) json.properties[key] = process(shape[key], ctx, {
				...params,
				path: [
					...params.path,
					"properties",
					key
				]
			});
			const allKeys = new Set(Object.keys(shape));
			const requiredKeys = new Set([...allKeys].filter((key) => {
				const v = def.shape[key]._zod;
				if (ctx.io === "input") return v.optin === void 0;
				else return v.optout === void 0;
			}));
			if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
			if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
			else if (!def.catchall) {
				if (ctx.io === "output") json.additionalProperties = false;
			} else if (def.catchall) json.additionalProperties = process(def.catchall, ctx, {
				...params,
				path: [...params.path, "additionalProperties"]
			});
		};
		const unionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const isExclusive = def.inclusive === false;
			const options = def.options.map((x, i) => process(x, ctx, {
				...params,
				path: [
					...params.path,
					isExclusive ? "oneOf" : "anyOf",
					i
				]
			}));
			if (isExclusive) json.oneOf = options;
			else json.anyOf = options;
		};
		const intersectionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const a = process(def.left, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					0
				]
			});
			const b = process(def.right, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					1
				]
			});
			const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
			json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
		};
		const recordProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			const keyType = def.keyType;
			const patterns = keyType._zod.bag?.patterns;
			if (def.mode === "loose" && patterns && patterns.size > 0) {
				const valueSchema = process(def.valueType, ctx, {
					...params,
					path: [
						...params.path,
						"patternProperties",
						"*"
					]
				});
				json.patternProperties = {};
				for (const pattern of patterns) json.patternProperties[pattern.source] = valueSchema;
			} else {
				if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") json.propertyNames = process(def.keyType, ctx, {
					...params,
					path: [...params.path, "propertyNames"]
				});
				json.additionalProperties = process(def.valueType, ctx, {
					...params,
					path: [...params.path, "additionalProperties"]
				});
			}
			const keyValues = keyType._zod.values;
			if (keyValues) {
				const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
				if (validKeyValues.length > 0) json.required = validKeyValues;
			}
		};
		const nullableProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const inner = process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			if (ctx.target === "openapi-3.0") {
				seen.ref = def.innerType;
				json.nullable = true;
			} else json.anyOf = [inner, { type: "null" }];
		};
		const nonoptionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const defaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.default = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const prefaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const catchProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			let catchValue;
			try {
				catchValue = def.catchValue(void 0);
			} catch {
				throw new Error("Dynamic catch values are not supported in JSON Schema");
			}
			json.default = catchValue;
		};
		const pipeProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			const inIsTransform = def.in._zod.traits.has("$ZodTransform");
			const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const readonlyProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.readOnly = true;
		};
		const optionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const lazyProcessor = (schema, ctx, _json, params) => {
			const innerType = schema._zod.innerType;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/iso.js
		const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
			$ZodISODateTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function datetime(params) {
			return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
		}
		const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
			$ZodISODate.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function date(params) {
			return /* @__PURE__ */ _isoDate(ZodISODate, params);
		}
		const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
			$ZodISOTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function time(params) {
			return /* @__PURE__ */ _isoTime(ZodISOTime, params);
		}
		const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
			$ZodISODuration.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function duration(params) {
			return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.js
		const initializer = (inst, issues) => {
			$ZodError.init(inst, issues);
			inst.name = "ZodError";
			Object.defineProperties(inst, {
				format: { value: (mapper) => formatError(inst, mapper) },
				flatten: { value: (mapper) => flattenError(inst, mapper) },
				addIssue: { value: (issue) => {
					inst.issues.push(issue);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				addIssues: { value: (issues) => {
					inst.issues.push(...issues);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				isEmpty: { get() {
					return inst.issues.length === 0;
				} }
			});
		};
		const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.js
		const parse = /* @__PURE__ */ _parse(ZodRealError);
		const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
		const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
		const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
		const encode = /* @__PURE__ */ _encode(ZodRealError);
		const decode = /* @__PURE__ */ _decode(ZodRealError);
		const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
		const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
		const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
		const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
		const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
		const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
		//#endregion
		//#region ../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
		const _installedGroups = /* @__PURE__ */ new WeakMap();
		function _installLazyMethods(inst, group, methods) {
			const proto = Object.getPrototypeOf(inst);
			let installed = _installedGroups.get(proto);
			if (!installed) {
				installed = /* @__PURE__ */ new Set();
				_installedGroups.set(proto, installed);
			}
			if (installed.has(group)) return;
			installed.add(group);
			for (const key in methods) {
				const fn = methods[key];
				Object.defineProperty(proto, key, {
					configurable: true,
					enumerable: false,
					get() {
						const bound = fn.bind(this);
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: bound
						});
						return bound;
					},
					set(v) {
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: v
						});
					}
				});
			}
		}
		const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
			$ZodType.init(inst, def);
			Object.assign(inst["~standard"], { jsonSchema: {
				input: createStandardJSONSchemaMethod(inst, "input"),
				output: createStandardJSONSchemaMethod(inst, "output")
			} });
			inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
			inst.def = def;
			inst.type = def.type;
			Object.defineProperty(inst, "_def", { value: def });
			inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
			inst.safeParse = (data, params) => safeParse(inst, data, params);
			inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
			inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
			inst.spa = inst.safeParseAsync;
			inst.encode = (data, params) => encode(inst, data, params);
			inst.decode = (data, params) => decode(inst, data, params);
			inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
			inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
			inst.safeEncode = (data, params) => safeEncode(inst, data, params);
			inst.safeDecode = (data, params) => safeDecode(inst, data, params);
			inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
			inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
			_installLazyMethods(inst, "ZodType", {
				check(...chks) {
					const def = this.def;
					return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
						check: ch,
						def: { check: "custom" },
						onattach: []
					} } : ch)] }), { parent: true });
				},
				with(...chks) {
					return this.check(...chks);
				},
				clone(def, params) {
					return clone(this, def, params);
				},
				brand() {
					return this;
				},
				register(reg, meta) {
					reg.add(this, meta);
					return this;
				},
				refine(check, params) {
					return this.check(refine(check, params));
				},
				superRefine(refinement, params) {
					return this.check(superRefine(refinement, params));
				},
				overwrite(fn) {
					return this.check(/* @__PURE__ */ _overwrite(fn));
				},
				optional() {
					return optional(this);
				},
				exactOptional() {
					return exactOptional(this);
				},
				nullable() {
					return nullable(this);
				},
				nullish() {
					return optional(nullable(this));
				},
				nonoptional(params) {
					return nonoptional(this, params);
				},
				array() {
					return array(this);
				},
				or(arg) {
					return union([this, arg]);
				},
				and(arg) {
					return intersection(this, arg);
				},
				transform(tx) {
					return pipe(this, transform(tx));
				},
				default(d) {
					return _default(this, d);
				},
				prefault(d) {
					return prefault(this, d);
				},
				catch(params) {
					return _catch(this, params);
				},
				pipe(target) {
					return pipe(this, target);
				},
				readonly() {
					return readonly(this);
				},
				describe(description) {
					const cl = this.clone();
					globalRegistry.add(cl, { description });
					return cl;
				},
				meta(...args) {
					if (args.length === 0) return globalRegistry.get(this);
					const cl = this.clone();
					globalRegistry.add(cl, args[0]);
					return cl;
				},
				isOptional() {
					return this.safeParse(void 0).success;
				},
				isNullable() {
					return this.safeParse(null).success;
				},
				apply(fn) {
					return fn(this);
				}
			});
			Object.defineProperty(inst, "description", {
				get() {
					return globalRegistry.get(inst)?.description;
				},
				configurable: true
			});
			return inst;
		});
		/** @internal */
		const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
			const bag = inst._zod.bag;
			inst.format = bag.format ?? null;
			inst.minLength = bag.minimum ?? null;
			inst.maxLength = bag.maximum ?? null;
			_installLazyMethods(inst, "_ZodString", {
				regex(...args) {
					return this.check(/* @__PURE__ */ _regex(...args));
				},
				includes(...args) {
					return this.check(/* @__PURE__ */ _includes(...args));
				},
				startsWith(...args) {
					return this.check(/* @__PURE__ */ _startsWith(...args));
				},
				endsWith(...args) {
					return this.check(/* @__PURE__ */ _endsWith(...args));
				},
				min(...args) {
					return this.check(/* @__PURE__ */ _minLength(...args));
				},
				max(...args) {
					return this.check(/* @__PURE__ */ _maxLength(...args));
				},
				length(...args) {
					return this.check(/* @__PURE__ */ _length(...args));
				},
				nonempty(...args) {
					return this.check(/* @__PURE__ */ _minLength(1, ...args));
				},
				lowercase(params) {
					return this.check(/* @__PURE__ */ _lowercase(params));
				},
				uppercase(params) {
					return this.check(/* @__PURE__ */ _uppercase(params));
				},
				trim() {
					return this.check(/* @__PURE__ */ _trim());
				},
				normalize(...args) {
					return this.check(/* @__PURE__ */ _normalize(...args));
				},
				toLowerCase() {
					return this.check(/* @__PURE__ */ _toLowerCase());
				},
				toUpperCase() {
					return this.check(/* @__PURE__ */ _toUpperCase());
				},
				slugify() {
					return this.check(/* @__PURE__ */ _slugify());
				}
			});
		});
		const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			_ZodString.init(inst, def);
			inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
			inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
			inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
			inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
			inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
			inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
			inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
			inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
			inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
			inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
			inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
			inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
			inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
			inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
			inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
			inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
			inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
			inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
			inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
			inst.datetime = (params) => inst.check(datetime(params));
			inst.date = (params) => inst.check(date(params));
			inst.time = (params) => inst.check(time(params));
			inst.duration = (params) => inst.check(duration(params));
		});
		function string(params) {
			return /* @__PURE__ */ _string(ZodString, params);
		}
		const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			_ZodString.init(inst, def);
		});
		const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
			$ZodEmail.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
			$ZodGUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
			$ZodUUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
			$ZodURL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
			$ZodEmoji.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
			$ZodNanoID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
			$ZodCUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
			$ZodCUID2.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
			$ZodULID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
			$ZodXID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
			$ZodKSUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
			$ZodIPv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
			$ZodIPv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
			$ZodCIDRv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
			$ZodCIDRv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
			$ZodBase64.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
			$ZodBase64URL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
			$ZodE164.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
			$ZodJWT.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
			$ZodNumber.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
			_installLazyMethods(inst, "ZodNumber", {
				gt(value, params) {
					return this.check(/* @__PURE__ */ _gt(value, params));
				},
				gte(value, params) {
					return this.check(/* @__PURE__ */ _gte(value, params));
				},
				min(value, params) {
					return this.check(/* @__PURE__ */ _gte(value, params));
				},
				lt(value, params) {
					return this.check(/* @__PURE__ */ _lt(value, params));
				},
				lte(value, params) {
					return this.check(/* @__PURE__ */ _lte(value, params));
				},
				max(value, params) {
					return this.check(/* @__PURE__ */ _lte(value, params));
				},
				int(params) {
					return this.check(int(params));
				},
				safe(params) {
					return this.check(int(params));
				},
				positive(params) {
					return this.check(/* @__PURE__ */ _gt(0, params));
				},
				nonnegative(params) {
					return this.check(/* @__PURE__ */ _gte(0, params));
				},
				negative(params) {
					return this.check(/* @__PURE__ */ _lt(0, params));
				},
				nonpositive(params) {
					return this.check(/* @__PURE__ */ _lte(0, params));
				},
				multipleOf(value, params) {
					return this.check(/* @__PURE__ */ _multipleOf(value, params));
				},
				step(value, params) {
					return this.check(/* @__PURE__ */ _multipleOf(value, params));
				},
				finite() {
					return this;
				}
			});
			const bag = inst._zod.bag;
			inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
			inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
			inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
			inst.isFinite = true;
			inst.format = bag.format ?? null;
		});
		function number(params) {
			return /* @__PURE__ */ _number(ZodNumber, params);
		}
		const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
			$ZodNumberFormat.init(inst, def);
			ZodNumber.init(inst, def);
		});
		function int(params) {
			return /* @__PURE__ */ _int(ZodNumberFormat, params);
		}
		const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
			$ZodBoolean.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
		});
		function boolean(params) {
			return /* @__PURE__ */ _boolean(ZodBoolean, params);
		}
		const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
			$ZodUnknown.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => void 0;
		});
		function unknown() {
			return /* @__PURE__ */ _unknown(ZodUnknown);
		}
		const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
			$ZodNever.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
		});
		function never(params) {
			return /* @__PURE__ */ _never(ZodNever, params);
		}
		const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
			$ZodArray.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
			inst.element = def.element;
			_installLazyMethods(inst, "ZodArray", {
				min(n, params) {
					return this.check(/* @__PURE__ */ _minLength(n, params));
				},
				nonempty(params) {
					return this.check(/* @__PURE__ */ _minLength(1, params));
				},
				max(n, params) {
					return this.check(/* @__PURE__ */ _maxLength(n, params));
				},
				length(n, params) {
					return this.check(/* @__PURE__ */ _length(n, params));
				},
				unwrap() {
					return this.element;
				}
			});
		});
		function array(element, params) {
			return /* @__PURE__ */ _array(ZodArray, element, params);
		}
		const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
			$ZodObjectJIT.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
			defineLazy(inst, "shape", () => {
				return def.shape;
			});
			_installLazyMethods(inst, "ZodObject", {
				keyof() {
					return _enum(Object.keys(this._zod.def.shape));
				},
				catchall(catchall) {
					return this.clone({
						...this._zod.def,
						catchall
					});
				},
				passthrough() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				loose() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				strict() {
					return this.clone({
						...this._zod.def,
						catchall: never()
					});
				},
				strip() {
					return this.clone({
						...this._zod.def,
						catchall: void 0
					});
				},
				extend(incoming) {
					return extend(this, incoming);
				},
				safeExtend(incoming) {
					return safeExtend(this, incoming);
				},
				merge(other) {
					return merge(this, other);
				},
				pick(mask) {
					return pick(this, mask);
				},
				omit(mask) {
					return omit(this, mask);
				},
				partial(...args) {
					return partial(ZodOptional, this, args[0]);
				},
				required(...args) {
					return required(ZodNonOptional, this, args[0]);
				}
			});
		});
		function object(shape, params) {
			return new ZodObject({
				type: "object",
				shape: shape ?? {},
				...normalizeParams(params)
			});
		}
		function looseObject(shape, params) {
			return new ZodObject({
				type: "object",
				shape,
				catchall: unknown(),
				...normalizeParams(params)
			});
		}
		const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
			$ZodUnion.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
			inst.options = def.options;
		});
		function union(options, params) {
			return new ZodUnion({
				type: "union",
				options,
				...normalizeParams(params)
			});
		}
		const ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("ZodDiscriminatedUnion", (inst, def) => {
			ZodUnion.init(inst, def);
			$ZodDiscriminatedUnion.init(inst, def);
		});
		function discriminatedUnion(discriminator, options, params) {
			return new ZodDiscriminatedUnion({
				type: "union",
				options,
				discriminator,
				...normalizeParams(params)
			});
		}
		const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
			$ZodIntersection.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
		});
		function intersection(left, right) {
			return new ZodIntersection({
				type: "intersection",
				left,
				right
			});
		}
		const ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
			$ZodRecord.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
			inst.keyType = def.keyType;
			inst.valueType = def.valueType;
		});
		function record(keyType, valueType, params) {
			if (!valueType || !valueType._zod) return new ZodRecord({
				type: "record",
				keyType: string(),
				valueType: keyType,
				...normalizeParams(valueType)
			});
			return new ZodRecord({
				type: "record",
				keyType,
				valueType,
				...normalizeParams(params)
			});
		}
		const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
			$ZodEnum.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
			inst.enum = def.entries;
			inst.options = Object.values(def.entries);
			const keys = new Set(Object.keys(def.entries));
			inst.extract = (values, params) => {
				const newEntries = {};
				for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
			inst.exclude = (values, params) => {
				const newEntries = { ...def.entries };
				for (const value of values) if (keys.has(value)) delete newEntries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
		});
		function _enum(values, params) {
			return new ZodEnum({
				type: "enum",
				entries: Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values,
				...normalizeParams(params)
			});
		}
		const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
			$ZodLiteral.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
			inst.values = new Set(def.values);
			Object.defineProperty(inst, "value", { get() {
				if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
				return def.values[0];
			} });
		});
		function literal(value, params) {
			return new ZodLiteral({
				type: "literal",
				values: Array.isArray(value) ? value : [value],
				...normalizeParams(params)
			});
		}
		const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
			$ZodTransform.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
			inst._zod.parse = (payload, _ctx) => {
				if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				payload.addIssue = (issue$1) => {
					if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
					else {
						const _issue = issue$1;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = inst);
						payload.issues.push(issue(_issue));
					}
				};
				const output = def.transform(payload.value, payload);
				if (output instanceof Promise) return output.then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				payload.value = output;
				payload.fallback = true;
				return payload;
			};
		});
		function transform(fn) {
			return new ZodTransform({
				type: "transform",
				transform: fn
			});
		}
		const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function optional(innerType) {
			return new ZodOptional({
				type: "optional",
				innerType
			});
		}
		const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
			$ZodExactOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function exactOptional(innerType) {
			return new ZodExactOptional({
				type: "optional",
				innerType
			});
		}
		const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
			$ZodNullable.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nullable(innerType) {
			return new ZodNullable({
				type: "nullable",
				innerType
			});
		}
		const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
			$ZodDefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeDefault = inst.unwrap;
		});
		function _default(innerType, defaultValue) {
			return new ZodDefault({
				type: "default",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
			$ZodPrefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function prefault(innerType, defaultValue) {
			return new ZodPrefault({
				type: "prefault",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
			$ZodNonOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nonoptional(innerType, params) {
			return new ZodNonOptional({
				type: "nonoptional",
				innerType,
				...normalizeParams(params)
			});
		}
		const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
			$ZodCatch.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeCatch = inst.unwrap;
		});
		function _catch(innerType, catchValue) {
			return new ZodCatch({
				type: "catch",
				innerType,
				catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
			});
		}
		const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
			$ZodPipe.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
			inst.in = def.in;
			inst.out = def.out;
		});
		function pipe(in_, out) {
			return new ZodPipe({
				type: "pipe",
				in: in_,
				out
			});
		}
		const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
			$ZodReadonly.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function readonly(innerType) {
			return new ZodReadonly({
				type: "readonly",
				innerType
			});
		}
		const ZodLazy = /*@__PURE__*/ $constructor("ZodLazy", (inst, def) => {
			$ZodLazy.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => lazyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.getter();
		});
		function lazy(getter) {
			return new ZodLazy({
				type: "lazy",
				getter
			});
		}
		const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
			$ZodCustom.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
		});
		function custom(fn, _params) {
			return /* @__PURE__ */ _custom(ZodCustom, fn ?? (() => true), _params);
		}
		function refine(fn, _params = {}) {
			return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
		}
		function superRefine(fn, params) {
			return /* @__PURE__ */ _superRefine(fn, params);
		}
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/rpc.schema.js
		/**
		* Message-layer zod schemas: the four wire full forms + error body +
		* carrier receipt. The payload slot is unknown in the full-form schemas — business payloads
		* get a second parse dispatched by method (two-level parse discipline).
		* Brand cast point: rpcIdSchema, and only there.
		*/
		/**
		* RpcId: one brand cast after schema validation (the only cast point in this
		* file). No min-length: the id is an opaque echo token, and rejecting values
		* here would only turn a correlatable error report into a client-side parse
		* failure (the handler substitutes a sentinel when a request's id is unreadable).
		*/
		const rpcIdSchema = string();
		/** Error body: discriminated by code, per-branch details aligned to RpcErrorDetailsMap; details is required. */
		const rpcErrorSchema = discriminatedUnion("code", [
			object({
				code: literal("bad-request"),
				message: string(),
				details: object({ issues: array(custom()) })
			}),
			object({
				code: literal("cancelled"),
				message: string(),
				details: object({})
			}),
			object({
				code: literal("session-not-found"),
				message: string(),
				details: object({ sessionId: string() })
			}),
			object({
				code: literal("model-unavailable"),
				message: string(),
				details: object({
					provider: string(),
					model: string()
				})
			}),
			object({
				code: literal("session-conflict"),
				message: string(),
				details: object({
					sessionId: string(),
					requestedCwd: string(),
					existingCwd: string().optional()
				})
			}),
			object({
				code: literal("invalid-time-zone"),
				message: string(),
				details: object({ value: string() })
			}),
			object({
				code: literal("workspace-attach-failed"),
				message: string(),
				details: object({
					sessionId: string(),
					workspaceId: string()
				})
			}),
			object({
				code: literal("workspace-not-found"),
				message: string(),
				details: object({ workspaceId: string() })
			}),
			object({
				code: literal("workspace-invalid-path"),
				message: string(),
				details: object({ path: string() })
			}),
			object({
				code: literal("workspace-name-conflict"),
				message: string(),
				details: object({ name: string() })
			}),
			object({
				code: literal("workspace-move-invalid"),
				message: string(),
				details: object({
					workspaceId: string(),
					sessionId: string(),
					beforeSessionId: string().optional()
				})
			}),
			object({
				code: literal("directory-unreadable"),
				message: string(),
				details: object({ path: string() })
			}),
			object({
				code: literal("directory-exists"),
				message: string(),
				details: object({ path: string() })
			}),
			object({
				code: literal("directory-create-failed"),
				message: string(),
				details: object({ path: string() })
			}),
			object({
				code: literal("directory-picker-unavailable"),
				message: string(),
				details: object({ capability: string() })
			}),
			object({
				code: literal("agent-preset-read-only"),
				message: string(),
				details: object({
					agentPreset: string(),
					reason: string()
				})
			}),
			object({
				code: literal("agent-preset-locked"),
				message: string(),
				details: object({
					sessionId: string(),
					agentPreset: string()
				})
			}),
			object({
				code: literal("agent-preset-conflict"),
				message: string(),
				details: object({
					sessionId: string(),
					requestedPreset: string(),
					existingPreset: string().optional()
				})
			}),
			object({
				code: literal("agent-preset-not-found"),
				message: string(),
				details: object({
					agentPreset: string(),
					available: array(string())
				})
			}),
			object({
				code: literal("agent-preset-invalid"),
				message: string(),
				details: object({
					agentPreset: string(),
					reason: string()
				})
			}),
			object({
				code: literal("agent-busy"),
				message: string(),
				details: object({ reason: string() })
			}),
			object({
				code: literal("attachment-error"),
				message: string(),
				details: object({ reason: string() })
			}),
			object({
				code: literal("queue-item-not-found"),
				message: string(),
				details: object({ itemId: string() })
			}),
			object({
				code: literal("steer-unavailable"),
				message: string(),
				details: object({ itemId: string() })
			}),
			object({
				code: literal("command-error"),
				message: string(),
				details: object({})
			}),
			object({
				code: literal("unknown-command"),
				message: string(),
				details: object({})
			}),
			object({
				code: literal("settings-rejected"),
				message: string(),
				details: object({ ns: string() })
			}),
			object({
				code: literal("settings-not-exposed"),
				message: string(),
				details: object({ ns: string() })
			}),
			object({
				code: literal("settings-conflict"),
				message: string(),
				details: object({
					ns: string(),
					expected: number(),
					actual: number()
				})
			}),
			object({
				code: literal("credential-rejected"),
				message: string(),
				details: object({ ref: string() })
			}),
			object({
				code: literal("model-discovery-failed"),
				message: string(),
				details: object({
					settingsNs: string(),
					baseURL: string().optional()
				})
			}),
			object({
				code: literal("title-invalid"),
				message: string(),
				details: object({ sessionId: string() })
			}),
			object({
				code: literal("fork-unavailable"),
				message: string(),
				details: object({ sessionId: string() })
			}),
			object({
				code: literal("subagent-parent-unavailable"),
				message: string(),
				details: object({ parentSessionId: string() })
			}),
			object({
				code: literal("subagent-not-found"),
				message: string(),
				details: object({
					parentSessionId: string(),
					childSessionId: string()
				})
			}),
			object({
				code: literal("subagent-catalog-diagnostic"),
				message: string(),
				details: object({
					parentSessionId: string(),
					childSessionId: string(),
					reason: union([
						literal("corrupt"),
						literal("unsupported"),
						literal("unavailable")
					])
				})
			}),
			object({
				code: literal("subagent-not-resumable"),
				message: string(),
				details: object({ childSessionId: string() })
			}),
			object({
				code: literal("subagent-unauthorized"),
				message: string(),
				details: object({ childSessionId: string() })
			}),
			object({
				code: literal("subagent-delivery-unavailable"),
				message: string(),
				details: object({ childSessionId: string() })
			}),
			object({
				code: literal("internal"),
				message: string(),
				details: object({})
			})
		]);
		/**
		* Business success/failure result schema (generic, reusable).
		* @param value - Schema for the business value.
		* @returns Schema for RpcResult<T>.
		*/
		function rpcResultSchema(value) {
			return union([object({
				ok: literal(true),
				value
			}), object({
				ok: literal(false),
				error: rpcErrorSchema
			})]);
		}
		/** ClientRequest full form (payload stays wide — the business layer runs the second parse). */
		const clientRequestSchema = object({
			type: literal("client-request"),
			rpcId: rpcIdSchema,
			method: string(),
			payload: unknown()
		});
		/** ServerResponse full form (result.value stays wide). */
		const serverResponseSchema = object({
			type: literal("server-response"),
			rpcId: rpcIdSchema,
			result: rpcResultSchema(unknown().optional())
		});
		/** ServerRequest full form (payload stays wide). */
		const serverRequestSchema = object({
			type: literal("server-request"),
			rpcId: rpcIdSchema,
			method: string(),
			payload: unknown()
		});
		discriminatedUnion("type", [
			clientRequestSchema,
			serverResponseSchema,
			serverRequestSchema,
			object({
				type: literal("client-response"),
				rpcId: rpcIdSchema,
				result: rpcResultSchema(unknown().optional())
			})
		]);
		/** Carrier receipt schema. */
		const rpcReceiptSchema = union([object({ accepted: literal(true) }), object({
			accepted: literal(false),
			reason: union([literal("not-pending"), literal("bad-response")])
		})]);
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/session-search.js
		/**
		* Return the longest prefix containing at most `maximum` Unicode code points.
		* @param value - text to bound.
		* @param maximum - non-negative code-point limit.
		* @returns `value` unchanged when it fits, otherwise a code-point-safe prefix.
		*/
		function truncateUnicodeCodePoints(value, maximum) {
			let count = 0;
			let end = 0;
			for (const codePoint of value) {
				if (count === maximum) return value.slice(0, end);
				count++;
				end += codePoint.length;
			}
			return value;
		}
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/sessions.schema.js
		/**
		* sessions domain zod schemas (names derived from map keys: sessionListRequestSchema /
		* sessionListValueSchema). SessionEvent passthrough = strict envelope (type/seq/time) + wide
		* data: the merge-extensible event API keeps an unknown-type branch at the union level,
		* with no field-level passthrough. SessionId brand cast point: sessionIdSchema, and only there.
		*/
		/** SessionId: one brand cast after schema validation (the only cast point in this domain). */
		const sessionIdSchema = string().min(1);
		/** MessageId: one brand cast after non-empty string validation. */
		const messageIdSchema$1 = string().min(1);
		/**
		* WorkspaceId: the workspace domain's one brand cast. Hosted here rather
		* than in workspace.schema because session.create references it while
		* workspace.schema references sessionIdSchema — schema modules must stay a
		* DAG (both casts used at module top level; a cycle is a load-time TDZ).
		*/
		const workspaceIdSchema = string().min(1);
		/** SessionEvent passthrough: strict envelope, wide data (the client fold handles unknown types via its documented default). */
		const sessionEventSchema = object({
			type: string(),
			seq: number().int().nonnegative(),
			time: number(),
			data: unknown(),
			sourceEventSeqs: array(number()).optional(),
			surfaceOp: unknown().optional(),
			ignorable: literal(true).optional()
		});
		/** SessionSummary row of session.list (`projections` reuses the history block's shape and schema). */
		const sessionSummarySchema = object({
			sessionId: sessionIdSchema,
			updatedAt: number(),
			running: boolean(),
			blank: boolean(),
			parentSessionId: sessionIdSchema.optional(),
			origin: literal("subagent").optional(),
			cwd: string().optional(),
			agentPreset: string().optional(),
			projections: lazy(() => sessionProjectionsBlockSchema).optional()
		});
		object({ cursor: string().optional() });
		/** session.list response value. */
		const sessionListValueSchema = object({ items: array(sessionSummarySchema) });
		object({ query: string().trim().min(1).max(500).refine((query) => !query.includes("\0"), { message: "search query must not contain NUL" }) });
		/** session.search response value. */
		const sessionSearchValueSchema = object({
			items: array(object({
				sessionId: sessionIdSchema,
				snippet: string().refine((snippet) => truncateUnicodeCodePoints(snippet, 240) === snippet, { message: `search snippet must contain at most 240 Unicode code points` })
			})).max(20),
			hasMore: boolean()
		});
		object({
			workspaceId: workspaceIdSchema.optional(),
			cwd: string().optional(),
			sessionId: sessionIdSchema.optional(),
			agentPreset: string().optional()
		}).refine((payload) => payload.workspaceId === void 0 || payload.cwd === void 0, { message: "session.create accepts workspaceId or cwd, not both" });
		/** session.create response value. */
		const sessionCreateValueSchema = object({
			sessionId: sessionIdSchema,
			agentPreset: string().optional()
		});
		object({
			sessionId: sessionIdSchema,
			title: string()
		});
		/** session.rename response value (the normalized accepted title and its event seq). */
		const sessionRenameValueSchema = object({
			title: string().min(1),
			seq: number().int().nonnegative()
		});
		object({
			sessionId: sessionIdSchema,
			atSeq: number().int().nonnegative().optional()
		});
		/** session.fork response value (the child session id). */
		const sessionForkValueSchema = object({ sessionId: sessionIdSchema });
		object({
			sessionId: sessionIdSchema,
			beforeSeq: number().int().nonnegative().optional(),
			maxMessages: number().int().positive().optional()
		});
		/** Complete provider/model selection. */
		const modelSelectionSchema = object({
			provider: string().min(1),
			model: string().min(1),
			reasoningEffort: string().min(1).optional()
		});
		/** Exact-model reasoning metadata. */
		const modelReasoningSchema = object({
			efforts: array(object({
				id: string().min(1),
				name: string().min(1),
				description: string().optional()
			})).min(1),
			defaultEffort: string().min(1).optional()
		});
		/** One advisory model entry inside a provider group. */
		const modelCatalogModelSchema = object({
			id: string().min(1),
			name: string().min(1),
			description: string().optional(),
			reasoning: modelReasoningSchema.optional()
		});
		/** One successfully loaded provider group. */
		const modelProviderGroupSchema = object({
			id: string().min(1),
			name: string().min(1),
			models: array(modelCatalogModelSchema)
		});
		/** One provider-local catalog failure. */
		const modelCatalogFailureSchema = object({
			id: string().min(1),
			name: string().min(1),
			message: string()
		});
		/**
		* ToolEventView passthrough: lock only the `for` discriminant and the presence
		* of a card-tagged `view` object. The view interior is a host-computed product
		* the client reads without echoing back; deep-validating it would hand-copy
		* the dsh-tools vocabulary into this schema and drift with it.
		*/
		const toolEventViewSchema = discriminatedUnion("for", [object({
			for: literal("call"),
			view: looseObject({ card: string() })
		}), object({
			for: literal("result"),
			view: looseObject({ card: string() })
		})]);
		/** One session.history item: the session event plus its optional host-computed tool view. */
		const historyEntrySchema = object({
			event: sessionEventSchema,
			view: toolEventViewSchema.optional()
		});
		/**
		* Projection baseline passthrough: `values` stays a wide record — each value
		* was already parsed by its provider's own schema on the host side, and
		* deep-validating here would import every domain's schema into the carrier.
		*/
		const sessionProjectionsBlockSchema = object({
			asOfSeq: number().int().min(-1),
			values: record(string(), unknown())
		});
		object({
			blank: boolean(),
			lastPromptAt: number().nullable()
		});
		object({
			maxImageBytes: number().int().positive(),
			maxImagesPerMessage: number().int().positive(),
			maxMessageImageBytes: number().int().positive(),
			maxImagePixels: number().int().positive(),
			mediaTypes: array(string())
		});
		/** session.history response value (projections rides the tail page only). */
		const sessionHistoryValueSchema = object({
			events: array(historyEntrySchema),
			hasMore: boolean(),
			projections: sessionProjectionsBlockSchema.optional()
		});
		object({ sessionId: sessionIdSchema });
		/** session.models response value. */
		const sessionModelsValueSchema = object({
			current: modelSelectionSchema,
			routable: boolean(),
			groups: array(modelProviderGroupSchema),
			failures: array(modelCatalogFailureSchema)
		});
		object({
			sessionId: sessionIdSchema,
			provider: string().min(1),
			model: string().min(1),
			reasoningEffort: string().min(1).optional()
		});
		/** session.selectModel response value. */
		const sessionSelectModelValueSchema = object({ selected: modelSelectionSchema });
		/** ContentBlock passthrough: core is merge-extensible — the type discriminant envelope is strict, the rest stays wide. */
		const contentBlockSchema = looseObject({ type: string() });
		/** Raster image media types accepted by the version-one browser wire. */
		const imageMediaTypeSchema = union([
			literal("image/png"),
			literal("image/jpeg"),
			literal("image/webp"),
			literal("image/gif")
		]);
		/** Prompt wire content is intentionally narrower than merge-extensible durable core content. */
		const promptContentPartSchema = discriminatedUnion("type", [object({
			type: literal("text"),
			text: string()
		}), object({
			type: literal("image"),
			mediaType: imageMediaTypeSchema,
			data: string(),
			name: string().optional()
		})]);
		object({
			sessionId: sessionIdSchema,
			mode: union([literal("queue"), literal("steer")]),
			content: array(promptContentPartSchema),
			clientTimeZone: string().optional()
		});
		/** session.prompt response value (the command slot appears only when the prompt dispatched a slash command). */
		const sessionPromptValueSchema = object({
			accepted: literal(true),
			command: object({
				kind: literal("success"),
				text: string().optional()
			}).optional()
		});
		/** Opaque attachment id after string-shape validation. */
		const attachmentIdSchema = string().min(1);
		/** Durable image reference returned from the authenticated session lookup. */
		const imageAttachmentRefSchema = object({
			attachmentId: attachmentIdSchema,
			mediaType: imageMediaTypeSchema,
			bytes: number().int().positive(),
			width: number().int().positive(),
			height: number().int().positive(),
			name: string().optional()
		});
		object({
			sessionId: sessionIdSchema,
			attachmentId: attachmentIdSchema
		});
		/** session.attachment response value. */
		const sessionAttachmentValueSchema = object({
			attachment: imageAttachmentRefSchema,
			data: string()
		});
		object({
			sessionId: sessionIdSchema,
			itemId: messageIdSchema$1,
			action: discriminatedUnion("kind", [
				object({
					kind: literal("edit"),
					content: array(contentBlockSchema)
				}),
				object({ kind: literal("remove") }),
				object({ kind: literal("steer") })
			])
		});
		/** session.updateQueue response value. */
		const sessionUpdateQueueValueSchema = object({ accepted: literal(true) });
		object({ sessionId: sessionIdSchema });
		/** session.cancel response value. */
		const sessionCancelValueSchema = object({ accepted: literal(true) });
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/approvals.schema.js
		/**
		* approvals domain zod schemas (respond is a client-response; the payload schema serves
		* the /api/respond endpoint's second parse after routing via the pending table).
		* ApprovalRequestId brand cast point: one.
		*/
		/** ApprovalRequestId: one brand cast after schema validation (the only cast point in this domain). */
		const approvalRequestIdSchema = string().min(1);
		object({
			sessionId: sessionIdSchema,
			approvalId: approvalRequestIdSchema,
			outcome: union([literal("allowed-once"), literal("rejected")])
		});
		/**
		* One wire task view. `kind` stays an open string because producer plugins
		* extend the registry's kind map by declaration merging, so the closed set is
		* not knowable at this boundary.
		*/
		const taskViewSchema = object({
			id: string().min(1),
			kind: string().min(1),
			label: string().min(1),
			status: union([
				literal("running"),
				literal("stopping"),
				literal("completed"),
				literal("killed"),
				literal("failed")
			]),
			detail: string().optional(),
			startedAt: number().int().nonnegative(),
			finishedAt: number().int().nonnegative().optional()
		});
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/workspace.schema.js
		/**
		* workspace domain zod schemas (names derived from map keys). The
		* WorkspaceId brand cast lives in sessions.schema (see the note there) and
		* is re-exported here as the domain-local name.
		*/
		/** WorkspaceView row of every workspace.* response. */
		const workspaceViewSchema = object({
			workspaceId: workspaceIdSchema,
			path: string(),
			title: string(),
			sessionIds: array(sessionIdSchema),
			createdAt: string(),
			updatedAt: string()
		});
		object({});
		/** workspace.list response value. */
		const workspaceListValueSchema = object({
			items: array(workspaceViewSchema),
			archivedSessionIds: array(sessionIdSchema)
		});
		object({ path: string() });
		/** workspace.create response value. */
		const workspaceCreateValueSchema = object({
			workspace: workspaceViewSchema,
			created: boolean()
		});
		object({
			workspaceId: workspaceIdSchema,
			title: string()
		}).refine((payload) => payload.title.trim() !== "", { message: "workspace.rename requires a non-blank title" });
		/** workspace.rename response value. */
		const workspaceRenameValueSchema = object({ workspace: workspaceViewSchema });
		object({ workspaceId: workspaceIdSchema });
		/** workspace.delete response value. */
		const workspaceDeleteValueSchema = object({ deleted: literal(true) });
		object({
			workspaceId: workspaceIdSchema,
			beforeWorkspaceId: workspaceIdSchema.optional()
		});
		/** workspace.insertBefore response value: the complete durable display order. */
		const workspaceInsertBeforeValueSchema = object({ workspaceIds: array(workspaceIdSchema) });
		object({
			workspaceId: workspaceIdSchema,
			sessionId: sessionIdSchema,
			beforeSessionId: sessionIdSchema.optional()
		});
		/** workspace.insertSessionBefore response value. */
		const workspaceInsertSessionBeforeValueSchema = object({ workspace: workspaceViewSchema });
		object({ sessionId: sessionIdSchema });
		/** workspace.archiveSession response value: the full updated archive set. */
		const workspaceArchiveSessionValueSchema = object({ archivedSessionIds: array(sessionIdSchema) });
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/events.schema.js
		/**
		* events domain zod schemas: MuxFrame / HostFrame unions (discriminatedUnion('type')).
		* A frame is the payload slot of the ServerRequest full form; the SessionEvent inside
		* a session/event frame reuses sessions.schema's strict-envelope + wide-data passthrough branch.
		*/
		/** Question fields validated strictly against core dsh-user-questions. */
		const askUserQuestionItemSchema = object({
			id: string(),
			question: string(),
			header: string().optional(),
			detail: string().optional(),
			options: array(object({
				label: string(),
				description: string().optional()
			})).optional(),
			multiSelect: boolean().optional(),
			intent: discriminatedUnion("kind", [object({
				kind: literal("plan-review"),
				approve: string()
			})]).optional()
		});
		/** Unified message envelope carried by transient queue frames. */
		const messageSchema = object({
			id: string().min(1),
			role: union([
				literal("system"),
				literal("user"),
				literal("assistant")
			]),
			content: array(contentBlockSchema),
			source: looseObject({ kind: string() })
		});
		/** MuxFrame union (payload slot of a mux-stream ServerRequest). */
		const muxFrameSchema = discriminatedUnion("type", [
			object({
				type: literal("session/event"),
				sessionId: sessionIdSchema,
				event: sessionEventSchema,
				view: toolEventViewSchema.optional()
			}),
			object({
				type: literal("session/subscribed"),
				sessionId: sessionIdSchema,
				lastSeq: number().int()
			}),
			object({
				type: literal("approval/requested"),
				sessionId: sessionIdSchema,
				approvalId: approvalRequestIdSchema,
				toolName: string(),
				callId: string().optional(),
				reason: string().optional()
			}),
			object({
				type: literal("approval/resolved"),
				sessionId: sessionIdSchema,
				approvalId: approvalRequestIdSchema,
				outcome: union([
					literal("allowed-once"),
					literal("rejected"),
					literal("cancelled"),
					literal("unavailable")
				])
			}),
			object({
				type: literal("question/requested"),
				sessionId: sessionIdSchema,
				questions: array(askUserQuestionItemSchema).min(1)
			}),
			object({
				type: literal("question/resolved"),
				sessionId: sessionIdSchema,
				questionRpcId: rpcIdSchema,
				outcome: union([literal("answered"), literal("cancelled")])
			}),
			object({
				type: literal("session/queue"),
				sessionId: sessionIdSchema,
				items: array(object({
					id: messageIdSchema$1,
					placement: union([
						literal("queued"),
						literal("steering"),
						literal("context")
					]),
					message: messageSchema
				}))
			}),
			object({
				type: literal("session/jobs"),
				sessionId: sessionIdSchema,
				jobs: array(taskViewSchema)
			}),
			object({
				type: literal("session/projection"),
				sessionId: sessionIdSchema,
				key: string().min(1),
				value: unknown(),
				seq: number().int().nonnegative()
			}),
			object({
				type: literal("stream/error"),
				error: rpcErrorSchema
			})
		]);
		/** HostFrame union (payload slot of a host-stream ServerRequest). */
		const hostFrameSchema = discriminatedUnion("type", [
			object({
				type: literal("host/session-added"),
				sessionId: sessionIdSchema,
				blank: boolean(),
				parentSessionId: sessionIdSchema.optional(),
				origin: literal("subagent").optional(),
				cwd: string().optional(),
				agentPreset: string().optional()
			}),
			object({
				type: literal("host/session-removed"),
				sessionId: sessionIdSchema
			}),
			object({
				type: literal("host/session-status"),
				sessionId: sessionIdSchema,
				running: boolean()
			}),
			object({
				type: literal("host/agent-error"),
				sessionId: sessionIdSchema,
				message: string()
			}),
			object({
				type: literal("host/workspace-changed"),
				workspace: workspaceViewSchema
			}),
			object({
				type: literal("host/workspace-removed"),
				workspaceId: workspaceIdSchema
			}),
			object({
				type: literal("host/workspace-order-changed"),
				workspaceIds: array(workspaceIdSchema)
			}),
			object({
				type: literal("host/archived-sessions-changed"),
				archivedSessionIds: array(sessionIdSchema)
			}),
			object({
				type: literal("host/remote-event"),
				event: string().min(1),
				args: array(unknown())
			}),
			object({
				type: literal("stream/error"),
				error: rpcErrorSchema
			})
		]);
		object({});
		/** host.describe response value. */
		const hostDescribeValueSchema = object({
			version: string(),
			cwd: string(),
			provider: string().optional(),
			model: string().optional(),
			attachedSessions: number().int().nonnegative(),
			canOpenPath: boolean()
		});
		object({});
		/** host.pickDirectory response value; null means the user cancelled. */
		const hostPickDirectoryValueSchema = object({ path: string().nullable() });
		/** Directory row shared by listing entries and breadcrumb crumbs. */
		const directoryEntrySchema = object({
			name: string(),
			path: string(),
			hidden: boolean()
		});
		object({ path: string().optional() });
		/** host.listDirectory response value. */
		const hostListDirectoryValueSchema = object({
			path: string(),
			home: string(),
			crumbs: array(directoryEntrySchema),
			entries: array(directoryEntrySchema),
			truncated: boolean()
		});
		object({
			path: string(),
			name: string()
		}).refine((payload) => payload.name.trim() !== "" && payload.name !== "." && payload.name !== ".." && !/[/\\]/.test(payload.name), { message: "host.createDirectory requires a single non-blank path segment name" });
		/** host.createDirectory response value: the created directory's absolute path. */
		const hostCreateDirectoryValueSchema = object({ path: string() });
		object({ path: string().min(1) });
		/** host.openPath response value. */
		const hostOpenPathValueSchema = object({ opened: literal(true) });
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/skills.schema.js
		/**
		* skills domain zod schemas (names derived from map keys: skillListRequestSchema /
		* skillListValueSchema).
		*/
		/** SkillEntry row of skill.list. */
		const skillEntrySchema = object({
			name: string().min(1),
			description: string(),
			whenToUse: string().optional(),
			modelInvocable: boolean()
		});
		object({ sessionId: sessionIdSchema });
		/** skill.list response value. */
		const skillListValueSchema = object({ skills: array(skillEntrySchema) });
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/agent-presets.schema.js
		/**
		* agent-presets domain zod schemas (names derived from map keys:
		* agentPresetListRequestSchema / agentPresetListValueSchema).
		*/
		/** AgentPresetEntry row of agentPreset.list. */
		const agentPresetEntrySchema = object({
			id: string().min(1),
			trust: union([literal("system"), literal("user")]),
			isDefault: boolean(),
			name: string().optional(),
			description: string().optional(),
			broken: string().min(1).optional()
		});
		object({});
		/** agentPreset.list response value. */
		const agentPresetListValueSchema = object({
			presets: array(agentPresetEntrySchema),
			authorable: boolean(),
			hasDocument: boolean()
		});
		object({
			sessionId: sessionIdSchema,
			agentPreset: string().min(1)
		});
		/** agentPreset.select response value. */
		const agentPresetSelectValueSchema = object({ agentPreset: string() });
		object({ agentPreset: string().min(1) });
		/** agentPreset.read response value. */
		const agentPresetReadValueSchema = object({
			agentPreset: string(),
			trust: union([literal("system"), literal("user")]),
			content: string(),
			name: string().optional(),
			description: string().optional()
		});
		object({
			from: string().min(1),
			agentPreset: string().min(1),
			name: string().optional()
		});
		/** agentPreset.copy response value. */
		const agentPresetCopyValueSchema = object({ agentPreset: string() });
		object({ agentPreset: string().min(1) });
		/** agentPreset.openDocument response value. */
		const agentPresetOpenDocumentValueSchema = union([object({ opened: literal(true) }), object({
			opened: literal(false),
			path: string()
		})]);
		object({ agentPreset: string().min(1) });
		/** agentPreset.remove response value. */
		const agentPresetRemoveValueSchema = object({});
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/goals.schema.js
		/**
		* goals domain zod schemas. Mutation-only shapes: every value schema is a
		* `{ ref }` acknowledgement (clear: `{ cleared }`) — the current goal state
		* travels exclusively on the 'goal' session projection.
		*/
		/** GoalRef schema. */
		const goalRefSchema = object({
			id: string(),
			revision: number().int().positive()
		});
		/** Shared `{ ref }` acknowledgement value of every non-clear mutation. */
		const goalRefValueSchema = object({ ref: goalRefSchema });
		object({
			sessionId: string(),
			objective: string().min(1),
			maxGoalRounds: number().int().positive().optional()
		});
		/** goal.create response value. */
		const goalCreateValueSchema = goalRefValueSchema;
		object({
			sessionId: string(),
			ref: goalRefSchema,
			objective: string().min(1).optional(),
			maxGoalRounds: number().int().positive().optional()
		}).refine((value) => value.objective !== void 0 || value.maxGoalRounds !== void 0, { message: "goal.edit requires objective or maxGoalRounds" });
		/** goal.edit response value. */
		const goalEditValueSchema = goalRefValueSchema;
		object({
			sessionId: string(),
			ref: goalRefSchema
		});
		/** goal.pause response value. */
		const goalPauseValueSchema = goalRefValueSchema;
		object({
			sessionId: string(),
			ref: goalRefSchema
		});
		/** goal.resume response value. */
		const goalResumeValueSchema = goalRefValueSchema;
		object({
			sessionId: string(),
			ref: goalRefSchema
		});
		/** goal.complete response value. */
		const goalCompleteValueSchema = goalRefValueSchema;
		object({
			sessionId: string(),
			ref: goalRefSchema
		});
		/** goal.clear response value. */
		const goalClearValueSchema = object({ cleared: literal(true) });
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/settings.schema.js
		/**
		* settings domain zod schemas (names derived from map keys: settingsDescribeRequestSchema /
		* settingsDescribeValueSchema / settingsUpdate* / settingsReplace*).
		*/
		/** One redacted secret slot. */
		const settingsSecretViewSchema = object({
			path: array(string()),
			set: boolean()
		});
		/** SettingsNamespaceView row of settings.describe and the write responses. */
		const settingsNamespaceViewSchema = object({
			ns: string().min(1),
			schema: unknown(),
			value: unknown(),
			base: unknown().optional(),
			user: unknown().optional(),
			applies: union([literal("live"), literal("restart")]),
			secrets: array(settingsSecretViewSchema),
			revision: number()
		});
		object({});
		/** settings.describe response value. */
		const settingsDescribeValueSchema = object({
			writable: boolean(),
			hasDocument: boolean(),
			namespaces: array(settingsNamespaceViewSchema)
		});
		object({});
		/** settings.openDocument response value. */
		const settingsOpenDocumentValueSchema = object({ opened: literal(true) });
		object({
			ns: string().min(1),
			patch: record(string(), unknown()),
			expectedRevision: number().optional()
		});
		/** settings.update response value: the namespace's new redacted view. */
		const settingsUpdateValueSchema = settingsNamespaceViewSchema;
		object({
			ns: string().min(1),
			section: record(string(), unknown()),
			expectedRevision: number().optional()
		});
		/** One path-addressed edit of settings.mutate. */
		const settingsPathOpSchema = discriminatedUnion("op", [object({
			op: literal("set"),
			path: array(string()),
			value: unknown()
		}), object({
			op: literal("unset"),
			path: array(string())
		})]);
		object({
			ns: string().min(1),
			ops: array(settingsPathOpSchema),
			expectedRevision: number().optional()
		});
		/** settings.mutate response value: the namespace's new redacted view. */
		const settingsMutateValueSchema = settingsNamespaceViewSchema;
		/** settings.replace response value. */
		const settingsReplaceValueSchema = settingsNamespaceViewSchema;
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/credentials.schema.js
		/**
		* credentials domain zod schemas (names derived from map keys:
		* credentialsDescribeRequestSchema / credentialsDescribeValueSchema / …).
		* The reference-name pattern mirrors the seam's `credentialRef` guard so an
		* invalid name fails as `bad-request` before reaching the service.
		*/
		/** POSIX-portable environment-variable name (the seam's `credentialRef` pattern). */
		const credentialRefNameSchema = string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
		/** CredentialView entry of credentials.describe. */
		const credentialViewSchema = object({
			configured: boolean(),
			source: string().optional(),
			writable: boolean()
		});
		object({ refs: array(credentialRefNameSchema).max(64) });
		/** credentials.describe response value. */
		const credentialsDescribeValueSchema = object({ credentials: record(string(), credentialViewSchema) });
		object({
			ref: credentialRefNameSchema,
			value: string().min(1)
		});
		/** credentials.set response value. */
		const credentialsSetValueSchema = object({});
		object({ ref: credentialRefNameSchema });
		/** credentials.unset response value. */
		const credentialsUnsetValueSchema = object({});
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/llm.schema.js
		/**
		* llm domain zod schemas (names derived from map keys: llmProvidersRequestSchema /
		* llmProvidersValueSchema / llmModelsRequestSchema / llmModelsValueSchema).
		*/
		/** ConfigurableProviderView row of llm.providers. */
		const configurableProviderViewSchema = object({
			provider: string().min(1),
			displayName: string().min(1),
			settingsNs: string(),
			settingsPath: array(string()),
			active: boolean(),
			declared: boolean().optional()
		});
		object({});
		/** llm.providers response value. */
		const llmProvidersValueSchema = object({ providers: array(configurableProviderViewSchema) });
		object({});
		/** llm.models response value. */
		const llmModelsValueSchema = object({
			groups: array(modelProviderGroupSchema),
			failures: array(modelCatalogFailureSchema)
		});
		/** DiscoveredModelView row of llm.discoverModels. */
		const discoveredModelViewSchema = object({
			id: string().min(1),
			name: string().min(1).optional(),
			contextWindow: number().int().positive().optional(),
			maxTokens: number().int().positive().optional()
		});
		object({
			settingsNs: string().min(1),
			provider: string().min(1).optional(),
			baseURL: string().min(1).optional(),
			api: string().min(1).optional(),
			apiKey: string().min(1).optional()
		});
		/** llm.discoverModels response value. */
		const llmDiscoverModelsValueSchema = object({ models: array(discoveredModelViewSchema) });
		//#endregion
		//#region ../../host/apiproxy/lib/types/api/subagents.schema.js
		/** Zod schemas for the browser-safe subagent domain. */
		/** Healthy and diagnostic durable catalog rows. */
		const subagentListEntrySchema = union([
			object({
				kind: literal("child"),
				id: sessionIdSchema,
				mode: literal("one-shot"),
				activity: union([literal("running"), literal("inactive")]),
				hasChildren: boolean(),
				label: string().optional()
			}),
			object({
				kind: literal("child"),
				id: sessionIdSchema,
				mode: literal("continuable"),
				activity: union([literal("running"), literal("inactive")]),
				hasChildren: boolean(),
				label: string()
			}),
			object({
				kind: literal("diagnostic"),
				id: sessionIdSchema,
				reason: union([
					literal("corrupt"),
					literal("unsupported"),
					literal("unavailable")
				])
			})
		]);
		object({ parentSessionId: sessionIdSchema });
		/** subagent.list response value. */
		const subagentListValueSchema = object({
			entries: array(subagentListEntrySchema),
			parentAvailable: boolean()
		});
		object({
			parentSessionId: sessionIdSchema,
			childSessionId: sessionIdSchema,
			mode: union([literal("one-shot"), literal("continuable")]),
			beforeSeq: number().int().nonnegative().optional(),
			maxMessages: number().int().positive().optional()
		});
		/** subagent.history response value. */
		const subagentHistoryValueSchema = object({
			events: array(historyEntrySchema),
			hasMore: boolean(),
			projections: sessionProjectionsBlockSchema.optional()
		});
		object({
			parentSessionId: sessionIdSchema,
			childSessionId: sessionIdSchema,
			mode: literal("continuable"),
			content: array(contentBlockSchema),
			clientTimeZone: string().optional()
		});
		object({
			parentSessionId: sessionIdSchema,
			childSessionId: sessionIdSchema,
			mode: literal("continuable")
		});
		/** subagent.interrupt response value. */
		const subagentInterruptValueSchema = object({ accepted: literal(true) });
		//#endregion
		//#region ../../host/apiproxy/lib/types/fetch/client.js
		/**
		* Client side of the fetch carrier. AbstractApiClient holds every protocol invariant: rpcId minting,
		* four-quadrant envelope wrap/unwrap, zod parsing, in-process SSE frame decoding, and the payload-direct
		* IApiClient domain methods (business code never mints). Platform differences ride two aspects:
		* abstract doFetch (transport) + overridable onEnvelope (tap). ApiProxy (the impl face) is untouched.
		*/
		/**
		* S→C second-level parse table: value schema by method (the response-path
		* mirror of the handler's request table; key coverage compiler-enforced against RpcMethodMap).
		*/
		const UNARY_VALUE_SCHEMAS = {
			"session.list": sessionListValueSchema,
			"session.search": sessionSearchValueSchema,
			"session.create": sessionCreateValueSchema,
			"session.history": sessionHistoryValueSchema,
			"session.models": sessionModelsValueSchema,
			"session.selectModel": sessionSelectModelValueSchema,
			"session.rename": sessionRenameValueSchema,
			"session.fork": sessionForkValueSchema,
			"session.prompt": sessionPromptValueSchema,
			"session.attachment": sessionAttachmentValueSchema,
			"session.updateQueue": sessionUpdateQueueValueSchema,
			"session.cancel": sessionCancelValueSchema,
			"subagent.list": subagentListValueSchema,
			"subagent.history": subagentHistoryValueSchema,
			"subagent.prompt": object({ messageId: string() }),
			"subagent.interrupt": subagentInterruptValueSchema,
			"host.describe": hostDescribeValueSchema,
			"host.pickDirectory": hostPickDirectoryValueSchema,
			"host.listDirectory": hostListDirectoryValueSchema,
			"host.createDirectory": hostCreateDirectoryValueSchema,
			"host.openPath": hostOpenPathValueSchema,
			"workspace.list": workspaceListValueSchema,
			"workspace.create": workspaceCreateValueSchema,
			"workspace.rename": workspaceRenameValueSchema,
			"workspace.delete": workspaceDeleteValueSchema,
			"workspace.insertBefore": workspaceInsertBeforeValueSchema,
			"workspace.insertSessionBefore": workspaceInsertSessionBeforeValueSchema,
			"workspace.archiveSession": workspaceArchiveSessionValueSchema,
			"skill.list": skillListValueSchema,
			"agentPreset.list": agentPresetListValueSchema,
			"agentPreset.select": agentPresetSelectValueSchema,
			"agentPreset.read": agentPresetReadValueSchema,
			"agentPreset.copy": agentPresetCopyValueSchema,
			"agentPreset.openDocument": agentPresetOpenDocumentValueSchema,
			"agentPreset.remove": agentPresetRemoveValueSchema,
			"goal.create": goalCreateValueSchema,
			"goal.edit": goalEditValueSchema,
			"goal.pause": goalPauseValueSchema,
			"goal.resume": goalResumeValueSchema,
			"goal.complete": goalCompleteValueSchema,
			"goal.clear": goalClearValueSchema,
			"settings.describe": settingsDescribeValueSchema,
			"settings.openDocument": settingsOpenDocumentValueSchema,
			"settings.update": settingsUpdateValueSchema,
			"settings.replace": settingsReplaceValueSchema,
			"settings.mutate": settingsMutateValueSchema,
			"credentials.describe": credentialsDescribeValueSchema,
			"credentials.set": credentialsSetValueSchema,
			"credentials.unset": credentialsUnsetValueSchema,
			"llm.providers": llmProvidersValueSchema,
			"llm.models": llmModelsValueSchema,
			"llm.discoverModels": llmDiscoverModelsValueSchema
		};
		/** Default timeout for bounded unary calls (rpc-compare 2026-07-19: a hung host must not leave callers pending forever). */
		const DEFAULT_TIMEOUT_MS = 3e4;
		/** URL base for in-process handler injection (fake authority, opencode precedent). */
		const INTERNAL_BASE$1 = "http://dsh.internal";
		/**
		* Abstract fetch-carrier client. Subclasses supply the transport (doFetch) and may refine the
		* per-message tap (onEnvelope) — platform aspects stay in subclasses, protocol invariants stay
		* here. Envelope observation is a first-class aspect of this data middle layer: the instance
		* owns a microtask-batched buffer (frame storms must not cost one consumer update per frame),
		* and observers subscribe via subscribeEnvelopes. The isomorphic point survives: an in-process
		* subclass whose doFetch is toFetchHandler(api).fetch never touches the network.
		*/
		var AbstractApiClient = class {
			timeoutMs;
			/** Instance-owned observation buffer (module-level state would leak across instances/tests). */
			envelopeBatch = [];
			flushScheduled = false;
			envelopeListeners = /* @__PURE__ */ new Set();
			/** @param timeoutMs - timeout for bounded unary calls; user-paced calls and streams do not use it. */
			constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
				this.timeoutMs = timeoutMs;
			}
			/**
			* Subscribe to batched envelope observation (diagnostics/logging consumers).
			* Batches follow microtask boundaries; a listener throw is isolated (observation
			* must never break the carrier).
			* @param listener - receives each flushed batch in arrival order.
			* @returns unsubscribe function.
			*/
			subscribeEnvelopes(listener) {
				this.envelopeListeners.add(listener);
				return () => {
					this.envelopeListeners.delete(listener);
				};
			}
			/** Per-message tap: feeds the instance buffer. Subclasses may override to observe unbatched (call super to keep batching). */
			onEnvelope(message) {
				if (this.envelopeListeners.size === 0) return;
				this.envelopeBatch.push(message);
				if (this.flushScheduled) return;
				this.flushScheduled = true;
				queueMicrotask(() => {
					this.flushScheduled = false;
					const batch = this.envelopeBatch;
					this.envelopeBatch = [];
					for (const notify of this.envelopeListeners) try {
						notify(batch);
					} catch (error) {
						console.error("[apiproxy] envelope listener threw:", error);
					}
				});
			}
			/** Browser = same-origin (a fake authority would fail DNS on real requests); no-location env (Node) = fake authority. */
			resolveBase() {
				const loc = globalThis.location;
				return loc?.origin !== void 0 && loc.origin !== "null" ? loc.origin : INTERNAL_BASE$1;
			}
			mintRpcId() {
				return RpcId(crypto.randomUUID());
			}
			/**
			* Shared POST leg of both C→S carriers (callUnary/respond): JSON body,
			* optional default timeout merged with the caller's external signal, non-2xx → transport throw.
			*/
			async postJson(path, body, signal, timeoutPolicy = "default") {
				const requestSignal = timeoutPolicy === "default" ? signal === void 0 ? AbortSignal.timeout(this.timeoutMs) : AbortSignal.any([AbortSignal.timeout(this.timeoutMs), signal]) : signal;
				const response = await this.doFetch(new URL(path, this.resolveBase()), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
					...requestSignal === void 0 ? {} : { signal: requestSignal }
				});
				if (!response.ok) throw new Error(`transport failure for ${path}: HTTP ${response.status}`);
				return response;
			}
			/**
			* Unary protocol path: mint → tap → POST full form → envelope parse → verify
			* echo → value parse → tap → narrow. Virtual so a fake carrier (fixture) can
			* override transport at this layer.
			*/
			async callUnary(method, payload, signal, timeoutPolicy = "default") {
				const message = {
					type: "client-request",
					rpcId: this.mintRpcId(),
					method,
					payload
				};
				this.onEnvelope(message);
				const response = await this.postJson(`/api/${method}`, message, signal, timeoutPolicy);
				const full = serverResponseSchema.parse(await response.json());
				this.onEnvelope(full);
				if (full.rpcId !== message.rpcId) throw new Error(`rpcId mismatch for ${method}: sent ${message.rpcId}, got ${full.rpcId}`);
				if (!full.result.ok) return {
					rpcId: full.rpcId,
					result: full.result
				};
				const value = UNARY_VALUE_SCHEMAS[method].parse(full.result.value);
				return {
					rpcId: full.rpcId,
					result: {
						ok: true,
						value
					}
				};
			}
			/** Mux stream opener; virtual for the same override reason as callUnary. */
			openMux(_payload, signal, onOpen) {
				return this.readSse("/api/events.mux", signal, muxFrameSchema, onOpen);
			}
			/** Host stream opener; virtual. */
			openHost(_payload, signal, onOpen) {
				return this.readSse("/api/events.host", signal, hostFrameSchema, onOpen);
			}
			/**
			* SSE protocol path: streaming fetch (not EventSource), '\n\n' framing, ServerRequest envelope +
			* frame-schema parse, tap, narrow yield. onOpen fires once the response headers are in and the
			* body is readable — the stream-established signal, before any frame arrives. A frame that fails
			* either parse level is reported and skipped (one corrupt frame must not kill the stream; the
			* client's gap detection covers whatever the frame carried).
			*/
			async *readSse(path, signal, frameSchema, onOpen) {
				const response = await this.doFetch(new URL(path, this.resolveBase()), { signal });
				if (!response.ok || response.body === null) throw new Error(`transport failure for ${path}: HTTP ${response.status}`);
				onOpen?.();
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) return;
						buffer += decoder.decode(value, { stream: true });
						let boundary;
						while ((boundary = buffer.indexOf("\n\n")) !== -1) {
							const chunk = buffer.slice(0, boundary);
							buffer = buffer.slice(boundary + 2);
							const data = chunk.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("");
							if (data === "") continue;
							let full;
							let frame;
							try {
								full = serverRequestSchema.parse(JSON.parse(data));
								frame = frameSchema.parse(full.payload);
							} catch (error) {
								console.error(`[apiproxy] dropping malformed SSE frame on ${path}:`, error);
								continue;
							}
							this.onEnvelope(full);
							yield {
								rpcId: full.rpcId,
								payload: frame
							};
						}
					}
				} finally {
					await reader.cancel().catch(() => void 0);
				}
			}
			sessions = {
				list: (payload, signal) => this.callUnary("session.list", payload, signal),
				search: (payload, signal) => this.callUnary("session.search", payload, signal),
				create: (payload, signal) => this.callUnary("session.create", payload, signal),
				history: (payload, signal) => this.callUnary("session.history", payload, signal),
				models: (payload, signal) => this.callUnary("session.models", payload, signal),
				selectModel: (payload, signal) => this.callUnary("session.selectModel", payload, signal),
				rename: (payload, signal) => this.callUnary("session.rename", payload, signal),
				fork: (payload, signal) => this.callUnary("session.fork", payload, signal),
				prompt: (payload, signal) => this.callUnary("session.prompt", payload, signal),
				attachment: (payload, signal) => this.callUnary("session.attachment", payload, signal),
				updateQueue: (payload, signal) => this.callUnary("session.updateQueue", payload, signal),
				cancel: (payload, signal) => this.callUnary("session.cancel", payload, signal)
			};
			subagents = {
				list: (payload, signal) => this.callUnary("subagent.list", payload, signal),
				history: (payload, signal) => this.callUnary("subagent.history", payload, signal),
				prompt: (payload, signal) => this.callUnary("subagent.prompt", payload, signal),
				interrupt: (payload, signal) => this.callUnary("subagent.interrupt", payload, signal)
			};
			host = {
				describe: (payload, signal) => this.callUnary("host.describe", payload, signal),
				pickDirectory: (payload, signal) => this.callUnary("host.pickDirectory", payload, signal, "caller-signal-only"),
				listDirectory: (payload, signal) => this.callUnary("host.listDirectory", payload, signal),
				createDirectory: (payload, signal) => this.callUnary("host.createDirectory", payload, signal),
				openPath: (payload, signal) => this.callUnary("host.openPath", payload, signal)
			};
			workspace = {
				list: (payload, signal) => this.callUnary("workspace.list", payload, signal),
				create: (payload, signal) => this.callUnary("workspace.create", payload, signal),
				rename: (payload, signal) => this.callUnary("workspace.rename", payload, signal),
				delete: (payload, signal) => this.callUnary("workspace.delete", payload, signal),
				insertBefore: (payload, signal) => this.callUnary("workspace.insertBefore", payload, signal),
				insertSessionBefore: (payload, signal) => this.callUnary("workspace.insertSessionBefore", payload, signal),
				archiveSession: (payload, signal) => this.callUnary("workspace.archiveSession", payload, signal)
			};
			skills = { list: (payload, signal) => this.callUnary("skill.list", payload, signal) };
			agentPresets = {
				list: (payload, signal) => this.callUnary("agentPreset.list", payload, signal),
				select: (payload, signal) => this.callUnary("agentPreset.select", payload, signal),
				read: (payload, signal) => this.callUnary("agentPreset.read", payload, signal),
				copy: (payload, signal) => this.callUnary("agentPreset.copy", payload, signal),
				openDocument: (payload, signal) => this.callUnary("agentPreset.openDocument", payload, signal),
				remove: (payload, signal) => this.callUnary("agentPreset.remove", payload, signal)
			};
			goals = {
				create: (payload, signal) => this.callUnary("goal.create", payload, signal),
				edit: (payload, signal) => this.callUnary("goal.edit", payload, signal),
				pause: (payload, signal) => this.callUnary("goal.pause", payload, signal),
				resume: (payload, signal) => this.callUnary("goal.resume", payload, signal),
				complete: (payload, signal) => this.callUnary("goal.complete", payload, signal),
				clear: (payload, signal) => this.callUnary("goal.clear", payload, signal)
			};
			settings = {
				describe: (payload, signal) => this.callUnary("settings.describe", payload, signal),
				openDocument: (payload, signal) => this.callUnary("settings.openDocument", payload, signal),
				update: (payload, signal) => this.callUnary("settings.update", payload, signal),
				replace: (payload, signal) => this.callUnary("settings.replace", payload, signal),
				mutate: (payload, signal) => this.callUnary("settings.mutate", payload, signal)
			};
			credentials = {
				describe: (payload, signal) => this.callUnary("credentials.describe", payload, signal),
				set: (payload, signal) => this.callUnary("credentials.set", payload, signal),
				unset: (payload, signal) => this.callUnary("credentials.unset", payload, signal)
			};
			llm = {
				providers: (payload, signal) => this.callUnary("llm.providers", payload, signal),
				models: (payload, signal) => this.callUnary("llm.models", payload, signal),
				discoverModels: (payload, signal) => this.callUnary("llm.discoverModels", payload, signal)
			};
			events = {
				mux: (payload, signal, onOpen) => this.openMux(payload, signal, onOpen),
				host: (payload, signal, onOpen) => this.openHost(payload, signal, onOpen)
			};
			async respond(message, signal) {
				this.onEnvelope(message);
				const response = await this.postJson("/api/respond", message, signal);
				return rpcReceiptSchema.parse(await response.json());
			}
		};
		//#endregion
		//#region lib/types/client/random-uuid.js
		/** Browser-safe UUID generation for client-side wire correlation. */
		/**
		* Generate an RFC 4122 version 4 UUID without requiring a secure context.
		* @returns a UUID backed by `crypto.getRandomValues()`, which browsers expose on insecure origins.
		*/
		function randomUuid() {
			const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			view.setUint8(6, view.getUint8(6) & 15 | 64);
			view.setUint8(8, view.getUint8(8) & 63 | 128);
			const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		}
		//#endregion
		//#region lib/types/client/fixture.js
		/** The fake carrier mints like a real one (business code never mints). */
		function rpcRequest(payload) {
			return {
				rpcId: RpcId(randomUuid()),
				payload
			};
		}
		function text(t) {
			return [{
				type: "text",
				text: t
			}];
		}
		function userMessage(content, source = { kind: "user" }) {
			return createUserMessage({
				content,
				source
			});
		}
		function assistantMessage(content, model = "fx-1") {
			return createAssistantMessage({
				content,
				source: {
					provider: "fixture",
					model
				}
			});
		}
		function toolResultMessage(callId, content, isError) {
			return createToolResultMessage({
				callId: CallId(callId),
				content,
				isError
			});
		}
		const MARKDOWN_FIXTURE = [
			"# Markdown fixture",
			"",
			"Assistant output renders **strong text**, *emphasis*, and `inline code`.",
			"",
			"- first item",
			"  - nested item",
			"",
			"| Area | State |",
			"| --- | --- |",
			"| history | rendered |",
			"| streaming | stable |",
			"",
			"[DeepSeek](https://www.deepseek.com)",
			"",
			"```ts",
			"const markdown = true",
			"```"
		].join("\n");
		const USER_MARKDOWN_LITERAL = "用户字面量：# 不渲染 `code` [link](https://example.com)";
		/**
		* SGR wrapper for the terminal output sample below: authoring the escapes as
		* `\u001b` keeps literal control bytes out of this source file.
		* @param code - the SGR parameter (an ANSI color or attribute number).
		* @param body - the text the attribute applies to.
		* @returns the body wrapped in the attribute and a reset.
		*/
		function sgr(code, body) {
			return `\u001b[${code}m${body}\u001b[0m`;
		}
		/**
		* Terminal output sample for fixture turn 66, authored to carry every feature
		* the terminal card draws that turn 60's two prompt rows cannot reach:
		* basic-16 SGR foreground runs (green, red, bright-black) that must resolve to
		* `--dsw-*` tokens, a bold run, column-aligned table rows that must scroll
		* rather than fold, more than DEFAULT_TERMINAL_MAX_LINES (16) lines so the
		* height cap collapses the middle. The exit status is authored separately in
		* TERMINAL_EXIT_STATUS and deliberately absent from this text: the real bash
		* presenter CONSUMES its `[exit code: N]` marker out of the body, because a
		* terminal card shows the exit as its own pill and leaving the marker in would
		* render it twice (packages/shell/tool-bash/src/render.ts).
		*/
		const TERMINAL_OUTPUT_FIXTURE = [
			sgr(1, "Running 4 checks"),
			`${sgr(32, "✓")} typecheck                                          1.82s`,
			`${sgr(32, "✓")} lint                                               0.94s`,
			`${sgr(32, "✓")} duplication                                        2.10s`,
			`${sgr(31, "✗")} unit                                               8.41s`,
			"",
			sgr(90, "packages/client/ui-primitives/tests/terminal-block.client.spec.tsx"),
			`  ${sgr(31, "FAIL")} caps output at the configured line budget`,
			"    expected 16 lines, received 24",
			"",
			"NAME                        LINES    BRANCHES    FUNCTIONS    UNCOVERED",
			"TerminalBlock.tsx           100%     100%        100%         -",
			"ansi.ts                     100%     100%        100%         -",
			"clipboard.ts                100%     100%        100%         -",
			"CodeBlock.tsx               98.4%    96.2%       100%         41-43",
			"highlight.ts                100%     100%        100%         -",
			"Pill.tsx                    100%     100%        100%         -",
			"StateDot.tsx                100%     100%        100%         -",
			"markdown/Markdown.tsx       100%     100%        100%         -",
			"",
			sgr(31, "1 of 4 checks failed")
		].join("\n");
		/**
		* Exit status for each terminal sample, keyed by its output text. Authored
		* alongside the sample rather than parsed back out of its trailing marker,
		* which is the bash tool's own job and not something to reimplement here.
		*/
		const TERMINAL_EXIT_STATUS = { [TERMINAL_OUTPUT_FIXTURE]: { exitCode: 1 } };
		/**
		* Structured grep result for the search sample (turn 67): matches grouped by
		* file, authored inline because the client-side fixture cannot import the tool
		* that produces the canonical value. `truncated` with a larger `total` than the
		* retained match count exercises the search card's capped indicator; the file
		* with more than CHAT_SEARCH_MAX_LINES rows exercises its head/tail height cap.
		*/
		const SEARCH_MATCHES_FIXTURE = [
			{
				path: "packages/client/ui-primitives/src/SearchBlock.tsx",
				matches: [
					{
						lineNumber: 16,
						line: "export const DEFAULT_SEARCH_MAX_LINES = 16"
					},
					{
						lineNumber: 138,
						line: "export function SearchBlock(props: SearchBlockProps) {"
					},
					{
						lineNumber: 141,
						line: "  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())"
					}
				]
			},
			{
				path: "packages/client/ui-tool/src/client/tool/models/search-card-model.ts",
				matches: [{
					lineNumber: 45,
					line: "export const CHAT_SEARCH_MAX_LINES = 8"
				}, {
					lineNumber: 130,
					line: "export function searchCardModel(block: ToolCallBlock): SearchCardModel | null {"
				}]
			},
			{
				path: "packages/client/ui-tool/src/client/tool/toolviews/search-row.tsx",
				matches: [
					{
						lineNumber: 34,
						line: "export function SearchRow({ toolName, block, inspect, t }: SearchRowProps) {"
					},
					{
						lineNumber: 36,
						line: "  const search = searchCardModel(block)"
					},
					{
						lineNumber: 56,
						line: "      search={search}"
					},
					{
						lineNumber: 78,
						line: "      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'grep', locale: NS }, SearchRow)"
					}
				]
			}
		];
		/**
		* The model-facing grep render text for the sample — what a UI without a search
		* card shows, attached as the view's `content`. Mirrors the real grep
		* presenter's shape (see formatGrepOutput in dsh-tool-fs-search): a
		* `Found X of Y matches` header, the matches grouped under file headers with
		* `Line N:` rows, then a spill-recovery footer.
		*/
		const SEARCH_MATCHES_TEXT = [
			"Found 9 of 42 matches",
			"",
			...SEARCH_MATCHES_FIXTURE.map((file) => [file.path, ...file.matches.map((m) => `Line ${m.lineNumber}: ${m.line}`)].join("\n")),
			"",
			"(Full grep result stored at: fixture://spill/grep-66. Read it to see every match.)"
		].join("\n");
		/**
		* Structured glob result for the search sample (turn 68): a flat path list,
		* truncated with a larger `total` so the path card shows its capped indicator.
		*/
		const SEARCH_PATHS_FIXTURE = [
			"packages/client/ui-primitives/src/SearchBlock.tsx",
			"packages/client/ui-primitives/src/SearchBlock.module.css",
			"packages/client/ui-tool/src/client/tool/models/search-card-model.ts",
			"packages/client/ui-tool/src/client/tool/toolviews/search-row.tsx",
			"packages/client/ui-tool/tests/search-card.client.spec.tsx"
		];
		/**
		* The model-facing glob render text — the newline-joined path list plus a
		* spill-recovery footer, mirroring the real glob presenter's shape (see
		* formatGlobOutput in dsh-tool-fs-search).
		*/
		const SEARCH_PATHS_TEXT = [
			...SEARCH_PATHS_FIXTURE,
			"",
			"(Showing 5 of 23 paths. Full sorted result stored at: fixture://spill/glob-67. Read it to see every path.)"
		].join("\n");
		/**
		* Read-card sample for the read turn: a WINDOW past an offset, so the line
		* numbers start above 1 (the card's gutter keeps the file's own numbering) and
		* `totalLines` exceeds the window (the card shows a "showing N of M" note). The
		* fixture is client-side and cannot import the read tool, so the structured
		* window is authored inline exactly as the tool would project it through
		* `presentationMeta`. `lang` is a `ts` hint so the shiki path highlights it.
		*/
		const READ_SAMPLE_FIRST_LINE = 41;
		const READ_SAMPLE_SOURCE = [
			"export interface ReadBlockProps {",
			"  label?: string | undefined",
			"  lines: readonly ReadBlockLine[]",
			"  totalLines: number",
			"  lang?: string | undefined",
			"  maxLines?: number | undefined",
			"  className?: string | undefined",
			"}",
			"",
			"// A windowed read keeps the file line numbers in the gutter.",
			"const marker = \"fixture read sample\""
		];
		const READ_SAMPLE_LINES = READ_SAMPLE_SOURCE.map((text, index) => ({
			number: READ_SAMPLE_FIRST_LINE + index,
			text
		}));
		const READ_SAMPLE_PATH = "packages/client/ui-primitives/src/ReadBlock.tsx";
		const READ_SAMPLE_TOTAL = 180;
		const READ_SAMPLE_TEXT = READ_SAMPLE_SOURCE.map((text, index) => `${READ_SAMPLE_FIRST_LINE + index}: ${text}`).join("\n");
		/**
		* The structured `web_search` result view for the web-search turn, authored inline
		* because this client-side fixture cannot import the web tool that projects it.
		* The sources exercise the citation list's features: a titled source with a
		* snippet and a date, a source with no title (its hostname labels the link) and
		* a snippet but no date, and a source with a title and a date but no snippet.
		* `truncated` marks the capped indicator. The shape is the contract's own
		* search view minus its wire discriminants.
		*/
		const WEB_SEARCH_RESULT = {
			answer: "DeepSeek Harness is a plugin-based agent harness on vendored Cordis where **every capability is a plugin**.",
			sources: [
				{
					url: "https://github.com/deepseek-ai/deepseek-harness",
					title: "DeepSeek Harness — plugin-based agent harness",
					snippet: "Everything is a plugin: session, tools, agent-loop, and LLM adapters all mount on the same Cordis context.",
					publishedAt: "2026-07-01"
				},
				{
					url: "https://www.deepseek.com/blog/harness-architecture",
					snippet: "The capability-seam pattern splits each capability into interface, implementation, and consumer packages."
				},
				{
					url: "https://docs.deepseek.com/harness/plugins",
					title: "Writing a harness plugin",
					publishedAt: "2026-06-15"
				}
			],
			truncated: true
		};
		/** The `web_fetch` result view for the web-fetch turn, authored inline for the same reason. */
		const WEB_FETCH_RESULT = {
			url: "https://www.deepseek.com/blog/harness-architecture",
			statusCode: 200,
			truncated: false
		};
		const DEEPSEEK_REASONING = {
			efforts: [
				{
					id: "off",
					name: "Off"
				},
				{
					id: "high",
					name: "High"
				},
				{
					id: "max",
					name: "Max"
				}
			],
			defaultEffort: "high"
		};
		const OPENAI_REASONING = {
			efforts: [
				{
					id: "off",
					name: "Off"
				},
				{
					id: "medium",
					name: "Medium"
				},
				{
					id: "high",
					name: "High"
				},
				{
					id: "max",
					name: "Max"
				}
			],
			defaultEffort: "medium"
		};
		/** Catalog served by `session.models` and `llm.models` alike (fresh copies per call). */
		function fixtureModelGroups() {
			return [{
				id: "deepseek-official",
				name: "DeepSeek",
				models: [{
					id: "deepseek-v4-flash",
					name: "DeepSeek-V4-Flash",
					description: "快速响应",
					reasoning: DEEPSEEK_REASONING
				}, {
					id: "deepseek-v4-pro",
					name: "DeepSeek-V4-Pro",
					description: "复杂任务",
					reasoning: DEEPSEEK_REASONING
				}]
			}, {
				id: "openai",
				name: "OpenAI",
				models: [{
					id: "gpt-5",
					name: "GPT-5",
					reasoning: OPENAI_REASONING
				}]
			}];
		}
		function sid(id) {
			return id;
		}
		const FIXTURE_IMAGE_DATA = "iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAYAAAA/xl1SAAAAvklEQVR42u3SMQ0AAAjAMIyhELM4AAe8PD1qYFlk9cCXEAEDYkAwIAYEA2JAMCAGBANiQDAgBgQDYkAwIAYEA2JAMCAGBANiQDAgBgQDYkAwIAYEA2JAMCAGxIBCYEAMCAbEgGBADAgGxIBgQAwIBsSAYEAMCAbEgGBADAgGxIBgQAwIBsSAYEAMCAbEgGBADAgGxIAYEAyIAcGAGBAMiAHBgBgQDIgBwYAYEAyIAcGAGBAMiAHBgBgQDIgB4bYWLb6pnOb1xAAAAABJRU5ErkJggg==";
		const FIXTURE_IMAGE_REF = {
			attachmentId: "fixture:image",
			mediaType: "image/png",
			bytes: 247,
			width: 160,
			height: 90,
			name: "fixture-image.png"
		};
		/** Deterministic provider billing attached to fixture assistant messages. */
		function fixtureUsage(turn, step) {
			return {
				inputTokens: 20 + turn % 5,
				outputTokens: 8 + step,
				cacheReadTokens: turn === 0 ? 0 : 80,
				cacheWriteTokens: turn % 10 === 0 ? 4 : 0
			};
		}
		/** fx-alpha history script: 75 turns (~150+ messages -> 4 pages at PAGE_MESSAGES=50),
		*  mixing reasoning blocks / tool call+result / context. */
		function buildAlphaLog() {
			const events = [];
			let time = Date.now() - 36e5;
			const push = (e) => {
				const seq = events.length;
				const data = e["data"];
				const authored = e["type"] === "assistant/message" && data !== void 0 ? {
					...e,
					data: {
						...data,
						usage: fixtureUsage(data["turn"], data["step"])
					}
				} : e;
				events.push({
					seq,
					time: time += 800,
					...authored
				});
				return seq;
			};
			push({
				type: "request/context",
				data: {
					provider: "deepseek-official",
					model: "deepseek-v4-flash",
					contextWindow: 128e3
				}
			});
			for (let turn = 0; turn < 60; turn++) {
				push({
					type: "turn/start",
					data: { turn }
				});
				const userSeq = push({
					type: "user/message",
					surfaceOp: "append",
					data: userMessage(text(turn === 59 ? USER_MARKDOWN_LITERAL : `问题 ${turn}：fixture 历史消息，用于翻页与渲染验收。`))
				});
				if (turn === 0) push({
					type: "session/title",
					data: {
						title: "Fixture 历史会话",
						messageSeqs: [userSeq],
						source: { kind: "fallback" }
					}
				});
				if (turn % 9 === 4) push({
					type: "user/message",
					surfaceOp: "append",
					data: userMessage(text(`[fixture] 上下文注入（turn ${turn}）`), {
						kind: "plugin",
						plugin: "fixture"
					})
				});
				push({
					type: "step/start",
					data: {
						turn,
						step: 0
					}
				});
				const withTool = turn % 5 === 2;
				const withReasoning = turn % 3 === 1;
				const blocks = [];
				if (withReasoning) blocks.push({
					type: "reasoning",
					text: `思考过程 ${turn}：这是一段可折叠的 reasoning 内容。`
				});
				blocks.push({
					type: "text",
					text: turn === 59 ? MARKDOWN_FIXTURE : `回答 ${turn}：这是 fixture 生成的历史回复正文。`
				});
				if (withTool) {
					const callId = `fx-call-${turn}`;
					blocks.push({
						type: "tool-call",
						id: callId,
						name: "echo",
						arguments: `{"text":"turn ${turn}"}`
					});
					push({
						type: "assistant/message",
						surfaceOp: "append",
						data: {
							turn,
							step: 0,
							message: assistantMessage(blocks)
						}
					});
					push({
						type: "tool/call",
						data: {
							turn,
							step: 0,
							callId,
							name: "echo",
							arguments: `{"text":"turn ${turn}"}`
						}
					});
					push({
						type: "tool/result",
						surfaceOp: "append",
						data: {
							turn,
							step: 0,
							message: toolResultMessage(callId, text(`ECHO: TURN ${turn}`), turn % 25 === 12)
						}
					});
					push({
						type: "step/end",
						data: {
							turn,
							step: 0
						}
					});
					push({
						type: "step/start",
						data: {
							turn,
							step: 1
						}
					});
					push({
						type: "assistant/message",
						surfaceOp: "append",
						data: {
							turn,
							step: 1,
							message: assistantMessage(text(`工具结果已消化（turn ${turn}）。`))
						}
					});
					push({
						type: "step/end",
						data: {
							turn,
							step: 1
						}
					});
				} else {
					push({
						type: "assistant/message",
						surfaceOp: "append",
						data: {
							turn,
							step: 0,
							message: assistantMessage(blocks)
						}
					});
					push({
						type: "step/end",
						data: {
							turn,
							step: 0
						}
					});
				}
				push({
					type: "turn/end",
					data: {
						turn,
						reason: { kind: "completed" }
					}
				});
			}
			const toolTurn = (turn, name, args, resultText) => {
				const callId = `fx-call-${turn}`;
				push({
					type: "turn/start",
					data: { turn }
				});
				push({
					type: "user/message",
					surfaceOp: "append",
					data: userMessage(text(`问题 ${turn}：${name} 样本。`))
				});
				push({
					type: "step/start",
					data: {
						turn,
						step: 0
					}
				});
				push({
					type: "assistant/message",
					surfaceOp: "append",
					data: {
						turn,
						step: 0,
						message: assistantMessage([{
							type: "tool-call",
							id: callId,
							name,
							arguments: args
						}])
					}
				});
				push({
					type: "tool/call",
					data: {
						turn,
						step: 0,
						callId,
						name,
						arguments: args
					}
				});
				push({
					type: "tool/result",
					surfaceOp: "append",
					data: {
						turn,
						step: 0,
						message: toolResultMessage(callId, text(resultText), false)
					}
				});
				push({
					type: "step/end",
					data: {
						turn,
						step: 0
					}
				});
				push({
					type: "turn/end",
					data: {
						turn,
						reason: { kind: "completed" }
					}
				});
			};
			toolTurn(60, "fx-bash", "{\"command\":\"ls -la\\necho done\",\"cwd\":\"/tmp/fixture\"}", "total 2\ndrwxr-xr-x fixture\n-rw-r--r-- demo.txt");
			toolTurn(61, "fx-write", "{\"path\":\"notes/demo.txt\",\"content\":\"hello fixture\\n\"}", "wrote notes/demo.txt");
			toolTurn(62, "edit", "{\"file_path\":\"notes/demo.txt\",\"old_string\":\"hello\",\"new_string\":\"hello fixture\"}", "已编辑");
			toolTurn(63, "write", "{\"file_path\":\"notes/new-demo.txt\",\"content\":\"hello fixture\\n\"}", "已写入");
			toolTurn(64, "edit", "{\"file_path\":\"src/config.ts\",\"old_string\":\"const timeout = 30\",\"new_string\":\"const timeout = 60\"}", "已编辑");
			{
				const turn = 65;
				const callId = `fx-call-${turn}`;
				const args = JSON.stringify({
					code: "const listing = await tools.bash({ command: \"ls notes\", description: \"List notes\" })\nconst demo = await tools.read({ file_path: \"notes/demo.txt\" })\nawait tools.read({ file_path: \"notes/missing.txt\" }).catch(() => \"tolerated\")\nreturn { listing, demo }",
					description: "Read the notes files and summarize"
				});
				push({
					type: "turn/start",
					data: { turn }
				});
				push({
					type: "user/message",
					surfaceOp: "append",
					data: userMessage(text(`问题 ${turn}：run_code 样本。`))
				});
				push({
					type: "step/start",
					data: {
						turn,
						step: 0
					}
				});
				push({
					type: "assistant/message",
					surfaceOp: "append",
					data: {
						turn,
						step: 0,
						message: assistantMessage([{
							type: "tool-call",
							id: callId,
							name: "run_code",
							arguments: args
						}])
					}
				});
				push({
					type: "tool/call",
					data: {
						turn,
						step: 0,
						callId,
						name: "run_code",
						arguments: args
					}
				});
				const dispatchPair = (n, name, dispatchArgs, resultText, isError = false) => {
					push({
						type: "tool/code-dispatch-start",
						data: {
							rootCallId: callId,
							parentCallId: callId,
							subCallId: `${callId}:code:${n}`,
							name,
							arguments: dispatchArgs
						}
					});
					push({
						type: "tool/code-dispatch",
						data: {
							rootCallId: callId,
							parentCallId: callId,
							subCallId: `${callId}:code:${n}`,
							name,
							arguments: dispatchArgs,
							isError,
							content: [{
								type: "text",
								text: resultText
							}]
						}
					});
				};
				dispatchPair(1, "bash", {
					command: "ls notes",
					description: "List notes"
				}, "demo.txt\nnew-demo.txt");
				dispatchPair(2, "read", { file_path: "notes/demo.txt" }, "hello fixture\n");
				dispatchPair(3, "read", { file_path: "notes/missing.txt" }, "Error: ENOENT: notes/missing.txt not found", true);
				push({
					type: "tool/result",
					surfaceOp: "append",
					data: {
						turn,
						step: 0,
						message: toolResultMessage(callId, text("{\"listing\":\"demo.txt\\nnew-demo.txt\",\"demo\":\"hello fixture\\n\"}"), false)
					}
				});
				push({
					type: "step/end",
					data: {
						turn,
						step: 0
					}
				});
				push({
					type: "turn/end",
					data: {
						turn,
						reason: { kind: "completed" }
					}
				});
			}
			const fixtureTodos = [
				{
					content: "梳理需求",
					status: "completed"
				},
				{
					content: "实现 fixture 样本",
					status: "in_progress"
				},
				{
					content: "跑后台构建",
					status: "in_progress"
				},
				{
					content: "浏览器验收",
					status: "pending"
				}
			];
			toolTurn(66, "bash", "{\"command\":\"pnpm run check\",\"cwd\":\"/tmp/fixture/deep/nested\"}", TERMINAL_OUTPUT_FIXTURE);
			toolTurn(67, "grep", "{\"pattern\":\"SEARCH_MAX_LINES\",\"path\":\"packages/client\"}", SEARCH_MATCHES_TEXT);
			toolTurn(68, "glob", "{\"pattern\":\"**/SearchBlock*\",\"path\":\"packages/client\"}", SEARCH_PATHS_TEXT);
			toolTurn(69, "read", `{"file_path":${JSON.stringify(READ_SAMPLE_PATH)},"offset":${READ_SAMPLE_FIRST_LINE}}`, READ_SAMPLE_TEXT);
			toolTurn(70, "web_search", "{\"query\":\"deepseek harness architecture\"}", "Search results for deepseek harness architecture.");
			toolTurn(71, "web_fetch", "{\"url\":\"https://www.deepseek.com/blog/harness-architecture\"}", "# Harness architecture\n\nEverything is a plugin.");
			push({
				type: "turn/start",
				data: { turn: 72 }
			});
			push({
				type: "user/message",
				surfaceOp: "append",
				data: userMessage(text("问题 72：请完整列出全部一百条条目。"))
			});
			push({
				type: "step/start",
				data: {
					turn: 72,
					step: 0
				}
			});
			push({
				type: "assistant/message",
				surfaceOp: "append",
				data: {
					turn: 72,
					step: 0,
					message: assistantMessage(text("条目 1：第一条。条目 2：第二条。条目 3：这一条写到一半被"))
				}
			});
			push({
				type: "step/end",
				data: {
					turn: 72,
					step: 0
				}
			});
			push({
				type: "turn/end",
				data: {
					turn: 72,
					reason: { kind: "max-tokens" }
				}
			});
			push({
				type: "turn/start",
				data: { turn: 73 }
			});
			push({
				type: "user/message",
				surfaceOp: "append",
				data: userMessage([{
					type: "image",
					attachment: FIXTURE_IMAGE_REF
				}, ...text("历史用户图片")])
			});
			push({
				type: "step/start",
				data: {
					turn: 73,
					step: 0
				}
			});
			push({
				type: "assistant/message",
				surfaceOp: "append",
				data: {
					turn: 73,
					step: 0,
					message: assistantMessage([...text("结构化模型图片："), {
						type: "image",
						attachment: FIXTURE_IMAGE_REF
					}], "fx-vision")
				}
			});
			push({
				type: "step/end",
				data: {
					turn: 73,
					step: 0
				}
			});
			push({
				type: "turn/end",
				data: {
					turn: 73,
					reason: { kind: "completed" }
				}
			});
			toolTurn(74, "todo_write", JSON.stringify({ todos: fixtureTodos }), "Updated todo list: 1 pending, 2 in progress, 1 completed.");
			const callIndex = events.length - 4;
			const callTime = events[callIndex]?.time;
			events.splice(callIndex + 1, 0, {
				type: "todo/write",
				time: callTime + 400,
				data: { todos: fixtureTodos }
			});
			events.forEach((e, i) => {
				e.seq = i;
			});
			return events;
		}
		/** Narrows a parsed-JSON field to string; fixture args are authored in-file, so non-strings only mean a typo here. */
		/* v8 ignore next -- the fallback arm is the same in-file-typo guard as the JSON.parse catch above. */
		const str = (value, fallback = "") => typeof value === "string" ? value : fallback;
		/** Fixture presenter registry (mirrors host viewFor): pure derivation, undefined = no view. */
		function presentCall(name, argsRaw) {
			let args;
			try {
				args = JSON.parse(argsRaw);
			} catch {
				/* v8 ignore next 2 -- defensive: fixture args are authored in-file as valid JSON; only an in-file typo could reach the catch. */
				return;
			}
			switch (name) {
				case "fx-bash":
				case "bash": return {
					card: "terminal",
					title: str(args.command),
					cwd: str(args.cwd, "/tmp/fixture"),
					description: "fixture 终端样本"
				};
				case "fx-write": return {
					card: "diff",
					title: `Write ${str(args.path)}`,
					diffs: [{
						path: str(args.path),
						oldText: null,
						newText: str(args.content)
					}]
				};
				case "read": return {
					card: "generic",
					title: `Read ${str(args.file_path)}`,
					kind: "read",
					locations: [{ path: str(args.file_path) }]
				};
				case "edit":
					if (str(args.file_path) === "src/config.ts") return {
						card: "diff",
						title: `Edit ${str(args.file_path)}`,
						diffs: [{
							path: str(args.file_path),
							oldText: "const timeout = 30",
							newText: "const timeout = 60"
						}, {
							path: str(args.file_path),
							oldText: "retries: 1",
							newText: "retries: 3"
						}]
					};
					return {
						card: "diff",
						title: `Edit ${str(args.file_path)}`,
						diffs: [{
							path: str(args.file_path),
							oldText: str(args.old_string),
							newText: str(args.new_string)
						}]
					};
				case "write": return {
					card: "diff",
					title: `Write ${str(args.file_path)}`,
					diffs: [{
						path: str(args.file_path),
						oldText: null,
						newText: str(args.content)
					}]
				};
				case "grep": return {
					card: "generic",
					title: `Grep ${str(args.pattern)}`,
					kind: "search",
					rawInput: args
				};
				case "glob": return {
					card: "generic",
					title: `Glob ${str(args.pattern)}`,
					kind: "search",
					rawInput: args
				};
				case "web_search": return {
					card: "generic",
					title: `Search ${str(args.query)}`,
					kind: "search",
					rawInput: args
				};
				case "web_fetch": return {
					card: "generic",
					title: `Fetch ${str(args.url)}`,
					kind: "fetch",
					rawInput: args
				};
				default: return;
			}
		}
		function presentResult(name, argsRaw, resultText) {
			const call = presentCall(name, argsRaw);
			if (call === void 0) return void 0;
			if (name === "grep") return {
				card: "search",
				shape: "matches",
				files: SEARCH_MATCHES_FIXTURE,
				truncated: true,
				total: 42
			};
			if (name === "glob") return {
				card: "search",
				shape: "paths",
				paths: SEARCH_PATHS_FIXTURE,
				truncated: true,
				total: 23
			};
			if (name === "read") return {
				card: "read",
				path: READ_SAMPLE_PATH,
				offset: READ_SAMPLE_FIRST_LINE,
				lines: READ_SAMPLE_LINES,
				totalLines: READ_SAMPLE_TOTAL,
				lang: "ts",
				content: text(resultText)
			};
			if (name === "web_search") return {
				card: "web",
				kind: "search",
				...WEB_SEARCH_RESULT
			};
			if (name === "web_fetch") return {
				card: "web",
				kind: "fetch",
				...WEB_FETCH_RESULT
			};
			switch (call.card) {
				case "terminal": return {
					card: "terminal",
					output: resultText,
					...TERMINAL_EXIT_STATUS[resultText] ?? { exitCode: 0 }
				};
				case "diff": return {
					card: "diff",
					diffs: call.diffs
				};
				case "generic": return {
					card: "generic",
					content: text(resultText)
				};
			}
		}
		/** Host-side viewFor mirror: tool/call presents from its own args; tool/result back-scans the log for the paired call. */
		function viewFor(event, log) {
			if (event.type === "tool/call") {
				const view = presentCall(event.data.name, event.data.arguments);
				return view === void 0 ? void 0 : {
					for: "call",
					view
				};
			}
			if (event.type === "tool/result") {
				const callId = String(event.data.message.source.callId);
				for (let i = log.length - 1; i >= 0; i--) {
					const candidate = log[i];
					/* v8 ignore next -- dense-array guard: i stays within [0, log.length),
					so the undefined arm needs a sparse log no code path builds. */
					if (candidate !== void 0 && candidate.type === "tool/call" && String(candidate.data.callId) === callId) {
						const resultText = event.data.message.content[0].content.map((b) => b.type === "text" ? b.text : "").join("");
						const view = presentResult(candidate.data.name, candidate.data.arguments, resultText);
						return view === void 0 ? void 0 : {
							for: "result",
							view
						};
					}
				}
				return;
			}
		}
		/**
		* Fixture parallel of the plan unit's double-event fold: `command/run`
		* records named `plan` with recorded input set the wanted target (`off` →
		* false, else true); `plan/mode` commits and clears it. `wanted` is exposed
		* for the prompt boundary (the fixture's step/start parallel).
		*/
		function foldPlan(log) {
			let active = false;
			let wanted = null;
			for (const event of log) {
				const item = event;
				if (item.type === "command/run" && item.data?.["name"] === "plan") {
					const args = item.data["args"];
					if (typeof args !== "string") continue;
					wanted = args.trim() !== "off";
				} else if (item.type === "plan/mode") {
					active = item.data?.["active"] === true;
					wanted = null;
				}
			}
			return {
				active,
				pending: wanted !== null && wanted !== active,
				wanted
			};
		}
		/** The plan projection's wire view over the full log. */
		function planViewOf(log) {
			const plan = foldPlan(log);
			return {
				active: plan.active,
				pending: plan.pending
			};
		}
		/** Fixture parallel of the host's projection units: whole current values per key over the full log. */
		/** Fixture preset table (the host PermissionPresetService defaults). */
		const PERMISSION_PRESETS = {
			"workspace-write": {
				sandbox: "workspace-write",
				approval: "ask",
				description: "Write inside the workspace and permitted temporary directories; wider retries require approval."
			},
			"danger-full-access": {
				sandbox: "danger-full-access",
				approval: "never",
				description: "Full file access without approval prompts."
			}
		};
		/** Host permissions-unit parallel: fold the three knob events, derive the select over the fixture defaults. */
		function permissionSelectOf(log) {
			let preset = null;
			let sandbox = "workspace-write";
			let approval = "ask";
			for (const event of log) {
				const item = event;
				if (item.type === "permission/preset") preset = item.data["preset"];
				else if (item.type === "sandbox/mode") sandbox = item.data["mode"];
				else if (item.type === "approval/policy") approval = item.data["policy"];
			}
			const matches = (spec) => spec.sandbox === sandbox && spec.approval === approval;
			let currentValue = "custom";
			const folded = preset === null ? void 0 : PERMISSION_PRESETS[preset];
			if (preset !== null && folded !== void 0 && matches(folded)) currentValue = preset;
			else for (const [name, spec] of Object.entries(PERMISSION_PRESETS)) if (matches(spec)) {
				currentValue = name;
				break;
			}
			return {
				options: [...Object.entries(PERMISSION_PRESETS).map(([value, spec]) => ({
					value,
					name: value,
					description: spec.description
				})), ...currentValue === "custom" ? [{
					value: "custom",
					name: "Custom",
					description: "Current sandbox and approval settings do not match a preset."
				}] : []],
				currentValue
			};
		}
		/** Read one provider usage sample from either durable carrier. */
		function usageSampleOf(event) {
			const item = event;
			const usage = item.type === "assistant/chunk" && item.data.chunk?.type === "usage" ? item.data.chunk.usage : item.type === "assistant/message" ? item.data.usage : void 0;
			return usage === void 0 || item.data.turn === void 0 || item.data.step === void 0 ? void 0 : {
				turn: item.data.turn,
				step: item.data.step,
				usage
			};
		}
		/** Fixture parallel of token-meter's last-sample-replacing usage projection. */
		function tokenUsageOf(log) {
			const totals = {
				uncachedInputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0
			};
			let last = null;
			for (const event of log) {
				const sample = usageSampleOf(event);
				if (sample === void 0) continue;
				const buckets = {
					uncachedInputTokens: sample.usage.inputTokens,
					outputTokens: sample.usage.outputTokens,
					cacheReadTokens: sample.usage.cacheReadTokens ?? 0,
					cacheWriteTokens: sample.usage.cacheWriteTokens ?? 0
				};
				const previous = last?.turn === sample.turn && last.step === sample.step ? last.buckets : void 0;
				totals.uncachedInputTokens += buckets.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0);
				totals.outputTokens += buckets.outputTokens - (previous?.outputTokens ?? 0);
				totals.cacheReadTokens += buckets.cacheReadTokens - (previous?.cacheReadTokens ?? 0);
				totals.cacheWriteTokens += buckets.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0);
				last = {
					turn: sample.turn,
					step: sample.step,
					buckets
				};
			}
			return totals;
		}
		/** Fixture parallel of session-stats' whole-log counting and wall-time fold. */
		function sessionStatsOf(log) {
			const value = {
				turns: 0,
				steps: 0,
				llmMs: 0,
				toolMs: 0,
				ttftMs: 0,
				ttftSteps: 0,
				decodeMs: 0,
				decodeTokens: 0
			};
			let lastTurn = null;
			let openStep = null;
			const pendingCalls = /* @__PURE__ */ new Map();
			for (const event of log) switch (event.type) {
				case "step/start":
					openStep = {
						turn: event.data.turn,
						step: event.data.step,
						startTime: event.time,
						firstTokenTime: null
					};
					break;
				case "assistant/chunk":
					if (openStep !== null && openStep.turn === event.data.turn && openStep.step === event.data.step && openStep.firstTokenTime === null && isTokenDelta(event.data.chunk)) openStep.firstTokenTime = event.time;
					break;
				case "assistant/message":
					if (openStep === null || openStep.turn !== event.data.turn || openStep.step !== event.data.step) break;
					value.llmMs += Math.max(0, event.time - openStep.startTime);
					if (openStep.firstTokenTime !== null) {
						value.ttftMs += Math.max(0, openStep.firstTokenTime - openStep.startTime);
						value.ttftSteps += 1;
						const outputTokens = event.data.usage?.outputTokens;
						if (typeof outputTokens === "number" && Number.isFinite(outputTokens) && outputTokens >= 0) {
							value.decodeMs += Math.max(0, event.time - openStep.firstTokenTime);
							value.decodeTokens += outputTokens;
						}
					}
					openStep = null;
					break;
				case "tool/call":
					pendingCalls.set(event.data.callId, event.time);
					break;
				case "tool/result": {
					const callId = event.data.message.source.callId;
					const dispatched = pendingCalls.get(callId);
					if (dispatched === void 0) break;
					pendingCalls.delete(callId);
					value.toolMs += Math.max(0, event.time - dispatched);
					break;
				}
				case "step/end":
					if (event.data.turn !== lastTurn) {
						value.turns += 1;
						lastTurn = event.data.turn;
					}
					value.steps += 1;
					openStep = null;
					break;
				case "turn/end":
					pendingCalls.clear();
					break;
				default: break;
			}
			return value;
		}
		/** Fixed token-meter heuristic constants mirrored by this client-only fixture. */
		const CHARS_PER_TOKEN = 4;
		const BLOCK_OVERHEAD = 4;
		const ROLE_OVERHEAD = 4;
		/** Price fixture content with token-meter's fixed-density heuristic. */
		function estimateFixtureContent(blocks) {
			const densityPrice = (value) => Math.ceil(value.length / CHARS_PER_TOKEN);
			return blocks.reduce((tokens, block) => {
				if (block.type === "text" || block.type === "reasoning") return tokens + densityPrice(block.text) + BLOCK_OVERHEAD;
				if (block.type === "tool-call") return tokens + densityPrice(block.name) + densityPrice(block.arguments) + BLOCK_OVERHEAD;
				if (block.type === "tool-result") return tokens + estimateFixtureContent(block.content) + BLOCK_OVERHEAD;
				return tokens + densityPrice(JSON.stringify(block)) + BLOCK_OVERHEAD;
			}, 0);
		}
		/** Fixture parallel of token-meter's heuristic context-composition projection. */
		function contextBreakdownOf(log) {
			const headerEvent = log.findLast((event) => event.type === "request/header");
			const header = headerEvent === void 0 ? void 0 : headerEvent.data.header;
			let messageTokens = 0;
			for (const seq of foldSurface(log).nodes) {
				const event = log[seq];
				if (event === void 0) continue;
				const message = deriveEventMessage(event);
				if (message !== null) messageTokens += estimateFixtureContent(message.content) + ROLE_OVERHEAD;
			}
			return {
				systemTokens: header?.system === void 0 ? 0 : Math.ceil(header.system.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD,
				toolsTokens: header?.tools === void 0 || header.tools.length === 0 ? 0 : Math.ceil(JSON.stringify(header.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD,
				messageTokens
			};
		}
		/** Latest log-only route context, or undefined before any request ran. */
		function lastRequestContext(log) {
			const event = log.findLast((item) => item.type === "request/context");
			return event === void 0 ? void 0 : event.data;
		}
		/**
		* Fixture parallel of token-meter's request-pressure projection: the last
		* provider-reported prompt size paired with the last recorded capacity. The
		* two need not come from one request — see the token-meter README. The host's
		* `projectedTokens` is deliberately absent: reproducing it would mean
		* reimplementing the estimator client-side, and every consumer falls back to
		* the bare sample, so a fixture-driven view simply lags a compaction the way
		* the projection did before that field existed.
		*/
		function contextPressureOf(log) {
			let pressureTokens;
			for (const event of log) {
				const sample = usageSampleOf(event);
				if (sample === void 0) continue;
				pressureTokens = sample.usage.inputTokens + (sample.usage.cacheReadTokens ?? 0) + (sample.usage.cacheWriteTokens ?? 0);
			}
			const contextWindow = lastRequestContext(log)?.contextWindow;
			return {
				...pressureTokens === void 0 ? {} : { pressureTokens },
				...contextWindow === void 0 ? {} : { contextWindow }
			};
		}
		function projectionValuesOf(log) {
			const values = {};
			const titleEvent = log.findLast((item) => item.type === "session/title");
			if (titleEvent !== void 0) values["title"] = titleEvent.data.title;
			values["todos"] = backscanTodos(log) ?? null;
			values["permissions"] = permissionSelectOf(log);
			values["plan"] = planViewOf(log);
			values["goal"] = backscanGoal(log);
			values["tokenUsage"] = tokenUsageOf(log);
			values["contextPressure"] = contextPressureOf(log);
			values["contextBreakdown"] = contextBreakdownOf(log);
			values["sessionStats"] = sessionStatsOf(log);
			values["imageLimits"] = {
				maxImageBytes: 5 * 1024 * 1024,
				maxImagesPerMessage: 20,
				maxMessageImageBytes: 100 * 1024 * 1024,
				maxImagePixels: 4e7,
				mediaTypes: [
					"image/png",
					"image/jpeg",
					"image/webp",
					"image/gif"
				]
			};
			return values;
		}
		/** Host push-frame parallel: emit one session/projection frame per key the given event advanced. */
		function projectionFramesOf(id, log, event) {
			const type = event.type;
			const frames = [];
			if (usageSampleOf(event) !== void 0) frames.push({
				type: "session/projection",
				sessionId: id,
				key: "tokenUsage",
				value: tokenUsageOf(log),
				seq: event.seq
			}, {
				type: "session/projection",
				sessionId: id,
				key: "contextPressure",
				value: contextPressureOf(log),
				seq: event.seq
			});
			if (type === "request/context") frames.push({
				type: "session/projection",
				sessionId: id,
				key: "contextPressure",
				value: contextPressureOf(log),
				seq: event.seq
			});
			if (type === "request/header" || type === "user/message" || type === "assistant/message" || type === "tool/result") frames.push({
				type: "session/projection",
				sessionId: id,
				key: "contextBreakdown",
				value: contextBreakdownOf(log),
				seq: event.seq
			});
			if (type === "assistant/message" || type === "tool/result" || type === "step/end") frames.push({
				type: "session/projection",
				sessionId: id,
				key: "sessionStats",
				value: sessionStatsOf(log),
				seq: event.seq
			});
			if (frames.length > 0) return frames;
			if (type === "session/title") {
				const values = projectionValuesOf(log);
				/* v8 ignore next -- the advancing title event is in the log, so the key is present. */
				if (!Object.hasOwn(values, "title")) return [];
				return [{
					type: "session/projection",
					sessionId: id,
					key: "title",
					value: values["title"],
					seq: event.seq
				}];
			}
			if (type === "goal/change") return [{
				type: "session/projection",
				sessionId: id,
				key: "goal",
				value: backscanGoal(log),
				seq: event.seq
			}];
			if (type === "todo/write" || type === "turn/start") return [{
				type: "session/projection",
				sessionId: id,
				key: "todos",
				value: backscanTodos(log) ?? null,
				seq: event.seq
			}];
			if (type === "permission/preset" || type === "sandbox/mode" || type === "approval/policy") return [{
				type: "session/projection",
				sessionId: id,
				key: "permissions",
				value: permissionSelectOf(log),
				seq: event.seq
			}];
			const commandData = event;
			if (type === "plan/mode" || type === "command/run" && commandData.data.name === "plan" && typeof commandData.data.args === "string") return [{
				type: "session/projection",
				sessionId: id,
				key: "plan",
				value: planViewOf(log),
				seq: event.seq
			}];
			return [];
		}
		/**
		* Message-boundary paging (mirrors the host's paging contract): count
		* maxMessages messages
		*  backwards from end, cut at a turn/start boundary.
		Entries carry pagination-time views
		*  (the host analogue computes viewFor per entry at page time). */
		function pageOf(log, beforeSeq, maxMessages) {
			const end = beforeSeq === void 0 ? log.length : Math.max(0, Math.min(beforeSeq, log.length));
			let start = 0;
			let messages = 0;
			for (let i = end - 1; i >= 0; i--) {
				const event = log[i];
				/* v8 ignore next -- dense-array guard: log seqs are array indexes, i stays within [0, end). */
				if (event === void 0) break;
				if (event.type === "user/message" || event.type === "assistant/message") messages++;
				if (event.type === "turn/start" && messages >= maxMessages) {
					start = i;
					break;
				}
			}
			return {
				events: log.slice(start, end).map((event) => {
					const view = viewFor(event, log);
					return view === void 0 ? { event } : {
						event,
						view
					};
				}),
				hasMore: start > 0
			};
		}
		/** Fixture mirror of host session-scoped attachment authorization. */
		function logReferencesAttachment(log, attachmentId) {
			const visit = (value) => {
				if (Array.isArray(value)) return value.some(visit);
				if (typeof value !== "object" || value === null) return false;
				const record = value;
				if (record.attachmentId === attachmentId) return true;
				return Object.values(record).some(visit);
			};
			return log.some((event) => visit(event.data));
		}
		/** Fixture mirror of first-party message extraction used by session-query. */
		function searchBlockText(block) {
			switch (block.type) {
				case "text": return [block.text];
				case "reasoning": return [];
				case "tool-call": return [block.name, block.arguments];
				case "tool-result": return block.content.flatMap(searchBlockText);
				default: return [];
			}
		}
		/** One current-surface user/assistant document, if searchable. */
		function searchEventText(event) {
			const content = event.type === "user/message" ? event.data.content : event.type === "assistant/message" ? event.data.message.content : void 0;
			if (content === void 0) return "";
			return content.flatMap(searchBlockText).map((part) => part.trim()).filter(Boolean).join("\n");
		}
		/**
		* Browser-safe approximation of SQLite FTS5 unicode61 token boundaries.
		* Keeping phrase matching token-based prevents the development fixture from
		* promising arbitrary within-token substring behavior that production lacks.
		*/
		function searchTokenSpans(value) {
			const text = value.replace(/\s+/gu, " ").trim();
			const characters = Array.from(text);
			const tokens = [];
			let start;
			let raw = "";
			const flush = (end) => {
				if (start !== void 0) {
					const folded = raw.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
					if (folded !== "") tokens.push({
						value: folded,
						start,
						end
					});
				}
				start = void 0;
				raw = "";
			};
			for (let index = 0; index < characters.length; index++) {
				const character = characters[index];
				const tokenBase = character.normalize("NFD").replace(/\p{M}+/gu, "");
				if (tokenBase === "") {
					if (start !== void 0) raw += character;
					continue;
				}
				if (/^[\p{L}\p{N}\p{Co}]+$/u.test(tokenBase)) {
					start ??= index;
					raw += character;
				} else flush(index);
			}
			flush(characters.length);
			return {
				text,
				tokens
			};
		}
		/** Count exact contiguous token-phrase occurrences and retain the first display span. */
		function phraseMatch(document, phrase) {
			if (phrase.length === 0 || phrase.length > document.length) return {
				count: 0,
				start: 0,
				end: 0
			};
			let count = 0;
			let firstStart = 0;
			let firstEnd = 0;
			for (let start = 0; start <= document.length - phrase.length; start++) {
				if (!phrase.every((token, offset) => document[start + offset]?.value === token)) continue;
				count++;
				if (count === 1) {
					firstStart = document[start]?.start ?? 0;
					firstEnd = document[start + phrase.length - 1]?.end ?? firstStart;
				}
			}
			return {
				count,
				start: firstStart,
				end: firstEnd
			};
		}
		/** Match-centered fixture excerpt, bounded by Unicode code points for the sidebar. */
		function searchSnippet(value, matchStart, matchEnd) {
			const characters = Array.from(value);
			if (characters.length <= 120) return value;
			const boundedStart = Math.min(Math.max(0, matchStart), characters.length - 1);
			const boundedEnd = Math.min(characters.length, Math.max(boundedStart + 1, matchEnd));
			const center = Math.floor((boundedStart + boundedEnd) / 2);
			let start = Math.min(characters.length - 118, Math.max(0, center - Math.floor(118 / 2)));
			let end = start + 118;
			if (start === 0) end = 119;
			else if (end === characters.length) start = characters.length - 119;
			return `${start > 0 ? "…" : ""}${characters.slice(start, end).join("")}${end < characters.length ? "…" : ""}`;
		}
		/** Mirrors `packages/session-query/session-query-sqlite/src/index.ts`; update both together. */
		function compareSearchCandidates(a, b) {
			if (a.matchCount !== b.matchCount) return b.matchCount - a.matchCount;
			if (a.documentLength !== b.documentLength) return a.documentLength - b.documentLength;
			if (a.time !== b.time) return b.time - a.time;
			if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
			return b.seq - a.seq;
		}
		/**
		* Current plan projection over the full log (host parallel: latest todo/write
		* with no later turn/start; a new turn retires the previous plan).
		*/
		function backscanTodos(log) {
			for (let i = log.length - 1; i >= 0; i--) {
				const event = log[i];
				if (event === void 0) continue;
				if (event.type === "turn/start") return void 0;
				if (event.type === "todo/write") return event.data.todos;
			}
		}
		/**
		* Current goal projection over the full log (host parallel: the GoalService
		* unit's last-wins fold of goal/change whole values; clear returns null).
		*/
		function backscanGoal(log) {
			for (let i = log.length - 1; i >= 0; i--) {
				const event = log[i];
				if (event === void 0 || event.type !== "goal/change" || event.data === void 0) continue;
				const change = event.data;
				if (change.operation === "clear") return null;
				return {
					goal: change.goal,
					roundsStarted: change.roundsStarted,
					createdAt: change.createdAt,
					updatedAt: change.updatedAt
				};
			}
			return null;
		}
		/** Inbox pump shared by both stream generators (FrameQueue pattern: ONE abort listener hung
		*  outside the loop — a per-iteration {once:true} listener never fires for non-final rounds and
		*  piles up for the stream's lifetime). breakNow force-ends the stream without the
		*  client's signal (timing hook: simulated connection loss). */
		var FxInbox = class {
			inbox = [];
			wake = null;
			broken = false;
			push(envelope) {
				this.inbox.push(envelope);
				this.wake?.();
			}
			breakNow() {
				this.broken = true;
				this.wake?.();
			}
			/** Read through a method: breakNow()/abort flip state across yields, so narrowing from the loop condition must not stick. */
			isLive(signal) {
				return !signal.aborted && !this.broken;
			}
			async *drain(signal) {
				const onAbort = () => this.wake?.();
				signal.addEventListener("abort", onAbort);
				try {
					while (this.isLive(signal)) {
						while (this.inbox.length > 0) yield this.inbox.shift();
						if (!this.isLive(signal)) break;
						await new Promise((resolve) => {
							this.wake = resolve;
						});
						this.wake = null;
					}
				} finally {
					signal.removeEventListener("abort", onAbort);
				}
			}
		};
		/** Build the fixture's legacy API and Remote RPC faces over one state graph. */
		function createFixtureWorld(options) {
			const sessions = options.empty ? [] : [
				{
					sessionId: sid("fx-alpha"),
					updatedAt: Date.now(),
					running: true,
					blank: false,
					cwd: "/tmp/fixture"
				},
				{
					sessionId: sid("fx-beta"),
					updatedAt: Date.now() - 6e4,
					running: false,
					blank: false,
					parentSessionId: sid("fx-alpha"),
					cwd: "/tmp/fixture"
				},
				{
					sessionId: sid("fx-gamma"),
					updatedAt: Date.now() - 12e4,
					running: false,
					blank: false,
					cwd: "/tmp/fixture"
				}
			];
			const logs = new Map([[sid("fx-alpha"), buildAlphaLog()]]);
			const modelSelections = new Map(sessions.map((session) => [session.sessionId, {
				provider: "deepseek-official",
				model: "deepseek-v4-flash"
			}]));
			const attachments = new Map([[String(FIXTURE_IMAGE_REF.attachmentId), {
				attachment: FIXTURE_IMAGE_REF,
				data: FIXTURE_IMAGE_DATA
			}]]);
			/** Credential store double: set/unset flip the describe badge, values never read back. */
			const fixtureCredentials = new Map([["DEEPSEEK_API_KEY", true]]);
			/**
			* Preset compositions the fixture serves. Held as state rather than
			* constants so the settings editor's save and delete are exercisable: the
			* roster a GUI journey sees after writing is the text it wrote.
			*/
			const fixturePresets = new Map([
				["standard", {
					trust: "system",
					content: "- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n"
				}],
				["minimal", {
					trust: "system",
					content: "- id: tool-web-search\n  name: '@deepseek-ai/dsh-tool-web-search'\n"
				}],
				["my-agent", {
					trust: "user",
					content: "- id: tool-read\n  name: '@deepseek-ai/dsh-tool-read'\n"
				}]
			]);
			let fixtureDefaultPreset = "standard";
			const nextTurn = new Map([[sid("fx-alpha"), 75]]);
			let nextSession = 1;
			let nextRpc = 1;
			let attachedSessions = options.empty ? 0 : 1;
			const wid = (raw) => raw;
			const fixtureEpoch = (/* @__PURE__ */ new Date(Date.now() - 3e5)).toISOString();
			const workspaces = options.empty ? [] : [{
				workspaceId: wid("fx-ws-fixture"),
				path: "/tmp/fixture",
				title: "fixture",
				sessionIds: [
					sid("fx-alpha"),
					sid("fx-beta"),
					sid("fx-gamma")
				],
				createdAt: fixtureEpoch,
				updatedAt: fixtureEpoch
			}];
			let nextWorkspace = 1;
			const archivedSessionIds = [];
			const FIXTURE_HOME = "/home/fixture";
			const directoryTree = new Map([
				["/", ["home"]],
				["/home", ["fixture"]],
				[FIXTURE_HOME, [
					"Documents",
					"Downloads",
					".config"
				]],
				[`${FIXTURE_HOME}/Documents`, [
					"project",
					"deepseek-iOS",
					"deepseek-android",
					"deepseek-platform",
					"deepseek-web",
					"deepseek-harness",
					"deepseek-app",
					"deepseek-landing-blog"
				]]
			]);
			const childrenOf = (path) => {
				const known = directoryTree.get(path);
				if (known !== void 0) return known;
				const parent = path.slice(0, path.lastIndexOf("/")) || "/";
				const name = path.slice(path.lastIndexOf("/") + 1);
				return directoryTree.get(parent)?.includes(name) === true ? [] : void 0;
			};
			const crumbsOf = (path) => {
				const crumbs = [{
					name: "/",
					path: "/",
					hidden: false
				}];
				let acc = "";
				for (const segment of path.split("/").filter(Boolean)) {
					acc += `/${segment}`;
					crumbs.push({
						name: segment,
						path: acc,
						hidden: false
					});
				}
				return crumbs;
			};
			const mint = () => RpcId(`fx-rpc-${nextRpc++}`);
			/** Resident pending approval (stable rpcId: every mux open replays the same id while unanswered, matching host replay semantics). */
			const pendingApprovalRpcId = mint();
			const pendingApprovalId = "fx-approval-1";
			/** Cleared once answered through respond; replay stops and approval/resolved is broadcast. */
			let approvalPending = true;
			const pendingQuestionRpcId = mint();
			let questionPending = true;
			const fixtureQuestions = [
				{
					id: "harness-profile",
					header: "偏好",
					question: "你现在更想招哪类 Agent/Harness 候选人？",
					options: [
						{
							label: "工程落地型 (Recommended)",
							description: "更看重能直接做 runtime、tool executor、sandbox、trace 和线上问题排查。"
						},
						{
							label: "研究潜力型",
							description: "更看重 Agent 理解、训练评测思路和长期成长空间。"
						},
						{
							label: "均衡型",
							description: "同时要求工程能力和 Agent 认知，但可能筛选门槛更高。"
						}
					]
				},
				{
					id: "work-mode",
					header: "方式",
					question: "你希望候选人优先展示哪种工作方式？",
					options: [{
						label: "先做小型原型 (Recommended)",
						description: "用可运行结果尽快验证关键假设。"
					}, {
						label: "先写完整设计",
						description: "先收敛边界、协议和风险，再开始实现。"
					}]
				},
				{
					id: "signals",
					header: "信号",
					question: "哪些面试信号最重要？",
					detail: "按当前招聘目标选择；跳过则视为不设偏好。",
					multiSelect: true,
					options: [
						{ label: "系统设计" },
						{ label: "代码质量" },
						{ label: "Agent 产品判断" }
					]
				}
			];
			const muxConns = /* @__PURE__ */ new Set();
			const hostConns = /* @__PURE__ */ new Set();
			const emitMux = (frame) => {
				for (const conn of muxConns) conn.push({
					rpcId: mint(),
					payload: frame
				});
			};
			const emitHost = (frame) => {
				for (const conn of hostConns) conn.push({
					rpcId: mint(),
					payload: frame
				});
			};
			/** OK response echoing the caller's rpcId (contract: responses always backfill, never mint). */
			function ok(request, value) {
				return Promise.resolve({
					rpcId: request.rpcId,
					result: {
						ok: true,
						value
					}
				});
			}
			function err(request, error) {
				return Promise.resolve({
					rpcId: request.rpcId,
					result: {
						ok: false,
						error
					}
				});
			}
			const summaryOf = (id) => sessions.find((s) => s.sessionId === id);
			/** Shared session guard for sessionId-addressed catalog routes: the error
			*  response when the session is unknown, undefined when it exists. */
			const requireSession = (request) => {
				if (summaryOf(request.payload.sessionId) !== void 0) return void 0;
				return err(request, {
					code: "session-not-found",
					message: `no session ${request.payload.sessionId}`,
					details: { sessionId: request.payload.sessionId }
				});
			};
			const setRunning = (id, running) => {
				const summary = summaryOf(id);
				if (summary === void 0 || summary.running === running) return;
				summary.running = running;
				emitHost({
					type: "host/session-status",
					sessionId: id,
					running
				});
			};
			const logOf = (id) => {
				let log = logs.get(id);
				if (log === void 0) {
					log = [];
					logs.set(id, log);
				}
				return log;
			};
			const append = (id, e) => {
				const log = logOf(id);
				const event = {
					seq: log.length,
					time: Date.now(),
					...e
				};
				log.push(event);
				const view = viewFor(event, log);
				/* v8 ignore next 3 -- the view-present arm needs a live tool/call emission,
				but the fixture replay produces text-only turns; view vocabulary is
				exercised through the history samples (turns 60-62). */
				emitMux(view === void 0 ? {
					type: "session/event",
					sessionId: id,
					event
				} : {
					type: "session/event",
					sessionId: id,
					event,
					view
				});
				for (const frame of projectionFramesOf(id, log, event)) emitMux(frame);
			};
			/** Append one durable goal/change (host GoalService parallel). */
			const appendGoalChange = (id, change) => {
				const log = logOf(id);
				append(id, {
					type: "goal/change",
					data: change
				});
				return backscanGoal(log);
			};
			const goalFailure = (message) => ({
				ok: false,
				error: {
					code: "internal",
					message,
					details: {}
				}
			});
			const requireGoalSession = (id) => summaryOf(id) === void 0 ? {
				ok: false,
				error: {
					code: "session-not-found",
					message: `no session ${id}`,
					details: { sessionId: id }
				}
			} : void 0;
			/** Canonical fixture implementation of the generated Commands Remote contract. */
			const commandRemotes = {
				list(id) {
					const missing = requireGoalSession(id);
					if (missing !== void 0) return missing;
					return {
						ok: true,
						value: [
							{
								name: "compact",
								description: "fixture：压缩当前会话上下文"
							},
							{
								name: "echo",
								description: "fixture：回显参数",
								input: { hint: "text to echo" }
							},
							{
								name: "goal",
								description: "set or view the goal for a long-running task",
								input: { hint: "<objective>" }
							},
							{
								name: "permission",
								description: "Switch the permission preset (sandbox mode + approval policy)",
								input: { hint: "<preset>" }
							},
							{
								name: "plan",
								description: "Enter or leave plan mode",
								input: { hint: "[off|message]" }
							}
						]
					};
				},
				execute(id, line) {
					const missing = requireGoalSession(id);
					if (missing !== void 0) return missing;
					const match = /^\/(\S+)((?:\s.*)?)$/.exec(line.trim());
					const name = match?.[1];
					const args = match?.[2] ?? "";
					if (name === "permission") {
						const preset = args.trim();
						const commandId = `fx-cmd-${logOf(id).length}`;
						append(id, {
							type: "command/run",
							data: {
								commandId,
								name,
								args,
								source: { kind: "user" }
							}
						});
						const spec = PERMISSION_PRESETS[preset];
						let result;
						if (preset === "") result = {
							kind: "success",
							text: `current preset ${permissionSelectOf(logOf(id)).currentValue} (available: ${Object.keys(PERMISSION_PRESETS).join(", ")})`
						};
						else if (spec === void 0) result = {
							kind: "error",
							text: `unknown preset "${preset}" (available: ${Object.keys(PERMISSION_PRESETS).join(", ")})`
						};
						else {
							if (permissionSelectOf(logOf(id)).currentValue !== preset) append(id, {
								type: "permission/preset",
								data: { preset }
							});
							append(id, {
								type: "sandbox/mode",
								data: { mode: spec.sandbox }
							});
							append(id, {
								type: "approval/policy",
								data: { policy: spec.approval }
							});
							result = {
								kind: "success",
								text: `preset ${preset}`
							};
						}
						append(id, {
							type: "command/done",
							data: {
								commandId,
								...result
							}
						});
						return {
							ok: true,
							value: {
								commandId,
								result
							}
						};
					}
					if (name === "goal") {
						const commandId = `fx-cmd-${logOf(id).length}`;
						append(id, {
							type: "command/run",
							data: {
								commandId,
								name,
								args,
								source: { kind: "user" }
							}
						});
						const objective = args.trim();
						const current = backscanGoal(logOf(id));
						let text;
						if (objective === "") text = current === null ? "No goal is set. Usage: /goal <objective>" : `Current goal: ${current.goal.objective}`;
						else if (current !== null && current.goal.phase !== "complete") text = `A goal already exists (${current.goal.objective}). Clear it first.`;
						else text = `Goal created: ${appendGoalChange(id, {
							kind: "goal/change",
							version: 1,
							operation: "create",
							goal: {
								id: `fx-goal-${logOf(id).length}`,
								revision: 1,
								objective,
								phase: "active",
								maxGoalRounds: 256
							},
							roundsStarted: 0,
							createdAt: Date.now(),
							updatedAt: Date.now()
						}).goal.objective}`;
						const result = {
							kind: "success",
							text
						};
						append(id, {
							type: "command/done",
							data: {
								commandId,
								...result
							}
						});
						return {
							ok: true,
							value: {
								commandId,
								result
							}
						};
					}
					const running = summaryOf(id)?.running === true;
					const outcomes = {
						compact: "fixture：已压缩（假动作）",
						echo: args.trim(),
						plan: args.trim() === "off" ? running ? "Leaving plan mode (applies from the next step)." : "Plan mode off." : running ? "Entering plan mode (applies from the next step). Use /plan off to leave." : "Plan mode on. Use /plan off to leave."
					};
					const text = name === void 0 ? void 0 : outcomes[name];
					if (name === void 0 || text === void 0) return {
						ok: true,
						value: void 0
					};
					const commandId = `fx-cmd-${logOf(id).length}`;
					append(id, {
						type: "command/run",
						data: {
							commandId,
							name,
							args,
							source: { kind: "user" }
						}
					});
					if (name === "plan" && !running) {
						const plan = foldPlan(logOf(id));
						if (plan.wanted !== null && plan.wanted !== plan.active) append(id, {
							type: "plan/mode",
							data: { active: plan.wanted }
						});
					}
					const result = {
						kind: "success",
						...text === "" ? {} : { text }
					};
					append(id, {
						type: "command/done",
						data: {
							commandId,
							...result
						}
					});
					return {
						ok: true,
						value: {
							commandId,
							result
						}
					};
				}
			};
			const goalView = (projection) => ({
				...projection.goal,
				roundsStarted: projection.roundsStarted,
				createdAt: projection.createdAt,
				updatedAt: projection.updatedAt,
				activation: projection.goal.phase === "active" ? "armed" : "disarmed"
			});
			/** Canonical fixture implementation of the generated Goal Remote contract. */
			const goalRemotes = {
				create(id, request) {
					const missing = requireGoalSession(id);
					if (missing !== void 0) return missing;
					const current = backscanGoal(logOf(id));
					if (current !== null && current.goal.phase !== "complete") return goalFailure(`goal "${current.goal.id}" already exists`);
					const now = Date.now();
					const projection = appendGoalChange(id, {
						kind: "goal/change",
						version: 1,
						operation: "create",
						goal: {
							id: `fx-goal-${logOf(id).length}`,
							revision: 1,
							objective: request.objective,
							phase: "active",
							maxGoalRounds: request.maxGoalRounds ?? 256
						},
						roundsStarted: 0,
						createdAt: now,
						updatedAt: now
					});
					return {
						ok: true,
						value: { ref: {
							id: projection.goal.id,
							revision: projection.goal.revision
						} }
					};
				},
				edit(id, ref, request) {
					return mutateGoal(id, ref, (current) => ({
						...current.goal,
						revision: current.goal.revision + 1,
						...request.objective === void 0 ? {} : { objective: request.objective },
						...request.maxGoalRounds === void 0 ? {} : { maxGoalRounds: request.maxGoalRounds }
					}));
				},
				pause(id, ref) {
					return mutateGoal(id, ref, (current) => current.goal.phase === "active" ? {
						...current.goal,
						revision: current.goal.revision + 1,
						phase: "paused"
					} : void 0);
				},
				resume(id, ref) {
					return mutateGoal(id, ref, (current) => current.goal.phase === "paused" || current.goal.phase === "blocked" || current.goal.phase === "active" ? {
						...current.goal,
						revision: current.goal.revision + 1,
						phase: "active"
					} : void 0);
				},
				complete(id, ref) {
					return mutateGoal(id, ref, (current) => current.goal.phase === "complete" ? void 0 : {
						...current.goal,
						revision: current.goal.revision + 1,
						phase: "complete"
					});
				},
				clear(id, ref) {
					const resolved = resolveGoal(id, ref);
					if (!resolved.ok) return resolved;
					const current = resolved.value;
					const tombstone = {
						id: current.goal.id,
						revision: current.goal.revision + 1
					};
					appendGoalChange(id, {
						kind: "goal/change",
						version: 1,
						operation: "clear",
						cleared: tombstone,
						clearedAt: Date.now()
					});
					return {
						ok: true,
						value: tombstone
					};
				}
			};
			/** Resolve one current goal revision for a canonical Remote mutation. */
			function resolveGoal(id, ref) {
				const missing = requireGoalSession(id);
				if (missing !== void 0) return missing;
				const current = backscanGoal(logOf(id));
				if (current === null || current.goal.id !== ref.id || current.goal.revision !== ref.revision) return goalFailure("stale or missing goal revision");
				return {
					ok: true,
					value: current
				};
			}
			/** Shared CAS mutation path behind the canonical Remote verbs. */
			function mutateGoal(id, ref, next) {
				const resolved = resolveGoal(id, ref);
				if (!resolved.ok) return resolved;
				const current = resolved.value;
				const goal = next(current);
				if (goal === void 0) return goalFailure(`invalid goal transition from "${current.goal.phase}"`);
				return {
					ok: true,
					value: goalView(appendGoalChange(id, {
						kind: "goal/change",
						version: 1,
						operation: goal.phase === current.goal.phase ? "edit" : goal.phase === "paused" ? "pause" : goal.phase === "active" ? "resume" : "complete",
						goal,
						roundsStarted: current.roundsStarted,
						createdAt: current.createdAt,
						updatedAt: Date.now()
					}))
				};
			}
			const mapGoalResult = (result, map) => result.ok ? {
				ok: true,
				value: map(result.value)
			} : result;
			const goalRefResult = (result) => mapGoalResult(result, (view) => ({ ref: {
				id: view.id,
				revision: view.revision
			} }));
			const legacyGoalResponse = (request, result) => Promise.resolve({
				rpcId: request.rpcId,
				result
			});
			/** At most one in-flight replay per session; cancel clears it. */
			const replays = /* @__PURE__ */ new Map();
			/** history transit delay (timing hooks below); the page snapshot is taken at request time, like a real host. */
			let historyDelayMs = 0;
			/** One-shot history failure (timing hook: a pre-disconnect history request already doomed when reconnect lands). */
			let failNextHistory = false;
			/** Force-enders for currently open stream generators (timing hook: simulated connection loss). */
			const streamBreakers = /* @__PURE__ */ new Set();
			/** Retry scenarios opened by timing hooks and completed in a later browser assertion phase. */
			const retryScenarios = /* @__PURE__ */ new Map();
			/** The single opt-in browser stress producer; normal fixture journeys never start it. */
			let activeReasoningChunkStorm = null;
			globalThis.__fxTiming = {
				setHistoryDelay(ms) {
					historyDelayMs = ms;
				},
				/** Fail the NEXT history call (after its transit delay) with a transport-level throw. */
				failNextHistory() {
					failNextHistory = true;
				},
				/** Log append + mux emit (the normal live path). */
				appendUser(id, msg) {
					append(sid(id), {
						type: "user/message",
						surfaceOp: "append",
						data: userMessage(text(msg))
					});
				},
				/** Append a later durable title revision through the normal raw-event + control-frame path. */
				appendTitle(id, title) {
					const messageSeqs = logOf(sid(id)).filter((event) => event.type === "user/message").map((event) => event.seq);
					append(sid(id), {
						type: "session/title",
						data: {
							title,
							messageSeqs,
							source: {
								kind: "provider",
								provider: "fixture"
							}
						}
					});
				},
				/** Start an externally paced reasoning stream for the opt-in browser stress lane. */
				startReasoningChunkStorm(id, chunkCount, chunksPerInterval, intervalMs) {
					if (!Number.isSafeInteger(chunkCount) || chunkCount < 1) throw new Error("fixture: reasoning chunk count must be a positive safe integer");
					if (!Number.isSafeInteger(chunksPerInterval) || chunksPerInterval < 1) throw new Error("fixture: reasoning chunks per interval must be a positive safe integer");
					if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) throw new Error("fixture: reasoning interval must be a positive safe integer");
					if (activeReasoningChunkStorm?.emitting === true) throw new Error("fixture: reasoning chunk storm already running");
					const sessionId = sid(id);
					const log = logOf(sessionId);
					let turn = nextTurn.get(sessionId) ?? 0;
					for (const event of log) {
						const candidate = event.data?.turn;
						if (typeof candidate === "number") turn = Math.max(turn, candidate + 1);
					}
					nextTurn.set(sessionId, turn + 1);
					const marker = `REASONING_STRESS_COMPLETE:${String(turn)}:${String(chunkCount)}`;
					const state = {
						sessionId: id,
						chunkCount,
						chunksPerInterval,
						intervalMs,
						emitted: 0,
						marker,
						emitting: true
					};
					activeReasoningChunkStorm = state;
					setRunning(sessionId, true);
					append(sessionId, {
						type: "turn/start",
						data: {
							turn,
							trigger: {
								kind: "message",
								source: { kind: "user" }
							}
						}
					});
					append(sessionId, {
						type: "user/message",
						surfaceOp: "append",
						data: userMessage(text(`Reasoning chunk stress: ${String(chunkCount)} chunks.`))
					});
					append(sessionId, {
						type: "step/start",
						data: {
							turn,
							step: 0
						}
					});
					append(sessionId, {
						type: "assistant/chunk",
						data: {
							turn,
							step: 0,
							chunk: {
								type: "block-start",
								index: 0,
								blockType: "reasoning"
							}
						}
					});
					const startedAt = Date.now();
					const pump = () => {
						const elapsedIntervals = Math.floor((Date.now() - startedAt) / intervalMs) + 1;
						const due = Math.max(state.emitted + chunksPerInterval, elapsedIntervals * chunksPerInterval);
						const end = Math.min(due, chunkCount);
						for (let index = state.emitted; index < end; index++) {
							const chunkText = index === chunkCount - 1 ? `\n${marker}` : index % 64 === 63 ? "推理\n" : "推理";
							append(sessionId, {
								type: "assistant/chunk",
								data: {
									turn,
									step: 0,
									chunk: {
										type: "reasoning-delta",
										index: 0,
										text: chunkText
									}
								}
							});
						}
						state.emitted = end;
						if (end < chunkCount) setTimeout(pump, intervalMs);
						else state.emitting = false;
					};
					setTimeout(pump, 0);
					return marker;
				},
				/** Return a copy so browser probes cannot mutate the active producer. */
				reasoningChunkStormState() {
					return activeReasoningChunkStorm === null ? null : { ...activeReasoningChunkStorm };
				},
				/** Open one failed model step whose partial remains visible until llm/retry arrives. */
				beginModelRetry(id) {
					const sessionId = sid(id);
					const turn = nextTurn.get(sessionId) ?? 0;
					nextTurn.set(sessionId, turn + 1);
					retryScenarios.set(sessionId, {
						turn,
						stepStarted: true
					});
					setRunning(sessionId, true);
					append(sessionId, {
						type: "turn/start",
						data: { turn }
					});
					append(sessionId, {
						type: "user/message",
						surfaceOp: "append",
						data: {
							content: text("请重试这个请求"),
							source: { kind: "user" }
						}
					});
					append(sessionId, {
						type: "step/start",
						data: {
							turn,
							step: 1
						}
					});
					append(sessionId, {
						type: "assistant/chunk",
						data: {
							turn,
							step: 1,
							chunk: {
								type: "block-start",
								index: 0,
								blockType: "text"
							}
						}
					});
					append(sessionId, {
						type: "assistant/chunk",
						data: {
							turn,
							step: 1,
							chunk: {
								type: "text-delta",
								index: 0,
								text: "应撤回的半截回复"
							}
						}
					});
				},
				/** Record one retry decision; the next attempt remains in the same step. */
				scheduleModelRetry(id, retry = 1, delayMs = 450) {
					const sessionId = sid(id);
					const scenario = retryScenarios.get(sessionId);
					if (scenario === void 0) throw new Error(`fixture: no model retry scenario for ${id}`);
					if (!scenario.stepStarted) {
						append(sessionId, {
							type: "assistant/chunk",
							data: {
								turn: scenario.turn,
								step: 1,
								chunk: {
									type: "block-start",
									index: 0,
									blockType: "text"
								}
							}
						});
						append(sessionId, {
							type: "assistant/chunk",
							data: {
								turn: scenario.turn,
								step: 1,
								chunk: {
									type: "text-delta",
									index: 0,
									text: `第 ${String(retry)} 次应撤回的回复`
								}
							}
						});
						scenario.stepStarted = true;
					}
					append(sessionId, {
						type: "llm/retry",
						data: {
							turn: scenario.turn,
							step: 1,
							provider: "fixture",
							mode: "normal",
							policyKey: "fixture-normal",
							retry,
							maxRetries: 2,
							delayMs,
							failure: {
								code: "TRANSPORT",
								message: "连接被重置"
							}
						}
					});
					scenario.stepStarted = false;
				},
				/** Record one retry decision, then cancel its source turn before the retry starts. */
				cancelModelRetryDuringBackoff(id, delayMs = 450) {
					const sessionId = sid(id);
					const scenario = retryScenarios.get(sessionId);
					if (scenario === void 0) throw new Error(`fixture: no model retry scenario for ${id}`);
					append(sessionId, {
						type: "llm/retry",
						data: {
							turn: scenario.turn,
							step: 1,
							provider: "fixture",
							mode: "normal",
							policyKey: "fixture-normal",
							retry: 1,
							maxRetries: 2,
							delayMs,
							failure: {
								code: "TRANSPORT",
								message: "连接被重置"
							}
						}
					});
					append(sessionId, {
						type: "step/end",
						data: {
							turn: scenario.turn,
							step: 1
						}
					});
					append(sessionId, {
						type: "turn/end",
						data: {
							turn: scenario.turn,
							reason: {
								kind: "aborted",
								reason: { kind: "user" }
							}
						}
					});
					retryScenarios.delete(sessionId);
					setRunning(sessionId, false);
				},
				/** Finish the timing-hook retry with a finalized response in the open step. */
				completeModelRetry(id) {
					const sessionId = sid(id);
					const scenario = retryScenarios.get(sessionId);
					if (scenario === void 0) throw new Error(`fixture: no model retry scenario for ${id}`);
					retryScenarios.delete(sessionId);
					append(sessionId, {
						type: "assistant/chunk",
						data: {
							turn: scenario.turn,
							step: 1,
							chunk: {
								type: "block-start",
								index: 0,
								blockType: "text"
							}
						}
					});
					append(sessionId, {
						type: "assistant/message",
						surfaceOp: "append",
						data: {
							turn: scenario.turn,
							step: 1,
							message: assistantMessage(text("重试后的完整回复"))
						}
					});
					append(sessionId, {
						type: "step/end",
						data: {
							turn: scenario.turn,
							step: 1
						}
					});
					append(sessionId, {
						type: "turn/end",
						data: {
							turn: scenario.turn,
							reason: { kind: "completed" }
						}
					});
					setRunning(sessionId, false);
				},
				/** Log append WITHOUT the mux emit: a frame lost in transit — history still serves it, the client must repull. */
				appendSilent(id, msg) {
					const log = logOf(sid(id));
					log.push({
						type: "user/message",
						surfaceOp: "append",
						seq: log.length,
						time: Date.now(),
						data: userMessage(text(msg))
					});
				},
				/** End every open stream generator (client sees both streams close -> reconnect + resync path). */
				breakStreams() {
					for (const breakNow of [...streamBreakers]) breakNow();
				}
			};
			/** Prompt replay: chunk typewriter (80ms/frame) -> assistant/message finalize -> turn/end + running flip. */
			const startReply = (id, turn, replyText) => {
				const step = 0;
				append(id, {
					type: "step/start",
					data: {
						turn,
						step
					}
				});
				append(id, {
					type: "assistant/chunk",
					data: {
						turn,
						step,
						chunk: {
							type: "block-start",
							index: 0,
							blockType: "text"
						}
					}
				});
				/* v8 ignore next -- the ?? arm needs a null match, but every fixture reply is non-empty. */
				const pieces = replyText.match(/[\s\S]{1,6}/gu) ?? [replyText];
				let i = 0;
				const finish = (aborted) => {
					replays.delete(id);
					const done = pieces.slice(0, i).join("");
					append(id, {
						type: "assistant/chunk",
						data: {
							turn,
							step,
							chunk: {
								type: "block-end",
								index: 0,
								block: {
									type: "text",
									text: done
								}
							}
						}
					});
					append(id, {
						type: "assistant/message",
						surfaceOp: "append",
						data: {
							turn,
							step,
							message: assistantMessage(text(aborted ? `${done}（已中断）` : done)),
							usage: fixtureUsage(turn, step)
						}
					});
					append(id, {
						type: "step/end",
						data: {
							turn,
							step
						}
					});
					append(id, {
						type: "turn/end",
						data: {
							turn,
							reason: { kind: aborted ? "cancelled" : "completed" }
						}
					});
					setRunning(id, false);
				};
				const tick = () => {
					const piece = pieces[i];
					if (piece === void 0) {
						finish(false);
						return;
					}
					i++;
					append(id, {
						type: "assistant/chunk",
						data: {
							turn,
							step,
							chunk: {
								type: "text-delta",
								index: 0,
								text: piece
							}
						}
					});
					replays.set(id, {
						timer: setTimeout(tick, 80),
						finish
					});
				};
				replays.set(id, {
					timer: setTimeout(tick, 80),
					finish
				});
			};
			return {
				api: {
					sessions: {
						list: (request) => ok(request, { items: [...sessions].sort((a, b) => b.updatedAt - a.updatedAt) }),
						search: (request, signal) => {
							if (signal.aborted) return err(request, {
								code: "cancelled",
								message: "fixture session search was aborted",
								details: {}
							});
							const query = searchTokenSpans(request.payload.query).tokens.map((token) => token.value);
							const matches = sessions.flatMap((summary) => {
								const log = logs.get(summary.sessionId) ?? [];
								const current = new Set(foldSurface(log).nodes);
								const best = log.flatMap((event) => {
									if (!current.has(event.seq)) return [];
									const eventText = searchEventText(event);
									const document = searchTokenSpans(eventText);
									const match = phraseMatch(document.tokens, query);
									if (match.count === 0) return [];
									return [{
										sessionId: summary.sessionId,
										seq: event.seq,
										time: event.time,
										text: document.text,
										matchCount: match.count,
										matchStart: match.start,
										matchEnd: match.end,
										documentLength: Array.from(eventText).length
									}];
								}).sort(compareSearchCandidates)[0];
								return best === void 0 ? [] : [best];
							}).sort(compareSearchCandidates);
							return ok(request, {
								items: matches.slice(0, 20).map((match) => ({
									sessionId: match.sessionId,
									snippet: searchSnippet(match.text, match.matchStart, match.matchEnd)
								})),
								hasMore: matches.length > 20
							});
						},
						create: async (request) => {
							const workspace = request.payload.workspaceId === void 0 ? void 0 : workspaces.find((w) => w.workspaceId === request.payload.workspaceId);
							if (request.payload.workspaceId !== void 0 && workspace === void 0) return err(request, {
								code: "workspace-not-found",
								message: `no workspace ${request.payload.workspaceId}`,
								details: { workspaceId: request.payload.workspaceId }
							});
							const cwd = workspace?.path ?? request.payload.cwd ?? "/tmp/fixture";
							const requestedId = request.payload.sessionId;
							const attachWorkspace = (sessionId) => {
								/* v8 ignore next -- callers enter only when a target Workspace exists. */
								if (workspace === void 0 || workspace.sessionIds.includes(sessionId)) return;
								workspace.sessionIds = [sessionId, ...workspace.sessionIds];
								workspace.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
								emitHost({
									type: "host/workspace-changed",
									workspace: { ...workspace }
								});
							};
							const attachFailure = (sessionId, workspaceId) => err(request, {
								code: "workspace-attach-failed",
								message: `fixture rejected Workspace attachment for ${sessionId}`,
								details: {
									sessionId,
									workspaceId
								}
							});
							if (requestedId !== void 0) {
								const existing = summaryOf(requestedId);
								if (existing !== void 0) {
									if (existing.cwd !== cwd) return err(request, {
										code: "session-conflict",
										message: `session ${requestedId} already uses ${existing.cwd ?? "no cwd"}`,
										details: {
											sessionId: requestedId,
											requestedCwd: cwd,
											...existing.cwd === void 0 ? {} : { existingCwd: existing.cwd }
										}
									});
									if (workspace !== void 0 && !workspace.sessionIds.includes(requestedId)) {
										if (options.failWorkspaceAttach) return attachFailure(requestedId, workspace.workspaceId);
										attachWorkspace(requestedId);
									}
									return ok(request, { sessionId: requestedId });
								}
							}
							const created = {
								sessionId: requestedId ?? sid(`fx-${nextSession++}`),
								updatedAt: Date.now(),
								running: false,
								blank: true,
								cwd
							};
							sessions.push(created);
							modelSelections.set(created.sessionId, {
								provider: "deepseek-official",
								model: "deepseek-v4-flash"
							});
							attachedSessions += 1;
							const emitSession = () => {
								emitHost({
									type: "host/session-added",
									sessionId: created.sessionId,
									blank: true,
									cwd
								});
							};
							if (workspace !== void 0 && options.failWorkspaceAttach) {
								emitSession();
								return attachFailure(created.sessionId, workspace.workspaceId);
							}
							if (workspace !== void 0 && options.createFrameOrder === "workspace-first") {
								attachWorkspace(created.sessionId);
								emitSession();
							} else {
								emitSession();
								if (workspace !== void 0) attachWorkspace(created.sessionId);
							}
							if (options.dropSessionCreateResponse) throw new Error("fixture: dropped session.create response after publication");
							return ok(request, { sessionId: created.sessionId });
						},
						rename: (request) => {
							const missing = requireSession(request);
							if (missing !== void 0) return missing;
							const { sessionId, title } = request.payload;
							const normalized = title.trim().replace(/\s+/g, " ");
							if (normalized.length === 0) return err(request, {
								code: "title-invalid",
								message: "session title must contain visible characters",
								details: { sessionId }
							});
							append(sessionId, {
								type: "session/title",
								data: {
									title: normalized,
									messageSeqs: [],
									source: { kind: "user" }
								}
							});
							return ok(request, {
								title: normalized,
								seq: logOf(sessionId).at(-1).seq
							});
						},
						fork: (request) => {
							const { sessionId, atSeq } = request.payload;
							const source = summaryOf(sessionId);
							if (source === void 0) return err(request, {
								code: "session-not-found",
								message: `no session ${sessionId}`,
								details: { sessionId }
							});
							const log = logs.get(sessionId) ?? [];
							const lastSeq = log.at(-1)?.seq ?? -1;
							const boundary = (atSeq === void 0 ? void 0 : log.find((e) => e.type === "turn/end" && e.seq >= atSeq)) ?? (atSeq === void 0 || atSeq > lastSeq ? log.findLast((e) => e.type === "turn/end") : void 0);
							if (boundary === void 0) return err(request, {
								code: "fork-unavailable",
								message: atSeq !== void 0 && atSeq <= lastSeq ? `session ${sessionId} has not completed the turn containing event ${String(atSeq)}` : `session ${sessionId} has no completed turn`,
								details: { sessionId }
							});
							let cut = boundary.seq + 1;
							while (cut < log.length && log[cut]?.type !== "turn/start") cut++;
							const child = {
								sessionId: sid(`fx-${nextSession++}`),
								updatedAt: Date.now(),
								running: false,
								blank: false,
								parentSessionId: sessionId,
								...source.cwd === void 0 ? {} : { cwd: source.cwd }
							};
							logs.set(child.sessionId, log.slice(0, cut));
							sessions.push(child);
							emitHost({
								type: "host/session-added",
								sessionId: child.sessionId,
								blank: false,
								parentSessionId: sessionId,
								...source.cwd === void 0 ? {} : { cwd: source.cwd }
							});
							const workspace = workspaces.find((w) => w.sessionIds.includes(sessionId));
							if (workspace !== void 0) {
								workspace.sessionIds = [child.sessionId, ...workspace.sessionIds];
								workspace.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
								emitHost({
									type: "host/workspace-changed",
									workspace: { ...workspace }
								});
							}
							return ok(request, { sessionId: child.sessionId });
						},
						history: async (request) => {
							const log = logs.get(request.payload.sessionId) ?? [];
							const page = pageOf(log, request.payload.beforeSeq, request.payload.maxMessages ?? 50);
							const projections = request.payload.beforeSeq === void 0 ? {
								asOfSeq: log.length - 1,
								values: projectionValuesOf(log)
							} : void 0;
							const doomed = failNextHistory;
							failNextHistory = false;
							const delay = historyDelayMs;
							if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
							if (doomed) throw new Error("fixture: simulated history transport failure");
							return ok(request, {
								...page,
								...projections === void 0 ? {} : { projections }
							});
						},
						models: (request) => ok(request, {
							current: modelSelections.get(request.payload.sessionId) ?? {
								provider: "deepseek-official",
								model: "deepseek-v4-flash"
							},
							routable: true,
							groups: fixtureModelGroups(),
							failures: []
						}),
						selectModel: (request) => {
							const selected = {
								provider: request.payload.provider,
								model: request.payload.model,
								...request.payload.reasoningEffort === void 0 ? {} : { reasoningEffort: request.payload.reasoningEffort }
							};
							modelSelections.set(request.payload.sessionId, selected);
							return ok(request, { selected });
						},
						prompt: (request) => {
							const { sessionId: id, mode, content } = request.payload;
							const summary = summaryOf(id);
							if (summary === void 0) return err(request, {
								code: "session-not-found",
								message: `no session ${id}`,
								details: { sessionId: id }
							});
							if (options.rejectPrompt) return err(request, {
								code: "agent-busy",
								message: "fixture: prompt rejected before acceptance",
								details: { reason: "fixture-prompt-rejection" }
							});
							summary.updatedAt = Date.now();
							summary.blank = false;
							const userText = content.map((b) => b.type === "text" ? b.text : "").join("");
							const durable = content.map((block) => {
								if (block.type === "text") return block;
								const attachment = {
									attachmentId: `fixture:${randomUuid()}`,
									mediaType: block.mediaType,
									bytes: Math.max(1, Math.floor(block.data.length * 3 / 4) - (block.data.endsWith("==") ? 2 : block.data.endsWith("=") ? 1 : 0)),
									width: 160,
									height: 90,
									...block.name === void 0 ? {} : { name: block.name }
								};
								attachments.set(String(attachment.attachmentId), {
									attachment,
									data: block.data
								});
								return {
									type: "image",
									attachment
								};
							});
							if (mode === "steer" && replays.has(id)) {
								append(id, {
									type: "user/message",
									surfaceOp: "append",
									data: userMessage(durable)
								});
								return ok(request, { accepted: true });
							}
							const turn = nextTurn.get(id) ?? 0;
							nextTurn.set(id, turn + 1);
							setRunning(id, true);
							append(id, {
								type: "turn/start",
								data: { turn }
							});
							const plan = foldPlan(logOf(id));
							if (plan.wanted !== null && plan.wanted !== plan.active) append(id, {
								type: "plan/mode",
								data: { active: plan.wanted }
							});
							append(id, {
								type: "user/message",
								surfaceOp: "append",
								data: userMessage(durable)
							});
							const selection = modelSelections.get(id) ?? {
								provider: "deepseek",
								model: "deepseek-v4-flash"
							};
							if (lastRequestContext(logOf(id))?.model !== selection.model) append(id, {
								type: "request/context",
								data: {
									provider: selection.provider,
									model: selection.model,
									contextWindow: 128e3
								}
							});
							startReply(id, turn, userText === "render markdown" ? MARKDOWN_FIXTURE : userText === "report model" ? (() => {
								const selection = modelSelections.get(id);
								return `当前模型：${selection?.provider ?? "unknown"}/${selection?.model ?? "unknown"}` + (selection?.reasoningEffort === void 0 ? "" : ` · 推理等级：${selection.reasoningEffort}`);
							})() : `回声：${userText}。这是 fixture 的流式回复，用于验证打字机增长与定稿切换。`);
							return ok(request, { accepted: true });
						},
						attachment: (request) => {
							const stored = attachments.get(String(request.payload.attachmentId));
							if (stored === void 0) return err(request, {
								code: "attachment-error",
								message: "fixture attachment missing",
								details: { reason: "ATTACHMENT_NOT_FOUND" }
							});
							if (!logReferencesAttachment(logs.get(request.payload.sessionId) ?? [], String(request.payload.attachmentId))) return err(request, {
								code: "attachment-error",
								message: "fixture attachment is not referenced by this session",
								details: { reason: "ATTACHMENT_NOT_REFERENCED" }
							});
							return ok(request, stored);
						},
						updateQueue: (request) => err(request, {
							code: "queue-item-not-found",
							message: "fixture has no pending queue item",
							details: { itemId: request.payload.itemId }
						}),
						cancel: (request) => {
							const replay = replays.get(request.payload.sessionId);
							if (replay !== void 0) {
								clearTimeout(replay.timer);
								replay.finish(true);
							} else setRunning(request.payload.sessionId, false);
							return ok(request, { accepted: true });
						}
					},
					subagents: {
						list: (request) => ok(request, {
							entries: [],
							parentAvailable: true
						}),
						history: (request) => {
							const log = logs.get(request.payload.childSessionId) ?? [];
							return Promise.resolve(ok(request, pageOf(log, request.payload.beforeSeq, request.payload.maxMessages ?? 50)));
						},
						prompt: (request) => Promise.resolve(ok(request, { messageId: `fixture-message-${request.payload.childSessionId}` })),
						interrupt: (request) => Promise.resolve(ok(request, { accepted: true }))
					},
					host: {
						describe: (request) => ok(request, {
							version: "0.0.0-fixture",
							cwd: "/tmp/fixture",
							attachedSessions,
							canOpenPath: true
						}),
						pickDirectory: (request) => ok(request, { path: `${FIXTURE_HOME}/Documents/project` }),
						listDirectory: (request) => {
							const target = request.payload.path ?? FIXTURE_HOME;
							const children = childrenOf(target);
							if (children === void 0) return err(request, {
								code: "directory-unreadable",
								message: `cannot list ${target}: not in the fixture tree`,
								details: { path: target }
							});
							return ok(request, {
								path: target,
								home: FIXTURE_HOME,
								crumbs: crumbsOf(target),
								entries: [...children].sort((a, b) => a.localeCompare(b)).map((name) => ({
									name,
									path: target === "/" ? `/${name}` : `${target}/${name}`,
									hidden: name.startsWith(".")
								})),
								truncated: false
							});
						},
						createDirectory: (request) => {
							const parent = request.payload.path;
							const children = childrenOf(parent);
							if (children === void 0) return err(request, {
								code: "directory-create-failed",
								message: `missing parent ${parent}`,
								details: { path: parent }
							});
							const target = parent === "/" ? `/${request.payload.name}` : `${parent}/${request.payload.name}`;
							if (children.includes(request.payload.name)) return err(request, {
								code: "directory-exists",
								message: `${target} already exists`,
								details: { path: target }
							});
							directoryTree.set(parent, [...children, request.payload.name]);
							directoryTree.set(target, []);
							return ok(request, { path: target });
						},
						openPath: (request) => ok(request, { opened: true })
					},
					workspace: {
						list: (request) => ok(request, {
							items: workspaces.map((w) => ({ ...w })),
							archivedSessionIds: [...archivedSessionIds]
						}),
						create: (request) => {
							const { path } = request.payload;
							const existing = workspaces.find((w) => w.path === path);
							if (existing !== void 0) return ok(request, {
								workspace: { ...existing },
								created: false
							});
							const now = (/* @__PURE__ */ new Date()).toISOString();
							const created = {
								workspaceId: wid(`fx-ws-${nextWorkspace++}`),
								path,
								title: path.split("/").filter(Boolean).at(-1) ?? path,
								sessionIds: [],
								createdAt: now,
								updatedAt: now
							};
							workspaces.unshift(created);
							emitHost({
								type: "host/workspace-changed",
								workspace: { ...created }
							});
							return ok(request, {
								workspace: { ...created },
								created: true
							});
						},
						rename: (request) => {
							const { workspaceId, title } = request.payload;
							const workspace = workspaces.find((w) => w.workspaceId === workspaceId);
							if (workspace === void 0) return err(request, {
								code: "workspace-not-found",
								message: `no workspace ${workspaceId}`,
								details: { workspaceId }
							});
							const trimmed = title.trim();
							if (trimmed !== workspace.title) {
								if (workspaces.some((w) => w.workspaceId !== workspaceId && w.title === trimmed)) return err(request, {
									code: "workspace-name-conflict",
									message: `workspace name '${trimmed}' is already in use`,
									details: { name: trimmed }
								});
								workspace.title = trimmed;
								workspace.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
								emitHost({
									type: "host/workspace-changed",
									workspace: { ...workspace }
								});
							}
							return ok(request, { workspace: { ...workspace } });
						},
						delete: (request) => {
							const { workspaceId } = request.payload;
							const index = workspaces.findIndex((workspace) => workspace.workspaceId === workspaceId);
							if (index === -1) return err(request, {
								code: "workspace-not-found",
								message: `no workspace ${workspaceId}`,
								details: { workspaceId }
							});
							workspaces.splice(index, 1);
							emitHost({
								type: "host/workspace-removed",
								workspaceId
							});
							return ok(request, { deleted: true });
						},
						insertBefore: (request) => {
							const { workspaceId, beforeWorkspaceId } = request.payload;
							const source = workspaces.findIndex((workspace) => workspace.workspaceId === workspaceId);
							const anchor = beforeWorkspaceId === void 0 ? workspaces.length : workspaces.findIndex((workspace) => workspace.workspaceId === beforeWorkspaceId);
							const missing = source === -1 ? workspaceId : anchor === -1 ? beforeWorkspaceId : void 0;
							if (missing !== void 0) return err(request, {
								code: "workspace-not-found",
								message: `no workspace ${missing}`,
								details: { workspaceId: missing }
							});
							if (beforeWorkspaceId !== workspaceId) {
								const previousOrder = workspaces.map((candidate) => candidate.workspaceId);
								const [workspace] = workspaces.splice(source, 1);
								/* v8 ignore next -- source was resolved from the same array immediately above. */
								if (workspace === void 0) throw new Error(`fixture lost workspace ${workspaceId}`);
								const at = beforeWorkspaceId === void 0 ? workspaces.length : workspaces.findIndex((candidate) => candidate.workspaceId === beforeWorkspaceId);
								workspaces.splice(at, 0, workspace);
								if (workspaces.some((candidate, index) => candidate.workspaceId !== previousOrder[index])) emitHost({
									type: "host/workspace-order-changed",
									workspaceIds: workspaces.map((candidate) => candidate.workspaceId)
								});
							}
							return ok(request, { workspaceIds: workspaces.map((candidate) => candidate.workspaceId) });
						},
						insertSessionBefore: (request) => {
							const { workspaceId, sessionId, beforeSessionId } = request.payload;
							const workspace = workspaces.find((w) => w.workspaceId === workspaceId);
							if (workspace === void 0) return err(request, {
								code: "workspace-not-found",
								message: `no workspace ${workspaceId}`,
								details: { workspaceId }
							});
							if (!workspace.sessionIds.includes(sessionId) || beforeSessionId !== void 0 && !workspace.sessionIds.includes(beforeSessionId)) return err(request, {
								code: "workspace-move-invalid",
								message: `session or anchor is not accounted by workspace ${workspaceId}`,
								details: {
									workspaceId,
									sessionId,
									...beforeSessionId === void 0 ? {} : { beforeSessionId }
								}
							});
							const without = workspace.sessionIds.filter((id) => id !== sessionId);
							const at = beforeSessionId === void 0 ? without.length : without.indexOf(beforeSessionId);
							const sessionIds = [
								...without.slice(0, at),
								sessionId,
								...without.slice(at)
							];
							if (!sessionIds.every((id, index) => id === workspace.sessionIds[index])) {
								workspace.sessionIds = sessionIds;
								workspace.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
								emitHost({
									type: "host/workspace-changed",
									workspace: { ...workspace }
								});
							}
							return ok(request, { workspace: { ...workspace } });
						},
						archiveSession: (request) => {
							const missing = requireSession(request);
							if (missing !== void 0) return missing;
							const { sessionId } = request.payload;
							if (!archivedSessionIds.includes(sessionId)) {
								archivedSessionIds.push(sessionId);
								emitHost({
									type: "host/archived-sessions-changed",
									archivedSessionIds: [...archivedSessionIds]
								});
							}
							return ok(request, { archivedSessionIds: [...archivedSessionIds] });
						}
					},
					agentPresets: {
						list: (request) => ok(request, {
							presets: [...fixturePresets].map(([id, preset]) => ({
								id,
								trust: preset.trust,
								isDefault: id === fixtureDefaultPreset
							})),
							authorable: true,
							hasDocument: true
						}),
						select: (request) => {
							fixtureDefaultPreset = request.payload.agentPreset;
							return ok(request, { agentPreset: request.payload.agentPreset });
						},
						read: (request) => {
							const { agentPreset } = request.payload;
							const preset = fixturePresets.get(agentPreset);
							if (preset === void 0) return err(request, {
								code: "agent-preset-not-found",
								message: `unknown agent preset "${agentPreset}"`,
								details: {
									agentPreset,
									available: [...fixturePresets.keys()]
								}
							});
							return ok(request, {
								agentPreset,
								trust: preset.trust,
								content: preset.content
							});
						},
						copy: (request) => {
							const { from, agentPreset } = request.payload;
							const source = fixturePresets.get(from);
							if (source === void 0) return err(request, {
								code: "agent-preset-not-found",
								message: `unknown agent preset "${from}"`,
								details: {
									agentPreset: from,
									available: [...fixturePresets.keys()]
								}
							});
							if (fixturePresets.has(agentPreset)) return err(request, {
								code: "agent-preset-invalid",
								message: `agent preset "${agentPreset}" already exists`,
								details: {
									agentPreset,
									reason: "already exists"
								}
							});
							fixturePresets.set(agentPreset, {
								trust: "user",
								content: source.content
							});
							return ok(request, { agentPreset });
						},
						openDocument: (request) => {
							const { agentPreset } = request.payload;
							const existing = fixturePresets.get(agentPreset);
							if (existing === void 0 || existing.trust === "system") return err(request, {
								code: "agent-preset-read-only",
								message: `agent preset "${agentPreset}" ships with the deployment`,
								details: {
									agentPreset,
									reason: "it ships with the deployment"
								}
							});
							return ok(request, { opened: true });
						},
						remove: (request) => {
							const { agentPreset } = request.payload;
							if (fixturePresets.get(agentPreset)?.trust === "system") return err(request, {
								code: "agent-preset-read-only",
								message: `agent preset "${agentPreset}" ships with the deployment`,
								details: {
									agentPreset,
									reason: "it ships with the deployment"
								}
							});
							fixturePresets.delete(agentPreset);
							return ok(request, {});
						}
					},
					skills: { list: (request) => {
						const missing = requireSession(request);
						if (missing !== void 0) return missing;
						return ok(request, { skills: [{
							name: "fixture-demo",
							description: "fixture 技能样本",
							whenToUse: "仅供 UI 目录渲染验收",
							modelInvocable: true
						}, {
							name: "fixture-user-only",
							description: "fixture 仅用户技能样本",
							modelInvocable: false
						}] });
					} },
					goals: {
						create: (request) => legacyGoalResponse(request, mapGoalResult(goalRemotes.create(request.payload.sessionId, {
							objective: request.payload.objective,
							...request.payload.maxGoalRounds === void 0 ? {} : { maxGoalRounds: request.payload.maxGoalRounds }
						}), (value) => ({ ref: {
							id: value.ref.id,
							revision: value.ref.revision
						} }))),
						edit: (request) => legacyGoalResponse(request, goalRefResult(goalRemotes.edit(request.payload.sessionId, request.payload.ref, {
							...request.payload.objective === void 0 ? {} : { objective: request.payload.objective },
							...request.payload.maxGoalRounds === void 0 ? {} : { maxGoalRounds: request.payload.maxGoalRounds }
						}))),
						pause: (request) => legacyGoalResponse(request, goalRefResult(goalRemotes.pause(request.payload.sessionId, request.payload.ref))),
						resume: (request) => legacyGoalResponse(request, goalRefResult(goalRemotes.resume(request.payload.sessionId, request.payload.ref))),
						complete: (request) => legacyGoalResponse(request, goalRefResult(goalRemotes.complete(request.payload.sessionId, request.payload.ref))),
						clear: (request) => legacyGoalResponse(request, mapGoalResult(goalRemotes.clear(request.payload.sessionId, request.payload.ref), () => ({ cleared: true })))
					},
					events: {
						async *mux(_request, signal) {
							const conn = new FxInbox();
							muxConns.add(conn);
							const breakNow = () => {
								conn.breakNow();
							};
							streamBreakers.add(breakNow);
							for (const s of sessions) {
								if (!s.running) continue;
								const log = logs.get(s.sessionId) ?? [];
								conn.push({
									rpcId: mint(),
									payload: {
										type: "session/subscribed",
										sessionId: s.sessionId,
										lastSeq: log.length - 1
									}
								});
								const values = projectionValuesOf(log);
								for (const key of Object.keys(values)) conn.push({
									rpcId: mint(),
									payload: {
										type: "session/projection",
										sessionId: s.sessionId,
										key,
										value: values[key],
										seq: log.length - 1
									}
								});
							}
							if (approvalPending) conn.push({
								rpcId: pendingApprovalRpcId,
								payload: {
									type: "approval/requested",
									sessionId: sid("fx-alpha"),
									approvalId: pendingApprovalId,
									toolName: "dangerous_tool",
									reason: "fixture 常驻审批（可答：批准/拒绝后消失）"
								}
							});
							if (questionPending) conn.push({
								rpcId: pendingQuestionRpcId,
								payload: {
									type: "question/requested",
									sessionId: sid("fx-alpha"),
									questions: fixtureQuestions
								}
							});
							try {
								yield* conn.drain(signal);
							} finally {
								streamBreakers.delete(breakNow);
								muxConns.delete(conn);
							}
						},
						async *host(_request, signal) {
							const conn = new FxInbox();
							hostConns.add(conn);
							const breakNow = () => {
								conn.breakNow();
							};
							streamBreakers.add(breakNow);
							const timer = setInterval(() => {
								const gamma = summaryOf(sid("fx-gamma"));
								/* v8 ignore next -- the undefined arm needs fx-gamma deleted, but the fixture never removes sessions. */
								if (gamma !== void 0) setRunning(gamma.sessionId, !gamma.running);
							}, 5e3);
							try {
								yield* conn.drain(signal);
							} finally {
								clearInterval(timer);
								streamBreakers.delete(breakNow);
								hostConns.delete(conn);
							}
						}
					},
					settings: {
						describe: (request) => ok(request, {
							writable: true,
							hasDocument: true,
							namespaces: [{
								ns: "llm-deepseek",
								schema: {},
								value: { apiKeyEnv: "DEEPSEEK_API_KEY" },
								applies: "live",
								secrets: [{
									path: ["apiKey"],
									set: false
								}],
								revision: 0
							}]
						}),
						openDocument: (request) => ok(request, { opened: true }),
						update: (request) => err(request, {
							code: "settings-rejected",
							message: "fixture: the minimal readiness settings descriptor is read-only",
							details: { ns: request.payload.ns }
						}),
						replace: (request) => err(request, {
							code: "settings-rejected",
							message: "fixture: the minimal readiness settings descriptor is read-only",
							details: { ns: request.payload.ns }
						}),
						mutate: (request) => err(request, {
							code: "settings-rejected",
							message: "fixture: no settings namespaces are registered",
							details: { ns: request.payload.ns }
						})
					},
					credentials: {
						describe: (request) => ok(request, { credentials: Object.fromEntries(request.payload.refs.map((ref) => [ref, {
							configured: fixtureCredentials.has(ref),
							...fixtureCredentials.has(ref) ? { source: "file" } : {},
							writable: true
						}])) }),
						set: (request) => {
							fixtureCredentials.set(request.payload.ref, true);
							return ok(request, {});
						},
						unset: (request) => {
							fixtureCredentials.delete(request.payload.ref);
							return ok(request, {});
						}
					},
					llm: {
						providers: (request) => ok(request, { providers: [
							{
								provider: "deepseek-official",
								displayName: "DeepSeek",
								settingsNs: "llm-deepseek",
								settingsPath: [],
								active: true
							},
							{
								provider: "openai",
								displayName: "openai",
								settingsNs: "llm-pi-ai",
								settingsPath: ["providers", "openai"],
								active: true,
								declared: false
							},
							{
								provider: "anthropic",
								displayName: "anthropic",
								settingsNs: "llm-pi-ai",
								settingsPath: ["providers", "anthropic"],
								active: false,
								declared: false
							},
							{
								provider: "acme-gateway",
								displayName: "Acme Gateway",
								settingsNs: "llm-pi-ai",
								settingsPath: ["providers", "acme-gateway"],
								active: true,
								declared: true
							}
						] }),
						models: (request) => ok(request, {
							groups: fixtureModelGroups(),
							failures: []
						}),
						discoverModels: (request) => ok(request, { models: fixtureModelGroups().flatMap((group) => group.models.map((model) => ({
							id: model.id,
							name: model.name
						}))) })
					},
					respond(message) {
						if (message.rpcId === pendingApprovalRpcId) {
							if (!approvalPending) return Promise.resolve({
								accepted: false,
								reason: "not-pending"
							});
							if (!message.result.ok) return Promise.resolve({
								accepted: false,
								reason: "bad-response"
							});
							const value = message.result.value;
							if (value.approvalId !== pendingApprovalId || value.outcome !== "allowed-once" && value.outcome !== "rejected") return Promise.resolve({
								accepted: false,
								reason: "bad-response"
							});
							approvalPending = false;
							emitMux({
								type: "approval/resolved",
								sessionId: sid("fx-alpha"),
								approvalId: pendingApprovalId,
								outcome: value.outcome
							});
							return Promise.resolve({ accepted: true });
						}
						if (!questionPending || message.rpcId !== pendingQuestionRpcId) return Promise.resolve({
							accepted: false,
							reason: "not-pending"
						});
						questionPending = false;
						emitMux({
							type: "question/resolved",
							sessionId: sid("fx-alpha"),
							questionRpcId: pendingQuestionRpcId,
							outcome: message.result.ok ? "answered" : "cancelled"
						});
						return Promise.resolve({ accepted: true });
					},
					downloads: { sessionLog: () => Promise.resolve(new Response("fixture mode does not serve session export", { status: 404 })) }
				},
				rpc: { call(channel, endpoint, payload) {
					if (channel !== "/api") return Promise.reject(/* @__PURE__ */ new Error(`fixture connection RPC channel ${JSON.stringify(channel)} is unavailable`));
					const args = payload.args;
					const sessionId = args.agentId;
					switch (endpoint) {
						case "commands/list": return Promise.resolve(commandRemotes.list(sessionId));
						case "commands/execute": return Promise.resolve(commandRemotes.execute(sessionId, args.line));
						case "goals/create": return Promise.resolve(goalRemotes.create(sessionId, {
							objective: args.request?.objective,
							...args.request?.maxGoalRounds === void 0 ? {} : { maxGoalRounds: args.request.maxGoalRounds }
						}));
						case "goals/edit": return Promise.resolve(goalRemotes.edit(sessionId, args.ref, args.request ?? {}));
						case "goals/pause": return Promise.resolve(goalRemotes.pause(sessionId, args.ref));
						case "goals/resume": return Promise.resolve(goalRemotes.resume(sessionId, args.ref));
						case "goals/complete": return Promise.resolve(goalRemotes.complete(sessionId, args.ref));
						case "goals/clear": return Promise.resolve(goalRemotes.clear(sessionId, args.ref));
						default: return Promise.reject(/* @__PURE__ */ new Error(`fixture connection RPC endpoint ${JSON.stringify(endpoint)} is unavailable`));
					}
				} }
			};
		}
		/**
		* Fixture platform subclass: there is no HTTP at all, so instead of a doFetch transport it
		* overrides the protocol-level virtuals (callUnary/openMux/openHost/respond) to dispatch
		* straight into the in-memory ApiProxy — while still minting rpcIds, fabricating the four
		* named full forms, and feeding the same tap as a real carrier. TODO: delete when the fixture
		* moves to the isomorphic pipeline (InProcessApiClient over toFetchHandler(fixtureImpl)).
		*/
		var FixtureApiClient = class extends AbstractApiClient {
			api;
			/** Generic Remote caller backed by the same in-memory state as the legacy fixture API. */
			rpc;
			constructor() {
				super();
				const world = createFixtureWorld(fixtureOptionsFromLocation());
				this.api = world.api;
				this.rpc = world.rpc;
			}
			doFetch() {
				throw new Error("FixtureApiClient overrides all protocol paths; doFetch must be unreachable");
			}
			async callUnary(method, payload, signal) {
				const request = rpcRequest(payload);
				const full = {
					type: "client-request",
					rpcId: request.rpcId,
					method,
					payload
				};
				this.onEnvelope(full);
				const response = await this.dispatch(method, request, signal ?? new AbortController().signal);
				const fullResponse = {
					type: "server-response",
					rpcId: response.rpcId,
					result: response.result
				};
				this.onEnvelope(fullResponse);
				return response;
			}
			/** Method-key dispatch into the in-memory contract impl (a real carrier routes by URL path instead). */
			dispatch(method, request, signal) {
				switch (method) {
					case "session.list": return this.api.sessions.list(request);
					case "session.search": return this.api.sessions.search(request, signal);
					case "session.create": return this.api.sessions.create(request);
					case "session.history": return this.api.sessions.history(request);
					case "session.models": return this.api.sessions.models(request);
					case "session.selectModel": return this.api.sessions.selectModel(request);
					case "session.rename": return this.api.sessions.rename(request);
					case "session.fork": return this.api.sessions.fork(request);
					case "session.prompt": return this.api.sessions.prompt(request);
					case "session.attachment": return this.api.sessions.attachment(request);
					case "session.updateQueue": return this.api.sessions.updateQueue(request);
					case "session.cancel": return this.api.sessions.cancel(request);
					case "subagent.list": return this.api.subagents.list(request);
					case "subagent.history": return this.api.subagents.history(request);
					case "subagent.prompt": return this.api.subagents.prompt(request, signal);
					case "subagent.interrupt": return this.api.subagents.interrupt(request);
					case "host.describe": return this.api.host.describe(request);
					case "host.pickDirectory": return this.api.host.pickDirectory(request, new AbortController().signal);
					case "host.listDirectory": return this.api.host.listDirectory(request, new AbortController().signal);
					case "host.createDirectory": return this.api.host.createDirectory(request);
					case "host.openPath": return this.api.host.openPath(request, new AbortController().signal);
					case "workspace.list": return this.api.workspace.list(request);
					case "workspace.create": return this.api.workspace.create(request);
					case "workspace.rename": return this.api.workspace.rename(request);
					case "workspace.delete": return this.api.workspace.delete(request);
					case "workspace.insertBefore": return this.api.workspace.insertBefore(request);
					case "workspace.insertSessionBefore": return this.api.workspace.insertSessionBefore(request);
					case "workspace.archiveSession": return this.api.workspace.archiveSession(request);
					case "skill.list": return this.api.skills.list(request);
					case "agentPreset.list": return this.api.agentPresets.list(request);
					case "agentPreset.select": return this.api.agentPresets.select(request);
					case "agentPreset.read": return this.api.agentPresets.read(request);
					case "agentPreset.copy": return this.api.agentPresets.copy(request);
					case "agentPreset.openDocument": return this.api.agentPresets.openDocument(request, new AbortController().signal);
					case "agentPreset.remove": return this.api.agentPresets.remove(request);
					case "goal.create": return this.api.goals.create(request);
					case "goal.edit": return this.api.goals.edit(request);
					case "goal.pause": return this.api.goals.pause(request);
					case "goal.resume": return this.api.goals.resume(request);
					case "goal.complete": return this.api.goals.complete(request);
					case "goal.clear": return this.api.goals.clear(request);
					case "settings.describe": return this.api.settings.describe(request);
					case "settings.openDocument": return this.api.settings.openDocument(request, signal);
					case "settings.update": return this.api.settings.update(request);
					case "settings.replace": return this.api.settings.replace(request);
					case "settings.mutate": return this.api.settings.mutate(request);
					case "credentials.describe": return this.api.credentials.describe(request);
					case "credentials.set": return this.api.credentials.set(request);
					case "credentials.unset": return this.api.credentials.unset(request);
					case "llm.providers": return this.api.llm.providers(request);
					case "llm.models": return this.api.llm.models(request);
					case "llm.discoverModels": return this.api.llm.discoverModels(request, signal);
				}
			}
			openMux(payload, signal, onOpen) {
				return this.tapStream(this.api.events.mux(rpcRequest(payload), signal), onOpen);
			}
			openHost(payload, signal, onOpen) {
				return this.tapStream(this.api.events.host(rpcRequest(payload), signal), onOpen);
			}
			async *tapStream(stream, onOpen) {
				onOpen?.();
				for await (const envelope of stream) {
					const full = {
						type: "server-request",
						rpcId: envelope.rpcId,
						method: envelope.payload.type,
						payload: envelope.payload
					};
					this.onEnvelope(full);
					yield envelope;
				}
			}
			/**
			* Deliver a client response to the in-memory contract impl (no HTTP POST),
			* echoing the envelope to the observation tap like every other path.
			* @param message - the client-response envelope answering a server request.
			* @returns the carrier receipt from the fixture impl.
			*/
			async respond(message) {
				this.onEnvelope(message);
				return this.api.respond(message);
			}
		};
		/** Browser query mapping; direct unit callers pass FixtureOptions explicitly. */
		function fixtureOptionsFromLocation() {
			if (typeof location === "undefined") return {};
			const query = new URLSearchParams(location.search);
			return {
				empty: query.get("fixture") === "empty",
				rejectPrompt: query.get("fixturePrompt") === "reject",
				failWorkspaceAttach: query.get("fixtureAttach") === "fail",
				dropSessionCreateResponse: query.get("fixtureSessionCreate") === "drop-response",
				createFrameOrder: query.get("fixtureFrames") === "workspace-first" ? "workspace-first" : "session-first"
			};
		}
		//#endregion
		//#region lib/types/api-path.js
		/**
		* The /api URL prefix — single source for both halves of the web transport.
		* The node half registers this prefix on the web server; both halves share the
		* event paths below for the browser WebSocket downlinks.
		*/
		/** Route prefix owning every api request (`/api` and `/api/<anything>`). */
		const API_PATH = "/api";
		/** Browser mux-frame WebSocket pathname. */
		const MUX_EVENTS_PATH = `${API_PATH}/events.mux`;
		/** Browser host-frame WebSocket pathname. */
		const HOST_EVENTS_PATH = `${API_PATH}/events.host`;
		//#endregion
		//#region lib/types/client/web-api-client.js
		/** Browser API carrier: HTTP upstream plus one WebSocket per downstream event stream. */
		/** Browser platform subclass: unary/respond use fetch; mux/host use downlink-only WebSockets. */
		var WebApiClient = class extends AbstractApiClient {
			doFetch(input, init) {
				return globalThis.fetch(input, init);
			}
			openMux(_payload, signal, onOpen) {
				return this.readWebSocket(MUX_EVENTS_PATH, signal, muxFrameSchema, onOpen);
			}
			openHost(_payload, signal, onOpen) {
				return this.readWebSocket(HOST_EVENTS_PATH, signal, hostFrameSchema, onOpen);
			}
			async *readWebSocket(path, signal, frameSchema, onOpen) {
				const url = new URL(path, this.resolveBase());
				url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
				const socket = new WebSocket(url);
				const inbox = [];
				let wake;
				const enqueue = (item) => {
					inbox.push(item);
					wake?.();
					wake = void 0;
				};
				const handleOpen = () => {
					onOpen?.();
				};
				const handleMessage = (event) => {
					let full;
					let frame;
					try {
						if (typeof event.data !== "string") throw new Error("binary WebSocket frame");
						full = serverRequestSchema.parse(JSON.parse(event.data));
						frame = frameSchema.parse(full.payload);
					} catch (error) {
						console.error(`[client-connection] dropping malformed WebSocket frame on ${path}:`, error);
						return;
					}
					this.onEnvelope(full);
					enqueue({
						kind: "frame",
						envelope: {
							rpcId: full.rpcId,
							payload: frame
						}
					});
				};
				const handleClose = () => {
					enqueue({ kind: "end" });
				};
				const handleAbort = () => {
					if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close();
				};
				socket.addEventListener("open", handleOpen);
				socket.addEventListener("message", handleMessage);
				socket.addEventListener("close", handleClose, { once: true });
				signal.addEventListener("abort", handleAbort, { once: true });
				if (signal.aborted) handleAbort();
				try {
					while (true) {
						while (inbox.length > 0) {
							const item = inbox.shift();
							if (item.kind === "end") return;
							yield item.envelope;
						}
						await new Promise((resolve) => {
							wake = resolve;
						});
					}
				} finally {
					signal.removeEventListener("abort", handleAbort);
					socket.removeEventListener("open", handleOpen);
					socket.removeEventListener("message", handleMessage);
					socket.removeEventListener("close", handleClose);
					handleAbort();
				}
			}
		};
		//#endregion
		//#region lib/types/client/rpc.js
		/** Browser caller for generic Connection unary RPC channels. */
		const INTERNAL_BASE = "http://dsh.internal";
		const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/;
		const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
		/**
		* Create the browser-backed generic RPC caller.
		* @returns caller that owns request correlation and response-envelope validation.
		*/
		function createWebConnectionRpc() {
			return { async call(channel, endpoint, payload, signal) {
				assertTarget(channel, endpoint);
				const rpcId = RpcId(randomUuid());
				const message = {
					type: "client-request",
					rpcId,
					method: endpoint,
					payload
				};
				const response = await globalThis.fetch(new URL(`${channel}/${endpoint}`, resolveBase()), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(message),
					...signal === void 0 ? {} : { signal }
				});
				if (!response.ok) throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`);
				const full = serverResponseSchema.parse(await response.json());
				if (full.rpcId !== rpcId) throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`);
				return full.result;
			} };
		}
		function resolveBase() {
			const location = globalThis.location;
			return location?.origin !== void 0 && location.origin !== "null" ? location.origin : INTERNAL_BASE;
		}
		function assertTarget(channel, endpoint) {
			const segments = endpoint.split("/");
			if (!CHANNEL_PATTERN.test(channel) || segments.some((segment) => segment === "" || segment === "." || segment === ".." || !ENDPOINT_SEGMENT_PATTERN.test(segment))) throw new Error(`connection: invalid RPC target ${JSON.stringify(`${channel}/${endpoint}`)}`);
		}
		//#endregion
		//#region lib/types/loopback-hostname.js
		/**
		* Browser-safe, zero-dependency loopback classification shared by the `/api`
		* Host fence and the package's `ctx.connection` state. The predicate stays
		* package-internal; client plugins consume the derived state through Cordis.
		*/
		/**
		* Whether a normalized URL hostname names the local loopback authority.
		* @param hostname - WHATWG URL hostname (IPv6 literals retain brackets).
		* @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
		*/
		function isLoopbackHostname(hostname) {
			if (hostname === "localhost" || hostname === "[::1]") return true;
			const parts = hostname.split(".");
			return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Required services (none — this is the wire root). */
		const inject = [];
		/**
		* Client plugin body: pick the api by page mode and provide ctx.connection.
		* @param ctx - client cordis context.
		*/
		function apply(ctx) {
			const pageLocation = typeof location === "undefined" ? void 0 : location;
			const fixtureClient = pageLocation !== void 0 && new URLSearchParams(pageLocation.search).has("fixture") ? new FixtureApiClient() : void 0;
			const api = fixtureClient ?? new WebApiClient();
			const rpc = fixtureClient?.rpc ?? createWebConnectionRpc();
			let started = false;
			let description;
			const descriptionListeners = /* @__PURE__ */ new Set();
			const publishDescription = (next) => {
				if (Object.is(description, next)) return;
				description = next;
				for (const listener of [...descriptionListeners]) try {
					listener();
				} catch (error) {
					console.error("[web-runtime] host-description listener threw:", error);
				}
			};
			const handle = {
				api,
				isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),
				hostDescription: {
					getSnapshot: () => description,
					subscribe: (listener) => {
						descriptionListeners.add(listener);
						return () => {
							descriptionListeners.delete(listener);
						};
					}
				},
				rpc,
				start(sinks, config) {
					if (started) throw new Error("connection: the stream loop is already owned by another consumer");
					started = true;
					const controller = new ConnectionController(api, {
						...sinks,
						onConnected: (next) => {
							publishDescription(next);
							if (!Object.is(description, next)) return;
							sinks.onConnected?.(next);
						},
						onStateChange: (state) => {
							if (state === "reconnecting") publishDescription(void 0);
							sinks.onStateChange?.(state);
						}
					}, config ?? {});
					controller.start();
					return { stop: () => {
						controller.stop();
						publishDescription(void 0);
					} };
				}
			};
			ctx.provide("connection", handle);
		}
		//#endregion
		exports.AbstractApiClient = AbstractApiClient;
		exports.RpcId = RpcId;
		exports.apply = apply;
		exports.inject = inject;
		exports.transportError = transportError;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map