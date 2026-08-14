window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-theme",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		//#region ../../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-theme/src/client/AppearanceRow.module.css.mjs
		const css = "._8HJdBW_group{border-bottom:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:16px 0;display:flex}._8HJdBW_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}._8HJdBW_cubeRow{flex-wrap:wrap;align-items:stretch;gap:8px;display:flex}._8HJdBW_themeCube{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border-radius:16px;flex-direction:column;flex:180px;justify-content:center;align-items:center;gap:4px;padding:20px 32px;font-size:14px;line-height:22px;display:flex}._8HJdBW_themeCube:hover:not(._8HJdBW_selected){background:var(--dsw-alias-interactive-bg-hover)}._8HJdBW_selected{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-static-neutral-bluish-400)}";
		const tagId = "@deepseek-ai/dsh-client-ui-theme/AppearanceRow.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-theme";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var AppearanceRow_module_css_default = {
			"themeCube": "_8HJdBW_themeCube",
			"title": "_8HJdBW_title",
			"group": "_8HJdBW_group",
			"cubeRow": "_8HJdBW_cubeRow",
			"selected": "_8HJdBW_selected"
		};
		//#endregion
		//#region lib/types/client/AppearanceRow.js
		/**
		* Appearance preference row registered into the General section item slot
		* (figma 501:30012 'Frame 2117131228'): title + three preference cubes.
		* Registered by this package — the theme feature owns its own settings
		* surface. Selection follows the persisted preference, never the resolved
		* active theme.
		*/
		/** Cube order and icons (figma 501:30015-30017: Light, Dark, System). */
		const CUBES = [
			{
				id: "light",
				labelKey: "appearance.light",
				Icon: _deepseek_ai_dsh_client_ui_primitives.IconLightOutline16
			},
			{
				id: "dark",
				labelKey: "appearance.dark",
				Icon: _deepseek_ai_dsh_client_ui_primitives.IconDarkOutline16
			},
			{
				id: "system",
				labelKey: "appearance.system",
				Icon: _deepseek_ai_dsh_client_ui_primitives.IconFollowsystemOutline16
			}
		];
		/**
		* Render the Appearance row.
		* @param props - composed slot props.
		* @returns the row element tree.
		*/
		function AppearanceRow({ t, setTheme, useStore }) {
			const preference = useStore((s) => s.preference);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: AppearanceRow_module_css_default.group,
				children: [(0, react_jsx_runtime.jsx)("div", {
					className: AppearanceRow_module_css_default.title,
					children: t("appearance.title")
				}), (0, react_jsx_runtime.jsx)("div", {
					className: AppearanceRow_module_css_default.cubeRow,
					children: CUBES.map(({ id, labelKey, Icon }) => (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: clsx(AppearanceRow_module_css_default.themeCube, preference === id && AppearanceRow_module_css_default.selected),
						"aria-pressed": preference === id,
						onClick: () => {
							setTheme(id);
						},
						children: [(0, react_jsx_runtime.jsx)(Icon, {}), t(labelKey)]
					}, id))
				})]
			});
		}
		//#endregion
		//#region lib/types/client/settings-store.js
		/**
		* Appearance row slot store: a mirror of the theme service snapshot. The
		* plugin's apply-world change listener is the only writer; the row component
		* reads via props.useStore.
		*/
		/**
		* Declares the Appearance row state and write surface.
		* @returns the store handle.
		*/
		function createAppearanceRowStore() {
			return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
				init: () => ({
					preference: "system",
					revision: -1
				}),
				actions: { sync: (d, preference, revision) => {
					if (revision <= d.revision) return;
					d.preference = preference;
					d.revision = revision;
				} }
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** `settings.theme` namespace dictionaries (the Appearance row's copy). */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"appearance.title": "外观",
			"appearance.light": "浅色",
			"appearance.dark": "深色",
			"appearance.system": "跟随系统"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"appearance.title": "Appearance",
			"appearance.light": "Light",
			"appearance.dark": "Dark",
			"appearance.system": "System"
		};
		//#endregion
		//#region ../../../vendor/cosmokit/src/misc.ts
		/** Return true when a value is `null` or `undefined`. */
		function isNullable(value) {
			return value === null || value === void 0;
		}
		/** Return true for non-array object values. */
		function isPlainObject(data) {
			return data && typeof data === "object" && !Array.isArray(data);
		}
		/** Filter object entries and return a new object. */
		function filterKeys(object, filter) {
			return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
		}
		/** Map object values while preserving the original key set. */
		function mapValues(object, transform) {
			return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
		}
		/** Pick selected keys from an object, optionally including `undefined` values. */
		function pick(source, keys, forced) {
			if (!keys) return { ...source };
			const result = {};
			for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
			return result;
		}
		//#endregion
		//#region ../../../vendor/cosmokit/src/types.ts
		/** Test values using `instanceof` with a `toStringTag` fallback. */
		function is(type, value) {
			if (arguments.length === 1) return (value) => is(type, value);
			return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
		}
		function isArrayBufferLike(value) {
			return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
		}
		function isArrayBufferSource(value) {
			return isArrayBufferLike(value) || ArrayBuffer.isView(value);
		}
		let Binary;
		(function(_Binary) {
			_Binary.is = isArrayBufferLike;
			_Binary.isSource = isArrayBufferSource;
			function fromSource(source) {
				if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
				else return source;
			}
			_Binary.fromSource = fromSource;
			function toBase64(source) {
				source = fromSource(source);
				if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
				let binary = "";
				const bytes = new Uint8Array(source);
				for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
				return btoa(binary);
			}
			_Binary.toBase64 = toBase64;
			function fromBase64(source) {
				if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
				return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
			}
			_Binary.fromBase64 = fromBase64;
			function toHex(source) {
				source = fromSource(source);
				if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
				return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
			}
			_Binary.toHex = toHex;
			function fromHex(source) {
				if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
				const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
				const buffer = [];
				for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
				return Uint8Array.from(buffer).buffer;
			}
			_Binary.fromHex = fromHex;
		})(Binary || (Binary = {}));
		Binary.fromBase64;
		Binary.toBase64;
		Binary.fromHex;
		Binary.toHex;
		/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
		function clone(source, refs = /* @__PURE__ */ new Map()) {
			if (!source || typeof source !== "object") return source;
			if (is("Date", source)) return new Date(source.valueOf());
			if (is("RegExp", source)) return new RegExp(source.source, source.flags);
			if (isArrayBufferLike(source)) return source.slice(0);
			if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
			const cached = refs.get(source);
			if (cached) return cached;
			if (Array.isArray(source)) {
				const result = [];
				refs.set(source, result);
				source.forEach((value, index) => {
					result[index] = Reflect.apply(clone, null, [value, refs]);
				});
				return result;
			}
			const result = Object.create(Object.getPrototypeOf(source));
			refs.set(source, result);
			for (const key of Reflect.ownKeys(source)) {
				const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
				if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
				Reflect.defineProperty(result, key, descriptor);
			}
			return result;
		}
		/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
		function deepEqual(a, b, strict) {
			if (a === b) return true;
			if (!strict && isNullable(a) && isNullable(b)) return true;
			if (typeof a !== typeof b) return false;
			if (typeof a !== "object") return false;
			if (!a || !b) return false;
			function check(test, then) {
				return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
			}
			return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
				if (a.byteLength !== b.byteLength) return false;
				const viewA = new Uint8Array(a);
				const viewB = new Uint8Array(b);
				for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
				return true;
			}) ?? Object.keys({
				...a,
				...b
			}).every((key) => deepEqual(a[key], b[key], strict));
		}
		//#endregion
		//#region ../../../vendor/cosmokit/src/time.ts
		let Time;
		(function(_Time) {
			_Time.millisecond = 1;
			const second = _Time.second = 1e3;
			const minute = _Time.minute = second * 60;
			const hour = _Time.hour = minute * 60;
			const day = _Time.day = hour * 24;
			const week = _Time.week = day * 7;
			let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
			function setTimezoneOffset(offset) {
				timezoneOffset = offset;
			}
			_Time.setTimezoneOffset = setTimezoneOffset;
			function getTimezoneOffset() {
				return timezoneOffset;
			}
			_Time.getTimezoneOffset = getTimezoneOffset;
			function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
				if (typeof date === "number") date = new Date(date);
				if (offset === void 0) offset = timezoneOffset;
				return Math.floor((date.valueOf() / minute - offset) / 1440);
			}
			_Time.getDateNumber = getDateNumber;
			function fromDateNumber(value, offset) {
				const date = new Date(value * day);
				if (offset === void 0) offset = timezoneOffset;
				return new Date(+date + offset * minute);
			}
			_Time.fromDateNumber = fromDateNumber;
			const numeric = /\d+(?:\.\d+)?/.source;
			const timeRegExp = new RegExp(`^${[
				"w(?:eek(?:s)?)?",
				"d(?:ay(?:s)?)?",
				"h(?:our(?:s)?)?",
				"m(?:in(?:ute)?(?:s)?)?",
				"s(?:ec(?:ond)?(?:s)?)?"
			].map((unit) => `(${numeric}${unit})?`).join("")}$`);
			function parseTime(source) {
				const capture = timeRegExp.exec(source);
				if (!capture) return 0;
				return (parseFloat(capture[1]) * week || 0) + (parseFloat(capture[2]) * day || 0) + (parseFloat(capture[3]) * hour || 0) + (parseFloat(capture[4]) * minute || 0) + (parseFloat(capture[5]) * second || 0);
			}
			_Time.parseTime = parseTime;
			function parseDate(date) {
				const parsed = parseTime(date);
				if (parsed) date = Date.now() + parsed;
				else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
				else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
				return date ? new Date(date) : /* @__PURE__ */ new Date();
			}
			_Time.parseDate = parseDate;
			function format(ms) {
				const abs = Math.abs(ms);
				if (abs >= day - hour / 2) return Math.round(ms / day) + "d";
				else if (abs >= hour - minute / 2) return Math.round(ms / hour) + "h";
				else if (abs >= minute - second / 2) return Math.round(ms / minute) + "m";
				else if (abs >= second) return Math.round(ms / second) + "s";
				return ms + "ms";
			}
			_Time.format = format;
			function toDigits(source, length = 2) {
				return source.toString().padStart(length, "0");
			}
			_Time.toDigits = toDigits;
			function template(template, time = /* @__PURE__ */ new Date()) {
				return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
			}
			_Time.template = template;
		})(Time || (Time = {}));
		//#endregion
		//#region ../../../vendor/schemastery/src/index.ts
		const kSchema = Symbol.for("schemastery");
		const kValidationError = Symbol.for("ValidationError");
		globalThis.__schemastery_index__ ??= 0;
		globalThis.__schemastery_refs__ = void 0;
		var ValidationError = class extends TypeError {
			options;
			name = "ValidationError";
			constructor(message, options) {
				let prefix = "$";
				for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
				else if (typeof segment === "number") prefix += "[" + segment + "]";
				else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
				if (prefix.startsWith(".")) prefix = prefix.slice(1);
				super((prefix === "$" ? "" : `${prefix} `) + message);
				this.options = options;
			}
			static is(error) {
				return !!error?.[kValidationError];
			}
		};
		Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
		const Schema = function(options) {
			const schema = function(data, options = {}) {
				return Schema.resolve(data, schema, options)[0];
			};
			if (options.refs) {
				const refs = mapValues(options.refs, (options) => new Schema(options));
				const getRef = (uid) => refs[uid];
				for (const key in refs) {
					const options = refs[key];
					options.sKey = getRef(options.sKey);
					options.inner = getRef(options.inner);
					options.list = options.list && options.list.map(getRef);
					options.dict = options.dict && mapValues(options.dict, getRef);
				}
				return refs[options.uid];
			}
			Object.assign(schema, options);
			if (typeof schema.callback === "string") try {
				schema.callback = new Function("return " + schema.callback)();
			} catch {}
			Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
			Object.setPrototypeOf(schema, Schema.prototype);
			schema.meta ||= {};
			schema.toString = schema.toString.bind(schema);
			return schema;
		};
		Schema.prototype = Object.create(Function.prototype);
		Schema.prototype[kSchema] = true;
		Object.defineProperty(Schema.prototype, "~standard", { get() {
			return {
				version: 1,
				vendor: "schemastery",
				validate: (value) => {
					try {
						return { value: Schema.resolve(value, this, {})[0] };
					} catch (error) {
						if (ValidationError.is(error)) return { issues: [{
							message: error.message,
							path: error.options.path
						}] };
						throw error;
					}
				}
			};
		} });
		Schema.ValidationError = ValidationError;
		Schema.prototype.toJSON = function toJSON() {
			if (globalThis.__schemastery_refs__) {
				globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
				return this.uid;
			}
			globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
			globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
			const result = {
				uid: this.uid,
				refs: globalThis.__schemastery_refs__
			};
			globalThis.__schemastery_refs__ = void 0;
			return result;
		};
		Schema.prototype.set = function set(key, value) {
			this.dict[key] = value;
			return this;
		};
		Schema.prototype.push = function push(value) {
			this.list.push(value);
			return this;
		};
		function mergeDesc(original, messages) {
			const result = typeof original === "string" ? { "": original } : { ...original };
			for (const locale in messages) {
				const value = messages[locale];
				if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
				else if (typeof value === "string") result[locale] = value;
			}
			return result;
		}
		function getInner(value) {
			return value?.$value ?? value?.$inner;
		}
		function extractKeys(data) {
			return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
		}
		Schema.prototype.i18n = function i18n(messages) {
			const schema = Schema(this);
			const desc = mergeDesc(schema.meta.description, messages);
			if (Object.keys(desc).length) schema.meta.description = desc;
			if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
				return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
			});
			if (schema.list) schema.list = schema.list.map((inner, index) => {
				return inner.i18n(mapValues(messages, (data = {}) => {
					if (Array.isArray(getInner(data))) return getInner(data)[index];
					if (Array.isArray(data)) return data[index];
					return extractKeys(data);
				}));
			});
			if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
				if (getInner(data)) return getInner(data);
				return extractKeys(data);
			}));
			if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
			return schema;
		};
		Schema.prototype.extra = function extra(key, value) {
			const schema = Schema(this);
			schema.meta = {
				...schema.meta,
				[key]: value
			};
			return schema;
		};
		for (const key of [
			"required",
			"disabled",
			"collapse",
			"hidden",
			"loose"
		]) Object.assign(Schema.prototype, { [key](value = true) {
			const schema = Schema(this);
			schema.meta = {
				...schema.meta,
				[key]: value
			};
			return schema;
		} });
		Schema.prototype.deprecated = function deprecated() {
			const schema = Schema(this);
			schema.meta.badges ||= [];
			schema.meta.badges.push({
				text: "deprecated",
				type: "danger"
			});
			return schema;
		};
		Schema.prototype.experimental = function experimental() {
			const schema = Schema(this);
			schema.meta.badges ||= [];
			schema.meta.badges.push({
				text: "experimental",
				type: "warning"
			});
			return schema;
		};
		Schema.prototype.pattern = function pattern(regexp) {
			const schema = Schema(this);
			const pattern = pick(regexp, ["source", "flags"]);
			schema.meta = {
				...schema.meta,
				pattern
			};
			return schema;
		};
		Schema.prototype.simplify = function simplify(value) {
			if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
			if (isNullable(value)) return value;
			if (this.type === "object" || this.type === "dict") {
				const result = {};
				for (const key in value) {
					const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
					if (this.type === "dict" || !isNullable(item)) result[key] = item;
				}
				if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
				return result;
			} else if (this.type === "array" || this.type === "tuple") {
				const result = [];
				value.forEach((value, index) => {
					const schema = this.type === "array" ? this.inner : this.list[index];
					const item = schema ? schema.simplify(value) : value;
					result.push(item);
				});
				return result;
			} else if (this.type === "intersect") {
				const result = {};
				for (const item of this.list) Object.assign(result, item.simplify(value));
				return result;
			} else if (this.type === "union") for (const schema of this.list) try {
				Schema.resolve(value, schema, {});
				return schema.simplify(value);
			} catch {}
			return value;
		};
		Schema.prototype.toString = function toString(inline) {
			return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
		};
		Schema.prototype.role = function role(role, extra) {
			const schema = Schema(this);
			schema.meta = {
				...schema.meta,
				role,
				extra
			};
			return schema;
		};
		for (const key of [
			"default",
			"link",
			"comment",
			"description",
			"max",
			"min",
			"step"
		]) Object.assign(Schema.prototype, { [key](value) {
			const schema = Schema(this);
			schema.meta = {
				...schema.meta,
				[key]: value
			};
			return schema;
		} });
		const resolvers = {};
		Schema.extend = function extend(type, resolve) {
			resolvers[type] = resolve;
		};
		Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
			if (!schema) return [data];
			if (options.ignore?.(data, schema)) return [data];
			if (isNullable(data) && schema.type !== "lazy") {
				if (schema.meta.required) throw new ValidationError(`missing required value`, options);
				let current = schema;
				let fallback = schema.meta.default;
				while (current?.type === "intersect" && isNullable(fallback)) {
					current = current.list[0];
					fallback = current?.meta.default;
				}
				if (isNullable(fallback)) return [data];
				data = clone(fallback);
			}
			const callback = resolvers[schema.type];
			if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
			try {
				return callback(data, schema, options, strict);
			} catch (error) {
				if (!schema.meta.loose) throw error;
				return [schema.meta.default];
			}
		};
		Schema.from = function from(source) {
			if (isNullable(source)) return Schema.any();
			else if ([
				"string",
				"number",
				"boolean"
			].includes(typeof source)) return Schema.const(source).required();
			else if (source[kSchema]) return source;
			else if (typeof source === "function") switch (source) {
				case String: return Schema.string().required();
				case Number: return Schema.number().required();
				case Boolean: return Schema.boolean().required();
				case Function: return Schema.function().required();
				default: return Schema.is(source).required();
			}
			else throw new TypeError(`cannot infer schema from ${source}`);
		};
		Schema.lazy = function lazy(builder) {
			const toJSON = () => {
				if (!schema.inner[kSchema]) {
					schema.inner = schema.builder();
					schema.inner.meta = {
						...schema.meta,
						...schema.inner.meta
					};
				}
				return schema.inner.toJSON();
			};
			const schema = new Schema({
				type: "lazy",
				builder,
				inner: { toJSON }
			});
			return schema;
		};
		Schema.natural = function natural() {
			return Schema.number().step(1).min(0);
		};
		Schema.percent = function percent() {
			return Schema.number().step(.01).min(0).max(1).role("slider");
		};
		Schema.date = function date() {
			return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
				const date = new Date(value);
				if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
				return date;
			}, true)]);
		};
		Schema.regExp = function regExp(flag = "") {
			return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
				try {
					return new RegExp(value, flag);
				} catch (e) {
					throw new ValidationError(e.message, options);
				}
			}, true)]);
		};
		Schema.arrayBuffer = function arrayBuffer(encoding) {
			return Schema.union([
				Schema.is(ArrayBuffer),
				Schema.is(SharedArrayBuffer),
				Schema.transform(Schema.any(), (value, options) => {
					if (Binary.isSource(value)) return Binary.fromSource(value);
					throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
				}, true),
				...encoding ? [Schema.transform(Schema.string(), (value, options) => {
					try {
						return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
					} catch (e) {
						throw new ValidationError(e.message, options);
					}
				}, true)] : []
			]);
		};
		Schema.extend("lazy", (data, schema, options, strict) => {
			if (!schema.inner[kSchema]) {
				schema.inner = schema.builder();
				schema.inner.meta = {
					...schema.meta,
					...schema.inner.meta
				};
			}
			return Schema.resolve(data, schema.inner, options, strict);
		});
		Schema.extend("any", (data) => {
			return [data];
		});
		Schema.extend("never", (data, _, options) => {
			throw new ValidationError(`expected nullable but got ${data}`, options);
		});
		Schema.extend("const", (data, { value }, options) => {
			if (deepEqual(data, value)) return [value];
			throw new ValidationError(`expected ${value} but got ${data}`, options);
		});
		function checkWithinRange(data, meta, description, options, skipMin = false) {
			const { max = Infinity, min = -Infinity } = meta;
			if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
			if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
		}
		Schema.extend("string", (data, { meta }, options) => {
			if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
			if (meta.pattern) {
				const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
				if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
			}
			checkWithinRange(data.length, meta, "string length", options);
			return [data];
		});
		function decimalShift(data, digits) {
			const str = data.toString();
			if (str.includes("e")) return data * Math.pow(10, digits);
			const index = str.indexOf(".");
			if (index === -1) return data * Math.pow(10, digits);
			const frac = str.slice(index + 1);
			const integer = str.slice(0, index);
			if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
			return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
		}
		function isMultipleOf(data, min, step) {
			step = Math.abs(step);
			if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
			const index = step.toString().indexOf(".");
			const digits = step.toString().slice(index + 1).length;
			return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
		}
		Schema.extend("number", (data, { meta }, options) => {
			if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
			checkWithinRange(data, meta, "number", options);
			const { step } = meta;
			if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
			return [data];
		});
		Schema.extend("boolean", (data, _, options) => {
			if (typeof data === "boolean") return [data];
			throw new ValidationError(`expected boolean but got ${data}`, options);
		});
		Schema.extend("bitset", (data, { bits, meta }, options) => {
			let value = 0, keys = [];
			if (typeof data === "number") {
				value = data;
				for (const key in bits) if (data & bits[key]) keys.push(key);
			} else if (Array.isArray(data)) {
				keys = data;
				for (const key of keys) {
					if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
					if (key in bits) value |= bits[key];
				}
			} else throw new ValidationError(`expected number or array but got ${data}`, options);
			if (value === meta.default) return [value];
			return [value, keys];
		});
		Schema.extend("function", (data, _, options) => {
			if (typeof data === "function") return [data];
			throw new ValidationError(`expected function but got ${data}`, options);
		});
		Schema.extend("is", (data, { constructor }, options) => {
			if (typeof constructor === "function") {
				if (data instanceof constructor) return [data];
				throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
			} else {
				if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
				let prototype = Object.getPrototypeOf(data);
				while (prototype) {
					if (prototype.constructor?.name === constructor) return [data];
					prototype = Object.getPrototypeOf(prototype);
				}
				throw new ValidationError(`expected ${constructor} but got ${data}`, options);
			}
		});
		function property(data, key, schema, options) {
			try {
				const [value, adapted] = Schema.resolve(data[key], schema, {
					...options,
					path: [...options.path || [], key]
				});
				if (adapted !== void 0) data[key] = adapted;
				return value;
			} catch (e) {
				if (!options?.autofix) throw e;
				delete data[key];
				return schema.meta.default;
			}
		}
		Schema.extend("array", (data, { inner, meta }, options) => {
			if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
			checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
			return [data.map((_, index) => property(data, index, inner, options))];
		});
		Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
			if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
			const result = {};
			for (const key in data) {
				let rKey;
				try {
					rKey = Schema.resolve(key, sKey, options)[0];
				} catch (error) {
					if (strict) continue;
					throw error;
				}
				result[rKey] = property(data, key, inner, options);
				data[rKey] = data[key];
				if (key !== rKey) delete data[key];
			}
			return [result];
		});
		Schema.extend("tuple", (data, { list }, options, strict) => {
			if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
			const result = list.map((inner, index) => property(data, index, inner, options));
			if (strict) return [result];
			result.push(...data.slice(list.length));
			return [result];
		});
		function merge(result, data) {
			for (const key in data) {
				if (key in result) continue;
				result[key] = data[key];
			}
		}
		Schema.extend("object", (data, { dict }, options, strict) => {
			if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
			const result = {};
			for (const key in dict) {
				const value = property(data, key, dict[key], options);
				if (!isNullable(value) || key in data) result[key] = value;
			}
			if (!strict) merge(result, data);
			return [result];
		});
		Schema.extend("union", (data, { list, toString }, options, strict) => {
			const messages = [];
			for (const inner of list) try {
				return Schema.resolve(data, inner, options, strict);
			} catch (error) {
				messages.push(error);
			}
			throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		});
		Schema.extend("intersect", (data, { list, toString }, options, strict) => {
			if (!list.length) return [data];
			let result;
			for (const inner of list) {
				const value = Schema.resolve(data, inner, options, true)[0];
				if (isNullable(value)) continue;
				if (isNullable(result)) result = value;
				else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
				else if (typeof value === "object") merge(result ??= {}, value);
				else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
			}
			if (!strict && isPlainObject(data)) merge(result, data);
			return [result];
		});
		Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
			const [result, adapted = data] = Schema.resolve(data, inner, options, true);
			if (preserve) return [callback(result)];
			else return [callback(result), callback(adapted)];
		});
		const formatters = {};
		function defineMethod(name, keys, format) {
			formatters[name] = format;
			Object.assign(Schema, { [name](...args) {
				const schema = new Schema({ type: name });
				keys.forEach((key, index) => {
					switch (key) {
						case "sKey":
							schema.sKey = args[index] ?? Schema.string();
							break;
						case "inner":
							schema.inner = Schema.from(args[index]);
							break;
						case "list":
							schema.list = args[index].map(Schema.from);
							break;
						case "dict":
							schema.dict = mapValues(args[index], Schema.from);
							break;
						case "bits":
							schema.bits = {};
							for (const key in args[index]) {
								if (typeof args[index][key] !== "number") continue;
								schema.bits[key] = args[index][key];
							}
							break;
						case "callback": {
							const callback = schema.callback = args[index];
							callback["toJSON"] ||= () => callback.toString();
							break;
						}
						case "constructor": {
							const constructor = schema.constructor = args[index];
							if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
							break;
						}
						default: schema[key] = args[index];
					}
				});
				if (name === "object" || name === "dict") schema.meta.default = {};
				else if (name === "array" || name === "tuple") schema.meta.default = [];
				else if (name === "bitset") schema.meta.default = 0;
				return schema;
			} });
		}
		defineMethod("is", ["constructor"], ({ constructor }) => {
			if (typeof constructor === "function") return constructor.name;
			else return constructor;
		});
		defineMethod("any", [], () => "any");
		defineMethod("never", [], () => "never");
		defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
		defineMethod("string", [], () => "string");
		defineMethod("number", [], () => "number");
		defineMethod("boolean", [], () => "boolean");
		defineMethod("bitset", ["bits"], () => "bitset");
		defineMethod("function", [], () => "function");
		defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
		defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
		defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
		defineMethod("object", ["dict"], ({ dict }) => {
			if (Object.keys(dict).length === 0) return "{}";
			return `{ ${Object.entries(dict).map(([key, inner]) => {
				return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
			}).join(", ")} }`;
		});
		defineMethod("union", ["list"], ({ list }, inline) => {
			const result = list.map(({ toString: format }) => format()).join(" | ");
			return inline ? `(${result})` : result;
		});
		defineMethod("intersect", ["list"], ({ list }) => {
			return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
		});
		defineMethod("transform", [
			"inner",
			"callback",
			"preserve"
		], ({ inner }, isInner) => inner.toString(isInner));
		//#endregion
		//#region lib/types/theme-settings.js
		/** Theme preferences stored in the Host user-settings document. */
		/** Built-in preferences accepted at the registry and settings boundaries. */
		const THEME_PREFERENCES = [
			"light",
			"dark",
			"system"
		];
		/** Settings namespace owned by the theme plugin. */
		const THEME_SETTINGS_NAMESPACE = "ui-theme";
		/** Field carrying the selected built-in theme preference. */
		const THEME_PREFERENCE_FIELD = "preference";
		/** Default preference when the user-settings document has no override. */
		const DEFAULT_PREFERENCE = "system";
		Schema.object({ [THEME_PREFERENCE_FIELD]: Schema.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE) });
		/**
		* Narrow one wire or registry value to a persistable preference.
		* @param value - value crossing the settings or registry boundary.
		* @returns whether the value is a built-in preference.
		*/
		function isThemePreference(value) {
			return THEME_PREFERENCES.some((preference) => preference === value);
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Namespace owning this feature's settings-row copy. */
		const SETTINGS_NS = "settings.theme";
		const BUILTIN_THEMES = Object.freeze([Object.freeze({
			id: "light",
			colorScheme: "light",
			tokens: Object.freeze({})
		}), Object.freeze({
			id: "dark",
			colorScheme: "dark",
			tokens: Object.freeze({})
		})]);
		const BUILTIN_INSPECT_TOKENS = Object.freeze([
			{
				name: "--dsw-alias-bg-base",
				description: "Application base background.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-alias-bg-base"
			},
			{
				name: "--dsw-alias-bg-layer-1",
				description: "Primary raised surface background.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-alias-bg-layer-1"
			},
			{
				name: "--dsw-alias-bg-layer-2",
				description: "Secondary nested surface background.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-alias-bg-layer-2"
			},
			{
				name: "--dsw-alias-bg-overlay",
				description: "Overlay and popover background.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-alias-bg-overlay"
			},
			{
				name: "--dsw-alias-border-l1",
				description: "Primary subtle border.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-alias-border-l1"
			},
			{
				name: "--dsw-alias-border-l2",
				description: "Secondary stronger border.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-alias-border-l2"
			},
			{
				name: "--dsw-alias-brand-primary",
				description: "Primary brand accent.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-alias-brand-primary"
			},
			{
				name: "--dsw-alias-label-primary",
				description: "Primary text color.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-alias-label-primary"
			},
			{
				name: "--dsw-alias-label-secondary",
				description: "Secondary text color.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-alias-label-secondary"
			},
			{
				name: "--dsw-alias-state-error-primary",
				description: "Primary error state color.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-alias-state-error-primary"
			},
			{
				name: "--dsw-alias-state-success-primary",
				description: "Primary success state color.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-alias-state-success-primary"
			},
			{
				name: "--dsw-alias-state-warn-primary",
				description: "Primary warning state color.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-alias-state-warn-primary"
			},
			{
				name: "--dsw-specific-sidebar-fill",
				description: "Sidebar column and title-row background.",
				valueType: "CSS color",
				requiresLightAndDark: true,
				cssVariable: "--dsw-specific-sidebar-fill"
			}
		]);
		/**
		* Theme registry and preference owner. `light`/`dark` are built in (the base
		* stylesheets carry both palettes); third-party themes register alias-layer
		* overrides. Reads go through {@link getTheme}; preference writes only
		* through {@link setTheme}; continuous sync only through the `theme/change`
		* event. {@link overrideTokens} stacks partial token layers over the active
		* theme without touching the registry.
		* The service holds the `prefers-color-scheme` media query (environment
		* sensing, not presentation) and re-emits when the OS scheme flips while the
		* preference is `system`.
		*/
		var ThemeRuntime = class {
			ctx;
			host;
			themes = [...BUILTIN_THEMES];
			preference;
			revision = 0;
			snapshot;
			media;
			/** Override layers by source; seq (monotonic) is the stacking order. */
			overrides = /* @__PURE__ */ new Map();
			overrideSeq = 0;
			/**
			* @param ctx - owning context (change events are emitted on it; the
			* media-query and scope listeners are released through ctx.effect on dispose).
			* @param host - durable preference scope owned by the same plugin.
			*/
			constructor(ctx, host) {
				this.ctx = ctx;
				this.host = host;
				this.preference = DEFAULT_PREFERENCE;
				this.media = typeof matchMedia === "undefined" ? void 0 : matchMedia("(prefers-color-scheme: dark)");
				this.snapshot = this.buildSnapshot();
				if (this.media !== void 0) {
					const media = this.media;
					const onChange = () => {
						if (this.preference !== "system") return;
						this.publish();
					};
					ctx.effect(() => {
						media.addEventListener("change", onChange);
						return () => {
							media.removeEventListener("change", onChange);
						};
					}, "ui-theme: prefers-color-scheme listener");
				}
				ctx.effect(() => host.subscribe(() => {
					this.adopt();
				}), "ui-theme: settings scope adoption");
				this.adopt();
			}
			/**
			* Read the current immutable theme snapshot.
			* @returns the current snapshot (stable reference until the next change).
			*/
			getTheme() {
				return this.snapshot;
			}
			/**
			* Export the current token directory without reading DOM or computed styles.
			* @returns stable JSON-safe token descriptions, including registered and override-only names.
			*/
			exportInspectTokens() {
				const tokens = new Map(BUILTIN_INSPECT_TOKENS.map((token) => [token.name, token]));
				for (const theme of this.themes) for (const name of Object.keys(theme.tokens)) if (!tokens.has(name)) tokens.set(name, dynamicToken(name));
				for (const layer of this.overrides.values()) for (const name of Object.keys(layer.tokens)) if (!tokens.has(name)) tokens.set(name, dynamicToken(name));
				return [...tokens.values()].map((token) => ({ ...token })).sort((left, right) => left.name.localeCompare(right.name));
			}
			/**
			* Switch the theme preference — the only user preference write entry.
			* Built-in preferences are written through the settings scope and every
			* accepted value emits `theme/change`.
			* @param id - a registered theme id or `system`; unknown ids throw.
			*/
			setTheme(id) {
				if (id !== "system" && !this.themes.some((t) => t.id === id)) throw new Error(`theme "${id}" is not registered`);
				if (this.preference === id) return;
				this.preference = id;
				if (isThemePreference(id)) this.host.set(THEME_PREFERENCE_FIELD, id);
				this.publish();
			}
			/** Adopt the scope's accepted durable preference without writing it back. */
			adopt() {
				const section = this.host.getSnapshot().value;
				if (section === void 0 || this.preference === section.preference) return;
				this.preference = section.preference;
				this.publish();
			}
			/**
			* Register a theme. Duplicate id throws (single occupant per id; the
			* built-in pair counts; `system` is a preference, not a registrable id).
			* @param definition - theme id, colorScheme, and alias-token overrides.
			* @returns disposer. Disposing the theme backing the active preference
			* resets the preference to the default so the UI never keeps tokens of an
			* unregistered theme.
			*/
			register(definition) {
				if (definition.id === "system") throw new Error("\"system\" is a preference, not a registrable theme id");
				if (this.themes.some((t) => t.id === definition.id)) throw new Error(`theme "${definition.id}" is already registered`);
				this.themes = [...this.themes, definition];
				this.publish();
				return () => {
					if (!this.themes.some((t) => t.id === definition.id)) return;
					this.themes = this.themes.filter((t) => t.id !== definition.id);
					if (this.preference === definition.id) this.preference = DEFAULT_PREFERENCE;
					this.publish();
				};
			}
			/**
			* Stack a token override layer on top of the active theme — the token-level
			* analogue of slot shading: the base theme stays untouched, layers compose
			* in seq order with later layers winning per-token, and removing a layer
			* restores whatever it covered. Calling again with the same source replaces
			* that source's whole layer and restacks it on top (effect re-registration
			* semantics). Emits `theme/change` with the recomposed snapshot.
			* @param source - layer identity; one layer per source (dynamic packages
			* pass their package id — the façade pins it, so it also names the layer's
			* origin for inspection).
			* @param tokens - token-name → `{ light, dark }` value pairs. Validated at
			* runtime (model-authored callers reach this boundary with untyped JS);
			* a bare string value throws a teaching error.
			* @returns disposer removing exactly the layer this call created; a no-op
			* once the source has re-overridden (the newer layer is not torn down).
			*/
			overrideTokens(source, tokens) {
				const layer = {
					seq: this.overrideSeq++,
					tokens: validateOverrides(source, tokens)
				};
				this.overrides.set(source, layer);
				this.publish();
				return () => {
					if (this.overrides.get(source) !== layer) return;
					this.overrides.delete(source);
					this.publish();
				};
			}
			buildSnapshot() {
				const resolvedId = this.preference === "system" ? this.media?.matches === true ? "dark" : "light" : this.preference;
				const active = this.themes.find((t) => t.id === resolvedId);
				/* v8 ignore next 2 -- needs a registry without light/dark, which register()/dispose() cannot produce */
				if (active === void 0) throw new Error(`theme registry lost "${resolvedId}"`);
				return Object.freeze({
					preference: this.preference,
					active: this.composeActive(active),
					themes: Object.freeze([...this.themes]),
					revision: this.revision
				});
			}
			/**
			* Fold the override layers into the active definition: seq order, later
			* layers win per-token, each value picked for the active color scheme (the
			* presenter consumes the composed snapshot and needs no override awareness).
			* Without layers the registered definition passes through by identity.
			*/
			composeActive(active) {
				if (this.overrides.size === 0) return active;
				const tokens = { ...active.tokens };
				for (const layer of [...this.overrides.values()].sort((a, b) => a.seq - b.seq)) for (const [name, modes] of Object.entries(layer.tokens)) tokens[name] = modes[active.colorScheme];
				return Object.freeze({
					...active,
					tokens: Object.freeze(tokens)
				});
			}
			publish() {
				this.revision += 1;
				this.snapshot = this.buildSnapshot();
				this.ctx.emit("theme/change", this.snapshot);
			}
		};
		/**
		* Runtime shape check for one override layer (model-authored callers pass
		* untyped JS through the dynamic-package façade, so the static type cannot
		* enforce the pair shape there). Returns a defensive per-token copy so later
		* caller mutation cannot reach the stored layer.
		*/
		function validateOverrides(source, tokens) {
			const validated = {};
			for (const [name, value] of Object.entries(tokens)) {
				if (typeof value === "string") throw new TypeError(`theme override "${name}" from "${source}" is a bare string — pass { light: ${JSON.stringify(value)}, dark: ${JSON.stringify(value)} } (repeat the value when it is the same in both palettes); a single value goes illegible when the user switches color scheme`);
				if (typeof value !== "object" || value === null || typeof value.light !== "string" || typeof value.dark !== "string") throw new TypeError(`theme override "${name}" from "${source}" must map to a { light, dark } pair of strings — one value per color scheme`);
				const modes = value;
				validated[name] = {
					light: modes.light,
					dark: modes.dark
				};
			}
			return validated;
		}
		function dynamicToken(name) {
			return {
				name,
				description: "Theme token registered by the current Client composition.",
				valueType: "CSS value",
				requiresLightAndDark: true,
				...name.startsWith("--") ? { cssVariable: name } : {}
			};
		}
		/**
		* Required services: settings transport plus slots/locale for the Appearance
		* row. `remote` carries the forwarded settings invalidation that
		* `bindSettingsScope` subscribes to on this context.
		*/
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"settingsScope"
		];
		/**
		* Client plugin body: provide the theme service and register the
		* feature-owned Appearance preference row into the General section's item
		* slot (a feature owns its settings surface).
		* @param ctx - client cordis context.
		*/
		function apply(ctx) {
			const theme = new ThemeRuntime(ctx, ctx.settingsScope.bind({ namespace: THEME_SETTINGS_NAMESPACE }));
			ctx.provide("theme", theme);
			ctx.effect(() => ctx.locale.register(SETTINGS_NS, {
				zh,
				en
			}), "ui-theme: settings row dictionaries");
			const store = createAppearanceRowStore();
			let bound;
			const sync = (snapshot) => {
				bound?.sync(snapshot.preference, snapshot.revision);
			};
			ctx.on("theme/change", sync);
			const injected = (actions) => {
				bound = actions;
				sync(theme.getTheme());
				return { setTheme: (id) => {
					theme.setTheme(id);
				} };
			};
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "appearance",
				order: 10,
				store,
				locale: SETTINGS_NS,
				inject: injected
			}, AppearanceRow));
		}
		//#endregion
		exports.SETTINGS_NS = SETTINGS_NS;
		exports.ThemeRuntime = ThemeRuntime;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map