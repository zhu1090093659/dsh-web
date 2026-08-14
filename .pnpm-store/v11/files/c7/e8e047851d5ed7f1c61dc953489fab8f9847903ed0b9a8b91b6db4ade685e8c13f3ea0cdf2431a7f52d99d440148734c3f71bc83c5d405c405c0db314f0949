import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { z as z$1 } from "zod";
import { assertNever, deepFreeze, isAgentLoopRequest } from "@deepseek-ai/dsh-llm";
//#region lib/types/normalize.js
/** Title text normalization and UTF-8-safe truncation. */
/** Operating-system-command escape sequences, including unterminated tails. */
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu;
/** Control-sequence-introducer escapes such as SGR color codes. */
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu;
/** Remaining two-byte ESC control sequences. */
const ESC_SEQUENCE = /\u001B[@-_]/gu;
/** Non-whitespace C0/C1 control characters. */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
/** Directional and invisible controls that can make a displayed title deceptive. */
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu;
/** Reject an invalid public text limit. */
function assertPositiveInteger$1(name, value) {
	if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}
/** Remove controls and produce one trimmed, whitespace-normalized line. */
function cleanTitleText(input) {
	return input.replace(OSC_SEQUENCE, "").replace(CSI_SEQUENCE, "").replace(ESC_SEQUENCE, "").replace(CONTROL_CHARACTER, "").replace(DIRECTIONAL_CONTROL, "").replace(/\s+/gu, " ").trim();
}
/**
* Truncate a string to a UTF-8 byte budget without splitting a Unicode code point.
* @param input - normalized title text.
* @param maxBytes - positive UTF-8 byte budget.
* @returns the longest leading code-point prefix within the budget.
*/
function truncateTitleUtf8(input, maxBytes) {
	assertPositiveInteger$1("maxBytes", maxBytes);
	if (Buffer.byteLength(input, "utf8") <= maxBytes) return input;
	let used = 0;
	let output = "";
	for (const character of input) {
		const bytes = Buffer.byteLength(character, "utf8");
		if (used + bytes > maxBytes) break;
		output += character;
		used += bytes;
	}
	return output;
}
/**
* Normalize one accepted session title and enforce its UTF-8 byte budget.
* @param input - untrusted title text.
* @param maxBytes - positive maximum encoded size.
* @returns a terminal-safe one-line title, possibly empty after sanitization.
*/
function normalizeSessionTitle(input, maxBytes) {
	return truncateTitleUtf8(cleanTitleText(input), maxBytes).trimEnd();
}
/**
* Derive the deterministic first-prompt fallback.
* @param input - text from the first eligible human message.
* @param maxWords - positive whitespace-delimited word cap.
* @param maxBytes - positive UTF-8 byte cap.
* @returns the normalized leading words within both limits.
*/
function fallbackSessionTitle(input, maxWords, maxBytes) {
	assertPositiveInteger$1("maxWords", maxWords);
	return truncateTitleUtf8(cleanTitleText(input).split(" ").filter(Boolean).slice(0, maxWords).join(" "), maxBytes).trimEnd();
}
//#endregion
//#region lib/types/index.js
/**
* Log-backed session title service, deterministic fallback, and provider contract.
* @module @deepseek-ai/dsh-session-title
*/
/**
* Brand a raw provider id.
* @param id - stable non-empty provider identifier supplied by a plugin.
* @returns the same string with the session-title provider brand.
*/
function SessionTitleProviderId(id) {
	return id;
}
/**
* Rejection of an explicit user title whose text normalizes to empty — the
* one {@link SessionTitleService.rename} failure that blames the input.
* Callers translating rename failures onto a wire (`title-invalid`) narrow on
* this class; liveness and disposal failures stay plain `Error`s.
*/
var SessionTitleInvalidError = class extends Error {
	name = "SessionTitleInvalidError";
};
/**
* Collect human text-bearing user messages in log order.
* @param events - session log or persisted replay.
* @param throughSeq - optional inclusive event boundary.
* @returns eligible messages with exact source seqs.
*/
function collectSessionTitleMessages(events, throughSeq) {
	const messages = [];
	for (const event of events) {
		if (throughSeq !== void 0 && event.seq > throughSeq) break;
		if (event.type !== "user/message" || event.data.source.kind !== "user") continue;
		const text = event.data.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		if (normalizeSessionTitle(text, Number.MAX_SAFE_INTEGER).length === 0) continue;
		messages.push({
			seq: event.seq,
			text
		});
	}
	return messages;
}
/**
* Fold the latest logged title without consulting mutable metadata.
* @param events - live or persisted session log.
* @returns the latest immutable title snapshot, or `undefined`.
*/
function foldSessionTitle(events) {
	const event = events.findLast((item) => item.type === "session/title");
	if (event === void 0) return void 0;
	return deepFreeze({
		title: event.data.title,
		messageSeqs: [...event.data.messageSeqs],
		source: copySessionTitleSource(event.data.source),
		eventSeq: event.seq,
		updatedAt: event.time
	});
}
/** Defensive copy of a logged title source (the snapshot must not alias log-owned objects). */
function copySessionTitleSource(source) {
	switch (source.kind) {
		case "fallback": return { kind: "fallback" };
		case "provider": return {
			kind: "provider",
			provider: source.provider,
			...source.model === void 0 ? {} : { model: { ...source.model } }
		};
		case "user": return { kind: "user" };
		/* v8 ignore next -- closed-union exhaustiveness guard */
		default: return assertNever(source, "SessionTitleSource");
	}
}
/** Validate one positive integer configuration field. */
function assertPositiveInteger(name, value) {
	if (!Number.isInteger(value) || value <= 0) throw new Error(`session-title: ${name} must be a positive integer`);
}
/** Log-backed title fold plus asynchronous fallback generation. */
var SessionTitleService = class extends Service {
	static inject = ["sessions"];
	static Config = z.object({
		fallbackMaxWords: z.number().step(1).min(1).required(),
		fallbackMaxBytes: z.number().step(1).min(1).required(),
		maxTitleBytes: z.number().step(1).min(1).required()
	});
	config;
	ownerFiber;
	registration;
	work = /* @__PURE__ */ new Map();
	lifetime = new AbortController();
	inFlight = /* @__PURE__ */ new Set();
	constructor(ctx, config) {
		super(ctx, "sessionTitle");
		this.ownerFiber = ctx.fiber;
		const candidate = config;
		if (candidate === null || typeof candidate !== "object") throw new Error("session-title: configuration is required");
		const value = candidate;
		assertPositiveInteger("fallbackMaxWords", value.fallbackMaxWords);
		assertPositiveInteger("fallbackMaxBytes", value.fallbackMaxBytes);
		assertPositiveInteger("maxTitleBytes", value.maxTitleBytes);
		if (value.fallbackMaxBytes > value.maxTitleBytes) throw new Error("session-title: fallbackMaxBytes must not exceed maxTitleBytes");
		this.config = deepFreeze({ ...value });
		ctx.effect(() => async () => {
			this.lifetime.abort(/* @__PURE__ */ new Error("session-title service disposed"));
			if (this.registration !== void 0) this.registration.closing = true;
			this.registration = void 0;
			for (const state of this.work.values()) {
				delete state.pending;
				state.active?.controller.abort(/* @__PURE__ */ new Error("session-title service disposed"));
			}
			await this.drain(this.inFlight);
			this.work.clear();
		}, "sessionTitle lifecycle");
		ctx.inject(["sessionProjections"], (projectionCtx) => {
			projectionCtx.sessionProjections.register({
				key: "title",
				schema: z$1.union([z$1.string().min(1), z$1.null()]),
				init: () => null,
				apply: (state, event) => event.type === "session/title" ? event.data.title : state,
				view: (state) => state,
				stateVersion: 1
			});
		});
		ctx.on("session/event", (session, event) => {
			switch (event.type) {
				case "user/message":
					this.onUserMessage(session, event);
					break;
				case "request/header":
					this.onRequestHeader(session, event);
					break;
				default: break;
			}
		});
		ctx.on("llm/stream", (options, next) => {
			this.onMainRequest(options);
			return next();
		}, {
			global: true,
			prepend: true
		});
		ctx.on("session/disposed", (session) => {
			const state = this.work.get(session);
			if (state === void 0) return;
			state.active?.controller.abort(/* @__PURE__ */ new Error("session disposed during title generation"));
			this.work.delete(session);
		});
	}
	/**
	* Read the latest folded title from one live or replayed session.
	* @param session - session whose log is the title source of truth.
	* @returns latest title snapshot, or `undefined` before eligible input.
	*/
	get(session) {
		return foldSessionTitle(session.events);
	}
	/**
	* Accept an explicit user title. Appends a `session/title` event with the
	* `user` source, which pins the title: in-flight automatic generation is
	* superseded and later user messages schedule none (an explicit
	* {@link SessionTitleService.refresh} remains the deliberate unpin).
	* @param session - exact live session to rename.
	* @param title - raw user input; normalized before acceptance.
	* @returns the accepted title snapshot.
	* @throws {SessionTitleInvalidError} when the title normalizes to empty.
	* @throws {Error} when the session is not live or the service is disposed.
	*/
	rename(session, title) {
		this.assertServiceActive();
		if (this.ctx.sessions.get(session.id) !== session) throw new Error(`session "${session.id}" is not live in this store`);
		const normalized = normalizeSessionTitle(title, this.config.maxTitleBytes);
		if (normalized.length === 0) throw new SessionTitleInvalidError("session title must contain visible characters");
		const state = this.stateFor(session);
		this.supersede(state, "user rename superseded automatic title generation");
		session.append("session/title", {
			title: normalized,
			messageSeqs: [],
			source: { kind: "user" }
		});
		const snapshot = this.get(session);
		/* v8 ignore next -- unreachable: the append above just committed a session/title event. */
		if (snapshot === void 0) throw new Error("renamed title failed to fold");
		return snapshot;
	}
	/**
	* Explicitly retry the registered provider, or materialize the built-in
	* fallback when no provider is registered.
	* @param session - exact live session to refresh.
	* @param signal - optional caller cancellation.
	* @returns latest accepted title, or `undefined` when no eligible text exists.
	*/
	async refresh(session, signal) {
		signal?.throwIfAborted();
		this.assertServiceActive();
		if (this.ctx.sessions.get(session.id) !== session) throw new Error(`session "${session.id}" is not live in this store`);
		const registration = this.registration;
		const messages = collectSessionTitleMessages(session.events);
		const latest = messages.at(-1);
		if (registration === void 0 || registration.closing || latest === void 0) {
			const current = this.get(session);
			const [first] = messages;
			if (current?.source.kind === "user" && first !== void 0) {
				this.appendFallback(session, first);
				signal?.throwIfAborted();
				return this.get(session);
			}
			const fallback = await this.ensureFallback(session);
			signal?.throwIfAborted();
			return fallback;
		}
		const state = this.stateFor(session);
		const revision = this.supersede(state, "explicit title refresh superseded older generation");
		const work = this.activate({
			registration,
			revision,
			throughSeq: latest.seq
		}, state, signal);
		const config = session.requestHeader()?.config;
		const route = config === void 0 ? void 0 : {
			provider: config.provider,
			model: config.model
		};
		return this.startProvider(session, work, route);
	}
	/**
	* Register the sole optional title provider. Disposal aborts its pending and
	* active work before another provider may register.
	* @param provider - provider identity, cadence, and generation function.
	* @returns exact Cordis effect disposer, which settles after active calls quiesce.
	*/
	register(provider) {
		this.validateProvider(provider);
		if (this.registration !== void 0) throw new Error(`session-title provider "${this.registration.provider.id}" is already registered`);
		const registration = {
			provider,
			active: /* @__PURE__ */ new Set(),
			closing: false
		};
		return this.ctx.effect(function* () {
			this.registration = registration;
			yield async () => {
				registration.closing = true;
				for (const state of this.work.values()) {
					if (state.pending?.registration === registration) delete state.pending;
					if (state.active?.registration === registration) state.active.controller.abort(/* @__PURE__ */ new Error(`session-title provider "${provider.id}" was disposed`));
				}
				await this.drain(registration.active);
				if (this.registration === registration) this.registration = void 0;
			};
		}.bind(this), "sessionTitle.register()");
	}
	/** Schedule fallback creation and any provider cadence for one eligible event. */
	onUserMessage(session, event) {
		if (!this.serviceActive()) return;
		if (event.data.source.kind !== "user" || collectSessionTitleMessages([event]).length === 0) return;
		if (this.get(session)?.source.kind === "user") return;
		const registration = this.registration;
		if (registration !== void 0 && !registration.closing) {
			const messages = collectSessionTitleMessages(session.events, event.seq);
			if (registration.provider.automatic === "all-prompts" || session.header.parentSession === void 0 && messages.length === 1 && this.get(session) === void 0) {
				const state = this.stateFor(session);
				state.pending = {
					registration,
					revision: this.supersede(state, "newer user message superseded title generation"),
					throughSeq: event.seq
				};
			}
		}
		this.defer(async () => {
			try {
				await this.ensureFallback(session);
			} catch (error) {
				if (!this.serviceActive()) return;
				this.ctx.logger.warn(`session "${session.id}": fallback title update failed: ${String(error)}`);
			}
		});
	}
	/** Start pending automatic work only after its exact main-request route is logged. */
	onRequestHeader(session, event) {
		if (!this.serviceActive()) return;
		const state = this.work.get(session);
		const pending = state?.pending;
		if (state === void 0 || pending === void 0 || pending.throughSeq >= event.seq) return;
		const route = {
			provider: event.data.header.config.provider,
			model: event.data.header.config.model
		};
		this.startPending(session, state, pending, route);
	}
	/** Start unchanged-route work from the marked loop request after its header fold is current. */
	onMainRequest(options) {
		if (!this.serviceActive() || options.sessionId === void 0 || !isAgentLoopRequest(options)) return;
		const session = this.ctx.sessions.get(options.sessionId);
		const state = session === void 0 ? void 0 : this.work.get(session);
		const pending = state?.pending;
		if (session === void 0 || state === void 0 || pending === void 0) return;
		const boundary = session.events.findLast((event) => event.type === "step/start" || event.type === "step/end");
		const route = session.requestHeader()?.config;
		if (boundary?.type !== "step/start" || boundary.seq <= pending.throughSeq || route?.provider !== options.provider || route.model !== options.model) return;
		this.startPending(session, state, pending, {
			provider: options.provider,
			model: options.model
		});
	}
	/** Consume one pending revision and schedule its non-blocking provider call. */
	startPending(session, state, pending, route) {
		delete state.pending;
		this.defer(async () => {
			if (this.registration !== pending.registration || pending.registration.closing || this.work.get(session) !== state || state.revision !== pending.revision) return;
			const work = this.activate(pending, state);
			try {
				await this.startProvider(session, work, route);
			} catch (error) {
				if (work.signal.aborted || !this.serviceActive()) return;
				this.ctx.logger.warn(`session "${session.id}": automatic title generation failed: ${String(error)}`);
			}
		});
	}
	/** Start one tracked provider call after publishing its active revision. */
	startProvider(session, work, route) {
		const run = Promise.resolve().then(() => this.runProvider(session, work, route));
		return this.track(run, work.registration);
	}
	/** Execute and accept one current provider revision. */
	async runProvider(session, work, route) {
		try {
			this.assertCurrent(session, work);
			await this.ensureFallback(session);
			this.assertCurrent(session, work);
			const messages = collectSessionTitleMessages(session.events, work.throughSeq);
			const result = await work.registration.provider.generate({
				session,
				messages,
				...route === void 0 ? {} : { route },
				signal: work.signal
			});
			this.assertCurrent(session, work);
			const accepted = this.validateResult(result, messages);
			session.append("session/title", {
				title: accepted.title,
				messageSeqs: [...accepted.messageSeqs],
				source: {
					kind: "provider",
					provider: work.registration.provider.id,
					...accepted.model === void 0 ? {} : { model: accepted.model }
				}
			});
			return this.get(session);
		} finally {
			const state = this.work.get(session);
			if (state?.active === work) delete state.active;
		}
	}
	/** Validate and normalize provider output against the supplied message snapshot. */
	validateResult(result, messages) {
		if (result === null || typeof result !== "object") throw new Error("session-title provider returned an invalid result");
		const candidate = result;
		if (typeof candidate.title !== "string") throw new Error("session-title provider title must be a string");
		const title = normalizeSessionTitle(candidate.title, this.config.maxTitleBytes);
		if (title.length === 0) throw new Error("session-title provider returned an empty title");
		if (!Array.isArray(candidate.messageSeqs) || candidate.messageSeqs.length === 0) throw new Error("session-title provider must identify at least one source message seq");
		const messageSeqs = [];
		const order = new Map(messages.map((message, index) => [message.seq, index]));
		let previous = -1;
		for (const seq of candidate.messageSeqs) {
			if (typeof seq !== "number") throw new Error("session-title provider messageSeqs must be unique, ordered seqs from the request");
			const index = order.get(seq);
			if (!Number.isSafeInteger(seq) || seq < 0 || index === void 0 || index <= previous) throw new Error("session-title provider messageSeqs must be unique, ordered seqs from the request");
			messageSeqs.push(seq);
			previous = index;
		}
		const modelCandidate = candidate.model;
		let model;
		if (modelCandidate !== void 0) {
			if (modelCandidate === null || typeof modelCandidate !== "object") throw new Error("session-title provider result model must contain non-empty provider and model strings");
			const record = modelCandidate;
			if (typeof record.provider !== "string" || record.provider.length === 0 || typeof record.model !== "string" || record.model.length === 0) throw new Error("session-title provider result model must contain non-empty provider and model strings");
			model = {
				provider: record.provider,
				model: record.model
			};
		}
		return {
			title,
			messageSeqs,
			...model === void 0 ? {} : { model }
		};
	}
	/** Fail a completion whose provider, revision, session, or signal is stale. */
	assertCurrent(session, work) {
		this.assertServiceActive();
		work.signal.throwIfAborted();
		const state = this.work.get(session);
		/* v8 ignore next -- every supported supersession, provider disposal, and session disposal aborts
		* the work signal before changing this state. */
		if (this.registration !== work.registration || state?.active !== work || state.revision !== work.revision || this.ctx.sessions.get(session.id) !== session) throw new Error("session title generation state changed without cancellation");
	}
	/** Create and publish an active provider call from one fixed revision. */
	activate(pending, state, upstream) {
		const controller = new AbortController();
		const signal = upstream === void 0 ? AbortSignal.any([controller.signal, this.lifetime.signal]) : AbortSignal.any([
			controller.signal,
			this.lifetime.signal,
			upstream
		]);
		const work = {
			...pending,
			controller,
			signal
		};
		state.active = work;
		return work;
	}
	/** Abort older active work and reserve the next session-local revision. */
	supersede(state, reason) {
		state.active?.controller.abort(new Error(reason));
		delete state.pending;
		state.revision += 1;
		return state.revision;
	}
	/** Return mutable work state for one session. */
	stateFor(session) {
		let state = this.work.get(session);
		if (state === void 0) {
			state = { revision: 0 };
			this.work.set(session, state);
		}
		return state;
	}
	/** Queue detached service work and retain it through service disposal. */
	defer(task) {
		const run = Promise.resolve().then(async () => {
			if (!this.serviceActive()) return;
			await task();
		});
		this.track(run);
	}
	/** Retain one promise until settlement for service and optional provider teardown. */
	track(run, registration) {
		this.inFlight.add(run);
		registration?.active.add(run);
		const settled = () => {
			this.inFlight.delete(run);
			registration?.active.delete(run);
		};
		run.then(settled, settled);
		return run;
	}
	/** Await every current and settling promise in one lifecycle registry. */
	async drain(active) {
		while (active.size > 0) await Promise.allSettled([...active]);
	}
	/** Whether the owning plugin fiber can still start or commit title work. */
	serviceActive() {
		return !this.lifetime.signal.aborted && this.ownerFiber.uid !== null && this.ownerFiber.state === 2;
	}
	/** Reject work once the owning plugin fiber has begun unloading. */
	assertServiceActive() {
		if (!this.serviceActive()) throw new Error("session-title service disposed");
	}
	/** Reject malformed provider registrations before publishing an effect. */
	validateProvider(provider) {
		if (provider === null || typeof provider !== "object") throw new Error("session-title provider must be an object");
		const candidate = provider;
		if (typeof candidate.id !== "string" || candidate.id.length === 0) throw new Error("session-title provider id must be a non-empty string");
		if (candidate.automatic !== "first-prompt" && candidate.automatic !== "all-prompts") throw new Error("session-title provider automatic mode is invalid");
		if (typeof candidate.generate !== "function") throw new Error(`session-title provider "${candidate.id}" requires generate()`);
	}
	/**
	* Derive and append the deterministic fallback title over whatever stands
	* (the refresh unpin path: overwriting a pinned user title is the point).
	* Synchronous on purpose — no await may separate derivation from append, so
	* it needs neither ensureFallback's in-flight dedup nor its liveness
	* re-check. An underivable fallback (empty after the caps) appends nothing.
	*/
	appendFallback(session, first) {
		const title = fallbackSessionTitle(first.text, this.config.fallbackMaxWords, this.config.fallbackMaxBytes);
		if (title.length === 0) return;
		session.append("session/title", {
			title,
			messageSeqs: [first.seq],
			source: { kind: "fallback" }
		});
	}
	/** Create the first deterministic fallback if the session still lacks a title. */
	async ensureFallback(session) {
		this.assertServiceActive();
		const current = this.get(session);
		if (current !== void 0) return current;
		const [first] = collectSessionTitleMessages(session.events);
		if (first === void 0) return void 0;
		const title = fallbackSessionTitle(first.text, this.config.fallbackMaxWords, this.config.fallbackMaxBytes);
		if (title.length === 0) return void 0;
		const state = this.stateFor(session);
		if (state.fallback !== void 0) return state.fallback;
		const fallback = Promise.resolve().then(() => {
			this.assertServiceActive();
			if (this.ctx.sessions.get(session.id) !== session) throw new Error(`session "${session.id}" is not live in this store`);
			const accepted = this.get(session);
			if (accepted !== void 0) return accepted;
			session.append("session/title", {
				title,
				messageSeqs: [first.seq],
				source: { kind: "fallback" }
			});
			return this.get(session);
		});
		state.fallback = fallback;
		try {
			return await fallback;
		} finally {
			delete state.fallback;
		}
	}
};
//#endregion
export { SessionTitleInvalidError, SessionTitleProviderId, SessionTitleService, SessionTitleService as default, collectSessionTitleMessages, fallbackSessionTitle, foldSessionTitle, normalizeSessionTitle, truncateTitleUtf8 };
