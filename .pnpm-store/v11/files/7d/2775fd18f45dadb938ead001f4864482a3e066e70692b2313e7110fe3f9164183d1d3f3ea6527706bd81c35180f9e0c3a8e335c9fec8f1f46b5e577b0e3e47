import { randomUUID } from "node:crypto";
import z from "@deepseek-ai/schemastery";
//#region lib/types/brand.js
/**
* Brand an implementation-minted retry-chain identity.
* @param id - opaque retry identity.
* @returns the same string, branded; no validation is performed.
*/
function RetryId(id) {
	return id;
}
//#endregion
//#region lib/types/index.js
/**
* Provider-routed model-request retry policy on the agent loop's request
* recovery extension point. Each scheduled retry is durable before its cancellable wait.
*
* @module @deepseek-ai/dsh-llm-retry
*/
const name = "llm-retry";
const inject = ["agents"];
/** Runtime schema for {@link Config}. */
const Config = z.object({});
function validateConfig(config) {
	const [key] = Object.keys(config);
	if (key === void 0) return;
	if (key === "retryPolicy") throw new Error("llm-retry: retryPolicy belongs under each provider configuration");
	throw new Error(`llm-retry: unknown key "${key}"`);
}
async function settleDownstream(next) {
	try {
		return {
			type: "decision",
			decision: await next()
		};
	} catch (error) {
		return {
			type: "error",
			error
		};
	}
}
function localDelay(config, retry, random) {
	const exponent = Math.min(retry - 1, 1024);
	const exponential = Math.min(config.initialDelayMs * 2 ** exponent, config.maxDelayMs);
	const jitter = 1 - config.jitterRatio + 2 * config.jitterRatio * random();
	return Math.min(exponential * jitter, config.maxDelayMs);
}
function retryPolicyKey(policy) {
	return policy.mode === "always" ? JSON.stringify([
		policy.mode,
		policy.initialDelayMs,
		policy.maxDelayMs,
		policy.jitterRatio
	]) : JSON.stringify([
		policy.mode,
		policy.maxRetries,
		[...policy.retryableCodes].sort(),
		policy.initialDelayMs,
		policy.maxDelayMs,
		policy.jitterRatio
	]);
}
function cancellableDelay(delayMs, signal) {
	if (signal.aborted) return Promise.resolve(false);
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve(true);
		}, delayMs);
		function onAbort() {
			clearTimeout(timer);
			resolve(false);
		}
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
/**
* Install provider-routed normal or unbounded request recovery.
* @param ctx - plugin context that owns the listener and active waits.
* @param config - empty executor config; provider registrations own policy.
* @param internals - non-serializable deterministic hooks for tests.
*/
function apply(ctx, config = {}, internals = {}) {
	validateConfig(config);
	const random = internals.random ?? Math.random;
	const lifetime = new AbortController();
	const active = /* @__PURE__ */ new Set();
	function track(operation) {
		const tracked = operation.finally(() => active.delete(tracked));
		active.add(tracked);
		return tracked;
	}
	async function backoff(agent, turn, step, failure, provider, policy, policyKey, retry, retryId, delayMs, signal) {
		const fusedSignal = AbortSignal.any([signal, lifetime.signal]);
		if (fusedSignal.aborted) return;
		const eventData = policy.mode === "normal" ? {
			retryId,
			turn,
			step,
			provider,
			mode: policy.mode,
			policyKey,
			retry,
			maxRetries: policy.maxRetries,
			delayMs,
			failure
		} : {
			retryId,
			turn,
			step,
			provider,
			mode: policy.mode,
			policyKey,
			retry,
			delayMs,
			failure
		};
		agent.session.append("llm/retry", eventData);
		if (!await cancellableDelay(delayMs, fusedSignal)) return;
		agent.session.append("llm/retry-started", {
			retryId,
			turn,
			step,
			retry
		});
		return { kind: "retry" };
	}
	async function recover({ agent, turn, step, provider, failure, retryPolicy: policy, signal }, next) {
		if (policy === void 0) return next();
		if (policy.mode === "always") {
			if (signal.aborted || lifetime.signal.aborted) return;
			const fusedSignal = AbortSignal.any([signal, lifetime.signal]);
			const downstream = await settleDownstream(next);
			if (fusedSignal.aborted) return;
			if (downstream.type === "error") ctx.logger.warn(`llm-retry: provider "${provider}" always policy ignored a downstream recovery failure: %o`, downstream.error);
			if (downstream.type === "decision" && downstream.decision?.kind === "retry") return downstream.decision;
		} else if (!policy.retryableCodes.includes(failure.code)) return next();
		const policyKey = retryPolicyKey(policy);
		const priorPolicyRetry = agent.session.events.findLast((event) => event.type === "llm/retry" && event.data.turn === turn && event.data.step === step && event.data.provider === provider && event.data.policyKey === policyKey);
		const previousRetry = priorPolicyRetry?.data.retry ?? 0;
		if (policy.mode === "normal" && previousRetry >= policy.maxRetries) return next();
		const retry = previousRetry + 1;
		const retryId = priorPolicyRetry?.data.retryId ?? RetryId(randomUUID());
		let delayMs;
		if (failure.providerRetryAfterMs !== void 0 && Number.isFinite(failure.providerRetryAfterMs) && failure.providerRetryAfterMs > 0) if (failure.providerRetryAfterMs > policy.maxDelayMs) {
			if (policy.mode === "normal") return next();
			delayMs = localDelay(policy, retry, random);
		} else delayMs = failure.providerRetryAfterMs;
		else delayMs = localDelay(policy, retry, random);
		return backoff(agent, turn, step, failure, provider, policy, policyKey, retry, retryId, delayMs, signal);
	}
	const disposeListener = ctx.on("agent/request-error", (payload, next) => {
		if (lifetime.signal.aborted) return Promise.resolve(void 0);
		return track(recover(payload, next));
	});
	ctx.effect(() => async () => {
		disposeListener();
		lifetime.abort(/* @__PURE__ */ new Error("llm-retry plugin disposed"));
		await Promise.allSettled([...active]);
	}, "llm-retry: abort and drain active recovery");
}
//#endregion
export { Config, RetryId, apply, inject, name };
