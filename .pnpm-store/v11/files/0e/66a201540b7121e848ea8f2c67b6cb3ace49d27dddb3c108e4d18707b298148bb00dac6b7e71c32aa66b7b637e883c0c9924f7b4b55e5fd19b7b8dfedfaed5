import { Service } from "@deepseek-ai/cordis";
//#region lib/types/redact.js
/**
* Structural secret redaction for settings values. `role('secret')` fields are
* removed from a value before it crosses a wire boundary; a sidecar records
* each schema-declared secret position and whether it currently holds a value,
* so a configuration surface can render a write-only input without ever
* receiving the secret itself.
* @module @deepseek-ai/dsh-settings/redact
*/
/** Whether a value is a plain data object the walker may recurse into. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function walk(node, value, path, secrets) {
	if (node === void 0) return value;
	if (node.meta?.role === "secret") {
		secrets.push({
			path,
			set: value !== void 0
		});
		return;
	}
	switch (node.type) {
		case "object": {
			const properties = node.dict ?? {};
			const source = isRecord(value) ? value : void 0;
			const rebuilt = {};
			if (source !== void 0) for (const [key, entry] of Object.entries(source)) {
				if (key in properties) continue;
				rebuilt[key] = entry;
			}
			for (const [key, child] of Object.entries(properties)) {
				const stripped = walk(child, source?.[key], [...path, key], secrets);
				if (stripped !== void 0) rebuilt[key] = stripped;
			}
			return source === void 0 && Object.keys(rebuilt).length === 0 ? value : rebuilt;
		}
		case "dict": {
			if (!isRecord(value)) return value;
			const rebuilt = {};
			for (const [key, entry] of Object.entries(value)) {
				const stripped = walk(node.inner, entry, [...path, key], secrets);
				if (stripped !== void 0) rebuilt[key] = stripped;
			}
			return rebuilt;
		}
		case "array":
			if (!Array.isArray(value)) return value;
			return value.map((entry, index) => walk(node.inner, entry, [...path, String(index)], secrets));
		default: return value;
	}
}
/**
* Remove every `role('secret')` field a schema declares from a value. The
* walker follows `object`, `dict`, and `array` containers; a secret must be
* declared directly on a field reachable through those containers (a secret
* buried inside a union branch or transform is not reachable and must not be
* modeled that way). The input is never mutated.
* @param schema - live schemastery schema describing the value.
* @param value - the value to strip; `undefined` yields an empty record with
*   object-property secret slots still enumerated.
* @returns the stripped detached value and the ordered secret positions.
*/
function redactSecrets(schema, value) {
	const secrets = [];
	return {
		value: walk(schema, value, [], secrets),
		secrets
	};
}
//#endregion
//#region lib/types/index.js
/**
* Service Definition for the user-settings capability seam (`ctx.settings`). Providers store one raw document of
* per-namespace sections; plugins register a namespace schema and read the
* resolved value, which layers schema defaults, the registrant's composition
* `base`, and the user document section, in that order.
* @module @deepseek-ai/dsh-settings
*/
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
/**
* Brand a raw string as a {@link SettingsNamespace}.
* @param value - candidate namespace; lowercase kebab-case, as in plugin short names.
* @returns the branded namespace.
*/
function settingsNamespace(value) {
	if (!NAMESPACE_PATTERN.test(value)) throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`);
	return value;
}
/**
* Deep equality over JSON-compatible data (objects, arrays, primitives) — the
* Service Definition's single change-detection predicate, exported so the invariant
* companion checks exactly the implementation's relation.
* @param a - one JSON-compatible value.
* @param b - the other JSON-compatible value.
* @returns whether the two values are structurally equal.
*/
function deepEqualJson(a, b) {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((entry, index) => deepEqualJson(entry, b[index]));
	}
	const left = a;
	const right = b;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((key) => key in right && deepEqualJson(left[key], right[key]));
}
/**
* A write refused because the namespace moved since the caller read it. The
* Service Definition's serialized write queue orders writes; it cannot tell a fresh writer
* from one holding a stale snapshot, which is what this reports.
*/
var SettingsConflictError = class extends Error {
	/** Stable machine code for wire layers mapping this to their own taxonomy. */
	code = "SETTINGS_CONFLICT";
	/** The revision the write expected. */
	expected;
	/** The revision the namespace actually stands at. */
	actual;
	/**
	* @param ns - the namespace whose write was refused.
	* @param expected - the revision the caller sent.
	* @param actual - the revision now stored.
	*/
	constructor(ns, expected, actual) {
		super(`settings namespace "${ns}" changed since it was read (expected revision ${String(expected)}, now ${String(actual)})`);
		this.name = "SettingsConflictError";
		this.expected = expected;
		this.actual = actual;
	}
};
/** Whether a value is a plain data object (not an array, null, or class instance). */
function isPlainObject(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
/** Apply one path op to a detached section, returning the next section. */
function applyPathOp(section, op) {
	const [head, ...rest] = op.path;
	if (head === void 0) {
		if (op.op === "unset") return {};
		if (!isPlainObject(op.value)) throw new TypeError("settings mutate: setting the section root requires a plain object");
		return { ...op.value };
	}
	if (rest.length === 0) {
		if (op.op === "set") return {
			...section,
			[head]: op.value
		};
		const { [head]: _removed, ...kept } = section;
		return kept;
	}
	const child = section[head];
	if (!isPlainObject(child)) {
		if (op.op === "unset") return section;
		return {
			...section,
			[head]: applyPathOp({}, {
				...op,
				path: rest
			})
		};
	}
	return {
		...section,
		[head]: applyPathOp(child, {
			...op,
			path: rest
		})
	};
}
/** Human label for a value that lossless JSON cannot represent (numbers reject inline). */
function describeRejected(value) {
	if (value === void 0) return "undefined";
	if (typeof value === "object" && value !== null) {
		const name = Object.getPrototypeOf(value)?.constructor?.name;
		return name === void 0 || name === "Object" ? "a non-plain object" : `a ${name}`;
	}
	return `a ${typeof value}`;
}
/**
* Detach and validate one write input in a single walk before persistence:
* only JSON data (plain objects, arrays, strings, finite numbers,
* booleans, `null`) may reach a provider document. `structuredClone` alone
* would admit Dates, Maps, BigInts, and cycles that YAML/JSON storage then
* silently distorts on the reload round-trip. `undefined` entries in objects
* are skipped — the same sparse-patch semantics as {@link mergeLayers} — while
* an `undefined` array entry is rejected rather than coerced.
* @param root - plain-object write input (caller-checked).
* @param reject - builds the validation error from a value label and its `$`-rooted path.
* @returns the detached JSON-compatible clone.
*/
function cloneJsonShaped(root, reject) {
	const visiting = /* @__PURE__ */ new WeakSet();
	const clone = (value, path) => {
		if (value === null || typeof value === "string" || typeof value === "boolean") return value;
		if (typeof value === "number") {
			if (!Number.isFinite(value)) throw reject("a non-finite number", path);
			return value;
		}
		if (Array.isArray(value)) {
			if (visiting.has(value)) throw reject("a circular reference", path);
			visiting.add(value);
			const entries = value.map((entry, index) => clone(entry, `${path}[${index}]`));
			visiting.delete(value);
			return entries;
		}
		if (isPlainObject(value)) {
			if (visiting.has(value)) throw reject("a circular reference", path);
			visiting.add(value);
			const out = {};
			for (const [key, entry] of Object.entries(value)) {
				if (entry === void 0) continue;
				out[key] = clone(entry, `${path}.${key}`);
			}
			visiting.delete(value);
			return out;
		}
		throw reject(describeRejected(value), path);
	};
	return clone(root, "$");
}
/**
* Layer `over` onto `under`: plain objects merge recursively, every other
* value (arrays included) replaces the lower layer wholesale. `over` never
* carries `undefined` entries — sections come from parsed documents and write
* snapshots pass {@link cloneJsonShaped}, which strips them so a sparse patch
* cannot erase lower keys.
*/
function mergeLayers(under, over) {
	if (over === void 0) return under;
	if (!isPlainObject(under) || !isPlainObject(over)) return over;
	const merged = { ...under };
	for (const [key, value] of Object.entries(over)) merged[key] = key in merged ? mergeLayers(merged[key], value) : value;
	return merged;
}
/** Recursively freeze one resolved value so handed-out snapshots stay immutable. */
function deepFreeze(value) {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
	for (const entry of Object.values(value)) deepFreeze(entry);
	return Object.freeze(value);
}
/**
* Abstract settings service. Providers implement raw-document storage
* (`load`/`persist`) and push external changes through {@link Settings.publish};
* the base class owns namespace registration, resolution, validation, change
* detection, and the `settings/updated` commit event.
*/
var SettingsProvider = class extends Service {
	registrations = /* @__PURE__ */ new Map();
	/** Latest published raw document; empty until the provider's first publish. */
	document = {};
	/** Per-namespace write chains; settled tails, so a failure never poisons the queue. */
	writeQueues = /* @__PURE__ */ new Map();
	/** In-flight watcher invocation segments, drained by the dispose teardown. */
	pendingTails = /* @__PURE__ */ new Set();
	/** Set at service dispose: refuse new writes while queued ones drain. */
	stopped = false;
	/** Opaque read of {@link stopped}: control flow cannot narrow it across awaits. */
	isStopped() {
		return this.stopped;
	}
	constructor(ctx) {
		super(ctx, "settings");
	}
	/**
	* Load the provider's document once and publish it before the service
	* becomes injectable, and register the write-drain teardown. Providers with
	* their own init (watchers, connections) delegate here first via
	* `yield* super[Service.init]()`; their disposers then run before the drain.
	*/
	async *[Service.init]() {
		yield async () => {
			this.stopped = true;
			await Promise.allSettled([...this.writeQueues.values(), ...this.pendingTails]);
		};
		this.publish(await this.load());
	}
	/**
	* Absolute path of the provider's user-editable document, when its storage
	* is one local file. Configuration surfaces use this only as availability
	* metadata; the guarded open operation resolves the path again Host-side.
	* Non-file providers leave it undefined and expose no open-document affordance.
	* @returns the absolute local document path, or undefined for non-file storage.
	*/
	get documentPath() {}
	/**
	* Prepare the provider's user-editable document for a native editor. File
	* providers may materialize an absent document before returning its path;
	* non-file providers return undefined.
	* @returns the absolute local document path, or undefined for non-file storage.
	*/
	prepareDocument() {
		return Promise.resolve(this.documentPath);
	}
	/**
	* Register a namespace schema and receive its owner scope. The registration
	* is an effect on the calling plugin's fiber: disposing that fiber removes
	* the namespace and its observers. An invalid stored section fails the
	* registration itself — the earliest point where the schema can judge it.
	* @param ns - unique namespace; duplicate registration fails loud.
	* @param schema - schemastery schema resolving this namespace's value.
	* @param options - composition `base` layer and effect timing.
	* @returns the owner scope for reads, observation, and updates.
	*/
	register(ns, schema, options) {
		if (this.registrations.has(ns)) throw new Error(`settings namespace "${ns}" is already registered`);
		const registration = {
			ns,
			schema,
			base: options?.base,
			applies: options?.applies ?? "live",
			...options?.validate === void 0 ? {} : { validate: options.validate },
			resolved: deepFreeze(this.resolve(schema, options?.base, this.section(ns), options?.validate)),
			revision: 0,
			watchers: /* @__PURE__ */ new Set()
		};
		this.ctx.effect(() => {
			this.registrations.set(ns, registration);
			return () => this.registrations.delete(ns);
		}, `settings.register(${JSON.stringify(String(ns))})`);
		return {
			get: () => registration.resolved,
			watch: (callback) => {
				const watcher = {
					callback,
					tail: Promise.resolve(),
					active: true
				};
				registration.watchers.add(watcher);
				return () => {
					watcher.active = false;
					registration.watchers.delete(watcher);
				};
			},
			update: (patch) => this.update(ns, patch),
			replace: (section) => this.replace(ns, section)
		};
	}
	/**
	* Describe every registered namespace for configuration surfaces, including
	* the composition `base` and raw user layers so a form can mark which fields
	* the user overrode (presence in `user`) and what a reset returns to.
	* @param options - redaction switch; wire surfaces must redact.
	* @returns one descriptor per registered namespace, in registration order.
	*/
	describe(options) {
		return [...this.registrations.values()].map((registration) => {
			let user;
			try {
				user = this.section(registration.ns);
			} catch {
				user = void 0;
			}
			const base = registration.base === void 0 ? void 0 : structuredClone(registration.base);
			const detachedUser = user === void 0 ? void 0 : structuredClone(user);
			const descriptor = {
				ns: registration.ns,
				schema: registration.schema.toJSON(),
				value: registration.resolved,
				revision: registration.revision,
				...base === void 0 ? {} : { base },
				...detachedUser === void 0 ? {} : { user: detachedUser },
				applies: registration.applies
			};
			if (options?.redactSecrets !== true) return descriptor;
			const schema = registration.schema;
			const redacted = redactSecrets(schema, registration.resolved);
			return {
				...descriptor,
				value: redacted.value,
				...base === void 0 ? {} : { base: redactSecrets(schema, base).value },
				...detachedUser === void 0 ? {} : { user: redactSecrets(schema, detachedUser).value },
				secrets: redacted.secrets
			};
		});
	}
	/**
	* Read one registered namespace's resolved value.
	* @param ns - the namespace to read.
	* @returns the resolved value, or `undefined` while unregistered.
	*/
	get(ns) {
		return this.registrations.get(ns)?.resolved;
	}
	/**
	* Merge a patch into one registered namespace's user layer, validate the
	* resolved candidate, persist through the provider, then commit and emit.
	* A validation failure rejects before anything is persisted. Writes to one
	* namespace are serialized: concurrent updates apply in call order, each
	* merging over the previous write's committed section.
	* @param ns - the registered namespace to update.
	* @param patch - plain-object patch over the user section.
	* @param expectedRevision - the descriptor `revision` the caller read; a
	*   namespace that moved past it rejects with {@link SettingsConflictError}.
	*/
	async update(ns, patch, expectedRevision) {
		return this.write(ns, patch, "merge", expectedRevision);
	}
	/**
	* Replace one registered namespace's user section wholesale, validate,
	* persist, then commit and emit. Keys absent from `section` fall back to the
	* composition `base` and schema defaults — this is the removal/reset path a
	* merge-only patch cannot express (`replace({})` re-inherits everything).
	* @param ns - the registered namespace to replace.
	* @param section - the complete next user section.
	* @param expectedRevision - the descriptor `revision` the caller read; a
	*   namespace that moved past it rejects with {@link SettingsConflictError}.
	*/
	async replace(ns, section, expectedRevision) {
		return this.write(ns, section, "replace", expectedRevision);
	}
	/**
	* Apply path-addressed edits to one registered namespace's user section,
	* validate, persist, then commit and emit. The ops are applied to the
	* section as it stands when the write reaches the front of the queue, so a
	* caller never has to restate fields it did not touch — and, crucially,
	* cannot delete fields it never saw. This is the write path for any caller
	* holding a redacted view; `replace` remains the wholesale reset.
	* @param ns - the registered namespace to edit.
	* @param ops - ordered path edits; later ops observe earlier ones.
	* @param expectedRevision - the descriptor `revision` the caller read; a
	*   namespace that moved past it rejects with {@link SettingsConflictError}.
	*/
	async mutate(ns, ops, expectedRevision) {
		if (!Array.isArray(ops)) throw new TypeError(`settings mutate for "${ns}" must be an array of path ops`);
		for (const op of ops) {
			if (!isPlainObject(op) || op["op"] !== "set" && op["op"] !== "unset") throw new TypeError(`settings mutate for "${ns}" ops must be {op:'set'|'unset', path}`);
			if (!Array.isArray(op["path"]) || op["path"].some((part) => typeof part !== "string")) throw new TypeError(`settings mutate for "${ns}" op paths must be arrays of strings`);
		}
		return this.write(ns, ops, "mutate", expectedRevision);
	}
	/** Validate a write, then queue it on the namespace's serialized write chain. */
	write(ns, input, mode, expectedRevision) {
		const verb = mode === "merge" ? "update" : mode === "replace" ? "replace" : "mutate";
		const registration = this.registrations.get(ns);
		if (registration === void 0) throw new Error(`settings namespace "${ns}" is not registered`);
		if (this.isStopped()) throw new Error(`settings service is disposed: "${ns}" cannot be written`);
		if (!this.writable) throw new Error(`settings provider is read-only: "${ns}" cannot be updated in-process`);
		let payload;
		if (mode === "mutate") payload = { ops: input };
		else {
			if (!isPlainObject(input)) throw new TypeError(`settings ${verb} for "${ns}" must be a plain object`);
			payload = input;
		}
		const snapshot = cloneJsonShaped(payload, (label, path) => /* @__PURE__ */ new TypeError(`settings ${verb} for "${ns}" must contain only JSON-compatible data (found ${label} at ${path})`));
		const run = (this.writeQueues.get(ns) ?? Promise.resolve()).catch(() => void 0).then(async () => {
			if (this.isStopped()) throw new Error(`settings service was disposed before the queued "${ns}" ${verb} ran`);
			if (this.registrations.get(ns) !== registration) throw new Error(`settings namespace "${ns}" registration was disposed before the queued ${verb} ran`);
			const current = this.section(ns) ?? {};
			if (expectedRevision !== void 0 && expectedRevision !== registration.revision) throw new SettingsConflictError(ns, expectedRevision, registration.revision);
			const section = mode === "merge" ? mergeLayers(current, snapshot) : mode === "replace" ? snapshot : snapshot["ops"].reduce(applyPathOp, current);
			const next = deepFreeze(this.resolve(registration.schema, registration.base, section, registration.validate));
			await this.persist(ns, section);
			this.document[ns] = section;
			if (this.registrations.get(ns) === registration && !this.isStopped()) {
				this.bumpRevision(registration, current, section);
				this.commit(registration, next, "update");
			}
		});
		this.writeQueues.set(ns, run);
		return run;
	}
	/**
	* Provider hook: commit a complete raw document observed in storage. Each
	* registered namespace re-resolves; an invalid section keeps that
	* namespace's last good value and warns, other namespaces still commit.
	* @param doc - the detached raw document (unregistered sections preserved).
	* @param source - change origin; defaults to `provider`.
	*/
	publish(doc, source = "provider") {
		const before = /* @__PURE__ */ new Map();
		for (const registration of this.registrations.values()) try {
			before.set(registration.ns, this.section(registration.ns));
		} catch {
			before.set(registration.ns, void 0);
		}
		this.document = doc;
		for (const registration of this.registrations.values()) {
			let next;
			try {
				next = deepFreeze(this.resolve(registration.schema, registration.base, this.section(registration.ns), registration.validate));
			} catch (error) {
				this.ctx.logger.warn("settings: keeping last good \"%s\" after invalid stored section", registration.ns);
				this.ctx.logger.warn(error);
				continue;
			}
			this.bumpRevision(registration, before.get(registration.ns), this.section(registration.ns));
			this.commit(registration, next, source);
		}
	}
	/** Read one namespace's raw user section, rejecting non-object sections. */
	section(ns) {
		const section = this.document[ns];
		if (section === void 0) return void 0;
		if (!isPlainObject(section)) throw new TypeError(`settings section "${ns}" must be an object of keys`);
		return section;
	}
	/** Resolve one namespace value: schema defaults, then `base`, then the user layer. */
	resolve(schema, base, section, validate) {
		const value = schema(mergeLayers(base, section));
		validate?.(value);
		return value;
	}
	/**
	* Advance a namespace's revision when its RAW section changed, and announce
	* it. Deliberately independent of {@link commit}'s resolved-value equality:
	* storing an override equal to the composition base leaves the resolved
	* value alone but changes what the document says, which is exactly what a
	* configuration surface must re-read.
	*/
	bumpRevision(registration, before, after) {
		if (deepEqualJson(before, after)) return;
		registration.revision += 1;
		this.emitDocumentUpdated(registration.ns, registration.revision);
	}
	/** Contained fan-out of `settings/document-updated`, mirroring {@link commit}'s. */
	emitDocumentUpdated(ns, revision) {
		let invariantFailure;
		const args = [
			"settings/document-updated",
			ns,
			revision
		];
		for (const listener of this.ctx.events.dispatch("emit", args)) try {
			const returned = listener(ns, revision);
			if (returned != null && typeof returned.then === "function") Promise.resolve(returned).then(void 0, (error) => {
				this.warnListenerFailure(ns, error);
			});
		} catch (error) {
			if (error?.code === "INVARIANT") {
				invariantFailure ??= error;
				continue;
			}
			this.warnListenerFailure(ns, error);
		}
		if (invariantFailure !== void 0) throw invariantFailure;
	}
	/** Commit a resolved value when changed: swap, notify watchers, emit the event. */
	commit(registration, next, source) {
		const prev = registration.resolved;
		if (deepEqualJson(next, prev)) return;
		registration.resolved = next;
		for (const watcher of [...registration.watchers]) {
			const segment = watcher.tail.then(() => {
				if (!watcher.active || this.isStopped()) return;
				return watcher.callback(next, prev);
			}).then(() => void 0, (error) => {
				this.warnWatcherFailure(registration.ns, error);
			});
			watcher.tail = segment;
			this.pendingTails.add(segment);
			segment.then(() => this.pendingTails.delete(segment));
		}
		let invariantFailure;
		const args = [
			"settings/updated",
			registration.ns,
			next,
			prev,
			source
		];
		for (const listener of this.ctx.events.dispatch("emit", args)) try {
			const returned = listener(registration.ns, next, prev, source);
			if (returned != null && typeof returned.then === "function") Promise.resolve(returned).then(void 0, (error) => {
				this.warnListenerFailure(registration.ns, error);
			});
		} catch (error) {
			if (error?.code === "INVARIANT") {
				invariantFailure ??= error;
				continue;
			}
			this.warnListenerFailure(registration.ns, error);
		}
		if (invariantFailure !== void 0) throw invariantFailure;
	}
	/** Contained-watcher diagnostic shared by the sync and async failure paths. */
	warnWatcherFailure(ns, error) {
		this.ctx.logger.warn("settings: watcher for \"%s\" failed", ns);
		this.ctx.logger.warn(error);
	}
	/** Contained-listener diagnostic shared by the sync and async failure paths. */
	warnListenerFailure(ns, error) {
		this.ctx.logger.warn("settings: a settings/updated listener for \"%s\" failed", ns);
		this.ctx.logger.warn(error);
	}
};
/**
* Value mirror of the `FiberState` members {@link isUnloading} compares
* against: a const enum has no runtime object to import, and the value is
* needed at runtime (same rationale as the CLI boot driver's mirror).
*/
const FIBER_DISPOSED = 4;
const FIBER_UNLOADING = 5;
/** Whether the consumer's own fiber is tearing down (not just losing the settings service). */
function isUnloading(ctx) {
	const state = ctx.fiber.state;
	return state === FIBER_UNLOADING || state === FIBER_DISPOSED;
}
/**
* Install the canonical optional-settings consumer wiring: while a settings
* service exists, register `ns` with the consumer's composition entry as the
* `base` layer and point the source thunk at the resolved scope; when the
* service goes away (disposal, provider reload), fall back to the entry so
* the consumer keeps working exactly as composed. The registration rides the
* scoped fiber, so no settings service ever mounted means none of this runs.
* @param ctx - consumer plugin context owning the wiring.
* @param ns - the consumer-owned settings namespace.
* @param schema - schema resolving the namespace (typically the plugin Config).
* @param entry - the consumer's composition entry config, used as `base`.
* @param hooks - source sink and change notification.
*/
function installSettingsSection(ctx, ns, schema, entry, hooks) {
	ctx.inject(["settings"], (sctx) => {
		const scope = sctx.settings.register(ns, schema, {
			base: entry,
			...hooks.validate === void 0 ? {} : { validate: hooks.validate }
		});
		hooks.setSource(() => scope.get());
		sctx.effect(() => () => {
			if (isUnloading(ctx)) return;
			hooks.setSource(() => entry);
			hooks.onChange();
		});
		hooks.onChange();
		scope.watch(() => {
			if (isUnloading(ctx)) return;
			hooks.onChange();
		});
	});
}
//#endregion
export { SettingsConflictError, SettingsProvider, SettingsProvider as default, deepEqualJson, installSettingsSection, redactSecrets, settingsNamespace };
