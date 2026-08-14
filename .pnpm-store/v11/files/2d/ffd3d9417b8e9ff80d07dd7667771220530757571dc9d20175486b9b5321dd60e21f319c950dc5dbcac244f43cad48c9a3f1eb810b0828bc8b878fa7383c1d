import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
//#region lib/types/history.js
/** Durable request-route lookup for one open model step. @module @deepseek-ai/dsh-llm-retry/history */
/**
* Find the provider in force for one currently open step.
* Request headers remain effective across turn boundaries until a newer full
* snapshot changes them; every provider change requires a newer full snapshot.
* @param events - session events ending inside the open step.
* @param turn - turn that owns the failed step.
* @param step - failed step whose provider is required.
* @returns the provider from the request header in force for the step.
*/
function providerForOpenStep(events, turn, step) {
	const stepStartIndex = events.findLastIndex((event) => event.type === "step/start" && event.data.turn === turn && event.data.step === step);
	if (stepStartIndex < 0 || events.slice(stepStartIndex + 1).some((event) => event.type === "step/end" || event.type === "turn/end")) return void 0;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event.type === "request/header") return event.data.header.config.provider;
	}
}
//#endregion
//#region lib/types/invariant.js
/** Package-owned durable retry-event invariants. @module @deepseek-ai/dsh-llm-retry/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-llm-retry";
/** Cordis companion plugin name. */
const name = "llm-retry-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** Validate the complete provider-neutral failure payload at the durable boundary. */
function validateFailure(value, fail) {
	if (typeof value !== "object" || value === null) fail("llm/retry failure must be an object");
	const failure = value;
	if (typeof failure.message !== "string" || failure.message.length === 0) fail("llm/retry failure.message must be a non-empty string");
	if (typeof failure.code !== "string" || failure.code.length === 0) fail("llm/retry failure.code must be a non-empty string");
	if (failure.status !== void 0 && (!Number.isInteger(failure.status) || failure.status < 100 || failure.status > 599)) fail("llm/retry failure.status must be an integer from 100 through 599 when present");
	if (failure.providerRetryAfterMs !== void 0 && (!Number.isFinite(failure.providerRetryAfterMs) || failure.providerRetryAfterMs <= 0)) fail("llm/retry failure.providerRetryAfterMs must be a positive finite number when present");
	if (failure.requestId !== void 0 && (typeof failure.requestId !== "string" || failure.requestId.length === 0)) fail("llm/retry failure.requestId must be a non-empty string when present");
}
/** Validate one retry record against the currently open request step. */
function validateRetry(history, event, fail) {
	const { retryId, turn, step, provider, mode, policyKey, retry, delayMs } = event.data;
	if (typeof retryId !== "string" || retryId.length === 0) fail("llm/retry retryId must be a non-empty string");
	const failure = event.data.failure;
	validateFailure(failure, fail);
	if (!Number.isSafeInteger(retry) || retry < 1) fail("llm/retry retry must be a positive safe integer");
	if (typeof provider !== "string" || provider.length === 0) fail("llm/retry provider must be a non-empty string");
	if (typeof policyKey !== "string" || policyKey.length === 0) fail("llm/retry policyKey must be a non-empty string");
	switch (mode) {
		case "normal": {
			const { maxRetries } = event.data;
			if (!Number.isSafeInteger(maxRetries) || maxRetries < 1 || retry > maxRetries) fail(`llm/retry retry ${retry} must not exceed a positive safe maxRetries ${maxRetries}`);
			break;
		}
		case "always":
			if ("maxRetries" in event.data) fail("llm/retry always mode must omit maxRetries");
			break;
		default: fail(`llm/retry mode must be normal or always, got ${String(mode)}`);
	}
	if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs < 0 || delayMs > MAX_TIMER_DELAY_MS) fail(`llm/retry delayMs must be a finite number within 0..${MAX_TIMER_DELAY_MS}`);
	const turnBoundary = history.findLast((prior) => prior.type === "turn/start" || prior.type === "turn/end");
	if (turnBoundary?.type !== "turn/start") fail("llm/retry must be appended inside an open turn");
	if (turn !== turnBoundary.data.turn) fail(`llm/retry names turn ${turn}, but the open turn is ${turnBoundary.data.turn}`);
	const stepBoundary = history.findLast((prior) => prior.type === "step/start" || prior.type === "step/end");
	if (stepBoundary?.type !== "step/start") fail("llm/retry must be appended inside an open step");
	if (step !== stepBoundary.data.step || turn !== stepBoundary.data.turn) fail(`llm/retry names turn ${turn}/step ${step}, but the open step is ${stepBoundary.data.turn}/${stepBoundary.data.step}`);
	const routedProvider = providerForOpenStep(history, turn, step);
	if (routedProvider !== provider) fail(`llm/retry provider ${provider} does not match the failed request provider ${String(routedProvider)}`);
	const priorPolicyRetry = history.findLast((prior) => prior.type === "llm/retry" && prior.data.turn === turn && prior.data.step === step && prior.data.provider === provider && prior.data.policyKey === policyKey);
	const expectedRetry = (priorPolicyRetry?.data.retry ?? 0) + 1;
	if (retry !== expectedRetry) fail(`llm/retry retry ${retry} must equal provider policy retry ${expectedRetry}`);
	if (priorPolicyRetry !== void 0 && priorPolicyRetry.data.retryId !== retryId) fail("llm/retry must preserve retryId across one provider-policy chain");
	if (priorPolicyRetry === void 0 && history.some((prior) => (prior.type === "llm/retry" || prior.type === "llm/retry-started") && prior.data.retryId === retryId)) fail(`llm/retry retryId ${JSON.stringify(retryId)} is already owned by another chain`);
}
/** Validate one wait-complete transition against its scheduled attempt. */
function validateStarted(history, event, fail) {
	const { retryId, turn, step, retry } = event.data;
	if (typeof retryId !== "string" || retryId.length === 0) fail("llm/retry-started retryId must be a non-empty string");
	const scheduled = history.findLast((prior) => prior.type === "llm/retry" && prior.data.retryId === retryId && prior.data.retry === retry);
	if (scheduled === void 0) fail("llm/retry-started pairs no prior scheduled attempt");
	if (scheduled.data.turn !== turn || scheduled.data.step !== step) fail("llm/retry-started turn/step must match its scheduled attempt");
	if (history.some((prior) => prior.type === "llm/retry-started" && prior.data.retryId === retryId && prior.data.retry === retry)) fail("llm/retry-started repeats one scheduled attempt");
}
/** Validate every retry record already present in one loaded session. */
function validateSession(session, fail) {
	for (const [index, event] of session.events.entries()) if (event.type === "llm/retry") validateRetry(session.events.slice(0, index), event, fail);
	else if (event.type === "llm/retry-started") validateStarted(session.events.slice(0, index), event, fail);
}
/** Install validation for loaded and newly appended retry records. */
const install = Object.assign((ctx, fail) => {
	for (const session of ctx.sessions.list()) validateSession(session, fail);
	ctx.on("session/created", (session) => {
		validateSession(session, fail);
	}, { global: true });
	ctx.on("internal/dispatch", (_mode, eventName, args) => {
		if (eventName !== "session/event") return;
		const [session, event] = args;
		if (event.type === "llm/retry") validateRetry(session.events, event, fail);
		else if (event.type === "llm/retry-started") validateStarted(session.events, event, fail);
	}, { global: true });
}, { inject: ["sessions"] });
/**
* Register the LLM retry invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
