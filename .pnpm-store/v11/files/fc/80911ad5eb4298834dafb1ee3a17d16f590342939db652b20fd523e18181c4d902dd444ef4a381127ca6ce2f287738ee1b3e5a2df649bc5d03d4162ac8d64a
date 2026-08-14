window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-runtime",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_cordis = require("@deepseek-ai/cordis");
		let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");
		//#region lib/types/client/slots.js
		/**
		* SlotRegistry: the cordis Service layer of the slot system over the pure
		* SlotCore (ui-slots owns registration semantics, the declaration ledger,
		* the load-time validations, and the unload cascade). This layer owns what
		* needs the runtime: the 'slots/changed' event bridge, register and
		* declaration injection through the caller's ctx.effect (fiber unload
		* collects both), the renderer installation contract (install()/renderSlot('root') +
		* the SlotRendererHost face), and the store INSTANCE axis — handle x scope
		* key -> create/cache, dropped with the last holding entry, session instances
		* cleared (with persisted state) on scope death.
		*/
		/** Instance key for root-scoped store records (session records key by session id, so the literal cannot collide). */
		const ROOT_INSTANCE_KEY = "root";
		/** cordis Service layer of the slot system; see the module doc for the split with SlotCore. */
		var SlotRegistry = class extends _deepseek_ai_cordis.Service {
			_core = new _deepseek_ai_dsh_client_ui_slots.SlotCore();
			/** Store-instance axis: handle -> mounted scope, refcount, resolved instances. */
			_stores = /* @__PURE__ */ new Map();
			_renderer;
			_locale;
			_host;
			/**
			* @param ctx - owning root context.
			*/
			constructor(ctx) {
				super(ctx, "slots");
				this._core.onMutate((key) => {
					ctx.emit("slots/changed", key);
				});
			}
			/**
			* Install an effect for each declaration lifetime of a slot. The callback
			* runs synchronously when the declaration already exists; otherwise it runs
			* inside the declaring `register()` call after the declaration is committed.
			* Collapse disposes the effect and a later declaration runs it again.
			* Callback effects are synchronous disposers; iterable effects install
			* transactionally and dispose in reverse order. The controller belongs to
			* the caller's fiber, so plugin unload cancels a pending wait and removes any
			* active contribution.
			*
			* @param key - declared SlotMap key to depend on.
			* @param callback - creates one disposer or an iterable of disposers.
			* @returns idempotent disposer for the wait and active effect.
			* @throws callback setup failures synchronously when the slot is already declared.
			*/
			inject(key, callback) {
				const ctx = this.ctx;
				const disposeController = ctx.effect(() => {
					let active;
					let activeEpoch;
					let stopped = false;
					let unsubscribe = () => {};
					const stop = () => {
						if (stopped) return;
						stopped = true;
						unsubscribe();
						const dispose = active;
						active = void 0;
						activeEpoch = void 0;
						dispose?.();
					};
					const reconcile = () => {
						if (stopped) return;
						const spec = this._core.specDynamic(key);
						const epoch = this._core.declarationEpoch(key);
						if (active !== void 0 && activeEpoch === epoch) return;
						const dispose = active;
						active = void 0;
						activeEpoch = void 0;
						dispose?.();
						if (spec === void 0) return;
						const disposeEffect = ctx.effect(callback, `slots.inject(${JSON.stringify(key)}): declaration`);
						active = () => {
							disposeEffect();
						};
						activeEpoch = epoch;
					};
					const changed = () => {
						try {
							reconcile();
						} catch (error) {
							if (error?.code === "INACTIVE_EFFECT") {
								stop();
								return;
							}
							stop();
							const failure = error instanceof Error ? error : new Error(String(error));
							queueMicrotask(() => {
								throw failure;
							});
						}
					};
					unsubscribe = this._core.subscribeDeclaration(key, changed);
					try {
						reconcile();
					} catch (error) {
						stop();
						throw error;
					}
					return stop;
				}, `slots.inject(${JSON.stringify(key)})`);
				return () => {
					disposeController();
				};
			}
			/**
			* Install the shell's renderer (web-react's createSlotRenderer product).
			* Boot-once: a second install throws. Runs through the caller's ctx.effect,
			* so shell fiber unload uninstalls the renderer.
			* @param renderer - the outlet machinery implementing SlotRenderer.
			*/
			install(renderer) {
				if (this._renderer !== void 0) throw new Error("slot renderer already installed (install() is boot-once)");
				this.ctx.effect(() => {
					this._renderer = renderer;
					return () => {
						if (this._renderer === renderer) this._renderer = void 0;
					};
				}, "slots.install()");
			}
			/**
			* Install the locale face backing the `t` standard seat (the locale
			* plugin's product; same boot-once discipline as the renderer install).
			* Runs through the caller's ctx.effect, so the installing fiber's unload
			* uninstalls the face.
			* @param face - namespace binder + revision observable.
			*/
			installLocale(face) {
				if (this._locale !== void 0) throw new Error("locale face already installed (installLocale() is boot-once)");
				this.ctx.effect(() => {
					this._locale = face;
					return () => {
						if (this._locale === face) this._locale = void 0;
					};
				}, "slots.installLocale()");
			}
			/**
			* The single ctx-level render entry: the shell renders 'root'; every other
			* key renders inside components through the props renderSlot face. All
			* three guards are fail-loud boot-order checks, no fallback.
			* @param key - must be 'root' (runtime-enforced for dynamically composed callers).
			* @param owner - owner share for the root entry (the shell supplies {}).
			* @returns the rendered root tree.
			*/
			renderSlot(key, owner) {
				if (key !== "root") throw new Error(`ctx-level renderSlot only renders 'root' (got "${key}"); child slots render through the component props face`);
				if (this._renderer === void 0) throw new Error("slot renderer not installed — boot must call ctx.slots.install(createSlotRenderer()) before rendering 'root'");
				if (this._core.entries("root").length === 0) throw new Error("'root' has no registration — a layout entry must register into 'root' before the shell renders it");
				return this._renderer.renderRoot(this.hostFace(), owner);
			}
			/**
			* Drop the per-session store instances of a dead session (the sessions
			* service calls this on scope teardown; root-scoped records are untouched).
			* Persisted state goes with the session — a never-rendered dead session can
			* still own keys from an earlier page load, so the instance is materialized
			* transiently just to clear storage (no-op for unpersisted stores).
			* @param sessionId - the torn-down session.
			*/
			pruneStoreScope(sessionId) {
				for (const [handle, record] of this._stores) {
					if (record.scope !== "session") continue;
					(record.instances.get(sessionId) ?? handle.create(sessionId)).clearPersisted();
					record.instances.delete(sessionId);
				}
			}
			/**
			* Snapshot entries for a key (render-erased view; stable reference between mutations).
			* @param key - SlotMap key.
			* @returns registered entries.
			*/
			entries(key) {
				return this._core.entries(key);
			}
			/**
			* Shadowing winners per cell for a key: the first live (non-abdicated)
			* entry of each cell in priority order — what outlets render; chain keys
			* pass through unchanged (election consumes every entry). The raw
			* {@link SlotsService.entries} view stays the inspection surface. Fresh
			* array per call, not a uSES getSnapshot source.
			* @param key - SlotMap key.
			* @returns the winning entry per occupied cell.
			*/
			entriesOfSlot(key) {
				return this._core.entriesOfSlot(key);
			}
			/**
			* Export the current JSON-safe Slot declaration tree for read-only inspection.
			* @param root - exact live Slot root; omitted returns all roots.
			* @returns selected Slot trees.
			*/
			snapshot(root) {
				return this._core.snapshot(root);
			}
			/**
			* Observe entry boundary crashes (every render-time entry failure the
			* boundaries contain, abdicating or not) — the supervision seam for
			* plugins mirroring contribution health. Fires synchronously per report,
			* after the registry mutated for abdicating crashes. Callers own the
			* disposer (wire it through ctx.effect for fiber-lifetime cleanup, as with
			* {@link SlotsService.subscribe}).
			* @param fn - called with the slot key, the crashed entry, the crash
			* cause, and `abdicated`: whether the crash retired the entry from its cell.
			* @returns unsubscribe.
			*/
			onEntryError(fn) {
				return this._core.onEntryError(fn);
			}
			/**
			* Look up a declared spec (register-declared or the built-in 'root').
			* @param key - SlotMap key.
			* @returns spec or undefined.
			*/
			spec(key) {
				return this._core.spec(key);
			}
			/**
			* Subscribe to a key's registration changes (microtask-batched).
			* @param key - SlotMap key.
			* @param fn - change callback.
			* @returns unsubscribe.
			*/
			subscribe(key, fn) {
				return this._core.subscribe(key, fn);
			}
			/**
			* Version counter for uSES pairing.
			* @param key - SlotMap key.
			* @returns current version.
			*/
			getVersion(key) {
				return this._core.getVersion(key);
			}
			/** Delegating registration path: factory minting + registrant stamp + core write + instance-axis bookkeeping. */
			_register(options, component) {
				const store = typeof options.store === "function" ? options.store() : options.store;
				const registrant = options.registrant ?? this.ctx.fiber?.name;
				const erased = {
					...options,
					...store !== void 0 ? { store } : {},
					...registrant !== void 0 ? { registrant } : {}
				};
				const dispose = this._core.register(erased, component);
				if (store !== void 0) {
					const scope = this._core.specDynamic(options.name).scope;
					this._acquire(store, scope);
				}
				let disposed = false;
				return () => {
					if (disposed) return;
					disposed = true;
					dispose();
					if (store !== void 0) this._release(store);
				};
			}
			/** Build once after both object-layer services mount; per-session provide bundles still resolve lazily. */
			hostFace() {
				if (this._host !== void 0) return this._host;
				const sessions = this.ctx.get("sessions");
				if (sessions === void 0) throw new Error("renderSlot('root') before the sessions service mounted — boot order puts runtime apply first");
				const workspaces = this.ctx.get("workspaces");
				if (workspaces === void 0) throw new Error("renderSlot('root') before the workspaces service mounted — boot order puts runtime apply first");
				const service = this;
				this._host = {
					subscribe: (key, fn) => this._core.subscribe(key, fn),
					getVersion: (key) => this._core.getVersion(key),
					entriesOf: (key) => this._core.entries(key),
					entriesOfSlot: (key) => this._core.entriesOfSlot(key),
					reportEntryError: (key, entry, error, info) => {
						this._core.reportEntryError(key, entry, error, info);
					},
					specOf: (key) => this._core.specDynamic(key),
					isLive: (entry) => this._core.isLive(entry),
					storeOf: (entry, scopeKey) => entry.store === void 0 ? void 0 : this.resolveStore(entry.store, scopeKey),
					sessions: {
						list: sessions.list,
						provideInfo: sessions.currentProvideInfo
					},
					workspaces: { list: workspaces.list },
					get locale() {
						return service._locale;
					}
				};
				return this._host;
			}
			/** Resolve (create or reuse) the store instance for a registered handle under a scope key. */
			resolveStore(handle, sessionId) {
				const record = this._stores.get(handle);
				if (record === void 0) throw new Error("store handle is not registered (entry unloaded, or the handle never went through register)");
				const key = record.scope === "root" ? ROOT_INSTANCE_KEY : sessionId;
				if (key === void 0) throw new Error(`${record.scope} store resolution requires a session id`);
				let instance = record.instances.get(key);
				if (instance === void 0) {
					instance = record.scope === "root" ? handle.create() : handle.create(key);
					record.instances.set(key, instance);
				}
				return instance;
			}
			/** Bind (or re-reference) a handle on the axis; cross-scope conflicts already threw in the core. */
			_acquire(handle, scope) {
				const record = this._stores.get(handle);
				if (record === void 0) {
					this._stores.set(handle, {
						scope,
						refs: 1,
						instances: /* @__PURE__ */ new Map()
					});
					return;
				}
				record.refs += 1;
			}
			/** Drop one reference; the last holder's unload drops the record (instances go with it — engine stores need no explicit dispose). */
			_release(handle) {
				const record = this._stores.get(handle);
				/* v8 ignore next -- defensive: release only runs from a disposer whose
				* register acquired the same handle, so the record must exist; kept so a
				* future call site cannot underflow the axis. */
				if (record === void 0) return;
				record.refs -= 1;
				if (record.refs === 0) this._stores.delete(handle);
			}
		};
		SlotRegistry.prototype.register = function register(rawOptions, component) {
			const options = rawOptions;
			return this.ctx.effect(() => this["_register"](options, component), "slots.register()");
		};
		//#endregion
		//#region ../../host/apiproxy/src/api/rpc.ts
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
		function isPlainObject$1(o) {
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
			if (isPlainObject$1(o)) return { ...o };
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
			if (!isPlainObject$1(shape)) throw new Error("Invalid input to extend: expected a plain object");
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
			if (!isPlainObject$1(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
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
			if (isPlainObject$1(a) && isPlainObject$1(b)) {
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
		function finalize$1(ctx, schema) {
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
			return finalize$1(ctx, schema);
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
			return finalize$1(ctx, schema);
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
		//#region ../../host/apiproxy/src/api/rpc.schema.ts
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
		discriminatedUnion("type", [
			object({
				type: literal("client-request"),
				rpcId: rpcIdSchema,
				method: string(),
				payload: unknown()
			}),
			object({
				type: literal("server-response"),
				rpcId: rpcIdSchema,
				result: rpcResultSchema(unknown().optional())
			}),
			object({
				type: literal("server-request"),
				rpcId: rpcIdSchema,
				method: string(),
				payload: unknown()
			}),
			object({
				type: literal("client-response"),
				rpcId: rpcIdSchema,
				result: rpcResultSchema(unknown().optional())
			})
		]);
		union([object({ accepted: literal(true) }), object({
			accepted: literal(false),
			reason: union([literal("not-pending"), literal("bad-response")])
		})]);
		//#endregion
		//#region ../../../node_modules/.pnpm/zustand@4.4.7_@types+react@18.3.31_immer@10.2.0_react@18.3.1/node_modules/zustand/esm/vanilla.mjs
		const createStoreImpl = (createState) => {
			let state;
			const listeners = /* @__PURE__ */ new Set();
			const setState = (partial, replace) => {
				const nextState = typeof partial === "function" ? partial(state) : partial;
				if (!Object.is(nextState, state)) {
					const previousState = state;
					state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
					listeners.forEach((listener) => listener(state, previousState));
				}
			};
			const getState = () => state;
			const subscribe = (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			};
			const destroy = () => {
				listeners.clear();
			};
			const api = {
				setState,
				getState,
				subscribe,
				destroy
			};
			state = createState(setState, getState, api);
			return api;
		};
		const createStore = (createState) => createState ? createStoreImpl(createState) : createStoreImpl;
		//#endregion
		//#region ../../../node_modules/.pnpm/zustand@4.4.7_@types+react@18.3.31_immer@10.2.0_react@18.3.1/node_modules/zustand/esm/middleware.mjs
		const subscribeWithSelectorImpl = (fn) => (set, get, api) => {
			const origSubscribe = api.subscribe;
			api.subscribe = (selector, optListener, options) => {
				let listener = selector;
				if (optListener) {
					const equalityFn = (options == null ? void 0 : options.equalityFn) || Object.is;
					let currentSlice = selector(api.getState());
					listener = (state) => {
						const nextSlice = selector(state);
						if (!equalityFn(currentSlice, nextSlice)) {
							const previousSlice = currentSlice;
							optListener(currentSlice = nextSlice, previousSlice);
						}
					};
					if (options == null ? void 0 : options.fireImmediately) optListener(currentSlice, currentSlice);
				}
				return origSubscribe(listener);
			};
			return fn(set, get, api);
		};
		const subscribeWithSelector = subscribeWithSelectorImpl;
		//#endregion
		//#region ../../../node_modules/.pnpm/zustand@4.4.7_@types+react@18.3.31_immer@10.2.0_react@18.3.1/node_modules/zustand/esm/shallow.mjs
		function shallow$1(objA, objB) {
			if (Object.is(objA, objB)) return true;
			if (typeof objA !== "object" || objA === null || typeof objB !== "object" || objB === null) return false;
			if (objA instanceof Map && objB instanceof Map) {
				if (objA.size !== objB.size) return false;
				for (const [key, value] of objA) if (!Object.is(value, objB.get(key))) return false;
				return true;
			}
			if (objA instanceof Set && objB instanceof Set) {
				if (objA.size !== objB.size) return false;
				for (const value of objA) if (!objB.has(value)) return false;
				return true;
			}
			const keysA = Object.keys(objA);
			if (keysA.length !== Object.keys(objB).length) return false;
			for (let i = 0; i < keysA.length; i++) if (!Object.prototype.hasOwnProperty.call(objB, keysA[i]) || !Object.is(objA[keysA[i]], objB[keysA[i]])) return false;
			return true;
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/immer@10.2.0/node_modules/immer/dist/immer.mjs
		var NOTHING = Symbol.for("immer-nothing");
		var DRAFTABLE = Symbol.for("immer-draftable");
		var DRAFT_STATE = Symbol.for("immer-state");
		function die(error, ...args) {
			throw new Error(`[Immer] minified error nr: ${error}. Full error at: https://bit.ly/3cXEKWf`);
		}
		var getPrototypeOf = Object.getPrototypeOf;
		function isDraft(value) {
			return !!value && !!value[DRAFT_STATE];
		}
		function isDraftable(value) {
			if (!value) return false;
			return isPlainObject(value) || Array.isArray(value) || !!value[DRAFTABLE] || !!value.constructor?.[DRAFTABLE] || isMap(value) || isSet(value);
		}
		var objectCtorString = Object.prototype.constructor.toString();
		var cachedCtorStrings = /* @__PURE__ */ new WeakMap();
		function isPlainObject(value) {
			if (!value || typeof value !== "object") return false;
			const proto = Object.getPrototypeOf(value);
			if (proto === null || proto === Object.prototype) return true;
			const Ctor = Object.hasOwnProperty.call(proto, "constructor") && proto.constructor;
			if (Ctor === Object) return true;
			if (typeof Ctor !== "function") return false;
			let ctorString = cachedCtorStrings.get(Ctor);
			if (ctorString === void 0) {
				ctorString = Function.toString.call(Ctor);
				cachedCtorStrings.set(Ctor, ctorString);
			}
			return ctorString === objectCtorString;
		}
		function each(obj, iter, strict = true) {
			if (getArchtype(obj) === 0) (strict ? Reflect.ownKeys(obj) : Object.keys(obj)).forEach((key) => {
				iter(key, obj[key], obj);
			});
			else obj.forEach((entry, index) => iter(index, entry, obj));
		}
		function getArchtype(thing) {
			const state = thing[DRAFT_STATE];
			return state ? state.type_ : Array.isArray(thing) ? 1 : isMap(thing) ? 2 : isSet(thing) ? 3 : 0;
		}
		function has(thing, prop) {
			return getArchtype(thing) === 2 ? thing.has(prop) : Object.prototype.hasOwnProperty.call(thing, prop);
		}
		function set(thing, propOrOldValue, value) {
			const t = getArchtype(thing);
			if (t === 2) thing.set(propOrOldValue, value);
			else if (t === 3) thing.add(value);
			else thing[propOrOldValue] = value;
		}
		function is(x, y) {
			if (x === y) return x !== 0 || 1 / x === 1 / y;
			else return x !== x && y !== y;
		}
		function isMap(target) {
			return target instanceof Map;
		}
		function isSet(target) {
			return target instanceof Set;
		}
		function latest(state) {
			return state.copy_ || state.base_;
		}
		function shallowCopy(base, strict) {
			if (isMap(base)) return new Map(base);
			if (isSet(base)) return new Set(base);
			if (Array.isArray(base)) return Array.prototype.slice.call(base);
			const isPlain = isPlainObject(base);
			if (strict === true || strict === "class_only" && !isPlain) {
				const descriptors = Object.getOwnPropertyDescriptors(base);
				delete descriptors[DRAFT_STATE];
				let keys = Reflect.ownKeys(descriptors);
				for (let i = 0; i < keys.length; i++) {
					const key = keys[i];
					const desc = descriptors[key];
					if (desc.writable === false) {
						desc.writable = true;
						desc.configurable = true;
					}
					if (desc.get || desc.set) descriptors[key] = {
						configurable: true,
						writable: true,
						enumerable: desc.enumerable,
						value: base[key]
					};
				}
				return Object.create(getPrototypeOf(base), descriptors);
			} else {
				const proto = getPrototypeOf(base);
				if (proto !== null && isPlain) return { ...base };
				return Object.assign(Object.create(proto), base);
			}
		}
		function freeze(obj, deep = false) {
			if (isFrozen(obj) || isDraft(obj) || !isDraftable(obj)) return obj;
			if (getArchtype(obj) > 1) Object.defineProperties(obj, {
				set: dontMutateMethodOverride,
				add: dontMutateMethodOverride,
				clear: dontMutateMethodOverride,
				delete: dontMutateMethodOverride
			});
			Object.freeze(obj);
			if (deep) Object.values(obj).forEach((value) => freeze(value, true));
			return obj;
		}
		function dontMutateFrozenCollections() {
			die(2);
		}
		var dontMutateMethodOverride = { value: dontMutateFrozenCollections };
		function isFrozen(obj) {
			if (obj === null || typeof obj !== "object") return true;
			return Object.isFrozen(obj);
		}
		var plugins = {};
		function getPlugin(pluginKey) {
			const plugin = plugins[pluginKey];
			if (!plugin) die(0, pluginKey);
			return plugin;
		}
		var currentScope;
		function getCurrentScope() {
			return currentScope;
		}
		function createScope$1(parent_, immer_) {
			return {
				drafts_: [],
				parent_,
				immer_,
				canAutoFreeze_: true,
				unfinalizedDrafts_: 0
			};
		}
		function usePatchesInScope(scope, patchListener) {
			if (patchListener) {
				getPlugin("Patches");
				scope.patches_ = [];
				scope.inversePatches_ = [];
				scope.patchListener_ = patchListener;
			}
		}
		function revokeScope(scope) {
			leaveScope(scope);
			scope.drafts_.forEach(revokeDraft);
			scope.drafts_ = null;
		}
		function leaveScope(scope) {
			if (scope === currentScope) currentScope = scope.parent_;
		}
		function enterScope(immer2) {
			return currentScope = createScope$1(currentScope, immer2);
		}
		function revokeDraft(draft) {
			const state = draft[DRAFT_STATE];
			if (state.type_ === 0 || state.type_ === 1) state.revoke_();
			else state.revoked_ = true;
		}
		function processResult(result, scope) {
			scope.unfinalizedDrafts_ = scope.drafts_.length;
			const baseDraft = scope.drafts_[0];
			if (result !== void 0 && result !== baseDraft) {
				if (baseDraft[DRAFT_STATE].modified_) {
					revokeScope(scope);
					die(4);
				}
				if (isDraftable(result)) {
					result = finalize(scope, result);
					if (!scope.parent_) maybeFreeze(scope, result);
				}
				if (scope.patches_) getPlugin("Patches").generateReplacementPatches_(baseDraft[DRAFT_STATE].base_, result, scope.patches_, scope.inversePatches_);
			} else result = finalize(scope, baseDraft, []);
			revokeScope(scope);
			if (scope.patches_) scope.patchListener_(scope.patches_, scope.inversePatches_);
			return result !== NOTHING ? result : void 0;
		}
		function finalize(rootScope, value, path) {
			if (isFrozen(value)) return value;
			const useStrictIteration = rootScope.immer_.shouldUseStrictIteration();
			const state = value[DRAFT_STATE];
			if (!state) {
				each(value, (key, childValue) => finalizeProperty(rootScope, state, value, key, childValue, path), useStrictIteration);
				return value;
			}
			if (state.scope_ !== rootScope) return value;
			if (!state.modified_) {
				maybeFreeze(rootScope, state.base_, true);
				return state.base_;
			}
			if (!state.finalized_) {
				state.finalized_ = true;
				state.scope_.unfinalizedDrafts_--;
				const result = state.copy_;
				let resultEach = result;
				let isSet2 = false;
				if (state.type_ === 3) {
					resultEach = new Set(result);
					result.clear();
					isSet2 = true;
				}
				each(resultEach, (key, childValue) => finalizeProperty(rootScope, state, result, key, childValue, path, isSet2), useStrictIteration);
				maybeFreeze(rootScope, result, false);
				if (path && rootScope.patches_) getPlugin("Patches").generatePatches_(state, path, rootScope.patches_, rootScope.inversePatches_);
			}
			return state.copy_;
		}
		function finalizeProperty(rootScope, parentState, targetObject, prop, childValue, rootPath, targetIsSet) {
			if (childValue == null) return;
			if (typeof childValue !== "object" && !targetIsSet) return;
			const childIsFrozen = isFrozen(childValue);
			if (childIsFrozen && !targetIsSet) return;
			if (isDraft(childValue)) {
				const res = finalize(rootScope, childValue, rootPath && parentState && parentState.type_ !== 3 && !has(parentState.assigned_, prop) ? rootPath.concat(prop) : void 0);
				set(targetObject, prop, res);
				if (isDraft(res)) rootScope.canAutoFreeze_ = false;
				else return;
			} else if (targetIsSet) targetObject.add(childValue);
			if (isDraftable(childValue) && !childIsFrozen) {
				if (!rootScope.immer_.autoFreeze_ && rootScope.unfinalizedDrafts_ < 1) return;
				if (parentState && parentState.base_ && parentState.base_[prop] === childValue && childIsFrozen) return;
				finalize(rootScope, childValue);
				if ((!parentState || !parentState.scope_.parent_) && typeof prop !== "symbol" && (isMap(targetObject) ? targetObject.has(prop) : Object.prototype.propertyIsEnumerable.call(targetObject, prop))) maybeFreeze(rootScope, childValue);
			}
		}
		function maybeFreeze(scope, value, deep = false) {
			if (!scope.parent_ && scope.immer_.autoFreeze_ && scope.canAutoFreeze_) freeze(value, deep);
		}
		function createProxyProxy(base, parent) {
			const isArray = Array.isArray(base);
			const state = {
				type_: isArray ? 1 : 0,
				scope_: parent ? parent.scope_ : getCurrentScope(),
				modified_: false,
				finalized_: false,
				assigned_: {},
				parent_: parent,
				base_: base,
				draft_: null,
				copy_: null,
				revoke_: null,
				isManual_: false
			};
			let target = state;
			let traps = objectTraps;
			if (isArray) {
				target = [state];
				traps = arrayTraps;
			}
			const { revoke, proxy } = Proxy.revocable(target, traps);
			state.draft_ = proxy;
			state.revoke_ = revoke;
			return proxy;
		}
		var objectTraps = {
			get(state, prop) {
				if (prop === DRAFT_STATE) return state;
				const source = latest(state);
				if (!has(source, prop)) return readPropFromProto(state, source, prop);
				const value = source[prop];
				if (state.finalized_ || !isDraftable(value)) return value;
				if (value === peek(state.base_, prop)) {
					prepareCopy(state);
					return state.copy_[prop] = createProxy(value, state);
				}
				return value;
			},
			has(state, prop) {
				return prop in latest(state);
			},
			ownKeys(state) {
				return Reflect.ownKeys(latest(state));
			},
			set(state, prop, value) {
				const desc = getDescriptorFromProto(latest(state), prop);
				if (desc?.set) {
					desc.set.call(state.draft_, value);
					return true;
				}
				if (!state.modified_) {
					const current2 = peek(latest(state), prop);
					const currentState = current2?.[DRAFT_STATE];
					if (currentState && currentState.base_ === value) {
						state.copy_[prop] = value;
						state.assigned_[prop] = false;
						return true;
					}
					if (is(value, current2) && (value !== void 0 || has(state.base_, prop))) return true;
					prepareCopy(state);
					markChanged(state);
				}
				if (state.copy_[prop] === value && (value !== void 0 || prop in state.copy_) || Number.isNaN(value) && Number.isNaN(state.copy_[prop])) return true;
				state.copy_[prop] = value;
				state.assigned_[prop] = true;
				return true;
			},
			deleteProperty(state, prop) {
				if (peek(state.base_, prop) !== void 0 || prop in state.base_) {
					state.assigned_[prop] = false;
					prepareCopy(state);
					markChanged(state);
				} else delete state.assigned_[prop];
				if (state.copy_) delete state.copy_[prop];
				return true;
			},
			getOwnPropertyDescriptor(state, prop) {
				const owner = latest(state);
				const desc = Reflect.getOwnPropertyDescriptor(owner, prop);
				if (!desc) return desc;
				return {
					writable: true,
					configurable: state.type_ !== 1 || prop !== "length",
					enumerable: desc.enumerable,
					value: owner[prop]
				};
			},
			defineProperty() {
				die(11);
			},
			getPrototypeOf(state) {
				return getPrototypeOf(state.base_);
			},
			setPrototypeOf() {
				die(12);
			}
		};
		var arrayTraps = {};
		each(objectTraps, (key, fn) => {
			arrayTraps[key] = function() {
				arguments[0] = arguments[0][0];
				return fn.apply(this, arguments);
			};
		});
		arrayTraps.deleteProperty = function(state, prop) {
			return arrayTraps.set.call(this, state, prop, void 0);
		};
		arrayTraps.set = function(state, prop, value) {
			return objectTraps.set.call(this, state[0], prop, value, state[0]);
		};
		function peek(draft, prop) {
			const state = draft[DRAFT_STATE];
			return (state ? latest(state) : draft)[prop];
		}
		function readPropFromProto(state, source, prop) {
			const desc = getDescriptorFromProto(source, prop);
			return desc ? `value` in desc ? desc.value : desc.get?.call(state.draft_) : void 0;
		}
		function getDescriptorFromProto(source, prop) {
			if (!(prop in source)) return void 0;
			let proto = getPrototypeOf(source);
			while (proto) {
				const desc = Object.getOwnPropertyDescriptor(proto, prop);
				if (desc) return desc;
				proto = getPrototypeOf(proto);
			}
		}
		function markChanged(state) {
			if (!state.modified_) {
				state.modified_ = true;
				if (state.parent_) markChanged(state.parent_);
			}
		}
		function prepareCopy(state) {
			if (!state.copy_) state.copy_ = shallowCopy(state.base_, state.scope_.immer_.useStrictShallowCopy_);
		}
		var Immer2 = class {
			constructor(config) {
				this.autoFreeze_ = true;
				this.useStrictShallowCopy_ = false;
				this.useStrictIteration_ = true;
				/**
				* The `produce` function takes a value and a "recipe function" (whose
				* return value often depends on the base state). The recipe function is
				* free to mutate its first argument however it wants. All mutations are
				* only ever applied to a __copy__ of the base state.
				*
				* Pass only a function to create a "curried producer" which relieves you
				* from passing the recipe function every time.
				*
				* Only plain objects and arrays are made mutable. All other objects are
				* considered uncopyable.
				*
				* Note: This function is __bound__ to its `Immer` instance.
				*
				* @param {any} base - the initial state
				* @param {Function} recipe - function that receives a proxy of the base state as first argument and which can be freely modified
				* @param {Function} patchListener - optional function that will be called with all the patches produced here
				* @returns {any} a new state, or the initial state if nothing was modified
				*/
				this.produce = (base, recipe, patchListener) => {
					if (typeof base === "function" && typeof recipe !== "function") {
						const defaultBase = recipe;
						recipe = base;
						const self = this;
						return function curriedProduce(base2 = defaultBase, ...args) {
							return self.produce(base2, (draft) => recipe.call(this, draft, ...args));
						};
					}
					if (typeof recipe !== "function") die(6);
					if (patchListener !== void 0 && typeof patchListener !== "function") die(7);
					let result;
					if (isDraftable(base)) {
						const scope = enterScope(this);
						const proxy = createProxy(base, void 0);
						let hasError = true;
						try {
							result = recipe(proxy);
							hasError = false;
						} finally {
							if (hasError) revokeScope(scope);
							else leaveScope(scope);
						}
						usePatchesInScope(scope, patchListener);
						return processResult(result, scope);
					} else if (!base || typeof base !== "object") {
						result = recipe(base);
						if (result === void 0) result = base;
						if (result === NOTHING) result = void 0;
						if (this.autoFreeze_) freeze(result, true);
						if (patchListener) {
							const p = [];
							const ip = [];
							getPlugin("Patches").generateReplacementPatches_(base, result, p, ip);
							patchListener(p, ip);
						}
						return result;
					} else die(1, base);
				};
				this.produceWithPatches = (base, recipe) => {
					if (typeof base === "function") return (state, ...args) => this.produceWithPatches(state, (draft) => base(draft, ...args));
					let patches, inversePatches;
					return [
						this.produce(base, recipe, (p, ip) => {
							patches = p;
							inversePatches = ip;
						}),
						patches,
						inversePatches
					];
				};
				if (typeof config?.autoFreeze === "boolean") this.setAutoFreeze(config.autoFreeze);
				if (typeof config?.useStrictShallowCopy === "boolean") this.setUseStrictShallowCopy(config.useStrictShallowCopy);
				if (typeof config?.useStrictIteration === "boolean") this.setUseStrictIteration(config.useStrictIteration);
			}
			createDraft(base) {
				if (!isDraftable(base)) die(8);
				if (isDraft(base)) base = current(base);
				const scope = enterScope(this);
				const proxy = createProxy(base, void 0);
				proxy[DRAFT_STATE].isManual_ = true;
				leaveScope(scope);
				return proxy;
			}
			finishDraft(draft, patchListener) {
				const state = draft && draft[DRAFT_STATE];
				if (!state || !state.isManual_) die(9);
				const { scope_: scope } = state;
				usePatchesInScope(scope, patchListener);
				return processResult(void 0, scope);
			}
			/**
			* Pass true to automatically freeze all copies created by Immer.
			*
			* By default, auto-freezing is enabled.
			*/
			setAutoFreeze(value) {
				this.autoFreeze_ = value;
			}
			/**
			* Pass true to enable strict shallow copy.
			*
			* By default, immer does not copy the object descriptors such as getter, setter and non-enumrable properties.
			*/
			setUseStrictShallowCopy(value) {
				this.useStrictShallowCopy_ = value;
			}
			/**
			* Pass false to use faster iteration that skips non-enumerable properties
			* but still handles symbols for compatibility.
			*
			* By default, strict iteration is enabled (includes all own properties).
			*/
			setUseStrictIteration(value) {
				this.useStrictIteration_ = value;
			}
			shouldUseStrictIteration() {
				return this.useStrictIteration_;
			}
			applyPatches(base, patches) {
				let i;
				for (i = patches.length - 1; i >= 0; i--) {
					const patch = patches[i];
					if (patch.path.length === 0 && patch.op === "replace") {
						base = patch.value;
						break;
					}
				}
				if (i > -1) patches = patches.slice(i + 1);
				const applyPatchesImpl = getPlugin("Patches").applyPatches_;
				if (isDraft(base)) return applyPatchesImpl(base, patches);
				return this.produce(base, (draft) => applyPatchesImpl(draft, patches));
			}
		};
		function createProxy(value, parent) {
			const draft = isMap(value) ? getPlugin("MapSet").proxyMap_(value, parent) : isSet(value) ? getPlugin("MapSet").proxySet_(value, parent) : createProxyProxy(value, parent);
			(parent ? parent.scope_ : getCurrentScope()).drafts_.push(draft);
			return draft;
		}
		function current(value) {
			if (!isDraft(value)) die(10, value);
			return currentImpl(value);
		}
		function currentImpl(value) {
			if (!isDraftable(value) || isFrozen(value)) return value;
			const state = value[DRAFT_STATE];
			let copy;
			let strict = true;
			if (state) {
				if (!state.modified_) return state.base_;
				state.finalized_ = true;
				copy = shallowCopy(value, state.scope_.immer_.useStrictShallowCopy_);
				strict = state.scope_.immer_.shouldUseStrictIteration();
			} else copy = shallowCopy(value, true);
			each(copy, (key, childValue) => {
				set(copy, key, currentImpl(childValue));
			}, strict);
			if (state) state.finalized_ = false;
			return copy;
		}
		var produce = new Immer2().produce;
		//#endregion
		//#region lib/types/client/contract/store.js
		/**
		* Snapshot store engine (zustand vanilla + immer + subscribeWithSelector +
		* rafFlush middleware + opt-in persist + dev freeze) plus the declarative
		* shell over it: {@link defineStore} bakes an init/persist/actions literal
		* into a {@link StoreHandle}, the registration-side store seat of slot
		* terminals. Lives in the React-free runtime (the data layer owns its
		* engine; web-react is shell-only React
		* glue): engine products are bare observables — subscribe/getSnapshot/
		* update/set, NO selector hook. Hook synthesis is web-react's (the one
		* uSES bridge, cached per source at the binding site).
		*/
		/**
		* Shallow equality for selector slices (zustand/shallow semantics; travels
		* with the engine so hook consumers need no zustand dependency).
		* @param a - left value.
		* @param b - right value.
		* @returns whether the values are shallowly equal.
		*/
		function shallowEqual(a, b) {
			return shallow$1(a, b);
		}
		/** Batches subscriber notification into one flush per animation frame. */
		function rafBatch(notify) {
			const schedule = typeof requestAnimationFrame === "function" ? (fn) => {
				requestAnimationFrame(() => {
					fn();
				});
			} : (fn) => {
				queueMicrotask(fn);
			};
			let scheduled = false;
			return () => {
				if (scheduled) return;
				scheduled = true;
				schedule(() => {
					scheduled = false;
					notify();
				});
			};
		}
		/**
		* Create a snapshot store.
		*
		* Flush default is 'sync' (controlled inputs need same-tick echo); frame-driven
		* stores opt into 'raf', where a frame's worth of updates coalesces into one
		* notification. Known raf-mode tradeoff: a component mounting mid-frame reads
		* fresh state while existing subscribers hear it next flush — transient
		* frame-level skew, same nature as the object layer's microtask batching.
		*
		* @param init - initial state.
		* @param opts - flush mode and opt-in persistence (localStorage, keyed by name).
		* @returns the store.
		*/
		function createSnapshotStore(init, opts) {
			const withSelector = subscribeWithSelector(() => init);
			const api = createStore()(withSelector);
			if (opts?.persist) attachPersistence(api, opts.persist.name);
			let subscribe = (fn) => api.subscribe(fn);
			if (opts?.flush === "raf") {
				const listeners = /* @__PURE__ */ new Set();
				const flush = rafBatch(() => {
					for (const fn of [...listeners]) fn();
				});
				api.subscribe(flush);
				subscribe = (fn) => {
					listeners.add(fn);
					return () => {
						listeners.delete(fn);
					};
				};
			}
			return {
				getSnapshot: () => api.getState(),
				subscribe: (fn) => subscribe(fn),
				update: (mutator) => {
					api.setState(produce(api.getState(), (draft) => {
						mutator(draft);
					}), true);
				},
				set: (next) => {
					api.setState(devFreeze(next), true);
				}
			};
		}
		/**
		* Whole-value JSON persistence to localStorage. Hand-rolled instead of the
		* zustand persist middleware: its write path spreads state into an object
		* (`partialize({ ...get() })`), exploding primitive state (a persisted string
		* draft becomes {0:'h',1:'e',...}) — not fixable via merge/deserialize options
		* because the corruption happens before serialization. Storage failures
		* (quota, private mode) only disable persistence, never break the store.
		*/
		function attachPersistence(api, name) {
			if (typeof localStorage === "undefined") return;
			try {
				const raw = localStorage.getItem(name);
				if (raw !== null) api.setState(devFreeze(JSON.parse(raw)), true);
			} catch (error) {
				console.error(`snapshot store '${name}' rehydration failed:`, error);
			}
			api.subscribe((state) => {
				try {
					localStorage.setItem(name, JSON.stringify(state));
				} catch (error) {
					console.error(`snapshot store '${name}' persistence failed:`, error);
				}
			});
		}
		/** Deep-freeze wholesale-set state outside production: set() bypasses immer's freeze. */
		function devFreeze(value) {
			return value;
		}
		/**
		* Declare a store: initial state, optional persistence, and the full write
		* set as pure draft mutators. The returned handle is the registration
		* currency of the store seat — its identity keys instance sharing. Satisfies
		* ui-slots' DefineStore contract (the handle/instance are the engine-extended
		* subtypes).
		*
		* The `A & ActionsDecl<T>` actions position is load-bearing: T resolves from
		* `init` in the first inference round, and the intersection then contextually
		* types each mutator's draft parameter (context-sensitive functions defer),
		* so call sites write `(d, x: X) => { ... }` with no draft annotation. If a
		* future TS version breaks this single-literal inference, the design's
		* documented fallback is currying (`defineStore(init).actions({...})`).
		* @param decl - init lambda (fresh state per instance), optional persist key, actions table.
		* @returns the store handle.
		*/
		function defineStore(decl) {
			return {
				spec: decl,
				create(scopeKey) {
					const persistKey = decl.persist === void 0 ? void 0 : scopeKey === void 0 ? decl.persist : `${decl.persist}.${scopeKey}`;
					const store = createSnapshotStore(decl.init(), persistKey !== void 0 ? { persist: { name: persistKey } } : void 0);
					const actions = {};
					for (const key of Object.keys(decl.actions)) {
						const mutate = decl.actions[key];
						actions[key] = (...params) => {
							store.update((draft) => {
								mutate(draft, ...params);
							});
						};
					}
					return {
						actions,
						getSnapshot: () => store.getSnapshot(),
						subscribe: (fn) => store.subscribe(fn),
						store,
						clearPersisted: () => {
							if (persistKey === void 0 || typeof localStorage === "undefined") return;
							try {
								localStorage.removeItem(persistKey);
							} catch {}
						}
					};
				}
			};
		}
		//#endregion
		//#region lib/types/client/agents/scope.js
		/**
		* Client Agent-scope primitive: mint a Cordis context tagged with the owning
		* Agent's identity. The mechanism mirrors the host `dsh-scope` architecture
		* (no-op plugin fiber + context tag + `Context.filter` routing predicate);
		* the shape deliberately diverges: the filter lives on the actx itself
		* instead of a separate carrier object, so scoped dispatch is plain cordis —
		* `actx.bail(actx, event, payload)` / `actx.emit(actx, ...)` — with no
		* wrapper. The host needs a detached carrier because its dispatch subject is
		* the business Agent object; client scope events carry only ids, so the
		* actx is the natural subject. The second divergence stands: the scope key
		* is the branded `SessionId` (value compared), not an object identity — the
		* agent and its session share one id (1:1, same axis; no separate AgentId
		* brand), and a client scope's identity IS that wire id. Third divergence,
		* deliberate: the client scopes the Agent IDENTITY, not a live Agent object
		* — a cold session's host Agent is already disposed while its client actx
		* stays alive for history viewing.
		*/
		/** Context tag written by {@link createScope}. */
		const kScope = Symbol("dsh.client.scope");
		/** Shared no-op plugin backing each Agent scope fiber. */
		function agentScope() {}
		/**
		* Mint an Agent scope under `ctx`: a no-op plugin fiber whose context
		* carries the agent tag and the dispatch filter — untagged listeners are
		* admitted globally, tagged listeners only for a matching agent.
		* Registrations through the returned ctx dispose with the fiber.
		* @param ctx - client root context the scope fiber mounts under.
		* @param key - owning agent identity (the routing tag; agent id === session id).
		* @returns the tagged context and its backing fiber.
		*/
		function createScope(ctx, key) {
			const fiber = ctx.plugin(agentScope);
			return {
				fiber,
				ctx: fiber.ctx.extend({
					[kScope]: key,
					[_deepseek_ai_cordis.Context.filter](listenerCtx) {
						const tag = scopeOf(listenerCtx);
						return tag === void 0 || tag === key;
					}
				})
			};
		}
		/**
		* Read the nearest agent tag inherited by a context.
		* @param ctx - any client context.
		* @returns its agent identity (the session id), or undefined for root contexts.
		*/
		function scopeOf(ctx) {
			return ctx[kScope];
		}
		//#endregion
		//#region lib/types/client/ordered-baseline.js
		/**
		* Merge an authoritative baseline without moving identities already visible to
		* the client. Baseline-only identities are inserted relative to the nearest
		* following known identity; identities absent from the baseline are removed.
		*
		* @param current - the established client order.
		* @param baseline - the latest authoritative rows.
		* @param keyOf - stable identity selector.
		* @returns baseline-valued rows with the established relative order retained.
		*/
		function mergeOrderedBaseline(current, baseline, keyOf) {
			const baselineByKey = /* @__PURE__ */ new Map();
			for (const value of baseline) baselineByKey.set(keyOf(value), value);
			const merged = current.map((value) => baselineByKey.get(keyOf(value))).filter((value) => value !== void 0);
			const mergedKeys = new Set(merged.map(keyOf));
			for (let index = 0; index < baseline.length; index++) {
				const value = baseline[index];
				/* v8 ignore next -- dense-array guard: index is bounded by baseline.length. */
				if (value === void 0 || mergedKeys.has(keyOf(value))) continue;
				let insertion = merged.length;
				for (let following = index + 1; following < baseline.length; following++) {
					const candidate = baseline[following];
					/* v8 ignore next -- dense-array guard: following is bounded by baseline.length. */
					if (candidate === void 0) continue;
					const known = merged.findIndex((item) => keyOf(item) === keyOf(candidate));
					if (known !== -1) {
						insertion = known;
						break;
					}
				}
				merged.splice(insertion, 0, value);
				mergedKeys.add(keyOf(value));
			}
			return merged;
		}
		//#endregion
		//#region lib/types/client/sessions/lineage.js
		/**
		* Summaries -> flat list with lineage indentation. Root and sibling order
		* follows the established input order; this projection never re-sorts a
		* hydrated list from mutable timestamps.
		* @param summaries - the host's session.list items.
		* @param pendingInteractions - current manager-owned interaction status by session.
		* @param completed - sessions with a pending completion reminder (manager-owned live fact; absent = false).
		* @returns display rows in render order.
		*/
		function flattenLineage(summaries, pendingInteractions, completed) {
			const byId = /* @__PURE__ */ new Map();
			for (const s of summaries) byId.set(s.sessionId, s);
			const children = /* @__PURE__ */ new Map();
			const roots = [];
			for (const s of summaries) if (s.parentSessionId !== void 0 && byId.has(s.parentSessionId)) {
				const list = children.get(s.parentSessionId) ?? [];
				list.push(s);
				children.set(s.parentSessionId, list);
			} else roots.push(s);
			const out = [];
			const visited = /* @__PURE__ */ new Set();
			const walk = (s, depth) => {
				if (visited.has(s.sessionId)) {
					console.warn(`[web-runtime] lineage cycle at ${s.sessionId}; emitting as root`);
					return;
				}
				visited.add(s.sessionId);
				const pendingInteraction = pendingInteractions?.get(s.sessionId);
				out.push({
					...s,
					...pendingInteraction === void 0 ? {} : { pendingInteraction },
					completed: completed?.has(s.sessionId) ?? false,
					depth
				});
				const kids = children.get(s.sessionId);
				if (kids === void 0) return;
				for (const kid of kids) walk(kid, depth + 1);
			};
			for (const root of roots) walk(root, 0);
			for (const s of summaries) if (!visited.has(s.sessionId)) walk(s, 0);
			return out;
		}
		//#endregion
		//#region lib/types/client/sessions/notifier.js
		/** Subscription + batched notification primitive (shared by Session and SessionManager). */
		var Notifier = class {
			rebuild;
			listeners = /* @__PURE__ */ new Set();
			dirty = false;
			notifyPending = false;
			scheduled = "none";
			scheduleGeneration = 0;
			/** @param rebuild - snapshot rebuild function injected by the owner (writes the owner's snapshotCache). */
			constructor(rebuild) {
				this.rebuild = rebuild;
			}
			/**
			* uSES subscription entry.
			* @param listener - change callback.
			* @returns the unsubscribe function.
			*/
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			/** State-change entry: mark dirty and schedule the batched flush. */
			markDirty() {
				this.dirty = true;
				this.notifyPending = true;
				if (this.scheduled === "microtask") return;
				this.schedule("microtask");
			}
			/** Stream-change entry: mark dirty and publish the cumulative state at most once per frame. */
			markFrameDirty() {
				this.dirty = true;
				this.notifyPending = true;
				if (this.scheduled !== "none") return;
				this.schedule(typeof globalThis.requestAnimationFrame === "function" ? "frame" : "microtask");
			}
			/**
			* Synchronous flush: controlled-input writes must notify in the same tick as
			* onChange, or React rolls the DOM back to the stale value and the caret jumps to the end.
			*/
			notifyNow() {
				this.dirty = true;
				this.notifyPending = true;
				this.invalidateSchedule();
				this.flush();
			}
			/**
			* Pre-getSnapshot check: rebuild synchronously when dirty (read path
			* before first subscribe / while unobserved). Notification stays pending.
			*/
			ensureFresh() {
				if (!this.dirty) return;
				this.dirty = false;
				this.rebuild();
			}
			schedule(kind) {
				const generation = ++this.scheduleGeneration;
				this.scheduled = kind;
				const publish = () => {
					if (generation !== this.scheduleGeneration) return;
					this.scheduled = "none";
					this.flush();
				};
				if (kind === "frame") globalThis.requestAnimationFrame(publish);
				else queueMicrotask(publish);
			}
			invalidateSchedule() {
				this.scheduleGeneration++;
				this.scheduled = "none";
			}
			flush() {
				if (!this.notifyPending) return;
				if (this.listeners.size === 0) return;
				this.notifyPending = false;
				if (this.dirty) {
					this.dirty = false;
					this.rebuild();
				}
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region lib/types/client/sessions/projection-store.js
		/**
		* One session's projection values. Framework semantics, uniform across every
		* key: a baseline seeds rows at its cut, a push frame updates one row, and in
		* both paths a lower-or-equal seq loses — a replayed frame cannot regress a
		* value, a stale baseline cannot overwrite a newer frame. A key the store has
		* never seen reads `undefined` (capability absent). Faces are identity-stable
		* per key (create-on-demand, cached) so the React side binds each exactly
		* once; the store-level channel (`subscribeAny`) serves coarse consumers (the
		* manager's list projection reads the `title` key).
		*/
		var ProjectionValueStore = class {
			rows = /* @__PURE__ */ new Map();
			channels = /* @__PURE__ */ new Map();
			valuesCache;
			/** Coarse any-key channel (no snapshot cache to rebuild: reads hit rows directly). */
			anyNotifier = new Notifier(() => {});
			/**
			* Key-addressed bare observable face (the useProjection resolution path).
			* Always defined — absence is an `undefined` snapshot, never a missing
			* face, so a component may subscribe before the key ever carries a value.
			* @param key - projection key.
			* @returns the identity-stable face for this key.
			*/
			faceOf(key) {
				return this.channel(key).face;
			}
			/**
			* Current whole value for a key (erased framework read; typed reads go
			* through `useProjection`'s map lookup).
			* @param key - projection key.
			* @returns the value, or undefined while the key is absent.
			*/
			get(key) {
				return this.rows.get(key)?.value;
			}
			/**
			* Read every current projection value as one reference-stable snapshot.
			* @returns The same frozen value map until a row changes.
			*/
			values() {
				if (this.valuesCache === void 0) this.valuesCache = Object.freeze(Object.fromEntries([...this.rows].map(([key, row]) => [key, row.value])));
				return this.valuesCache;
			}
			/**
			* Subscribe to any-key changes (microtask-batched) — the manager's list
			* rebuild channel.
			* @param listener - change callback.
			* @returns the unsubscribe function.
			*/
			subscribeAny(listener) {
				return this.anyNotifier.subscribe(listener);
			}
			/**
			* Apply one finished value (the `session/projection` push-frame path).
			* @param key - projection key.
			* @param value - whole value computed by the host unit.
			* @param seq - the unit's watermark at emission.
			*/
			apply(key, value, seq) {
				const row = this.rows.get(key);
				if (row !== void 0 && seq <= row.seq) return;
				this.rows.set(key, {
					value,
					seq
				});
				this.changed(key);
			}
			/**
			* Seed from a history tail page's projections block: every carried key
			* lands under the same seq rule as frames; a key the block omits is
			* capability-absent as of the cut — its row clears unless a newer frame
			* already superseded the cut (a stale baseline can neither overwrite nor
			* clear newer values).
			* @param baseline - the response's projections block.
			*/
			seed(baseline) {
				const values = baseline.values;
				for (const key of Object.keys(values)) this.apply(key, values[key], baseline.asOfSeq);
				for (const [key, row] of this.rows) {
					if (Object.hasOwn(values, key)) continue;
					if (row.seq > baseline.asOfSeq) continue;
					this.rows.delete(key);
					this.changed(key);
				}
			}
			/**
			* Drop rows past a mux-generation baseline (`session/subscribed.lastSeq`):
			* a row claiming knowledge beyond the host's own durable baseline rode
			* state a restart lost — under last-wins it would wrongly outrank the
			* host's recomputed (lower-seq) values forever. Durable replay and the next
			* baseline re-seed whatever truly survived (the title-snapshot precedent,
			* generalized).
			* @param lastSeq - the subscribed frame's durable baseline seq.
			*/
			truncate(lastSeq) {
				for (const [key, row] of this.rows) {
					if (row.seq <= lastSeq) continue;
					this.rows.delete(key);
					this.changed(key);
				}
			}
			changed(key) {
				this.valuesCache = void 0;
				this.channels.get(key)?.notifier.markDirty();
				this.anyNotifier.markDirty();
			}
			channel(key) {
				let channel = this.channels.get(key);
				if (channel === void 0) {
					const notifier = new Notifier(() => {});
					channel = {
						notifier,
						face: {
							getSnapshot: () => this.rows.get(key)?.value,
							subscribe: (listener) => notifier.subscribe(listener)
						}
					};
					this.channels.set(key, channel);
				}
				return channel;
			}
		};
		//#endregion
		//#region lib/types/client/contract/conversation.js
		/**
		* Build a stable collision-free key for one Definition-local business identity.
		* @param kind - Definition kind.
		* @param id - Definition-local business identity.
		* @returns engine-owned Context key.
		*/
		function conversationContextKey(kind, id) {
			return `${kind.length}:${kind}${id}`;
		}
		//#endregion
		//#region lib/types/client/sessions/conversation-location-index.js
		var MutableLocationDataStore = class {
			entries = /* @__PURE__ */ new Map();
			get(key) {
				return this.entries.get(key)?.value;
			}
			remove(owner, key) {
				if (this.entries.get(key)?.owner !== owner) return false;
				this.entries.delete(key);
				return true;
			}
			set(owner, key, value) {
				const current = this.entries.get(key);
				if (current !== void 0 && current.owner !== owner) throw new Error(`conversation Location data "${key}" is already owned by ${current.owner}`);
				if (current?.value === value) return false;
				this.entries.set(key, {
					owner,
					value
				});
				return true;
			}
			replace(entries) {
				let changed = this.entries.size !== entries.size;
				if (!changed) for (const [key, value] of entries) {
					const current = this.entries.get(key);
					if (current?.owner !== value.owner || current.value !== value.value) {
						changed = true;
						break;
					}
				}
				if (changed) this.entries = new Map(entries);
				return changed;
			}
		};
		const SESSION_LOCATION = { kind: "session" };
		const UNRESOLVED_LOCATION = { kind: "unresolved" };
		function payloadCoordinates(event) {
			const data = event.data;
			if (data.turn === null) return { session: true };
			const turn = Number.isSafeInteger(data.turn) && data.turn >= 0 ? data.turn : void 0;
			const step = Number.isSafeInteger(data.step) && data.step >= 0 ? data.step : void 0;
			return {
				...turn === void 0 ? {} : { turn },
				...step === void 0 ? {} : { step }
			};
		}
		function sameReferences(left, right) {
			return left.length === right.length && left.every((value, index) => value === right[index]);
		}
		function sameStep(left, right) {
			return left !== void 0 && left.start === right.start && left.end === right.end && left.status === right.status && left.data === right.data;
		}
		function sameTurn(left, right) {
			return left !== void 0 && left.start === right.start && left.end === right.end && left.status === right.status && left.data === right.data && sameReferences(left.steps, right.steps);
		}
		function sameLocation(left, right) {
			if (left === void 0 || right === void 0 || left.kind !== right.kind) return left === right;
			if (left.kind === "session" || left.kind === "unresolved") return true;
			if (right.kind === "session" || right.kind === "unresolved") return false;
			if (left.kind === "turn" || right.kind === "turn") return left.kind === "turn" && right.kind === "turn" && left.turn === right.turn;
			return left.turn === right.turn && left.step === right.step;
		}
		/** Session-owned Turn/Step timeline and event-to-Location index. */
		var ConversationLocationIndex = class {
			coordinates = /* @__PURE__ */ new Map();
			locations = /* @__PURE__ */ new Map();
			seqsByTurn = /* @__PURE__ */ new Map();
			timeline = {
				turnOrder: [],
				turns: /* @__PURE__ */ new Map()
			};
			turnDataStores = /* @__PURE__ */ new Map();
			stepDataStores = /* @__PURE__ */ new Map();
			currentTurn;
			currentStep;
			/**
			* Return the current reference-stable timeline.
			* @returns current timeline snapshot.
			*/
			snapshot() {
				return this.timeline;
			}
			/**
			* Replace all Definition-owned Location values while preserving reader identities.
			* @param entries - complete current set of Definition-owned Location values.
			* @returns whether any published Location data changed.
			*/
			replaceData(entries) {
				const turns = /* @__PURE__ */ new Map();
				const steps = /* @__PURE__ */ new Map();
				for (const { owner, data } of entries) {
					const values = data.kind === "turn" ? turns.get(data.turn) ?? /* @__PURE__ */ new Map() : steps.get(stepDataKey(data.turn, requireStep(data))) ?? /* @__PURE__ */ new Map();
					const current = values.get(data.key);
					if (current !== void 0 && current.owner !== owner) throw new Error(`conversation Location data "${data.key}" is already owned by ${current.owner}`);
					values.set(data.key, {
						owner,
						value: data.value
					});
					if (data.kind === "turn") turns.set(data.turn, values);
					else steps.set(stepDataKey(data.turn, requireStep(data)), values);
				}
				let changed = false;
				for (const turn of new Set([...this.turnDataStores.keys(), ...turns.keys()])) changed = this.mutableTurnData(turn).replace(turns.get(turn) ?? /* @__PURE__ */ new Map()) || changed;
				for (const step of new Set([...this.stepDataStores.keys(), ...steps.keys()])) changed = this.mutableStepData(step).replace(steps.get(step) ?? /* @__PURE__ */ new Map()) || changed;
				return changed;
			}
			/**
			* Apply changed Context publications without rebuilding Turn/Step membership.
			* @param changes - incremental removals and replacements from published Contexts.
			* @returns whether any published Location data changed.
			*/
			applyData(changes) {
				let changed = false;
				for (const change of changes) {
					const previous = change.previous;
					if (previous === null) continue;
					changed = this.storeFor(previous).remove(change.owner, previous.key) || changed;
				}
				for (const change of changes) {
					const next = change.next;
					if (next === null) continue;
					changed = this.storeFor(next).set(change.owner, next.key, next.value) || changed;
				}
				return changed;
			}
			/**
			* Resolve the latest Location for one event.
			* @param event - event already ingested into this index.
			* @returns current Location, falling back to session when it has no Turn/Step affinity.
			*/
			locationOf(event) {
				return this.locations.get(event.seq) ?? SESSION_LOCATION;
			}
			/**
			* Rebuild timeline facts after replace/prepend or a boundary append.
			* @param entries - complete current window in ascending seq order.
			* @returns seqs whose resolved Location changed.
			*/
			rebuild(entries) {
				const previousLocations = this.locations;
				const turns = /* @__PURE__ */ new Map();
				const coordinates = /* @__PURE__ */ new Map();
				let currentTurn;
				let currentStep;
				const turnDraft = (turn, seq) => {
					let draft = turns.get(turn);
					if (draft === void 0) {
						draft = {
							turn,
							firstSeq: seq,
							steps: /* @__PURE__ */ new Map()
						};
						turns.set(turn, draft);
					} else draft.firstSeq = Math.min(draft.firstSeq, seq);
					return draft;
				};
				const stepDraft = (turn, step, seq) => {
					const owner = turnDraft(turn, seq);
					let draft = owner.steps.get(step);
					if (draft === void 0) {
						draft = {
							turn,
							step,
							firstSeq: seq
						};
						owner.steps.set(step, draft);
					} else draft.firstSeq = Math.min(draft.firstSeq, seq);
					return draft;
				};
				for (const { event } of entries) {
					const explicit = payloadCoordinates(event);
					if (event.type === "turn/start") {
						currentTurn = event.data.turn;
						currentStep = void 0;
					}
					if (event.type === "step/start") {
						currentTurn = event.data.turn;
						currentStep = event.data.step;
					}
					if (explicit.session !== true && explicit.turn !== void 0) {
						if (currentTurn !== explicit.turn) currentStep = void 0;
						currentTurn = explicit.turn;
						if (explicit.step !== void 0) currentStep = explicit.step;
					}
					const turn = explicit.session === true ? void 0 : explicit.turn ?? currentTurn;
					const step = explicit.session === true || event.type === "turn/start" || event.type === "turn/end" ? void 0 : explicit.step ?? (turn === currentTurn ? currentStep : void 0);
					coordinates.set(event.seq, {
						...turn === void 0 ? {} : { turn },
						...turn === void 0 || step === void 0 ? {} : { step }
					});
					if (turn !== void 0) turnDraft(turn, event.seq);
					if (turn !== void 0 && step !== void 0) stepDraft(turn, step, event.seq);
					if (event.type === "turn/start") turnDraft(event.data.turn, event.seq).start = event;
					else if (event.type === "turn/end") turnDraft(event.data.turn, event.seq).end = event;
					else if (event.type === "step/start") stepDraft(event.data.turn, event.data.step, event.seq).start = event;
					else if (event.type === "step/end") stepDraft(event.data.turn, event.data.step, event.seq).end = event;
					if (event.type === "step/end" && currentTurn === event.data.turn && currentStep === event.data.step) currentStep = void 0;
					if (event.type === "turn/end" && currentTurn === event.data.turn) {
						currentTurn = void 0;
						currentStep = void 0;
					}
				}
				const previousTurns = this.timeline.turns;
				const nextTurns = /* @__PURE__ */ new Map();
				const orderedDrafts = [...turns.values()].sort((left, right) => left.firstSeq - right.firstSeq);
				for (const draft of orderedDrafts) {
					const previousTurn = previousTurns.get(draft.turn);
					const previousSteps = new Map(previousTurn?.steps.map((step) => [step.step, step]) ?? []);
					const steps = [...draft.steps.values()].sort((left, right) => left.firstSeq - right.firstSeq).map((candidate) => {
						const value = {
							turn: candidate.turn,
							step: candidate.step,
							start: candidate.start,
							end: candidate.end,
							status: candidate.end !== void 0 ? "closed" : candidate.start === void 0 ? "unknown" : "open",
							data: this.stepData(candidate.turn, candidate.step)
						};
						const previous = previousSteps.get(candidate.step);
						return sameStep(previous, value) ? previous : value;
					});
					const value = {
						turn: draft.turn,
						start: draft.start,
						end: draft.end,
						status: draft.end !== void 0 ? "closed" : draft.start === void 0 ? "unknown" : "open",
						steps,
						data: this.turnData(draft.turn)
					};
					nextTurns.set(draft.turn, sameTurn(previousTurn, value) ? previousTurn : value);
				}
				const nextOrder = orderedDrafts.map((draft) => draft.turn);
				const turnOrder = this.timeline.turnOrder.length === nextOrder.length && this.timeline.turnOrder.every((turn, index) => turn === nextOrder[index]) ? this.timeline.turnOrder : nextOrder;
				let sameMap = previousTurns.size === nextTurns.size;
				if (sameMap) {
					for (const [turn, value] of nextTurns) if (previousTurns.get(turn) !== value) {
						sameMap = false;
						break;
					}
				}
				this.timeline = sameMap && turnOrder === this.timeline.turnOrder ? this.timeline : {
					turnOrder,
					turns: nextTurns
				};
				this.coordinates = coordinates;
				this.locations = /* @__PURE__ */ new Map();
				this.seqsByTurn = /* @__PURE__ */ new Map();
				for (const { event } of entries) {
					const coordinates = this.coordinates.get(event.seq);
					if (coordinates?.turn !== void 0) this.indexTurnSeq(coordinates.turn, event.seq);
					this.locations.set(event.seq, this.resolve(event.seq));
				}
				this.currentTurn = currentTurn;
				this.currentStep = currentStep;
				const changed = /* @__PURE__ */ new Set();
				for (const { event } of entries) if (!sameLocation(previousLocations.get(event.seq), this.locations.get(event.seq))) changed.add(event.seq);
				return changed;
			}
			/**
			* Append one Turn/Step boundary while revisiting only the owning Turn.
			* @param event - contiguous tail boundary event.
			* @returns seqs whose immutable Location reference changed.
			*/
			appendBoundary(event) {
				if (event.type !== "turn/start" && event.type !== "turn/end" && event.type !== "step/start" && event.type !== "step/end") throw new Error(`conversation Location boundary expected, received ${event.type}`);
				const explicit = payloadCoordinates(event);
				if (event.type === "turn/start") {
					this.currentTurn = event.data.turn;
					this.currentStep = void 0;
				} else if (event.type === "step/start") {
					this.currentTurn = event.data.turn;
					this.currentStep = event.data.step;
				}
				if (explicit.turn !== void 0) {
					if (this.currentTurn !== explicit.turn) this.currentStep = void 0;
					this.currentTurn = explicit.turn;
					if (explicit.step !== void 0) this.currentStep = explicit.step;
				}
				const turnNumber = explicit.turn ?? this.currentTurn;
				if (turnNumber === void 0) throw new Error(`conversation boundary ${event.type} has no turn`);
				const stepNumber = event.type === "turn/start" || event.type === "turn/end" ? void 0 : explicit.step ?? (turnNumber === this.currentTurn ? this.currentStep : void 0);
				this.coordinates.set(event.seq, {
					turn: turnNumber,
					...stepNumber === void 0 ? {} : { step: stepNumber }
				});
				this.indexTurnSeq(turnNumber, event.seq);
				const previousTurn = this.timeline.turns.get(turnNumber);
				let steps = previousTurn?.steps ?? [];
				if (event.type === "step/start" || event.type === "step/end") {
					const number = event.data.step;
					const previousStep = steps.find((candidate) => candidate.step === number);
					const candidate = {
						turn: turnNumber,
						step: number,
						start: event.type === "step/start" ? event : previousStep?.start,
						end: event.type === "step/end" ? event : previousStep?.end,
						status: event.type === "step/end" || previousStep?.end !== void 0 ? "closed" : "open",
						data: this.stepData(turnNumber, number)
					};
					const nextStep = sameStep(previousStep, candidate) ? previousStep : candidate;
					const index = steps.findIndex((step) => step.step === number);
					steps = index < 0 ? [...steps, nextStep] : steps.map((step, at) => at === index ? nextStep : step);
				}
				const candidate = {
					turn: turnNumber,
					start: event.type === "turn/start" ? event : previousTurn?.start,
					end: event.type === "turn/end" ? event : previousTurn?.end,
					status: event.type === "turn/end" || previousTurn?.end !== void 0 ? "closed" : event.type === "turn/start" || previousTurn?.start !== void 0 ? "open" : "unknown",
					steps,
					data: this.turnData(turnNumber)
				};
				const turn = sameTurn(previousTurn, candidate) ? previousTurn : candidate;
				const turns = new Map(this.timeline.turns);
				turns.set(turnNumber, turn);
				const turnOrder = previousTurn === void 0 ? [...this.timeline.turnOrder, turnNumber] : this.timeline.turnOrder;
				this.timeline = {
					turnOrder,
					turns
				};
				const changed = /* @__PURE__ */ new Set();
				for (const seq of this.seqsByTurn.get(turnNumber) ?? []) {
					const previous = this.locations.get(seq);
					const next = this.resolve(seq);
					this.locations.set(seq, next);
					if (!sameLocation(previous, next)) changed.add(seq);
				}
				if (event.type === "step/end" && this.currentTurn === event.data.turn && this.currentStep === event.data.step) this.currentStep = void 0;
				if (event.type === "turn/end" && this.currentTurn === event.data.turn) {
					this.currentTurn = void 0;
					this.currentStep = void 0;
				}
				return changed;
			}
			/**
			* Index one non-boundary tail event without rescanning the window.
			* @param event - contiguous appended event.
			*/
			appendNonBoundary(event) {
				const explicit = payloadCoordinates(event);
				if (explicit.session === true) {
					this.coordinates.set(event.seq, {});
					this.locations.set(event.seq, SESSION_LOCATION);
					return;
				}
				if (explicit.turn !== void 0) {
					if (this.currentTurn !== explicit.turn) this.currentStep = void 0;
					this.currentTurn = explicit.turn;
					if (explicit.step !== void 0) this.currentStep = explicit.step;
				}
				const turn = explicit.turn ?? this.currentTurn;
				const step = explicit.step ?? (turn === this.currentTurn ? this.currentStep : void 0);
				this.coordinates.set(event.seq, {
					...turn === void 0 ? {} : { turn },
					...turn === void 0 || step === void 0 ? {} : { step }
				});
				if (turn !== void 0) this.indexTurnSeq(turn, event.seq);
				this.locations.set(event.seq, this.resolve(event.seq));
			}
			indexTurnSeq(turn, seq) {
				const current = this.seqsByTurn.get(turn) ?? /* @__PURE__ */ new Set();
				current.add(seq);
				this.seqsByTurn.set(turn, current);
			}
			turnData(turn) {
				return this.mutableTurnData(turn);
			}
			stepData(turn, step) {
				return this.mutableStepData(stepDataKey(turn, step));
			}
			mutableTurnData(turn) {
				const current = this.turnDataStores.get(turn) ?? new MutableLocationDataStore();
				this.turnDataStores.set(turn, current);
				return current;
			}
			mutableStepData(key) {
				const current = this.stepDataStores.get(key) ?? new MutableLocationDataStore();
				this.stepDataStores.set(key, current);
				return current;
			}
			storeFor(data) {
				return data.kind === "turn" ? this.mutableTurnData(data.turn) : this.mutableStepData(stepDataKey(data.turn, requireStep(data)));
			}
			resolve(seq) {
				const coordinates = this.coordinates.get(seq);
				if (coordinates?.turn === void 0) return SESSION_LOCATION;
				const turn = this.timeline.turns.get(coordinates.turn);
				if (turn === void 0) return UNRESOLVED_LOCATION;
				if (coordinates.step === void 0) return {
					kind: "turn",
					turn
				};
				const step = turn.steps.find((candidate) => candidate.step === coordinates.step);
				return step === void 0 ? {
					kind: "turn",
					turn
				} : {
					kind: "step",
					turn,
					step
				};
			}
		};
		function stepDataKey(turn, step) {
			return `${turn}:${step}`;
		}
		function requireStep(data) {
			if (data.kind === "step" && data.step !== void 0) return data.step;
			throw new Error(`conversation Step data "${data.key}" requires a step`);
		}
		//#endregion
		//#region lib/types/client/sessions/conversation-assembler.js
		const PUBLICATION_RANK = {
			none: 0,
			"animation-frame": 1,
			immediate: 2
		};
		const LOCATION_DATA_SCOPES = ["step", "turn"];
		function emptyLocationData() {
			return {
				step: null,
				turn: null
			};
		}
		function maximumPublication(left, right) {
			return PUBLICATION_RANK[left] >= PUBLICATION_RANK[right] ? left : right;
		}
		function startSeq(context) {
			return context.startSeq;
		}
		function insertionIndex(contexts, seq) {
			let low = 0;
			let high = contexts.length;
			while (low < high) {
				const middle = low + Math.floor((high - low) / 2);
				const candidate = contexts[middle];
				if (candidate !== void 0 && candidate.startSeq < seq) low = middle + 1;
				else high = middle;
			}
			return low;
		}
		function contextSnapshot(context) {
			return {
				key: context.key,
				kind: context.kind,
				id: context.id,
				matches: context.matches,
				start: context.start,
				state: context.state,
				current: context.current
			};
		}
		function mergeMatches(key, additions, existing) {
			const merged = [];
			let added = 0;
			let current = 0;
			while (added < additions.length || current < existing.length) {
				const left = additions[added];
				const right = existing[current];
				if (left !== void 0 && right !== void 0 && left.event.seq === right.event.seq) throw new Error(`conversation Context ${key} received duplicate Match ${left.event.seq}`);
				if (right === void 0 || left !== void 0 && left.event.seq < right.event.seq) {
					merged.push(left);
					added++;
				} else {
					merged.push(right);
					current++;
				}
			}
			return merged;
		}
		/**
		* Session-owned incremental engine that assembles business Contexts from a
		* contiguous Event window and materializes registered view snapshots.
		*/
		var ConversationNodeAssembler = class {
			eventDefinitions;
			viewDefinitions;
			contexts = /* @__PURE__ */ new Map();
			contextsByKind = /* @__PURE__ */ new Map();
			contextsBySeq = /* @__PURE__ */ new Map();
			inputs = /* @__PURE__ */ new Map();
			locationIndex = new ConversationLocationIndex();
			dirty = /* @__PURE__ */ new Set();
			revised = /* @__PURE__ */ new Set();
			dependents = /* @__PURE__ */ new Map();
			views = /* @__PURE__ */ new Map();
			hasMore = false;
			replacePending = true;
			timelineDirty = true;
			/**
			* @param eventDefinitions - live Event Definition registry.
			* @param viewDefinitions - live view builder registry.
			*/
			constructor(eventDefinitions, viewDefinitions) {
				this.eventDefinitions = eventDefinitions;
				this.viewDefinitions = viewDefinitions;
				this.resetViewBuilders();
			}
			/**
			* Replace the complete loaded window after open, resync, or gap repair.
			* @param entries - complete contiguous window.
			* @param hasMore - whether older history remains outside the window.
			* @returns immediate publication request.
			*/
			replaceWindow(entries, hasMore) {
				this.contexts.clear();
				this.contextsByKind.clear();
				this.contextsBySeq.clear();
				this.inputs.clear();
				this.dirty.clear();
				this.revised.clear();
				this.dependents.clear();
				this.hasMore = hasMore;
				const sorted = [...entries].sort((left, right) => left.event.seq - right.event.seq);
				for (const entry of sorted) this.inputs.set(entry.event.seq, entry);
				this.locationIndex.rebuild(sorted);
				this.timelineDirty = true;
				for (const entry of sorted) this.matchInput(entry);
				this.replayDependencies();
				this.revised.clear();
				for (const context of this.contexts.values()) this.dirty.add(context);
				this.replacePending = true;
				return "immediate";
			}
			/**
			* Add one contiguous live tail event without scanning existing Contexts.
			* @param input - appended Event and optional wire view.
			* @returns highest requested publication cadence.
			*/
			append(input) {
				if (this.inputs.has(input.event.seq)) return "none";
				this.revised.clear();
				this.inputs.set(input.event.seq, input);
				let publication = "none";
				if (isLocationBoundary(input.event.type)) {
					const previousTimeline = this.locationIndex.snapshot();
					const changed = this.locationIndex.appendBoundary(input.event);
					if (this.locationIndex.snapshot() !== previousTimeline) {
						this.timelineDirty = true;
						publication = "immediate";
					}
					this.replayContexts(this.refreshMatchLocations(changed));
					if (changed.size > 0) publication = "immediate";
				} else this.locationIndex.appendNonBoundary(input.event);
				publication = maximumPublication(publication, this.matchInput(input));
				if (this.replayRevisedDependents()) publication = "immediate";
				this.revised.clear();
				return publication;
			}
			/**
			* Add an older page while preserving existing Context and view identities.
			* @param entries - newly loaded older Events.
			* @param hasMore - whether history still precedes the expanded window.
			* @returns highest requested publication cadence.
			*/
			prepend(entries, hasMore) {
				this.revised.clear();
				let publication = "none";
				const previousHasMore = this.hasMore;
				const fresh = entries.filter((entry) => !this.inputs.has(entry.event.seq)).sort((left, right) => left.event.seq - right.event.seq);
				for (const entry of fresh) this.inputs.set(entry.event.seq, entry);
				this.hasMore = hasMore;
				const previousTimeline = this.locationIndex.snapshot();
				const changedLocations = this.locationIndex.rebuild(this.sortedInputs());
				if (this.locationIndex.snapshot() !== previousTimeline) this.timelineDirty = true;
				const affected = this.refreshMatchLocations(changedLocations);
				const pending = /* @__PURE__ */ new Map();
				for (const entry of fresh) publication = maximumPublication(publication, this.collectInput(entry, pending));
				this.applyPendingMatches(pending, affected);
				this.replayContexts(affected);
				if ((this.revised.size > 0 || previousHasMore !== hasMore) && this.replayDependencies()) publication = "immediate";
				if (changedLocations.size > 0) publication = "immediate";
				this.revised.clear();
				return publication;
			}
			/**
			* Rebuild against the current Registry set after a low-frequency plugin change.
			* @returns immediate publication request.
			*/
			rebuildRegistry() {
				this.resetViewBuilders();
				return this.replaceWindow(this.sortedInputs(), this.hasMore);
			}
			/**
			* Materialize dirty Contexts and advance every registered view builder.
			* @returns whether any view snapshot was rebuilt or incrementally applied.
			*/
			flush() {
				if (!this.replacePending && this.dirty.size === 0 && !this.timelineDirty) return false;
				if (this.replacePending) {
					this.replaceLocationData();
					const allByTarget = /* @__PURE__ */ new Map();
					for (const target of this.views.keys()) allByTarget.set(target, []);
					for (const context of this.contexts.values()) {
						const target = context.definition.target;
						if (target === void 0 || !this.views.has(target)) continue;
						const node = this.buildNode(context, target);
						context.current.set(target, node);
						if (node !== null) allByTarget.get(target)?.push(node);
					}
					for (const view of this.views.values()) view.snapshot = view.builder.replace({
						nodes: allByTarget.get(view.target) ?? [],
						timeline: this.locationIndex.snapshot()
					});
					this.replacePending = false;
					this.dirty.clear();
					this.timelineDirty = false;
					return true;
				}
				const upsertsByTarget = /* @__PURE__ */ new Map();
				for (const target of this.views.keys()) upsertsByTarget.set(target, []);
				if (this.applyDirtyLocationData()) this.timelineDirty = true;
				for (const context of this.dirty) {
					const target = context.definition.target;
					if (target === void 0 || !this.views.has(target)) continue;
					const previous = context.current.get(target) ?? null;
					const node = this.buildNode(context, target);
					if (node === null && previous !== null) throw new Error(`conversation Definition "${context.kind}" withdrew materialized target "${target}"; return the same key with hidden visibility instead`);
					context.current.set(target, node);
					if (node !== null) upsertsByTarget.get(target)?.push(node);
				}
				this.dirty.clear();
				const timelineDirty = this.timelineDirty;
				this.timelineDirty = false;
				for (const view of this.views.values()) {
					const upserts = upsertsByTarget.get(view.target) ?? [];
					if (upserts.length === 0 && !timelineDirty) continue;
					view.snapshot = view.builder.apply({
						upserts,
						timeline: this.locationIndex.snapshot()
					});
				}
				return true;
			}
			/**
			* Read the latest snapshot of a registered target.
			* @param target - registered view target.
			* @returns target snapshot, or undefined when no builder is registered.
			*/
			snapshot(target) {
				return this.views.get(target)?.snapshot;
			}
			get(target) {
				return this.snapshot(target);
			}
			sortedInputs() {
				return [...this.inputs.values()].sort((left, right) => left.event.seq - right.event.seq);
			}
			matchInput(input) {
				return this.dispatchInput(input, (definition, id, role) => this.acceptMatch(definition, id, role, input));
			}
			collectInput(input, pending) {
				return this.dispatchInput(input, (definition, id, role) => {
					const key = conversationContextKey(definition.kind, id);
					const match = {
						...input,
						role,
						location: this.locationIndex.locationOf(input.event)
					};
					const matches = pending.get(key) ?? [];
					matches.push({
						definition,
						id,
						match
					});
					pending.set(key, matches);
					return definition.publication?.(match) ?? "immediate";
				});
			}
			dispatchInput(input, accept) {
				const matchedTargets = /* @__PURE__ */ new Set();
				let publication = "none";
				for (const definition of this.eventDefinitions.entries()) {
					const result = definition.match(input.event);
					if (result === null) continue;
					if (definition.target !== void 0) matchedTargets.add(definition.target);
					publication = maximumPublication(publication, accept(definition, result.id, result.role));
				}
				const fallback = this.eventDefinitions.fallbackEntry();
				const target = fallback?.target;
				if (fallback !== void 0 && target !== void 0 && !matchedTargets.has(target)) {
					const result = fallback.match(input.event);
					if (result !== null) publication = maximumPublication(publication, accept(fallback, result.id, result.role));
				}
				return publication;
			}
			acceptMatch(definition, id, role, input) {
				const key = conversationContextKey(definition.kind, id);
				let context = this.contexts.get(key);
				if (role === "start" && context?.start !== void 0) throw new Error(`conversation Context ${key} received more than one start Match`);
				if (context === void 0) {
					context = {
						key,
						kind: definition.kind,
						id,
						definition,
						startSeq: void 0,
						start: void 0,
						matches: [],
						state: void 0,
						revision: 0,
						current: /* @__PURE__ */ new Map(),
						locationData: emptyLocationData(),
						dependencies: /* @__PURE__ */ new Map()
					};
					this.contexts.set(key, context);
				}
				const match = {
					...input,
					role,
					location: this.locationIndex.locationOf(input.event)
				};
				const previous = context.matches.at(-1);
				if (previous !== void 0 && previous.event.seq >= input.event.seq) throw new Error(`conversation Context ${key} received non-appended Match ${input.event.seq}`);
				if (role === "start" && context.matches.length > 0) throw new Error(`conversation Context ${key} received an update before its start Match`);
				context.matches.push(match);
				if (role === "start") {
					context.startSeq = input.event.seq;
					context.start = match;
					this.indexStartedContext(context);
				}
				const owners = this.contextsBySeq.get(input.event.seq) ?? /* @__PURE__ */ new Set();
				owners.add(context);
				this.contextsBySeq.set(input.event.seq, owners);
				if (role === "start") this.replayContext(context);
				else if (context.state !== void 0) {
					const typed = contextSnapshot(context);
					context.state = requireState(definition, "update", definition.update(typed, match));
					context.revision++;
					this.revised.add(context);
				}
				this.dirty.add(context);
				return definition.publication?.(match) ?? "immediate";
			}
			applyPendingMatches(pending, affected) {
				const startsByKind = /* @__PURE__ */ new Map();
				for (const [key, entries] of pending) {
					const first = entries[0];
					if (first === void 0) continue;
					let context = this.contexts.get(key);
					if (context === void 0) {
						context = {
							key,
							kind: first.definition.kind,
							id: first.id,
							definition: first.definition,
							startSeq: void 0,
							start: void 0,
							matches: [],
							state: void 0,
							revision: 0,
							current: /* @__PURE__ */ new Map(),
							locationData: emptyLocationData(),
							dependencies: /* @__PURE__ */ new Map()
						};
						this.contexts.set(key, context);
					}
					let discoveredStart;
					const additions = entries.map((entry) => {
						if (entry.definition !== context.definition || entry.id !== context.id) throw new Error(`conversation Context ${key} received inconsistent Definition identity`);
						if (entry.match.role === "start") {
							if (discoveredStart !== void 0 || context.start !== void 0) throw new Error(`conversation Context ${key} received more than one start Match`);
							discoveredStart = entry.match;
						}
						const owners = this.contextsBySeq.get(entry.match.event.seq) ?? /* @__PURE__ */ new Set();
						owners.add(context);
						this.contextsBySeq.set(entry.match.event.seq, owners);
						return entry.match;
					}).sort((left, right) => left.event.seq - right.event.seq);
					context.matches = mergeMatches(context.key, additions, context.matches);
					if (discoveredStart !== void 0) {
						context.start = discoveredStart;
						context.startSeq = discoveredStart.event.seq;
						const starts = startsByKind.get(context.kind) ?? [];
						starts.push(context);
						startsByKind.set(context.kind, starts);
					}
					if (context.start !== void 0 && context.matches[0] !== context.start) throw new Error(`conversation Context ${context.key} received an update before its start Match`);
					affected.add(context);
					this.dirty.add(context);
				}
				for (const [kind, contexts] of startsByKind) this.indexStartedContexts(kind, contexts);
			}
			replayContexts(contexts) {
				const ordered = [...contexts].sort((left, right) => (left.startSeq ?? Number.POSITIVE_INFINITY) - (right.startSeq ?? Number.POSITIVE_INFINITY));
				for (const context of ordered) {
					if (context.start === void 0) {
						context.state = void 0;
						this.dirty.add(context);
						continue;
					}
					this.replayContext(context);
				}
			}
			replayContext(context) {
				const start = context.start;
				if (start === void 0) {
					context.state = void 0;
					return;
				}
				if (context.matches[0] !== start) throw new Error(`conversation Context ${context.key} received an update before its start Match`);
				const dependencies = /* @__PURE__ */ new Map();
				const reader = this.readerFor(start.event.seq, dependencies);
				context.state = void 0;
				context.state = requireState(context.definition, "start", context.definition.start(contextSnapshot(context), start, reader));
				this.replaceDependencies(context, dependencies);
				for (let index = 1; index < context.matches.length; index++) {
					const match = context.matches[index];
					if (match === void 0 || match.role !== "update") continue;
					const typed = contextSnapshot(context);
					context.state = requireState(context.definition, "update", context.definition.update(typed, match));
				}
				context.revision++;
				this.revised.add(context);
				this.dirty.add(context);
			}
			replaceDependencies(context, dependencies) {
				for (const dependency of context.dependencies.values()) {
					if (dependency.key === void 0) continue;
					const current = this.dependents.get(dependency.key);
					current?.delete(context);
					if (current?.size === 0) this.dependents.delete(dependency.key);
				}
				context.dependencies = dependencies;
				for (const dependency of dependencies.values()) {
					if (dependency.key === void 0) continue;
					const current = this.dependents.get(dependency.key) ?? /* @__PURE__ */ new Set();
					current.add(context);
					this.dependents.set(dependency.key, current);
				}
			}
			replayRevisedDependents() {
				const pending = [...this.revised];
				const affected = /* @__PURE__ */ new Set();
				for (let index = 0; index < pending.length; index++) {
					const dependency = pending[index];
					if (dependency === void 0) continue;
					for (const dependent of this.dependents.get(dependency.key) ?? []) {
						if (affected.has(dependent)) continue;
						affected.add(dependent);
						pending.push(dependent);
					}
				}
				this.replayContexts(affected);
				return affected.size > 0;
			}
			readerFor(beforeSeq, dependencies) {
				return { previous: (kind) => {
					const predecessor = this.previousContext(kind, beforeSeq);
					dependencies.set(kind, {
						kind,
						key: predecessor?.key,
						revision: predecessor?.revision,
						windowGap: predecessor === void 0 && this.hasMore
					});
					if (predecessor?.state === void 0) return void 0;
					const seq = startSeq(predecessor);
					if (seq === void 0) return void 0;
					return {
						key: predecessor.key,
						kind: predecessor.kind,
						id: predecessor.id,
						startSeq: seq,
						state: predecessor.state,
						matches: predecessor.matches
					};
				} };
			}
			previousContext(kind, beforeSeq) {
				const candidates = this.contextsByKind.get(kind) ?? [];
				const indexBefore = insertionIndex(candidates, beforeSeq);
				for (let index = indexBefore - 1; index >= 0; index--) {
					const candidate = candidates[index];
					if (candidate?.state !== void 0) return candidate;
				}
			}
			/** Insert one newly discovered start into its Definition's ordered predecessor index. */
			indexStartedContext(context) {
				const seq = context.startSeq;
				if (seq === void 0) return;
				const candidates = this.contextsByKind.get(context.kind) ?? [];
				const previous = candidates.at(-1);
				if (previous === void 0 || previous.startSeq < seq) candidates.push(context);
				else candidates.splice(insertionIndex(candidates, seq), 0, context);
				this.contextsByKind.set(context.kind, candidates);
			}
			indexStartedContexts(kind, additions) {
				if (additions.length === 0) return;
				const sorted = [...additions].sort((left, right) => left.startSeq - right.startSeq);
				const existing = this.contextsByKind.get(kind) ?? [];
				const merged = [];
				let before = 0;
				let added = 0;
				while (before < existing.length || added < sorted.length) {
					const left = existing[before];
					const right = sorted[added];
					if (right === void 0 || left !== void 0 && left.startSeq < right.startSeq) {
						merged.push(left);
						before++;
					} else {
						merged.push(right);
						added++;
					}
				}
				this.contextsByKind.set(kind, merged);
			}
			replayDependencies() {
				let replayed = false;
				const ordered = [...this.contexts.values()].filter((context) => startSeq(context) !== void 0).sort((left, right) => startSeq(left) - startSeq(right));
				for (const context of ordered) {
					if (context.state === void 0 || context.dependencies.size === 0) continue;
					const before = startSeq(context);
					if (before === void 0) continue;
					let changed = false;
					for (const dependency of context.dependencies.values()) {
						const current = this.previousContext(dependency.kind, before);
						const windowGap = current === void 0 && this.hasMore;
						if (current?.key !== dependency.key || current?.revision !== dependency.revision || windowGap !== dependency.windowGap) {
							changed = true;
							break;
						}
					}
					if (changed) {
						this.replayContext(context);
						replayed = true;
					}
				}
				return replayed;
			}
			refreshMatchLocations(changedSeqs) {
				const affected = /* @__PURE__ */ new Set();
				if (changedSeqs.size === 0) return affected;
				for (const seq of changedSeqs) for (const context of this.contextsBySeq.get(seq) ?? []) affected.add(context);
				for (const context of affected) {
					let start = context.start;
					context.matches = context.matches.map((match) => {
						if (!changedSeqs.has(match.event.seq)) return match;
						const refreshed = {
							...match,
							location: this.locationIndex.locationOf(match.event)
						};
						if (match === start) start = refreshed;
						return refreshed;
					});
					context.start = start;
				}
				return affected;
			}
			buildNode(context, target) {
				if (context.definition.target !== target || context.definition.buildViewNode === void 0) return null;
				const node = context.definition.buildViewNode(contextSnapshot(context));
				if (node === null) return null;
				if (node.key !== context.key) throw new Error(`conversation Definition "${context.kind}" returned unstable key "${node.key}"; expected "${context.key}"`);
				if (node.target !== target) throw new Error(`conversation Definition "${context.kind}" returned target "${node.target}" while building "${target}"`);
				return node;
			}
			buildLocationData(context, scope) {
				if (context.definition.buildLocationData === void 0) return null;
				const data = context.definition.buildLocationData(contextSnapshot(context), scope);
				if (data === null) return null;
				if (data.kind !== scope) throw new Error(`conversation Definition "${context.kind}" published ${data.kind} data through its ${scope} scope`);
				if (data.key !== context.kind) throw new Error(`conversation Definition "${context.kind}" published Location data key "${data.key}"; expected its owned kind`);
				if (!Number.isSafeInteger(data.turn) || data.turn < 0) throw new Error(`conversation Definition "${context.kind}" published invalid turn ${data.turn}`);
				if (data.kind === "step" && (!Number.isSafeInteger(data.step) || data.step < 0)) throw new Error(`conversation Definition "${context.kind}" published invalid step ${String(data.step)}`);
				return data;
			}
			replaceLocationData() {
				const entries = [];
				for (const scope of LOCATION_DATA_SCOPES) {
					for (const context of this.contexts.values()) {
						const data = this.buildLocationData(context, scope);
						context.locationData[scope] = data;
						if (data !== null) entries.push({
							owner: context.key,
							data
						});
					}
					this.locationIndex.replaceData(entries);
				}
			}
			applyDirtyLocationData() {
				let changed = false;
				for (const scope of LOCATION_DATA_SCOPES) {
					const changes = [];
					for (const context of this.dirty) {
						const previous = context.locationData[scope];
						const next = this.buildLocationData(context, scope);
						context.locationData[scope] = next;
						if (previous !== next) changes.push({
							owner: context.key,
							previous,
							next
						});
					}
					changed = this.locationIndex.applyData(changes) || changed;
				}
				return changed;
			}
			resetViewBuilders() {
				this.views.clear();
				for (const definition of this.viewDefinitions.entries()) {
					const builder = definition.create();
					this.views.set(definition.target, {
						target: definition.target,
						builder,
						snapshot: builder.empty
					});
				}
				this.replacePending = true;
			}
		};
		function isLocationBoundary(type) {
			return type === "turn/start" || type === "turn/end" || type === "step/start" || type === "step/end";
		}
		function requireState(definition, phase, state) {
			if (state === void 0) throw new Error(`conversation Definition "${definition.kind}" returned undefined from ${phase}()`);
			return state;
		}
		//#endregion
		//#region lib/types/client/sessions/conversation.js
		/**
		* core ContentBlock[] -> AssistantBlock[] (classifier shared by finalized messages and partial block-end).
		* @param content - core content blocks verbatim.
		* @returns UI-classified blocks in source order.
		*/
		function toAssistantBlocks(content) {
			return content.map(toAssistantBlock);
		}
		/**
		* Classify one block (ToolCallBlock fields are id/arguments, mapped to callId/argsRaw).
		* @param block - one core content block.
		* @returns the UI classification.
		*/
		function toAssistantBlock(block) {
			switch (block.type) {
				case "text": return {
					kind: "text",
					text: block.text
				};
				case "reasoning": return {
					kind: "reasoning",
					text: block.text
				};
				case "image": return {
					kind: "image",
					attachment: block.attachment
				};
				case "tool-call": return {
					kind: "tool-call",
					callId: String(block.id),
					name: block.name,
					argsRaw: block.arguments
				};
				default: return {
					kind: "other",
					block
				};
			}
		}
		const EMPTY_LIST = [];
		const EMPTY_TIMELINE = {
			turnOrder: EMPTY_LIST,
			turns: /* @__PURE__ */ new Map()
		};
		/** Empty target store used by fixtures and Sessions without registered views. */
		const EMPTY_CONVERSATION_VIEWS = { get: () => void 0 };
		/** Empty Chat target used before a view builder is registered. */
		const EMPTY_CHAT_SNAPSHOT = {
			order: EMPTY_LIST,
			nodes: {
				get: () => void 0,
				values: () => EMPTY_LIST
			},
			locations: {
				getTurn: () => EMPTY_LIST,
				getStep: () => EMPTY_LIST
			},
			timeline: EMPTY_TIMELINE,
			legacy: {
				nodes: EMPTY_LIST,
				turnTimings: /* @__PURE__ */ new Map(),
				turnEnds: /* @__PURE__ */ new Map(),
				partial: null,
				runningCalls: EMPTY_LIST
			}
		};
		//#endregion
		//#region lib/types/client/sessions/pending.js
		/** Key prefixes, one per kind (the key doubles as the Session pending-map key). */
		const KEY_PREFIX = {
			approval: "a",
			question: "q"
		};
		/**
		* One pending host-owned interaction wait: an immutable render face
		* (kind/key/sessionId/payload) plus the response carrier. respond() backfills
		* the requested frame's rpcId into a client-response envelope — no consumer
		* ever sees the raw rpcId. Settlement is expressed only by pending-list
		* membership (the settled flag is a fail-loud guard, not a render input).
		*/
		var PendingWait = class {
			/** Interaction kind (union discriminant). */
			kind;
			/** Opaque render identity, `<prefix>:<rpcId>` — stable across baseline replay, usable as a React key. */
			key;
			/** Owning session. */
			sessionId;
			/** The requested frame's domain fields, verbatim. */
			payload;
			#settled = false;
			#rpcId;
			#respond;
			/**
			* Minted by Session on a requested frame (public construction is the test-fixture path).
			* @param kind - interaction kind.
			* @param rpcId - the requested frame's stable envelope id (kept private; respond echoes it).
			* @param sessionId - owning session.
			* @param payload - the requested frame's domain fields.
			* @param respond - the client-response carrier (api.respond).
			*/
			constructor(kind, rpcId, sessionId, payload, respond) {
				this.kind = kind;
				this.key = `${KEY_PREFIX[kind]}:${rpcId}`;
				this.sessionId = sessionId;
				this.payload = payload;
				this.#rpcId = rpcId;
				this.#respond = respond;
			}
			/**
			* Send a result for this wait: wraps it into the client-response envelope
			* with the rpcId backfilled. Throws synchronously once settled.
			* @param result - the result shell (ok value / error envelope), domain-encoded by the caller.
			* @returns the carrier receipt.
			*/
			respond(result) {
				if (this.#settled) throw new Error(`pending wait ${this.key} is already settled`);
				return this.#respond({
					type: "client-response",
					rpcId: this.#rpcId,
					result
				});
			}
			/** Session-only settlement mark (the authoritative resolved frame arrived); respond() throws afterwards. */
			markSettled() {
				this.#settled = true;
			}
		};
		//#endregion
		//#region lib/types/client/time-zone.js
		/** Browser-owned time-zone sampling for prompt RPC provenance. */
		/**
		* Resolve the current browser IANA zone for one outbound operation.
		* @returns The browser-provided canonical zone.
		* @throws when the runtime cannot provide a non-empty zone.
		*/
		function resolvedClientTimeZone() {
			const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
			if (typeof timeZone !== "string" || timeZone.length === 0) throw new Error("browser time zone is unavailable");
			return timeZone;
		}
		//#endregion
		//#region lib/types/client/sessions/queue-mirror.js
		const QUEUE_PREVIEW_CHARS = 200;
		function previewOf(content) {
			const flat = content.map((block) => block.type === "text" ? block.text : `[${block.type}]`).join(" ").replace(/\s+/g, " ").trim();
			const chars = Array.from(flat);
			return chars.length > QUEUE_PREVIEW_CHARS ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join("")}…` : flat;
		}
		function textOf(content) {
			if (!content.every((block) => block.type === "text")) return null;
			return content.map((block) => block.text).join("");
		}
		/** Authoritative transient queue projection and durable steering handoff. */
		var SessionQueueMirror = class {
			current = [];
			/**
			* Return the current immutable queue projection.
			* @returns current queue rows.
			*/
			snapshot() {
				return this.current;
			}
			/**
			* Drop the stale generation before its replacement queue baseline arrives.
			* @returns whether any projected queue row was removed.
			*/
			reset() {
				if (this.current.length === 0) return false;
				this.current = [];
				return true;
			}
			/**
			* Replace from one authoritative stream queue frame.
			* @param items - complete host queue snapshot.
			*/
			replace(items) {
				this.current = items.map((item) => ({
					id: item.id,
					messageId: item.message.id,
					placement: item.placement,
					content: item.message.content,
					preview: previewOf(item.message.content),
					text: textOf(item.message.content)
				}));
			}
			/**
			* Retire a transient steering row once its durable message enters the log.
			* @param event - newly contiguous durable Session event.
			* @returns whether the projection changed.
			*/
			acceptDurable(event) {
				if (event.type !== "user/message") return false;
				const messageId = event.data.id;
				const index = this.current.findIndex((item) => item.placement === "steering" && item.messageId === messageId);
				if (index < 0) return false;
				this.current = this.current.filter((_item, candidate) => candidate !== index);
				return true;
			}
		};
		/**
		* Owns a session's event window, derived conversation state, and observable
		* snapshot. React bindings remain outside this data layer. Features see only
		* the {@link SessionFace} slice (ISession verbs + the snapshot source); the
		* remaining public members are manager/runtime entry points.
		*/
		var Session = class {
			sessionId;
			api;
			remote;
			options;
			events = [];
			/** Wire views aligned with `events` by index (envelope-level annotations; undefined = no view).
			*  Kept parallel rather than merged so `events` stays the raw log slice (model-visible ⟺ logged). */
			views = [];
			baseSeq = 0;
			hasMore = false;
			openState = "cold";
			openError = null;
			openPromise = null;
			/** Bumped by resync to invalidate an in-flight doOpen: a reconnect must rebuild, never adopt
			*  a pre-disconnect open whose history request is already doomed. Stale doOpen
			*  passes drop all writes once the generation moves on. */
			openGeneration = 0;
			loadingOlder = false;
			pending = /* @__PURE__ */ new Map();
			pendingRev = 0;
			pendingCache = null;
			/** Authoritative stream-only inbox snapshot; pending work never hits history. */
			queueMirror = new SessionQueueMirror();
			/** Session-owned business Context engine over the contiguous raw window. */
			conversation;
			running = false;
			address;
			parentAvailable = false;
			/**
			* Sticky send marker, private input of the composerPhase derivation: set
			* synchronously before prompt()'s first await, never reset — the blank →
			* engaging edge of the phase machine (see ComposerPhase).
			*/
			promptAttempted = false;
			/** A first accepted prompt stays in the engaging phase until its turn is observable. */
			firstPromptPendingTurn = false;
			/** Empty-log mirror (see ConversationSnapshot.blank); unknown bare sessions begin conservatively blank. */
			blankBit = true;
			removed = false;
			promptError = null;
			lastAgentError = null;
			/** Live events buffered during open/resync and stitched by sequence once history lands. */
			liveBuffer = [];
			/** Gap repair in flight; live events detour to the buffer until the tail page lands. */
			stitching = false;
			/** subscribed.lastSeq baseline (gap detection; null when no subscribed frame arrived — degrade to the liveBuffer dedup path). */
			subscribedLastSeq = null;
			/**
			* Per-session projection value store (push model; see the session-projection
			* subsystem page, docs/subsystems/session-projection.md): finished whole
			* values computed on the host, seeded by the tail page's
			* projections block and updated by `session/projection` frames under the
			* one higher-seq-wins rule. Keys are read via `projections.faceOf(key)`
			* (the useProjection resolution face); the conversation snapshot never
			* carries projection values, and no client-side domain folding exists.
			* Manager-owned when constructed through SessionManager (frames route and
			* the store outlives instantiation, the title-snapshot precedent); a bare
			* construction gets a private store.
			*/
			projections;
			snapshotCache;
			notifier;
			/**
			* Agent-scoped cordis context, bound once by SessionRuntime when it
			* mints the scope (the client mirror of the host Agent's loopCtx). The
			* Session dispatches its own scoped events through it; undefined means
			* unbound (bare object-layer construction) or already pruned — both skip
			* dispatch-dependent behavior rather than fail.
			*/
			actx;
			/**
			* @param sessionId - Host session identity (client sessions are always Host-born).
			* @param api - shared wire client.
			* @param remote - generated Remote namespaces this session calls.
			* @param options - optional manager-owned state observers.
			*/
			constructor(sessionId, api, remote, options = {}) {
				this.sessionId = sessionId;
				this.api = api;
				this.remote = remote;
				this.options = options;
				this.projections = options.projections ?? new ProjectionValueStore();
				this.address = options.address;
				this.parentAvailable = options.parentAvailable ?? false;
				this.conversation = options.conversation === void 0 ? new ConversationNodeAssembler({
					entries: () => [],
					fallbackEntry: () => void 0
				}, { entries: () => [] }) : new ConversationNodeAssembler(options.conversation.events, options.conversation.views);
				this.notifier = new Notifier(() => {
					this.conversation.flush();
					this.snapshotCache = this.buildSnapshot();
				});
				this.snapshotCache = this.buildSnapshot();
			}
			/**
			* Bind the Agent-scoped context minted by SessionRuntime (single write;
			* a second bind is a wiring error and throws). Direction stays one-way at
			* this binding boundary: consumers still reach the Session via `sessions.sessionOf`,
			* while the Session holds its own dispatch point (host Agent.loopCtx
			* mirror).
			* @param actx - the agent's scoped context.
			*/
			bindScope(actx) {
				if (this.actx !== void 0) throw new Error(`session ${this.sessionId} already has a bound scope`);
				this.actx = actx;
			}
			/** Release the bound scope at prune time (a later rebind accompanies a freshly minted scope). */
			unbindScope() {
				this.actx = void 0;
			}
			/**
			* Send (queue/steer passed through 1:1); failures land in the snapshot's promptError.
			* @param content - text plus browser-owned temporary image uploads.
			* @param mode - queue appends after the current turn; steer interrupts it.
			* @returns the prompt result (also mirrored into promptError on failure).
			*/
			async prompt(content, mode) {
				this.promptError = null;
				this.lastAgentError = null;
				this.promptAttempted = true;
				if (this.blankBit) this.firstPromptPendingTurn = true;
				this.notifier.markDirty();
				let result;
				try {
					if (this.address === void 0) result = (await this.api.sessions.prompt({
						sessionId: this.sessionId,
						mode,
						content,
						clientTimeZone: resolvedClientTimeZone()
					})).result;
					else if (this.address.mode === "one-shot") result = {
						ok: false,
						error: {
							code: "subagent-not-resumable",
							message: "one-shot subagent conversations are read-only",
							details: { childSessionId: this.address.childSessionId }
						}
					};
					else if (content.some((part) => part.type === "image")) result = {
						ok: false,
						error: {
							code: "attachment-error",
							message: "Image input is unavailable for subagent continuations.",
							details: { reason: "SUBAGENT_IMAGE_UNSUPPORTED" }
						}
					};
					else {
						const routed = (await this.api.subagents.prompt({
							...this.address,
							content: content.flatMap((part) => part.type === "text" ? [{
								type: "text",
								text: part.text
							}] : []),
							clientTimeZone: resolvedClientTimeZone()
						})).result;
						result = routed.ok ? {
							ok: true,
							value: { accepted: true }
						} : routed;
					}
				} catch (error) {
					result = transportError(error);
				}
				if (!result.ok) {
					this.promptError = {
						op: "send",
						error: result.error
					};
					this.notifier.markDirty();
					return result;
				}
				if (this.blankBit) {
					this.blankBit = false;
					this.options.onEngaged?.(this);
					this.notifier.markDirty();
				}
				return result;
			}
			/**
			* Resolve one image referenced by this session into browser-consumable bytes.
			* @param attachmentId - opaque id found in the folded session log.
			* @returns the authenticated reference and decoded bytes.
			*/
			async readAttachment(attachmentId) {
				try {
					const result = (await this.api.sessions.attachment({
						sessionId: this.sessionId,
						attachmentId
					})).result;
					if (!result.ok) return result;
					const binary = atob(result.value.data);
					const data = Uint8Array.from(binary, (char) => char.charCodeAt(0));
					return {
						ok: true,
						value: {
							attachment: result.value.attachment,
							data
						}
					};
				} catch (error) {
					return transportError(error);
				}
			}
			/** Apply one operation to a still-pending queue occurrence. */
			async updateQueue(itemId, action) {
				try {
					return (await this.api.sessions.updateQueue({
						sessionId: this.sessionId,
						itemId,
						action
					})).result;
				} catch (error) {
					return transportError(error);
				}
			}
			/**
			* Stop the active turn while the Host preserves pending inbox work; failures
			* land in promptError (same error-strip display slot). A continuable
			* subagent address routes through `subagent.interrupt`, whose durable
			* parent-address authority works without a live parent Agent; a one-shot
			* address stays uncancellable (the UI offers no stop action, so this arm is
			* defensive).
			* @returns the cancel result.
			*/
			async cancel() {
				const address = this.address;
				if (address !== void 0 && address.mode === "one-shot") {
					const result = {
						ok: false,
						error: {
							code: "subagent-delivery-unavailable",
							message: "subagent activation cancellation is unavailable",
							details: { childSessionId: address.childSessionId }
						}
					};
					this.promptError = {
						op: "stop",
						error: result.error
					};
					this.notifier.markDirty();
					return result;
				}
				let result;
				try {
					result = address !== void 0 ? (await this.api.subagents.interrupt(address)).result : (await this.api.sessions.cancel({ sessionId: this.sessionId })).result;
				} catch (error) {
					result = transportError(error);
				}
				if (!result.ok) {
					this.promptError = {
						op: "stop",
						error: result.error
					};
					this.notifier.markDirty();
				}
				return result;
			}
			/**
			* Rename: contract session.rename 1:1. On success settle the 'title'
			* projection cell from the response's `{title, seq}` under the store's
			* higher-seq-wins rule (the push frame arriving later is a no-op replay),
			* so the list row and any useProjection('title') reader update without
			* waiting for the mux frame.
			* @param title - raw title text (the host normalizes acceptance).
			* @returns the rename result (normalized accepted title + title event seq).
			*/
			async rename(title) {
				try {
					const { result } = await this.api.sessions.rename({
						sessionId: this.sessionId,
						title
					});
					if (result.ok) this.projections.apply("title", result.value.title, result.value.seq);
					return result;
				} catch (error) {
					return transportError(error);
				}
			}
			/**
			* Execute one slash-command line against this session's agent — pure
			* admission semantics (the host executor durably logs the lifecycle;
			* outcomes render as flow nodes, never as a response echo).
			* @param line - the full command line, leading slash included.
			* @returns the admission result, or the error branch on transport failure.
			*/
			async command(line) {
				const result = await this.remote.commands.execute(this.sessionId, line);
				if (!result.ok) return result;
				return {
					ok: true,
					value: { matched: result.value !== void 0 }
				};
			}
			/** First open: pull the tail page (idempotent — in-flight/already-open returns the existing promise). */
			open() {
				if (this.openState === "open") return Promise.resolve();
				if (this.openPromise !== null) return this.openPromise;
				const promise = this.doOpen(this.openGeneration).finally(() => {
					if (this.openPromise === promise) this.openPromise = null;
				});
				this.openPromise = promise;
				return promise;
			}
			/** Page up: pull one earlier page with the window's first seq as beforeSeq and prepend. */
			async loadOlder() {
				if (this.openState !== "open" || !this.hasMore || this.loadingOlder) return;
				this.loadingOlder = true;
				this.notifier.markDirty();
				try {
					const { result } = await this.history({
						beforeSeq: this.baseSeq,
						maxMessages: 50
					});
					if (!result.ok) return;
					const older = result.value.events;
					if (older.length === 0) {
						this.hasMore = result.value.hasMore;
						this.conversation.prepend([], this.hasMore);
						return;
					}
					const tail = older[older.length - 1];
					if (tail === void 0 || tail.event.seq + 1 !== this.baseSeq) {
						console.error(`[web-runtime] history page discontinuous: tail seq ${tail?.event.seq} vs baseSeq ${this.baseSeq}`);
						this.hasMore = false;
						this.conversation.prepend([], false);
						return;
					}
					this.events = [...older.map((e) => e.event), ...this.events];
					this.views = [...older.map((e) => e.view), ...this.views];
					/* v8 ignore next -- the ?? arm needs older[0] undefined, but the empty-page branch above already returned. */
					this.baseSeq = older[0]?.event.seq ?? this.baseSeq;
					this.hasMore = result.value.hasMore;
					this.conversation.prepend(older.map(conversationInput), this.hasMore);
				} catch (error) {
					console.error("[web-runtime] loadOlder failed:", error);
				} finally {
					this.loadingOlder = false;
					this.notifier.markDirty();
				}
			}
			/** Reconnect rebuild (manager calls this on onConnected for instances that were opened):
			*  reset the window and rerun open; pending waits for the baseline replay. Invalidates any
			*  in-flight open first — its history request rode the dead connection and must not settle
			*  the fresh generation into 'error'. */
			async resync() {
				if (this.openState === "cold") return;
				this.openGeneration++;
				this.openPromise = null;
				this.openState = "cold";
				this.openError = null;
				this.events = [];
				this.views = [];
				this.baseSeq = 0;
				this.pending.clear();
				this.pendingRev++;
				this.subscribedLastSeq = null;
				this.liveBuffer = [];
				this.notifier.markDirty();
				await this.open();
			}
			/**
			* uSES subscription entry.
			* @param listener - change callback.
			* @returns the unsubscribe function.
			*/
			subscribe(listener) {
				return this.notifier.subscribe(listener);
			}
			/**
			* Cached conversation snapshot (rebuilt lazily when dirty with no listeners).
			* @returns the cached reference (stable until the next flush).
			*/
			getSnapshot() {
				this.notifier.ensureFresh();
				return this.snapshotCache;
			}
			/**
			* Mux frame arrival (the dispatch switch).
			* @param rpcId - the frame envelope id (the respond backfill key for requested frames).
			* @param frame - the routed frame.
			*/
			handleMuxEnvelope(rpcId, frame) {
				switch (frame.type) {
					case "session/event":
						this.acceptLiveEvent(frame.event, frame.view);
						return;
					case "session/queue":
						this.queueMirror.replace(frame.items);
						this.notifier.markDirty();
						return;
					case "session/subscribed":
						this.subscribedLastSeq = frame.lastSeq;
						if (this.queueMirror.reset()) this.notifier.markDirty();
						return;
					case "approval/requested": {
						const { type: _type, sessionId: _sid, ...payload } = frame;
						this.mint(new PendingWait("approval", rpcId, this.sessionId, payload, (m) => this.api.respond(m)));
						this.notifier.markDirty();
						return;
					}
					case "approval/resolved":
						for (const item of this.pending.values()) if (item.kind === "approval" && item.payload.approvalId === frame.approvalId) this.settle(item);
						this.notifier.markDirty();
						return;
					case "question/requested": {
						const { type: _type, sessionId: _sid, ...payload } = frame;
						this.mint(new PendingWait("question", rpcId, this.sessionId, payload, (m) => this.api.respond(m)));
						this.notifier.markDirty();
						return;
					}
					case "question/resolved": {
						const item = this.pending.get(`q:${frame.questionRpcId}`);
						if (item !== void 0) this.settle(item);
						this.notifier.markDirty();
						return;
					}
					default: return;
				}
			}
			/**
			* Running-bit relay from the host stream (list entry and snapshot stay consistent).
			* @param running - the new running state.
			*/
			handleRunning(running) {
				if (running && this.blankBit) {
					this.blankBit = false;
					this.notifier.markDirty();
				}
				if (running) this.firstPromptPendingTurn = false;
				if (this.running === running) return;
				this.running = running;
				this.notifier.markDirty();
			}
			/**
			* Install or clear the catalog-discovered transport address. A changed
			* address rebuilds an already-open window through its new history route.
			* @param address - direct parent/child address, or undefined for ordinary transport.
			* @param parentAvailable - latest exact-parent availability hint.
			*/
			configureSubagent(address, parentAvailable = false) {
				const same = this.address?.parentSessionId === address?.parentSessionId && this.address?.childSessionId === address?.childSessionId && this.address?.mode === address?.mode;
				this.address = address;
				this.parentAvailable = parentAvailable;
				if (!same && this.openState !== "cold") this.resync();
				else this.notifier.markDirty();
			}
			/**
			* Update only the parent availability hint from a catalog refresh.
			* @param available - whether the exact direct parent is live.
			*/
			handleSubagentParentAvailable(available) {
				if (this.parentAvailable === available) return;
				this.parentAvailable = available;
				this.notifier.markDirty();
			}
			/**
			* Blank-bit relay from the authoritative summary source (list baseline and
			* the session-added frame). Monotone: once any signal (local first send,
			* running flip, an earlier summary) cleared it, a stale true never
			* re-blanks.
			* @param blank - the summary's derived empty-log bit.
			*/
			handleBlank(blank) {
				if (blank === this.blankBit) return;
				if (blank && (this.promptAttempted || this.running)) return;
				this.blankBit = blank;
				this.notifier.markDirty();
			}
			/** host/session-removed relay: flag the snapshot (instance survives — resident-instance rule). */
			handleRemoved() {
				this.removed = true;
				this.notifier.markDirty();
			}
			/**
			* host/agent-error relay: the only outlet for live failures with no turn position.
			* @param message - the stringified error.
			*/
			handleAgentError(message) {
				this.lastAgentError = message;
				this.notifier.markDirty();
			}
			/** No-op because session instances remain resident. */
			dispose() {}
			/** Rebuild the current window after a low-frequency Definition or view registration change. */
			rebuildConversationRegistry() {
				this.scheduleConversation(this.conversation.rebuildRegistry());
			}
			/** Requested-frame arrival: the wait enters the pending map under its own key. */
			mint(wait) {
				this.pending.set(wait.key, wait);
				this.pendingRev++;
			}
			/** Authoritative resolved-frame settlement: mark, then drop from the pending map. */
			settle(wait) {
				wait.markSettled();
				this.pending.delete(wait.key);
				this.pendingRev++;
			}
			/** @param generation - openGeneration at launch; every await re-checks it and a stale pass
			*  drops all writes (resync superseded this open — its outcome belongs to a dead connection). */
			async doOpen(generation) {
				this.openState = "loading";
				this.openError = null;
				this.notifier.markDirty();
				try {
					let { result } = await this.history({ maxMessages: 50 });
					if (generation !== this.openGeneration) return;
					if (!result.ok) {
						this.openState = "error";
						this.openError = result.error;
						return;
					}
					this.installWindow(result.value.events, result.value.hasMore, result.value.projections);
					const tailSeq = this.windowTailSeq();
					if (this.subscribedLastSeq !== null && tailSeq !== null && this.subscribedLastSeq > tailSeq) {
						result = (await this.history({ maxMessages: 50 })).result;
						if (generation !== this.openGeneration) return;
						if (result.ok) this.installWindow(result.value.events, result.value.hasMore, result.value.projections);
					}
					this.openState = "open";
				} catch (error) {
					if (generation !== this.openGeneration) return;
					this.openState = "error";
					const folded = transportError(error);
					/* v8 ignore next -- the `? null` arm is unreachable: transportError always returns ok:false. */
					this.openError = folded.ok ? null : folded.error;
				} finally {
					if (generation === this.openGeneration) this.notifier.markDirty();
				}
			}
			/** Install the history window + stitch the liveBuffer (seq is the sole dedup key).
			*  Stitching MUST NOT route through acceptLiveEvent: openState is still 'loading' here
			*  (doOpen flips it after install), so recursing would push every buffered event straight
			*  back into liveBuffer where nothing ever drains it — a silent drop loop.
			*  A carried projections block seeds the value store (higher seq wins, so a stale
			*  baseline cannot overwrite a newer push frame); the window events themselves are
			*  never folded — the host is the only computation site. */
			installWindow(entries, hasMore, projections) {
				this.events = entries.map((e) => e.event);
				this.views = entries.map((e) => e.view);
				this.baseSeq = this.events[0]?.seq ?? 0;
				this.hasMore = hasMore;
				if (this.events.some((event) => event.type === "turn/start")) this.firstPromptPendingTurn = false;
				this.conversation.replaceWindow(entries.map(conversationInput), hasMore);
				if (projections !== void 0) this.projections.seed(projections);
				const buffered = this.liveBuffer;
				this.liveBuffer = [];
				for (const item of buffered) this.appendLive(item.event, item.view);
				this.notifier.markDirty();
			}
			/** Seq-guarded append shared by stitching and the open-state live path. */
			appendLive(event, view) {
				const tailSeq = this.windowTailSeq();
				if (tailSeq !== null && event.seq <= tailSeq) return "none";
				this.events.push(event);
				this.views.push(view);
				if (event.type === "turn/start") this.firstPromptPendingTurn = false;
				const queueChanged = this.queueMirror.acceptDurable(event);
				const publication = this.conversation.append({
					event,
					view
				});
				return queueChanged ? "immediate" : publication;
			}
			/** Land a live session/event (open/repair in flight -> buffer; overlapping seq -> drop;
			*  a seq gap -> buffer + tail-page repull instead of appending a hole (a gap is an
			*  expected reconnect-window artifact, repaired by refetch). The window stays one contiguous
			*  raw range, which lets Conversation Definitions correlate every recorded event between its
			*  ends and lets a compaction checkpoint resolve its cited summary event. */
			acceptLiveEvent(event, view) {
				if (this.openState === "loading" || this.stitching) {
					this.liveBuffer.push({
						event,
						view
					});
					return;
				}
				if (this.openState !== "open") return;
				const tailSeq = this.windowTailSeq();
				if (tailSeq !== null && event.seq > tailSeq + 1) {
					this.liveBuffer.push({
						event,
						view
					});
					this.repairGap();
					return;
				}
				this.scheduleConversation(this.appendLive(event, view));
			}
			/** Route assembler cadence into the Session's existing microtask/RAF notifier. */
			scheduleConversation(publication) {
				if (publication === "immediate") this.notifier.markDirty();
				else if (publication === "animation-frame") this.notifier.markFrameDirty();
			}
			/** Resync-lite: repull the tail page and stitch the liveBuffer through the shared
			*  installWindow path. No openState transition — the UI keeps the current window (no loading
			*  flash); events arriving meanwhile detour to liveBuffer via the stitching flag. */
			async repairGap() {
				/* v8 ignore next -- re-entry guard: acceptLiveEvent already detours to liveBuffer while stitching, so no second call reaches here. */
				if (this.stitching) return;
				this.stitching = true;
				const generation = this.openGeneration;
				try {
					const { result } = await this.history({ maxMessages: 50 });
					if (result.ok && generation === this.openGeneration && this.openState === "open") this.installWindow(result.value.events, result.value.hasMore, result.value.projections);
				} catch (error) {
					console.error("[web-runtime] gap repair failed:", error);
				} finally {
					this.stitching = false;
				}
			}
			windowTailSeq() {
				const tail = this.events[this.events.length - 1];
				return tail === void 0 ? null : tail.seq;
			}
			buildSnapshot() {
				if (this.pendingCache === null || this.pendingCache.rev !== this.pendingRev) this.pendingCache = {
					rev: this.pendingRev,
					value: [...this.pending.values()]
				};
				const chat = this.conversation.snapshot("chat") ?? EMPTY_CHAT_SNAPSHOT;
				const legacy = chat.legacy;
				return {
					sessionId: this.sessionId,
					views: this.conversation,
					chat,
					nodes: legacy.nodes,
					turnTimings: legacy.turnTimings,
					turnEnds: legacy.turnEnds,
					partial: legacy.partial,
					runningCalls: legacy.runningCalls,
					pending: this.pendingCache.value,
					queue: this.queueMirror.snapshot(),
					running: this.running,
					subagent: this.address === void 0 ? null : {
						address: this.address,
						parentAvailable: this.parentAvailable
					},
					composerPhase: derivePhase(hasVisibleConversationContent(chat) || !this.blankBit && !this.firstPromptPendingTurn || this.running || this.pendingCache.value.length > 0, this.promptAttempted),
					removed: this.removed,
					openState: this.openState,
					openError: this.openError,
					hasMore: this.hasMore,
					loadingOlder: this.loadingOlder,
					promptError: this.promptError,
					blank: this.blankBit,
					lastAgentError: this.lastAgentError
				};
			}
			/** Select ordinary or addressed history transport from the stored browser fact. */
			history(payload) {
				return this.address === void 0 ? this.api.sessions.history({
					sessionId: this.sessionId,
					...payload
				}) : this.api.subagents.history({
					...this.address,
					...payload
				});
			}
		};
		/** Convert one wire history row into the assembler's transport-neutral input. */
		function conversationInput(entry) {
			return {
				event: entry.event,
				view: entry.view
			};
		}
		/** A generic command row alone remains control-plane content; every other visible Chat Node activates the conversation. */
		function hasVisibleConversationContent(chat) {
			return chat.order.some((key) => chat.nodes.get(key)?.kind !== "command");
		}
		/**
		* The composerPhase judgment — the single site that knows the predicate
		* (consumers switch on the result, never re-derive). A failed first prompt
		* stays engaging until an authoritative accepted-turn, running, or pending
		* signal arrives (retry semantics — see ComposerPhase).
		* @param hasContent - authoritative non-blank activity beyond a pending first
		*   prompt, visible non-command Chat content, a running turn, or a pending interaction.
		* @param promptAttempted - a prompt was initiated on this session object.
		* @returns the derived phase.
		*/
		function derivePhase(hasContent, promptAttempted) {
			if (hasContent) return "active";
			return promptAttempted ? "engaging" : "blank";
		}
		//#endregion
		//#region lib/types/client/sessions/manager.js
		/** Stable identity of a frame retained until an uninstantiated Session can consume it. */
		function bufferedRequestKey(envelope) {
			const frame = envelope.payload;
			switch (frame.type) {
				case "approval/requested": return `a:${frame.approvalId}`;
				case "question/requested": return `q:${envelope.rpcId}`;
				case "session/queue": return "queue";
				/* v8 ignore next -- pendingBuffers contains only the three frame types above. */
				default: return;
			}
		}
		/** Match ui-user-questions's binary plan-review routing at the wire boundary. */
		function questionInteractionStatus(questions) {
			if (questions.length !== 1) return "question";
			const question = questions[0];
			const intent = question.intent;
			if (intent?.kind !== "plan-review" || question.detail === void 0) return "question";
			if (question.multiSelect === true) return "question";
			const options = question.options ?? [];
			if (options.length > 2) return "question";
			return options.some((option) => option.label === intent.approve) ? "plan-review" : "question";
		}
		/** Instance cluster + frame entry + the session list. */
		var SessionManager = class {
			api;
			remote;
			conversation;
			sessions = /* @__PURE__ */ new Map();
			/** Pre-instantiation buffer for answerable requests and the queued-turn snapshot, which history
			*  cannot reconstruct on open. Live requests remain until resolution; queue and replay duplicates
			*  compact by identity. Instantiation replays and clears it, while removal drops it. */
			pendingBuffers = /* @__PURE__ */ new Map();
			/** Outstanding answerable interactions per session, keyed by their stable request identity.
			*  Manager-owned rather than read off Session instances because the sidebar must light up for
			*  sessions never instantiated. Cleared per connection generation — the reopen replay re-adds
			*  still-pending requests — and on session-removed. */
			pendingInteractions = /* @__PURE__ */ new Map();
			/**
			* Sessions that finished running while not selected — the sidebar's green
			* "done" reminder (manager-owned, survives connection generations; cleared
			* on select and session-removed, re-armed by the next completion).
			*/
			completedNotifications = /* @__PURE__ */ new Set();
			/** Last-observed running bits per session; the true→false edge here arms {@link completedNotifications}. */
			prevRunning = /* @__PURE__ */ new Map();
			/** Per-session projection value stores, retained independently of instance arrival (the
			*  title-snapshot precedent, generalized): push frames land here whether or not the Session
			*  is instantiated (list rows read the 'title' key), and an instantiated Session adopts the
			*  same store so history-baseline seeding and frames converge on one row set. */
			projectionStores = /* @__PURE__ */ new Map();
			summaries = [];
			listState = "idle";
			/** Arrival phase; the pending → ready edge fires on the first successful pull (see SessionListPhase). */
			listPhase = "pending";
			listError = null;
			listInflight = null;
			/** Mutations arriving after a list request starts are replayed over its response. */
			listMutations = null;
			addresses = /* @__PURE__ */ new Map();
			catalogs = /* @__PURE__ */ new Map();
			catalogInflight = /* @__PURE__ */ new Map();
			/** Catalog owners whose membership changed while a pull was in flight: one trailing refresh after it settles. */
			catalogStale = /* @__PURE__ */ new Set();
			openCatalogs = /* @__PURE__ */ new Set();
			catalogDebounce = /* @__PURE__ */ new Map();
			/**
			* Background jobs per session, last-wins from `session/jobs`. An empty set
			* is stored as an absent key, so absence and `[]` are one representation.
			*/
			jobsBySession = /* @__PURE__ */ new Map();
			selected;
			listSnapshotCache;
			/** Entry-identity cache (reference stability): list rebuilds reuse the previous entry
			*  object when every field matches — wire refreshes mint all-new summary objects, so identity
			*  must be recovered by value or every SessionListItem memo misses on every refresh. */
			entryCache = /* @__PURE__ */ new Map();
			itemsCache = [];
			notifier = new Notifier(() => {
				this.listSnapshotCache = this.buildListSnapshot();
			});
			/**
			* @param api - shared wire client.
			* @param restoredSelection - persisted real-Session selection candidate.
			*/
			constructor(api, remote, restoredSelection, restoredAddress, conversation) {
				this.api = api;
				this.remote = remote;
				this.conversation = conversation;
				this.selected = restoredSelection;
				if (restoredAddress !== void 0) this.addresses.set(restoredAddress.childSessionId, restoredAddress);
				this.listSnapshotCache = this.buildListSnapshot();
			}
			/**
			* Select a listed Session or a retained catalog-addressed child.
			* @param sessionId - listed or catalog-addressed Session id.
			*/
			select(sessionId) {
				const address = this.navigationAddress(sessionId);
				if (!this.summaries.some((summary) => summary.sessionId === sessionId) && address === void 0) throw new Error(`sessions.select: unknown session ${sessionId}`);
				if (address !== void 0) this.addresses.set(sessionId, address);
				this.sessions.get(sessionId)?.configureSubagent(address, address === void 0 ? false : this.catalogs.get(address.parentSessionId)?.parentAvailable ?? false);
				this.selected = sessionId;
				this.completedNotifications.delete(sessionId);
				this.refreshSubagents(sessionId);
				this.notifier.notifyNow();
			}
			/**
			* Select a healthy child through its durable direct-parent address.
			* @param address - catalog-derived parent and child ids.
			*/
			selectSubagent(address) {
				const catalog = this.catalogs.get(address.parentSessionId);
				const entry = catalog?.entries.find((candidate) => candidate.id === address.childSessionId);
				if (entry === void 0 || entry.kind !== "child" || entry.mode !== address.mode) throw new Error(`sessions.selectSubagent: ${address.childSessionId} is not a healthy catalog child`);
				this.addresses.set(address.childSessionId, address);
				this.sessions.get(address.childSessionId)?.configureSubagent(address, catalog?.parentAvailable ?? false);
				this.selected = address.childSessionId;
				this.completedNotifications.delete(address.childSessionId);
				this.refreshSubagents(address.childSessionId);
				this.notifier.notifyNow();
			}
			/** Clear the selection (the layout falls to the no-session view state). */
			clearSelection() {
				this.selected = void 0;
				this.notifier.notifyNow();
			}
			/**
			* Return the durable catalog address retained for one child.
			* @param sessionId - possible addressed child id.
			* @returns The direct-parent address, when navigation discovered one.
			*/
			subagentAddress(sessionId) {
				return this.addresses.get(sessionId);
			}
			/**
			* Resolve an address for breadcrumb navigation without retaining transport authority.
			* @param sessionId - possible child id in an already-loaded catalog.
			* @returns A retained or catalog-derived direct-parent address.
			*/
			navigationAddress(sessionId) {
				const retained = this.addresses.get(sessionId);
				if (retained !== void 0) return retained;
				for (const [parentSessionId, catalog] of this.catalogs) {
					const child = catalog.entries.find((entry) => entry.kind === "child" && entry.id === sessionId);
					if (child?.kind === "child") return {
						parentSessionId,
						childSessionId: sessionId,
						mode: child.mode
					};
				}
			}
			/**
			* Drop a session instance (scope-prune companion: instance
			* and scope share one lifecycle). The host session log is the durable
			* truth — a later get() lazily rebuilds and open() backfills history.
			* @param sessionId - the session to drop.
			*/
			drop(sessionId) {
				this.sessions.delete(sessionId);
			}
			/**
			* Lazy build: return the existing instance or construct one (no auto-open —
			* open is triggered by the container's select callback).
			* @param sessionId - the session to get.
			* @returns the resident instance.
			*/
			get(sessionId) {
				let session = this.sessions.get(sessionId);
				if (session === void 0) {
					session = this.createSession(sessionId);
					this.sessions.set(sessionId, session);
					const buffered = this.pendingBuffers.get(sessionId);
					if (buffered !== void 0) {
						this.pendingBuffers.delete(sessionId);
						for (const envelope of buffered) session.handleMuxEnvelope(envelope.rpcId, envelope.payload);
					}
					const summary = this.summaries.find((s) => s.sessionId === sessionId);
					if (summary !== void 0) {
						session.handleBlank(summary.blank);
						session.handleRunning(summary.running);
					} else {
						const address = this.addresses.get(sessionId);
						const child = address === void 0 ? void 0 : this.catalogs.get(address.parentSessionId)?.entries.find((entry) => entry.kind === "child" && entry.id === sessionId);
						if (child?.kind === "child") {
							session.handleBlank(false);
							session.handleRunning(child.activity === "running");
						}
					}
				}
				return session;
			}
			createSession(sessionId) {
				const address = this.addresses.get(sessionId);
				return new Session(sessionId, this.api, this.remote, {
					...address === void 0 ? {} : {
						address,
						parentAvailable: this.catalogs.get(address.parentSessionId)?.parentAvailable ?? false
					},
					onEngaged: (engaged) => {
						this.recordMutation({
							kind: "engaged",
							sessionId: engaged.sessionId
						});
					},
					projections: this.projectionStore(sessionId),
					...this.conversation === void 0 ? {} : { conversation: this.conversation }
				});
			}
			/** Rebuild every resident Session after one coalesced registry transaction. */
			rebuildConversationRegistry() {
				for (const session of this.sessions.values()) session.rebuildConversationRegistry();
			}
			/** Resident per-session projection store (create-on-demand; outlives instantiation). */
			projectionStore(sessionId) {
				let store = this.projectionStores.get(sessionId);
				if (store === void 0) {
					store = new ProjectionValueStore();
					store.subscribeAny(() => {
						this.notifier.markDirty();
					});
					this.projectionStores.set(sessionId, store);
				}
				return store;
			}
			/**
			* Refresh one direct-child catalog, reusing its in-flight request.
			* @param parentSessionId - catalog owner.
			*/
			refreshSubagents(parentSessionId) {
				const existing = this.catalogInflight.get(parentSessionId);
				if (existing !== void 0) return existing.promise;
				const previous = this.catalogs.get(parentSessionId);
				const expandableRows = /* @__PURE__ */ new Set();
				const activityRows = /* @__PURE__ */ new Map();
				this.catalogs.set(parentSessionId, {
					entries: previous?.entries ?? [],
					parentAvailable: previous?.parentAvailable ?? false,
					state: "loading",
					error: null
				});
				this.notifier.markDirty();
				const operation = (async () => {
					try {
						const { result } = await this.api.subagents.list({ parentSessionId });
						if (result.ok) {
							const parentAvailable = this.catalogInflight.get(parentSessionId)?.parentAvailableOverride ?? result.value.parentAvailable;
							this.catalogs.set(parentSessionId, {
								...result.value,
								entries: this.withCatalogMutations(result.value.entries, expandableRows, activityRows),
								parentAvailable,
								state: "ready",
								error: null
							});
							for (const [childId, address] of this.addresses) {
								if (address.parentSessionId !== parentSessionId) continue;
								this.sessions.get(childId)?.handleSubagentParentAvailable(parentAvailable);
							}
						} else this.catalogs.set(parentSessionId, {
							entries: this.withCatalogMutations(previous?.entries ?? [], expandableRows, activityRows),
							parentAvailable: this.catalogInflight.get(parentSessionId)?.parentAvailableOverride ?? previous?.parentAvailable ?? false,
							state: "error",
							error: result.error
						});
					} catch (error) {
						const folded = transportError(error);
						this.catalogs.set(parentSessionId, {
							entries: this.withCatalogMutations(previous?.entries ?? [], expandableRows, activityRows),
							parentAvailable: this.catalogInflight.get(parentSessionId)?.parentAvailableOverride ?? previous?.parentAvailable ?? false,
							state: "error",
							error: folded.ok ? null : folded.error
						});
					} finally {
						this.catalogInflight.delete(parentSessionId);
						if (this.catalogStale.delete(parentSessionId)) this.refreshSubagents(parentSessionId);
						this.notifier.markDirty();
					}
				})();
				this.catalogInflight.set(parentSessionId, {
					promise: operation,
					expandableRows,
					activityRows,
					parentAvailableOverride: void 0
				});
				return operation;
			}
			/**
			* Mark whether a catalog menu is consuming live membership updates.
			* @param parentSessionId - catalog owner.
			* @param open - current menu state.
			*/
			setSubagentCatalogOpen(parentSessionId, open) {
				if (open) {
					this.openCatalogs.add(parentSessionId);
					this.refreshSubagents(parentSessionId);
				} else {
					this.openCatalogs.delete(parentSessionId);
					const timer = this.catalogDebounce.get(parentSessionId);
					if (timer !== void 0) {
						clearTimeout(timer);
						this.catalogDebounce.delete(parentSessionId);
					}
				}
			}
			/** Full refresh via session.list (single-flight: an in-flight call is reused). */
			refreshList() {
				if (this.listInflight !== null) return this.listInflight;
				this.listState = "loading";
				this.listError = null;
				const established = this.summaries;
				const mutations = [];
				this.listMutations = mutations;
				this.notifier.markDirty();
				this.listInflight = (async () => {
					try {
						const { result } = await this.api.sessions.list({});
						if (result.ok) {
							const baseline = this.listPhase === "pending" ? result.value.items : mergeOrderedBaseline(established, result.value.items, (summary) => summary.sessionId);
							for (const s of baseline) if (!this.prevRunning.has(s.sessionId)) this.prevRunning.set(s.sessionId, s.running);
							let summaries = baseline;
							for (const mutation of mutations) {
								summaries = applyMutation(summaries, mutation);
								this.summaries = summaries;
								this.syncCompletedNotifications();
							}
							this.summaries = summaries;
							this.listState = "idle";
							this.listPhase = "ready";
							this.syncCompletedNotifications();
							for (const s of this.summaries) {
								const session = this.sessions.get(s.sessionId);
								if (session === void 0) continue;
								session.handleBlank(s.blank);
								session.handleRunning(s.running);
							}
							for (const s of result.value.items) {
								const block = s.projections;
								if (block === void 0) continue;
								const store = this.projectionStore(s.sessionId);
								const values = block.values;
								for (const key of Object.keys(values)) store.apply(key, values[key], block.asOfSeq);
							}
						} else {
							this.listState = "error";
							this.listError = result.error;
						}
					} catch (error) {
						this.listState = "error";
						const folded = transportError(error);
						/* v8 ignore next -- the `? null` arm is unreachable: transportError always returns ok:false. */
						this.listError = folded.ok ? null : folded.error;
					} finally {
						this.listMutations = null;
						this.listInflight = null;
						this.notifier.markDirty();
					}
				})();
				return this.listInflight;
			}
			/**
			* Search visible session message content without adding transient query
			* state to the list snapshot.
			* @param query - non-blank literal phrase.
			* @param signal - cancellation for superseded UI queries.
			* @returns the Host result or a folded transport error.
			*/
			async search(query, signal) {
				try {
					return (await this.api.sessions.search({ query }, signal)).result;
				} catch (error) {
					return transportError(error);
				}
			}
			/**
			* Contract session.create; on success merge into summaries immediately (no
			* wait for the next refresh). A created session is blank by definition
			* (entity birth precedes the first message).
			* @param opts - target workspace or working directory, plus an optional caller-owned id.
			* @returns the create result.
			*/
			async create(opts = {}) {
				try {
					const shared = opts.sessionId === void 0 ? {} : { sessionId: opts.sessionId };
					const payload = opts.workspaceId !== void 0 ? {
						workspaceId: opts.workspaceId,
						...shared
					} : {
						...opts.cwd === void 0 ? {} : { cwd: opts.cwd },
						...shared
					};
					const { result } = await this.api.sessions.create(payload);
					if (result.ok) this.recordMutation({
						kind: "upsert",
						summary: {
							sessionId: result.value.sessionId,
							updatedAt: Date.now(),
							running: false,
							blank: true,
							...opts.cwd !== void 0 ? { cwd: opts.cwd } : {},
							...result.value.agentPreset !== void 0 ? { agentPreset: result.value.agentPreset } : {}
						}
					});
					else {
						const publishedSessionId = workspaceAttachSessionId(result.error);
						if (publishedSessionId !== void 0) this.recordMutation({
							kind: "upsert",
							summary: {
								sessionId: publishedSessionId,
								updatedAt: Date.now(),
								running: false,
								blank: true
							}
						});
					}
					return result;
				} catch (error) {
					return transportError(error);
				}
			}
			/**
			* Contract session.fork; on success merge the child into summaries
			* immediately (same synchronous-addressability guarantee as create). The
			* child carries the source's history, so it is never blank; lineage rides
			* parentSessionId so the list nests it under its source. A child published
			* before Workspace attachment fails is also reconciled into the list.
			* @param opts - source session and the optional seq anchoring the cut.
			* @returns the fork result (the child session id).
			*/
			async fork(opts) {
				try {
					const source = this.summaries.find((s) => s.sessionId === opts.sessionId);
					const { result } = await this.api.sessions.fork({
						sessionId: opts.sessionId,
						...opts.atSeq === void 0 ? {} : { atSeq: opts.atSeq }
					});
					const childId = result.ok ? result.value.sessionId : workspaceAttachSessionId(result.error);
					if (childId !== void 0) this.recordMutation({
						kind: "upsert",
						summary: {
							sessionId: childId,
							updatedAt: Date.now(),
							running: false,
							blank: false,
							parentSessionId: opts.sessionId,
							...source?.cwd !== void 0 ? { cwd: source.cwd } : {}
						}
					});
					return result;
				} catch (error) {
					return transportError(error);
				}
			}
			/**
			* Insert-or-enrich a locally synthesized summary: a new id prepends; an
			* existing entry only gains fields it lacks (the session-added frame and the
			* create() echo race — whichever lands second must fill the placeholder's
			* missing cwd/parentSessionId, never overwrite list-refresh data).
			*/
			mergeSummary(summary) {
				this.recordMutation({
					kind: "upsert",
					summary
				});
			}
			/**
			* Record a host-confirmed composition switch (see ISessions.noteAgentPreset).
			* @param sessionId - the switched session.
			* @param agentPreset - the preset id the host confirmed.
			*/
			noteAgentPreset(sessionId, agentPreset) {
				this.recordMutation({
					kind: "upsert",
					summary: {
						sessionId,
						updatedAt: Date.now(),
						running: false,
						blank: true,
						agentPreset
					}
				});
			}
			/** Apply immediately and retain for replay when a list response is in flight. */
			recordMutation(mutation) {
				this.listMutations?.push(mutation);
				this.summaries = applyMutation(this.summaries, mutation);
				this.syncCompletedNotifications();
				this.notifier.markDirty();
			}
			/**
			* uSES subscription entry for useSessionList.
			* @param listener - change callback.
			* @returns the unsubscribe function.
			*/
			subscribe(listener) {
				return this.notifier.subscribe(listener);
			}
			/**
			* Cached list snapshot (rebuilt lazily when dirty with no listeners).
			* @returns the cached reference (stable until the next flush).
			*/
			getListSnapshot() {
				this.notifier.ensureFresh();
				return this.listSnapshotCache;
			}
			/** Add or refresh one stable pending-interaction identity. */
			trackPending(sessionId, key, status) {
				let interactions = this.pendingInteractions.get(sessionId);
				if (interactions === void 0) {
					interactions = /* @__PURE__ */ new Map();
					this.pendingInteractions.set(sessionId, interactions);
				}
				if (interactions.get(key) === status) return;
				interactions.set(key, status);
				this.notifier.markDirty();
			}
			/** Settle one pending-interaction identity without disturbing sibling waits. */
			resolvePending(sessionId, key) {
				const interactions = this.pendingInteractions.get(sessionId);
				if (interactions === void 0 || !interactions.delete(key)) return;
				if (interactions.size === 0) this.pendingInteractions.delete(sessionId);
				this.notifier.markDirty();
			}
			/**
			* Mux frame entry: sessionId-bearing frames go only to instantiated sessions
			* (no lazy build; non-pending frames for uninstantiated sessions drop —
			* history backfills them on open).
			* @param envelope - the frame with its wire rpcId.
			*/
			handleMuxEnvelope(envelope) {
				const frame = envelope.payload;
				if (frame.type === "stream/error") return;
				if (frame.type === "session/event" && frame.event.type === "user/message" && frame.event.data.source.kind === "user") this.recordMutation({
					kind: "activity",
					sessionId: frame.sessionId,
					updatedAt: frame.event.time
				});
				if (frame.type === "session/projection") {
					this.projectionStore(frame.sessionId).apply(frame.key, frame.value, frame.seq);
					this.notifier.markDirty();
					return;
				}
				if (frame.type === "session/jobs") {
					if (frame.jobs.length === 0) this.jobsBySession.delete(frame.sessionId);
					else this.jobsBySession.set(frame.sessionId, frame.jobs);
					this.notifier.markDirty();
					return;
				}
				if (frame.type === "session/subscribed") {
					this.projectionStores.get(frame.sessionId)?.truncate(frame.lastSeq);
					this.jobsBySession.delete(frame.sessionId);
					this.notifier.markDirty();
					const buffered = this.pendingBuffers.get(frame.sessionId);
					if (buffered !== void 0) {
						const kept = buffered.filter((item) => item.payload.type !== "session/queue");
						if (kept.length !== buffered.length) if (kept.length === 0) this.pendingBuffers.delete(frame.sessionId);
						else this.pendingBuffers.set(frame.sessionId, kept);
					}
				}
				if (frame.type === "approval/requested") this.trackPending(frame.sessionId, `a:${frame.approvalId}`, "approval");
				else if (frame.type === "approval/resolved") this.resolvePending(frame.sessionId, `a:${frame.approvalId}`);
				else if (frame.type === "question/requested") this.trackPending(frame.sessionId, `q:${envelope.rpcId}`, questionInteractionStatus(frame.questions));
				else if (frame.type === "question/resolved") this.resolvePending(frame.sessionId, `q:${frame.questionRpcId}`);
				const session = this.sessions.get(frame.sessionId);
				if (session === void 0) switch (frame.type) {
					case "approval/requested":
					case "question/requested":
					case "session/queue": {
						const buffer = this.pendingBuffers.get(frame.sessionId) ?? [];
						const key = frame.type === "approval/requested" ? `a:${frame.approvalId}` : frame.type === "question/requested" ? `q:${envelope.rpcId}` : "queue";
						const prior = buffer.findIndex((item) => bufferedRequestKey(item) === key);
						if (prior === -1) buffer.push(envelope);
						else buffer[prior] = envelope;
						this.pendingBuffers.set(frame.sessionId, buffer);
						return;
					}
					case "approval/resolved":
					case "question/resolved": {
						const buffer = this.pendingBuffers.get(frame.sessionId);
						if (buffer === void 0) return;
						const key = frame.type === "approval/resolved" ? `a:${frame.approvalId}` : `q:${frame.questionRpcId}`;
						const prior = buffer.findIndex((item) => bufferedRequestKey(item) === key);
						if (prior !== -1) buffer.splice(prior, 1);
						if (buffer.length === 0) this.pendingBuffers.delete(frame.sessionId);
						return;
					}
					default: return;
				}
				session.handleMuxEnvelope(envelope.rpcId, frame);
			}
			/**
			* Host frame entry: list upkeep + per-instance running/removed/agent-error relay.
			* @param envelope - the frame with its wire rpcId.
			*/
			handleHostEnvelope(envelope) {
				const frame = envelope.payload;
				switch (frame.type) {
					case "host/session-added":
						this.mergeSummary({
							sessionId: frame.sessionId,
							updatedAt: Date.now(),
							running: false,
							blank: frame.blank,
							...frame.parentSessionId !== void 0 ? { parentSessionId: frame.parentSessionId } : {},
							...frame.origin !== void 0 ? { origin: frame.origin } : {},
							...frame.cwd !== void 0 ? { cwd: frame.cwd } : {},
							...frame.agentPreset !== void 0 ? { agentPreset: frame.agentPreset } : {}
						});
						this.sessions.get(frame.sessionId)?.handleBlank(frame.blank);
						if (frame.origin === "subagent" && frame.parentSessionId !== void 0) this.markCatalogParentExpandable(frame.parentSessionId);
						if (frame.parentSessionId !== void 0 && (this.selected === frame.parentSessionId || this.openCatalogs.has(frame.parentSessionId))) this.scheduleCatalogRefresh(frame.parentSessionId);
						return;
					case "host/session-removed": {
						const durableSubagent = this.summaries.find((candidate) => candidate.sessionId === frame.sessionId)?.origin === "subagent" || this.addresses.has(frame.sessionId);
						this.recordMutation(durableSubagent ? {
							kind: "status",
							sessionId: frame.sessionId,
							running: false
						} : {
							kind: "remove",
							sessionId: frame.sessionId
						});
						this.updateCatalogActivity(frame.sessionId, false);
						if (durableSubagent) this.sessions.get(frame.sessionId)?.handleRunning(false);
						else this.sessions.get(frame.sessionId)?.handleRemoved();
						this.pendingBuffers.delete(frame.sessionId);
						this.pendingInteractions.delete(frame.sessionId);
						this.jobsBySession.delete(frame.sessionId);
						if (!durableSubagent) this.projectionStores.delete(frame.sessionId);
						const inflightCatalog = this.catalogInflight.get(frame.sessionId);
						if (inflightCatalog !== void 0) {
							inflightCatalog.parentAvailableOverride = false;
							this.catalogStale.add(frame.sessionId);
						}
						const ownedCatalog = this.catalogs.get(frame.sessionId);
						if (ownedCatalog !== void 0 && ownedCatalog.parentAvailable) this.catalogs.set(frame.sessionId, {
							...ownedCatalog,
							parentAvailable: false
						});
						for (const [childId, address] of this.addresses) {
							if (address.parentSessionId !== frame.sessionId) continue;
							this.sessions.get(childId)?.handleSubagentParentAvailable(false);
						}
						return;
					}
					case "host/session-status":
						this.recordMutation({
							kind: "status",
							sessionId: frame.sessionId,
							running: frame.running
						});
						this.sessions.get(frame.sessionId)?.handleRunning(frame.running);
						this.updateCatalogActivity(frame.sessionId, frame.running);
						return;
					case "host/agent-error":
						this.sessions.get(frame.sessionId)?.handleAgentError(frame.message);
						return;
					default: return;
				}
			}
			/**
			* The moment a connection generation dies (before any next-generation frame
			* can arrive — onConnected waits for the readiness handshake while replayed
			* frames flow from stream open, so clearing there would race the replay):
			* drop generation-scoped live state. Interactions resolved while disconnected
			* send no frame, so stale statuses and buffered answerable frames must not
			* survive into the next generation — mux-open replay re-adds every still-pending
			* request with its live rpcId.
			*/
			handleDisconnected() {
				if (this.pendingInteractions.size > 0) {
					this.pendingInteractions.clear();
					this.notifier.markDirty();
				}
				for (const [sessionId, buffer] of [...this.pendingBuffers]) {
					const kept = buffer.filter((item) => item.payload.type !== "approval/requested" && item.payload.type !== "question/requested");
					if (kept.length === buffer.length) continue;
					if (kept.length === 0) this.pendingBuffers.delete(sessionId);
					else this.pendingBuffers.set(sessionId, kept);
				}
			}
			/** After each connection generation: refresh the session baseline and rebuild opened windows. */
			handleConnected() {
				this.refreshList();
				const selectedAddress = this.selected === void 0 ? void 0 : this.addresses.get(this.selected);
				if (selectedAddress !== void 0) this.refreshSubagents(selectedAddress.parentSessionId);
				if (this.selected !== void 0) this.refreshSubagents(this.selected);
				for (const parentSessionId of this.openCatalogs) this.refreshSubagents(parentSessionId);
				for (const session of this.sessions.values()) session.resync();
			}
			/** Debounce membership refetches while one parent catalog is selected or open. */
			scheduleCatalogRefresh(parentSessionId) {
				if (this.catalogDebounce.has(parentSessionId)) return;
				const timer = setTimeout(() => {
					this.catalogDebounce.delete(parentSessionId);
					if (this.catalogInflight.has(parentSessionId)) {
						this.catalogStale.add(parentSessionId);
						return;
					}
					this.refreshSubagents(parentSessionId);
				}, 50);
				this.catalogDebounce.set(parentSessionId, timer);
			}
			/** Apply one Agent-driver transition to loaded and in-flight catalogs. */
			updateCatalogActivity(childSessionId, running) {
				const activity = running ? "running" : "inactive";
				for (const inflight of this.catalogInflight.values()) inflight.activityRows.set(childSessionId, activity);
				let changed = false;
				for (const [parentSessionId, catalog] of this.catalogs) {
					if (!catalog.entries.some((entry) => entry.kind === "child" && entry.id === childSessionId && entry.activity !== activity)) continue;
					const entries = catalog.entries.map((entry) => {
						if (entry.kind !== "child" || entry.id !== childSessionId) return entry;
						return {
							...entry,
							activity
						};
					});
					changed = true;
					this.catalogs.set(parentSessionId, {
						...catalog,
						entries
					});
				}
				if (changed) this.notifier.markDirty();
			}
			/** Preserve and project a positive expandability hint after one direct subagent publishes. */
			markCatalogParentExpandable(parentSessionId) {
				this.applyCatalogParentExpandable(parentSessionId);
				for (const inflight of this.catalogInflight.values()) inflight.expandableRows.add(parentSessionId);
			}
			/** Apply one positive expandability hint to every loaded catalog containing that unique row id. */
			applyCatalogParentExpandable(parentSessionId) {
				let changed = false;
				for (const [catalogParentId, catalog] of this.catalogs) {
					if (!catalog.entries.some((entry) => entry.kind === "child" && entry.id === parentSessionId && !entry.hasChildren)) continue;
					const entries = catalog.entries.map((entry) => {
						if (entry.kind !== "child" || entry.id !== parentSessionId || entry.hasChildren) return entry;
						return {
							...entry,
							hasChildren: true
						};
					});
					changed = true;
					this.catalogs.set(catalogParentId, {
						...catalog,
						entries
					});
				}
				if (changed) this.notifier.markDirty();
			}
			/** Fold request-local row mutations into one catalog result before publication. */
			withCatalogMutations(entries, expandableRows, activityRows) {
				return entries.map((entry) => {
					if (entry.kind !== "child") return entry;
					const activity = activityRows.get(entry.id);
					if (!expandableRows.has(entry.id) && activity === void 0) return entry;
					return {
						...entry,
						...expandableRows.has(entry.id) ? { hasChildren: true } : {},
						...activity === void 0 ? {} : { activity }
					};
				});
			}
			/**
			* Reconcile completion reminders against the latest summaries, eagerly after
			* every mutation and pull (a snapshot-build-time pass would collapse
			* consecutive status frames into one observation). A running→idle edge of a
			* non-selected session arms its reminder; running disarms it; removal drops
			* it. First observation only records the running bit — sessions already
			* idle at load get no reminder.
			*/
			syncCompletedNotifications() {
				const seen = /* @__PURE__ */ new Set();
				for (const s of this.summaries) {
					seen.add(s.sessionId);
					const prev = this.prevRunning.get(s.sessionId);
					if (prev === void 0) {
						this.prevRunning.set(s.sessionId, s.running);
						continue;
					}
					if (prev && !s.running) {
						if (s.sessionId !== this.selected) this.completedNotifications.add(s.sessionId);
					} else if (s.running) this.completedNotifications.delete(s.sessionId);
					this.prevRunning.set(s.sessionId, s.running);
				}
				for (const id of this.prevRunning.keys()) if (!seen.has(id)) this.prevRunning.delete(id);
				for (const id of this.completedNotifications) if (!seen.has(id)) this.completedNotifications.delete(id);
			}
			buildListSnapshot() {
				const merged = this.summaries.map((summary) => {
					const projectionStore = this.projectionStores.get(summary.sessionId);
					const title = projectionStore?.get("title");
					const projectionValues = projectionStore?.values();
					return {
						...summary,
						...typeof title === "string" && title !== "" ? { title } : {},
						...projectionValues === void 0 ? {} : { projectionValues }
					};
				});
				const pendingInteractions = /* @__PURE__ */ new Map();
				for (const [sessionId, interactions] of this.pendingInteractions) {
					const statuses = [...interactions.values()];
					const status = statuses.find((candidate) => candidate !== "approval") ?? statuses[0];
					if (status !== void 0) pendingInteractions.set(sessionId, status);
				}
				const items = flattenLineage(merged, pendingInteractions, this.completedNotifications).map((entry) => {
					const prev = this.entryCache.get(entry.sessionId);
					if (prev !== void 0 && prev.updatedAt === entry.updatedAt && prev.running === entry.running && prev.blank === entry.blank && prev.agentPreset === entry.agentPreset && prev.parentSessionId === entry.parentSessionId && prev.cwd === entry.cwd && prev.origin === entry.origin && prev.title === entry.title && prev.depth === entry.depth && prev.pendingInteraction === entry.pendingInteraction && prev.projectionValues === entry.projectionValues && prev.completed === entry.completed) return prev;
					this.entryCache.set(entry.sessionId, entry);
					return entry;
				});
				for (const id of this.entryCache.keys()) if (!items.some((e) => e.sessionId === id)) this.entryCache.delete(id);
				if (!(items.length === this.itemsCache.length && items.every((e, i) => e === this.itemsCache[i]))) this.itemsCache = items;
				const selected = this.selected;
				const current = selected !== void 0 && (items.some((item) => item.sessionId === selected) || this.addresses.has(selected)) ? selected : void 0;
				return {
					items: this.itemsCache,
					current,
					state: this.listState,
					phase: this.listPhase,
					error: this.listError,
					subagentsByParent: Object.fromEntries(this.catalogs),
					jobsBySession: Object.fromEntries(this.jobsBySession),
					currentAddress: current === void 0 ? void 0 : this.addresses.get(current)
				};
			}
		};
		/** Apply one list mutation without deriving display order. */
		function applyMutation(summaries, mutation) {
			switch (mutation.kind) {
				case "upsert": {
					const existing = summaries.find((summary) => summary.sessionId === mutation.summary.sessionId);
					if (existing === void 0) return [mutation.summary, ...summaries];
					const filled = {
						...existing,
						blank: existing.blank && mutation.summary.blank,
						...existing.cwd === void 0 && mutation.summary.cwd !== void 0 ? { cwd: mutation.summary.cwd } : {},
						...existing.parentSessionId === void 0 && mutation.summary.parentSessionId !== void 0 ? { parentSessionId: mutation.summary.parentSessionId } : {},
						...existing.origin === void 0 && mutation.summary.origin !== void 0 ? { origin: mutation.summary.origin } : {},
						...mutation.summary.agentPreset !== void 0 ? { agentPreset: mutation.summary.agentPreset } : {}
					};
					if (filled.cwd === existing.cwd && filled.parentSessionId === existing.parentSessionId && filled.origin === existing.origin && filled.blank === existing.blank && filled.agentPreset === existing.agentPreset) return [...summaries];
					return summaries.map((summary) => summary.sessionId === mutation.summary.sessionId ? filled : summary);
				}
				case "remove": return summaries.filter((summary) => summary.sessionId !== mutation.sessionId);
				case "status": return summaries.map((summary) => summary.sessionId === mutation.sessionId && (summary.running !== mutation.running || mutation.running && summary.blank) ? {
					...summary,
					running: mutation.running,
					blank: summary.blank && !mutation.running
				} : summary);
				case "activity": return summaries.map((summary) => summary.sessionId === mutation.sessionId && mutation.updatedAt > summary.updatedAt ? {
					...summary,
					updatedAt: mutation.updatedAt
				} : summary);
				case "engaged": return summaries.map((summary) => summary.sessionId === mutation.sessionId && summary.blank ? {
					...summary,
					blank: false
				} : summary);
			}
		}
		/** Temporary source-plane bridge while the Host contract and client project build independently. */
		function workspaceAttachSessionId(error) {
			const candidate = error;
			return candidate.code === "workspace-attach-failed" ? candidate.details.sessionId : void 0;
		}
		//#endregion
		//#region lib/types/client/sessions/provide.js
		/**
		* Provider roster + materialization + current projection. The channel owns
		* every rule a provider contribution must satisfy; owners keep only their
		* per-session bundle storage and the definition of "current".
		*/
		var SessionProvideChannel = class {
			host;
			providers = [];
			maybeInfoCache;
			/** Latest published current bundle (identity comparison dedupes republish). */
			currentSnapshot;
			/** Projection subscribers (plain cell: bundles hold live session sources, so no store freeze may touch them). */
			listeners = /* @__PURE__ */ new Set();
			/**
			* Atomic current-session provide projection: selection changes and
			* provider-roster changes publish through this one source, so a roster
			* change under a stable current id republishes the bundle instead of
			* stranding mounted entries.
			*/
			currentProvideInfo;
			/**
			* @param host - owner-side bundle storage and current-selection resolution.
			*/
			constructor(host) {
				this.host = host;
				this.providers.push({
					hooks: ["session"],
					resolve: (binding) => ({ hooks: { session: binding.session } })
				});
				this.maybeInfoCache = this.materializeMaybeInfo();
				this.currentSnapshot = this.maybeInfoCache;
				this.currentProvideInfo = {
					getSnapshot: () => this.currentSnapshot,
					subscribe: (fn) => {
						this.listeners.add(fn);
						return () => {
							this.listeners.delete(fn);
						};
					}
				};
			}
			/** The static no-session projection under the current roster (declared names present, values undefined). */
			get maybeInfo() {
				return this.maybeInfoCache;
			}
			/**
			* Register a per-session standard-props provider (see
			* SessionRuntime.provide for the product contract). Live bundles rebuild
			* immediately; misdeclared providers fail loud here, at the registration
			* edge, and the registration rolls back — the channel never stays on a
			* roster it cannot materialize.
			* @param descriptor - static member roster plus per-session resolver.
			* @returns disposer removing the provider.
			*/
			provide(descriptor) {
				this.providers.push(descriptor);
				try {
					this.applyRosterChange();
				} catch (error) {
					this.providers.splice(this.providers.indexOf(descriptor), 1);
					this.applyRosterChange();
					throw error;
				}
				return () => {
					const at = this.providers.indexOf(descriptor);
					if (at >= 0) this.providers.splice(at, 1);
					this.applyRosterChange();
				};
			}
			/**
			* Re-derive the current selection's bundle and publish it when it changed.
			* Bundles are identity-stable per (scope, roster) materialization, so an
			* identity compare is exact; synchronous notify — call sites (the owner's
			* list subscription, provide()) already sit behind their own batching or
			* registration edges.
			*/
			publishCurrent() {
				const next = this.host.resolveCurrent();
				if (next === this.currentSnapshot) return;
				this.currentSnapshot = next;
				for (const fn of [...this.listeners]) try {
					fn();
				} catch (error) {
					console.error("sessions.currentProvideInfo subscriber failed:", error);
				}
			}
			/**
			* Materialize the standard-props bundle for one session (fails loud on
			* undeclared, missing, and duplicate member names).
			* @param binding - session assembly handle fed to every resolver.
			* @returns the materialized bundle (identity-stable until the next materialization).
			*/
			materializeInfo(binding) {
				const hooks = {};
				const props = {};
				for (const descriptor of this.providers) {
					const contribution = descriptor.resolve(binding);
					const contributedHooks = contribution.hooks ?? {};
					const contributedProps = contribution.props ?? {};
					for (const name of Object.keys(contributedHooks)) if (!(descriptor.hooks ?? []).includes(name)) throw new Error(`sessions.provide: undeclared hook "${name}"`);
					for (const name of Object.keys(contributedProps)) if (!(descriptor.props ?? []).includes(name)) throw new Error(`sessions.provide: undeclared prop "${name}"`);
					for (const name of descriptor.hooks ?? []) {
						const source = contributedHooks[name];
						if (source === void 0) throw new Error(`sessions.provide: missing hook "${name}"`);
						if (Object.hasOwn(hooks, name)) throw new Error(`sessions.provide: duplicate hook "${name}"`);
						hooks[name] = source;
					}
					for (const name of descriptor.props ?? []) {
						if (!Object.hasOwn(contributedProps, name)) throw new Error(`sessions.provide: missing prop "${name}"`);
						if (Object.hasOwn(props, name)) throw new Error(`sessions.provide: duplicate prop "${name}"`);
						props[name] = contributedProps[name];
					}
				}
				return {
					sessionId: binding.sessionId,
					hooks,
					props,
					projections: { faceOf: (key) => binding.session.projections.faceOf(key) }
				};
			}
			/** Rebuild the static projection and the owner's live bundles, then republish the current one. */
			applyRosterChange() {
				this.maybeInfoCache = this.materializeMaybeInfo();
				this.host.rebuildBundles();
				this.publishCurrent();
			}
			/** Build the static no-session kit and reject duplicate declared names. */
			materializeMaybeInfo() {
				const hooks = {};
				const props = {};
				for (const descriptor of this.providers) {
					for (const name of descriptor.hooks ?? []) {
						if (Object.hasOwn(hooks, name)) throw new Error(`sessions.provide: duplicate hook "${name}"`);
						hooks[name] = void 0;
					}
					for (const name of descriptor.props ?? []) {
						if (Object.hasOwn(props, name)) throw new Error(`sessions.provide: duplicate prop "${name}"`);
						props[name] = void 0;
					}
				}
				return {
					sessionId: void 0,
					hooks,
					props
				};
			}
		};
		//#endregion
		//#region lib/types/client/sessions/service.js
		/** Structured session-create failure. */
		var SessionCreateError = class extends Error {
			rpcError;
			requestedSessionId;
			name = "SessionCreateError";
			/**
			* @param rpcError - Host business or folded transport error.
			* @param requestedSessionId - caller-preallocated id used for later stream/list reconciliation.
			*/
			constructor(rpcError, requestedSessionId) {
				super(`session create failed: ${rpcError.code}: ${rpcError.message}`);
				this.rpcError = rpcError;
				this.requestedSessionId = requestedSessionId;
			}
		};
		/** Structured session-fork failure. */
		var SessionForkError = class extends Error {
			rpcError;
			sourceSessionId;
			name = "SessionForkError";
			/**
			* @param rpcError - Host business or folded transport error.
			* @param sourceSessionId - the session the fork was cut from.
			*/
			constructor(rpcError, sourceSessionId) {
				super(`session fork failed: ${rpcError.code}: ${rpcError.message}`);
				this.rpcError = rpcError;
				this.sourceSessionId = sourceSessionId;
			}
		};
		/**
		* Workspace display title of a session cwd: the path's last non-empty
		* segment (both separators accepted; trailing separators ignored), or ''
		* for separator-only paths — callers own their fallback (session id, raw
		* cwd, default-directory copy). The repo-wide single basename derivation —
		* every surface naming a workspace (picker rows, toggle labels, list titles)
		* calls this instead of re-splitting paths.
		* @param cwd - workspace directory path.
		* @returns basename title, or '' when no non-empty segment exists.
		*/
		function workspaceTitleOf(cwd) {
			return cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "";
		}
		/**
		* Display title projection: durable title, project directory basename, then
		* the raw id.
		*/
		function displayTitleOf(title, cwd, id) {
			if (title !== void 0) return title;
			if (cwd !== void 0 && cwd !== "") {
				const base = workspaceTitleOf(cwd);
				if (base !== "") return base;
			}
			return id;
		}
		/**
		* Increment a trailing fork number while preserving its half-width or
		* full-width parentheses; an unnumbered title starts with ` (1)`.
		* @param title - source session's durable title.
		* @returns the title assigned to the fork child.
		*/
		function increasedForkTitle(title) {
			const ascii = /^(.*?)\((\d+)\)$/u.exec(title);
			if (ascii?.[1] !== void 0 && ascii[2] !== void 0) return `${ascii[1]}(${BigInt(ascii[2]) + 1n})`;
			const fullWidth = /^(.*?)（(\d+)）$/u.exec(title);
			if (fullWidth?.[1] !== void 0 && fullWidth[2] !== void 0) return `${fullWidth[1]}（${BigInt(fullWidth[2]) + 1n}）`;
			return `${title} (1)`;
		}
		/** Root sessions service: list store, current selection, object-layer manager, scope tree, bindings, and breadcrumb routes. */
		var SessionRuntime = class {
			rootCtx;
			/**
			* The wire schema's own result bound, re-exposed for presentation plugins as
			* injected data. Not per-connection state: the `session.search` response
			* schema caps `items` at this constant, so every transport (fixture included)
			* reports the same number.
			*/
			searchResultLimit = 20;
			/** List snapshot store (list RPC + host stream increments; re-pulled on reconnect) — the useSessions standard feed, current included. */
			list;
			/** The object-layer instance cluster and frame dispatch entry. */
			manager;
			/**
			* Atomic current-session provide projection: selection changes and
			* provider-roster changes publish through this one source (the renderer
			* host's `sessions.provide` feed), so a roster change under a stable
			* current id republishes the bundle instead of stranding mounted entries.
			*/
			currentProvideInfo;
			/**
			* Persisted selection cell (the durable half of `list.current`). Private on
			* purpose: reads go through the list snapshot; writes through {@link
			* SessionRuntime.open} / {@link SessionRuntime.clear}. Projection
			* validates it against the live list instead of destructively pruning, so a
			* selection survives transient list states (reconnect re-pull) and
			* resurfaces when its session returns.
			*/
			selection;
			scopes = /* @__PURE__ */ new Map();
			/** The provide channel (roster, materialization rules, current projection) — shared with the test runtime's double. */
			provideChannel;
			/**
			* The staged session id — follows `list.current` exactly, holding its last
			* defined value across masked gaps (a transiently absent selection blanks
			* `current` without moving the stage, so reconnect re-pulls and removals
			* keep the staged scope's frozen view alive until the stage moves on).
			*/
			watched;
			/** Removed-while-staged sessions whose teardown waits for the stage to move away. */
			deferredRemovals = /* @__PURE__ */ new Set();
			/**
			* @param ctx - client root context (scope fibers mount under it).
			* @param api - wire client shared with every Session.
			* @param remote - generated Remote namespaces shared with every Session.
			* @param conversationRuntime - same-pass registry instances, when runtime apply owns them.
			*/
			constructor(rootCtx, api, remote, conversationRuntime) {
				this.rootCtx = rootCtx;
				this.selection = createSnapshotStore({}, { persist: { name: "dsh.sessions.current" } });
				const restored = this.selection.getSnapshot();
				const conversationEvents = rootCtx.get("conversationEvents");
				const conversationViews = rootCtx.get("conversationViews");
				const conversation = conversationRuntime ?? (conversationEvents === void 0 || conversationViews === void 0 ? void 0 : {
					events: conversationEvents,
					views: conversationViews
				});
				this.manager = new SessionManager(api, remote, restored.sessionId, restored.subagentAddress, conversation);
				this.list = createSnapshotStore({
					ids: [],
					byId: {},
					current: void 0,
					phase: "pending",
					subagentsByParent: {},
					jobsBySession: {},
					currentAddress: void 0
				});
				this.manager.subscribe(() => {
					this.projectList();
				});
				this.list.subscribe(() => {
					this.followCurrent();
					this.provideChannel.publishCurrent();
				});
				this.provideChannel = new SessionProvideChannel({
					rebuildBundles: () => {
						for (const record of this.scopes.values()) record.provideInfo = this.provideChannel.materializeInfo(record.binding);
					},
					resolveCurrent: () => this.maybeProvideInfo(this.list.getSnapshot().current)
				});
				this.currentProvideInfo = this.provideChannel.currentProvideInfo;
				let registryRebuildQueued = false;
				const scheduleRegistryRebuild = () => {
					if (registryRebuildQueued) return;
					registryRebuildQueued = true;
					queueMicrotask(() => {
						registryRebuildQueued = false;
						this.manager.rebuildConversationRegistry();
					});
				};
				if (conversation !== void 0) rootCtx.effect(() => {
					const disposeEvents = conversation.events.subscribe(scheduleRegistryRebuild);
					const disposeViews = conversation.views.subscribe(scheduleRegistryRebuild);
					return () => {
						disposeEvents();
						disposeViews();
					};
				}, "sessions: conversation registry rebuild");
				rootCtx.reflect.provide("sessions", this, void 0);
			}
			/**
			* Register a per-session standard-props provider: every session-scope slot
			* component receives the contributed members as standard props (`hooks`
			* sources become `use<Name>` selector hooks on the render side; `props`
			* spread verbatim). Contributions materialize lazily with the session's
			* scope record and die with it. Registration order is resolution order;
			* duplicate member names fail loud at materialization.
			* @param descriptor - static member roster plus per-session resolver.
			* @returns disposer removing the provider (already-materialized bundles keep their members until their scope drops).
			*/
			provide(descriptor) {
				return this.provideChannel.provide(descriptor);
			}
			/**
			* Select a listed or retained catalog-addressed session as current.
			* @param id - listed or addressed session id.
			*/
			open(id) {
				this.manager.select(id);
			}
			/**
			* Open a healthy catalog child through its direct-parent address.
			* @param address - catalog-derived parent and child ids.
			*/
			openSubagent(address) {
				this.manager.selectSubagent(address);
			}
			/**
			* Resolve an already discovered direct-parent address without opening it.
			* Feature plugins use this to avoid Agent-bound RPCs in persisted child views.
			* @param id - possible addressed child id.
			* @returns The retained address, when present.
			*/
			subagentAddress(id) {
				return this.manager.subagentAddress(id);
			}
			/**
			* Inform the runtime whether a catalog menu is consuming membership updates.
			* @param parentSessionId - selected parent.
			* @param open - menu state.
			*/
			setSubagentCatalogOpen(parentSessionId, open) {
				this.manager.setSubagentCatalogOpen(parentSessionId, open);
			}
			/**
			* Refresh one direct-child catalog.
			* @param parentSessionId - catalog owner.
			*/
			refreshSubagents(parentSessionId) {
				return this.manager.refreshSubagents(parentSessionId);
			}
			noteAgentPreset(sessionId, agentPreset) {
				this.manager.noteAgentPreset(sessionId, agentPreset);
			}
			/**
			* Clear the current selection so the layout shows the no-session empty
			* state (new-session affordance and the workspace preselection flow).
			* Wipes the persisted selection too — a reload stays on empty until the
			* user opens or starts a session. The staged scope keeps its frozen view
			* per the masked-gap contract until the next open() moves the stage.
			*/
			clear() {
				this.manager.clearSelection();
			}
			/**
			* Refresh the real Session baseline, reusing an in-flight pull.
			* @returns completion of the current or newly started baseline pull.
			*/
			refresh() {
				return this.manager.refreshList();
			}
			/**
			* Search the Host's visible message-content index. Results stay
			* request-local; the list snapshot remains the metadata authority.
			* @param query - non-blank literal phrase.
			* @param signal - cancellation for a superseded search.
			* @returns bounded results or a business/transport error.
			*/
			search(query, signal) {
				return this.manager.search(query, signal);
			}
			/**
			* Route a mux stream envelope into the Session object layer.
			* @param envelope - validated mux stream envelope.
			*/
			handleMuxEnvelope(envelope) {
				this.manager.handleMuxEnvelope(envelope);
			}
			/**
			* Route a Host stream envelope into the Session object layer.
			* @param envelope - validated Host stream envelope.
			*/
			handleHostEnvelope(envelope) {
				this.manager.handleHostEnvelope(envelope);
			}
			/** Rebuild the Session baseline and every opened window after connection. */
			handleConnected() {
				this.manager.handleConnected();
			}
			/** Drop generation-scoped live interaction state the moment a connection generation dies. */
			handleDisconnected() {
				this.manager.handleDisconnected();
			}
			/**
			* Create a session on the host. Resolution guarantee: by the time the
			* promise resolves, the created session is in the list store and
			* {@link SessionRuntime.binding} resolves it — callers (New Session
			* draft hand-off) may address the scope synchronously, without waiting a
			* notifier flush. The synchronous projection below makes this structural
			* rather than an accident of microtask ordering.
			* @param opts - target workspace or directory and an optional preallocated id.
			* @returns the new session id.
			* @throws {SessionCreateError} with the requested id.
			*/
			async create(opts = {}) {
				const result = await this.manager.create(opts);
				if (!result.ok) throw new SessionCreateError(result.error, opts.sessionId);
				this.projectList();
				return result.value.sessionId;
			}
			/**
			* Fork a session from a completed-turn prefix of the source (same
			* synchronous-addressability guarantee as {@link SessionRuntime.create}:
			* on resolution the child is in the list store and open() can target it).
			* @param opts - source session id, the optional event seq anchoring the
			*   cut (the boundary is the first turn/end at or after it; an in-log
			*   anchor in an open turn is unavailable rather than clipped backward),
			*   and whether to increment an inherited durable title before resolving.
			*   A fractional anchor floors to a real event seq: the frozen nodes of an
			*   interrupted turn carry flow-ordering seqs between two events, and the
			*   wire takes integers only.
			* @returns the child session id.
			* @throws {SessionForkError} with the source id.
			* @throws {Error} when a requested child-title rename fails after creation.
			*/
			async fork(opts) {
				const sourceTitle = opts.increaseTitle ? this.list.getSnapshot().byId[opts.sessionId]?.title : void 0;
				const result = await this.manager.fork({
					sessionId: opts.sessionId,
					...opts.atSeq === void 0 ? {} : { atSeq: Math.floor(opts.atSeq) }
				});
				if (!result.ok) throw new SessionForkError(result.error, opts.sessionId);
				this.projectList();
				const childId = result.value.sessionId;
				if (sourceTitle !== void 0) {
					const child = this.binding(childId)?.session;
					if (child === void 0) throw new Error(`fork child "${childId}" is not locally addressable`);
					const renamed = await child.rename(increasedForkTitle(sourceTitle));
					if (!renamed.ok) throw new Error(`fork child rename failed: ${renamed.error.code}: ${renamed.error.message}`);
				}
				return childId;
			}
			/**
			* Resolve an Agent-scoped context view (use-and-discard).
			* @param id - session id (the agent identity — 1:1 same axis).
			* @returns scoped ctx, or undefined for a session neither listed nor already scoped.
			*/
			scope(id) {
				return this.resolve(id)?.ctx;
			}
			/**
			* Read the Agent scope tag off a context. Service-method boundary: fetch
			* bundles must reach scope resolution through ctx.sessions — a cross-bundle
			* value import of the standalone helper would inline a second module
			* instance whose private tag Symbol never matches.
			* @param ctx - any client context.
			* @returns the session id, or undefined on root contexts.
			*/
			scopeOf(ctx) {
				return scopeOf(ctx);
			}
			/**
			* Resolve the business Session behind an Agent-scoped context — the one
			* hop every scoped consumer (event listeners, per-session controllers)
			* takes from ctx-space into object-space (the client mirror of host
			* `agent.session`). Same service-method boundary as
			* {@link SessionRuntime.scopeOf}.
			* @param ctx - an Agent-scoped context.
			* @returns the session face, or undefined when the ctx is untagged or its scope was pruned.
			*/
			sessionOf(ctx) {
				const id = scopeOf(ctx);
				if (id === void 0) return void 0;
				return this.scopes.get(id)?.binding.session;
			}
			/**
			* Resolve the stable session binding (scope-addressed assembly feed). Pure
			* resolution — no staging, no window side effects.
			* @param id - session id.
			* @returns binding, or undefined for a session neither listed nor already scoped.
			*/
			binding(id) {
				return this.resolve(id)?.binding;
			}
			/**
			* Resolve one session's render-layer standard-props bundle (ctx never
			* enters the render layer; the renderer subscribes to
			* {@link SessionRuntime.currentProvideInfo}). Pure resolution — render-safe:
			* no staging, no window side effects (StrictMode double-invokes and
			* concurrent discarded passes must stay free).
			*/
			provideInfo(id) {
				return this.resolve(id)?.provideInfo;
			}
			/**
			* Resolve the current-session-optional standard kit. Unknown or absent ids
			* return the static no-session projection rather than removing hook props.
			*/
			maybeProvideInfo(id) {
				return (id === void 0 ? void 0 : this.provideInfo(id)) ?? this.provideChannel.maybeInfo;
			}
			/**
			* Move the stage to the list's current session: sweep teardowns deferred
			* behind the previous occupant and pull the new occupant's history window.
			* Staging IS the open signal — the window opens ⟺ the session is on stage
			* — and open() is idempotent (an in-flight or completed open no-ops; a
			* failed one retries the next time current is touched).
			*/
			followCurrent() {
				const snapshot = this.list.getSnapshot();
				const current = snapshot.current;
				if (current === void 0 || snapshot.byId[current] === void 0 || current === this.watched) return;
				this.watched = current;
				this.sweepDeferred();
				const record = this.resolve(current);
				/* v8 ignore next 3 -- defensive: current is always a listed id (open()
				* validates and the projection masks absent selections), so resolve
				* cannot miss; kept so a future current writer cannot crash the notify. */
				if (record !== void 0) {
					record.session.open();
					this.manager.refreshSubagents(current);
				}
			}
			/**
			* Lazily mint the scope + binding for an eligible session. Eligibility and
			* prune share one predicate: listed on the host or selected
			* through a retained subagent address. Breadcrumb-only ancestors remain
			* summary data and do not keep scopes alive.
			*/
			resolve(id) {
				const existing = this.scopes.get(id);
				if (existing !== void 0) return existing;
				if (!this.eligible(id)) return void 0;
				const { fiber, ctx } = createScope(this.rootCtx, id);
				const session = this.manager.get(id);
				session.bindScope(ctx);
				const binding = {
					sessionId: id,
					session,
					ctx
				};
				const record = {
					fiber,
					ctx,
					binding,
					session,
					provideInfo: this.provideChannel.materializeInfo(binding)
				};
				this.scopes.set(id, record);
				return record;
			}
			/** The one aliveness predicate shared by scope mint and prune: host-listed or currently addressed. */
			eligible(id) {
				const { ids, current } = this.list.getSnapshot();
				return current === id || ids.includes(id);
			}
			/** Project the manager's list snapshot into the store (title derivation is display-only). */
			projectList() {
				const { items, current, phase, subagentsByParent, jobsBySession, currentAddress } = this.manager.getListSnapshot();
				const ids = [];
				const byId = {};
				for (const entry of items) {
					ids.push(entry.sessionId);
					byId[entry.sessionId] = {
						id: entry.sessionId,
						displayTitle: displayTitleOf(entry.title, entry.cwd, entry.sessionId),
						running: entry.running,
						...entry.completed ? { completed: true } : {},
						blank: entry.blank,
						updatedAt: entry.updatedAt,
						...entry.pendingInteraction === void 0 ? {} : { pendingInteraction: entry.pendingInteraction },
						...entry.projectionValues === void 0 ? {} : { projectionValues: entry.projectionValues },
						...entry.title !== void 0 ? { title: entry.title } : {},
						...entry.cwd !== void 0 ? { cwd: entry.cwd } : {},
						...entry.parentSessionId !== void 0 ? { parentId: entry.parentSessionId } : {},
						...entry.origin !== void 0 ? { origin: entry.origin } : {},
						...entry.agentPreset !== void 0 ? { agentPreset: entry.agentPreset } : {}
					};
				}
				if (current !== void 0 && currentAddress !== void 0) {
					const seen = /* @__PURE__ */ new Set();
					let address = currentAddress;
					while (address !== void 0 && !seen.has(address.childSessionId)) {
						const childId = address.childSessionId;
						seen.add(childId);
						const child = subagentsByParent[address.parentSessionId]?.entries.find((entry) => entry.kind === "child" && entry.id === childId);
						if (child?.kind !== "child") break;
						const displayTitle = child.label ?? childId;
						const summary = byId[childId];
						if (summary === void 0) byId[childId] = {
							id: childId,
							displayTitle,
							parentId: address.parentSessionId,
							origin: "subagent",
							running: child.activity === "running",
							blank: false,
							updatedAt: 0
						};
						else if (summary.displayTitle !== displayTitle) byId[childId] = {
							...summary,
							displayTitle
						};
						const parent = byId[address.parentSessionId];
						if (parent !== void 0 && parent.origin !== "subagent") break;
						address = this.manager.navigationAddress(address.parentSessionId);
					}
				}
				const persisted = this.selection.getSnapshot().sessionId;
				if (current === void 0) {
					if (persisted !== void 0) this.selection.set({});
				} else if (byId[current] !== void 0 && (persisted !== current || this.selection.getSnapshot().subagentAddress?.childSessionId !== currentAddress?.childSessionId || this.selection.getSnapshot().subagentAddress?.parentSessionId !== currentAddress?.parentSessionId || this.selection.getSnapshot().subagentAddress?.mode !== currentAddress?.mode)) this.selection.set({
					sessionId: current,
					...currentAddress === void 0 ? {} : { subagentAddress: currentAddress }
				});
				this.list.set({
					ids,
					byId,
					current,
					phase,
					subagentsByParent,
					jobsBySession,
					currentAddress
				});
				this.pruneScopes();
			}
			/** Tear down scope + instance for no-longer-eligible sessions off stage; the staged one defers until the stage moves. */
			pruneScopes() {
				for (const [id, record] of this.scopes) {
					if (this.eligible(id)) continue;
					if (id === this.watched) {
						this.deferredRemovals.add(id);
						continue;
					}
					this.scopes.delete(id);
					this.deferredRemovals.delete(id);
					this.dropScope(id, record);
				}
			}
			/**
			* One teardown for the whole per-session axis: the scope
			* fiber (cascading every actx-registered effect: input shell, slash
			* controller, popup, plugin stores, listeners), the session-keyed slot
			* stores, and the Session instance itself — the host session log is the
			* durable truth, a reopen lazily rebuilds and backfills via open().
			*/
			dropScope(id, record) {
				record.fiber.dispose();
				record.session.unbindScope();
				this.rootCtx.get("slots")?.pruneStoreScope(id);
				this.manager.drop(id);
			}
			/** Run deferred teardowns whose session is no longer staged (called when the stage moves). */
			sweepDeferred() {
				for (const id of [...this.deferredRemovals]) {
					/* v8 ignore next -- defensive: only the staged id ever defers, and every
					* stage move sweeps first, so the set cannot contain the id the stage just
					* moved to; kept as a guard against future extra sweep call sites. */
					if (id === this.watched) continue;
					if (this.eligible(id)) {
						this.deferredRemovals.delete(id);
						continue;
					}
					const record = this.scopes.get(id);
					this.deferredRemovals.delete(id);
					/* v8 ignore next -- defensive: prune deletes a scope and its deferral
					* together, so a deferred id always still owns its record; kept so a
					* future teardown path cannot double-dispose. */
					if (record !== void 0) {
						this.scopes.delete(id);
						this.dropScope(id, record);
					}
				}
			}
		};
		//#endregion
		//#region lib/types/client/workspaces/workspace.js
		/** React-free Workspace entity with a client-local materialization lifecycle. */
		/**
		* Observable Workspace object whose identity survives Host materialization.
		* Local instances retain their create input and failure state; materialized
		* instances expose the latest Host view.
		*/
		var Workspace = class {
			api;
			view;
			intent;
			materialization = null;
			snapshotCache;
			notifier = new Notifier(() => {
				this.snapshotCache = this.buildSnapshot();
			});
			/**
			* @param api - shared wire client.
			* @param source - local create input or an existing Host Workspace view.
			*/
			constructor(api, source) {
				this.api = api;
				if ("workspaceId" in source) this.view = source;
				else this.intent = {
					input: source,
					snapshot: {
						name: intentName(source),
						phase: "ready"
					}
				};
				this.snapshotCache = this.buildSnapshot();
			}
			/**
			* Materialize this local Workspace through the Host create API.
			* Re-entry shares the in-flight completion; a materialized instance returns undefined.
			* @returns the Host result, or undefined when this Workspace is already materialized.
			*/
			materialize() {
				if (this.materialization !== null) return this.materialization;
				const intent = this.intent;
				if (intent === void 0) return void 0;
				intent.snapshot = {
					name: intent.snapshot.name,
					phase: "creating"
				};
				this.notifier.notifyNow();
				const completion = this.completeMaterialization(intent).finally(() => {
					if (this.materialization === completion) this.materialization = null;
				});
				this.materialization = completion;
				return completion;
			}
			/**
			* Adopt a Host view without replacing this Workspace object.
			* An existing materialized identity accepts updates only for the same Workspace id.
			* @param view - latest Host projection.
			*/
			adopt(view) {
				if (this.view !== void 0 && this.view.workspaceId !== view.workspaceId) throw new Error("cannot adopt a different Workspace id");
				this.view = view;
				this.intent = void 0;
				this.notifier.markDirty();
			}
			/**
			* Subscribe to Workspace snapshot invalidation.
			* @param listener - snapshot invalidation callback.
			* @returns unsubscribe function.
			*/
			subscribe(listener) {
				return this.notifier.subscribe(listener);
			}
			/**
			* Read the cached Workspace snapshot after flushing pending notifications.
			* @returns the cached Workspace snapshot.
			*/
			getSnapshot() {
				this.notifier.ensureFresh();
				return this.snapshotCache;
			}
			async completeMaterialization(intent) {
				let result;
				try {
					result = (await this.api.workspace.create(intent.input)).result;
				} catch (error) {
					result = transportError(error);
				}
				if (this.intent !== intent) return result;
				if (result.ok) this.adopt(result.value.workspace);
				else {
					intent.snapshot = {
						name: intent.snapshot.name,
						phase: "ready",
						error: `${result.error.code}: ${result.error.message}`
					};
					this.notifier.markDirty();
				}
				return result;
			}
			buildSnapshot() {
				return {
					view: this.view,
					intent: this.intent?.snapshot
				};
			}
		};
		function intentName(input) {
			return input.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? input.path;
		}
		//#endregion
		//#region lib/types/client/workspaces/manager.js
		/** Workspace baseline, incremental-frame, and unary-action owner. */
		/** Workspace object cluster driven by one list baseline and changed-frame upserts. */
		var WorkspaceManager = class {
			api;
			items = [];
			itemViewsSource = null;
			itemViewsCache = [];
			archivedSessionIds = [];
			state = "idle";
			phase = "pending";
			error = null;
			inflight = null;
			refreshFrames = null;
			/**
			* True once a frame or unary echo installed the archive set while a list
			* request was in flight: that install is newer than the pending baseline,
			* so the baseline's (older) set must not roll it back — the archive
			* mirror of replaying refreshFrames over the item baseline.
			*/
			archivedSupersedesRefresh = false;
			/** Latest local reorder request; only its unary echo may install order. */
			orderRequestGeneration = 0;
			/** Increments on order frames so a later remote commit outranks an older unary echo. */
			orderFrameGeneration = 0;
			/** Last complete order accepted from a Host baseline, frame, or current unary echo. */
			committedOrder = [];
			/**
			* Ids this process has seen removed, kept for the connection's lifetime so
			* a late changed frame or a stale baseline row cannot resurrect a deleted
			* row. Correctness rests on Host ids never being reused (the registry mints
			* a fresh `randomUUID` per record, including when the same directory is
			* registered again) — a path-derived id scheme would turn these entries
			* into permanent blindfolds and must clear them instead.
			*/
			removedIds = /* @__PURE__ */ new Set();
			snapshotCache;
			notifier = new Notifier(() => {
				this.snapshotCache = this.buildSnapshot();
			});
			/** @param api - shared wire client. */
			constructor(api) {
				this.api = api;
				this.snapshotCache = this.buildSnapshot();
			}
			/**
			* Refresh from workspace.list. The first successful response establishes
			* Host order; later responses re-establish the durable order so reconnects
			* adopt reorders committed while this client was offline. Frames arriving
			* during the RPC are replayed over its response.
			* @returns the shared in-flight refresh.
			*/
			refresh() {
				if (this.inflight !== null) return this.inflight;
				this.state = "loading";
				this.error = null;
				const frames = [];
				this.refreshFrames = frames;
				this.notifier.markDirty();
				this.inflight = (async () => {
					try {
						const { result } = await this.api.workspace.list({});
						if (result.ok) {
							let items = result.value.items;
							items = items.filter((workspace) => !this.removedIds.has(workspace.workspaceId));
							for (const delta of frames) items = applyWorkspaceDelta(items, delta);
							this.installViews(items);
							if (!this.archivedSupersedesRefresh) this.installArchived(result.value.archivedSessionIds);
							this.state = "idle";
							this.phase = "ready";
						} else {
							this.state = "error";
							this.error = result.error;
						}
					} catch (error) {
						this.state = "error";
						const folded = transportError(error);
						/* v8 ignore next -- transportError always returns the failure branch. */
						this.error = folded.ok ? null : folded.error;
					} finally {
						this.refreshFrames = null;
						this.archivedSupersedesRefresh = false;
						this.inflight = null;
						this.notifier.markDirty();
					}
				})();
				return this.inflight;
			}
			/**
			* Create or resolve a real Workspace, then publish its returned snapshot
			* without waiting for the changed frame.
			* @param input - the existing absolute path to adopt.
			* @returns the wire result.
			*/
			async create(input) {
				const workspace = new Workspace(this.api, input);
				const completion = workspace.materialize();
				if (completion === void 0) throw new Error("a local Workspace must be materializable");
				const result = await completion;
				if (result.ok) this.upsert(result.value.workspace, workspace);
				return result;
			}
			/**
			* Rename a Workspace, then publish its returned snapshot without waiting
			* for the changed frame.
			* @param workspaceId - target workspace.
			* @param title - new display title.
			* @returns the wire result.
			*/
			async rename(workspaceId, title) {
				const { result } = await this.api.workspace.rename({
					workspaceId,
					title
				});
				if (result.ok) this.upsert(result.value.workspace);
				return result;
			}
			/**
			* Delete a Workspace registration and remove its local projection from the
			* unary response without waiting for the Host frame.
			* @param workspaceId - target workspace.
			* @returns the wire result.
			*/
			async delete(workspaceId) {
				const { result } = await this.api.workspace.delete({ workspaceId });
				if (result.ok) this.remove(workspaceId, true);
				return result;
			}
			/**
			* Move a Workspace within the registry display order and install the full
			* returned order without waiting for the Host frame.
			* @param workspaceId - Workspace to move.
			* @param beforeWorkspaceId - Anchor workspace; omitted appends.
			* @returns the wire result.
			*/
			async insertBefore(workspaceId, beforeWorkspaceId) {
				const requestGeneration = ++this.orderRequestGeneration;
				const frameGeneration = this.orderFrameGeneration;
				const localOrder = this.itemViews().map((workspace) => workspace.workspaceId);
				this.installOrder(insertIdBefore(localOrder, workspaceId, beforeWorkspaceId));
				let result;
				try {
					({result} = await this.api.workspace.insertBefore({
						workspaceId,
						...beforeWorkspaceId === void 0 ? {} : { beforeWorkspaceId }
					}));
				} catch (error) {
					if (requestGeneration === this.orderRequestGeneration && frameGeneration === this.orderFrameGeneration) this.installOrder(this.committedOrder);
					throw error;
				}
				if (result.ok && requestGeneration === this.orderRequestGeneration && frameGeneration === this.orderFrameGeneration) this.installOrder(result.value.workspaceIds, true);
				else if (!result.ok && requestGeneration === this.orderRequestGeneration && frameGeneration === this.orderFrameGeneration) this.installOrder(this.committedOrder);
				return result;
			}
			/**
			* Move a session within its Workspace's manual order, then publish the
			* returned snapshot without waiting for the changed frame.
			* @param workspaceId - owning workspace.
			* @param sessionId - accounted session to move.
			* @param beforeSessionId - accounted anchor to insert before; omitted appends.
			* @returns the wire result.
			*/
			async insertSessionBefore(workspaceId, sessionId, beforeSessionId) {
				const { result } = await this.api.workspace.insertSessionBefore({
					workspaceId,
					sessionId,
					...beforeSessionId === void 0 ? {} : { beforeSessionId }
				});
				if (result.ok) this.upsert(result.value.workspace);
				return result;
			}
			/**
			* Archive one session in the registry-global set, then install the
			* returned full set without waiting for the changed frame.
			* @param sessionId - session to archive.
			* @returns the wire result.
			*/
			async archiveSession(sessionId) {
				const { result } = await this.api.workspace.archiveSession({ sessionId });
				if (result.ok) this.installArchived(result.value.archivedSessionIds);
				return result;
			}
			/**
			* Host-frame entry. Non-workspace frames are ignored so the runtime can
			* fan one host stream out to both object managers.
			* @param envelope - host stream envelope.
			*/
			handleHostEnvelope(envelope) {
				if (envelope.payload.type === "host/workspace-changed") this.upsert(envelope.payload.workspace);
				else if (envelope.payload.type === "host/workspace-removed") this.remove(envelope.payload.workspaceId);
				else if (envelope.payload.type === "host/workspace-order-changed") {
					this.orderFrameGeneration++;
					this.installOrder(envelope.payload.workspaceIds, true);
				} else if (envelope.payload.type === "host/archived-sessions-changed") this.installArchived(envelope.payload.archivedSessionIds);
			}
			/** Re-pull the baseline after each connection generation. */
			handleConnected() {
				this.refresh();
			}
			/**
			* Subscribe to workspace snapshot invalidation.
			* @param listener - snapshot invalidation callback.
			* @returns unsubscribe function.
			*/
			subscribe(listener) {
				return this.notifier.subscribe(listener);
			}
			/**
			* Read the cached workspace snapshot after flushing pending notifications.
			* @returns the cached workspace snapshot.
			*/
			getSnapshot() {
				this.notifier.ensureFresh();
				return this.snapshotCache;
			}
			buildSnapshot() {
				return {
					items: this.itemViews(),
					archivedSessionIds: this.archivedSessionIds,
					state: this.state,
					phase: this.phase,
					error: this.error
				};
			}
			/**
			* Replace the archive set when membership actually changed (array identity
			* backs Object.is short-circuits). Host snapshots are append-ordered, so
			* positional comparison is exact, not merely heuristic.
			*/
			installArchived(archivedSessionIds) {
				if (this.refreshFrames !== null) this.archivedSupersedesRefresh = true;
				if (archivedSessionIds.length === this.archivedSessionIds.length && archivedSessionIds.every((id, index) => id === this.archivedSessionIds[index])) return;
				this.archivedSessionIds = [...archivedSessionIds];
				this.notifier.markDirty();
			}
			/** Reorder known Workspace objects, optionally recording a Host-committed sequence. */
			installOrder(workspaceIds, committed = false) {
				if (committed) {
					this.refreshFrames?.push({
						type: "order",
						workspaceIds
					});
					this.committedOrder = [...workspaceIds];
				}
				const rank = new Map(workspaceIds.map((id, index) => [id, index]));
				const items = [...this.items].sort((left, right) => {
					const leftId = left.getSnapshot().view?.workspaceId;
					const rightId = right.getSnapshot().view?.workspaceId;
					return (leftId === void 0 ? Number.MAX_SAFE_INTEGER : rank.get(leftId) ?? Number.MAX_SAFE_INTEGER) - (rightId === void 0 ? Number.MAX_SAFE_INTEGER : rank.get(rightId) ?? Number.MAX_SAFE_INTEGER);
				});
				if (items.every((item, index) => item === this.items[index])) return;
				this.items = items;
				this.notifier.markDirty();
			}
			/** Upsert one Host view, optionally retaining the local object that materialized it. */
			upsert(view, identity) {
				if (this.removedIds.has(view.workspaceId)) return;
				this.refreshFrames?.push({
					type: "upsert",
					workspace: view
				});
				const index = this.items.findIndex((item) => item.getSnapshot().view?.workspaceId === view.workspaceId);
				const installed = index === -1 ? void 0 : this.items[index]?.getSnapshot().view;
				if (installed !== void 0 && Date.parse(view.updatedAt) < Date.parse(installed.updatedAt)) return;
				if (!this.committedOrder.includes(view.workspaceId)) this.committedOrder = [view.workspaceId, ...this.committedOrder];
				if (identity !== void 0) this.items = index === -1 ? [identity, ...this.items] : this.items.map((item, position) => position === index ? identity : item);
				else if (index === -1) this.items = [new Workspace(this.api, view), ...this.items];
				else {
					this.items[index]?.adopt(view);
					this.items = [...this.items];
				}
				this.notifier.markDirty();
			}
			/** Remove one id idempotently and retain a tombstone against late echoes. */
			remove(workspaceId, direct = false) {
				this.refreshFrames?.push({
					type: "remove",
					workspaceId
				});
				this.removedIds.add(workspaceId);
				this.committedOrder = this.committedOrder.filter((id) => id !== workspaceId);
				const items = this.items.filter((item) => item.getSnapshot().view?.workspaceId !== workspaceId);
				if (items.length === this.items.length) {
					if (direct) this.notifier.notifyNow();
					return;
				}
				this.items = items;
				if (direct) this.notifier.notifyNow();
				else this.notifier.markDirty();
			}
			installViews(views) {
				const existing = new Map(this.items.flatMap((workspace) => {
					const view = workspace.getSnapshot().view;
					return view === void 0 ? [] : [[view.workspaceId, workspace]];
				}));
				const installed = /* @__PURE__ */ new Map();
				for (const view of views) {
					const duplicate = installed.get(view.workspaceId);
					if (duplicate !== void 0) {
						duplicate.adopt(view);
						continue;
					}
					const workspace = existing.get(view.workspaceId) ?? new Workspace(this.api, view);
					workspace.adopt(view);
					installed.set(view.workspaceId, workspace);
				}
				this.items = [...installed.values()];
				this.committedOrder = views.map((view) => view.workspaceId);
			}
			itemViews() {
				if (this.itemViewsSource === this.items) return this.itemViewsCache;
				this.itemViewsSource = this.items;
				this.itemViewsCache = this.items.flatMap((workspace) => {
					const view = workspace.getSnapshot().view;
					return view === void 0 ? [] : [view];
				});
				return this.itemViewsCache;
			}
		};
		/** Known ids retain their position; a newly created Workspace enters first. */
		function upsertWorkspace(items, workspace) {
			const index = items.findIndex((item) => item.workspaceId === workspace.workspaceId);
			return index === -1 ? [workspace, ...items] : items.map((item, position) => position === index ? workspace : item);
		}
		/** Replay one ordered delta over a baseline: upsert in place, or drop the removed id. */
		function applyWorkspaceDelta(items, delta) {
			if (delta.type === "upsert") return upsertWorkspace(items, delta.workspace);
			if (delta.type === "remove") return items.filter((workspace) => workspace.workspaceId !== delta.workspaceId);
			const rank = new Map(delta.workspaceIds.map((id, index) => [id, index]));
			return [...items].sort((left, right) => (rank.get(left.workspaceId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.workspaceId) ?? Number.MAX_SAFE_INTEGER));
		}
		/** Move one known id before an optional anchor; unknown ids leave the order unchanged. */
		function insertIdBefore(ids, id, beforeId) {
			if (!ids.includes(id) || beforeId !== void 0 && !ids.includes(beforeId) || beforeId === id) return [...ids];
			const without = ids.filter((candidate) => candidate !== id);
			const at = beforeId === void 0 ? without.length : without.indexOf(beforeId);
			return [
				...without.slice(0, at),
				id,
				...without.slice(at)
			];
		}
		//#endregion
		//#region lib/types/client/workspaces/service.js
		/** WorkspaceRuntime projects the Workspace object manager for UI consumers. */
		/** Structured create failure for UI flows that distinguish Host business errors. */
		var WorkspaceCreateError = class extends Error {
			rpcError;
			constructor(rpcError) {
				super(`workspace create failed: ${rpcError.code}: ${rpcError.message}`);
				this.rpcError = rpcError;
				this.name = "WorkspaceCreateError";
			}
		};
		/** Structured browse failure so the directory browser can branch on Host business codes. */
		var DirectoryBrowseError = class extends Error {
			rpcError;
			constructor(rpcError) {
				super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`);
				this.rpcError = rpcError;
				this.name = "DirectoryBrowseError";
			}
		};
		/** Real Workspace object layer and Host actions. */
		var WorkspaceRuntime = class {
			api;
			sessions;
			/** UI-facing immutable projection; the manager remains wire truth. */
			list;
			/** Workspace baseline and frame owner. */
			manager;
			/** In-flight blank-session creates keyed by workspace (connectWorkspace coalescing). */
			connecting = /* @__PURE__ */ new Map();
			/** Guards the runtime-owned one-shot initial-selection subscription. */
			initialSelectionStarted = false;
			/**
			* @param ctx - client root context.
			* @param api - shared wire client.
			* @param sessions - cross-domain sessions face used for recency and blank-session reuse.
			*/
			constructor(ctx, api, sessions) {
				this.api = api;
				this.sessions = sessions;
				this.manager = new WorkspaceManager(api);
				this.list = createSnapshotStore({
					items: [],
					archivedSessionIds: [],
					state: "idle",
					phase: "pending",
					error: null,
					baselinesReady: false,
					recentWorkspaceId: void 0
				});
				this.manager.subscribe(() => {
					this.project();
				});
				this.sessions.list.subscribe(() => {
					this.project();
				});
				ctx.reflect.provide("workspaces", this, void 0);
			}
			/**
			* Resolve the session a New Session flow lands in once this Workspace is
			* chosen: reuse the workspace's existing blank session when one is in the
			* list mirror, else create a fresh one on the host (`session.create` births
			* the full Session+Agent — the client holds no intermediate state). The
			* caller owns navigation: take the returned id to `sessions.open`.
			* Resolution guarantee (both arms): the returned id is already in the list
			* store and `sessions.binding(id)` resolves synchronously — draft hand-off
			* may write the new scope's machine before opening.
			* @param workspaceId - chosen Workspace (must be in the workspace list).
			* @returns the reused or newly created session id.
			*/
			async connectWorkspace(workspaceId) {
				const workspace = this.list.getSnapshot().items.find((item) => item.workspaceId === workspaceId);
				if (workspace === void 0) throw new Error(`workspaces.connectWorkspace: unknown workspace ${workspaceId}`);
				const inflight = this.connecting.get(workspaceId);
				if (inflight !== void 0) return inflight;
				const archived = this.list.getSnapshot().archivedSessionIds;
				const sessions = this.sessions.list.getSnapshot();
				for (const id of sessions.ids) {
					const summary = sessions.byId[id];
					if (summary !== void 0 && summary.blank && summary.cwd === workspace.path && workspace.sessionIds.includes(summary.id) && !archived.includes(summary.id)) return summary.id;
				}
				const attempt = this.sessions.create({ workspaceId }).finally(() => {
					this.connecting.delete(workspaceId);
				});
				this.connecting.set(workspaceId, attempt);
				return attempt;
			}
			/**
			* Follow the first complete Workspace/Session baseline and select a default
			* session exactly once. A restored current session wins; otherwise the most
			* recent Workspace is connected (reusing or creating its blank session).
			* Later explicit clears stay cleared instead of retriggering this startup
			* policy. A failed connect may retry on the next baseline projection.
			* @returns disposer for the baseline subscription; late work cannot navigate after disposal.
			*/
			startInitialSelection() {
				if (this.initialSelectionStarted) throw new Error("workspaces.startInitialSelection: already started");
				this.initialSelectionStarted = true;
				let state = "waiting";
				let disposed = false;
				const reconcile = () => {
					if (disposed || state !== "waiting") return;
					const workspace = this.list.getSnapshot();
					if (!workspace.baselinesReady) return;
					const current = this.sessions.list.getSnapshot().current;
					const target = workspace.recentWorkspaceId;
					if (current !== void 0 || target === void 0) {
						state = "done";
						return;
					}
					state = "connecting";
					this.connectWorkspace(target).then((sessionId) => {
						if (disposed) return;
						if (this.sessions.list.getSnapshot().current === void 0) this.sessions.open(sessionId);
						state = "done";
					}, (reason) => {
						if (disposed) return;
						state = "waiting";
						console.warn("initial workspace selection failed:", reason);
					});
				};
				const unsubscribe = this.list.subscribe(reconcile);
				reconcile();
				return () => {
					disposed = true;
					unsubscribe();
				};
			}
			/**
			* The shared New Session action behind the shell entry points (sidebar
			* button, workspace browser): resolve the target Workspace — explicit wins,
			* then the current Session's Workspace, then the recent-Workspace
			* projection — connect its blank session and navigate there; with no
			* Workspace at all, clear the selection into the New Session view state.
			* Connect failures are non-fatal (console diagnostics; the current view
			* stays usable).
			* @param workspaceId - explicit target Workspace for scoped actions.
			*/
			startSession(workspaceId) {
				const workspace = this.list.getSnapshot();
				const current = this.sessions.list.getSnapshot().current;
				const currentWorkspaceId = current === void 0 ? void 0 : workspace.items.find((item) => item.sessionIds.includes(current))?.workspaceId;
				const target = workspaceId ?? currentWorkspaceId ?? workspace.recentWorkspaceId;
				if (target === void 0) {
					this.sessions.clear();
					return;
				}
				this.connectWorkspace(target).then((sessionId) => {
					this.sessions.open(sessionId);
				}, (reason) => {
					console.warn("new session failed:", reason);
				});
			}
			/**
			* Register an existing path as a Workspace.
			* @param input - the Host create payload.
			* @returns the created or idempotently resolved Workspace.
			*/
			async create(input) {
				const result = await this.manager.create(input);
				if (!result.ok) throw new WorkspaceCreateError(result.error);
				return result.value.workspace;
			}
			/**
			* Open the Host's native directory picker (the `native` capability).
			* @returns the selected path, or null when the user cancelled.
			*/
			async pickDirectory() {
				const response = await this.api.host.pickDirectory({});
				if (!response.result.ok) throw new Error(`directory picker failed: ${response.result.error.message}`);
				return response.result.value.path;
			}
			/**
			* List one directory level through the Host's `browse` capability.
			* @param path - absolute directory to list; absent lists the Host home directory.
			* @param signal - aborts the wire request (and the Host's scan) when the caller supersedes it.
			* @returns the level's listing with breadcrumb ancestry.
			*/
			async listDirectory(path, signal) {
				const response = await this.api.host.listDirectory(path === void 0 ? {} : { path }, signal);
				if (!response.result.ok) throw new DirectoryBrowseError(response.result.error);
				return response.result.value;
			}
			/**
			* Create one child directory through the Host's `browse` capability.
			* @param path - absolute existing parent directory.
			* @param name - single non-blank path segment.
			* @returns the created directory's absolute path.
			*/
			async createDirectory(path, name) {
				const response = await this.api.host.createDirectory({
					path,
					name
				});
				if (!response.result.ok) throw new DirectoryBrowseError(response.result.error);
				return response.result.value.path;
			}
			/**
			* Open a filesystem path with the Host operating system's default application.
			* @param path - absolute or host-resolvable path.
			*/
			async openPath(path) {
				const response = await this.api.host.openPath({ path });
				if (!response.result.ok) throw new Error(`path open failed: ${response.result.error.message}`);
			}
			/**
			* Rename a Workspace.
			* @param workspaceId - target workspace.
			* @param title - new display title (trimmed non-empty by the Host).
			* @returns the renamed Workspace view.
			*/
			async rename(workspaceId, title) {
				const result = await this.manager.rename(workspaceId, title);
				if (!result.ok) throw new Error(`workspace rename failed: ${result.error.code}: ${result.error.message}`);
				return result.value.workspace;
			}
			/**
			* Delete one Workspace registration. Sessions, session logs, and the
			* directory remain Host-owned outside this operation.
			* @param workspaceId - target workspace.
			*/
			async delete(workspaceId) {
				const result = await this.manager.delete(workspaceId);
				if (!result.ok) throw new Error(`workspace delete failed: ${result.error.code}: ${result.error.message}`);
			}
			/**
			* Move a Workspace within the durable registry display order.
			* @param workspaceId - Workspace to move.
			* @param beforeWorkspaceId - Anchor workspace; omitted appends.
			*/
			async insertBefore(workspaceId, beforeWorkspaceId) {
				const result = await this.manager.insertBefore(workspaceId, beforeWorkspaceId);
				if (!result.ok) throw new Error(`workspace reorder failed: ${result.error.code}: ${result.error.message}`);
			}
			/**
			* Archive a session into the registry-global set. Clearing an archived
			* current selection is the projection sweep's job (one rule for the local
			* echo and a remote tab's frame alike).
			* @param sessionId - session to archive.
			*/
			async archiveSession(sessionId) {
				const result = await this.manager.archiveSession(sessionId);
				if (!result.ok) throw new Error(`session archive failed: ${result.error.code}: ${result.error.message}`);
			}
			/**
			* Move a session within its Workspace's manual order (DOM-insertBefore-like).
			* @param workspaceId - owning workspace.
			* @param sessionId - accounted session to move.
			* @param beforeSessionId - accounted anchor to insert before; omitted appends.
			* @returns the updated Workspace view.
			*/
			async insertSessionBefore(workspaceId, sessionId, beforeSessionId) {
				const result = await this.manager.insertSessionBefore(workspaceId, sessionId, beforeSessionId);
				if (!result.ok) throw new Error(`workspace move failed: ${result.error.code}: ${result.error.message}`);
				return result.value.workspace;
			}
			/**
			* Refresh the workspace baseline, reusing an in-flight pull.
			* @returns completion of the current or newly started workspace baseline pull.
			*/
			refresh() {
				return this.manager.refresh();
			}
			/**
			* Route a Host stream envelope into the Workspace object layer.
			* @param envelope - validated Host stream envelope.
			*/
			handleHostEnvelope(envelope) {
				this.manager.handleHostEnvelope(envelope);
			}
			/** Rebuild the Workspace baseline after connection. */
			handleConnected() {
				this.manager.handleConnected();
			}
			project() {
				const workspace = this.manager.getSnapshot();
				const sessions = this.sessions.list.getSnapshot();
				const baselinesReady = workspace.phase === "ready" && sessions.phase === "ready";
				if (sessions.current !== void 0 && workspace.archivedSessionIds.includes(sessions.current)) this.sessions.clear();
				this.list.set({
					items: workspace.items,
					archivedSessionIds: workspace.archivedSessionIds,
					state: workspace.state,
					phase: workspace.phase,
					error: workspace.error,
					baselinesReady,
					recentWorkspaceId: baselinesReady ? recentWorkspace(workspace.items, sessions.byId) : void 0
				});
			}
		};
		/** Stable tie-breaking follows Host Workspace order. */
		function recentWorkspace(workspaces, sessions) {
			let selected;
			let selectedTime = Number.NEGATIVE_INFINITY;
			for (const workspace of workspaces) {
				let latest = Number.NEGATIVE_INFINITY;
				for (const sessionId of workspace.sessionIds) {
					const session = sessions[sessionId];
					if (session !== void 0) latest = Math.max(latest, session.updatedAt);
				}
				if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt);
				if (selected === void 0 || latest > selectedTime) {
					selected = workspace.workspaceId;
					selectedTime = latest;
				}
			}
			return selected;
		}
		//#endregion
		//#region lib/types/client/conversation/definition-registry.js
		/** Shared lifecycle and stable-entry storage for one Conversation Definition registry. */
		var ConversationDefinitionRegistry = class extends _deepseek_ai_cordis.Service {
			definitions = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			cached = [];
			/**
			* Return reference-stable Definitions in registration order.
			* @returns current Definitions.
			*/
			entries() {
				return this.cached;
			}
			/**
			* Observe low-frequency registry changes.
			* @param listener - synchronous invalidation callback.
			* @returns unsubscribe callback.
			*/
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			/**
			* Register one uniquely keyed Definition for the caller's lifetime.
			* @param key - registry-local unique key.
			* @param definition - contributed Definition.
			* @param duplicateMessage - error raised when the key is already owned.
			* @param effectName - Cordis effect diagnostic label.
			* @returns idempotent disposer.
			*/
			registerDefinition(key, definition, duplicateMessage, effectName) {
				if (this.definitions.has(key)) throw new Error(duplicateMessage);
				const dispose = this.ctx.effect(() => {
					this.definitions.set(key, definition);
					this.refresh();
					return () => {
						if (this.definitions.get(key) !== definition) return;
						this.definitions.delete(key);
						this.refresh();
					};
				}, effectName);
				return () => {
					dispose();
				};
			}
			/** Refresh cached entries and synchronously invalidate subscribers. */
			refresh() {
				this.cached = [...this.definitions.values()];
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region lib/types/client/conversation/event-registry.js
		/** Runtime registry of independently owned Conversation business Definitions. */
		var ConversationEventRegistry = class extends ConversationDefinitionRegistry {
			fallback;
			/** @param ctx - owning Client Runtime context. */
			constructor(ctx) {
				super(ctx, "conversationEvents");
			}
			/**
			* Register a uniquely named business Definition for the caller's lifetime.
			* @param definition - Definition contribution.
			* @returns idempotent disposer.
			*/
			register(definition) {
				assertDefinitionTarget(definition);
				return this.registerDefinition(definition.kind, definition, `conversation Definition "${definition.kind}" is already registered`, `conversationEvents.register(${JSON.stringify(definition.kind)})`);
			}
			/**
			* Register the sole fallback used only when no ordinary Definition matches.
			* @param definition - fallback Definition.
			* @returns idempotent disposer.
			*/
			registerFallback(definition) {
				assertDefinitionTarget(definition);
				if (definition.target === void 0) throw new Error("conversation fallback Definition must declare a target");
				if (this.fallback !== void 0) throw new Error("conversation fallback Definition is already registered");
				const dispose = this.ctx.effect(() => {
					this.fallback = definition;
					this.refresh();
					return () => {
						if (this.fallback !== definition) return;
						this.fallback = void 0;
						this.refresh();
					};
				}, `conversationEvents.registerFallback(${JSON.stringify(definition.kind)})`);
				return () => {
					dispose();
				};
			}
			/**
			* Return the current unmatched-event fallback.
			* @returns installed fallback, when present.
			*/
			fallbackEntry() {
				return this.fallback;
			}
		};
		function assertDefinitionTarget(definition) {
			if (definition.target === void 0 !== (definition.buildViewNode === void 0)) throw new Error(`conversation Definition "${definition.kind}" must declare target and buildViewNode together`);
		}
		//#endregion
		//#region lib/types/client/conversation/view-registry.js
		/** Runtime registry of per-target Conversation snapshot builders. */
		var ConversationViewRegistry = class extends ConversationDefinitionRegistry {
			/** @param ctx - owning Client Runtime context. */
			constructor(ctx) {
				super(ctx, "conversationViews");
			}
			/**
			* Register a uniquely named view builder factory for the caller's lifetime.
			* @param definition - target builder contribution.
			* @returns idempotent disposer.
			*/
			register(definition) {
				return this.registerDefinition(definition.target, definition, `conversation view target "${definition.target}" is already registered`, `conversationViews.register(${JSON.stringify(definition.target)})`);
			}
		};
		//#endregion
		//#region ../../core/session/src/surface.ts
		/** Runtime counterpart of the message-producing event union. */
		const SURFACE_EVENT_TYPES = new Set([
			"user/message",
			"assistant/message",
			"tool/result"
		]);
		/**
		* Narrow an event to a surface-eligible event carrying its required marker.
		* @param event - event to test.
		* @returns true when both the type and marker identify a surface event.
		*/
		function isSurfaceEvent(event) {
			if (!SURFACE_EVENT_TYPES.has(event.type)) return false;
			return event.surfaceOp !== void 0;
		}
		/**
		* Narrow an event to an append-origin surface event: one that entered the
		* surface at its own log position and was never itself a replacement copy.
		*
		* The model-visible surface deliberately shadows replaced ranges, so it is the
		* wrong source for a human transcript — a landed replacement would erase
		* conversation the user already saw. Append-origin events are that transcript's
		* durable source material; replacement copies stay model-only.
		* @param event - event to test.
		* @returns true when the event appended to the surface tail.
		*/
		function isAppendSurfaceEvent(event) {
			return isSurfaceEvent(event) && event.surfaceOp === "append";
		}
		/**
		* Narrow an event to a surface replacement: a node that shadowed an existing
		* surface range instead of appending to the tail. The counterpart of
		* {@link isAppendSurfaceEvent} over the two {@link SurfaceOp} variants.
		* @param event - event to test.
		* @returns true when the event replaced a surface range.
		*/
		function isReplacementSurfaceEvent(event) {
			return isSurfaceEvent(event) && event.surfaceOp !== "append";
		}
		//#endregion
		//#region lib/types/client/sessions/subagent-lineage.js
		/**
		* Index every subagent descendant under each ancestor it reaches through an
		* uninterrupted subagent-origin chain. Cycles fail soft and orphan owners
		* remain harmless map keys until their summaries arrive.
		* @param summaries - retained session summaries keyed by id.
		* @returns descendant totals and running totals keyed by possible parent id.
		*/
		function indexSubagentDescendants(summaries) {
			const indexed = /* @__PURE__ */ new Map();
			for (const descendant of Object.values(summaries)) {
				if (descendant.origin !== "subagent") continue;
				const seen = /* @__PURE__ */ new Set();
				let current = descendant;
				while (current?.origin === "subagent" && current.parentId !== void 0 && !seen.has(current.id)) {
					seen.add(current.id);
					const aggregate = indexed.get(current.parentId);
					if (aggregate === void 0) indexed.set(current.parentId, {
						count: 1,
						runningCount: descendant.running ? 1 : 0
					});
					else {
						aggregate.count += 1;
						if (descendant.running) aggregate.runningCount += 1;
					}
					current = summaries[current.parentId];
				}
			}
			return indexed;
		}
		//#endregion
		//#region lib/types/client/workspaces/path.js
		/**
		* Resolve a workspace-relative path into the Host-facing spelling used by openPath.
		* @param cwd - session workspace root, when known.
		* @param path - absolute or workspace-relative path.
		* @returns an absolute path when a workspace root is available, otherwise the original path.
		*/
		function resolveWorkspacePath(cwd, path) {
			if (path.startsWith("/") || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("\\\\")) return path;
			if (cwd === void 0 || cwd === "") return path;
			return `${cwd.replace(/[/\\]+$/, "")}/${path.replace(/^[/\\]+/, "")}`;
		}
		//#endregion
		//#region lib/types/client/sessions/partial.js
		/**
		* Create the empty client projection for one streamed Assistant block kind.
		* @param blockType - wire block kind.
		* @returns empty projected block ready to receive deltas.
		*/
		function emptyAssistantBlock(blockType) {
			switch (blockType) {
				case "text": return {
					kind: "text",
					text: ""
				};
				case "reasoning": return {
					kind: "reasoning",
					text: ""
				};
				case "tool-call": return {
					kind: "tool-call",
					callId: "",
					name: "",
					argsRaw: ""
				};
				default: return {
					kind: "other",
					block: null
				};
			}
		}
		//#endregion
		//#region ../../llm/llm/src/message.ts
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
		//#region lib/types/client/sessions/context-provenance.js
		/** One durable source narrowed to the readable-record shape; null for anything else. */
		function asRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
		}
		/** A record field read as a non-empty string, or null. */
		function readString(record, key) {
			const value = record[key];
			return typeof value === "string" && value.length > 0 ? value : null;
		}
		/** Distinct non-empty `field` values of an array-valued source member, in first-seen order. */
		function collect(source, member, field) {
			const list = source[member];
			if (!Array.isArray(list)) return [];
			const seen = [];
			for (const entry of list) {
				const record = asRecord(entry);
				const value = record === null ? null : readString(record, field);
				if (value !== null && !seen.includes(value)) seen.push(value);
			}
			return seen;
		}
		/** A collected name list rendered as one label; null when the list is empty. */
		function joined(names) {
			return names.length > 0 ? names.join(", ") : null;
		}
		/**
		* Project one durable message source onto its transcript role and producer name.
		*
		* The source arrives over the wire as opaque JSON (`MessageSource` is
		* merge-extensible, so no client-side union can be exhaustive), and a durable
		* log may predate or postdate this UI; every unreadable shape therefore
		* degrades to `inject` with whatever name the record still carries.
		* @param source - the logged `user/message` source, exactly as recorded.
		* @returns the role and producer name to present for this context.
		*/
		function contextProvenance(source) {
			const record = asRecord(source);
			const kind = record === null ? null : readString(record, "kind");
			if (record === null || kind === null) return {
				role: "inject",
				label: null
			};
			switch (kind) {
				case "session-reference": return {
					role: "recall",
					label: joined(collect(record, "references", "label")) ?? kind
				};
				case "agent-instructions": return {
					role: "inject",
					label: joined(collect(record, "changes", "path")) ?? kind
				};
				case "plugin": return {
					role: "inject",
					label: readString(record, "plugin") ?? kind
				};
				case "skill-invocation": return {
					role: "inject",
					label: readString(record, "name") ?? kind
				};
				default: return {
					role: "inject",
					label: kind
				};
			}
		}
		/**
		* Context forms this UI version renders with a dedicated presentation. The
		* durable vocabulary (`ContextForm` in `dsh-llm`) may already be wider — an
		* unrecognized or absent value degrades to the opaque presentation rather than
		* dropping the row, so a log written by a newer or foreign producer still
		* renders.
		*/
		const KNOWN_FORMS = [
			"instructions",
			"catalog",
			"snapshot",
			"notice",
			"relay",
			"recall"
		];
		/**
		* Read the producer-declared form off one durable message source.
		* @param source - the logged `user/message` source, exactly as recorded.
		* @returns the form when this UI version presents it, otherwise null (opaque).
		*/
		function contextForm(source) {
			const record = asRecord(source);
			const form = record === null ? null : readString(record, "form");
			return form !== null && KNOWN_FORMS.includes(form) ? form : null;
		}
		//#endregion
		//#region lib/types/client/sessions/failure-display.js
		/**
		* Convert a durable failure into copy that is safe to expose in the GUI.
		* @param failure - Failure value preserved by the session event.
		* @returns Display-safe copy for client projections.
		*/
		function displayFailureMessage(failure) {
			if (failure === null || typeof failure !== "object") return String(failure);
			const record = failure;
			if (record.code === "AUTH") return "API key is invalid";
			return typeof record.message === "string" ? record.message : JSON.stringify(failure);
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Required services: the wire handle and Client Typert registry. */
		const inject = [
			"connection",
			"typert",
			"remote",
			"remote.commands"
		];
		/** Mounts the browser runtime services and connection stream.
		* @param ctx - Client Cordis context.
		*/
		function apply(ctx) {
			ctx.plugin(SlotRegistry);
			const conversation = {
				events: new ConversationEventRegistry(ctx),
				views: new ConversationViewRegistry(ctx)
			};
			const connection = ctx.get("connection");
			const sessions = new SessionRuntime(ctx, connection.api, ctx.remote, conversation);
			ctx.typert.contexts.registerClient("agent", { identity: (candidate) => sessions.scopeOf(candidate) });
			const workspaces = new WorkspaceRuntime(ctx, connection.api, sessions);
			ctx.effect(() => workspaces.startInitialSelection(), "runtime: initial Workspace selection");
			const loop = connection.start({
				onMuxEnvelope: (envelope) => {
					sessions.handleMuxEnvelope(envelope);
				},
				onHostEnvelope: (envelope) => {
					sessions.handleHostEnvelope(envelope);
					workspaces.handleHostEnvelope(envelope);
					const frame = envelope.payload;
					if (frame.type === "host/remote-event") ctx.remote.$dispatch(frame.event, frame.args);
				},
				onConnected: () => {
					sessions.handleConnected();
					workspaces.handleConnected();
					ctx.emit("connection/reset");
				},
				onStateChange: (state) => {
					if (state === "reconnecting") sessions.handleDisconnected();
				}
			});
			ctx.effect(() => () => {
				loop.stop();
			}, "runtime: connection stream loop");
		}
		//#endregion
		exports.ConversationEventRegistry = ConversationEventRegistry;
		exports.ConversationLocationIndex = ConversationLocationIndex;
		exports.ConversationNodeAssembler = ConversationNodeAssembler;
		exports.ConversationViewRegistry = ConversationViewRegistry;
		exports.DirectoryBrowseError = DirectoryBrowseError;
		exports.EMPTY_CHAT_SNAPSHOT = EMPTY_CHAT_SNAPSHOT;
		exports.EMPTY_CONVERSATION_VIEWS = EMPTY_CONVERSATION_VIEWS;
		exports.PendingWait = PendingWait;
		exports.SessionCreateError = SessionCreateError;
		exports.SessionProvideChannel = SessionProvideChannel;
		exports.SessionRuntime = SessionRuntime;
		exports.SlotRegistry = SlotRegistry;
		exports.WorkspaceCreateError = WorkspaceCreateError;
		exports.WorkspaceRuntime = WorkspaceRuntime;
		exports.apply = apply;
		exports.contextForm = contextForm;
		exports.contextProvenance = contextProvenance;
		exports.conversationContextKey = conversationContextKey;
		exports.createScope = createScope;
		exports.createSnapshotStore = createSnapshotStore;
		exports.defineStore = defineStore;
		exports.displayFailureMessage = displayFailureMessage;
		exports.emptyAssistantBlock = emptyAssistantBlock;
		exports.indexSubagentDescendants = indexSubagentDescendants;
		exports.inject = inject;
		exports.isAppendSurfaceEvent = isAppendSurfaceEvent;
		exports.isReplacementSurfaceEvent = isReplacementSurfaceEvent;
		exports.isTokenDelta = isTokenDelta;
		exports.resolveWorkspacePath = resolveWorkspacePath;
		exports.scopeOf = scopeOf;
		exports.shallowEqual = shallowEqual;
		exports.toAssistantBlock = toAssistantBlock;
		exports.toAssistantBlocks = toAssistantBlocks;
		exports.workspaceTitleOf = workspaceTitleOf;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map