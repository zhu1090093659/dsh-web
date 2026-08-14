import { createRequire } from "node:module";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
//#region lib/types/brand.js
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
/**
* Brand a provider-issued request identifier.
* @param id - the opaque provider-issued string.
* @returns the same string, branded; no validation is performed.
*/
function ProviderRequestId(id) {
	return id;
}
/**
* Brand an adapter-owned reasoning-effort identifier.
* @param id - the opaque identifier exposed by one model capability.
* @returns the same string, branded; no validation is performed.
*/
function ReasoningEffortId(id) {
	return id;
}
//#endregion
//#region lib/types/call-config.js
/**
* Conversation call configuration and freeze utilities. Provider routing,
* model, reasoning effort, and sampling values are request-header state that
* can affect cache reuse; request waterfalls replace them and the loop logs
* changed snapshots instead of allowing silent per-call drift.
* @module dsh-llm/call-config
*/
/** Process-local identities of request objects assembled by dsh-agent-loop. */
const AGENT_LOOP_REQUESTS = /* @__PURE__ */ new WeakSet();
/**
* Field-wise equality over {@link LlmCallConfig} — the comparison a caller
* runs to decide whether a proposed configuration is a real change (worth a
* logged header snapshot) or the held one restated.
* @param a - one configuration.
* @param b - the other.
* @returns whether every field (including the `stop` list, element-wise) matches.
*/
function callConfigEquals(a, b) {
	if (a.provider !== b.provider || a.model !== b.model || a.reasoningEffort !== b.reasoningEffort || a.temperature !== b.temperature || a.maxTokens !== b.maxTokens) return false;
	if (a.stop === void 0 || b.stop === void 0) return a.stop === b.stop;
	return a.stop.length === b.stop.length && a.stop.every((s, i) => s === b.stop?.[i]);
}
/**
* Mark one exact request object as assembled by dsh-agent-loop.
* @param request - loop-owned request envelope before LLM dispatch.
* @returns the same request object marked as created by the process-local agent loop.
*/
function markAgentLoopRequest(request) {
	AGENT_LOOP_REQUESTS.add(request);
	return request;
}
/**
* Test whether the exact request object was assembled by dsh-agent-loop.
* @param request - request envelope observed at the LLM waterfall.
* @returns whether {@link markAgentLoopRequest} recorded this object.
*/
function isAgentLoopRequest(request) {
	return AGENT_LOOP_REQUESTS.has(request);
}
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
//#region lib/types/message.js
/** Message value types, identity, and immutable construction helpers. */
/**
* Bound for a `notice` summary. The account rides a collapsed transcript row
* and is committed to the durable log, while its inputs — task labels, goal
* objectives, tool arguments — are caller text with no length of their own.
*/
const CONTEXT_SUMMARY_MAX_CHARS = 120;
/**
* Bound one `notice` summary to {@link CONTEXT_SUMMARY_MAX_CHARS}.
* @param summary - the producer's one-line account, of any length.
* @returns the account, ellipsized when it exceeds the bound.
*/
function boundContextSummary(summary) {
	return summary.length <= 120 ? summary : `${summary.slice(0, 119)}…`;
}
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
//#region lib/types/error.js
/**
* Harness error base with a stable machine-routable code and chained cause.
* Package errors extend it so tool results and replay can retain failure class.
* @module @deepseek-ai/dsh-llm/error
*/
/**
* Base class for all harness errors. Carries a `code` (stable, programmatic —
* e.g. `NO_ADAPTER`, `INVALID_ARGS`, `INVARIANT`) distinct from the
* human-readable `message`, and supports `cause` chaining via the standard
* `ErrorOptions`. `name` defaults to the subclass constructor name.
*/
var HarnessError = class extends Error {
	/** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
	code;
	constructor(message, code, options) {
		super(message, options);
		this.code = code;
		this.name = new.target.name;
	}
};
/** Canonical provider-neutral code for a model request rejected because its context window was exceeded. */
const CONTEXT_WINDOW_EXCEEDED_CODE = "CONTEXT_WINDOW_EXCEEDED";
/** Canonical provider-neutral code for an exhausted account quota or balance. */
const QUOTA_EXCEEDED_CODE = "QUOTA";
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
/**
* Canonical provider-neutral code for a credential that was supplied but
* cannot be used — malformed rather than absent. Distinct from
* `MISSING_CREDENTIAL` because the fix differs: correct the stored value
* rather than supply one. Deliberately outside the default retryable set —
* a malformed credential fails identically on every attempt.
*/
const INVALID_CREDENTIAL_CODE = "INVALID_CREDENTIAL";
/** Structured codes and plain phrases that explicitly name a context bound being exceeded. */
const STRUCTURED_CONTEXT_OVERFLOW = new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
/** Request-size wording that ties "too large" directly to model context capacity. */
const TOO_LARGE_FOR_CONTEXT = new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
/** "Exceeds" wording is safe only when its object is explicitly the model context. */
const EXCEEDS_MODEL_CONTEXT = new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
/**
* Recognize the context-overflow wording used by OpenAI-compatible providers
* and library adapters. Adapters pass all available provider code, type, and
* message text so both thrown and in-band delivery styles share one classifier.
* @param detail - provider error code/type/message text joined into one string.
* @returns true when the detail identifies a request exceeding the model context window.
*/
function isContextWindowExceededError(detail) {
	return STRUCTURED_CONTEXT_OVERFLOW.test(detail) || /\b(?:maximum|max)(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b/i.test(detail) || TOO_LARGE_FOR_CONTEXT.test(detail) || /\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\s+(?:this|the)\s+model\b/i.test(detail) || EXCEEDS_MODEL_CONTEXT.test(detail);
}
/**
* Recognize provider wording that identifies an exhausted account quota rather
* than a transient request-rate limit.
* @param detail - provider error code/type/message text joined into one string.
* @returns true only for terminal quota, balance, credit, budget, or usage-limit wording.
*/
function isQuotaExceededError(detail) {
	return /\binsufficient[\s_-]+(?:quota|balance|credits?)\b/i.test(detail) || /\b(?:quota|usage[\s_-]+limit)[\s_-]+(?:exceeded|exhausted|reached)\b/i.test(detail) || /\bexceed(?:ed|s)?[\s_-]+(?:(?:your|the)[\s_-]+)?(?:current[\s_-]+)?quota\b/i.test(detail) || /\b(?:balance|credits?)[\s_-]+(?:exhausted|depleted)\b/i.test(detail) || /\bout[\s_-]+of[\s_-]+(?:credits?|budget)\b/i.test(detail);
}
/**
* Render a thrown value with its full `cause` chain and AggregateError
* members, so transport wrappers like undici's `TypeError: fetch failed`
* surface the underlying failure instead of masking it. Plain structured
* failures render their own data-backed `message`. Diagnostic-surface
* rendering only (messages, notices, logs) — never parse the result; route on
* {@link HarnessError.code}.
* @param value - the caught value (`unknown` in catch clauses).
* @returns the outermost message first, each cause appended with `: ` (skipped
* when it repeats the wrapper message verbatim), and AggregateError members
* bracketed and `; `-joined.
*/
function errorChain(value) {
	const path = /* @__PURE__ */ new Set();
	const render = (current) => {
		if (path.has(current)) return "<circular cause>";
		path.add(current);
		try {
			if (!(current instanceof Error)) {
				if (typeof current === "object" && current !== null) {
					const descriptor = Object.getOwnPropertyDescriptor(current, "message");
					if (descriptor !== void 0 && "value" in descriptor && typeof descriptor.value === "string") return descriptor.value;
				}
				return String(current);
			}
			const message = current.message === "" ? current.name : current.message;
			const members = current instanceof AggregateError && current.errors.length > 0 ? ` [${current.errors.map(render).join("; ")}]` : "";
			const causeText = current.cause === void 0 || current.cause === null ? "" : render(current.cause);
			return `${message}${members}${causeText === "" || causeText === message ? "" : `: ${causeText}`}`;
		} catch {
			return "<unrenderable value>";
		} finally {
			path.delete(current);
		}
	};
	return render(value);
}
/**
* Narrow an arbitrary thrown value to a HarnessError (for `instanceof` at runtime boundaries).
* @param value - the caught value (`unknown` in catch clauses).
* @returns true only for real instances; duck-typed or cross-realm errors do not narrow.
*/
function isHarnessError(value) {
	return value instanceof HarnessError;
}
//#endregion
//#region lib/types/retry-policy.js
/**
* Provider-owned request-retry policy configuration and resolution.
*
* Adapters expose one resolved policy per registered provider route; the
* optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
*
* @module @deepseek-ai/dsh-llm/retry-policy
*/
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([
	EMPTY_RESPONSE_CODE,
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const backoffSchema = z.object({
	initialDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
	maxDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
	jitterRatio: z.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
const normalPolicySchema = z.object({
	mode: z.const("normal").required(),
	maxRetries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
	retryableCodes: z.array(z.string()).default([...DEFAULT_RETRYABLE_CODES]),
	backoff: backoffSchema
});
const alwaysPolicySchema = z.object({
	mode: z.const("always").required(),
	backoff: backoffSchema
});
/** Cordis schema embedded by each concrete provider configuration. */
const RetryPolicySchema = z.union([normalPolicySchema, alwaysPolicySchema]);
const NORMAL_POLICY_KEYS = new Set([
	"mode",
	"maxRetries",
	"retryableCodes",
	"backoff"
]);
const ALWAYS_POLICY_KEYS = new Set(["mode", "backoff"]);
const BACKOFF_KEYS = new Set([
	"initialDelayMs",
	"maxDelayMs",
	"jitterRatio"
]);
function validateKeys(value, allowed, path) {
	for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`);
}
function resolveBackoff(config, path) {
	if (config !== void 0) validateKeys(config, BACKOFF_KEYS, path);
	const initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
	const maxDelayMs = config?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
	const jitterRatio = config?.jitterRatio ?? DEFAULT_JITTER_RATIO;
	if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
	if (initialDelayMs > maxDelayMs) throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`);
	if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) throw new Error(`${path}.jitterRatio must be between 0 and 1`);
	return Object.freeze({
		initialDelayMs,
		maxDelayMs,
		jitterRatio
	});
}
/**
* Validate, default, and detach one provider-owned retry policy.
* @param config - optional provider configuration; omission selects normal defaults.
* @param path - diagnostic path naming the provider config that owns the value.
* @returns an immutable policy safe to capture in provider registration state.
*/
function resolveRetryPolicy(config, path) {
	if (config === void 0) return Object.freeze({
		mode: "normal",
		maxRetries: DEFAULT_MAX_RETRIES,
		retryableCodes: DEFAULT_RETRYABLE_CODES,
		...resolveBackoff(void 0, `${path}.backoff`)
	});
	switch (config.mode) {
		case "normal": {
			validateKeys(config, NORMAL_POLICY_KEYS, path);
			const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
			const retryableCodes = config.retryableCodes ?? [...DEFAULT_RETRYABLE_CODES];
			if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error(`${path}.maxRetries must be a non-negative safe integer`);
			if (retryableCodes.length === 0) throw new Error(`${path}.retryableCodes must not be empty`);
			if (retryableCodes.some((code) => typeof code !== "string" || code.length === 0)) throw new Error(`${path}.retryableCodes must contain only non-empty strings`);
			if (new Set(retryableCodes).size !== retryableCodes.length) throw new Error(`${path}.retryableCodes must not contain duplicates`);
			return Object.freeze({
				mode: "normal",
				maxRetries,
				retryableCodes: Object.freeze([...retryableCodes]),
				...resolveBackoff(config.backoff, `${path}.backoff`)
			});
		}
		case "always":
			validateKeys(config, ALWAYS_POLICY_KEYS, path);
			return Object.freeze({
				mode: "always",
				...resolveBackoff(config.backoff, `${path}.backoff`)
			});
		default: throw new Error(`${path}.mode must be "normal" or "always"`);
	}
}
//#endregion
//#region lib/types/adapter-failure.js
/**
* Normalization for values thrown by a final LLM adapter boundary.
*
* @module @deepseek-ai/dsh-llm/adapter-failure
*/
/**
* Detach serializable provider facts from a value thrown by an adapter.
* @param value - arbitrary value thrown during adapter dispatch or iteration.
* @returns immutable provider-neutral facts suitable for a terminal finish chunk.
* @internal
*/
function normalizeLlmFailure(value) {
	const error = value instanceof Error ? value : new HarnessError(thrownMessage(value), "UNKNOWN", { cause: value });
	const carried = ownFailureSnapshot(error);
	if (carried !== void 0 && carried.code === ownErrorCode(error)) return carried;
	return Object.freeze({
		message: errorMessage(error),
		code: harnessErrorCode(error)
	});
}
/** Render a non-Error throw without letting hostile coercion escape normalization. */
function thrownMessage(value) {
	try {
		const message = String(value);
		return message.length > 0 ? message : "LLM adapter failed";
	} catch (_hostileThrownValue) {
		return "LLM adapter failed";
	}
}
/** Read a foreign error's own data-backed `code` without invoking accessors. */
function ownErrorCode(error) {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, "code");
		return descriptor !== void 0 && "value" in descriptor ? descriptor.value : void 0;
	} catch (_sdkPropertyTrap) {
		return;
	}
}
/** Snapshot an own data property without invoking an SDK-defined accessor. */
function ownFailureSnapshot(error) {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(error, "failure");
		return descriptor !== void 0 && "value" in descriptor ? failureSnapshot(descriptor.value) : void 0;
	} catch (_sdkPropertyTrap) {
		return;
	}
}
/** Validate and detach an arbitrary serializable failure payload. */
function failureSnapshot(value) {
	if (typeof value !== "object" || value === null) return void 0;
	try {
		const candidate = value;
		const message = candidate.message;
		const code = candidate.code;
		const status = candidate.status;
		const providerRetryAfterMs = candidate.providerRetryAfterMs;
		const requestId = candidate.requestId;
		if (typeof message !== "string" || message.length === 0 || typeof code !== "string" || code.length === 0 || status !== void 0 && (!Number.isInteger(status) || status < 100 || status > 599) || providerRetryAfterMs !== void 0 && (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs <= 0) || requestId !== void 0 && (typeof requestId !== "string" || requestId.length === 0)) return void 0;
		return Object.freeze({
			message,
			code,
			...status === void 0 ? {} : { status },
			...providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs },
			...requestId === void 0 ? {} : { requestId }
		});
	} catch (_sdkFailureGetter) {
		return;
	}
}
/** Read an SDK error message without letting an accessor replace the primary failure. */
function errorMessage(error) {
	try {
		const message = error.message;
		if (typeof message === "string" && message.length > 0) return message;
	} catch (_sdkMessageGetter) {}
	return "LLM adapter failed";
}
/** Trust only Harness-owned codes; third-party SDK codes are not our taxonomy. */
function harnessErrorCode(error) {
	return error instanceof HarnessError ? error.code : "UNKNOWN";
}
//#endregion
//#region lib/types/api-key.js
/**
* The one definition of a well-formed provider API key, shared by every
* adapter that puts one in an HTTP header.
* @module @deepseek-ai/dsh-llm/api-key
*/
/**
* Characters an HTTP header value carries verbatim and every known provider
* key uses: printable ASCII, space excluded. A key outside this set cannot
* reach any provider — `fetch` refuses to build the header — so this is a
* transport invariant rather than one provider's policy. Latin-1 is excluded
* deliberately: a header could carry it, but no provider issues it, and
* admitting it trades a local explained refusal for an opaque 401.
*/
const LEGAL_API_KEY = /^[\x21-\x7E]+$/;
/**
* Judge one *supplied* API key, trimming surrounding whitespace first.
*
* Trimming is silent because a padded key has one unambiguous reading; every
* other defect is reported. Absence is a configuration state this function
* never sees — a profile naming no credential authenticates through the
* provider's own ambient discovery or OAuth — so callers decide whether a
* value was supplied before asking.
* @param raw - the key exactly as configured, stored, or typed.
* @returns the trimmed key, or why it cannot be used.
*/
function normalizeApiKey(raw) {
	const value = raw.trim();
	if (value.length === 0) return {
		ok: false,
		reason: "empty"
	};
	if (!LEGAL_API_KEY.test(value)) return {
		ok: false,
		reason: "illegalCharacters"
	};
	return {
		ok: true,
		value
	};
}
//#endregion
//#region lib/types/attribution.js
/**
* Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
* adapters from drifting. See
* `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
*
* App-attribution vocabulary for provider requests.
* @module @deepseek-ai/dsh-llm/attribution
*/
const { version } = createRequire(import.meta.url)("../package.json");
/**
* The harness's own identity: the default every adapter sends. Deployments
* that need a white-label identity pass their own {@link AppIdentity} to
* {@link attributionHeaders} — omission falls back to this default; nothing
* can suppress attribution entirely.
*/
const APP_IDENTITY = {
	product: "deepseek-harness",
	version,
	url: "https://github.com/deepseek-ai/deepseek-harness"
};
/**
* The standard `User-Agent` value: `product/version (+url)`. The
* parenthesized `+url` comment is the conventional self-identification form
* (RFC 9110 §10.1.5 product + comment syntax).
* @param identity - the identity to render; defaults to {@link APP_IDENTITY}.
* @returns the ready-to-send header value.
*/
function userAgent(identity = APP_IDENTITY) {
	return `${identity.product}/${identity.version} (+${identity.url})`;
}
/**
* Build the attribution headers an adapter must send on every provider
* request. Header names are lowercase (HTTP field names are case-insensitive
* on the wire).
* @param identity - the identity to send; defaults to {@link APP_IDENTITY} — omission cannot suppress attribution.
* @returns headers to merge into the provider request (currently just `user-agent`).
*/
function attributionHeaders(identity = APP_IDENTITY) {
	return { "user-agent": userAgent(identity) };
}
//#endregion
//#region lib/types/never.js
/**
* Exhaustiveness helper for closed core unions. Use {@link assertNever} at the default branch so a
* new variant fails compilation at every required handler. Do not use it for declaration-merged
* unions such as session events or content blocks: handle known variants and explicitly fall
* through because plugins may add valid unknown cases.
* @module @deepseek-ai/dsh-llm/never
*/
/**
* Mark an unreachable closed-union branch. A newly unhandled typed variant fails at the call site;
* a value that escaped its type throws with diagnostics at runtime.
* @param value - the impossible value; typed `never` so an unhandled variant fails compilation at the call site.
* @param context - optional label (e.g. the switch site) prefixed into the throw message.
* @returns never — it always throws, with the offending value JSON-rendered in the message.
*/
function assertNever(value, context) {
	const rendered = JSON.stringify(value) ?? String(value);
	throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
//#endregion
//#region lib/types/content.js
/** Content-block structure helpers. @module @deepseek-ai/dsh-llm/content */
/**
* True when typed model content contains an image block, walking nested
* tool-result content. This is the one recursive image walk shared by every
* image policy (capability gating, text-only serialization, compaction
* survey), so a consumer cannot silently diverge on nesting depth.
* @param content - typed model content blocks.
* @returns whether any nested block is an image.
*/
function contentHasImage(content) {
	return content.some((block) => block.type === "image" || block.type === "tool-result" && contentHasImage(block.content));
}
//#endregion
//#region lib/types/assembler.js
/**
* Incremental chunk-to-message assembler. This is the single canonical assembly
* algorithm used by the agent loop to build an assistant message from a chunk
* stream while logging the raw chunks for replay fidelity.
*
* @module @deepseek-ai/dsh-llm/assembler
*/
/**
* Incrementally assembles raw {@link StreamChunk}s into complete
* {@link ContentBlock}s and a final assistant {@link Message}.
*
* The agent loop feeds it while logging raw chunks for replay fidelity, then
* reads `blocks()` / `message()` / `usage` / `finish` once the stream ends.
*
* Tolerant of delta-only protocols (no block-start/end); deltas arriving for
* an index already closed by `block-end` are ignored (malformed stream) so a
* misbehaving adapter cannot grow memory or corrupt a completed block.
*/
var BlockAssembler = class {
	partials = /* @__PURE__ */ new Map();
	order = [];
	_usage;
	_finish;
	_replayState = void 0;
	/**
	* Feed one chunk into the assembly state.
	* @param chunk - the next raw chunk, in stream order.
	*/
	push(chunk) {
		switch (chunk.type) {
			case "block-start":
				if (!this.partials.has(chunk.index)) {
					this.order.push(chunk.index);
					this.partials.set(chunk.index, {
						blockType: chunk.blockType,
						text: "",
						toolCallArguments: ""
					});
				}
				return;
			case "text-delta":
			case "reasoning-delta": {
				const partial = this.ensure(chunk.index, chunk.type === "text-delta" ? "text" : "reasoning");
				if (partial.block) return;
				partial.text += chunk.text;
				return;
			}
			case "tool-call-delta": {
				const partial = this.ensure(chunk.index, "tool-call");
				if (partial.block) return;
				partial.toolCallId = chunk.id;
				if (chunk.name) partial.toolCallName = chunk.name;
				partial.toolCallArguments += chunk.argumentsDelta;
				return;
			}
			case "block-end": {
				const partial = this.ensure(chunk.index, chunk.block.type);
				if (partial.block) return;
				partial.block = chunk.block;
				return;
			}
			case "usage":
				this._usage = chunk.usage;
				return;
			case "finish":
				this._finish = chunk.reason;
				this._replayState = chunk.replayState;
				return;
			default: return assertNever(chunk, "BlockAssembler.push");
		}
	}
	ensure(index, blockType) {
		let partial = this.partials.get(index);
		if (!partial) {
			partial = {
				blockType,
				text: "",
				toolCallArguments: ""
			};
			this.partials.set(index, partial);
			this.order.push(index);
		}
		return partial;
	}
	assemble(partial, index) {
		if (partial.block) return partial.block;
		switch (partial.blockType) {
			case "text": return {
				type: "text",
				text: partial.text
			};
			case "reasoning": return {
				type: "reasoning",
				text: partial.text
			};
			case "tool-call": return {
				type: "tool-call",
				id: partial.toolCallId ?? CallId(`call-${index}`),
				name: partial.toolCallName ?? "",
				arguments: partial.toolCallArguments
			};
			default: throw new Error(`cannot assemble incomplete block of type "${partial.blockType}"`);
		}
	}
	/** Invariant accessor: every index in `order` has a partial. */
	mustGet(index) {
		const partial = this.partials.get(index);
		if (!partial) throw new Error(`BlockAssembler invariant violated: no partial for index ${index}`);
		return partial;
	}
	/**
	* Assemble all blocks seen so far, in stream order.
	* @returns one block per seen index, except that max-token truncation drops
	*   tool calls that cannot be executed safely; an open block assembles from
	*   its accumulated deltas (an unknown block type never closed by `block-end` throws).
	*/
	blocks() {
		const blocks = this.order.map((index) => this.assemble(this.mustGet(index), index));
		return this.finish.kind === "max-tokens" ? blocks.filter((block) => block.type !== "tool-call") : blocks;
	}
	/** Usage from the `usage` chunk; undefined until one arrives. */
	get usage() {
		return this._usage;
	}
	/** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
	get finish() {
		return this._finish ?? { kind: "stop" };
	}
	/** Adapter-private replay state from the terminal finish chunk, if any. */
	get replayState() {
		return this._replayState;
	}
	/**
	* The assembled assistant message.
	* @param source - producer attribution for the assembled message.
	* @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
	*/
	message(source = {
		kind: "plugin",
		plugin: "dsh-llm/assembler"
	}) {
		return createMessage({
			role: "assistant",
			content: this.blocks(),
			source
		});
	}
};
//#endregion
//#region lib/types/index.js
/**
* LLM service: adapter registry with a waterfall-interceptable streaming call
* API. Exports the `LlmRuntime` default, the abstract `LlmAdapter` for
* provider backends, and `BlockAssembler` for chunk assembly.
*
* @module @deepseek-ai/dsh-llm
*/
/**
* Typed error for LLM-related failures. Extends {@link HarnessError}, so the
* `code` string (e.g. `AUTH`, `RATE_LIMIT`, `NO_ADAPTER`) is shared taxonomy.
*/
var LlmError = class extends HarnessError {
	/** Serializable facts retained beside this live Error. */
	failure;
	/**
	* @param message - non-empty human-readable failure summary.
	* @param code - non-empty stable provider-neutral machine code.
	* @param options - optional cause and validated serializable provider facts.
	*/
	constructor(message, code, options) {
		if (typeof message !== "string" || message.length === 0) throw new Error("LlmError message must be a non-empty string");
		if (typeof code !== "string" || code.length === 0) throw new Error("LlmError code must be a non-empty string");
		if (options?.status !== void 0 && (!Number.isInteger(options.status) || options.status < 100 || options.status > 599)) throw new Error("LlmError status must be an integer from 100 through 599");
		if (options?.providerRetryAfterMs !== void 0 && (!Number.isFinite(options.providerRetryAfterMs) || options.providerRetryAfterMs <= 0)) throw new Error("LlmError providerRetryAfterMs must be a positive finite number");
		if (options?.requestId !== void 0 && (typeof options.requestId !== "string" || options.requestId.length === 0)) throw new Error("LlmError requestId must be a non-empty string");
		super(message, code, options);
		this.name = "LlmError";
		this.failure = Object.freeze({
			message,
			code,
			...options?.status === void 0 ? {} : { status: options.status },
			...options?.providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs: options.providerRetryAfterMs },
			...options?.requestId === void 0 ? {} : { requestId: options.requestId }
		});
	}
};
/**
* Accept one supplied credential, or refuse it as unusable.
*
* A stored key arrives from the credentials seam, a `.env` line, or a shell
* export, all of which pick up surrounding whitespace, so trimming is silent.
* Anything else fails here rather than inside `fetch`, whose ByteString
* refusal names a UTF-16 code point instead of the setting to change. The key
* never enters the message: `ref` names where to fix it, and echoing any part
* of a secret into a log or a UI is the failure this diagnosis avoids.
*
* Lives beside {@link LlmError} rather than in `./api-key.ts` so the predicate
* module stays dependency-free; both adapters share this one diagnosis instead
* of keeping near-identical local copies.
* @param raw - the credential exactly as supplied.
* @param pkg - the refusing package name, prefixed to the diagnostic.
* @param ref - the credential reference the value resolved through.
* @returns the trimmed, usable key.
*/
function assertUsableApiKey(raw, pkg, ref) {
	const checked = normalizeApiKey(raw);
	if (checked.ok) return checked.value;
	throw new LlmError(checked.reason === "empty" ? `${pkg}: the API key resolved from ${ref} is blank; set ${ref} to the raw key (the web Models page writes it) or export it in the launching environment` : `${pkg}: the API key resolved from ${ref} contains characters no HTTP header can carry; set ${ref} to the raw key alone (the web Models page writes it)`, INVALID_CREDENTIAL_CODE);
}
/**
* Provider-wire adapter for the harness message and stream vocabulary. Register implementations
* with `ctx.llm.registerAdapter(providers, adapter)`. Every provider HTTP request must include
* `attributionHeaders()`; prove the headers are added in the wire request or library header hook. The direct-fetch
* DeepSeek and library-backed pi-ai adapters meet this contract through different internals.
*/
var LlmAdapter = class {
	/**
	* Describe one provider route owned by this adapter.
	* @param provider - a route passed to `registerAdapter()` for this instance.
	* @returns detached display metadata whose id must equal `provider`.
	*/
	providerInfo(provider) {
		return {
			id: provider,
			name: provider
		};
	}
	/**
	* Return the provider-owned retry policy captured with this route.
	* @param _provider - a route passed to `registerAdapter()` for this instance.
	* @returns a resolved policy, or `undefined` to use the normal defaults.
	*/
	providerRetryPolicy(_provider) {}
	/**
	* List models this adapter can currently advertise for one owned provider.
	* The result is advisory: an adapter may accept unlisted model ids, and
	* consumers must not turn absence into request rejection.
	* @param _provider - one provider route owned by this adapter.
	* @returns discoverable models in adapter-preferred order.
	*/
	listModels(_provider) {
		return Promise.resolve([]);
	}
	/**
	* Resolve all metadata available for one exact model. This query is
	* independent of the advisory catalog and does not validate request routing.
	* @param provider - one provider route owned by this adapter.
	* @param model - exact model id passed to {@link GenerateOptions.model}.
	* @param _signal - cancellation for this exact-model lookup; asynchronous
	*   implementations must settle promptly after it aborts.
	* @returns provider/model identity plus any context, call-default, and reasoning metadata.
	*/
	resolveModel(provider, model, _signal) {
		return Promise.resolve({
			provider,
			id: model,
			name: model
		});
	}
};
/**
* The abstract `llm` service: an adapter registry plus a streaming model-call
* API, interceptable via the `llm/stream` waterfall.
*/
var LlmRuntime = class extends Service {
	adapters = /* @__PURE__ */ new Map();
	directory = /* @__PURE__ */ new Map();
	discoveries = /* @__PURE__ */ new Map();
	constructor(ctx) {
		super(ctx, "llm");
	}
	/** Notify topology observers without letting one broken listener veto the commit. */
	emitAdaptersUpdated() {
		let invariantFailure;
		for (const listener of this.ctx.events.dispatch("emit", ["llm/adapters-updated"])) try {
			const returned = listener();
			if (returned != null && typeof returned.then === "function") Promise.resolve(returned).then(void 0, (error) => {
				this.warnAdaptersListenerFailure(error);
			});
		} catch (error) {
			if (error?.code === "INVARIANT") {
				invariantFailure ??= error;
				continue;
			}
			this.warnAdaptersListenerFailure(error);
		}
		if (invariantFailure !== void 0) throw invariantFailure;
	}
	/** Contained-listener diagnostic shared by the sync and async failure paths. */
	warnAdaptersListenerFailure(error) {
		this.ctx.logger.warn("llm: an llm/adapters-updated listener failed");
		this.ctx.logger.warn(error);
	}
	/**
	* Register an adapter for the given provider routes. Throws `LlmError` with code
	* `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
	* Disposed with the fiber.
	* @param providers - every provider route this adapter should serve.
	* @param adapter - the adapter that streams calls for those providers.
	* @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
	*/
	registerAdapter(providers, adapter) {
		const owned = /* @__PURE__ */ new Set();
		let released = false;
		const dispose = this.ctx.effect(function* () {
			if (providers.length === 0) throw new LlmError("an adapter must register at least one provider", "INVALID_ADAPTER");
			this.commitRoutes(owned, this.prepareRoutes(providers, adapter, owned));
			yield () => {
				released = true;
				for (const provider of owned) this.adapters.delete(provider);
				owned.clear();
				this.emitAdaptersUpdated();
			};
		}.bind(this), "llm.registerAdapter()");
		const handle = (() => void dispose());
		handle.replace = (next) => {
			if (released) throw new LlmError("a disposed adapter registration cannot replace its routes", "REGISTRATION_DISPOSED");
			this.commitRoutes(owned, this.prepareRoutes(next, adapter, owned));
		};
		return handle;
	}
	/**
	* Validate one candidate route set for `adapter`, treating routes this
	* registration already holds as available. Nothing is mutated: a rejected
	* candidate leaves the registry exactly as it was.
	*/
	prepareRoutes(providers, adapter, owned) {
		const unique = /* @__PURE__ */ new Set();
		const registrations = [];
		for (const provider of providers) {
			if (provider.length === 0) throw new LlmError("adapter provider names must be non-empty", "INVALID_ADAPTER");
			if (unique.has(provider) || this.adapters.has(provider) && !owned.has(provider)) throw new LlmError(`an adapter for provider "${provider}" is already registered`, "DUPLICATE_ADAPTER");
			const info = adapter.providerInfo(provider);
			if (typeof info.id !== "string" || info.id !== provider || typeof info.name !== "string" || info.name.length === 0) throw new LlmError(`adapter metadata for provider "${provider}" must preserve its id and have a non-empty name`, "INVALID_ADAPTER");
			unique.add(provider);
			const retryPolicy = adapter.providerRetryPolicy(provider) ?? resolveRetryPolicy(void 0, `llm: provider "${provider}" retryPolicy`);
			registrations.push({
				adapter,
				provider: {
					id: info.id,
					name: info.name
				},
				retryPolicy
			});
		}
		return registrations;
	}
	/**
	* Swap this registration's routes for the prepared ones in one synchronous
	* section, so no observer can see the registry between the release and the
	* re-registration. The route set's one mutation point is also where
	* `llm/adapters-updated` is published, so a `replace` announces itself
	* exactly like a first registration.
	*/
	commitRoutes(owned, registrations) {
		for (const provider of owned) this.adapters.delete(provider);
		owned.clear();
		for (const registration of registrations) {
			this.adapters.set(registration.provider.id, registration);
			owned.add(registration.provider.id);
		}
		this.emitAdaptersUpdated();
	}
	/**
	* Describe provider routes with a registered adapter.
	* @returns detached provider metadata in registration order.
	*/
	listProviders() {
		return [...this.adapters.values()].map(({ provider }) => ({ ...provider }));
	}
	/**
	* Declare provider routes an adapter plugin can activate through
	* configuration. Registration is all-or-nothing: an empty list, invalid
	* entry, or a provider already declared by any registration throws
	* `LlmError` without registering the rest. Disposed with the fiber.
	* @param entries - every configurable provider this plugin owns.
	* @returns a handle that withdraws all of them, and can atomically replace them.
	*/
	registerConfigurableProviders(entries) {
		let held = [];
		let disposed = false;
		/**
		* Validate a candidate set in full against everything this registration
		* does not already hold, then publish it. Nothing is written until the
		* whole set passes, so a refused candidate leaves the current entries in
		* place — the property that makes `replace` a swap rather than a
		* delete-then-add that can strand the directory empty.
		*/
		const commit = (candidates) => {
			const detached = [];
			const own = new Set(held.map((entry) => entry.provider));
			for (const entry of candidates) {
				if (entry.provider.length === 0 || entry.displayName.length === 0 || entry.settingsNs.length === 0) throw new LlmError("configurable providers need a non-empty provider, displayName, and settingsNs", "INVALID_DIRECTORY");
				if (entry.settingsPath.some((segment) => segment.length === 0)) throw new LlmError(`configurable provider "${entry.provider}" has an empty settingsPath segment`, "INVALID_DIRECTORY");
				if (this.directory.has(entry.provider) && !own.has(entry.provider) || detached.some((seen) => seen.provider === entry.provider)) throw new LlmError(`configurable provider "${entry.provider}" is already declared`, "DUPLICATE_DIRECTORY");
				detached.push({
					...entry,
					settingsPath: [...entry.settingsPath]
				});
			}
			for (const entry of held) this.directory.delete(entry.provider);
			for (const entry of detached) this.directory.set(entry.provider, entry);
			held = detached;
			this.emitAdaptersUpdated();
		};
		const dispose = this.ctx.effect(function* () {
			if (entries.length === 0) throw new LlmError("a configurable-provider registration must declare at least one provider", "INVALID_DIRECTORY");
			commit(entries);
			yield () => {
				disposed = true;
				for (const entry of held) this.directory.delete(entry.provider);
				held = [];
				this.emitAdaptersUpdated();
			};
		}.bind(this), "llm.registerConfigurableProviders()");
		const handle = (() => void dispose());
		handle.replace = (next) => {
			if (disposed) throw new LlmError("this configurable-provider registration was disposed", "REGISTRATION_DISPOSED");
			commit(next);
		};
		return handle;
	}
	/**
	* List every declared configurable provider, registered or dormant.
	* @returns detached directory entries in declaration order.
	*/
	listConfigurableProviders() {
		return [...this.directory.values()].map((entry) => ({
			...entry,
			settingsPath: [...entry.settingsPath]
		}));
	}
	/**
	* Offer to interrogate provider endpoints on behalf of the settings
	* namespace this plugin owns. The namespace is the key because that is what
	* a configuration surface already holds from the configurable-provider
	* directory, and because a provider being *added* has no route to name yet.
	* Disposed with the fiber.
	* @param settingsNs - the namespace whose profiles this discovery serves.
	* @param discover - interrogates one endpoint; must honor `request.signal`.
	* @returns the disposer that withdraws the offer.
	*/
	registerModelDiscovery(settingsNs, discover) {
		const dispose = this.ctx.effect(function* () {
			if (settingsNs.length === 0) throw new LlmError("model discovery needs a non-empty settings namespace", "INVALID_DISCOVERY");
			if (this.discoveries.has(settingsNs)) throw new LlmError(`model discovery for "${settingsNs}" is already registered`, "DUPLICATE_DISCOVERY");
			this.discoveries.set(settingsNs, discover);
			yield () => {
				this.discoveries.delete(settingsNs);
			};
		}.bind(this), "llm.registerModelDiscovery()");
		return () => void dispose();
	}
	/**
	* Interrogate one provider endpoint for the models it advertises. The
	* request describes a draft, not a stored route, so nothing here reads or
	* writes settings or credentials — the caller owns both, and the reply is
	* candidate metadata a surface may offer for adoption.
	* @param settingsNs - namespace whose registered discovery serves this draft.
	* @param request - the endpoint, protocol, and one-shot credential to use.
	* @returns the advertised models, deduplicated in endpoint order.
	*/
	async discoverModels(settingsNs, request) {
		const discover = this.discoveries.get(settingsNs);
		if (discover === void 0) throw new LlmError(`no model discovery is registered for "${settingsNs}"`, "NO_DISCOVERY");
		if ((request.provider ?? "").length === 0 && (request.baseURL ?? "").length === 0) throw new LlmError("model discovery needs a provider route or a baseURL", "INVALID_DISCOVERY");
		const discovered = await discover(request);
		const seen = /* @__PURE__ */ new Set();
		const models = [];
		for (const model of discovered) {
			if (typeof model.id !== "string" || model.id.length === 0 || seen.has(model.id)) continue;
			seen.add(model.id);
			models.push({
				id: model.id,
				...model.name === void 0 ? {} : { name: model.name },
				...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
				...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens }
			});
		}
		return models;
	}
	/**
	* Resolve the retry policy captured when one provider route was registered.
	* @param provider - registered provider route to inspect.
	* @returns the provider-owned policy, with normal defaults already resolved.
	*/
	providerRetryPolicy(provider) {
		return this.registration(provider).retryPolicy;
	}
	/** Detach typed adapter-owned modality metadata. */
	detachedModalities(modalities) {
		return modalities === void 0 ? void 0 : [...modalities];
	}
	/**
	* Discover models advertised by one registered provider. Catalog membership
	* is advisory and never changes routing or request validation.
	* @param provider - registered provider route to inspect.
	* @returns detached model metadata in adapter-preferred order.
	*/
	async listModels(provider) {
		const models = await this.registration(provider).adapter.listModels(provider);
		const seen = /* @__PURE__ */ new Set();
		return models.map((model) => {
			if (typeof model.provider !== "string" || model.provider !== provider || typeof model.id !== "string" || model.id.length === 0 || typeof model.name !== "string" || model.name.length === 0 || model.description !== void 0 && typeof model.description !== "string" || seen.has(model.id)) throw new LlmError(`adapter returned invalid or duplicate model metadata for provider "${provider}"`, "INVALID_CATALOG");
			seen.add(model.id);
			const inputModalities = this.detachedModalities(model.inputModalities);
			return {
				provider: model.provider,
				id: model.id,
				name: model.name,
				...model.description === void 0 ? {} : { description: model.description },
				...inputModalities === void 0 ? {} : { inputModalities }
			};
		});
	}
	/**
	* Resolve and validate all metadata from the adapter that owns one exact
	* route. The result is detached from adapter-owned objects; catalog
	* membership remains advisory and does not control request routing.
	* @param provider - registered provider route to inspect.
	* @param model - exact model id passed to the adapter.
	* @param signal - optional cancellation for adapter-owned asynchronous lookup.
	* @returns exact model identity plus available context and reasoning metadata.
	*/
	async resolveModelInfo(provider, model, signal) {
		return this.resolveModelInfoFor(this.registration(provider), model, signal);
	}
	async resolveModelInfoFor(registration, model, signal) {
		const provider = registration.provider.id;
		const resolved = await registration.adapter.resolveModel(provider, model, signal);
		if (typeof resolved.provider !== "string" || resolved.provider !== provider || typeof resolved.id !== "string" || resolved.id !== model || typeof resolved.name !== "string" || resolved.name.length === 0 || resolved.description !== void 0 && typeof resolved.description !== "string") throw new LlmError(`adapter returned invalid exact model metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
		const context = resolved.context;
		if (context !== void 0 && (!Number.isInteger(context.contextWindow) || context.contextWindow <= 0)) throw new LlmError(`adapter returned invalid context metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_CONTEXT");
		const inputModalities = this.detachedModalities(resolved.inputModalities);
		const defaultMaxTokens = resolved.defaultMaxTokens;
		if (defaultMaxTokens !== void 0 && (!Number.isSafeInteger(defaultMaxTokens) || defaultMaxTokens <= 0)) throw new LlmError(`adapter returned invalid default maxTokens for provider "${provider}" model "${model}"`, "INVALID_MODEL_MAX_TOKENS");
		const info = {
			provider,
			id: model,
			name: resolved.name,
			...resolved.description === void 0 ? {} : { description: resolved.description },
			...inputModalities === void 0 ? {} : { inputModalities },
			...context === void 0 ? {} : { context: { contextWindow: context.contextWindow } },
			...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens }
		};
		const reasoning = resolved.reasoning;
		if (reasoning === void 0) return info;
		if (reasoning.efforts.length === 0) throw new LlmError(`adapter returned invalid reasoning metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
		const seen = /* @__PURE__ */ new Set();
		const efforts = reasoning.efforts.map((effort) => {
			if (typeof effort.id !== "string" || effort.id.length === 0 || typeof effort.name !== "string" || effort.name.length === 0 || effort.description !== void 0 && typeof effort.description !== "string" || seen.has(effort.id)) throw new LlmError(`adapter returned invalid or duplicate reasoning effort metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
			seen.add(effort.id);
			return {
				id: effort.id,
				name: effort.name,
				...effort.description === void 0 ? {} : { description: effort.description }
			};
		});
		if (reasoning.defaultEffort !== void 0 && !seen.has(reasoning.defaultEffort)) throw new LlmError(`adapter returned an unknown default reasoning effort for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
		return {
			...info,
			reasoning: {
				efforts,
				...reasoning.defaultEffort === void 0 ? {} : { defaultEffort: reasoning.defaultEffort }
			}
		};
	}
	/**
	* Validate a conversation call config against its exact model capability and
	* materialize adapter-configured defaults. Unsupported explicit efforts
	* reject before provider I/O; no clamping or aliasing is performed. This
	* standalone query does not bind a later dispatch; use {@link prepareCall}
	* when logging and streaming must share one adapter registration.
	* @param config - provider/model route and optional request controls.
	* @param signal - optional cancellation for adapter-owned capability lookup.
	* @returns a detached config only when a default must be materialized.
	*/
	async resolveCallConfig(config, signal) {
		return (await this.resolveCallFor(this.registration(config.provider), config, signal)).config;
	}
	async resolveCallFor(registration, config, signal) {
		const info = await this.resolveModelInfoFor(registration, config.model, signal);
		const defaulted = config.maxTokens === void 0 && info.defaultMaxTokens !== void 0 ? {
			...config,
			maxTokens: info.defaultMaxTokens
		} : config;
		const reasoning = info.reasoning;
		const requested = defaulted.reasoningEffort;
		let resolvedConfig = defaulted;
		if (reasoning === void 0) {
			if (requested !== void 0) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${requested}"`, "UNSUPPORTED_REASONING_EFFORT");
		} else {
			const effective = requested ?? reasoning.defaultEffort;
			if (effective !== void 0) {
				if (!reasoning.efforts.some((effort) => effort.id === effective)) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${effective}"`, "UNSUPPORTED_REASONING_EFFORT");
				if (requested !== effective) resolvedConfig = {
					...defaulted,
					reasoningEffort: effective
				};
			}
		}
		return {
			config: resolvedConfig,
			...info.context === void 0 ? {} : { context: info.context }
		};
	}
	/**
	* Resolve one call under its current adapter registration. The returned
	* one-shot handle keeps that registration across header logging and dispatch,
	* so HMR cannot combine one adapter's capability result with another adapter.
	* @param config - provider/model route and optional request controls.
	* @param signal - optional cancellation for adapter-owned capability lookup.
	* @returns a prepared config and its registration-bound stream entry point.
	*/
	async prepareCall(config, signal) {
		const registration = this.registration(config.provider);
		const resolved = await this.resolveCallFor(registration, config, signal);
		const resolvedConfig = deepFreeze(structuredClone(resolved.config));
		const context = resolved.context === void 0 ? void 0 : deepFreeze(structuredClone(resolved.context));
		const adapterDefaults = deepFreeze({
			...config.reasoningEffort === void 0 && resolvedConfig.reasoningEffort !== void 0 ? { reasoningEffort: true } : {},
			...config.maxTokens === void 0 && resolvedConfig.maxTokens !== void 0 ? { maxTokens: true } : {}
		});
		let dispatched = false;
		return Object.freeze({
			config: resolvedConfig,
			retryPolicy: registration.retryPolicy,
			adapterDefaults,
			...context === void 0 ? {} : { context },
			stream: (options) => {
				if (dispatched) throw new LlmError("a prepared LLM call can only be dispatched once", "INVALID_PREPARED_CALL");
				if (!callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
				dispatched = true;
				return this.streamWithRegistration(options, {
					registration,
					config: resolvedConfig
				});
			}
		});
	}
	registration(provider) {
		const registration = this.adapters.get(provider);
		if (!registration) throw new LlmError(`no adapter registered for provider "${provider}"`, "NO_ADAPTER");
		return registration;
	}
	/** Remove replay state whose historical route is owned by another adapter. */
	forAdapter(options, adapter) {
		const messages = options.messages.map((message) => {
			const source = message.source;
			if (message.role !== "assistant" || source.kind !== "model" || source.replayState === void 0) return message;
			if (this.adapters.get(source.provider)?.adapter === adapter) return message;
			return freezeMessage({
				...message,
				source: {
					kind: "model",
					provider: source.provider,
					model: source.model
				}
			});
		});
		if (messages.every((message, index) => message === options.messages[index])) return options;
		const filtered = {
			...options,
			messages
		};
		return Object.isFrozen(options) ? deepFreeze(filtered) : filtered;
	}
	/**
	* Final adapter boundary. Adapter selection, dispatch, iterator construction,
	* and iteration failures become one terminal failure chunk. Middleware and
	* downstream consumer failures remain thrown plugin or consumer errors.
	*/
	async *adapterStream(options, prepared) {
		let iterator;
		try {
			const registration = prepared?.registration ?? this.registration(options.provider);
			const resolvedConfig = prepared === void 0 ? (await this.resolveCallFor(registration, options, options.signal)).config : prepared.config;
			if (prepared !== void 0 && !callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
			const resolvedOptions = callConfigEquals(options, resolvedConfig) ? options : Object.isFrozen(options) ? deepFreeze({
				...options,
				...resolvedConfig
			}) : {
				...options,
				...resolvedConfig
			};
			const adapter = registration.adapter;
			iterator = adapter.stream(this.forAdapter(resolvedOptions, adapter))[Symbol.asyncIterator]();
		} catch (error) {
			yield adapterFailureChunk(error, options.signal);
			return;
		}
		let completed = false;
		try {
			while (true) {
				let item;
				try {
					const next = await iterator.next();
					item = next.done ? { done: true } : {
						done: false,
						value: next.value
					};
				} catch (error) {
					completed = true;
					yield adapterFailureChunk(error, options.signal);
					return;
				}
				if (item.done) {
					completed = true;
					return;
				}
				yield item.value;
			}
		} finally {
			if (!completed) {
				const close = iterator.return?.bind(iterator);
				if (close) await close();
			}
		}
	}
	/**
	* Stream one model call as raw chunks (token-level deltas). Replay state is
	* retained only when the same adapter instance owns its historical provider
	* and the target provider. Final adapter selection remains fixed through
	* asynchronous exact-model resolution and dispatch. Adapter selection,
	* dispatch, and iteration failures become terminal `error` or `aborted`
	* finish chunks; middleware, nested-call, cleanup, and consumer failures
	* remain thrown.
	* @param options - the full request; `options.provider` selects the adapter.
	* @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
	*/
	stream(options) {
		return this.streamWithRegistration(options);
	}
	streamWithRegistration(options, prepared) {
		return this.ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared));
	}
};
/** Convert one adapter throw into the stream protocol's terminal outcome. */
function adapterFailureChunk(error, signal) {
	const failure = normalizeLlmFailure(error);
	return {
		type: "finish",
		reason: signal?.aborted || failure.code === "ABORTED" ? {
			kind: "aborted",
			failure
		} : {
			kind: "error",
			failure
		}
	};
}
//#endregion
export { APP_IDENTITY, BlockAssembler, CONTEXT_SUMMARY_MAX_CHARS, CONTEXT_WINDOW_EXCEEDED_CODE, CallId, EMPTY_RESPONSE_CODE, HarnessError, INVALID_CREDENTIAL_CODE, LlmAdapter, LlmError, LlmRuntime, LlmRuntime as default, MessageId, ProviderRequestId, QUOTA_EXCEEDED_CODE, ReasoningEffortId, RetryPolicySchema, assertNever, assertUsableApiKey, attributionHeaders, boundContextSummary, callConfigEquals, contentHasImage, createAssistantMessage, createMessage, createToolResultMessage, createUserMessage, deepFreeze, errorChain, freezeMessage, isAgentLoopRequest, isContextWindowExceededError, isHarnessError, isQuotaExceededError, isTokenDelta, markAgentLoopRequest, normalizeApiKey, resolveRetryPolicy, userAgent };
