import { Service } from "@deepseek-ai/cordis";
//#region lib/types/index.js
/**
* Remote decorators and explicit Gateway bindings backed only by private
* module state. Strict reflection remains a Typert compiler responsibility.
* @module @deepseek-ai/dsh-typert-protocol
*/
const TYPERT_REMOTE_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
/**
* Test one generated Remote name against the Connection endpoint grammar.
* @param value - namespace, method, lookup, or Context segment.
* @returns whether the value can cross the shared RPC carrier unchanged.
*/
function isTypertRemoteSegment(value) {
	return value !== "." && value !== ".." && TYPERT_REMOTE_SEGMENT_PATTERN.test(value);
}
/**
* A lookup policy rejection whose typed payload belongs to the active boundary adapter.
* Gateway adapters preserve this payload instead of collapsing it into an infrastructure failure.
*/
var TypertLookupFailure = class extends Error {
	/** Adapter-owned failure returned to the caller. */
	failure;
	/**
	* Wrap one adapter failure without exposing the rejected identity.
	* @param failure - typed failure owned by the active boundary adapter.
	*/
	constructor(failure) {
		super("Typert lookup policy rejected the requested identity");
		this.name = "TypertLookupFailure";
		this.failure = failure;
	}
};
const markers = /* @__PURE__ */ new WeakMap();
/**
* Bind one visible Service field to a Cordis key and Remote namespace.
* @param service - owning Service instance, normally `this`.
* @param serviceKey - exact Cordis service key.
* @param options - optional distinct wire namespace.
* @returns a frozen, inspectable binding with no compiler-injected metadata.
*/
function bindTypertRemote(service, serviceKey, options = {}) {
	validateName("service key", serviceKey);
	const namespace = options.namespace ?? serviceKey;
	validateName("namespace", namespace);
	return Object.freeze({
		service,
		serviceKey,
		namespace
	});
}
/** Cordis Service base that exposes its registered name through Typert Gateway. */
var TypertRemoteService = class extends Service {
	/** Visible binding consumed by the Gateway's source-mode discovery. */
	typertRemote;
	/**
	* Register the Service and bind the same key to Typert Gateway.
	* @param ctx - owning Cordis Context.
	* @param serviceKey - exact Cordis service key and default wire namespace.
	* @param options - optional distinct wire namespace.
	*/
	constructor(ctx, serviceKey, options = {}) {
		super(ctx, serviceKey);
		this.typertRemote = bindTypertRemote(this, this.name, options);
	}
};
function Remote(methodOrExportName, context) {
	if (typeof methodOrExportName === "string") {
		validateName("Remote export name", methodOrExportName);
		return function(_method, decoratorContext) {
			addMarkerInitializer(decoratorContext, { kind: "direct" }, methodOrExportName);
		};
	}
	if (context === void 0) throw new TypeError("typert-protocol: Remote decorator context is missing");
	addMarkerInitializer(context, { kind: "direct" });
}
/**
* Create a decorator for a method resolved from one Remote Scope.
* @param key - scope key declared through the Context map.
* @param exportName - optional Remote export name; defaults to the method name.
* @returns a standard method decorator that records only private module state.
*/
function RemoteScope(key, exportName) {
	validateName("Scope key", key);
	if (exportName !== void 0) validateName("Remote export name", exportName);
	return function(_method, context) {
		addMarkerInitializer(context, {
			kind: "context",
			context: key
		}, exportName);
	};
}
/**
* Read Remote markers attached to a live Service by decorator initializers.
* The returned snapshot cannot mutate the private marker table.
* @param service - live Service instance.
* @returns markers in class declaration order.
*/
function remoteMethods(service) {
	const prototype = Object.getPrototypeOf(service);
	if (prototype === null) return [];
	return [...markers.get(prototype) ?? []].map(([method, marker]) => ({
		method,
		...marker
	}));
}
function addMarkerInitializer(context, invocation, exportName) {
	if (context.private || context.static || typeof context.name !== "string") throw new TypeError("typert-protocol: Remote decorators require a public instance method with a string name");
	const method = context.name;
	context.addInitializer(function() {
		const prototype = Object.getPrototypeOf(this);
		if (prototype === null) throw new TypeError(`typert-protocol: cannot mark Remote method "${method}" on an object without a prototype`);
		mark(prototype, method, invocation, exportName);
	});
}
function mark(prototype, method, invocation, exportName) {
	let table = markers.get(prototype);
	if (table === void 0) {
		table = /* @__PURE__ */ new Map();
		markers.set(prototype, table);
	}
	const marker = {
		...exportName === void 0 || exportName === method ? {} : { exportName },
		invocation: Object.freeze(invocation)
	};
	const current = table.get(method);
	if (current !== void 0) {
		if (current.exportName === marker.exportName && sameInvocation(current.invocation, invocation)) return;
		throw new Error(`typert-protocol: Remote method "${method}" has conflicting invocation markers`);
	}
	table.set(method, Object.freeze(marker));
}
function sameInvocation(left, right) {
	return left.kind === right.kind && (left.kind === "direct" || right.kind === "context" && left.context === right.context);
}
function validateName(subject, value) {
	if (!isTypertRemoteSegment(value)) throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`);
}
//#endregion
export { Remote, RemoteScope, TypertLookupFailure, TypertRemoteService, bindTypertRemote, isTypertRemoteSegment, remoteMethods };
