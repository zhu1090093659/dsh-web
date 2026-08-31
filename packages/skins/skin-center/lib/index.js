import z from "schemastery";
import { chmodSync, closeSync, cpSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { transform } from "lightningcss";
import { execFile, execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { pipeline } from "node:stream";
import { dirname as dirname$1, join as join$1 } from "node:path/posix";
import { Buffer as Buffer$1 } from "node:buffer";
import { decode } from "jpeg-js";
import { deflateSync, inflateSync } from "node:zlib";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region src/http.ts
/** Default body cap for readJsonBody: 64 KiB. */
const DEFAULT_JSON_BODY_MAX_BYTES = 64 * 1024;
/** Family-default JSON response headers; callers may append or override. */
const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	"referrer-policy": "no-referrer"
};
/**
* Lenient bounded body reader: parse a request body as JSON, or null on an
* empty body, invalid JSON, or a body past maxBytes (default 64 KiB).
* Overflow destroys the request instead of draining the remainder (no drain
* call, matching the current repo-wide behavior); callers must not keep
* reading the request afterwards. With objectOnly, non-JSON-object payloads
* also yield null.
*/
async function readJsonBody(req, opts = {}) {
	const maxBytes = opts.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES;
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		size += buffer.length;
		if (size > maxBytes) {
			req.destroy();
			return null;
		}
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text === "") return null;
	try {
		const parsed = JSON.parse(text);
		if (opts.objectOnly && !isJsonObject(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}
/** Whether a value is a JSON object: typeof object, not null, not an array. */
function isJsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Write one JSON response. Default headers are the family defaults
* (content-type and referrer-policy); caller headers are appended or
* override them.
*/
function writeJson(res, status, body, headers = {}) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		...JSON_HEADERS,
		...headers
	});
	res.end(payload);
}
//#endregion
//#region src/http-utils.ts
/** True when an `Origin` header names a host other than the request Host.
*  Browsers send Origin on CORS requests and on all POSTs; opaque origins
*  (sandboxed iframes) serialize as the literal string "null". */
function hasForeignOrigin(req) {
	const origin = req.headers.origin;
	if (typeof origin !== "string" || origin === "" || origin === "null") return false;
	const host = req.headers.host;
	if (typeof host !== "string" || host === "") return true;
	try {
		return new URL(origin).host !== host;
	} catch {
		return true;
	}
}
/**
* Same-origin fence. Browsers send Sec-Fetch-Site on every fetch: a
* cross-site fetch is always rejected, and an Origin that does not match the
* request Host is rejected. Requests without either header (curl, node http,
* old browsers) pass — this is a local single-user tool, and the fence only
* targets the cross-site browser vector.
*/
function isSameOriginRequest(req) {
	const site = req.headers["sec-fetch-site"];
	if (typeof site === "string" && site === "cross-site") return false;
	return !hasForeignOrigin(req);
}
/** Reject cross-site requests with 403. */
function requireSameOrigin(req, res) {
	if (isSameOriginRequest(req)) return true;
	writeJson(res, 403, {
		ok: false,
		error: "cross-site-request-rejected"
	});
	return false;
}
/**
* Fence for the read-only wallpaper-content serving routes (/web/,
* /shim.js, /scene-manifest/, /scene-resource/). The wallpaper iframes are
* sandboxed without allow-same-origin, so their documents carry an opaque
* origin and every load they make (scripts, images, fetches) arrives as
* Sec-Fetch-Site: cross-site — the strict fence would 403 the wallpaper's
* own assets. These GETs are token-gated and side-effect free, so the
* Sec-Fetch-Site check is dropped while the foreign-origin rejection stays.
*/
function requireContentOrigin(req, res) {
	if (hasForeignOrigin(req)) {
		writeJson(res, 403, {
			ok: false,
			error: "cross-site-request-rejected"
		});
		return false;
	}
	return true;
}
//#endregion
//#region src/core/background.ts
/** Effective value of every field when the state carries none. */
const SKIN_BACKGROUND_DEFAULTS = {
	enabled: true,
	backgroundOpacity: 0,
	backgroundBlurEmpty: 0,
	backgroundBlurContent: 0,
	inputCardBlur: 10,
	bubbleOpacity: 50
};
/** The fields normalize/sanitize know about; unknown keys are dropped. */
const SKIN_BACKGROUND_FIELDS = Object.keys(SKIN_BACKGROUND_DEFAULTS);
function clampInt(value, min, max) {
	return Math.max(min, Math.min(max, Math.round(value)));
}
const RANGES = {
	backgroundOpacity: [0, 100],
	backgroundBlurEmpty: [0, 20],
	backgroundBlurContent: [0, 20],
	inputCardBlur: [0, 20],
	bubbleOpacity: [0, 100]
};
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Lenient normalization for stored/legacy data: unknown keys and wrongly
* typed fields are dropped, numeric fields are clamped into range. Never
* fails; a non-object input yields an empty config.
*/
function normalizeSkinBackground(value) {
	if (!isRecord$1(value)) return {};
	const out = {};
	if (typeof value.enabled === "boolean") out.enabled = value.enabled;
	for (const field of Object.keys(RANGES)) {
		const raw = value[field];
		if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
		const [min, max] = RANGES[field];
		out[field] = clampInt(raw, min, max);
	}
	return out;
}
/**
* Strict validation for the POST /active write surface: a background value
* must be an object whose known fields are correctly typed (numbers are then
* clamped). Returns null for anything else so the route can answer 400.
*/
function sanitizeSkinBackground(value) {
	if (!isRecord$1(value)) return null;
	if (value.enabled !== void 0 && typeof value.enabled !== "boolean") return null;
	for (const field of Object.keys(RANGES)) {
		const raw = value[field];
		if (raw !== void 0 && (typeof raw !== "number" || !Number.isFinite(raw))) return null;
	}
	return normalizeSkinBackground(value);
}
/** True when at least one field departs from its default (customized data). */
function hasCustomSkinBackground(value) {
	return SKIN_BACKGROUND_FIELDS.some((field) => value[field] !== void 0 && value[field] !== SKIN_BACKGROUND_DEFAULTS[field]);
}
//#endregion
//#region src/core/manifest-v2/types.ts
/** v1 fields accepted but ignored with a migration warning (never fail-closed). */
const DEPRECATED_V1_FIELDS = [
	"package",
	"wiring",
	"bodyAttr"
];
//#endregion
//#region src/core/manifest-v2/validate.ts
/**
* Fail-closed validator for skin.json manifest v2.
*
* Pure, dependency-free, safe in both the host (node) and the browser
* bundle. Rules (issue #506, section 5):
*  - unknown top-level / nested fields are hard errors (fail-closed);
*  - the v1 fields `package` / `wiring` / `bodyAttr` are an explicit
*    deprecated allowlist: ignored with a migration warning, never an
*    error — otherwise the 11 legacy manifests would be rejected by their
*    own validator;
*  - all file references must be relative paths inside the skin directory
*    (no leading slash, no "..", no protocol URLs);
*  - `skinManifestVersion` declares file structure only; hooks runtime
*    compatibility is carried by `facets.client.apiVersion` and checked
*    by the loader, not here.
*/
const REL_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*:\/\/)[A-Za-z0-9._\-/]+$/;
const SKIN_ID$1 = /^[a-z][a-z0-9-]{0,31}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const API_VERSION = /^x-org\.linxin666\.skin-center\/[a-z0-9]+$/;
const TOP_LEVEL_KEYS = /* @__PURE__ */ new Set([
	"$schema",
	"skinManifestVersion",
	"id",
	"name",
	"nameEn",
	"version",
	"author",
	"tagline",
	"description",
	"tags",
	"accent",
	"order",
	"preview",
	"license",
	"licenseUrl",
	"noticeUrl",
	"sourceUrl",
	"attribution",
	"requires",
	"contributes",
	"facets",
	...DEPRECATED_V1_FIELDS
]);
const DEPRECATED_SET = new Set(DEPRECATED_V1_FIELDS);
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function checkKeys(obj, allowed, path, errors) {
	for (const key of Object.keys(obj)) if (!allowed.has(key)) errors.push(`${path}: unknown field "${key}"`);
}
function checkRelPath(value, path, errors) {
	if (typeof value !== "string" || !REL_PATH.test(value)) errors.push(`${path}: must be a relative path inside the skin directory (got ${JSON.stringify(value)})`);
}
function checkOptionalString(value, path, errors) {
	if (value !== void 0 && typeof value !== "string") errors.push(`${path}: must be a string`);
}
function checkBackgroundLayer(value, path, errors) {
	if (value === void 0) return;
	if (!isRecord(value)) {
		errors.push(`${path}: must be an object`);
		return;
	}
	checkKeys(value, /* @__PURE__ */ new Set([
		"type",
		"src",
		"scrim"
	]), path, errors);
	if (value.type !== "image" && value.type !== "video") errors.push(`${path}.type: must be "image" or "video"`);
	checkRelPath(value.src, `${path}.src`, errors);
	checkOptionalString(value.scrim, `${path}.scrim`, errors);
}
function checkContracts(value, path, errors) {
	if (value === void 0) return;
	if (!Array.isArray(value)) {
		errors.push(`${path}: must be an array`);
		return;
	}
	value.forEach((entry, index) => {
		const p = `${path}[${index}]`;
		if (!isRecord(entry)) {
			errors.push(`${p}: must be an object`);
			return;
		}
		checkKeys(entry, /* @__PURE__ */ new Set([
			"apiVersion",
			"kind",
			"optional"
		]), p, errors);
		if (typeof entry.apiVersion !== "string" || !API_VERSION.test(entry.apiVersion)) errors.push(`${p}.apiVersion: must match x-org.linxin666.skin-center/<tag>`);
		if (entry.kind !== "SkinRuntime" && entry.kind !== "SkinHooks") errors.push(`${p}.kind: must be "SkinRuntime" or "SkinHooks"`);
		if (entry.optional !== void 0 && typeof entry.optional !== "boolean") errors.push(`${p}.optional: must be a boolean`);
	});
}
/**
* Validate a parsed skin.json payload against the v2 contract.
* Never throws; malformed input yields `ok: false` with human-readable errors.
*/
function validateSkinManifestV2(input) {
	const errors = [];
	const warnings = [];
	if (!isRecord(input)) return {
		ok: false,
		errors: ["manifest: must be a JSON object"],
		warnings
	};
	for (const field of Object.keys(input)) if (DEPRECATED_SET.has(field)) warnings.push(`deprecated v1 field "${field}" ignored; run the v1→v2 migration codemod`);
	checkKeys(input, TOP_LEVEL_KEYS, "manifest", errors);
	if (input.skinManifestVersion !== 2) errors.push("manifest.skinManifestVersion: must be 2 (v1 manifests need the migration codemod)");
	if (typeof input.id !== "string" || !SKIN_ID$1.test(input.id)) errors.push(`manifest.id: must match ${SKIN_ID$1} (got ${JSON.stringify(input.id)})`);
	for (const field of [
		"name",
		"nameEn",
		"author"
	]) if (typeof input[field] !== "string" || input[field].length === 0) errors.push(`manifest.${field}: required non-empty string`);
	if (typeof input.version !== "string" || !SEMVER.test(input.version)) errors.push(`manifest.version: required SemVer string (got ${JSON.stringify(input.version)})`);
	checkOptionalString(input.tagline, "manifest.tagline", errors);
	checkOptionalString(input.description, "manifest.description", errors);
	for (const field of [
		"license",
		"licenseUrl",
		"noticeUrl",
		"sourceUrl",
		"attribution"
	]) checkOptionalString(input[field], `manifest.${field}`, errors);
	if (input.tags !== void 0) {
		if (!Array.isArray(input.tags) || input.tags.some((t) => typeof t !== "string")) errors.push("manifest.tags: must be a string array");
	}
	if (input.accent !== void 0 && (typeof input.accent !== "string" || !HEX_COLOR.test(input.accent))) errors.push(`manifest.accent: must be a #rrggbb color (got ${JSON.stringify(input.accent)})`);
	if (input.order !== void 0 && !Number.isInteger(input.order)) errors.push("manifest.order: must be an integer");
	if (input.$schema !== void 0 && typeof input.$schema !== "string") errors.push("manifest.$schema: must be a string");
	if (input.preview !== void 0) if (!isRecord(input.preview)) errors.push("manifest.preview: must be an object");
	else {
		checkKeys(input.preview, /* @__PURE__ */ new Set(["light", "dark"]), "manifest.preview", errors);
		checkRelPath(input.preview.light, "manifest.preview.light", errors);
		checkRelPath(input.preview.dark, "manifest.preview.dark", errors);
	}
	if (input.requires !== void 0) if (!isRecord(input.requires)) errors.push("manifest.requires: must be an object");
	else {
		checkKeys(input.requires, /* @__PURE__ */ new Set(["contracts"]), "manifest.requires", errors);
		checkContracts(input.requires.contracts, "manifest.requires.contracts", errors);
	}
	if (!isRecord(input.contributes)) errors.push("manifest.contributes: required object with at least \"stylesheet\"");
	else {
		const contributes = input.contributes;
		checkKeys(contributes, /* @__PURE__ */ new Set([
			"stylesheet",
			"patches",
			"backgroundMedia"
		]), "manifest.contributes", errors);
		checkRelPath(contributes.stylesheet, "manifest.contributes.stylesheet", errors);
		if (contributes.patches !== void 0) checkRelPath(contributes.patches, "manifest.contributes.patches", errors);
		if (contributes.backgroundMedia !== void 0) if (!isRecord(contributes.backgroundMedia)) errors.push("manifest.contributes.backgroundMedia: must be an object");
		else {
			checkKeys(contributes.backgroundMedia, /* @__PURE__ */ new Set(["light", "dark"]), "manifest.contributes.backgroundMedia", errors);
			checkBackgroundLayer(contributes.backgroundMedia.light, "manifest.contributes.backgroundMedia.light", errors);
			checkBackgroundLayer(contributes.backgroundMedia.dark, "manifest.contributes.backgroundMedia.dark", errors);
		}
	}
	if (input.facets !== void 0) if (!isRecord(input.facets)) errors.push("manifest.facets: must be an object");
	else {
		checkKeys(input.facets, /* @__PURE__ */ new Set(["client"]), "manifest.facets", errors);
		if (input.facets.client !== void 0) {
			const client = input.facets.client;
			if (!isRecord(client)) errors.push("manifest.facets.client: must be an object");
			else {
				checkKeys(client, /* @__PURE__ */ new Set(["entry", "apiVersion"]), "manifest.facets.client", errors);
				checkRelPath(client.entry, "manifest.facets.client.entry", errors);
				if (typeof client.apiVersion !== "string" || !API_VERSION.test(client.apiVersion)) errors.push("manifest.facets.client.apiVersion: must match x-org.linxin666.skin-center/<tag>");
			}
		}
	}
	const manifest = errors.length === 0 ? input : void 0;
	return {
		ok: errors.length === 0,
		errors,
		warnings,
		manifest
	};
}
//#endregion
//#region src/core/css-safety/token-audit.ts
const PRIMARY_ACTION_FILL$1 = "--dsw-alias-button-primary-fill";
const PRIMARY_ACTION_HOVER$1 = "--dsw-alias-button-primary-hover";
const PRIMARY_ACTION_DIMMED$1 = "--dsw-alias-button-primary-dimmed";
const PRIMARY_ACTION_FOREGROUND$1 = "--dsw-alias-label-primary-foreground";
const BRAND_PRIMARY = "--dsw-alias-brand-primary";
const BRAND_PRIMARY_INVERT = "--dsw-alias-brand-primary-invert";
/** Shell fill/foreground defaults per theme (both resolve to the official
* theme's own matched CTA: #0f1115 on #ffffff light, #f9fafb on #0f1115 dark). */
const SHELL_CTA = {
	light: {
		fill: "#0f1115",
		foreground: "#ffffff"
	},
	dark: {
		fill: "#f9fafb",
		foreground: "#0f1115"
	}
};
/**
* Official static palette values referenced through var() by skinned tokens
* (the subset the built-in skins actually use; mirrors the official
* dsh-client-ui-theme static table). If a value ever drifts, contrast
* resolution degrades to "skip", never to a wrong verdict.
*/
const STATIC_PALETTE = {
	"--dsw-static-amber-400": "#f7ad31",
	"--dsw-static-amber-500": "#f59e0b",
	"--dsw-static-blue-100": "#dbeafe",
	"--dsw-static-blue-300": "#93c5fd",
	"--dsw-static-blue-400": "#60a5fa",
	"--dsw-static-blue-450": "#4d93f8",
	"--dsw-static-blue-500": "#3b82f6",
	"--dsw-static-blue-600": "#2563eb",
	"--dsw-static-blue-800": "#1e40af",
	"--dsw-static-green-400": "#4ed17e",
	"--dsw-static-green-500": "#22c55e",
	"--dsw-static-neutral-bluish-00": "#fff",
	"--dsw-static-neutral-bluish-1000": "#0f1115",
	"--dsw-static-neutral-bluish-200": "#e1e5ee",
	"--dsw-static-neutral-bluish-300": "#cfd3d6",
	"--dsw-static-neutral-bluish-400": "#adb2b8",
	"--dsw-static-neutral-bluish-500": "#979da6",
	"--dsw-static-neutral-bluish-600": "#81858c",
	"--dsw-static-neutral-bluish-700": "#61666b",
	"--dsw-static-neutral-bluish-750": "#43454a",
	"--dsw-static-neutral-bluish-800": "#353638",
	"--dsw-static-neutral-bluish-950": "#151517"
};
/** Index of the brace that closes the one opened at `open`. */
function matchClose(css, open) {
	let depth = 0;
	for (let i = open; i < css.length; i += 1) {
		const ch = css[i];
		if (ch === "{") depth += 1;
		else if (ch === "}") {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
}
/** Recursive scan: map every custom-property declaration to a theme bucket. */
function parseDefinitions(css) {
	const defined = /* @__PURE__ */ new Set();
	const light = /* @__PURE__ */ new Map();
	const dark = /* @__PURE__ */ new Map();
	const source = withoutComments(css);
	const visit = (start, limit, parentDark) => {
		let i = start;
		for (;;) {
			const open = source.indexOf("{", i);
			if (open === -1 || open >= limit) return;
			const rawClose = matchClose(source, open);
			const close = rawClose === -1 || rawClose >= limit ? -1 : rawClose;
			const head = source.slice(i, open);
			const atRule = head.trimStart().startsWith("@");
			const darkHere = parentDark || /data-ds-dark-theme/.test(head) || /prefers-color-scheme\s*:\s*dark/i.test(head);
			if (atRule) {
				visit(open + 1, close === -1 ? limit : close, darkHere);
				i = close === -1 ? source.length : close + 1;
			} else {
				const end = close === -1 ? source.length : close;
				const body = source.slice(open + 1, end);
				const target = darkHere ? dark : light;
				for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
					const name = match[1];
					const value = match[2];
					if (name === void 0 || value === void 0) continue;
					defined.add(name);
					target.set(name, value.trim());
				}
				i = end + 1;
			}
		}
	};
	visit(0, source.length, false);
	return {
		defined,
		byTheme: {
			light,
			dark
		}
	};
}
function withoutComments(css) {
	return css.replace(/\/\*[\s\S]*?\*\//g, "");
}
/** Normalize #rgb / #rrggbb / #rrggbbaa to #rrggbb (alpha ignored). */
function normalizeHex(v) {
	const m = /^#([0-9a-f]{3,8})$/i.exec(v);
	if (m === null) return null;
	const h = m[1] ?? "";
	if (h.length === 3) return "#" + h.split("").map((c) => c + c).join("");
	if (h.length >= 6) return "#" + h.slice(0, 6);
	return null;
}
/** Resolve one declaration value to a #rrggbb color (one theme map). */
function resolveColor(value, theme, parsed, depth = 0) {
	const v = value.trim();
	const hex = normalizeHex(v);
	if (hex !== null) return hex;
	const viaVar = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\s*\)$/.exec(v);
	if (viaVar === null || depth >= 4) return null;
	const name = viaVar[1];
	if (name !== void 0 && STATIC_PALETTE[name] !== void 0) return STATIC_PALETTE[name];
	const own = name !== void 0 ? parsed.byTheme[theme].get(name) ?? parsed.byTheme[theme === "light" ? "dark" : "light"].get(name) : void 0;
	if (own !== void 0) return resolveColor(own, theme, parsed, depth + 1);
	const fallback = viaVar[2];
	return fallback !== void 0 ? resolveColor(fallback, theme, parsed, depth + 1) : null;
}
function rgbOf(hex) {
	const m = /^#([0-9a-f]{6})$/i.exec(hex);
	if (m === null) return null;
	const h = m[1] ?? "";
	return [
		parseInt(h.slice(0, 2), 16),
		parseInt(h.slice(2, 4), 16),
		parseInt(h.slice(4, 6), 16)
	];
}
/** WCAG 2.x relative luminance of a #rrggbb/#rgb color. */
function luminance(hex) {
	const rgb = rgbOf(hex);
	if (rgb === null) return null;
	const [r, g, b] = rgb;
	const linear = (c) => {
		const s = c / 255;
		return s <= .04045 ? s / 12.92 : Math.pow((s + .055) / 1.055, 2.4);
	};
	return .2126 * linear(r) + .7152 * linear(g) + .0722 * linear(b);
}
/** WCAG contrast ratio between two colors (foreground over background). */
function contrastRatio(fg, bg) {
	const l1 = luminance(fg);
	const l2 = luminance(bg);
	if (l1 === null || l2 === null) return null;
	const high = Math.max(l1, l2);
	const low = Math.min(l1, l2);
	return (high + .05) / (low + .05);
}
function anchorDefined(defined) {
	return [...ANCHOR_TOKENS].some((token) => defined.has(token));
}
const ANCHOR_TOKENS = [
	PRIMARY_ACTION_FILL$1,
	PRIMARY_ACTION_HOVER$1,
	PRIMARY_ACTION_DIMMED$1,
	PRIMARY_ACTION_FOREGROUND$1,
	BRAND_PRIMARY,
	BRAND_PRIMARY_INVERT
];
/**
* Audit one skin's stylesheets (in application order) against the
* primary-action token contract. Warning-only: the loader's completion
* rules keep every outcome legible, so this never fails a skin.
*/
function auditTokenContract(stylesheets) {
	const warnings = [];
	if (stylesheets.length === 0) return { warnings };
	const parsed = mergeTokens(stylesheets);
	const { defined, byTheme } = parsed;
	if (!anchorDefined(defined)) return { warnings };
	const fillDefined = defined.has("--dsw-alias-button-primary-fill") || defined.has("--dsw-alias-brand-primary");
	const hoverDefined = defined.has("--dsw-alias-button-primary-hover") || fillDefined;
	const foregroundDefined = defined.has("--dsw-alias-label-primary-foreground") || defined.has("--dsw-alias-brand-primary") && defined.has("--dsw-alias-brand-primary-invert");
	if (!fillDefined) warnings.push("primary action contract: \"button-primary-fill\" is not defined and \"brand-primary\" is not an anchor; buttons render the official shell CTA — define button-primary-fill (with button-primary-hover and label-primary-foreground) to adopt the skin palette");
	if (!hoverDefined) warnings.push("primary action contract: \"button-primary-hover\" is not defined; the loader derives it from the button fill (color-mix toward the surface) — define it explicitly for the exact hover look");
	if (!foregroundDefined) warnings.push("primary action contract: \"label-primary-foreground\" is not defined; the loader keeps the official shell foreground (#fff light / #0f1115 dark) — pair it with the fill, or declare the matched pair brand-primary + brand-primary-invert (legacy convention)");
	for (const theme of ["light", "dark"]) {
		const map = byTheme[theme];
		const fill = map.get("--dsw-alias-button-primary-fill") ?? map.get("--dsw-alias-brand-primary") ?? SHELL_CTA[theme].fill;
		const brandInvert = map.get(BRAND_PRIMARY_INVERT);
		const foreground = map.get("--dsw-alias-label-primary-foreground") ?? (map.get("--dsw-alias-brand-primary") !== void 0 && brandInvert !== void 0 ? brandInvert : SHELL_CTA[theme].foreground);
		const fillResolved = resolveColor(fill, theme, parsed);
		const foregroundResolved = resolveColor(foreground, theme, parsed);
		if (fillResolved === null || foregroundResolved === null) continue;
		const ratio = contrastRatio(foregroundResolved, fillResolved);
		if (ratio !== null && ratio < 3) warnings.push(`primary action contrast: ${foregroundResolved} on ${fillResolved} is ${ratio.toFixed(2)}:1 (${theme} theme) — below the 3:1 UI gate; pick a foreground that pairs with the fill`);
	}
	return { warnings };
}
function mergeTokens(stylesheets) {
	const defined = /* @__PURE__ */ new Set();
	const light = /* @__PURE__ */ new Map();
	const dark = /* @__PURE__ */ new Map();
	for (const sheet of stylesheets) {
		const parsed = parseDefinitions(sheet.css);
		for (const name of parsed.defined) defined.add(name);
		for (const [name, value] of parsed.byTheme.light) light.set(name, value);
		for (const [name, value] of parsed.byTheme.dark) dark.set(name, value);
	}
	return {
		defined,
		byTheme: {
			light,
			dark
		}
	};
}
//#endregion
//#region src/harness-home.ts
/**
* DSH harness-home / profile path resolution. Extracted from the retired
* skin-switch.ts (issue #506): the v2 runtime only needs to KNOW where the
* harness home and the active profile's cordis.patch.yml live — the legacy
* bridge reads/cleans the old managed section once, nothing rewrites it
* afterwards.
*
* Precedence rules are the dsh launcher's own (kept byte-compatible with the
* retired module so the bridge reads the same file the old CLI wrote).
* @module @linxin666/dsh-client-ui-skin-center/harness-home
*/
/** First non-blank string in a list of candidate values. */
function firstNonBlank$1(...values) {
	for (const value of values) if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed !== "") return trimmed;
	}
}
/**
* Derive the harness home + profile from this package's install layout
* (…/<harnessHome>/profiles/<profile>/node_modules/<this package>). Returns
* null outside such a layout (repo checkouts, tests).
*/
function resolveInstallLayout(fromUrl = import.meta.url) {
	const starts = [fileURLToPath(fromUrl)];
	try {
		const real = realpathSync(starts[0]);
		if (real !== starts[0]) starts.push(real);
	} catch {}
	for (const start of starts) {
		let current = dirname(start);
		for (;;) {
			if (basename(current) === "node_modules") {
				const profileDir = dirname(current);
				const profilesDir = dirname(profileDir);
				const profile = basename(profileDir);
				if (basename(profilesDir) === "profiles" && profile !== "" && profile !== "." && profile !== ".." && profile !== "node_modules") return {
					harnessHome: dirname(profilesDir),
					profile
				};
			}
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}
	}
	return null;
}
/**
* Resolve the DSH harness home exactly like the dsh launcher:
* injected home → <home>/.dsh; $DSH_HOME directly; install-layout home;
* homedir()/.dsh.
*/
function resolveHarnessHome(optsHome, env = process.env, installHome) {
	if (optsHome !== void 0) return join(optsHome, ".dsh");
	return firstNonBlank$1(env.DSH_HOME, installHome) ?? join(homedir(), ".dsh");
}
/** The profile name when cwd sits directly under <harnessHome>/profiles/<name>. */
function profileFromCwd(cwd, profilesRoot) {
	const root = resolve(profilesRoot);
	const normalizedCwd = resolve(cwd);
	const canonicalDir = (p) => {
		try {
			return realpathSync(p);
		} catch {
			return resolve(p);
		}
	};
	if (canonicalDir(dirname(normalizedCwd)) === canonicalDir(root)) {
		const name = basename(normalizedCwd);
		try {
			if (name !== "" && statSync(normalizedCwd, { throwIfNoEntry: false })?.isDirectory() === true) return name;
		} catch {}
	}
}
/**
* Resolve the DSH paths under a HOME. Precedence (harness home): injected
* home > $DSH_HOME > install layout > homedir()/.dsh. Precedence (profile):
* injected profile > $DSH_SKIN_PROFILE > $DSH_PROFILE > cwd under
* profiles/<name> > install layout profile > web.
*/
function resolveHarnessPaths(home, profile, fromUrl = import.meta.url) {
	const install = resolveInstallLayout(fromUrl);
	const harnessHome = resolveHarnessHome(home, process.env, install?.harnessHome);
	const profilesRoot = join(harnessHome, "profiles");
	const activeProfile = firstNonBlank$1(profile, process.env.DSH_SKIN_PROFILE, process.env.DSH_PROFILE) ?? profileFromCwd(process.cwd(), profilesRoot) ?? install?.profile ?? "web";
	return {
		patchPath: join(harnessHome, "profiles", activeProfile, "cordis.patch.yml"),
		legacyPatchPath: join(harnessHome, "cordis.patch.yml"),
		profileModulesDir: join(harnessHome, "profiles", activeProfile, "node_modules"),
		profileManifestPath: join(harnessHome, "profiles", activeProfile, "package.json")
	};
}
//#endregion
//#region src/reviewed-hooks.generated.ts
const REVIEWED_SKIN_HOOKS = {
	"blue-fantasy": {
		entry: "hooks.mjs",
		manifestSha256: "b22cc82145e1f90f4257af1411724e34a99513761290980fb5f8d25727809808",
		hooksSha256: "21ac2ad4d4423acf31e3391bfba18ce2d9eec7b192f7a0ba47e8a0c843ff15a5"
	},
	"cyber-night": {
		entry: "hooks.mjs",
		manifestSha256: "38de22962a80602c22910324e7c5fec171342363760972b7421debeb628d8508",
		hooksSha256: "199f37fe6969e3dfae4891708604b6b639f011068c10356f774145512fd3be69"
	},
	"dragon-heir": {
		entry: "hooks.mjs",
		manifestSha256: "e963197ef3d7b0b444c5976b4dd42cb9e30ce79880bfcb4a076da3426ff60056",
		hooksSha256: "ccc644148fd71cc32723891e97ed586b86fe2f86e0f36362133de7d66d08f5bd"
	},
	"furina": {
		entry: "hooks.mjs",
		manifestSha256: "eaac87525cf305e6a7d78b5257705301fa3818e696c3ccbba205bd72a135f108",
		hooksSha256: "713668d3a50da8878337feb4553f953eea781734934610af37a58dea37112ec9"
	},
	"harbor": {
		entry: "hooks.mjs",
		manifestSha256: "a09949fdf5217ac2f6d5d37603df525e56713385ad799cf4c496fbd71cc5861d",
		hooksSha256: "7981a2f98d1ade2815f7e33e2d79672c280334001a00406bb11b5362ce8182bf"
	},
	"maid-atelier": {
		entry: "hooks.mjs",
		manifestSha256: "f36e854f52f24939dfe6318ed6b1ff6fe33d0564e63255a22aaca459af1a84d9",
		hooksSha256: "8a50922c970337ab07b0843e61b9a771f3a57baf54d18a24e906f13dbb39b4ff"
	},
	"matrix": {
		entry: "hooks.mjs",
		manifestSha256: "6bcadb4f3da51a12838e002c8956baac2326bf67d7c1cf1f6108d93f1a7a6485",
		hooksSha256: "2e13e495adabe900df797cdbe930b8cb7fdb2ce721c1ba021e6eb2e74326e551"
	},
	"miku": {
		entry: "hooks.mjs",
		manifestSha256: "9022628fd39e8ee48aef3b311c12f8411b4cc99d62764e84aa65fb4a5a3631ab",
		hooksSha256: "1c4052d328ac6e1ede3115395e8823c4f6acecd3b4508b85615006a88f7cbdd1"
	},
	"minecraft": {
		entry: "hooks.mjs",
		manifestSha256: "08d4a527db2281e84d919b04392b9101e2c4445dd06746fd8514ac8e0dd3d8c3",
		hooksSha256: "deb4abe5e9dc64b075cb6ab1cfbdb153534a6cf837e3558cc0daee7b1bc6eb1a"
	},
	"orca-link": {
		entry: "hooks.mjs",
		manifestSha256: "48b9c76b6f8fc4fad1473d987c0ebd8c10f4734e2eff2091bbb9040c9a5ce089",
		hooksSha256: "0ea2d7e3f7547d9a37884b788042557ec7c59b1416be527660329584c4d65254"
	},
	"trading": {
		entry: "hooks.mjs",
		manifestSha256: "945b5c1f6ef387060a9b7dbb4451a261ecbffedf7949890925cf2b97c6b0c3a8",
		hooksSha256: "76954acbe0925f470fdfc79d60c5402fd11f617342df719382265b70e3f5a36a"
	},
	"war-thunder": {
		entry: "hooks.mjs",
		manifestSha256: "3779eeb27f441deed0be277a5d67342c254305683214bda68fc814565dadab89",
		hooksSha256: "c44435d89e1de3713a2e46da031acc8a1de0cc6502067ba1e1ca2aa3a1d9d88e"
	},
	"whale-mom": {
		entry: "hooks.mjs",
		manifestSha256: "310d99a3f66b8d085830295d2ec5bd979f384d3ea0f785feb01578d5e8e0364f",
		hooksSha256: "be8921f66e7ef6d73a0c12686f9b0134fb1f4d47e38d1dedc09f4a74c1533b83"
	},
	"whale-song": {
		entry: "hooks.mjs",
		manifestSha256: "fa53ef0c536e672fad0448b199f784d22ee7f1a2dd4da6a06c45836800d33331",
		hooksSha256: "beb0f140dab1abb40bda52ad2ae1970feb761e2184e64e1d5810fab7c32dfff3"
	},
	"xp": {
		entry: "hooks.mjs",
		manifestSha256: "8bceb95c45b400b67ceb80a7f063b6c2086c0e9f9907a7b72a592d33017623eb",
		hooksSha256: "823f25fd5f969feb8e51d8ff1577c1cbecbad847b2abac6e5020fc9ef543663f"
	}
};
//#endregion
//#region src/provenance.ts
/**
* Official-market provenance verification (issue #1073).
*
* Skins installed one-click from the DSH Market carry a
* dsh-market.provenance.json written by the market installer at install
* time, pinning every installed file to its sha256 and to the market
* origin. The market's skin content is built from THIS repository (same
* review, same release), so when the on-disk skin.json and hooks entry
* hash-match the provenance, the hooks bytes are exactly the reviewed
* bytes and may run like a built-in skin's.
*
* Fail-closed: invalid provenance and any post-install byte mismatch keep the
* hooks-refused behavior for user-directory skins. A pre-provenance install
* recovers only by matching this release's generated reviewed identity.
* Forging the provenance
* requires write access to $DSH_HOME itself — an attacker with that access
* can already install full plugins, so the file is a provenance record,
* not a capability guard against the local user.
* @module @linxin666/dsh-client-ui-skin-center/provenance
*/
/** Provenance filename written by the market installer (mirrors PROVENANCE_FILENAME in @linxin666/dsh-client-ui-market; no cross-package runtime import). */
const MARKET_PROVENANCE_FILENAME = "dsh-market.provenance.json";
/** Market origin the provenance must pin (mirrors MARKET_ORIGIN in @linxin666/dsh-client-ui-market). */
const MARKET_PROVENANCE_SOURCE = "https://dsh-market.com";
function sha256Hex(abs) {
	try {
		return createHash("sha256").update(readFileSync(abs)).digest("hex");
	} catch {
		return null;
	}
}
/**
* Whether the skin directory at dir carries valid official-market
* provenance for skinId whose declared hooks entry (already validated as a
* safe relative path by the manifest validator) hash-matches the recorded
* bytes — skin.json included, so the facet entry path itself is pinned.
*/
function verifyMarketProvenance(dir, skinId, hooksEntry) {
	let raw;
	try {
		raw = JSON.parse(readFileSync(join(dir, MARKET_PROVENANCE_FILENAME), "utf8"));
	} catch {
		return false;
	}
	if (typeof raw !== "object" || raw === null) return false;
	const prov = raw;
	if (prov.version !== 1) return false;
	if (prov.source !== "https://dsh-market.com") return false;
	if (prov.id !== skinId) return false;
	const files = prov.files;
	if (typeof files !== "object" || files === null) return false;
	const hashes = files;
	for (const rel of ["skin.json", hooksEntry]) {
		const expected = hashes[rel];
		if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) return false;
		const actual = sha256Hex(join(dir, ...rel.split("/")));
		if (actual === null || actual !== expected) return false;
	}
	return true;
}
/**
* Recover a pre-provenance Workshop install only when its executable identity
* is byte-for-byte one of this release's reviewed market skins. This is a
* read-only fallback: no provenance is minted and no user file is replaced.
*/
function verifyReviewedLegacyHooks(dir, skinId, hooksEntry) {
	const reviewed = REVIEWED_SKIN_HOOKS[skinId];
	if (reviewed === void 0 || reviewed.entry !== hooksEntry) return false;
	const manifestHash = sha256Hex(join(dir, "skin.json"));
	const hooksHash = sha256Hex(join(dir, ...hooksEntry.split("/")));
	return manifestHash === reviewed.manifestSha256 && hooksHash === reviewed.hooksSha256;
}
/**
* Deep integrity verification of one skin directory: checks all files declared
* in dsh-market.provenance.json against recorded sha256 hashes, or verifies
* against the reviewed legacy registry when provenance is absent.
*/
function verifySkinIntegrity(dir, skinId, options = {}) {
	if (options.isBuiltin) return {
		id: skinId,
		status: "valid",
		hooksTrusted: true,
		hasProvenance: false,
		mismatches: [],
		missing: [],
		totalFilesChecked: 0
	};
	let raw = null;
	try {
		raw = JSON.parse(readFileSync(join(dir, MARKET_PROVENANCE_FILENAME), "utf8"));
	} catch {
		raw = null;
	}
	if (typeof raw === "object" && raw !== null) {
		const prov = raw;
		if (prov.version === 1 && prov.source === "https://dsh-market.com" && prov.id === skinId && typeof prov.files === "object" && prov.files !== null) {
			const hashes = prov.files;
			const mismatches = [];
			const missing = [];
			let totalFilesChecked = 0;
			for (const [rel, expected] of Object.entries(hashes)) {
				if (typeof expected !== "string") continue;
				totalFilesChecked++;
				const actual = sha256Hex(join(dir, ...rel.split("/")));
				if (actual === null) missing.push(rel);
				else if (actual !== expected) mismatches.push(rel);
			}
			if (missing.length > 0) return {
				id: skinId,
				status: "missing-files",
				hooksTrusted: false,
				hasProvenance: true,
				mismatches,
				missing,
				totalFilesChecked
			};
			if (mismatches.length > 0) return {
				id: skinId,
				status: "tampered",
				hooksTrusted: false,
				hasProvenance: true,
				mismatches,
				missing,
				totalFilesChecked
			};
			return {
				id: skinId,
				status: "valid",
				hooksTrusted: true,
				hasProvenance: true,
				mismatches: [],
				missing: [],
				totalFilesChecked
			};
		}
	}
	const hooksEntry = options.hooksEntry;
	if (hooksEntry) {
		if (verifyReviewedLegacyHooks(dir, skinId, hooksEntry)) return {
			id: skinId,
			status: "valid",
			hooksTrusted: true,
			hasProvenance: false,
			mismatches: [],
			missing: [],
			totalFilesChecked: 2
		};
		return {
			id: skinId,
			status: "missing-provenance",
			hooksTrusted: false,
			hasProvenance: false,
			mismatches: [],
			missing: [],
			totalFilesChecked: 0
		};
	}
	return {
		id: skinId,
		status: "unverified",
		hooksTrusted: false,
		hasProvenance: false,
		mismatches: [],
		missing: [],
		totalFilesChecked: 0
	};
}
const SAFE_REL_RE = /^[A-Za-z0-9._][A-Za-z0-9._\-/]{0,199}$/;
function isSafeRel(rel) {
	if (typeof rel !== "string" || !SAFE_REL_RE.test(rel)) return false;
	if (rel.includes("..") || rel.includes("//") || rel.startsWith("/") || rel.endsWith("/")) return false;
	return true;
}
function collectLocalFiles(dir, base = "") {
	const list = [];
	for (const name of readdirSync(dir)) {
		if (name.startsWith(".") || name === "dsh-market.provenance.json") continue;
		const abs = join(dir, name);
		const rel = base ? `${base}/${name}` : name;
		const st = statSync(abs);
		if (st.isDirectory()) list.push(...collectLocalFiles(abs, rel));
		else if (st.isFile()) list.push(rel);
	}
	return list;
}
/**
* Repairs a corrupted or tampered skin directory by pulling pristine files
* from the local source tree or the official DSH Market and rewriting provenance.
*/
async function repairSkinFromMarket(destDir, skinId, options = {}) {
	if (!skinId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(skinId)) return {
		ok: false,
		id: skinId,
		error: "invalid-id"
	};
	const localDir = options.localSourceDir ?? (existsSync(join(import.meta.dirname, "..", "skins", skinId, "skin.json")) ? join(import.meta.dirname, "..", "skins", skinId) : null);
	if (localDir && existsSync(join(localDir, "skin.json"))) {
		const files = collectLocalFiles(localDir);
		if (files.length > 0) {
			const hashes = {};
			mkdirSync(destDir, { recursive: true });
			for (const rel of files) {
				const src = join(localDir, ...rel.split("/"));
				const target = join(destDir, ...rel.split("/"));
				const guard = rel.split("/").slice(0, -1).join(sep);
				if (guard) mkdirSync(join(destDir, guard), { recursive: true });
				cpSync(src, target, { force: true });
				const h = sha256Hex(target);
				if (h) hashes[rel] = h;
			}
			const provenance = {
				version: 1,
				source: MARKET_PROVENANCE_SOURCE,
				kind: "skin",
				id: skinId,
				installedAt: (/* @__PURE__ */ new Date()).toISOString(),
				files: hashes
			};
			writeFileSync(join(destDir, MARKET_PROVENANCE_FILENAME), JSON.stringify(provenance, null, 2) + "\n");
			return {
				ok: true,
				id: skinId,
				repairedFiles: files.length
			};
		}
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 15e3;
	try {
		const res = await fetchImpl(`${MARKET_PROVENANCE_SOURCE}/manifest/skins.json`, { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) return {
			ok: false,
			id: skinId,
			error: `manifest-fetch-failed: ${res.status}`
		};
		const item = (await res.json())?.items?.find((it) => it.id === skinId);
		if (!item || !Array.isArray(item.files) || item.files.length === 0) return {
			ok: false,
			id: skinId,
			error: "skin-not-found-on-market"
		};
		const tmp = destDir + ".repair-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
		mkdirSync(tmp, { recursive: true });
		const hashes = {};
		try {
			for (const rel of item.files) {
				if (!isSafeRel(rel)) throw new Error(`unsafe manifest path: ${rel}`);
				const fileRes = await fetchImpl(`${MARKET_PROVENANCE_SOURCE}/assets/skins/${encodeURIComponent(skinId)}/${rel.split("/").map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(timeoutMs) });
				if (!fileRes.ok) throw new Error(`failed to download ${rel}: ${fileRes.status}`);
				const buf = Buffer.from(await fileRes.arrayBuffer());
				const target = join(tmp, ...rel.split("/"));
				const guard = rel.split("/").slice(0, -1).join(sep);
				if (guard) mkdirSync(join(tmp, guard), { recursive: true });
				writeFileSync(target, buf);
				hashes[rel] = createHash("sha256").update(buf).digest("hex");
			}
			const provenance = {
				version: 1,
				source: MARKET_PROVENANCE_SOURCE,
				kind: "skin",
				id: skinId,
				installedAt: (/* @__PURE__ */ new Date()).toISOString(),
				files: hashes
			};
			writeFileSync(join(tmp, MARKET_PROVENANCE_FILENAME), JSON.stringify(provenance, null, 2) + "\n");
			if (existsSync(destDir)) rmSync(destDir, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 50
			});
			try {
				renameSync(tmp, destDir);
			} catch {
				const start = Date.now();
				while (Date.now() - start < 50);
				renameSync(tmp, destDir);
			}
			return {
				ok: true,
				id: skinId,
				repairedFiles: item.files.length
			};
		} finally {
			try {
				if (existsSync(tmp)) rmSync(tmp, {
					recursive: true,
					force: true,
					maxRetries: 3,
					retryDelay: 50
				});
			} catch {}
		}
	} catch (err) {
		return {
			ok: false,
			id: skinId,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
//#endregion
//#region src/skin-repo.ts
/**
* Skin repository (issue #506, M2): dual-source discovery of v2 skin asset
* directories.
*
* Sources, in precedence order:
*  1. user:   $DSH_HOME/skins/<id>/   (community / locally dropped skins)
*  2. builtin: <skin-center package>/skins/<id>/  (shipped inside the one
*     npm package; no per-skin packages, no boot graph, no cordis.patch.yml)
*
* A user directory with the same id shadows the built-in one (with a
* catalog warning) — that is how a community skin overrides a bundled one
* without touching node_modules.
*
* Fail-closed: a directory whose skin.json fails validateSkinManifestV2 is
* excluded from the catalog and reported under diagnostics; it never loads.
*
* The catalog is an immutable snapshot: callers keep the object they got and
* an activation never sees the catalog change underneath it (contract
* section 8, "catalog immutable snapshot per activation").
*
* Scans are memoized per (builtinDir, userDir): a snapshot is reused until a
* cheap fingerprint of both roots (skin-dir names plus skin.json stat)
* changes, so client requests never rescan the same sources. The fingerprint
* covers add/remove/change of any skin directory, while writes outside the
* sources (POST /active state) never invalidate it.
* @module @linxin666/dsh-client-ui-skin-center/skin-repo
*/
/** Read the manifest-referenced stylesheets for one skin directory. */
function stylesheetEntries(manifest, dir) {
	const entries = [];
	const rels = [manifest.contributes.stylesheet, manifest.contributes.patches ?? null];
	for (const rel of rels) {
		if (!rel) continue;
		const abs = join(dir, rel);
		if (existsSync(abs)) entries.push({
			filename: rel,
			css: readFileSync(abs, "utf8")
		});
	}
	return entries;
}
/** Built-in skins ship inside the skin-center package under skins/. */
function builtinSkinsDir(fromUrl = import.meta.url) {
	return join(dirname(fileURLToPath(fromUrl)), "..", "skins");
}
/**
* Shipped builtin skin ids: the npm package.json files whitelist entries
* under `skins/` (the "<id>/" directory name). The published package
* contains only these directories, so a builtin catalog directory outside
* the set is a repository catalog source rather than an installed skin —
* the settings catalog lists shipped builtins plus user dirs and leaves
* the rest to the market store.
*/
function shippedSkinIds(fromUrl = import.meta.url) {
	try {
		const pkgPath = join(dirname(fileURLToPath(fromUrl)), "..", "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		const ids = /* @__PURE__ */ new Set();
		for (const f of Array.isArray(pkg.files) ? pkg.files : []) {
			if (typeof f !== "string" || !f.startsWith("skins/")) continue;
			const id = f.slice(6).split("/")[0];
			if (id !== void 0 && id !== "" && id !== ".") ids.add(id);
		}
		return ids;
	} catch {
		return /* @__PURE__ */ new Set();
	}
}
/** User skins live in $DSH_HOME/skins with explicit directory overrides. */
function userSkinsDir(env = process.env) {
	const home = env.DSH_SKINS_HOME;
	if (home && home.trim() !== "") return resolve(home);
	const dir = env.DSH_SKINS_DIR;
	if (dir && dir.trim() !== "") return resolve(dir);
	return join(resolveHarnessHome(void 0, env), "skins");
}
function readManifest(dir) {
	const manifestPath = join(dir, "skin.json");
	if (!existsSync(manifestPath)) return null;
	try {
		return JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		return null;
	}
}
/**
* Hooks trust for one user-directory skin: official-market installs whose
* skin.json and hooks entry hash-match recorded provenance run their hooks.
* Historical Workshop installs from before provenance existed recover only
* when both files match this release's generated reviewed identity. Anything
* else keeps the refusal warning. Built-in skins never reach this — their
* origin is the trust signal.
*/
function marketHooksTrust(manifest, dir) {
	const facet = manifest.facets?.client;
	if (!facet) return {
		trusted: false,
		warning: null
	};
	if (verifyMarketProvenance(dir, manifest.id, facet.entry) || verifyReviewedLegacyHooks(dir, manifest.id, facet.entry)) return {
		trusted: true,
		warning: null
	};
	return {
		trusted: false,
		warning: "declares hooks.mjs, but hooks only run for built-in or byte-verified official-market (same-review) skins; the hooks facet will be refused"
	};
}
/** Re-evaluate the executable trust gate against the current on-disk bytes. */
function canServeSkinHooks(entry) {
	if (entry.manifest.facets?.client === void 0) return false;
	return entry.origin === "builtin" || marketHooksTrust(entry.manifest, entry.dir).trusted;
}
function collectSource(spec, catalog, claimed) {
	if (!existsSync(spec.root)) return;
	let dirNames;
	try {
		dirNames = readdirSync(spec.root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
	} catch {
		return;
	}
	for (const dirName of dirNames) {
		const dir = join(spec.root, dirName);
		const raw = readManifest(dir);
		if (raw === null) {
			catalog.diagnostics.push({
				subject: dirName,
				origin: spec.origin,
				errors: ["skin.json missing or not valid JSON"]
			});
			continue;
		}
		const result = validateSkinManifestV2(raw);
		if (!result.ok || !result.manifest) {
			catalog.diagnostics.push({
				subject: dirName,
				origin: spec.origin,
				errors: result.errors
			});
			continue;
		}
		const manifest = result.manifest;
		if (manifest.id !== dirName) {
			catalog.diagnostics.push({
				subject: dirName,
				origin: spec.origin,
				errors: [`manifest id "${manifest.id}" must equal the directory name "${dirName}"`]
			});
			continue;
		}
		const existing = claimed.get(manifest.id);
		if (existing) {
			if (spec.origin === "user" && existing.origin === "builtin") {
				catalog.skins = catalog.skins.filter((s) => s !== existing);
				const winnerWarnings = [...result.warnings, `shadows the built-in "${manifest.id}" skin`];
				const trust = marketHooksTrust(manifest, dir);
				if (trust.warning !== null) winnerWarnings.push(trust.warning);
				const winner = {
					manifest,
					origin: "user",
					dir,
					warnings: winnerWarnings,
					...trust.trusted ? { hooksTrusted: true } : {}
				};
				claimed.set(manifest.id, winner);
				catalog.skins.push(winner);
			} else existing.warnings.push(`duplicate ${spec.origin} id "${manifest.id}" ignored from ${dir}`);
			continue;
		}
		const warnings = [...result.warnings];
		const trust = spec.origin === "user" ? marketHooksTrust(manifest, dir) : {
			trusted: false,
			warning: null
		};
		if (trust.warning !== null) warnings.push(trust.warning);
		const contractWarnings = auditTokenContract(stylesheetEntries(manifest, dir));
		warnings.push(...contractWarnings.warnings);
		const entry = {
			manifest,
			origin: spec.origin,
			dir,
			warnings,
			...trust.trusted ? { hooksTrusted: true } : {}
		};
		claimed.set(manifest.id, entry);
		catalog.skins.push(entry);
	}
}
/**
* Process-wide cache: (builtinDir, userDir) -> latest snapshot. Shared by
* every loadSkinCatalog caller in the host process (index tap, v2 routes,
* seed). Tests inject their own Map through the catalogCache option.
*/
const DEFAULT_CATALOG_CACHE = /* @__PURE__ */ new Map();
/** Bound the process cache so a long-lived process can never accumulate. */
const CATALOG_CACHE_MAX_ENTRIES = 16;
/**
* Cheap invalidation fingerprint of one catalog root: the sorted skin-dir
* names plus the stat of each skin.json. The catalog content depends only on
* skin.json, so this is the exact change signal — a new or removed skin dir
* changes the name set, an in-place manifest change changes the stat. A
* missing or unreadable root yields the same marker as an empty source,
* mirroring collectSource's silent empty result.
*/
function rootFingerprint(root) {
	let dirNames;
	try {
		dirNames = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
	} catch {
		return "";
	}
	const lines = [];
	for (const dirName of dirNames) {
		const manifestPath = join(root, dirName, "skin.json");
		try {
			const st = statSync(manifestPath);
			lines.push(JSON.stringify([
				dirName,
				st.mtimeMs,
				st.size,
				st.mode
			]));
		} catch {
			lines.push(JSON.stringify([dirName]));
		}
	}
	return lines.join("\n");
}
/**
* Snapshot the skin catalog from both sources. Never throws: unreadable
* roots and invalid skins land in diagnostics instead. When the source
* fingerprint matches the last scan the memoized snapshot is returned as-is
* (capturedAt re-stamped to the observation time); a changed fingerprint
* triggers a fresh scan and updates the cache.
*/
function loadSkinCatalog(options = {}) {
	const builtinDir = options.builtinDir ?? builtinSkinsDir();
	const userDir = options.userDir ?? userSkinsDir();
	const cache = options.catalogCache ?? DEFAULT_CATALOG_CACHE;
	const cacheKey = builtinDir + "\0" + userDir;
	const fingerprint = JSON.stringify([rootFingerprint(builtinDir), rootFingerprint(userDir)]);
	const hit = cache.get(cacheKey);
	if (hit && hit.fingerprint === fingerprint) return {
		...hit.catalog,
		capturedAt: (options.now ?? Date.now)()
	};
	const catalog = {
		skins: [],
		diagnostics: [],
		capturedAt: (options.now ?? Date.now)()
	};
	const claimed = /* @__PURE__ */ new Map();
	collectSource({
		origin: "builtin",
		root: builtinDir
	}, catalog, claimed);
	collectSource({
		origin: "user",
		root: userDir
	}, catalog, claimed);
	catalog.skins.sort((a, b) => (a.manifest.order ?? Number.MAX_SAFE_INTEGER) - (b.manifest.order ?? Number.MAX_SAFE_INTEGER) || a.manifest.id.localeCompare(b.manifest.id));
	cache.set(cacheKey, {
		fingerprint,
		catalog
	});
	if (cache.size > CATALOG_CACHE_MAX_ENTRIES) cache.clear();
	return catalog;
}
/** Find one skin in a snapshot by id. */
function findSkin(catalog, id) {
	return catalog.skins.find((s) => s.manifest.id === id) ?? null;
}
/**
* Resolve a file inside a skin directory, refusing any escape. Returns null
* when the resolved path leaves the skin root.
*/
function resolveInsideSkin(entry, relPath) {
	const abs = resolve(entry.dir, relPath);
	const root = resolve(entry.dir);
	const rootWithSep = root.endsWith(sep) ? root : root + sep;
	if (abs !== root && !abs.startsWith(rootWithSep)) return null;
	return abs;
}
/**
* Uninstall one user-directory skin by removing its directory under userDir.
* Fails closed if the id is invalid, escapes the user directory, or targets a builtin.
*/
function uninstallUserSkin(skinId, options = {}) {
	if (!skinId || typeof skinId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(skinId)) return {
		ok: false,
		error: "invalid-id"
	};
	const userDir = options.userDir ?? userSkinsDir();
	const target = resolve(userDir, skinId);
	const userRoot = resolve(userDir);
	const userRootWithSep = userRoot.endsWith(sep) ? userRoot : userRoot + sep;
	if (!target.startsWith(userRootWithSep)) return {
		ok: false,
		error: "invalid-id"
	};
	if (!existsSync(target)) return {
		ok: false,
		error: "skin-not-found"
	};
	try {
		rmSync(target, {
			recursive: true,
			force: true,
			maxRetries: 3,
			retryDelay: 50
		});
	} catch (error) {
		return {
			ok: false,
			error: "write-error",
			detail: error instanceof Error ? error.message : String(error)
		};
	}
	(options.catalogCache ?? DEFAULT_CATALOG_CACHE).clear();
	return { ok: true };
}
/**
* Verify integrity of all skins in the catalog.
*/
function verifyAllSkinsIntegrity(catalog) {
	const details = [];
	let validCount = 0;
	let issuesCount = 0;
	for (const entry of catalog.skins) {
		const isBuiltin = entry.origin === "builtin";
		const hooksEntry = entry.manifest.facets?.client?.entry ?? null;
		const report = verifySkinIntegrity(entry.dir, entry.manifest.id, {
			isBuiltin,
			hooksEntry
		});
		details.push(report);
		if (report.status === "valid") validCount++;
		else issuesCount++;
	}
	return {
		total: details.length,
		valid: validCount,
		issues: issuesCount,
		details
	};
}
/**
* Repairs a specific user skin by id.
*/
async function repairSkin(skinId, options = {}) {
	const res = await repairSkinFromMarket(join(options.userDir ?? userSkinsDir(), skinId), skinId, {
		fetchImpl: options.fetchImpl,
		timeoutMs: options.timeoutMs,
		localSourceDir: options.localSourceDir
	});
	if (res.ok) (options.catalogCache ?? DEFAULT_CATALOG_CACHE).clear();
	return res;
}
/**
* Verifies all skins in catalog, and automatically repairs any skin with integrity issues.
*/
async function verifyAndRepairAllSkins(catalogGetter, options = {}) {
	const initialCatalog = catalogGetter();
	const initialSummary = verifyAllSkinsIntegrity(initialCatalog);
	if (options.autoRepair === false || initialSummary.issues === 0) return {
		...initialSummary,
		repaired: [],
		repairFailed: []
	};
	const repaired = [];
	const repairFailed = [];
	for (const report of initialSummary.details) if (report.status !== "valid") {
		const skinEntry = findSkin(initialCatalog, report.id);
		if (skinEntry && skinEntry.origin === "user") {
			const res = await repairSkin(report.id, options);
			if (res.ok) repaired.push(report.id);
			else repairFailed.push({
				id: report.id,
				error: res.error ?? "unknown-error"
			});
		}
	}
	return {
		...verifyAllSkinsIntegrity(catalogGetter()),
		repaired,
		repairFailed
	};
}
//#endregion
//#region src/active-state.ts
/**
* Active-skin selection persistence (issue #506): a tiny JSON document under
* $DSH_HOME written by POST /api/skin-center/v2/active and read on every
* index.html response by the tapIndex adapter. Since issue #996 the same
* document also carries the skin-background preference set, so paired remote
* desktops (where the settings scope is loopback-only) read and persist
* background values through the v2 channel. Kept dependency-free and
* synchronous: the tap runs per response and must never await.
* @module @linxin666/dsh-client-ui-skin-center/active-state
*/
/**
* The single skin shipped with the package (the market on-demand plan): the
* default look for a fresh install. Every other skin is a market download
* into the user skins directory; nothing else is bundled.
*/
const DEFAULT_SKIN_ID = "blue-fantasy";
/** Default location: $DSH_HOME/skin-center-active.json. */
function defaultActiveStatePath() {
	return join(userSkinsDir(), "..", "skin-center-active.json");
}
/** Read the whole state document; unreadable data yields all-null fields and initialized=false. */
function readActiveState(path) {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		const hasInitialized = typeof parsed.initialized === "boolean" ? parsed.initialized : typeof parsed === "object" && parsed !== null && ("active" in parsed || "background" in parsed);
		return {
			active: typeof parsed.active === "string" ? parsed.active : null,
			background: parsed.background === void 0 || parsed.background === null ? null : normalizeSkinBackground(parsed.background),
			initialized: hasInitialized
		};
	} catch {
		return {
			active: null,
			background: null,
			initialized: false
		};
	}
}
/** Read the persisted active skin id (null = stock look / unreadable). */
function readActiveSelection(path) {
	return readActiveState(path).active;
}
/**
* Persist an update with merge semantics: keys absent from `update` keep
* their stored value, so a skin switch never wipes the background section
* and a background write never wipes the selection. The background key is
* omitted from the document while it is null, keeping legacy files clean.
*/
function writeActiveState(path, update) {
	const current = readActiveState(path);
	const active = update.active === void 0 ? current.active : update.active;
	const background = update.background === void 0 ? current.background : update.background;
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true });
	const tmpDir = mkdtempSync(join(dir, `${basename(path)}.tmp-`));
	const tmp = join(tmpDir, basename(path));
	const document = {
		active,
		initialized: true
	};
	if (background !== null) document.background = background;
	try {
		writeFileSync(tmp, JSON.stringify(document, null, 2) + "\n", {
			encoding: "utf8",
			flag: "wx"
		});
		renameSync(tmp, path);
	} finally {
		rmSync(tmpDir, {
			recursive: true,
			force: true
		});
	}
}
/** Persist the active skin id (creates the parent directory). */
function writeActiveSelection(path, id) {
	writeActiveState(path, { active: id });
}
/**
* Seed the active selection on a first boot (no persisted selection): the
* shipped default skin becomes the active look. Never overwrites an existing
* selection — in particular an upgrade keeps (and later resolves) whatever
* the user had picked, and a selection that vanished from the catalog falls
* back to the stock look on the browser side.
* @param path - active-state file path.
* @param find - whether the default id exists in the current catalog.
* @returns whether the seed wrote the selection.
*/
function seedDefaultActiveSkin(path, find) {
	const state = readActiveState(path);
	if (state.initialized || state.active !== null) return false;
	if (!find("blue-fantasy")) return false;
	writeActiveSelection(path, DEFAULT_SKIN_ID);
	return true;
}
//#endregion
//#region src/core/css-safety/official-tokens.generated.ts
/**
* GENERATED by scripts/official-tokens-snapshot.mjs — do not edit.
* Official shell custom-property surface (--dsw-*, static palette excluded).
*/
const OFFICIAL_TOKENS = [
	"--dsw-alias-bg-base",
	"--dsw-alias-bg-layer-1",
	"--dsw-alias-bg-layer-2",
	"--dsw-alias-bg-layer-3",
	"--dsw-alias-bg-mask-1",
	"--dsw-alias-bg-mask-2",
	"--dsw-alias-bg-mask-3",
	"--dsw-alias-bg-mask-drop",
	"--dsw-alias-bg-mask-photo",
	"--dsw-alias-bg-module-platform",
	"--dsw-alias-bg-multi-select",
	"--dsw-alias-bg-overlay",
	"--dsw-alias-bg-skeleton",
	"--dsw-alias-border-inverted",
	"--dsw-alias-border-inverted2",
	"--dsw-alias-border-l1",
	"--dsw-alias-border-l2",
	"--dsw-alias-border-l2-darkmode-thin",
	"--dsw-alias-border-l3",
	"--dsw-alias-border-l4",
	"--dsw-alias-brand-primary",
	"--dsw-alias-brand-primary-invert",
	"--dsw-alias-brand-primary-new-colorprimary-new-color",
	"--dsw-alias-brand-text",
	"--dsw-alias-button-contrast-fill",
	"--dsw-alias-button-elevated-fill",
	"--dsw-alias-button-floating-fill",
	"--dsw-alias-button-floating-hover",
	"--dsw-alias-button-ghost-active-border",
	"--dsw-alias-button-ghost-active-fill",
	"--dsw-alias-button-ghost-active-hover",
	"--dsw-alias-button-info-fill",
	"--dsw-alias-button-info-hover",
	"--dsw-alias-button-primary-dimmed",
	"--dsw-alias-button-primary-fill",
	"--dsw-alias-button-primary-hover",
	"--dsw-alias-button-tool-bar-fill",
	"--dsw-alias-button-tool-bar-fill-invisible",
	"--dsw-alias-button-tool-bar-hover",
	"--dsw-alias-interactive-bg-active",
	"--dsw-alias-interactive-bg-hover",
	"--dsw-alias-interactive-bg-hover-accent",
	"--dsw-alias-interactive-bg-hover-danger",
	"--dsw-alias-interactive-bg-hover-solid",
	"--dsw-alias-label-caption",
	"--dsw-alias-label-dimmed",
	"--dsw-alias-label-primary",
	"--dsw-alias-label-primary-bluish",
	"--dsw-alias-label-primary-dimmed",
	"--dsw-alias-label-primary-foreground",
	"--dsw-alias-label-primary-inverted",
	"--dsw-alias-label-secondary",
	"--dsw-alias-label-tertiary",
	"--dsw-alias-markdown-citation",
	"--dsw-alias-markdown-code-block",
	"--dsw-alias-markdown-code-block-banner",
	"--dsw-alias-markdown-code-segment-selected",
	"--dsw-alias-markdown-code-segment-unselected",
	"--dsw-alias-markdown-inline-code",
	"--dsw-alias-markdown-placeholder",
	"--dsw-alias-markdown-tag",
	"--dsw-alias-scrollbar-bg-l1",
	"--dsw-alias-scrollbar-bg-l2",
	"--dsw-alias-scrollbar-hover-l1",
	"--dsw-alias-scrollbar-hover-l2",
	"--dsw-alias-state-business-primary",
	"--dsw-alias-state-business-tertiary",
	"--dsw-alias-state-error-primary",
	"--dsw-alias-state-error-secondary",
	"--dsw-alias-state-success-primary",
	"--dsw-alias-state-success-secondary",
	"--dsw-alias-state-success-tertiary",
	"--dsw-alias-state-warn-label",
	"--dsw-alias-state-warn-primary",
	"--dsw-alias-state-warn-secondary",
	"--dsw-alias-state-warn-tertiary",
	"--dsw-alias-toast-bg",
	"--dsw-alias-tooltip-bg",
	"--dsw-font-base-16",
	"--dsw-font-base-16-font-family",
	"--dsw-font-base-16-font-size",
	"--dsw-font-base-16-font-style",
	"--dsw-font-base-16-font-weight",
	"--dsw-font-base-16-line-height",
	"--dsw-font-base-strong-16",
	"--dsw-font-base-strong-16-font-family",
	"--dsw-font-base-strong-16-font-size",
	"--dsw-font-base-strong-16-font-style",
	"--dsw-font-base-strong-16-font-weight",
	"--dsw-font-base-strong-16-line-height",
	"--dsw-font-family",
	"--dsw-font-l-20",
	"--dsw-font-l-20-font-family",
	"--dsw-font-l-20-font-size",
	"--dsw-font-l-20-font-style",
	"--dsw-font-l-20-font-weight",
	"--dsw-font-l-20-line-height",
	"--dsw-font-m-18",
	"--dsw-font-m-18-font-family",
	"--dsw-font-m-18-font-size",
	"--dsw-font-m-18-font-style",
	"--dsw-font-m-18-font-weight",
	"--dsw-font-m-18-line-height",
	"--dsw-font-markdown-base",
	"--dsw-font-markdown-base-font-family",
	"--dsw-font-markdown-base-font-size",
	"--dsw-font-markdown-base-font-style",
	"--dsw-font-markdown-base-font-weight",
	"--dsw-font-markdown-base-italic",
	"--dsw-font-markdown-base-italic-font-family",
	"--dsw-font-markdown-base-italic-font-size",
	"--dsw-font-markdown-base-italic-font-style",
	"--dsw-font-markdown-base-italic-font-weight",
	"--dsw-font-markdown-base-italic-line-height",
	"--dsw-font-markdown-base-line-height",
	"--dsw-font-markdown-base-strong",
	"--dsw-font-markdown-base-strong-font-family",
	"--dsw-font-markdown-base-strong-font-size",
	"--dsw-font-markdown-base-strong-font-style",
	"--dsw-font-markdown-base-strong-font-weight",
	"--dsw-font-markdown-base-strong-italic",
	"--dsw-font-markdown-base-strong-italic-font-family",
	"--dsw-font-markdown-base-strong-italic-font-size",
	"--dsw-font-markdown-base-strong-italic-font-style",
	"--dsw-font-markdown-base-strong-italic-font-weight",
	"--dsw-font-markdown-base-strong-italic-line-height",
	"--dsw-font-markdown-base-strong-line-height",
	"--dsw-font-markdown-code",
	"--dsw-font-markdown-code-block",
	"--dsw-font-markdown-code-block-font-family",
	"--dsw-font-markdown-code-block-font-size",
	"--dsw-font-markdown-code-block-font-style",
	"--dsw-font-markdown-code-block-font-weight",
	"--dsw-font-markdown-code-block-line-height",
	"--dsw-font-markdown-code-block-small",
	"--dsw-font-markdown-code-block-small-font-family",
	"--dsw-font-markdown-code-block-small-font-size",
	"--dsw-font-markdown-code-block-small-font-style",
	"--dsw-font-markdown-code-block-small-font-weight",
	"--dsw-font-markdown-code-block-small-line-height",
	"--dsw-font-markdown-code-font-family",
	"--dsw-font-markdown-code-font-size",
	"--dsw-font-markdown-code-font-style",
	"--dsw-font-markdown-code-font-weight",
	"--dsw-font-markdown-code-line-height",
	"--dsw-font-markdown-h1",
	"--dsw-font-markdown-h1-font-family",
	"--dsw-font-markdown-h1-font-size",
	"--dsw-font-markdown-h1-font-style",
	"--dsw-font-markdown-h1-font-weight",
	"--dsw-font-markdown-h1-line-height",
	"--dsw-font-markdown-h2",
	"--dsw-font-markdown-h2-font-family",
	"--dsw-font-markdown-h2-font-size",
	"--dsw-font-markdown-h2-font-style",
	"--dsw-font-markdown-h2-font-weight",
	"--dsw-font-markdown-h2-line-height",
	"--dsw-font-markdown-h3",
	"--dsw-font-markdown-h3-font-family",
	"--dsw-font-markdown-h3-font-size",
	"--dsw-font-markdown-h3-font-style",
	"--dsw-font-markdown-h3-font-weight",
	"--dsw-font-markdown-h3-line-height",
	"--dsw-font-markdown-h4",
	"--dsw-font-markdown-h4-font-family",
	"--dsw-font-markdown-h4-font-size",
	"--dsw-font-markdown-h4-font-style",
	"--dsw-font-markdown-h4-font-weight",
	"--dsw-font-markdown-h4-line-height",
	"--dsw-font-markdown-small",
	"--dsw-font-markdown-small-font-family",
	"--dsw-font-markdown-small-font-size",
	"--dsw-font-markdown-small-font-style",
	"--dsw-font-markdown-small-font-weight",
	"--dsw-font-markdown-small-italic",
	"--dsw-font-markdown-small-italic-font-family",
	"--dsw-font-markdown-small-italic-font-size",
	"--dsw-font-markdown-small-italic-font-style",
	"--dsw-font-markdown-small-italic-font-weight",
	"--dsw-font-markdown-small-italic-line-height",
	"--dsw-font-markdown-small-line-height",
	"--dsw-font-markdown-small-strong",
	"--dsw-font-markdown-small-strong-font-family",
	"--dsw-font-markdown-small-strong-font-size",
	"--dsw-font-markdown-small-strong-font-style",
	"--dsw-font-markdown-small-strong-font-weight",
	"--dsw-font-markdown-small-strong-italic",
	"--dsw-font-markdown-small-strong-italic-font-family",
	"--dsw-font-markdown-small-strong-italic-font-size",
	"--dsw-font-markdown-small-strong-italic-font-style",
	"--dsw-font-markdown-small-strong-italic-font-weight",
	"--dsw-font-markdown-small-strong-italic-line-height",
	"--dsw-font-markdown-small-strong-line-height",
	"--dsw-font-markdown-table",
	"--dsw-font-markdown-table-font-family",
	"--dsw-font-markdown-table-font-size",
	"--dsw-font-markdown-table-font-style",
	"--dsw-font-markdown-table-font-weight",
	"--dsw-font-markdown-table-head",
	"--dsw-font-markdown-table-head-font-family",
	"--dsw-font-markdown-table-head-font-size",
	"--dsw-font-markdown-table-head-font-style",
	"--dsw-font-markdown-table-head-font-weight",
	"--dsw-font-markdown-table-head-line-height",
	"--dsw-font-markdown-table-line-height",
	"--dsw-font-s-14",
	"--dsw-font-s-14-font-family",
	"--dsw-font-s-14-font-size",
	"--dsw-font-s-14-font-style",
	"--dsw-font-s-14-font-weight",
	"--dsw-font-s-14-line-height",
	"--dsw-font-s-strong-14",
	"--dsw-font-s-strong-14-font-family",
	"--dsw-font-s-strong-14-font-size",
	"--dsw-font-s-strong-14-font-style",
	"--dsw-font-s-strong-14-font-weight",
	"--dsw-font-s-strong-14-line-height",
	"--dsw-font-xl-24",
	"--dsw-font-xl-24-font-family",
	"--dsw-font-xl-24-font-size",
	"--dsw-font-xl-24-font-style",
	"--dsw-font-xl-24-font-weight",
	"--dsw-font-xl-24-line-height",
	"--dsw-font-xs-13",
	"--dsw-font-xs-13-font-family",
	"--dsw-font-xs-13-font-size",
	"--dsw-font-xs-13-font-style",
	"--dsw-font-xs-13-font-weight",
	"--dsw-font-xs-13-line-height",
	"--dsw-font-xs-strong-13",
	"--dsw-font-xs-strong-13-font-family",
	"--dsw-font-xs-strong-13-font-size",
	"--dsw-font-xs-strong-13-font-style",
	"--dsw-font-xs-strong-13-font-weight",
	"--dsw-font-xs-strong-13-line-height",
	"--dsw-font-xxs-12",
	"--dsw-font-xxs-12-font-family",
	"--dsw-font-xxs-12-font-size",
	"--dsw-font-xxs-12-font-style",
	"--dsw-font-xxs-12-font-weight",
	"--dsw-font-xxs-12-line-height",
	"--dsw-font-xxs-strong-12",
	"--dsw-font-xxs-strong-12-font-family",
	"--dsw-font-xxs-strong-12-font-size",
	"--dsw-font-xxs-strong-12-font-style",
	"--dsw-font-xxs-strong-12-font-weight",
	"--dsw-font-xxs-strong-12-line-height",
	"--dsw-font-xxxs-11",
	"--dsw-font-xxxs-11-font-family",
	"--dsw-font-xxxs-11-font-size",
	"--dsw-font-xxxs-11-font-style",
	"--dsw-font-xxxs-11-font-weight",
	"--dsw-font-xxxs-11-line-height",
	"--dsw-font-xxxs-strong-11",
	"--dsw-font-xxxs-strong-11-font-family",
	"--dsw-font-xxxs-strong-11-font-size",
	"--dsw-font-xxxs-strong-11-font-style",
	"--dsw-font-xxxs-strong-11-font-weight",
	"--dsw-font-xxxs-strong-11-line-height",
	"--dsw-hovercard-bg",
	"--dsw-linear-gradient-think",
	"--dsw-linear-think-select",
	"--dsw-mask-blur",
	"--dsw-shadow-lv1",
	"--dsw-shadow-lv1-blur",
	"--dsw-shadow-lv2",
	"--dsw-shadow-lv3",
	"--dsw-specific-bubble",
	"--dsw-specific-bubble-highlight",
	"--dsw-specific-input-major",
	"--dsw-specific-login-input",
	"--dsw-specific-menu",
	"--dsw-specific-selector",
	"--dsw-specific-sidebar-fill",
	"--dsw-specific-sidebar-nav-item-active",
	"--dsw-specific-sidebar-nav-item-active-accent",
	"--dsw-specific-sidebar-nav-item-hover",
	"--dsw-specific-tip"
];
//#endregion
//#region src/core/css-safety/fallback.ts
/**
* Automatic token fallbacks (issue #506 follow-up): for every official
* --dsw-* token a skin does NOT remap, derive a translucent tint of the
* skin's own palette — the skin's main color, "blurred" over whatever sits
* behind the surface. The official shell keeps adding surfaces (e.g. the
* composer's --dsw-specific-input-major); without this, an uncovered
* surface snaps back to the official default gray-blue and breaks the
* skin's palette. The fallback keeps skins future-proof across official
* upgrades: any new token simply inherits the skin's tint instead of the
* stock look.
*
* Rules (fail-closed, conservative):
*  - never touch the static palette (not in the registry at all);
*  - never override a token the skin defines;
*  - never derive when the skin defines no anchor for the group;
*  - semantic / structural groups (buttons, states, masks, shadows,
*    inverted/foreground labels, fonts, easing) are skipped: a tint there
*    would break contrast or layout instead of filling a gap.
*
* The derivation is textual (color-mix with a var() reference), so it
* resolves against the skin's own remap — including the dark-theme block —
* and stays theme-aware with zero runtime logic.
*/
/** Matched in order; the first group whose pattern hits wins. */
const GROUPS = [
	{
		skip: /(^|-)(mask|shadow|button|state|brand|scrollbar|foreground|inverted|dimmed)(-|$)|-font-|linear-|ease|duration|transition/,
		anchors: [],
		alpha: 0
	},
	{
		skip: /-bg-/,
		anchors: ["--dsw-alias-bg-layer-1", "--dsw-alias-bg-base"],
		alpha: 65
	},
	{
		skip: /-label-/,
		anchors: ["--dsw-alias-label-primary"],
		alpha: 70
	},
	{
		skip: /-border-/,
		anchors: ["--dsw-alias-border-l2", "--dsw-alias-border-l1"],
		alpha: 55
	},
	{
		skip: /-interactive-/,
		anchors: ["--dsw-alias-bg-layer-1"],
		alpha: 50
	},
	{
		skip: /-specific-/,
		anchors: ["--dsw-alias-bg-layer-1", "--dsw-alias-bg-base"],
		alpha: 60
	}
];
const EXCLUDED = /(^|-)(mask|shadow|button|state|brand|scrollbar|foreground|inverted|dimmed)(-|$)|-font-|linear-|ease|duration|transition/;
function groupFor(token) {
	if (EXCLUDED.test(token)) return null;
	for (const group of GROUPS) if (group.skip.test(token)) return group;
	return null;
}
/**
* Build fallback declarations for the official tokens the skin does not
* define. Returns declaration strings ("--x: color-mix(...);" per token).
*/
function deriveFallbackTokens(defined) {
	const out = [];
	for (const token of OFFICIAL_TOKENS) {
		if (defined.has(token)) continue;
		const group = groupFor(token);
		if (group === null) continue;
		const anchor = group.anchors.find((candidate) => defined.has(candidate));
		if (anchor === void 0) continue;
		out.push(`${token}: color-mix(in srgb, var(${anchor}) ${group.alpha}%, transparent);`);
	}
	return out;
}
/**
* Primary-action completion (issue #506 follow-up): filled primary buttons
* render from one matched set — button-primary-fill, button-primary-hover,
* label-primary-foreground. The official theme itself wires
* button-primary-fill to brand-primary, so a skin that remaps the brand
* already colors the fill; hover and foreground do NOT follow the brand and
* would snap to the shell's static values. To keep a partially-declared or
* legacy (brand-primary + brand-primary-invert) skin coherent, the loader
* completes the set here:
*
*  - fill: derive from brand-primary when the skin declares its brand but
*    no explicit fill (the shell chain does this anyway; the derivation
*    makes the intent explicit and keeps the textual derivation table
*    self-contained);
*  - hover / dimmed: blend the fill toward the surface (color-mix) — a
*    direction-agnostic press/disabled tint that works in both themes;
*  - foreground: inherit the skin's own brand-primary-invert ONLY when the
*    skin declares both brand tokens (the legacy matched convention); the
*    shell foreground stands in otherwise.
*
* Never overrides a token the skin defines, and never derives without an
* anchor: a skin with no brand and no button tokens keeps the official
* shell's own matched CTA.
*/
/** The primary-action token family (see ./token-audit.ts for the audit). */
const PRIMARY_ACTION_FILL = "--dsw-alias-button-primary-fill";
const PRIMARY_ACTION_HOVER = "--dsw-alias-button-primary-hover";
const PRIMARY_ACTION_DIMMED = "--dsw-alias-button-primary-dimmed";
const PRIMARY_ACTION_FOREGROUND = "--dsw-alias-label-primary-foreground";
const PRIMARY_ACTION_BRAND = "--dsw-alias-brand-primary";
const PRIMARY_ACTION_BRAND_INVERT = "--dsw-alias-brand-primary-invert";
/** Derive the primary-action tokens the skin did not define. */
function derivePrimaryActionFallbacks(defined) {
	const out = [];
	const hasBrand = defined.has(PRIMARY_ACTION_BRAND);
	const branded = hasBrand || defined.has("--dsw-alias-button-primary-fill");
	if (!hasBrand && !defined.has("--dsw-alias-button-primary-fill")) return out;
	if (!defined.has("--dsw-alias-button-primary-fill") && hasBrand) out.push(`${PRIMARY_ACTION_FILL}: var(${PRIMARY_ACTION_BRAND});`);
	if (branded && !defined.has("--dsw-alias-button-primary-hover")) out.push(`${PRIMARY_ACTION_HOVER}: color-mix(in srgb, var(${PRIMARY_ACTION_FILL}) 82%, var(--dsw-alias-bg-layer-1));`);
	if (branded && !defined.has("--dsw-alias-button-primary-dimmed")) out.push(`${PRIMARY_ACTION_DIMMED}: color-mix(in srgb, var(${PRIMARY_ACTION_FILL}) 60%, var(--dsw-alias-bg-layer-1));`);
	if (!defined.has("--dsw-alias-label-primary-foreground") && hasBrand && defined.has("--dsw-alias-brand-primary-invert")) out.push(`${PRIMARY_ACTION_FOREGROUND}: var(${PRIMARY_ACTION_BRAND_INVERT});`);
	return out;
}
//#endregion
//#region src/core/css-safety/transform.ts
/**
* Skin CSS safety pipeline (issue #506, contract section "校验纪律").
*
* Every skin stylesheet passes through this transform before it is served or
* injected — built-in or community, skin.css or patches.css. It is the
* technical enforcement of the coupling boundary:
*
*  - SCOPING: every selector is force-scoped under
*    `html[data-dsh-skin="<id>"]`. Root-ish heads are rewritten, not nested:
*    `:root` / `html` merge into the scope; `body` and bare official
*    `[data-ds-*]` heads (the official dark-theme attribute lives on BODY)
*    become descendants of the scope; everything else becomes a descendant.
*  - ROOT THEME TOKENS: per-theme `--dsw-alias-*` and
*    `--dsw-specific-*` declarations from bare `:root` / `html` are reset
*    on the scope and cloned to body. Root-level shell variables therefore
*    cannot capture a light token while its dark variant belongs on body (#646).
*  - WHITELIST (fail-closed): no `@import`, no remote or protocol-relative
*    URLs, no absolute paths escaping the skin directory; only relative
*    in-directory assets (and `data:`, which warns — prefer assets/ files).
*  - WARNINGS: reliance on CSS-Modules hash class names (`[class*=...]`)
*    warns; generic @keyframes names warn.
*
* Two-pass design (do NOT collapse): selector scoping is a text-level
* surgery guided by lightningcss rule locations, and lightningcss itself is
* only used to PARSE/validate (read-only visitors). Returning mutated rules
* from a lightningcss 1.32/1.33 style visitor crashes declaration
* deserialization on any var() declaration ("failed to deserialize; expected
* an object-like struct named Specifier") — an upstream serialization defect
* the text-level pass sidesteps entirely. A side benefit: the output keeps
* the author's formatting and values byte-for-byte outside selector heads.
*
* NOTE: this module runs host-side (node) in the M2 loader. lightningcss is
* a native dependency and must stay OUT of the browser bundle (external in
* tsdown.config.ts).
* @module @linxin666/dsh-client-ui-skin-center/css-safety
*/
/** Violation of the CSS whitelist. Always fatal (fail-closed). */
var SkinCssSafetyError = class extends Error {
	name = "SkinCssSafetyError";
	violations;
	constructor(message, violations) {
		super(message);
		this.violations = violations;
	}
};
/** Convert a lightningcss Location2 (0-based line, 1-based column) to a char offset. */
function locToOffset(source, line, column) {
	let offset = 0;
	let currentLine = 0;
	while (currentLine < line) {
		const next = source.indexOf("\n", offset);
		if (next === -1) return source.length;
		offset = next + 1;
		currentLine += 1;
	}
	return offset + column - 1;
}
/**
* Find the opening '{' of a rule whose selector starts at `start`,
* tracking parens/brackets/strings so :is(...), [title="{"] etc. cannot
* fake an early brace.
*/
function findOpenBrace(source, start) {
	let parens = 0;
	let brackets = 0;
	let quote = null;
	for (let i = start; i < source.length; i += 1) {
		const ch = source[i];
		if (quote !== null) {
			if (ch === "\\") i += 1;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === "\"" || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === "(") parens += 1;
		else if (ch === ")") parens -= 1;
		else if (ch === "[") brackets += 1;
		else if (ch === "]") brackets -= 1;
		else if (ch === "{" && parens === 0 && brackets === 0) return i;
		else if (ch === ";" && parens === 0 && brackets === 0) return -1;
	}
	return -1;
}
/** Split a selector list on top-level commas (paren/bracket/string aware). */
function splitSelectors(selectorText) {
	const parts = [];
	let parens = 0;
	let brackets = 0;
	let quote = null;
	let current = "";
	for (let i = 0; i < selectorText.length; i += 1) {
		const ch = selectorText[i];
		if (quote !== null) {
			current += ch;
			if (ch === "\\") {
				current += selectorText[i + 1] ?? "";
				i += 1;
			} else if (ch === quote) quote = null;
			continue;
		}
		if (ch === "\"" || ch === "'") {
			quote = ch;
			current += ch;
			continue;
		}
		if (ch === "(") parens += 1;
		else if (ch === ")") parens -= 1;
		else if (ch === "[") brackets += 1;
		else if (ch === "]") brackets -= 1;
		if (ch === "," && parens === 0 && brackets === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	parts.push(current);
	return parts;
}
const HEAD_DATA_DS = /^\[data-ds-[a-z0-9-]+/;
/**
* Scope one selector under html[data-dsh-skin="<id>"]. Text-level and
* conservative: only the well-defined root-ish heads get rewritten; any
* other selector simply becomes a descendant of the scope.
*/
function scopeSelectorText(selector, skinId) {
	const scope = `html[data-dsh-skin="${skinId}"]`;
	const trimmed = selector.trim();
	const leading = selector.slice(0, selector.length - selector.trimStart().length);
	const trailing = selector.slice(leading.length + trimmed.length);
	if (trimmed === ":root" || trimmed.startsWith(":root ") || trimmed.startsWith(":root,")) return leading + scope + trimmed.slice(5) + trailing;
	if (/^html\[data-ds-/.test(trimmed)) return `${leading}${scope} body${trimmed.slice(4)}${trailing}`;
	if (trimmed === "html" || trimmed.startsWith("html ")) return leading + scope + trimmed.slice(4) + trailing;
	if (trimmed === "body" || trimmed.startsWith("body ") || trimmed.startsWith("body[") || trimmed.startsWith("body:")) return `${leading}${scope} ${trimmed}${trailing}`;
	if (HEAD_DATA_DS.test(trimmed)) return `${leading}${scope} body${trimmed}${trailing}`;
	return `${leading}${scope} ${trimmed}${trailing}`;
}
/** Scope every selector in one selector-list text, preserving separators. */
function scopeSelectorList(selectorText, skinId) {
	return splitSelectors(selectorText).map((sel) => scopeSelectorText(sel, skinId)).join(",");
}
const ROOT_BODY_TOKEN = /^(?:--dsw-alias-|--dsw-specific-)/;
/** A bare root selector owns custom properties evaluated on html itself. */
function hasBareRootSelector(selectorText) {
	return splitSelectors(selectorText).some((selector) => {
		const trimmed = selector.trim();
		return trimmed === ":root" || trimmed === "html";
	});
}
function withoutCssComments(value) {
	return value.replace(/\/\*[\s\S]*?\*\//g, "");
}
/** Per-theme root declarations that must instead take effect from body. */
function rootBodyTokens(block) {
	const tokens = /* @__PURE__ */ new Map();
	const declarations = withoutCssComments(block);
	for (const match of declarations.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:\s*([^;}]*)/gm)) {
		const name = match[1];
		if (name !== void 0 && ROOT_BODY_TOKEN.test(name)) tokens.set(name, /!\s*important\s*$/i.test(match[2] ?? ""));
	}
	return [...tokens].map(([name, important]) => ({
		name,
		important
	}));
}
/** Normalize cloned root tokens so dark body declarations can override them. */
function bodyCloneProperty(line) {
	const custom = line.match(/^(--[\w-]+)\s*:/);
	if (custom !== null) {
		const name = custom[1] ?? "";
		return ROOT_BODY_TOKEN.test(name) ? line.replace(/\s*!important(?=\s*;?\s*$)/i, "") : line;
	}
	return /^background-(color|image)\s*:/.test(line) ? line : null;
}
/** Check one url() target against the whitelist. */
function checkUrl(raw, context, violations, warnings) {
	const url = raw.trim().replace(/^["']|["']$/g, "");
	if (/^https?:\/\//i.test(url)) violations.push(`${context}: remote URL "${url}" is not allowed; ship the asset in the skin directory`);
	else if (url.startsWith("//")) violations.push(`${context}: protocol-relative URL "${url}" is not allowed`);
	else if (url.startsWith("/")) violations.push(`${context}: absolute path "${url}" escapes the skin directory`);
	else if (/^(?:\.\.\/)/.test(url)) violations.push(`${context}: path "${url}" escapes the skin directory`);
	else if (/^data:/i.test(url)) warnings.push(`${context}: inline data: URL — prefer a file under assets/`);
}
const GENERIC_KEYFRAMES = /* @__PURE__ */ new Set([
	"spin",
	"pulse",
	"fade",
	"fadein",
	"fade-in",
	"fadeout",
	"fade-out",
	"slide",
	"slidein",
	"slide-in",
	"bounce",
	"glow",
	"blink",
	"shake",
	"float"
]);
/**
* Transform a skin stylesheet: force-scope every selector under
* html[data-dsh-skin="<id>"] and enforce the whitelist. Throws
* SkinCssSafetyError on any violation (fail-closed); lightningcss parse
* errors propagate as-is (malformed CSS is also a hard failure).
*/
function transformSkinCss(css, options) {
	const { skinId } = options;
	const filename = options.filename ?? "skin.css";
	const violations = [];
	const warnings = [];
	const spans = [];
	const defined = /* @__PURE__ */ new Set();
	transform({
		filename,
		code: Buffer.from(css),
		visitor: {
			Rule: {
				import(rule) {
					violations.push(`${filename}: @import "${rule.value.url}" is not allowed; skins are single-file stylesheets`);
				},
				keyframes(rule) {
					const name = rule.value.name;
					const value = typeof name === "string" ? name : name?.value;
					if (typeof value === "string" && GENERIC_KEYFRAMES.has(value.toLowerCase())) warnings.push(`${filename}: generic @keyframes name "${value}" may collide across skins; prefix it (e.g. ${skinId}-${value})`);
				},
				style(rule) {
					const loc = rule.value.loc;
					if (loc) {
						const start = locToOffset(css, loc.line, loc.column);
						const openBrace = findOpenBrace(css, start);
						if (openBrace !== -1) spans.push({
							start,
							openBrace
						});
					}
					for (const sel of rule.value.selectors) for (const c of sel) if (c.type === "attribute" && c.name === "class" && [
						"substring",
						"prefix",
						"suffix"
					].includes(c.operation?.operator)) warnings.push(`${filename}: [class*=...]-style attribute matching relies on CSS-Modules hash class names and may break on any official rebuild`);
				}
			},
			Declaration: { custom(property) {
				defined.add(property.name);
			} },
			Url(url) {
				checkUrl(url.url, filename, violations, warnings);
			}
		}
	});
	if (violations.length > 0) throw new SkinCssSafetyError(`skin CSS violates the whitelist:\n - ${violations.join("\n - ")}`, violations);
	const sorted = [...spans].sort((a, b) => a.start - b.start);
	const scope = `html[data-dsh-skin="${skinId}"]`;
	let out = "";
	let cursor = 0;
	for (const span of sorted) {
		const selectorText = css.slice(span.start, span.openBrace);
		const close = findCloseBrace(css, span.openBrace);
		out += css.slice(cursor, span.start);
		const scoped = scopeSelectorList(selectorText, skinId);
		const block = close === -1 ? css.slice(span.openBrace) : css.slice(span.openBrace, close + 1);
		out += scoped + block;
		if (close !== -1 && hasBareRootSelector(selectorText)) {
			const tokens = rootBodyTokens(block);
			if (tokens.length > 0) out += `\n${scope} {\n  ${tokens.map(({ name, important }) => `${name}: initial${important ? " !important" : ""};`).join("\n  ")}\n}\n`;
		}
		if (hasBareRootSelector(selectorText) && close !== -1) {
			const props = withoutCssComments(css.slice(span.openBrace + 1, close)).split("\n").map((line) => bodyCloneProperty(line.trim())).filter((line) => line !== null);
			if (props.length > 0) out += `\n${scope} body {\n  ${props.join("\n  ")}\n}\n`;
		}
		cursor = close === -1 ? span.openBrace : close + 1;
	}
	out += css.slice(cursor);
	out += `\n${scope} [id="root"] { background: transparent; }\n`;
	out += `\n${scope} body { --shiki-background: var(--dsw-alias-markdown-code-block); }\n`;
	if (options.deriveFallbacks === true) {
		const fallbacks = [...deriveFallbackTokens(defined), ...derivePrimaryActionFallbacks(defined)];
		if (fallbacks.length > 0) out += `\n${scope} body {\n  ${fallbacks.join("\n  ")}\n}\n`;
	}
	return {
		code: out,
		warnings
	};
}
/**
* Find the matching closing brace for the block opening at openBrace.
* Conservative: counts braces, skips strings and comments; returns -1 when
* the block never closes (callers then keep the remainder as-is).
*/
function findCloseBrace(css, openBrace) {
	let depth = 0;
	let i = openBrace;
	let inString = null;
	let inComment = false;
	for (; i < css.length; i++) {
		const ch = css[i];
		const next = css[i + 1];
		if (inComment) {
			if (ch === "*" && next === "/") {
				inComment = false;
				i++;
			}
			continue;
		}
		if (inString !== null) {
			if (ch === "\\") i++;
			else if (ch === inString) inString = null;
			continue;
		}
		if (ch === "/" && next === "*") {
			inComment = true;
			i++;
			continue;
		}
		if (ch === "\"" || ch === "'") {
			inString = ch;
			continue;
		}
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}
//#endregion
//#region src/routes-v2.ts
/**
* Skin-center v2 HTTP routes (issue #506, M2) — the loading/serving half of
* the new architecture. Pure read-only asset serving plus the active-skin
* selection write; the actual switch happens browser-side (atomic swap, no
* reload, no cordis.patch.yml rewrite).
*
* Endpoints (all under /api/skin-center/v2):
*  - GET  /catalog                     catalog snapshot (installed skins + diagnostics)
*  - GET  /skins/<id>/stylesheet       transformed + scoped skin.css
*  - GET  /skins/<id>/patches          transformed + scoped patches.css (404 when absent)
*  - GET  /skins/<id>/hooks.mjs        the escape-hatch entry (404 when absent)
*  - GET  /skins/<id>/assets/<path>    static in-directory assets (incl. preview/)
*  - GET  /active                      the persisted active skin id + background preferences
*  - POST /active                      persist active id and/or background (same-origin fenced)
*
* The stylesheet/patches responses pass through the CSS safety pipeline
* (force-scoped under html[data-dsh-skin="<id>"], whitelist fail-closed), so
* the browser can inject them blindly. hooks.mjs is served verbatim — it is
* trusted, same-review same-release code (high sensitivity, see contracts/),
* served for built-in skins and for byte-verified official-market user
* installs, including exact reviewed legacy installs (issue #1073).
* @module @linxin666/dsh-client-ui-skin-center/routes-v2
*/
const SKIN_CENTER_V2_PREFIX = "/api/skin-center/v2";
const MIME = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".json": "application/json; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8"
};
function sendCss(res, status, code) {
	res.writeHead(status, {
		"content-type": "text/css; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(code);
}
/** Serve one manifest-referenced stylesheet through the safety pipeline. */
function serveStylesheet(res, entry, relPath, filename) {
	const abs = resolveInsideSkin(entry, relPath);
	if (!abs || !existsSync(abs)) {
		writeJson(res, 404, {
			ok: false,
			error: "stylesheet-not-found"
		});
		return;
	}
	try {
		const { code } = transformSkinCss(readFileSync(abs, "utf8"), {
			skinId: entry.manifest.id,
			filename,
			deriveFallbacks: filename === "skin.css"
		});
		sendCss(res, 200, code);
	} catch (error) {
		if (error instanceof SkinCssSafetyError) {
			writeJson(res, 422, {
				ok: false,
				error: "css-whitelist-violation",
				violations: error.violations
			});
			return;
		}
		writeJson(res, 500, {
			ok: false,
			error: "css-transform-failed",
			detail: error?.message ?? String(error)
		});
	}
}
/** Serve one static file from inside the skin directory (fail-closed). */
function serveAsset(res, entry, relPath) {
	const abs = resolveInsideSkin(entry, relPath);
	if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
		writeJson(res, 404, {
			ok: false,
			error: "asset-not-found"
		});
		return;
	}
	const mime = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
	res.writeHead(200, {
		"content-type": mime,
		"cache-control": "no-store"
	});
	res.end(readFileSync(abs));
}
/**
* Build the v2 route set. Registration is the caller's job (the host entry
* keeps the mount-once discipline).
*/
function makeSkinCenterV2Routes(deps = {}) {
	const loadCatalog = deps.loadCatalog ?? (() => loadSkinCatalog());
	const activeStatePath = deps.activeStatePath ?? defaultActiveStatePath();
	const shippedSet = (deps.shippedSkinIds ?? shippedSkinIds)();
	const catalogHandler = (_req, res) => {
		const catalog = loadCatalog();
		writeJson(res, 200, {
			ok: true,
			capturedAt: catalog.capturedAt,
			skins: catalog.skins.filter((s) => s.origin === "user" || shippedSet.has(s.manifest.id)).map((s) => ({
				origin: s.origin,
				warnings: s.warnings,
				manifest: s.manifest,
				channel: s.origin === "user" ? existsSync(join(s.dir, "dsh-market.provenance.json")) ? "market" : "unknown" : "npm"
			})),
			diagnostics: catalog.diagnostics
		});
	};
	const verifyHandler = async (req, res) => {
		if (!requireSameOrigin(req, res)) return;
		if (req.method !== "POST") {
			writeJson(res, 405, {
				ok: false,
				error: "method-not-allowed"
			});
			return;
		}
		let body = null;
		try {
			body = await readJsonBody(req, { maxBytes: 16 * 1024 });
		} catch {
			body = null;
		}
		const autoRepair = body?.autoRepair !== false;
		writeJson(res, 200, {
			ok: true,
			...await verifyAndRepairAllSkins(loadCatalog, {
				userDir: deps.userDir,
				fetchImpl: deps.fetchImpl,
				localSourceDir: deps.localSourceDir,
				autoRepair
			})
		});
	};
	const skinPrefix = `${SKIN_CENTER_V2_PREFIX}/skins/`;
	const skinsHandler = async (req, res) => {
		const [id, ...tail] = new URL(req.url ?? "/", "http://localhost").pathname.slice(skinPrefix.length).split("/");
		const sub = tail.join("/");
		const catalog = loadCatalog();
		const entry = id ? findSkin(catalog, id) : null;
		if (sub === "uninstall") {
			if (!requireSameOrigin(req, res)) return;
			if (req.method !== "POST") {
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!entry) {
				writeJson(res, 404, {
					ok: false,
					error: "skin-not-found"
				});
				return;
			}
			if (entry.origin === "builtin") {
				writeJson(res, 400, {
					ok: false,
					error: "cannot-uninstall-builtin"
				});
				return;
			}
			const uninstallRes = uninstallUserSkin(id, { userDir: deps.userDir ?? (entry.dir ? dirname(entry.dir) : void 0) });
			if (!uninstallRes.ok) {
				writeJson(res, uninstallRes.error === "skin-not-found" ? 404 : 500, {
					ok: false,
					error: uninstallRes.error,
					detail: uninstallRes.detail
				});
				return;
			}
			if (readActiveState(activeStatePath).active === id) writeActiveState(activeStatePath, { active: null });
			writeJson(res, 200, {
				ok: true,
				id
			});
			return;
		}
		if (sub === "repair") {
			if (!requireSameOrigin(req, res)) return;
			if (req.method !== "POST") {
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!entry) {
				writeJson(res, 404, {
					ok: false,
					error: "skin-not-found"
				});
				return;
			}
			if (entry.origin === "builtin") {
				writeJson(res, 400, {
					ok: false,
					error: "cannot-repair-builtin"
				});
				return;
			}
			const repairRes = await repairSkin(id, {
				userDir: deps.userDir ?? (entry.dir ? dirname(entry.dir) : void 0),
				fetchImpl: deps.fetchImpl,
				localSourceDir: deps.localSourceDir
			});
			writeJson(res, repairRes.ok ? 200 : 500, repairRes);
			return;
		}
		if (!entry) {
			writeJson(res, 404, {
				ok: false,
				error: "skin-not-found"
			});
			return;
		}
		if (sub === "stylesheet") {
			serveStylesheet(res, entry, entry.manifest.contributes.stylesheet, "skin.css");
			return;
		}
		if (sub === "patches") {
			const patches = entry.manifest.contributes.patches;
			if (!patches) {
				writeJson(res, 404, {
					ok: false,
					error: "no-patches"
				});
				return;
			}
			serveStylesheet(res, entry, patches, "patches.css");
			return;
		}
		if (sub === "hooks.mjs") {
			const facet = entry.manifest.facets?.client;
			if (!facet) {
				writeJson(res, 404, {
					ok: false,
					error: "no-hooks"
				});
				return;
			}
			if (!canServeSkinHooks(entry)) {
				writeJson(res, 403, {
					ok: false,
					error: "hooks-require-review",
					origin: entry.origin
				});
				return;
			}
			const abs = resolveInsideSkin(entry, facet.entry);
			if (!abs || !existsSync(abs)) {
				writeJson(res, 404, {
					ok: false,
					error: "hooks-not-found"
				});
				return;
			}
			res.writeHead(200, {
				"content-type": "text/javascript; charset=utf-8",
				"cache-control": "no-store"
			});
			res.end(readFileSync(abs));
			return;
		}
		if (sub.startsWith("assets/") || sub.startsWith("preview/")) {
			serveAsset(res, entry, sub);
			return;
		}
		writeJson(res, 404, {
			ok: false,
			error: "unknown-skin-resource"
		});
	};
	const activeGetHandler = (_req, res) => {
		const state = readActiveState(activeStatePath);
		const catalog = loadCatalog();
		writeJson(res, 200, {
			ok: true,
			active: state.active !== null && !findSkin(catalog, state.active) ? null : state.active,
			background: state.background
		});
	};
	const activePostHandler = async (req, res) => {
		if (!requireSameOrigin(req, res)) return;
		let body;
		try {
			body = await readJsonBody(req, { maxBytes: 16 * 1024 });
		} catch {
			writeJson(res, 400, {
				ok: false,
				error: "invalid-body"
			});
			return;
		}
		if (body === null) {
			writeJson(res, 400, {
				ok: false,
				error: "invalid-body"
			});
			return;
		}
		const hasActive = typeof body === "object" && body !== null && "active" in body;
		const hasBackground = typeof body === "object" && body !== null && "background" in body;
		if (!hasActive && !hasBackground) {
			writeJson(res, 400, {
				ok: false,
				error: "nothing-to-update"
			});
			return;
		}
		const active = body.active;
		if (hasActive && active !== null && typeof active !== "string") {
			writeJson(res, 400, {
				ok: false,
				error: "active-must-be-string-or-null"
			});
			return;
		}
		if (typeof active === "string" && !findSkin(loadCatalog(), active)) {
			writeJson(res, 404, {
				ok: false,
				error: "skin-not-found"
			});
			return;
		}
		const update = {};
		if (hasActive) update.active = active;
		if (hasBackground) {
			const background = sanitizeSkinBackground(body.background);
			if (background === null) {
				writeJson(res, 400, {
					ok: false,
					error: "invalid-background"
				});
				return;
			}
			update.background = background;
		}
		writeActiveState(activeStatePath, update);
		const state = readActiveState(activeStatePath);
		writeJson(res, 200, {
			ok: true,
			active: state.active,
			background: state.background
		});
	};
	return [
		{
			kind: "exact",
			path: `${SKIN_CENTER_V2_PREFIX}/catalog`,
			handler: catalogHandler
		},
		{
			kind: "exact",
			path: `${SKIN_CENTER_V2_PREFIX}/verify`,
			handler: verifyHandler
		},
		{
			kind: "prefix",
			path: skinPrefix.replace(/\/$/, ""),
			handler: skinsHandler
		},
		{
			kind: "exact",
			path: `${SKIN_CENTER_V2_PREFIX}/active`,
			handler: (req, res) => {
				if (req.method === "GET") return activeGetHandler(req, res);
				if (req.method === "POST") return activePostHandler(req, res);
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
			}
		}
	];
}
//#endregion
//#region src/tap-index-adapter.ts
const HTML_TAG = /<html(\s[^>]*)?>/i;
const HEAD_CLOSE = /<\/head>/i;
const SKIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Stamp or replace data-dsh-skin on the <html> tag. */
function stampSkinAttribute(html, skinId) {
	return html.replace(HTML_TAG, (match, attrs) => {
		const rest = attrs ?? "";
		if (/\sdata-dsh-skin=/.test(rest)) return match.replace(/\sdata-dsh-skin=("[^"]*"|'[^']*'|[^\s>]+)/, ` data-dsh-skin="${skinId}"`);
		return `<html${rest} data-dsh-skin="${skinId}">`;
	});
}
/** Build the link tags injected before </head>. */
function skinLinkTags(skinId, hasPatches) {
	if (!SKIN_ID.test(skinId)) throw new TypeError(`invalid skin id: ${skinId}`);
	const base = `${SKIN_CENTER_V2_PREFIX}/skins/${skinId}`;
	const links = [`<link rel="stylesheet" href="${base}/stylesheet" data-dsh-skin-link="stylesheet">`];
	if (hasPatches) links.push(`<link rel="stylesheet" href="${base}/patches" data-dsh-skin-link="patches">`);
	return links.join("");
}
/** Build the structured rows collected fresh for every index render. */
function makeSkinIndexRows(deps) {
	const loadCatalog = deps.loadCatalog ?? (() => loadSkinCatalog());
	const warn = deps.warn ?? ((message) => console.warn(`[skin-center] ${message}`));
	const warned = /* @__PURE__ */ new Set();
	const warnOnce = (reason, message) => {
		if (warned.has(reason)) return;
		warned.add(reason);
		warn(message);
	};
	return () => {
		try {
			const active = deps.readActiveId();
			if (!active) return [];
			const entry = findSkin(loadCatalog(), active);
			if (!entry) {
				warnOnce(`missing:${active}`, `active skin "${active}" not in catalog; serving stock look`);
				return [];
			}
			return [{
				kind: "html",
				placement: "head",
				html: skinLinkTags(active, entry.manifest.contributes.patches !== void 0)
			}];
		} catch (error) {
			warnOnce("row-error", `skin index rows failed closed: ${error?.message ?? error}`);
			return [];
		}
	};
}
/**
* Create the raw index tap. Structured rows run before it on DSH 0.1.1; when
* their marker is present the tap only stamps the html element. Without the
* marker it also injects links, preserving fail-closed behavior on older hosts.
*/
function makeSkinIndexTap(deps) {
	const loadCatalog = deps.loadCatalog ?? (() => loadSkinCatalog());
	const warn = deps.warn ?? ((message) => console.warn(`[skin-center] ${message}`));
	const warned = /* @__PURE__ */ new Set();
	const warnOnce = (reason, message) => {
		if (warned.has(reason)) return;
		warned.add(reason);
		warn(message);
	};
	return (html) => {
		try {
			const active = deps.readActiveId();
			if (!active) return html;
			const entry = findSkin(loadCatalog(), active);
			if (!entry) {
				warnOnce(`missing:${active}`, `active skin "${active}" not in catalog; serving stock look`);
				return html;
			}
			if (!HTML_TAG.test(html) || !HEAD_CLOSE.test(html)) {
				warnOnce("malformed-html", "index.html has no <html>/</head> anchors; skipping skin injection");
				return html;
			}
			const stamped = stampSkinAttribute(html, active);
			if (stamped.includes("data-dsh-skin-link=")) return stamped;
			const links = skinLinkTags(active, entry.manifest.contributes.patches !== void 0);
			return stamped.replace(HEAD_CLOSE, `${links}</head>`);
		} catch (error) {
			warnOnce("tap-error", `skin index tap failed closed: ${error?.message ?? error}`);
			return html;
		}
	};
}
//#endregion
//#region src/background-migration.ts
/**
* One-shot background-preference migration (issue #996): the
* `skin-background` settings namespace used to be the only store, but the
* remote pairing channel fences settings.* as loopback-only, so paired
* desktops read defaults and dropped writes. The values now live in the v2
* active-state document; on boot the host copies a customized legacy section
* into it exactly once (later boots see the background key and stop). The
* legacy namespace stays registered as the official settings page's input
* face — the browser half keeps listening to it and forwards page edits into
* the v2 store.
*
* "Customized" means at least one field departs from its schema default:
* resolved settings always carry defaults, so a never-touched section is
* indistinguishable from an explicit all-defaults section — migrating either
* is a no-op in behavior, and skipping both keeps the state document clean.
* Never throws: a failed migration leaves both stores untouched.
* @module @linxin666/dsh-client-ui-skin-center/background-migration
*/
/**
* Run the one-shot migration. Idempotent: once the v2 state carries a
* background section this is a silent no-op.
* @param options.activeStatePath - the v2 state document location.
* @param options.readSettings - thunk resolving the legacy settings section.
*/
function migrateBackgroundFromSettings(options) {
	const notes = [];
	const result = {
		migrated: false,
		notes
	};
	try {
		if (readActiveState(options.activeStatePath).background !== null) return result;
		const legacy = normalizeSkinBackground(options.readSettings());
		if (!hasCustomSkinBackground(legacy)) return result;
		writeActiveState(options.activeStatePath, { background: legacy });
		result.migrated = true;
		notes.push("migrated the skin-background settings section into the v2 active state");
		return result;
	} catch (error) {
		notes.push(`background migration failed closed: ${error?.message ?? error}`);
		return result;
	}
}
//#endregion
//#region src/legacy-bridge.ts
/**
* Legacy bridge (issue #506, migration path): ONE-SHOT, THIN. On the first
* v2 boot it reads the retired dsh-skin machinery's state — the
* "dsh-skin managed" section of the harness home cordis.patch.yml (where the
* v1 CLI wrote it; issue #788) with the active profile's cordis.patch.yml
* probed as a secondary location — migrates the active skin id into the v2
* selection store (skin-center-active.json), and strips the managed/legacy
* skin rows so the config watcher's next reload boots without the old
* bundle. No old runtime is kept: after the migration the managed section
* is gone for good.
*
* Reading the active id without the retired registry:
*  1. an insert row naming a dsh-client-ui-skin-<id> package → that id;
*  2. otherwise, with the v2 catalog as the known-id universe: the known id
*     whose ui-skin-<id> row is NOT disabled inside the managed section
*     (bundle-wired active skins carried no row of their own);
*  3. a managed section disabling everything (or no section at all) → stock.
* @module @linxin666/dsh-client-ui-skin-center/legacy-bridge
*/
/**
* Atomic replace: write a sibling temp file then rename over the target, so
* a crash mid-write can never leave a half-written boot patch and the config
* watcher only ever sees complete content (ported from the retired
* skin-switch.ts).
*/
function writePatchAtomic(filePath, next) {
	const dir = dirname(filePath);
	mkdirSync(dir, { recursive: true });
	let previousMode;
	try {
		previousMode = statSync(filePath).mode & 511;
	} catch {
		previousMode = void 0;
	}
	const tmpDir = mkdtempSync(join(dir, `${basename(filePath)}.tmp-`));
	const tmp = join(tmpDir, basename(filePath));
	try {
		writeFileSync(tmp, next, { flag: "wx" });
		chmodSync(tmp, previousMode ?? 384);
		renameSync(tmp, filePath);
	} catch (error) {
		try {
			rmSync(tmpDir, {
				recursive: true,
				force: true
			});
		} catch {}
		throw error;
	}
	try {
		rmSync(tmpDir, {
			recursive: true,
			force: true
		});
	} catch {}
}
const MANAGED_START = "# --- dsh-skin managed (auto-generated; do not edit) ---";
const MANAGED_END = "# --- end dsh-skin managed ---";
/**
* Remove every managed skin section (issue #676: a second stray section kept
* hasLegacyState true and re-ran the migration on each boot). Throws on an
* unterminated section (a malformed boot patch must fail loudly, never be
* silently half-written).
*/
function stripManaged(patch) {
	let out = patch;
	while (true) {
		const start = out.indexOf(MANAGED_START);
		if (start === -1) return out;
		const end = out.indexOf(MANAGED_END, start);
		if (end === -1) throw new Error("managed skin section is unterminated; fix the harness cordis.patch.yml");
		out = out.slice(0, start) + out.slice(end + 30);
	}
}
/** Remove - insert: items left with no - id: rows after legacy cleanup. */
function dropEmptyInserts(text) {
	const lines = text.split("\n");
	const out = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();
		if (/^-\s*insert:\s*(?:\[\s*\])?\s*$/.exec(trimmed) === null) {
			out.push(line);
			i += 1;
			continue;
		}
		const indent = line.length - trimmed.length;
		let j = i + 1;
		let hasRow = false;
		while (j < lines.length) {
			const t = lines[j].trim();
			if (t === "") {
				j += 1;
				continue;
			}
			if (lines[j].length - t.length <= indent) break;
			if (!t.startsWith("#") && /^- id:/.test(t)) hasRow = true;
			j += 1;
		}
		if (hasRow) for (let k = i; k < j; k += 1) out.push(lines[k]);
		i = j;
	}
	return out.join("\n");
}
/**
* Drop legacy hand-written skin insert rows (and their touch comments).
* Id-target rows (- id: ui-skin-x + disabled: true, no name: line) carry the
* mutual-exclusion wiring and are removed by stripManaged together with the
* section; stragglers outside the section are dropped here only when they
* are insert rows (a name: line directly below).
*/
function stripLegacySkinRows(patch) {
	const lines = patch.split(/\r?\n/);
	const kept = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (/^\s*- id:\s*(ui-skin-[a-z0-9-]+)\s*$/.exec(line) !== null) {
			const next = lines[i + 1];
			if ((next === void 0 ? null : /^\s*name:\s*['"]?@[a-z0-9][a-z0-9._-]*\/dsh-client-ui-skin-(?!center['"]?\s*$)[^'"]*['"]?\s*$/.exec(next)) !== null) {
				if (i > 0 && /^\s*#[^\n]*$/.test(lines[i - 1]) && kept[kept.length - 1] === lines[i - 1]) kept.pop();
				i += 1;
				continue;
			}
		}
		kept.push(line);
	}
	let text = kept.join("\n").replace(/^# \(touch\)[^\n]*\n?/gm, "");
	text = dropEmptyInserts(text);
	return text.replace(/\n{3,}/g, "\n\n");
}
/** Drop bare top-level empty flow lists left by the stock profile template. */
function stripEmptyPatchList(patch) {
	return patch.replace(/^[ \t]*\[\s*\][ \t]*\r?\n?/gm, "");
}
/** Full legacy cleanup: managed section + insert rows + empty flow list. */
function stripLegacySkinState(patch) {
	return stripEmptyPatchList(stripLegacySkinRows(stripManaged(patch)));
}
/**
* Read the active legacy skin id from a patch text.
* @param patch - raw cordis.patch.yml text.
* @param knownIds - the v2 catalog's known skin ids (bundle-wired detection).
*/
function readLegacyActiveId(patch, knownIds) {
	for (const m of patch.matchAll(/name:\s*['"]?@linxin666\/dsh-client-ui-skin-([a-z0-9-]+)['"]?/g)) if (m[1] !== "center") return m[1];
	if (!patch.includes("# --- dsh-skin managed (auto-generated; do not edit) ---")) return null;
	const disabled = /* @__PURE__ */ new Set();
	for (const m of patch.matchAll(/^- id: (ui-skin-[a-z0-9-]+)\r?\n  disabled: true/gm)) disabled.add(m[1].replace("ui-skin-", ""));
	const candidates = knownIds.filter((id) => !disabled.has(id));
	return candidates.length === 1 ? candidates[0] : null;
}
/**
* Candidate patch paths, harness home first (issue #788): the v1 dsh-skin
* CLI wrote its managed section into the home cordis.patch.yml, not the
* active profile's. An explicit override (test seam) stays single-path.
*/
function candidatePatchPaths(options) {
	if (options.patchPath !== void 0) return [options.patchPath];
	const paths = resolveHarnessPaths();
	return [paths.legacyPatchPath, paths.patchPath];
}
/**
* Run the one-shot migration. Idempotent: once the v2 selection file exists
* and the patch carries no managed section, this is a no-op. Never throws —
* a failed migration leaves the legacy state untouched (the old mechanism
* still works until M4 removes it) and reports via notes.
*/
function migrateLegacySelection(options) {
	const notes = [];
	const result = {
		migrated: null,
		patchCleaned: false,
		failed: false,
		notes
	};
	try {
		let sawLegacyState = false;
		let readablePatch = false;
		let idMigrationDone = false;
		for (const patchPath of candidatePatchPaths(options)) {
			let patch;
			try {
				patch = readFileSync(patchPath, "utf8");
				readablePatch = true;
			} catch {
				continue;
			}
			if (!(patch.includes("# --- dsh-skin managed (auto-generated; do not edit) ---") || /name:\s*['"]?@linxin666\/dsh-client-ui-skin-/.test(patch))) continue;
			sawLegacyState = true;
			if (!idMigrationDone) {
				if (readActiveSelection(options.activeStatePath) !== null) notes.push("v2 selection already present; skipped id migration");
				else {
					const active = readLegacyActiveId(patch, options.knownIds);
					if (active !== null) {
						writeActiveSelection(options.activeStatePath, active);
						result.migrated = active;
						notes.push(`migrated active skin "${active}" to the v2 selection store`);
					} else notes.push("legacy state resolves to the stock look; selection store left unset");
				}
				idMigrationDone = true;
			}
			let cleaned = stripLegacySkinState(patch);
			if (cleaned.split(/\r?\n/).every((line) => line.trim() === "" || line.trimStart().startsWith("#"))) cleaned = "[]\n";
			if (cleaned !== patch) {
				(options.writePatch ?? writePatchAtomic)(patchPath, cleaned);
				result.patchCleaned = true;
				notes.push("stripped the legacy managed skin rows from cordis.patch.yml");
			}
		}
		if (!sawLegacyState) notes.push(readablePatch ? "no legacy managed skin state; nothing to migrate" : "no readable cordis.patch.yml; nothing to migrate");
		return result;
	} catch (error) {
		result.failed = true;
		notes.push(`legacy migration failed closed: ${error?.message ?? error}`);
		return result;
	}
}
//#endregion
//#region src/macos-library.ts
/**
* macOS wallpaper auto-discovery for the skin center (host half).
*
* Wallpaper Engine ships Windows-only, so on macOS the inventory falls back
* to the wallpapers macOS itself manages:
*
*   1. Aerial (dynamic) wallpapers the user downloaded in System Settings:
*      - modern layout  ~/Library/Application Support/com.apple.wallpaper/
*        aerials/videos/<asset-id>.mov with same-stem previews under
*        aerials/thumbnails/<asset-id>.png and display names in
*        aerials/manifest/entries.json (the official Apple manifest);
*      - legacy layout  /Library/Application Support/com.apple.idleassetsd/
*        Customer/<quality>/<asset-id>.mov (Sonoma and earlier).
*      Entries become 'video' wallpapers; browsers without HEVC decode fall
*      back to the thumbnail through the panel's existing video error path.
*   2. Desktop Pictures (image formats only — .heic/.heif converted through
*      sips, .jpg/.jpeg/.png/.webp served directly; static and Apple dynamic
*      wallpapers alike render their first frame): /System/Library/Desktop
*      Pictures (built-in) and /Library/Desktop Pictures (legacy downloads).
*
* Every candidate is validated by extension AND magic bytes (ISO BMFF ftyp
* for .mov/.heic, JPEG/PNG/WebP signatures for the rest); anything else is
* skipped even inside a known wallpaper directory.
*
* Everything is injectable for tests: roots, platform and filesystem probes
* are parameters, never hard reads. Scanning is synchronous like the rest
* of we-library (directory listings only; no file payload is read except
* the small entries.json manifest).
* @module @linxin666/dsh-client-ui-skin-center/macos-library
*/
/** Default roots for the current user (both modern and legacy layouts). */
function defaultMacosWallpaperRoots(home = homedir()) {
	return {
		aerials: [join$1(home, "Library", "Application Support", "com.apple.wallpaper", "aerials"), join$1("/Library", "Application Support", "com.apple.idleassetsd", "Customer")],
		pictures: [join$1("/System", "Library", "Desktop Pictures"), join$1("/Library", "Desktop Pictures")]
	};
}
/** Default head reader: opens the file and reads at most `bytes` (never whole files — aerials are gigabytes). */
function defaultReadHead(path, bytes) {
	const fd = openSync(path, "r");
	try {
		const buffer = Buffer.alloc(bytes);
		const read = readSync(fd, buffer, 0, bytes, 0);
		return buffer.subarray(0, read);
	} finally {
		closeSync(fd);
	}
}
function resolveFs(inject) {
	return {
		exists: inject.exists ?? existsSync,
		readdir: inject.readdir ?? readdirSync,
		readFile: inject.readFile ?? ((path) => readFileSync(path, "utf8")),
		stat: inject.stat ?? statSync,
		readHead: inject.readHead ?? defaultReadHead
	};
}
const bytes = (head, at, text) => [...text].every((ch, i) => head[at + i] === ch.charCodeAt(0));
/** ISO BMFF container sniff (size + 'ftyp' + brand): covers .mov and .heic/.heif. */
function hasBmffHeader(head) {
	return head.length >= 12 && bytes(head, 4, "ftyp");
}
function hasJpegHeader(head) {
	return head.length >= 3 && head[0] === 255 && head[1] === 216 && head[2] === 255;
}
function hasPngHeader(head) {
	return head.length >= 8 && head[0] === 137 && bytes(head, 1, "PNG");
}
function hasWebpHeader(head) {
	return head.length >= 12 && bytes(head, 0, "RIFF") && bytes(head, 8, "WEBP");
}
const HEAD_BYTES = 12;
/** Content check for aerial videos: extension AND ISO BMFF magic must agree. */
function isMovVideo(name, head) {
	return MOV_RE.test(name) && hasBmffHeader(head);
}
/** Content check for desktop pictures: only image formats, magic verified. */
function isSupportedImage(name, head) {
	if (HEIC_RE.test(name)) return hasBmffHeader(head);
	if (/\.jpe?g$/i.test(name)) return hasJpegHeader(head);
	if (/\.png$/i.test(name)) return hasPngHeader(head);
	if (/\.webp$/i.test(name)) return hasWebpHeader(head);
	return false;
}
/** Read a file head for validation; null when unreadable. */
function readHeadOrNull(fs, path) {
	try {
		return fs.readHead(path, HEAD_BYTES);
	} catch {
		return null;
	}
}
/**
* Read asset-id -> display name out of an aerial entries.json. Missing or
* malformed manifests yield an empty map (titles then fall back to the file
* stem). Only accessibilityLabel is trusted: it is the user-visible name in
* System Settings across locales.
*/
function readAerialManifest(text) {
	const titles = /* @__PURE__ */ new Map();
	try {
		const raw = JSON.parse(text);
		if (typeof raw !== "object" || raw === null) return titles;
		const assets = raw.assets;
		if (!Array.isArray(assets)) return titles;
		for (const asset of assets) {
			if (typeof asset !== "object" || asset === null) continue;
			if (typeof asset.id === "string" && typeof asset.accessibilityLabel === "string" && asset.accessibilityLabel !== "") titles.set(asset.id, asset.accessibilityLabel);
		}
	} catch {}
	return titles;
}
const MOV_RE = /\.mov$/i;
const HEIC_RE = /\.hei[cf]$/i;
function statOrZero(fs, path) {
	try {
		const stat = fs.stat(path);
		return {
			mtimeMs: stat.mtimeMs,
			size: stat.size,
			isFile: stat.isFile()
		};
	} catch {
		return {
			mtimeMs: 0,
			size: 0,
			isFile: false
		};
	}
}
/** Build one aerial entry; the preview is the same-stem thumbnail when downloaded. */
function aerialEntry(id, title, videoAbs, previewAbs, fs) {
	const stat = statOrZero(fs, videoAbs);
	return {
		id: "macos-aerial/" + id,
		title,
		type: "video",
		file: videoAbs,
		preview: previewAbs,
		dir: dirname$1(videoAbs),
		fileAbs: videoAbs,
		previewAbs: previewAbs !== null && fs.exists(previewAbs) ? previewAbs : null,
		source: "system",
		playable: stat.isFile,
		srcMtime: stat.mtimeMs,
		srcSize: stat.size,
		updateAvailable: false
	};
}
/**
* Scan the modern per-user aerial layout: <root>/videos/*.mov with titles
* from <root>/manifest/entries.json and previews from <root>/thumbnails.
*/
function scanAerialsModern(root, fs) {
	const videosDir = join$1(root, "videos");
	if (!fs.exists(videosDir)) return [];
	let names = [];
	try {
		names = fs.readdir(videosDir);
	} catch {
		return [];
	}
	let titles = /* @__PURE__ */ new Map();
	const manifestPath = join$1(root, "manifest", "entries.json");
	if (fs.exists(manifestPath)) try {
		titles = readAerialManifest(fs.readFile(manifestPath));
	} catch {}
	const thumbnailsDir = join$1(root, "thumbnails");
	const entries = [];
	for (const name of names) {
		if (!MOV_RE.test(name)) continue;
		const videoAbs = join$1(videosDir, name);
		const head = readHeadOrNull(fs, videoAbs);
		if (head === null || !isMovVideo(name, head)) continue;
		const id = name.replace(MOV_RE, "");
		const thumbnail = join$1(thumbnailsDir, id + ".png");
		entries.push(aerialEntry(id, titles.get(id) ?? id, videoAbs, thumbnail, fs));
	}
	return entries;
}
/**
* Scan the legacy system-wide aerial layout: <root>/<quality>/<id>.mov
* (2KSDR / 4KHDR / …). Titles come from <root>/entries.json when present.
*/
function scanAerialsLegacy(root, fs) {
	if (!fs.exists(root)) return [];
	let names = [];
	try {
		names = fs.readdir(root);
	} catch {
		return [];
	}
	let titles = /* @__PURE__ */ new Map();
	const manifestPath = join$1(root, "entries.json");
	if (fs.exists(manifestPath)) try {
		titles = readAerialManifest(fs.readFile(manifestPath));
	} catch {}
	const entries = [];
	for (const name of names) {
		const sub = join$1(root, name);
		try {
			if (!fs.stat(sub).isDirectory()) continue;
		} catch {
			continue;
		}
		let videos = [];
		try {
			videos = fs.readdir(sub);
		} catch {
			continue;
		}
		for (const video of videos) {
			if (!MOV_RE.test(video)) continue;
			const videoAbs = join$1(sub, video);
			const head = readHeadOrNull(fs, videoAbs);
			if (head === null || !isMovVideo(video, head)) continue;
			const id = video.replace(MOV_RE, "");
			entries.push(aerialEntry(id, titles.get(id) ?? id, videoAbs, null, fs));
		}
	}
	return entries;
}
/**
* Scan every configured aerial root. A root holding a videos/ subdirectory
* is treated as the modern layout; otherwise as the legacy quality-folder
* layout. Entries de-dupe by asset id (first root wins).
*/
function scanMacAerials(roots, inject = {}) {
	const fs = resolveFs(inject);
	const found = /* @__PURE__ */ new Map();
	for (const root of roots) {
		const entries = fs.exists(join$1(root, "videos")) ? scanAerialsModern(root, fs) : scanAerialsLegacy(root, fs);
		for (const entry of entries) if (!found.has(entry.id)) found.set(entry.id, entry);
	}
	return [...found.values()];
}
/**
* Scan Desktop Pictures roots for *.heic wallpapers (static + Apple dynamic;
* only the first frame is rendered). .madesktop records are data files, not
* folders, and are skipped. Entries de-dupe by stem (first root wins).
*/
function scanMacDesktopPictures(roots, inject = {}) {
	const fs = resolveFs(inject);
	const found = /* @__PURE__ */ new Map();
	for (const root of roots) {
		if (!fs.exists(root)) continue;
		let names = [];
		try {
			names = fs.readdir(root);
		} catch {
			continue;
		}
		for (const name of names) {
			const fileAbs = join$1(root, name);
			const head = readHeadOrNull(fs, fileAbs);
			if (head === null || !isSupportedImage(name, head)) continue;
			const stem = name.replace(/\.[a-z0-9]+$/i, "");
			const id = "macos-image/" + stem;
			if (found.has(id)) continue;
			const stat = statOrZero(fs, fileAbs);
			found.set(id, {
				id,
				title: stem,
				type: "image",
				file: name,
				preview: null,
				dir: root,
				fileAbs,
				previewAbs: null,
				source: "system",
				playable: false,
				srcMtime: stat.mtimeMs,
				srcSize: stat.size,
				updateAvailable: false
			});
		}
	}
	return [...found.values()];
}
/** Scan every macOS wallpaper source; empty off darwin. */
function scanMacosWallpapers(roots, inject = {}) {
	if ((inject.platform ?? process.platform) !== "darwin") return [];
	return [...scanMacAerials(roots.aerials, inject), ...scanMacDesktopPictures(roots.pictures, inject)];
}
//#endregion
//#region src/we-library.ts
/**
* Wallpaper Engine library discovery for the skin center (host half).
*
* Enumerates locally installed Wallpaper Engine wallpapers so the browser
* half can list, preview and render them. Discovery sources, in order:
*
*   1. The WE install itself (Steam app 431960), located on Windows through
*      the HKCU Steam registry value plus libraryfolders.vdf, falling back to
*      common probe paths. Its projects/defaultprojects and
*      projects/myprojects folders are scanned, and every Steam library that
*      owns app 431960 contributes its steamapps/workshop/content/431960
*      directory.
*   2. Manual library folders (the skin-wallpaper settings field
*      weLibraryDirs): each entry may be a folder of wallpaper projects (like
*      a workshop content dir) or a single project folder. A folder without
*      a project.json is accepted when it directly contains a playable media
*      file (e.g. a lone .mp4), which is the no-Steam fallback path.
*   3. macOS wallpaper stores (darwin only, src/macos-library.ts): the
*      user's downloaded aerial .mov wallpapers (com.apple.wallpaper /
*      idleassetsd) and Desktop Pictures *.heic — source 'system', never
*      importable.
*   4. The import store (<harnessHome>/skin-center/wallpapers/<id>/): copies
*      made by the import route. Each holds a manifest.json recording the
*      source identity and the source file mtime/size at import time, so a
*      later workshop update can be flagged as updateAvailable.
*
* Entries are plain data; the HTTP layer (src/we-routes.ts) assigns media
* tokens and decides what is playable. Everything here is injectable for
* tests: roots, platform and environment are parameters, never hard reads.
* @module @linxin666/dsh-client-ui-skin-center/we-library
*/
/** Steam appid of Wallpaper Engine. */
const WE_APPID = "431960";
/** Common Steam install locations probed when libraryfolders.vdf is missing. */
const STEAM_PROBE_DIRS = [
	"C:\\Program Files (x86)\\Steam",
	"C:\\Program Files\\Steam",
	"D:\\Steam",
	"D:\\SteamLibrary",
	"E:\\SteamLibrary"
];
/**
* Expand a leading '~' to the user's home directory (manual library folder
* settings are typed by humans, and existsSync does not understand '~').
*/
function expandUser(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/** First non-blank value, trimmed. */
function firstNonBlank(...values) {
	for (const value of values) if (typeof value === "string" && value.trim() !== "") return value.trim();
}
/**
* The Steam root recorded by the Windows installer (HKCU\\Software\\Valve\\Steam).
* Returns null off Windows or when reg.exe fails. Injectable for tests.
* @param run - reg.exe runner (defaults to execFileSync).
*/
function steamPathFromRegistry(run = () => execFileSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe"), [
	"query",
	"HKCU\\Software\\Valve\\Steam",
	"/v",
	"SteamPath"
], {
	encoding: "utf8",
	windowsHide: true,
	timeout: 5e3,
	stdio: [
		"ignore",
		"pipe",
		"ignore"
	]
})) {
	if (process.platform !== "win32") return null;
	try {
		const match = /SteamPath\s+REG_SZ\s+(.+)/i.exec(run());
		return match ? match[1].trim() : null;
	} catch {
		return null;
	}
}
/**
* Memoize a zero-argument probe so it runs at most once per process.
* The default Windows registry probe is wrapped in this: reg.exe is a
* synchronous child process with a 5s timeout on the request path, and a
* Steam install path is stable for the life of the host process, so one
* probe per process is enough. Injected probes (tests) bypass the memo —
* only the default runner is wrapped.
*/
function memoizedProbe(probe) {
	let cached;
	return () => {
		if (cached === void 0) cached = probe();
		return cached;
	};
}
/** Default registry probe, process-memoized (see memoizedProbe). */
const defaultRegistryProbe = memoizedProbe(() => steamPathFromRegistry());
/** Parse libraryfolders.vdf for library roots that own app 431960. */
function librariesFromVdf(vdfText) {
	const libraries = [];
	let current = null;
	for (const line of vdfText.split(/\r?\n/)) {
		const match = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line);
		if (match) {
			current = match[1].replace(/\\\\/g, "\\");
			continue;
		}
		if (current && line.includes("431960") && !libraries.includes(current)) libraries.push(current);
	}
	return libraries;
}
/** Every Steam library root listed in libraryfolders.vdf, independent of its stale apps cache. */
function allLibrariesFromVdf(vdfText) {
	const libraries = [];
	for (const line of vdfText.split(/\r?\n/)) {
		const match = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line);
		if (match === null) continue;
		const root = match[1].replace(/\\\\/g, "\\");
		if (!libraries.includes(root)) libraries.push(root);
	}
	return libraries;
}
/** Durable ownership fact used when libraryfolders.vdf has not refreshed its apps block. */
function libraryOwnsAppFromManifest(library, appid, exists = existsSync) {
	return exists(join(library, "steamapps", `appmanifest_${appid}.acf`));
}
/**
* Locate the Wallpaper Engine install directory (holds wallpaper32.exe).
* Probes: registry Steam root, well-known paths, then every library that
* owns the app. Non-Windows platforms return null (WE ships Windows-only;
* manual library folders are the fallback there).
* @param opts.env - environment (tests inject).
* @param opts.exists - existence probe (tests inject).
*/
function locateWallpaperEngine(opts = {}) {
	const exists = opts.exists ?? existsSync;
	if (((opts.env ?? process.env).OS ?? "") !== "" || process.platform === "win32") {
		const registry = opts.registry ?? defaultRegistryProbe;
		const probes = [...new Set([registry(), ...STEAM_PROBE_DIRS].filter((d) => !!d))];
		const libraries = [];
		for (const probe of probes) {
			const vdf = join(probe, "steamapps", "libraryfolders.vdf");
			if (exists(vdf)) try {
				libraries.push(...allLibrariesFromVdf(readFileSync(vdf, "utf8")));
			} catch {}
		}
		const candidates = [];
		for (const root of [...probes, ...libraries]) candidates.push(join(root, "steamapps", "common", "wallpaper_engine"));
		candidates.push("C:\\Program Files (x86)\\Wallpaper Engine");
		for (const dir of candidates) if (exists(join(dir, "wallpaper32.exe"))) return dir;
	}
	return null;
}
/**
* Steam library roots that own app 431960 (for the workshop content dir).
* Empty on non-Windows or when nothing is found.
*/
function owningLibraries(opts = {}) {
	const exists = opts.exists ?? existsSync;
	if (process.platform !== "win32" && !opts.exists) return [];
	const registry = opts.registry ?? defaultRegistryProbe;
	const probes = [...new Set([registry(), ...STEAM_PROBE_DIRS].filter((d) => !!d))];
	const libraries = /* @__PURE__ */ new Set();
	for (const probe of probes) {
		const vdf = join(probe, "steamapps", "libraryfolders.vdf");
		if (!exists(vdf)) continue;
		let vdfText;
		try {
			vdfText = readFileSync(vdf, "utf8");
		} catch {
			continue;
		}
		for (const root of librariesFromVdf(vdfText)) libraries.add(root);
		for (const root of allLibrariesFromVdf(vdfText)) if (libraryOwnsAppFromManifest(root, "431960", exists)) libraries.add(root);
	}
	return [...libraries];
}
/** Infer the wallpaper type from the main file extension (project.json fallback). */
function inferType(file) {
	if (/\.(mp4|webm|mkv|avi|mov)$/i.test(file)) return "video";
	if (/\.(html?|js)$/i.test(file)) return "web";
	return "scene";
}
const KNOWN_TYPES = [
	"scene",
	"video",
	"web",
	"application"
];
/** Media file extensions playable through the video element. */
const VIDEO_FILE_RE = /\.(mp4|webm|mkv|avi|mov)$/i;
/** Web entry files. */
const WEB_FILE_RE = /\.html?$/i;
/** Read one project directory's project.json; null when absent/invalid. */
function readProjectJson(dir) {
	const path = join(dir, "project.json");
	if (!existsSync(path)) return null;
	try {
		const raw = JSON.parse(readFileSync(path, "utf8"));
		if (typeof raw !== "object" || raw === null) return null;
		const record = raw;
		if (typeof record.file !== "string" || record.file === "") return null;
		const declared = typeof record.type === "string" ? record.type.toLowerCase() : "";
		const type = KNOWN_TYPES.includes(declared) ? declared : inferType(record.file);
		return {
			title: typeof record.title === "string" && record.title !== "" ? record.title : null,
			type,
			file: record.file,
			preview: typeof record.preview === "string" && record.preview !== "" ? record.preview : null
		};
	} catch {
		return null;
	}
}
/**
* Synthesize one entry per playable media file for a folder without a
* project.json (the no-Steam fallback: the user points a manual folder at a
* pile of .mp4/.webm files or an index.html site — every video becomes its
* own wallpaper). A same-stem image (loop.mp4 -> loop.jpg) becomes the
* entry's preview when present.
*/
function synthesizeMediaEntries(dir, source) {
	let names = [];
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	const media = names.filter((name) => VIDEO_FILE_RE.test(name) || WEB_FILE_RE.test(name));
	const images = names.filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name));
	const entries = [];
	for (const file of media) {
		const stem = file.replace(/\.[^.]+$/, "");
		const preview = images.find((image) => image.replace(/\.[^.]+$/, "") === stem) ?? null;
		entries.push(entryFromDir(dir, source, {
			title: stem,
			type: inferType(file),
			file,
			preview
		}, basename(dir) + "/" + file));
	}
	return entries;
}
/**
* Resolve a scene project's real main container. project.json's file field
* is trusted when it exists on disk, but workshop items frequently declare
* `scene.json` while shipping only the packed `scene.pkg` (and loose
* projects ship the reverse) — probe the declared file, then scene.pkg,
* then scene.json, then a single *.pkg in the directory (#521). Returns the
* hit relative to dir, or null when nothing matches.
*/
function resolveSceneMainFile(dir, declared) {
	for (const candidate of [
		declared,
		"scene.pkg",
		"scene.json"
	]) {
		if (candidate === "") continue;
		try {
			if (statSync(resolve(dir, candidate)).isFile()) return candidate;
		} catch {}
	}
	let pkgs = [];
	try {
		pkgs = readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".pkg"));
	} catch {
		return null;
	}
	return pkgs.length === 1 ? pkgs[0] : null;
}
/** Build one entry from a project directory. */
function entryFromDir(dir, source, project, id) {
	const file = project.type === "scene" ? resolveSceneMainFile(dir, project.file) ?? project.file : project.file;
	const fileAbs = resolve(dir, file);
	const previewAbs = project.preview ? resolve(dir, project.preview) : null;
	let mtime = 0;
	let size = 0;
	let fileExists = false;
	try {
		const stat = statSync(fileAbs);
		if (stat.isFile()) {
			fileExists = true;
			mtime = stat.mtimeMs;
			size = stat.size;
		}
	} catch {}
	return {
		id: id ?? basename(dir),
		title: project.title ?? basename(dir),
		type: project.type,
		file,
		preview: project.preview,
		dir,
		fileAbs,
		previewAbs: previewAbs && existsSync(previewAbs) ? previewAbs : null,
		source,
		playable: fileExists && (project.type === "video" || project.type === "web"),
		srcMtime: mtime,
		srcSize: size,
		updateAvailable: false
	};
}
/**
* Scan one root folder of wallpaper projects (workshop content dir,
* defaultprojects, myprojects, or a manual library folder). A root that is
* itself a project (has project.json) yields one entry; a manual root
* holding loose media files yields one entry per file; otherwise each
* immediate subdirectory is probed the same way.
*/
function scanProjectsRoot(root, source) {
	const direct = readProjectJson(root);
	if (direct) return [entryFromDir(root, source, direct)];
	if (source === "local") {
		const synthesized = synthesizeMediaEntries(root, source);
		if (synthesized.length > 0) return synthesized;
	}
	let names = [];
	try {
		names = readdirSync(root);
	} catch {
		return [];
	}
	const entries = [];
	for (const name of names) {
		const dir = join(root, name);
		try {
			if (!statSync(dir).isDirectory()) continue;
		} catch {
			continue;
		}
		const project = readProjectJson(dir);
		if (project) entries.push(entryFromDir(dir, source, project));
		else if (source === "local") entries.push(...synthesizeMediaEntries(dir, source));
	}
	return entries;
}
/**
* Scan a user-supplied path at any supported Wallpaper Engine level: a
* project folder, project collection, WE install root, Steam library root,
* steamapps folder, or workshop content root.
*/
function scanManualWallpaperRoot(root) {
	const candidates = [
		{
			root,
			source: "local"
		},
		{
			root: join(root, "projects", "defaultprojects"),
			source: "local"
		},
		{
			root: join(root, "projects", "myprojects"),
			source: "local"
		},
		{
			root: join(root, "steamapps", "workshop", "content", WE_APPID),
			source: "workshop"
		},
		{
			root: join(root, "workshop", "content", WE_APPID),
			source: "workshop"
		}
	];
	if (basename(root).toLowerCase() === "wallpaper_engine") candidates.push({
		root: join(dirname(dirname(root)), "workshop", "content", WE_APPID),
		source: "workshop"
	});
	const found = /* @__PURE__ */ new Map();
	for (const candidate of candidates) {
		if (!existsSync(candidate.root)) continue;
		for (const entry of scanProjectsRoot(candidate.root, candidate.source)) if (!found.has(entry.id)) found.set(entry.id, entry);
	}
	return [...found.values()];
}
/** Read one import-store entry's manifest.json; null when absent/invalid. */
function readImportedManifest(entryDir) {
	const path = join(entryDir, "manifest.json");
	if (!existsSync(path)) return null;
	try {
		const raw = JSON.parse(readFileSync(path, "utf8"));
		if (typeof raw !== "object" || raw === null) return null;
		const record = raw;
		if (typeof record.sourceId !== "string" || typeof record.file !== "string") return null;
		const declared = typeof record.type === "string" ? record.type.toLowerCase() : "";
		return {
			sourceId: record.sourceId,
			title: typeof record.title === "string" && record.title !== "" ? record.title : basename(entryDir),
			type: KNOWN_TYPES.includes(declared) ? declared : inferType(record.file),
			srcMtime: typeof record.srcMtime === "number" ? record.srcMtime : 0,
			srcSize: typeof record.srcSize === "number" ? record.srcSize : 0,
			importedAt: typeof record.importedAt === "number" ? record.importedAt : 0,
			file: record.file,
			preview: typeof record.preview === "string" && record.preview !== "" ? record.preview : null
		};
	} catch {
		return null;
	}
}
/**
* Scan the import store (<harnessHome>/skin-center/wallpapers). Each child
* directory with a manifest.json becomes an 'imported' entry whose project
* files live under project/.
* @param storeDir - the wallpapers store root.
*/
function scanImportStore(storeDir) {
	let names = [];
	try {
		names = readdirSync(storeDir);
	} catch {
		return [];
	}
	const entries = [];
	for (const name of names) {
		const dir = join(storeDir, name);
		const manifest = readImportedManifest(dir);
		if (!manifest) continue;
		const projectDir = join(dir, "project");
		const declaredRel = manifest.file.replace(/^project[\\/]/, "");
		const file = manifest.type === "scene" ? join("project", resolveSceneMainFile(projectDir, declaredRel) ?? declaredRel) : manifest.file;
		const fileAbs = resolve(dir, file);
		const previewAbs = manifest.preview ? resolve(dir, manifest.preview) : null;
		let mtime = 0;
		let size = 0;
		let fileExists = false;
		try {
			const stat = statSync(fileAbs);
			if (stat.isFile()) {
				fileExists = true;
				mtime = stat.mtimeMs;
				size = stat.size;
			}
		} catch {}
		entries.push({
			id: `imported/${manifest.sourceId}`,
			title: manifest.title,
			type: manifest.type,
			file,
			preview: manifest.preview,
			dir: projectDir,
			fileAbs,
			previewAbs: previewAbs && existsSync(previewAbs) ? previewAbs : null,
			source: "imported",
			playable: fileExists && (manifest.type === "video" || manifest.type === "web"),
			srcMtime: mtime,
			srcSize: size,
			updateAvailable: false,
			importSrcMtime: manifest.srcMtime,
			importSrcSize: manifest.srcSize
		});
	}
	return entries;
}
/** The default import-store root under the harness home. */
function defaultWallpapersStoreDir(harnessHome) {
	return join(harnessHome, "skin-center", "wallpapers");
}
/**
* Assemble the full inventory: WE install projects + workshop content of
* every owning library + manual library folders + the import store, with
* update detection joining imported manifests back to their sources.
* All filesystem inputs are injectable for tests.
*/
function buildInventory(opts = {}) {
	const autoDetect = opts.autoDetect ?? true;
	const installDir = opts.installDir !== void 0 ? opts.installDir : autoDetect ? locateWallpaperEngine() : null;
	const libraryDirs = opts.libraryDirs ?? (autoDetect ? owningLibraries() : []);
	const macos = opts.macos !== void 0 ? opts.macos : autoDetect && process.platform === "darwin" ? defaultMacosWallpaperRoots() : null;
	const found = /* @__PURE__ */ new Map();
	const add = (entry) => {
		if (!found.has(entry.id)) found.set(entry.id, entry);
	};
	if (installDir) for (const sub of ["defaultprojects", "myprojects"]) {
		const root = join(installDir, "projects", sub);
		if (existsSync(root)) for (const entry of scanProjectsRoot(root, "local")) add(entry);
	}
	for (const library of libraryDirs) {
		const root = join(library, "steamapps", "workshop", "content", WE_APPID);
		if (existsSync(root)) for (const entry of scanProjectsRoot(root, "workshop")) add(entry);
	}
	for (const manual of opts.manualDirs ?? []) {
		const trimmed = firstNonBlank(manual);
		const dir = trimmed !== void 0 ? expandUser(trimmed) : void 0;
		if (dir !== void 0 && existsSync(dir)) for (const entry of scanManualWallpaperRoot(dir)) add(entry);
	}
	if (macos !== null) for (const entry of scanMacosWallpapers(macos, { platform: opts.platform })) add(entry);
	const imported = opts.storeDir ? scanImportStore(opts.storeDir) : [];
	for (const entry of imported) {
		const source = found.get(entry.id.replace(/^imported\//, ""));
		if (source && source.srcMtime > 0 && (source.srcMtime > (entry.importSrcMtime ?? 0) || source.srcSize !== (entry.importSrcSize ?? -1))) entry.updateAvailable = true;
		add(entry);
	}
	const wallpapers = [...found.values()].sort((a, b) => a.title.localeCompare(b.title));
	return {
		installDir: installDir ?? null,
		libraryDirs,
		total: wallpapers.length,
		portableCount: wallpapers.filter((w) => w.playable).length,
		wallpapers
	};
}
/**
* Staleness fingerprint of everything buildInventory reads, so callers can
* cache the assembled inventory and re-scan only when this changes.
*
* Signed inputs, in order:
*   - every scan root's existence + directory mtime, including roots that
*     do not exist yet (a project added or removed under a root changes its
*     mtime; a root that appears later flips 'missing' into an mtime);
*   - per previously scanned entry: the project dir mtime, the
*     project.json / manifest.json mtime and the main + preview file
*     mtime/size. A root mtime alone cannot see a file rewritten in place
*     (workshop updates replace files inside an existing project dir
*     without touching the root), and update detection compares source
*     mtimes, so entries are signed individually.
*
* The caller supplies the current detection result (installDir and
* libraryDirs) — detection itself is cheap because the default registry
* probe is process-memoized — and the config (manualDirs), so a changed
* Steam layout or a settings edit also invalidates. The key for a freshly
* scanned value must be computed from that value's own entries (the
* previous entry set described the previous scan, not this one).
*/
function inventoryFingerprint(opts = {}) {
	const parts = [];
	const statSig = (path) => {
		try {
			const stats = statSync(path);
			return String(stats.mtimeMs) + ":" + (stats.isDirectory() ? "d" : String(stats.size));
		} catch {
			return "missing";
		}
	};
	const signDir = (dir) => {
		parts.push("d:" + dir + "\0" + statSig(dir));
	};
	const signFile = (file) => {
		parts.push("f:" + file + "\0" + statSig(file));
	};
	const installDir = opts.installDir ?? null;
	if (installDir) {
		signDir(join(installDir, "projects", "defaultprojects"));
		signDir(join(installDir, "projects", "myprojects"));
	}
	for (const library of opts.libraryDirs ?? []) signDir(join(library, "steamapps", "workshop", "content", WE_APPID));
	for (const manual of opts.manualDirs ?? []) {
		const trimmed = firstNonBlank(manual);
		if (trimmed === void 0) continue;
		const dir = expandUser(trimmed);
		signDir(dir);
		signDir(join(dir, "projects", "defaultprojects"));
		signDir(join(dir, "projects", "myprojects"));
		signDir(join(dir, "steamapps", "workshop", "content", WE_APPID));
		signDir(join(dir, "workshop", "content", WE_APPID));
		if (basename(dir).toLowerCase() === "wallpaper_engine") signDir(join(dirname(dirname(dir)), "workshop", "content", WE_APPID));
	}
	if (opts.storeDir) signDir(opts.storeDir);
	if (opts.macos) {
		for (const root of opts.macos.aerials) {
			signDir(join(root, "videos"));
			signDir(join(root, "thumbnails"));
			signFile(join(root, "manifest", "entries.json"));
			signDir(root);
		}
		for (const root of opts.macos.pictures) signDir(root);
	}
	for (const entry of opts.entries ?? []) {
		const manifest = entry.source === "imported" ? join(dirname(entry.dir), "manifest.json") : join(entry.dir, "project.json");
		signDir(entry.dir);
		signFile(manifest);
		signFile(entry.fileAbs);
		if (entry.previewAbs) signFile(entry.previewAbs);
	}
	return parts.join(";");
}
//#endregion
//#region src/pkg-extract.ts
/**
* Wallpaper Engine scene.pkg / .tex resource extraction.
*
* This module is the core of the skin center's "scene wallpaper static frame
* extraction" feature: it unpacks a Wallpaper Engine scene package (PKG
* container, magic PKGVxxxx), parses the nested TEX texture containers
* (TEXV0005 header -> TEXI0001 image info -> TEXB0001..4 mipmap data ->
* TEXS0001..3 frame animation metadata), decodes the main mipmap to RGBA8888
* (raw RGBA8888/R8/RG88, FreeImage-embedded JPEG via jpeg-js, plus hand-rolled
* BC1/BC2/BC3 block decompression for DXT1/DXT3/DXT5), and re-encodes the
* result as a PNG using only node:zlib.
*
* Format facts were cross-checked against the two reference implementations:
* RePKG (github.com/notscuffed/repkg, PackageReader / TexReader and friends)
* and linux-wallpaperengine (github.com/Almamu/linux-wallpaperengine,
* PackageParser / TextureParser):
*
* - PKG header: int32-length-prefixed magic string, int32 entry count, then
*   per entry a length-prefixed path plus uint32 offset/length. Offsets are
*   relative to the end of the index. Entry data is stored raw in practice;
*   some packers emit LZ4-chained entries instead (int64 original size, then
*   repeated [int32 decompressed size][int32 compressed size][LZ4 block]).
*   parsePkg probes for a perfectly-fitting block chain and flags such
*   entries; readPkgEntry decompresses them ("compressedSize != size" means
*   LZ4), single-block chains included.
* - TEX magics are NUL-terminated 8-character strings (9 bytes on disk).
*   TEXB0002+ mipmaps carry an isLZ4Compressed flag and a decompressed byte
*   count; the LZ4 payload is one whole block per mipmap. TEXB0004 with an
*   unknown FreeImage format plus the video flag marks an embedded MP4, which
*   is exposed via TexInfo.isVideoMp4 and rejected by decodeTex. GIF flags
*   (bit 2) pull in a TEXS frame container exposed via TexInfo.frames.
*
* LZ4 block decoding follows the official lz4 block format specification;
* BC1/BC2/BC3 follow the standard public algorithms. One npm dependency:
* jpeg-js (pure JavaScript, no native builds) for FreeImage JPEG mipmaps.
*
* @module @linxin666/dsh-client-ui-skin-center/pkg-extract
*/
var pkg_extract_exports = /* @__PURE__ */ __exportAll({
	PKG_ENTRY_FLAG_LZ4: () => 1,
	TexFormat: () => TexFormat,
	TexUnsupportedError: () => TexUnsupportedError,
	buildSceneManifest: () => buildSceneManifest,
	buildSceneManifestFromDir: () => buildSceneManifestFromDir,
	decodePngToRgba: () => decodePngToRgba,
	decodeTex: () => decodeTex,
	encodePng: () => encodePng,
	extractSceneMainImage: () => extractSceneMainImage,
	extractSceneMainImageFromDir: () => extractSceneMainImageFromDir,
	extractSceneResource: () => extractSceneResource,
	extractSceneResourceFromDir: () => extractSceneResourceFromDir,
	extractSceneVideo: () => extractSceneVideo,
	extractSceneVideoFromDir: () => extractSceneVideoFromDir,
	hasSceneVideo: () => hasSceneVideo,
	hasSceneVideoFromDir: () => hasSceneVideoFromDir,
	lz4DecompressBlock: () => lz4DecompressBlock,
	parseMdl: () => parseMdl,
	parsePkg: () => parsePkg,
	parseTex: () => parseTex,
	readPkgEntry: () => readPkgEntry
});
/**
* Hard ceilings for allocations driven by wallpaper file content. Workshop
* files are untrusted: a crafted pkg/tex/png must not be able to force
* multi-GB host allocations (PR #717 follow-up hardening).
*/
const MAX_PKG_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_TEX_DIMENSION = 16384;
const MAX_TEX_PIXELS = 64 * 1024 * 1024;
/** Wallpaper Engine texture format ids (TEXI0001 header), per RePKG/lwe. */
const TexFormat = {
	RGBA8888: 0,
	RGB888: 1,
	RGB565: 2,
	DXT5: 4,
	DXT3: 6,
	DXT1: 7,
	RG88: 8,
	R8: 9,
	RG1616F: 10,
	R16F: 11,
	BC7: 12,
	RGBA1010102: 13,
	RGBA16161616F: 14,
	RGB161616F: 15
};
const TEX_FORMAT_NAMES = {
	0: "RGBA8888",
	1: "RGB888",
	2: "RGB565",
	4: "DXT5",
	6: "DXT3",
	7: "DXT1",
	8: "RG88",
	9: "R8",
	10: "RG1616F",
	11: "R16F",
	12: "BC7",
	13: "RGBA1010102",
	14: "RGBA16161616F",
	15: "RGB161616F"
};
/**
* A TEX format that is recognized but has no decode implementation in this
* build (e.g. BC7, 16-bit float). Callers treat it as 'not supported here'
* rather than a data-corruption failure, so the scene pipeline never emits a
* partially decoded frame for it and falls back to the author preview (#906).
*/
var TexUnsupportedError = class extends Error {
	/** Raw TEXI0001 format id. */
	format;
	/** Human-readable name of the format id, or 'unknown(N)'. */
	formatName;
	/** Declared TEXI0001 texture dimensions. */
	width;
	height;
	constructor(format, formatName, width, height) {
		super("tex: unsupported format " + format);
		this.name = "TexUnsupportedError";
		this.format = format;
		this.formatName = formatName;
		this.width = width;
		this.height = height;
	}
};
/** TEXI0001 flags bit marking an animated (sprite-sheet / gif) texture. */
const TEX_FLAG_IS_GIF = 4;
/** Decode uncompressed or filtered PNG image bytes into raw RGBA8888. */
function decodePngToRgba(pngBuf) {
	let pos = 8;
	let width = 0;
	let height = 0;
	let colorType = 0;
	const idatChunks = [];
	const view = new DataView(pngBuf.buffer, pngBuf.byteOffset, pngBuf.byteLength);
	while (pos < pngBuf.length) {
		const len = view.getUint32(pos, false);
		const type = String.fromCharCode(pngBuf[pos + 4], pngBuf[pos + 5], pngBuf[pos + 6], pngBuf[pos + 7]);
		const data = pngBuf.subarray(pos + 8, pos + 8 + len);
		if (type === "IHDR") {
			const ihdrView = new DataView(data.buffer, data.byteOffset, data.byteLength);
			width = ihdrView.getUint32(0, false);
			height = ihdrView.getUint32(4, false);
			colorType = data[9];
			if (width <= 0 || height <= 0 || width > MAX_TEX_DIMENSION || height > MAX_TEX_DIMENSION || width * height > MAX_TEX_PIXELS) throw new Error("png: invalid dimensions " + width + "x" + height);
		} else if (type === "IDAT") idatChunks.push(data);
		else if (type === "IEND") break;
		pos += 12 + len;
	}
	const totalIdat = idatChunks.reduce((acc, c) => acc + c.length, 0);
	if (totalIdat > MAX_DECOMPRESSED_BYTES) throw new Error("png: idat stream too large (" + totalIdat + " bytes)");
	const combined = new Uint8Array(totalIdat);
	let cur = 0;
	for (const c of idatChunks) {
		combined.set(c, cur);
		cur += c.length;
	}
	const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
	const stride = width * bytesPerPixel;
	const uncompressed = inflateSync(combined, { maxOutputLength: height * (1 + stride) + 64 });
	const raw = new Uint8Array(width * height * 4);
	let srcPos = 0;
	const rowBuf = new Uint8Array(stride);
	const prevRowBuf = new Uint8Array(stride);
	for (let y = 0; y < height; y++) {
		const filterType = uncompressed[srcPos++];
		for (let x = 0; x < stride; x++) {
			const b = uncompressed[srcPos++];
			const a = x >= bytesPerPixel ? rowBuf[x - bytesPerPixel] : 0;
			const c = x >= bytesPerPixel ? prevRowBuf[x - bytesPerPixel] : 0;
			const p_b = prevRowBuf[x];
			let val = b;
			if (filterType === 1) val = b + a & 255;
			else if (filterType === 2) val = b + p_b & 255;
			else if (filterType === 3) val = b + Math.floor((a + p_b) / 2) & 255;
			else if (filterType === 4) {
				const p = a + p_b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - p_b);
				const pc = Math.abs(p - c);
				let pr = a;
				if (pb < pa && pb < pc) pr = p_b;
				else if (pc < pa) pr = c;
				val = b + pr & 255;
			}
			rowBuf[x] = val;
		}
		prevRowBuf.set(rowBuf);
		for (let x = 0; x < width; x++) {
			const di = (y * width + x) * 4;
			if (colorType === 6) {
				raw[di] = rowBuf[x * 4];
				raw[di + 1] = rowBuf[x * 4 + 1];
				raw[di + 2] = rowBuf[x * 4 + 2];
				raw[di + 3] = rowBuf[x * 4 + 3];
			} else if (colorType === 2) {
				raw[di] = rowBuf[x * 3];
				raw[di + 1] = rowBuf[x * 3 + 1];
				raw[di + 2] = rowBuf[x * 3 + 2];
				raw[di + 3] = 255;
			} else {
				raw[di] = rowBuf[x];
				raw[di + 1] = rowBuf[x];
				raw[di + 2] = rowBuf[x];
				raw[di + 3] = 255;
			}
		}
	}
	return {
		width,
		height,
		rgba: raw
	};
}
const textDecoder = new TextDecoder("utf-8");
/**
* Bounds-checked little-endian binary reader. Every failed read throws an
* Error prefixed with the reader label (e.g. 'pkg: unexpected end of data').
*/
var Reader = class {
	data;
	label;
	view;
	pos = 0;
	constructor(data, label) {
		this.data = data;
		this.label = label;
		this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	}
	get remaining() {
		return this.view.byteLength - this.pos;
	}
	need(n) {
		if (n < 0 || this.pos + n > this.view.byteLength) throw new Error(this.label + ": unexpected end of data");
	}
	u8() {
		this.need(1);
		return this.view.getUint8(this.pos++);
	}
	i32() {
		this.need(4);
		const v = this.view.getInt32(this.pos, true);
		this.pos += 4;
		return v;
	}
	u32() {
		this.need(4);
		const v = this.view.getUint32(this.pos, true);
		this.pos += 4;
		return v;
	}
	/** Unsigned 64-bit integer; safe up to 2^53. */
	u64() {
		const lo = this.u32();
		return this.u32() * 4294967296 + lo;
	}
	f32() {
		this.need(4);
		const v = this.view.getFloat32(this.pos, true);
		this.pos += 4;
		return v;
	}
	bytes(n) {
		this.need(n);
		const out = this.data.subarray(this.pos, this.pos + n);
		this.pos += n;
		return out;
	}
	/** int32-length-prefixed UTF-8 string (PKG magic and entry paths). */
	sizedString(maxLength) {
		const length = this.i32();
		if (length < 0 || length > maxLength) throw new Error(this.label + ": invalid string length " + length);
		return textDecoder.decode(this.bytes(length));
	}
	/** NUL-terminated string (all TEX magics and the TEXB0004 json blob). */
	nstring(maxLength) {
		const start = this.pos;
		let end = start;
		const limit = Math.min(this.view.byteLength, start + maxLength);
		while (end < limit && this.view.getUint8(end) !== 0) end++;
		if (end >= limit) throw new Error(this.label + ": unterminated string");
		const out = textDecoder.decode(this.data.subarray(start, end));
		this.pos = end + 1;
		return out;
	}
};
/**
* Decompress one raw LZ4 block (the format inside PKG entry chains and TEXB
* mipmaps) following the official lz4 block format specification.
*
* @param src compressed block bytes
* @param dstSize exact expected decompressed size
*/
function lz4DecompressBlock(src, dstSize) {
	if (dstSize < 0 || dstSize > MAX_DECOMPRESSED_BYTES) throw new Error("lz4: decompressed size out of bounds (" + String(dstSize) + ")");
	const dst = new Uint8Array(dstSize);
	let ip = 0;
	let op = 0;
	while (ip < src.length) {
		const token = src[ip++];
		let literalLength = token >> 4;
		if (literalLength === 15) {
			let s = 0;
			do {
				if (ip >= src.length) throw new Error("lz4: truncated literal length");
				s = src[ip++];
				literalLength += s;
			} while (s === 255);
		}
		if (ip + literalLength > src.length || op + literalLength > dstSize) throw new Error("lz4: literal run out of bounds");
		dst.set(src.subarray(ip, ip + literalLength), op);
		ip += literalLength;
		op += literalLength;
		if (ip >= src.length) break;
		if (ip + 2 > src.length) throw new Error("lz4: truncated match offset");
		const offset = src[ip] | src[ip + 1] << 8;
		ip += 2;
		if (offset === 0 || offset > op) throw new Error("lz4: invalid match offset " + offset);
		let matchLength = token & 15;
		if (matchLength === 15) {
			let s = 0;
			do {
				if (ip >= src.length) throw new Error("lz4: truncated match length");
				s = src[ip++];
				matchLength += s;
			} while (s === 255);
		}
		matchLength += 4;
		if (op + matchLength > dstSize) throw new Error("lz4: match run out of bounds");
		for (let i = 0; i < matchLength; i++) {
			dst[op] = dst[op - offset];
			op++;
		}
	}
	if (op !== dstSize) throw new Error("lz4: decompressed size mismatch (got " + op + ", expected " + dstSize + ")");
	return dst;
}
/**
* Probe whether the entry data at [abs, abs+length) is an LZ4 block chain:
* int64 original size followed by [int32 uncomp][int32 comp][block] entries
* that reconstruct exactly originalSize bytes while consuming the entry to
* the byte. Returns the original size when the chain fits perfectly.
*/
function probeCompressedEntry(data, abs, length) {
	if (length < 8) return null;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const originalSize = view.getUint32(abs, true) + view.getUint32(abs + 4, true) * 4294967296;
	if (originalSize <= length || originalSize > 2147483647) return null;
	let pos = abs + 8;
	let total = 0;
	while (total < originalSize) {
		if (pos + 8 > abs + length) return null;
		const uncomp = view.getInt32(pos, true);
		const comp = view.getInt32(pos + 4, true);
		if (uncomp <= 0 || comp <= 0 || pos + 8 + comp > abs + length) return null;
		total += uncomp;
		pos += 8 + comp;
	}
	return total === originalSize && pos === abs + length ? originalSize : null;
}
/**
* Parse a PKG container (magic PKGVxxxx) and return its entry index.
* Entry offsets in the returned list are absolute positions inside data.
*/
function parsePkg(data) {
	const r = new Reader(data, "pkg");
	const magic = r.sizedString(32);
	if (!/^PKGV\d{4}$/.test(magic)) throw new Error("pkg: bad magic '" + magic + "'");
	const count = r.i32();
	if (count < 0 || count > 1048576) throw new Error("pkg: invalid entry count " + count);
	const index = [];
	for (let i = 0; i < count; i++) index.push({
		path: r.sizedString(1024),
		offset: r.u32(),
		length: r.u32()
	});
	const dataStart = r.pos;
	return index.map(({ path, offset, length }) => {
		const abs = dataStart + offset;
		if (abs + length > data.byteLength) throw new Error("pkg: entry '" + path + "' out of bounds");
		const originalSize = probeCompressedEntry(data, abs, length);
		return originalSize === null ? {
			path,
			offset: abs,
			compressedSize: length,
			size: length,
			flags: 0
		} : {
			path,
			offset: abs,
			compressedSize: length,
			size: originalSize,
			flags: 1
		};
	});
}
/**
* Extract (and decompress, when the entry uses LZ4 block-chain storage) one
* package entry. Returns a fresh buffer of exactly entry.size bytes.
*/
function readPkgEntry(data, entry) {
	const abs = entry.offset;
	if (abs < 0 || abs + entry.compressedSize > data.byteLength) throw new Error("pkg: entry '" + entry.path + "' out of bounds");
	if ((entry.flags & 1) === 0) return data.slice(abs, abs + entry.compressedSize);
	if (entry.size > MAX_PKG_ENTRY_BYTES) throw new Error("pkg: entry '" + entry.path + "' too large (" + entry.size + " bytes)");
	const r = new Reader(data.subarray(abs, abs + entry.compressedSize), "pkg");
	if (r.u64() !== entry.size) throw new Error("pkg: entry '" + entry.path + "' size mismatch");
	const out = new Uint8Array(entry.size);
	let written = 0;
	while (written < entry.size) {
		const uncomp = r.i32();
		const comp = r.i32();
		if (uncomp <= 0 || comp <= 0 || written + uncomp > entry.size) throw new Error("pkg: corrupt compressed entry '" + entry.path + "'");
		out.set(lz4DecompressBlock(r.bytes(comp), uncomp), written);
		written += uncomp;
	}
	if (r.remaining !== 0) throw new Error("pkg: corrupt compressed entry '" + entry.path + "'");
	return out;
}
function readMipmap(r, containerVersion) {
	if (containerVersion === 4) {
		const param1 = r.i32();
		const param2 = r.i32();
		r.nstring(1 << 20);
		const param3 = r.i32();
		if (param1 !== 1 || param2 !== 2 || param3 !== 1) throw new Error("tex: bad TEXB0004 mipmap params");
	}
	const width = r.i32();
	const height = r.i32();
	if (width <= 0 || height <= 0 || width > 16384 || height > 16384) throw new Error("tex: invalid mipmap dimensions " + width + "x" + height);
	if (containerVersion === 1) return {
		width,
		height,
		bytes: r.bytes(r.i32())
	};
	const isLz4 = r.i32() === 1;
	const decompressedCount = r.i32();
	const stored = r.bytes(r.i32());
	if (isLz4) return {
		width,
		height,
		bytes: lz4DecompressBlock(stored, decompressedCount)
	};
	return {
		width,
		height,
		bytes: stored
	};
}
/** Parse a TEX container into metadata plus the first image's mipmaps. */
function parseTexInternal(data) {
	const r = new Reader(data, "tex");
	const magic1 = r.nstring(16);
	if (magic1 !== "TEXV0005") throw new Error("tex: bad magic '" + magic1 + "'");
	const magic2 = r.nstring(16);
	if (magic2 !== "TEXI0001") throw new Error("tex: bad image-info magic '" + magic2 + "'");
	const format = r.i32();
	const flags = r.i32();
	const textureWidth = r.i32();
	const textureHeight = r.i32();
	const imageWidth = r.i32();
	const imageHeight = r.i32();
	r.u32();
	if (TEX_FORMAT_NAMES[format] === void 0) throw new TexUnsupportedError(format, "unknown(" + format + ")", textureWidth, textureHeight);
	const containerMagic = r.nstring(16);
	const containerMatch = /^TEXB000([1-4])$/.exec(containerMagic);
	if (!containerMatch) throw new Error("tex: bad mipmap container magic '" + containerMagic + "'");
	let containerVersion = Number(containerMatch[1]);
	const imageCount = r.i32();
	if (imageCount <= 0 || imageCount > 256) throw new Error("tex: invalid image count " + imageCount);
	let isVideoMp4 = false;
	if (containerVersion === 3) r.i32();
	else if (containerVersion === 4) {
		const freeImageFormat = r.i32();
		isVideoMp4 = r.i32() === 1;
		if (!(freeImageFormat === -1 && isVideoMp4)) containerVersion = 3;
	}
	let firstImage = null;
	for (let i = 0; i < imageCount; i++) {
		const mipmapCount = r.i32();
		if (mipmapCount <= 0 || mipmapCount > 32) throw new Error("tex: invalid mipmap count " + mipmapCount);
		const mipmaps = [];
		for (let j = 0; j < mipmapCount; j++) mipmaps.push(readMipmap(r, containerVersion));
		if (firstImage === null) firstImage = mipmaps;
	}
	const isAnimatedGif = (flags & TEX_FLAG_IS_GIF) !== 0;
	const frames = [];
	if (isAnimatedGif) {
		const frameMagic = r.nstring(16);
		const frameMatch = /^TEXS000([1-3])$/.exec(frameMagic);
		if (!frameMatch) throw new Error("tex: bad frame container magic '" + frameMagic + "'");
		const frameVersion = Number(frameMatch[1]);
		const frameCount = r.i32();
		if (frameCount < 0 || frameCount > 4096) throw new Error("tex: invalid frame count " + frameCount);
		if (frameVersion === 3) {
			r.i32();
			r.i32();
		}
		for (let i = 0; i < frameCount; i++) {
			const imageId = r.i32();
			const frametime = r.f32();
			if (frameVersion === 1) {
				const x = r.i32();
				const y = r.i32();
				const width = r.i32();
				r.i32();
				r.i32();
				const height = r.i32();
				frames.push({
					framenumber: i,
					imageId,
					frametime,
					x,
					y,
					width,
					height
				});
			} else {
				const x = r.f32();
				const y = r.f32();
				const width = r.f32();
				r.f32();
				r.f32();
				const height = r.f32();
				frames.push({
					framenumber: i,
					imageId,
					frametime,
					x,
					y,
					width,
					height
				});
			}
		}
	}
	const mip0 = firstImage[0];
	if (!isVideoMp4 && mip0 && mip0.bytes && mip0.bytes.length >= 8) {
		const b = mip0.bytes;
		if (b[4] === 102 && b[5] === 116 && b[6] === 121 && b[7] === 112 || b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 24 && b[4] === 102 && b[5] === 116 && b[6] === 121 && b[7] === 112) isVideoMp4 = true;
	}
	return {
		format,
		flags,
		width: imageWidth > 0 ? imageWidth : textureWidth > 0 ? textureWidth : mip0.width,
		height: imageHeight > 0 ? imageHeight : textureHeight > 0 ? textureHeight : mip0.height,
		isAnimatedGif,
		isVideoMp4,
		frames,
		mipmaps: firstImage
	};
}
/**
* Parse a TEX container and return its metadata. Animated (gif) and embedded
* MP4 textures are recognized and exposed, never silently dropped.
*/
function parseTex(data) {
	const parsed = parseTexInternal(data);
	const info = {
		width: parsed.width,
		height: parsed.height,
		format: parsed.format,
		formatName: TEX_FORMAT_NAMES[parsed.format] ?? "unknown(" + parsed.format + ")",
		isAnimatedGif: parsed.isAnimatedGif,
		isVideoMp4: parsed.isVideoMp4,
		mipLevels: parsed.mipmaps.length
	};
	if (parsed.isAnimatedGif) info.frames = parsed.frames;
	return info;
}
function rgb565(value) {
	const r = value >> 11 & 31;
	const g = value >> 5 & 63;
	const b = value & 31;
	return [
		r << 3 | r >> 2,
		g << 2 | g >> 4,
		b << 3 | b >> 2
	];
}
/** Build the 4-color BC palette; three-color + transparent when DXT1 c0 <= c1. */
function buildColorPalette(c0, c1, fourColor) {
	const palette = /* @__PURE__ */ new Uint8Array(16);
	const [r0, g0, b0] = rgb565(c0);
	const [r1, g1, b1] = rgb565(c1);
	palette.set([
		r0,
		g0,
		b0,
		255
	], 0);
	palette.set([
		r1,
		g1,
		b1,
		255
	], 4);
	if (fourColor) {
		palette.set([
			(2 * r0 + r1) / 3 | 0,
			(2 * g0 + g1) / 3 | 0,
			(2 * b0 + b1) / 3 | 0,
			255
		], 8);
		palette.set([
			(r0 + 2 * r1) / 3 | 0,
			(g0 + 2 * g1) / 3 | 0,
			(b0 + 2 * b1) / 3 | 0,
			255
		], 12);
	} else {
		palette.set([
			(r0 + r1) / 2 | 0,
			(g0 + g1) / 2 | 0,
			(b0 + b1) / 2 | 0,
			255
		], 8);
		palette.set([
			0,
			0,
			0,
			0
		], 12);
	}
	return palette;
}
/**
* Shared BC1/BC2/BC3 block walker. Color data sits at block base +
* colorOffset; blockStride is 8 (BC1) or 16 (BC2/BC3). dxt1Alpha enables the
* three-color + transparent palette when c0 <= c1.
*/
function decodeColorBlocks(src, out, width, height, blockStride, colorOffset, dxt1Alpha) {
	const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
	const blocksX = Math.ceil(width / 4);
	const blocksY = Math.ceil(height / 4);
	for (let by = 0; by < blocksY; by++) for (let bx = 0; bx < blocksX; bx++) {
		const base = (by * blocksX + bx) * blockStride;
		const c0 = view.getUint16(base + colorOffset, true);
		const c1 = view.getUint16(base + colorOffset + 2, true);
		const palette = buildColorPalette(c0, c1, dxt1Alpha ? c0 > c1 : true);
		const indices = view.getUint32(base + colorOffset + 4, true);
		for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
			const x = bx * 4 + px;
			const y = by * 4 + py;
			if (x >= width || y >= height) continue;
			const selector = indices >> 2 * (py * 4 + px) & 3;
			const dst = (y * width + x) * 4;
			out[dst] = palette[selector * 4];
			out[dst + 1] = palette[selector * 4 + 1];
			out[dst + 2] = palette[selector * 4 + 2];
			out[dst + 3] = palette[selector * 4 + 3];
		}
	}
}
/** BC1 (DXT1): 8-byte blocks, 4x4 pixels, optional 1-bit alpha. */
function decodeDxt1(src, width, height) {
	const out = new Uint8Array(width * height * 4);
	decodeColorBlocks(src, out, width, height, 8, 0, true);
	return out;
}
/** BC2 (DXT3): 16-byte blocks, 4-bit explicit alpha + BC1-style color. */
function decodeDxt3(src, width, height) {
	const out = new Uint8Array(width * height * 4);
	decodeColorBlocks(src, out, width, height, 16, 8, false);
	const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
	const blocksX = Math.ceil(width / 4);
	const blocksY = Math.ceil(height / 4);
	for (let by = 0; by < blocksY; by++) for (let bx = 0; bx < blocksX; bx++) {
		const base = (by * blocksX + bx) * 16;
		const alphaLo = view.getUint32(base, true);
		const alphaHi = view.getUint32(base + 4, true);
		for (let i = 0; i < 16; i++) {
			const x = bx * 4 + i % 4;
			const y = by * 4 + (i / 4 | 0);
			if (x >= width || y >= height) continue;
			const nibble = i < 8 ? alphaLo >> 4 * i & 15 : alphaHi >> 4 * (i - 8) & 15;
			out[(y * width + x) * 4 + 3] = nibble * 17;
		}
	}
	return out;
}
/** BC3 (DXT5): 16-byte blocks, interpolated 3-bit alpha + BC1-style color. */
function decodeDxt5(src, width, height) {
	const out = new Uint8Array(width * height * 4);
	decodeColorBlocks(src, out, width, height, 16, 8, false);
	const blocksX = Math.ceil(width / 4);
	const blocksY = Math.ceil(height / 4);
	for (let by = 0; by < blocksY; by++) for (let bx = 0; bx < blocksX; bx++) {
		const base = (by * blocksX + bx) * 16;
		const a0 = src[base];
		const a1 = src[base + 1];
		const alphas = /* @__PURE__ */ new Uint8Array(8);
		alphas[0] = a0;
		alphas[1] = a1;
		if (a0 > a1) for (let k = 2; k < 8; k++) alphas[k] = ((8 - k) * a0 + (k - 1) * a1) / 7 | 0;
		else {
			for (let k = 2; k < 6; k++) alphas[k] = ((6 - k) * a0 + (k - 2) * a1) / 5 | 0;
			alphas[6] = 0;
			alphas[7] = 255;
		}
		let bits = src[base + 2] + src[base + 3] * 256 + src[base + 4] * 65536 + src[base + 5] * 16777216 + src[base + 6] * 4294967296 + src[base + 7] * 1099511627776;
		for (let i = 0; i < 16; i++) {
			const x = bx * 4 + i % 4;
			const y = by * 4 + (i / 4 | 0);
			const index = bits % 8;
			bits = Math.floor(bits / 8);
			if (x >= width || y >= height) continue;
			out[(y * width + x) * 4 + 3] = alphas[index];
		}
	}
	return out;
}
/**
* Decode the first (largest) mipmap of a TEX container to RGBA8888.
* Supports RGBA8888, R8, RG88 and DXT1/DXT3/DXT5; embedded MP4 textures and
* unknown formats throw a descriptive error instead of failing silently.
* WE pads mipmaps to power-of-two sizes (e.g. a 1920x1080 image stored in a
* 2048x2048 mip); the TEXI header's image rect is the real content, anchored
* top-left, so the result is cropped to it before returning.
*/
/** Crop the power-of-two padding: the TEXI image rect sits at the top-left of
* the stored mip (verified by render probe), anything beyond it is filler. */
function cropToImageRect(decoded, imageWidth, imageHeight) {
	const cropW = Math.min(imageWidth, decoded.width);
	const cropH = Math.min(imageHeight, decoded.height);
	if (cropW > 0 && cropH > 0 && (cropW < decoded.width || cropH < decoded.height)) {
		const cropped = new Uint8Array(cropW * cropH * 4);
		for (let y = 0; y < cropH; y++) cropped.set(decoded.rgba.subarray(y * decoded.width * 4, (y * decoded.width + cropW) * 4), y * cropW * 4);
		return {
			width: cropW,
			height: cropH,
			rgba: cropped
		};
	}
	return decoded;
}
function decodeTex(data) {
	const parsed = parseTexInternal(data);
	if (parsed.isVideoMp4) throw new Error("tex: video mp4 textures cannot be decoded to a static frame");
	const mip = parsed.mipmaps[0];
	if (isPngBuffer(mip.bytes)) return decodePngToRgba(mip.bytes);
	if (mip.bytes[0] === 255 && mip.bytes[1] === 216) {
		const jpeg = decode(Buffer$1.from(mip.bytes), { useTArray: true });
		const rgba = jpeg.data;
		return cropToImageRect({
			width: jpeg.width,
			height: jpeg.height,
			rgba
		}, parsed.width, parsed.height);
	}
	const { width, height, bytes } = mip;
	let decoded;
	switch (parsed.format) {
		case TexFormat.RGBA8888:
			if (bytes.length < width * height * 4) throw new Error("tex: mipmap size mismatch for RGBA8888 (actual " + bytes.length + " < expected " + width * height * 4 + ")");
			decoded = {
				width,
				height,
				rgba: bytes.slice(0, width * height * 4)
			};
			break;
		case TexFormat.R8: {
			if (bytes.length < width * height) throw new Error("tex: mipmap size mismatch for R8");
			const rgba = new Uint8Array(width * height * 4);
			for (let i = 0; i < width * height; i++) {
				rgba[i * 4] = bytes[i];
				rgba[i * 4 + 1] = bytes[i];
				rgba[i * 4 + 2] = bytes[i];
				rgba[i * 4 + 3] = 255;
			}
			decoded = {
				width,
				height,
				rgba
			};
			break;
		}
		case TexFormat.RG88: {
			if (bytes.length < width * height * 2) throw new Error("tex: mipmap size mismatch for RG88");
			const rgba = new Uint8Array(width * height * 4);
			for (let i = 0; i < width * height; i++) {
				rgba[i * 4] = bytes[i * 2];
				rgba[i * 4 + 1] = bytes[i * 2 + 1];
				rgba[i * 4 + 2] = 0;
				rgba[i * 4 + 3] = 255;
			}
			decoded = {
				width,
				height,
				rgba
			};
			break;
		}
		case TexFormat.DXT1: {
			const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
			if (bytes.length < expected) throw new Error("tex: mipmap size mismatch for DXT1");
			decoded = {
				width,
				height,
				rgba: decodeDxt1(bytes, width, height)
			};
			break;
		}
		case TexFormat.DXT3: {
			const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
			if (bytes.length < expected) throw new Error("tex: mipmap size mismatch for DXT3");
			decoded = {
				width,
				height,
				rgba: decodeDxt3(bytes, width, height)
			};
			break;
		}
		case TexFormat.DXT5: {
			const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
			if (bytes.length < expected) throw new Error("tex: mipmap size mismatch for DXT5");
			decoded = {
				width,
				height,
				rgba: decodeDxt5(bytes, width, height)
			};
			break;
		}
		default: throw new TexUnsupportedError(parsed.format, TEX_FORMAT_NAMES[parsed.format] ?? "unknown(" + parsed.format + ")", parsed.width, parsed.height);
	}
	return cropToImageRect(decoded, parsed.width, parsed.height);
}
const CRC_TABLE = (() => {
	const table = /* @__PURE__ */ new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();
function crc32(bytes) {
	let c = 4294967295;
	for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
	return (c ^ 4294967295) >>> 0;
}
function pngChunk(type, data) {
	const out = Buffer$1.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, "ascii");
	out.set(data, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}
/**
* Encode RGBA8888 pixels as a minimal PNG (8-bit RGBA, filter type 0) using
* node:zlib deflate and a hand-rolled CRC32. Zero dependencies.
*/
function encodePng(width, height, rgba) {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("png: invalid dimensions " + width + "x" + height);
	if (rgba.length !== width * height * 4) throw new Error("png: rgba buffer size mismatch");
	const stride = width * 4 + 1;
	const raw = Buffer$1.alloc(stride * height);
	for (let y = 0; y < height; y++) {
		raw[y * stride] = 0;
		raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
	}
	const ihdr = Buffer$1.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer$1.concat([
		Buffer$1.from([
			137,
			80,
			78,
			71,
			13,
			10,
			26,
			10
		]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(raw, { level: 9 })),
		pngChunk("IEND", Buffer$1.alloc(0))
	]);
}
/** Extract .tex candidate paths referenced by one scene.json image object. */
function collectImageObjectTextures(imageObject, readJson) {
	const out = [];
	const pushTextureList = (list) => {
		if (!Array.isArray(list)) return;
		for (const item of list) {
			const rawName = typeof item === "string" ? item : item && typeof item === "object" && typeof item.name === "string" ? item.name : item && typeof item === "object" && typeof item.file === "string" ? item.file : null;
			if (!rawName) continue;
			if (rawName.toLowerCase().endsWith(".tex")) out.push(rawName);
			else {
				out.push(rawName + ".tex");
				out.push("materials/" + rawName + ".tex");
			}
		}
	};
	const ref = imageObject.image;
	if (ref.toLowerCase().endsWith(".tex")) out.push(ref);
	else {
		let materialJson = readJson(ref);
		if (materialJson && typeof materialJson.material === "string") {
			const matRef = materialJson.material;
			materialJson = readJson(matRef) ?? readJson("materials/" + matRef);
		}
		if (materialJson && Array.isArray(materialJson.passes)) for (const pass of materialJson.passes) pushTextureList(pass?.textures);
	}
	const instance = imageObject.instance;
	if (instance && typeof instance === "object") pushTextureList(instance.textures);
	return out;
}
/** SceneAccess over a packed scene.pkg container (case-insensitive paths). */
function pkgSceneAccess(pkgData) {
	const entries = parsePkg(pkgData);
	const byPath = new Map(entries.map((entry) => [entry.path.toLowerCase(), entry]));
	const readFile = (path) => {
		const entry = byPath.get(path.toLowerCase());
		if (!entry) return null;
		return {
			path: entry.path,
			bytes: readPkgEntry(pkgData, entry)
		};
	};
	return {
		readJson: (path) => {
			const file = readFile(path);
			if (!file) return null;
			try {
				return JSON.parse(textDecoder.decode(file.bytes));
			} catch {
				return null;
			}
		},
		readFile,
		listTexPaths: () => entries.filter((entry) => entry.path.toLowerCase().endsWith(".tex")).map((entry) => entry.path)
	};
}
/**
* SceneAccess over a loose scene project directory (scene.json plus loose
* .tex/.json files, e.g. WE defaultprojects). Reads are fenced inside the
* directory; texture references escaping it resolve to null.
*/
function dirSceneAccess(dir) {
	const normDir = resolve(dir);
	const realDir = (() => {
		try {
			return realpathSync(normDir);
		} catch {
			return normDir;
		}
	})();
	const readFile = (path) => {
		const abs = resolve(normDir, path);
		if (abs !== normDir && !abs.startsWith(normDir + sep)) return null;
		try {
			if (lstatSync(abs).isSymbolicLink()) return null;
			if (!statSync(abs).isFile()) return null;
			const real = realpathSync(abs);
			if (real !== realDir && !real.startsWith(realDir + sep)) return null;
			return {
				path,
				bytes: new Uint8Array(readFileSync(real))
			};
		} catch {
			return null;
		}
	};
	const listTexPaths = () => {
		const out = [];
		const walk = (sub, depth) => {
			if (depth > 4) return;
			let names = [];
			try {
				names = readdirSync(sub === "" ? normDir : join(normDir, sub));
			} catch {
				return;
			}
			for (const name of names) {
				const rel = sub === "" ? name : sub + "/" + name;
				let isDir = false;
				let isFile = false;
				try {
					const lst = lstatSync(join(normDir, rel));
					if (lst.isSymbolicLink()) continue;
					isDir = lst.isDirectory();
					isFile = lst.isFile();
				} catch {
					continue;
				}
				if (isDir) walk(rel, depth + 1);
				else if (isFile && name.toLowerCase().endsWith(".tex")) out.push(rel);
			}
		};
		walk("", 0);
		return out;
	};
	return {
		readJson: (path) => {
			const file = readFile(path);
			if (!file) return null;
			try {
				return JSON.parse(textDecoder.decode(file.bytes));
			} catch {
				return null;
			}
		},
		readFile,
		listTexPaths
	};
}
function isPngBuffer(buf) {
	return buf.length >= 8 && buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71 && buf[4] === 13 && buf[5] === 10 && buf[6] === 26 && buf[7] === 10;
}
function isLikelyMaskOrHelper(path) {
	const lower = path.toLowerCase();
	return lower.includes("/masks/") || lower.includes("_mask") || lower.includes("mask") || lower.includes("flow") || lower.includes("wave") || lower.includes("noise") || lower.includes("lut") || lower.includes("distort") || lower.includes("warp") || lower.includes("vortex") || lower.includes("glow") || lower.includes("neon") || lower.includes("strip") || lower.includes("bulb") || lower.includes("led") || lower.includes("combined") || lower.includes("isometric") || lower.includes("razer") || lower.includes("len") || lower.includes("lens") || lower.includes("flare") || lower.includes("prism") || lower.includes("diffract") || lower.includes("black") || lower.includes("overlay") || lower === "sun" || lower.endsWith("/sun.tex") || lower.endsWith("/sun.json") || lower.endsWith("/sun") || lower.includes("waterripple") || lower.includes("waterflow") || lower.includes("phase") || lower.includes("normal") || lower.includes("foliagesway") || lower.includes("cursorripple") || lower.includes("赞助") || lower.includes("sponsor") || lower.includes("donate") || lower.includes("qrcode") || lower.includes("qr_code") || lower.includes("audio_bar") || lower.includes("audiobar") || lower.includes("simple_audio") || lower.includes("提示框") || lower.includes("tip") || lower.includes("watermark") || lower.includes("logo") || lower.includes("particle") || lower.includes("audio") || lower.includes("lightmap") || lower.includes("light_map") || lower.includes("visso") || lower.includes("font") || lower.includes("text_");
}
function hasContent(rgba, width, height) {
	const totalPixels = width * height;
	const step = Math.max(1, Math.floor(totalPixels / 1e3));
	let visibleCount = 0;
	let sampleCount = 0;
	for (let i = 0; i < totalPixels; i += step) {
		sampleCount++;
		const idx = i * 4;
		const r = rgba[idx];
		const g = rgba[idx + 1];
		const b = rgba[idx + 2];
		if (rgba[idx + 3] > 10 && (r > 0 || g > 0 || b > 0)) visibleCount++;
	}
	return sampleCount === 0 || visibleCount / sampleCount >= .01;
}
/**
* Read the scene's declared projection size (the viewport the author
* designed the scene for). Scenes without an explicit projection default to
* null so the extractor keeps the texture's native dimensions.
*/
function sceneProjectionSize(scene) {
	const general = scene.general;
	const rawW = general?.orthogonalprojection?.width;
	const rawH = general?.orthogonalprojection?.height;
	const width = typeof rawW === "number" && Number.isFinite(rawW) && rawW > 0 ? Math.floor(rawW) : 0;
	const height = typeof rawH === "number" && Number.isFinite(rawH) && rawH > 0 ? Math.floor(rawH) : 0;
	if (width <= 0 || height <= 0) return null;
	return {
		width,
		height
	};
}
/**
* Center-crop RGBA pixels to the scene's projection aspect ratio (cover
* semantics). Scene textures are authored at the full projection canvas
* (e.g. 2048x2048) while the viewport is 16:9; returning the raw square
* makes the wallpaper stretch or crop wrongly on a widescreen display.
* Returns null when no projection is declared or the ratio already matches.
*/
function cropToProjection(rgba, width, height, projection) {
	if (!projection) return null;
	const sourceRatio = width / height;
	const targetRatio = projection.width / projection.height;
	if (Math.abs(sourceRatio - targetRatio) < .005) return null;
	let outWidth = width;
	let outHeight = height;
	if (sourceRatio > targetRatio) {
		outWidth = Math.floor(height * targetRatio);
		if (outWidth >= width) return null;
	} else {
		outHeight = Math.floor(width / targetRatio);
		if (outHeight >= height) return null;
	}
	const startX = Math.max(0, Math.floor((width - outWidth) / 2));
	const startY = Math.max(0, Math.floor((height - outHeight) / 2));
	const out = new Uint8Array(outWidth * outHeight * 4);
	for (let y = 0; y < outHeight; y++) {
		const srcStart = ((startY + y) * width + startX) * 4;
		out.set(rgba.subarray(srcStart, srcStart + outWidth * 4), y * outWidth * 4);
	}
	return {
		width: outWidth,
		height: outHeight,
		rgba: out
	};
}
function getTextureScore(path) {
	const lower = path.toLowerCase();
	if (isLikelyMaskOrHelper(path)) return -100;
	let score = 0;
	if (lower.includes("白天") || lower.includes("day") || lower.includes("main") || lower.includes("background") || lower.includes("wallpaper")) score += 50;
	if (lower.includes("清晨") || lower.includes("morning") || lower.includes("黄昏") || lower.includes("dusk")) score += 20;
	if (lower.includes("昼夜变化") || lower.includes("mddn") || lower.includes("transition")) score -= 30;
	return score;
}
/** Composite layered 2D sprite scenes into a single full-resolution frame.
* Rejects the composite when the scene's top-ranked texture (the intended
* main art) is not among the decoded layers — e.g. an unsupported BC7 main
* texture — so the caller falls back to the per-candidate path and the
* author preview instead of emitting a partial frame (#906). */
function tryCompositeMultiLayerScene(scene, access, topCandidate) {
	const objects = Array.isArray(scene.objects) ? scene.objects : [];
	const imageObjects = objects.filter((obj) => obj && typeof obj === "object" && typeof obj.image === "string" && !String(obj.image).startsWith("models/util/") && !isLikelyMaskOrHelper(String(obj.image)));
	if (imageObjects.length <= 1) return null;
	let canvasWidth = 1920;
	let canvasHeight = 1080;
	const layers = [];
	const layerSources = [];
	let hasLargeBase = false;
	for (const obj of objects) {
		if (!obj.image || typeof obj.image !== "string" || obj.image.startsWith("models/util/")) continue;
		if (obj.visible && typeof obj.visible === "object" && obj.visible.value === false) continue;
		if (typeof obj.name === "string") {
			const nameLower = obj.name.toLowerCase();
			if (nameLower.includes("black") || nameLower.includes("len") || nameLower.includes("util") || nameLower.includes("flare") || nameLower.includes("blend") || nameLower === "sun" || nameLower === "sun2") continue;
		}
		if (isLikelyMaskOrHelper(obj.image)) continue;
		const modelJson = access.readJson(obj.image);
		if (!modelJson || typeof modelJson.material !== "string") continue;
		const matJson = access.readJson(modelJson.material);
		if (!matJson || !Array.isArray(matJson.passes)) continue;
		const texName = matJson.passes[0]?.textures?.[0];
		if (!texName || isLikelyMaskOrHelper(texName)) continue;
		const texPath = access.listTexPaths().find((p) => p.toLowerCase() === texName.toLowerCase() || p.toLowerCase() === ("materials/" + texName + ".tex").toLowerCase() || p.toLowerCase() === (texName + ".tex").toLowerCase() || p.toLowerCase().endsWith("/" + texName.toLowerCase() + ".tex") || p.toLowerCase().endsWith("/" + texName.toLowerCase()));
		if (!texPath) continue;
		const file = access.readFile(texPath);
		if (!file) continue;
		let decoded = null;
		try {
			decoded = decodeTex(file.bytes);
		} catch {
			continue;
		}
		if (!decoded || decoded.width < 64 || decoded.height < 64) continue;
		if (decoded.width >= 1280 || decoded.height >= 720) hasLargeBase = true;
		if (decoded.width > canvasWidth || decoded.height > canvasHeight) {
			canvasWidth = Math.max(canvasWidth, decoded.width);
			canvasHeight = Math.max(canvasHeight, decoded.height);
		}
		let ox = 0;
		let oy = 0;
		if (typeof modelJson.cropoffset === "string") {
			const parts = modelJson.cropoffset.trim().split(/\s+/);
			ox = parseFloat(parts[0]) || 0;
			oy = parseFloat(parts[1]) || 0;
		}
		const centerX = canvasWidth / 2 + ox;
		const centerY = canvasHeight / 2 - oy;
		const startX = Math.round(centerX - decoded.width / 2);
		const startY = Math.round(centerY - decoded.height / 2);
		layers.push({
			x: startX,
			y: startY,
			width: decoded.width,
			height: decoded.height,
			rgba: decoded.rgba
		});
		layerSources.push(texPath);
	}
	if (imageObjects.length >= 3 && layers.length <= 1) throw new Error("pkg: multi-layer scene composition requires full preview render");
	if (layers.length <= 1 || !hasLargeBase) return null;
	if (topCandidate !== null && !layerSources.some((p) => p.toLowerCase() === topCandidate.toLowerCase())) return null;
	const canvas = new Uint8Array(canvasWidth * canvasHeight * 4);
	for (const layer of layers) for (let y = 0; y < layer.height; y++) {
		const cy = layer.y + y;
		if (cy < 0 || cy >= canvasHeight) continue;
		for (let x = 0; x < layer.width; x++) {
			const cx = layer.x + x;
			if (cx < 0 || cx >= canvasWidth) continue;
			const si = (y * layer.width + x) * 4;
			const di = (cy * canvasWidth + cx) * 4;
			const sa = layer.rgba[si + 3] / 255;
			if (sa <= 0) continue;
			const da = canvas[di + 3] / 255;
			const outA = sa + da * (1 - sa);
			if (outA <= 0) continue;
			canvas[di] = Math.round((layer.rgba[si] * sa + canvas[di] * da * (1 - sa)) / outA);
			canvas[di + 1] = Math.round((layer.rgba[si + 1] * sa + canvas[di + 1] * da * (1 - sa)) / outA);
			canvas[di + 2] = Math.round((layer.rgba[si + 2] * sa + canvas[di + 2] * da * (1 - sa)) / outA);
			canvas[di + 3] = Math.round(outA * 255);
		}
	}
	return {
		width: canvasWidth,
		height: canvasHeight,
		png: Buffer$1.from(encodePng(canvasWidth, canvasHeight, canvas)),
		texturePath: "composite(" + String(layers.length) + " layers)"
	};
}
/** Shared scene pipeline over one access layer; label prefixes error text. */
function extractSceneMainImageVia(access, label) {
	let scene = access.readJson("scene.json");
	if (!scene) {
		const project = access.readJson("project.json");
		if (project && typeof project.file === "string" && project.file.endsWith(".json")) scene = access.readJson(project.file);
	}
	if (!scene || !Array.isArray(scene.objects)) throw new Error(label + ": scene.json not found or invalid");
	const projection = sceneProjectionSize(scene);
	if (scene.objects.some((obj) => obj && typeof obj === "object" && typeof obj.model === "string" && obj.model.length > 0)) throw new Error(label + ": 3D scene cannot be extracted as 2D frame");
	const rawCandidates = [];
	for (const obj of scene.objects) if (obj && typeof obj === "object" && typeof obj.image === "string") rawCandidates.push(...collectImageObjectTextures(obj, access.readJson));
	const allCandidates = [];
	for (const p of rawCandidates) if (!isLikelyMaskOrHelper(p) && !allCandidates.some((c) => c.path.toLowerCase() === p.toLowerCase())) allCandidates.push({
		path: p,
		fromObject: true
	});
	for (const p of access.listTexPaths()) if (!isLikelyMaskOrHelper(p) && !allCandidates.some((c) => c.path.toLowerCase() === p.toLowerCase())) allCandidates.push({
		path: p,
		fromObject: false
	});
	const ranked = allCandidates.map(({ path, fromObject }) => {
		let area = 0;
		try {
			const file = access.readFile(path);
			const info = file ? parseTex(file.bytes) : null;
			if (info) area = info.width * info.height;
		} catch {}
		return {
			path,
			score: getTextureScore(path) + (fromObject ? 100 : 0),
			area
		};
	});
	ranked.sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		return b.area - a.area;
	});
	const candidates = ranked.map((r) => r.path);
	if (candidates.length === 0) throw new Error(label + ": no texture candidates found");
	const composite = tryCompositeMultiLayerScene(scene, access, candidates[0] ?? null);
	if (composite !== null) return composite;
	let lastError = null;
	for (const path of candidates) {
		if (isLikelyMaskOrHelper(path)) continue;
		const file = access.readFile(path);
		if (!file) {
			if (lastError === null) lastError = /* @__PURE__ */ new Error(label + ": texture '" + path + "' not found in " + (label === "pkg" ? "package" : "directory"));
			continue;
		}
		try {
			const parsed = parseTexInternal(file.bytes);
			if (parsed.isVideoMp4) throw new Error("tex: video mp4 textures cannot be decoded to a static frame");
			const mip0 = parsed.mipmaps[0];
			if (isPngBuffer(mip0.bytes)) {
				const png = Buffer$1.from(mip0.bytes);
				if (projection) {
					const decoded = decodePngToRgba(mip0.bytes);
					const cropped = cropToProjection(decoded.rgba, decoded.width, decoded.height, projection);
					if (cropped) return {
						width: cropped.width,
						height: cropped.height,
						png: encodePng(cropped.width, cropped.height, cropped.rgba),
						texturePath: file.path
					};
				}
				return {
					width: mip0.width,
					height: mip0.height,
					png,
					texturePath: file.path
				};
			}
			const { width, height, rgba } = decodeTex(file.bytes);
			if (!hasContent(rgba, width, height)) {
				lastError = /* @__PURE__ */ new Error(label + ": texture '" + path + "' is a shader mask or partial layer");
				continue;
			}
			const cropped = cropToProjection(rgba, width, height, projection);
			if (cropped) return {
				width: cropped.width,
				height: cropped.height,
				png: encodePng(cropped.width, cropped.height, cropped.rgba),
				texturePath: file.path
			};
			return {
				width,
				height,
				png: encodePng(width, height, rgba),
				texturePath: file.path
			};
		} catch (err) {
			if (err instanceof TexUnsupportedError && path === candidates[0]) throw err;
			lastError = err;
		}
	}
	throw lastError instanceof Error ? lastError : /* @__PURE__ */ new Error(label + ": no decodable texture found");
}
function extractSceneMainImage(pkgData) {
	return extractSceneMainImageVia(pkgSceneAccess(pkgData), "pkg");
}
/**
* Loose-scene variant of extractSceneMainImage: decode the main texture of a
* scene project directory that ships scene.json and textures as plain files
* instead of a packed scene.pkg (#521).
*/
function extractSceneMainImageFromDir(dir) {
	return extractSceneMainImageVia(dirSceneAccess(dir), "scene");
}
/** Return an MP4 payload embedded in a TEX mipmap/file, if present. */
function embeddedMp4Bytes(raw) {
	for (let i = 0; i < 200 && i + 8 <= raw.length; i++) {
		if (raw[i] !== 102 || raw[i + 1] !== 116 || raw[i + 2] !== 121 || raw[i + 3] !== 112) continue;
		const ftypOffset = i - 4;
		if (ftypOffset >= 0 && ftypOffset < raw.length) return raw.slice(ftypOffset);
	}
	return null;
}
/** Find and extract the primary MP4 video embedded inside a scene's .tex textures. */
function extractSceneVideoVia(access) {
	const candidates = [];
	for (const path of access.listTexPaths()) {
		const file = access.readFile(path);
		if (!file) continue;
		const bytes = embeddedMp4Bytes(file.bytes);
		if (bytes !== null) candidates.push({
			path,
			score: getTextureScore(path),
			bytes
		});
	}
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => b.score - a.score);
	return candidates[0].bytes;
}
function extractSceneVideo(pkgData) {
	return extractSceneVideoVia(pkgSceneAccess(pkgData));
}
function extractSceneVideoFromDir(dir) {
	return extractSceneVideoVia(dirSceneAccess(dir));
}
function hasSceneVideo(pkgData) {
	try {
		return extractSceneVideo(pkgData) !== null;
	} catch {
		return false;
	}
}
function hasSceneVideoFromDir(dir) {
	try {
		return extractSceneVideoFromDir(dir) !== null;
	} catch {
		return false;
	}
}
const MDL_FLAG_NORMAL = 2;
const MDL_FLAG_TANGENT = 4;
const MDL_FLAG_UV2 = 32;
const MDL_FLAG_EXTRA4 = 65536;
const MDL_FLAG_SKIN_BLEND = 8388608;
const MDL_FLAG_SKIN_WEIGHT = 16777216;
/** Per-vertex byte stride for a mesh flag bitset; 0 when the flag is unusable. */
function mdlVertexStride(flag) {
	let s = 12;
	if (flag & MDL_FLAG_NORMAL) s += 12;
	if (flag & MDL_FLAG_TANGENT) s += 16;
	if (flag & MDL_FLAG_EXTRA4) s += 4;
	if (flag & MDL_FLAG_SKIN_BLEND) s += 16;
	if (flag & MDL_FLAG_SKIN_WEIGHT) s += 16;
	if (flag & 40) s += 8;
	if (flag & MDL_FLAG_UV2) s += 8;
	return s;
}
function readMdlCString(buf, p) {
	let end = p;
	while (end < buf.length && buf[end] !== 0) end++;
	if (end >= buf.length) return null;
	let str = "";
	for (let i = p; i < end; i++) str += String.fromCharCode(buf[i]);
	return {
		str,
		next: end + 1
	};
}
/**
* Parse a Wallpaper Engine MDLV .mdl file into renderable meshes.
*
* Structured layout (verified against MDLV0014+ files and the
* open-wallpaper-engine parser):
*   "MDLV####\0" tag, u32 mdl_flag, u32 skin_count, u32 mesh_count
*   per mesh: skin_count x cstr material path, u32 flag_a (extra u32 when 2),
*     aabb (6 f32, mdlv >= 17), u32 mesh_flag (mdlv > 14, else header flag),
*     u32 vertex_bytes, vertices, u32 indices_bytes, triangle indices
*     (u16, or u32 when mdlv >= 23 and vertex_count > 65535)
* Trailing MDLS/MDAT/MDLA/MDMP/MDLE puppet/animation blocks are not needed
* for static rendering and are ignored; skinned meshes stay in bind pose.
*/
function parseMdl(buf) {
	if (buf.length < 21) return [];
	if (String.fromCharCode(...buf.slice(0, 4)) !== "MDLV") return [];
	const mdlv = parseInt(String.fromCharCode(...buf.slice(4, 8)), 10);
	if (!Number.isFinite(mdlv) || mdlv < 1) return [];
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	let p = 9;
	const mdlFlag = dv.getUint32(p, true);
	p += 4;
	const skinCount = dv.getUint32(p, true);
	p += 4;
	const meshCount = dv.getUint32(p, true);
	p += 4;
	if (skinCount < 1 || skinCount > 64 || meshCount < 1 || meshCount > 1024) return [];
	const meshes = [];
	for (let m = 0; m < meshCount; m++) {
		const materials = [];
		for (let s = 0; s < skinCount; s++) {
			const cstr = readMdlCString(buf, p);
			if (!cstr) return meshes;
			materials.push(cstr.str);
			p = cstr.next;
		}
		if (p + 8 > buf.length) return meshes;
		const flagA = dv.getUint32(p, true);
		p += 4;
		if (flagA === 2) p += 4;
		if (mdlv >= 17) p += 24;
		let meshFlag = mdlFlag;
		if (mdlv > 14) {
			if (p + 8 > buf.length) return meshes;
			meshFlag = dv.getUint32(p, true);
			p += 4;
		}
		const vBytes = dv.getUint32(p, true);
		p += 4;
		const stride = mdlVertexStride(meshFlag);
		if (vBytes < stride || vBytes > 1e8 || vBytes % stride !== 0 || p + vBytes + 4 > buf.length) return meshes;
		const vCount = vBytes / stride;
		const pos = new Float32Array(vCount * 3);
		const norm = new Float32Array(vCount * 3);
		const uv = new Float32Array(vCount * 2);
		const uv2 = (meshFlag & MDL_FLAG_UV2) !== 0 ? new Float32Array(vCount * 2) : void 0;
		const hasNorm = (meshFlag & MDL_FLAG_NORMAL) !== 0;
		const hasUv = (meshFlag & 40) !== 0;
		for (let v = 0; v < vCount; v++) {
			pos[v * 3] = dv.getFloat32(p, true);
			pos[v * 3 + 1] = dv.getFloat32(p + 4, true);
			pos[v * 3 + 2] = dv.getFloat32(p + 8, true);
			p += 12;
			if (hasNorm) {
				norm[v * 3] = dv.getFloat32(p, true);
				norm[v * 3 + 1] = dv.getFloat32(p + 4, true);
				norm[v * 3 + 2] = dv.getFloat32(p + 8, true);
				p += 12;
			} else norm[v * 3 + 1] = 1;
			if (meshFlag & MDL_FLAG_TANGENT) p += 16;
			if (meshFlag & MDL_FLAG_EXTRA4) p += 4;
			if (meshFlag & MDL_FLAG_SKIN_BLEND) p += 16;
			if (meshFlag & MDL_FLAG_SKIN_WEIGHT) p += 16;
			if (hasUv) {
				uv[v * 2] = dv.getFloat32(p, true);
				uv[v * 2 + 1] = dv.getFloat32(p + 4, true);
				p += 8;
			}
			if (uv2) {
				uv2[v * 2] = dv.getFloat32(p, true);
				uv2[v * 2 + 1] = dv.getFloat32(p + 4, true);
				p += 8;
			}
		}
		if (p + 4 > buf.length) return meshes;
		const iBytes = dv.getUint32(p, true);
		p += 4;
		if (iBytes < 2 || iBytes > 6e7 || p + iBytes > buf.length) return meshes;
		const useU32 = vCount > 65535 && (mdlv >= 23 || iBytes % 12 === 0);
		const iCount = Math.floor(iBytes / (useU32 ? 4 : 2));
		let indices;
		if (useU32) {
			const arr = new Uint32Array(iCount);
			for (let i = 0; i < iCount; i++) arr[i] = dv.getUint32(p + i * 4, true);
			indices = arr;
		} else {
			const arr = new Uint16Array(iCount);
			for (let i = 0; i < iCount; i++) arr[i] = dv.getUint16(p + i * 2, true);
			indices = arr;
		}
		p += iBytes;
		meshes.push({
			vCount,
			iCount,
			pos,
			norm,
			uv,
			uv2,
			indices,
			materialPath: materials[0]
		});
	}
	return meshes;
}
function containsEmbeddedScript(value, seen = /* @__PURE__ */ new Set()) {
	if (value === null || typeof value !== "object") return false;
	if (seen.has(value)) return false;
	seen.add(value);
	if (!Array.isArray(value)) {
		const record = value;
		if (typeof record.script === "string" && record.script.trim() !== "") return true;
	}
	return Object.values(value).some((child) => containsEmbeddedScript(child, seen));
}
function buildSceneManifestVia(access, token, projectOverride) {
	let scene = access.readJson("scene.json");
	const project = projectOverride && typeof projectOverride === "object" ? projectOverride : access.readJson("project.json");
	if (!scene && project && typeof project.file === "string" && project.file.endsWith(".json")) scene = access.readJson(project.file);
	if (!scene || !Array.isArray(scene.objects)) return null;
	const general = scene.general;
	const projW = general?.orthogonalprojection?.width;
	const projH = general?.orthogonalprojection?.height;
	const width = typeof projW === "number" && Number.isFinite(projW) && projW > 0 ? Math.floor(projW) : 3840;
	const height = typeof projH === "number" && Number.isFinite(projH) && projH > 0 ? Math.floor(projH) : 2160;
	const resourceBase = "/api/skin-center/we/scene-resource/" + token + "/";
	const manifest = {
		width,
		height,
		hasMeteors: false,
		hasFireflies: false,
		scripted: containsEmbeddedScript(scene),
		layers: []
	};
	const allTex = access.listTexPaths();
	const parseVec3 = (val, def) => {
		if (typeof val === "string") {
			const parts = val.trim().split(/\s+/).map(parseFloat);
			if (parts.length >= 3 && !parts.some(isNaN)) return [
				parts[0],
				parts[1],
				parts[2]
			];
		}
		return def;
	};
	manifest.clearColor = parseVec3(general?.clearcolor, [
		.1,
		.1,
		.15
	]);
	manifest.ambientColor = parseVec3(general?.ambientcolor, [
		0,
		0,
		0
	]);
	manifest.skyLightColor = parseVec3(general?.skylightcolor, [
		0,
		0,
		0
	]);
	const pointLights = scene.objects.filter((obj) => obj.light === "point").slice(0, 4).map((obj) => {
		const intensity = typeof obj.intensity === "number" && Number.isFinite(obj.intensity) ? Math.max(0, obj.intensity) : 1;
		const color = parseVec3(obj.color, [
			1,
			1,
			1
		]);
		return {
			origin: parseVec3(obj.origin, [
				0,
				0,
				0
			]),
			color: color.map((channel) => channel * intensity),
			radius: typeof obj.radius === "number" && Number.isFinite(obj.radius) && obj.radius > 0 ? obj.radius : 1
		};
	});
	if (pointLights.length > 0) manifest.pointLights = pointLights;
	const props = (project?.general)?.properties;
	const propertyValue = (name) => props?.[name]?.value;
	const boundedHour = (name, fallback) => {
		const raw = propertyValue(name);
		const numeric = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
		return Number.isFinite(numeric) && numeric >= 0 && numeric < 24 ? numeric : fallback;
	};
	const timeVarying = propertyValue("timevarying") === true;
	const timePeriods = /* @__PURE__ */ new Set([
		"morning",
		"day",
		"dusk",
		"night",
		"mddn"
	]);
	if (timeVarying && scene.objects.some((obj) => timePeriods.has(String(obj.name).toLowerCase()))) manifest.timeSchedule = {
		morning: boundedHour("morningtime", 4),
		day: boundedHour("daytime", 8),
		dusk: boundedHour("dusktime", 17),
		night: boundedHour("nighttime", 20)
	};
	if (props?.schemecolor?.value && typeof props.schemecolor.value === "string") manifest.clearColor = parseVec3(props.schemecolor.value, [
		.57,
		.71,
		.81
	]);
	if (props?.carbodycolor?.value && typeof props.carbodycolor.value === "string") manifest.carBodyColor = parseVec3(props.carbodycolor.value, [
		1,
		0,
		0
	]);
	if (props?.carstripescolor?.value && typeof props.carstripescolor.value === "string") manifest.carStripesColor = parseVec3(props.carstripescolor.value, [
		0,
		0,
		0
	]);
	if (Boolean(scene.camera) || scene.objects.some((o) => typeof o.model === "string" && o.model.endsWith(".mdl"))) {
		manifest.is3D = true;
		const cam = scene.camera;
		let eye = parseVec3(cam?.eye, [
			0,
			1.5,
			4
		]);
		let center = parseVec3(cam?.center, [
			0,
			0,
			0
		]);
		let up = parseVec3(cam?.up, [
			0,
			1,
			0
		]);
		if (cam?.paths && Array.isArray(cam.paths) && typeof cam.paths[0] === "string") {
			const pathJson = access.readJson(cam.paths[0]);
			const firstTf = pathJson?.paths?.[0]?.transforms?.[0];
			if (firstTf) {
				if (firstTf.eye) eye = parseVec3(firstTf.eye, eye);
				if (firstTf.center) center = parseVec3(firstTf.center, center);
				if (firstTf.up) up = parseVec3(firstTf.up, up);
			}
			if (pathJson?.paths && pathJson.paths.length > 0) {
				manifest.cameraPaths = [];
				for (const seg of pathJson.paths) {
					if (!seg.transforms || seg.transforms.length < 2) continue;
					if (typeof seg.duration !== "number" || !Number.isFinite(seg.duration) || seg.duration <= 0) continue;
					const t0 = seg.transforms[0];
					const t1 = seg.transforms[seg.transforms.length - 1];
					manifest.cameraPaths.push({
						d: seg.duration,
						e0: parseVec3(t0.eye, eye),
						c0: parseVec3(t0.center, center),
						u0: parseVec3(t0.up, up),
						e1: parseVec3(t1.eye, eye),
						c1: parseVec3(t1.center, center),
						u1: parseVec3(t1.up, up)
					});
				}
				if (manifest.cameraPaths.length === 0) delete manifest.cameraPaths;
			}
		}
		const cameraFov = cam?.fov;
		const generalFov = general?.fov;
		const validFov = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 && value < 180;
		manifest.camera = {
			eye,
			center,
			up,
			fov: validFov(cameraFov) ? cameraFov : validFov(generalFov) ? generalFov : 50
		};
		if (cam && !(manifest.cameraPaths && manifest.cameraPaths.length > 0)) manifest.cameraStatic = true;
		manifest.models = [];
		for (const obj of scene.objects) {
			if (typeof obj.model !== "string" || !obj.model.endsWith(".mdl")) continue;
			const mdlFile = access.readFile(obj.model);
			if (!mdlFile) continue;
			const decodedMeshes = parseMdl(mdlFile.bytes);
			if (decodedMeshes.length === 0) continue;
			const baseName = obj.model.split("/").pop()?.replace(/\.mdl$/i, "");
			const resolveTexRef = (ref) => {
				const want = ref.toLowerCase().replace(/\.tex$/i, "");
				return allTex.find((p) => {
					const lower = p.toLowerCase().replace(/\.tex$/i, "");
					return lower === want || lower === "materials/" + want || lower.endsWith("/" + want);
				});
			};
			const meshes = decodedMeshes.map((m) => {
				let subTex;
				let shader;
				let additive;
				let noDepthTest;
				let noDepthWrite;
				let tint;
				let tint2;
				let texPath2;
				let lightmapPath;
				let translucent;
				let gradFade;
				let userColors;
				let userNums;
				if (m.materialPath) {
					try {
						const matJsonRaw = access.readJson(m.materialPath);
						const pass0 = Array.isArray(matJsonRaw?.passes) ? matJsonRaw.passes[0] : void 0;
						if (pass0) {
							if (typeof pass0.shader === "string") shader = pass0.shader;
							if (pass0.blending === "additive") additive = true;
							if (pass0.blending === "translucent") translucent = true;
							const combos = pass0.combos;
							if (combos && combos.GRADIENT_FADE) gradFade = true;
							const dt = pass0.depthtesting ?? pass0.depthtest;
							const dw = pass0.depthwriting ?? pass0.depthwrite;
							if (dt === "disabled") noDepthTest = true;
							if (dw === "disabled") noDepthWrite = true;
							if (Array.isArray(pass0.textures) && pass0.textures.length > 0) {
								const texturePaths = pass0.textures.map((texture) => resolveTexRef(String(texture)));
								subTex = texturePaths[0];
								if (texturePaths.length > 1) texPath2 = texturePaths[1];
								if (combos?.lightmap) lightmapPath = texturePaths[combos?.normalmap ? 2 : 1];
							}
							const usv = pass0.usershadervalues;
							if (usv) for (const [key, uniformName] of Object.entries(usv)) {
								if (typeof uniformName !== "string") continue;
								const pv = (props?.[key])?.value;
								if (typeof pv === "string") {
									const col = parseVec3(pv, [
										1,
										1,
										1
									]);
									if (uniformName === "tint") tint = col;
									else if (uniformName === "tint2") tint2 = col;
									userColors = userColors ?? {};
									userColors[uniformName] = col;
								} else if (typeof pv === "number" && Number.isFinite(pv)) {
									userNums = userNums ?? {};
									userNums[uniformName] = pv;
								}
							}
							const csv = pass0.constantshadervalues;
							if (csv) {
								for (const [key, val] of Object.entries(csv)) if (typeof val === "number" && Number.isFinite(val)) {
									userNums = userNums ?? {};
									userNums[key] = val;
								}
							}
						}
					} catch {}
					if (!subTex) {
						const matBaseName = m.materialPath.replace(/\.json$/i, "").split("/").pop();
						if (matBaseName) subTex = allTex.find((p) => {
							const lower = p.toLowerCase();
							return lower.includes(matBaseName.toLowerCase()) && !lower.includes("normal") && !lower.includes("mask");
						});
					}
				}
				if (!subTex && baseName) subTex = allTex.find((p) => p.toLowerCase().includes(baseName.toLowerCase()) && !p.toLowerCase().includes("normal") && !p.toLowerCase().includes("mask"));
				return {
					vCount: m.vCount,
					iCount: m.iCount,
					posB64: Buffer$1.from(m.pos.buffer, m.pos.byteOffset, m.pos.byteLength).toString("base64"),
					normB64: Buffer$1.from(m.norm.buffer, m.norm.byteOffset, m.norm.byteLength).toString("base64"),
					uvB64: Buffer$1.from(m.uv.buffer, m.uv.byteOffset, m.uv.byteLength).toString("base64"),
					uv2B64: m.uv2 ? Buffer$1.from(m.uv2.buffer, m.uv2.byteOffset, m.uv2.byteLength).toString("base64") : void 0,
					indicesB64: Buffer$1.from(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength).toString("base64"),
					idx32: m.indices instanceof Uint32Array || void 0,
					texUrl: subTex ? resourceBase + subTex : void 0,
					repeatBase: m.uv.some((value) => value < 0 || value > 1) || void 0,
					materialPath: m.materialPath,
					shader,
					additive,
					noDepthTest,
					noDepthWrite,
					tint,
					tint2,
					texUrl2: texPath2 ? resourceBase + texPath2 : void 0,
					lightmapUrl: lightmapPath ? resourceBase + lightmapPath : void 0,
					translucent,
					gradFade,
					userColors,
					userNums
				};
			});
			manifest.models.push({
				name: typeof obj.name === "string" ? obj.name : "model",
				origin: parseVec3(obj.origin, [
					0,
					0,
					0
				]),
				angles: parseVec3(obj.angles, [
					0,
					0,
					0
				]),
				scale: parseVec3(obj.scale, [
					1,
					1,
					1
				]),
				meshes
			});
		}
		for (const obj of scene.objects) {
			if (typeof obj.image === "string" && !obj.image.startsWith("models/util/")) {
				const layerJson = access.readJson(obj.image);
				if (layerJson?.fullscreen === true && typeof layerJson.material === "string") {
					const matJson = access.readJson(layerJson.material);
					const pass0 = Array.isArray(matJson?.passes) ? matJson.passes[0] : void 0;
					if (pass0) {
						let texPath;
						if (Array.isArray(pass0.textures)) for (const t of pass0.textures) {
							const ref = String(t);
							if (ref.startsWith("_rt_")) continue;
							const want = ref.toLowerCase().replace(/\.tex$/i, "");
							texPath = allTex.find((p) => {
								const lower = p.toLowerCase().replace(/\.tex$/i, "");
								return lower === want || lower === "materials/" + want || lower.endsWith("/" + want);
							});
							if (texPath) break;
						}
						const userColors = {};
						const userNums = {};
						const usv = pass0.usershadervalues;
						if (usv) for (const [key, uniformName] of Object.entries(usv)) {
							if (typeof uniformName !== "string") continue;
							const pv = props?.[key]?.value;
							if (typeof pv === "string") userColors[uniformName] = parseVec3(pv, [
								1,
								1,
								1
							]);
							else if (typeof pv === "number" && Number.isFinite(pv)) userNums[uniformName] = pv;
						}
						manifest.bgLayers = manifest.bgLayers ?? [];
						manifest.bgLayers.push({
							name: typeof obj.name === "string" ? obj.name : "fullscreen",
							shader: typeof pass0.shader === "string" ? pass0.shader : void 0,
							texUrl: texPath ? resourceBase + texPath : void 0,
							userColors: Object.keys(userColors).length > 0 ? userColors : void 0,
							userNums: Object.keys(userNums).length > 0 ? userNums : void 0
						});
					}
					continue;
				}
			}
			if (typeof obj.sprite === "string") {
				const spriteJson = access.readJson(obj.sprite);
				const pass0 = Array.isArray(spriteJson?.passes) ? spriteJson.passes[0] : void 0;
				let texPath;
				const texRef = Array.isArray(pass0?.textures) ? String(pass0.textures[0] ?? "") : "";
				if (texRef) {
					const want = texRef.toLowerCase().replace(/\.tex$/i, "");
					texPath = allTex.find((p) => {
						const lower = p.toLowerCase().replace(/\.tex$/i, "");
						return lower === want || lower === "materials/" + want || lower.endsWith("/" + want);
					});
				}
				manifest.sprites = manifest.sprites ?? [];
				manifest.sprites.push({
					name: typeof obj.name === "string" ? obj.name : "sprite",
					texUrl: texPath ? resourceBase + texPath : void 0,
					origin: parseVec3(obj.origin, [
						0,
						0,
						0
					]),
					scale: parseVec3(obj.scale, [
						1,
						1,
						1
					])
				});
			}
			if (typeof obj.particle === "string") {
				const pj = access.readJson(obj.particle);
				if (!pj) continue;
				const emitter = Array.isArray(pj.emitter) ? pj.emitter[0] : void 0;
				const init = Array.isArray(pj.initializer) ? pj.initializer : [];
				const byName = (n) => init.find((i) => i.name === n);
				const life = byName("lifetimerandom");
				const size = byName("sizerandom");
				const vel = byName("velocityrandom");
				const col = byName("colorrandom");
				let texPath;
				if (typeof pj.material === "string") {
					const matJson = access.readJson(pj.material);
					const pass0 = Array.isArray(matJson?.passes) ? matJson.passes[0] : void 0;
					const texRef = Array.isArray(pass0?.textures) ? String(pass0.textures[0] ?? "") : "";
					if (texRef) {
						const want = texRef.toLowerCase().replace(/\.tex$/i, "");
						texPath = allTex.find((p) => {
							const lower = p.toLowerCase().replace(/\.tex$/i, "");
							return lower === want || lower === "materials/" + want || lower.endsWith("/" + want);
						});
					}
				}
				const num = (v, d) => typeof v === "number" && Number.isFinite(v) ? v : d;
				const objOrigin = parseVec3(obj.origin, [
					0,
					0,
					0
				]);
				const emitterOrigin = parseVec3(emitter?.origin, [
					0,
					0,
					0
				]);
				manifest.particles3d = manifest.particles3d ?? [];
				manifest.particles3d.push({
					name: typeof obj.name === "string" ? obj.name : "particles",
					texUrl: texPath ? resourceBase + texPath : void 0,
					origin: [
						objOrigin[0] + emitterOrigin[0],
						objOrigin[1] + emitterOrigin[1],
						objOrigin[2] + emitterOrigin[2]
					],
					rate: num(emitter?.rate, 30),
					maxCount: num(pj.maxcount, 128),
					lifeMin: num(life?.min, 2),
					lifeMax: num(life?.max, 4),
					sizeMin: num(size?.min, .1),
					sizeMax: num(size?.max, .15),
					distMin: num(emitter?.distancemin, 2),
					distMax: num(emitter?.distancemax, 10),
					velMin: parseVec3(vel?.min, [
						0,
						0,
						-10
					]),
					velMax: parseVec3(vel?.max, [
						0,
						0,
						-20
					]),
					colorMin: parseVec3(col?.min, [
						200,
						200,
						200
					]).map((c) => c / 255),
					colorMax: parseVec3(col?.max, [
						255,
						255,
						255
					]).map((c) => c / 255)
				});
			}
		}
		if (manifest.models.length > 0) return manifest;
	}
	for (const obj of scene.objects) {
		const nameLower = (typeof obj.name === "string" ? obj.name : "").toLowerCase();
		if (nameLower.includes("star") || nameLower.includes("meteor")) manifest.hasMeteors = true;
		if (nameLower.includes("fireflies") || nameLower.includes("motes") || nameLower.includes("dust")) manifest.hasFireflies = true;
	}
	const meteorTexPath = allTex.find((p) => p.toLowerCase().includes("shootingstar") || p.toLowerCase().includes("meteor"));
	if (meteorTexPath) manifest.meteorTex = resourceBase + meteorTexPath;
	const sparkleTexPath = allTex.find((p) => p.toLowerCase().includes("sparkle") || p.toLowerCase().includes("halo") || p.toLowerCase().includes("star"));
	if (sparkleTexPath) manifest.sparkleTex = resourceBase + sparkleTexPath;
	const sceneObjects = scene.objects;
	const resolveObjectTransform = (obj) => {
		const chain = [obj];
		let cur = obj;
		while (cur.parent != null && chain.length <= 32) {
			const parent = sceneObjects.find((o) => o.id === cur.parent);
			if (!parent || chain.includes(parent)) break;
			chain.push(parent);
			cur = parent;
		}
		const root = chain[chain.length - 1];
		let origin = parseVec3(root.origin, [
			width / 2,
			height / 2,
			0
		]);
		let scale = parseVec3(root.scale, [
			1,
			1,
			1
		]);
		let angle = parseVec3(root.angles, [
			0,
			0,
			0
		])[2];
		for (let i = chain.length - 2; i >= 0; i--) {
			const localOrigin = parseVec3(chain[i].origin, [
				0,
				0,
				0
			]);
			const localScale = parseVec3(chain[i].scale, [
				1,
				1,
				1
			]);
			const localAngle = parseVec3(chain[i].angles, [
				0,
				0,
				0
			])[2];
			const c = Math.cos(angle);
			const s = Math.sin(angle);
			origin = [
				origin[0] + localOrigin[0] * scale[0] * c - localOrigin[1] * scale[1] * s,
				origin[1] + localOrigin[0] * scale[0] * s + localOrigin[1] * scale[1] * c,
				origin[2] + localOrigin[2] * scale[2]
			];
			scale = [
				scale[0] * localScale[0],
				scale[1] * localScale[1],
				scale[2] * localScale[2]
			];
			angle += localAngle;
		}
		return {
			origin,
			scale,
			angle
		};
	};
	const hasReflectionEffect = (obj) => (Array.isArray(obj.effects) ? obj.effects : []).some((e) => typeof e?.file === "string" && e.file.toLowerCase().includes("effects/reflection"));
	for (const obj of sceneObjects) {
		if (!obj.image || typeof obj.image !== "string" || obj.image.startsWith("models/util/")) {
			if (typeof obj.name === "string" && obj.name.toLowerCase() === "reflection" || hasReflectionEffect(obj)) {
				const reflTex = allTex.find((p) => p.toLowerCase().includes("reflection_mask"));
				if (reflTex) manifest.layers.push({
					name: "Reflection",
					isReflection: true,
					texUrl: resourceBase + reflTex,
					x: width / 2,
					y: height / 2,
					w: width,
					h: height
				});
			}
			continue;
		}
		if (obj.visible === false) continue;
		const nameLower = (typeof obj.name === "string" ? obj.name : "").toLowerCase();
		const isTimePeriodLayer = manifest.timeSchedule !== void 0 && timePeriods.has(nameLower);
		if (obj.visible && typeof obj.visible === "object" && obj.visible.value === false && !isTimePeriodLayer) continue;
		if (nameLower.includes("black") || nameLower.includes("len") || nameLower.includes("util") || nameLower.includes("flare") || nameLower.includes("blend") || nameLower === "sun" || nameLower === "sun2") continue;
		const modelJson = access.readJson(obj.image);
		if (!modelJson || typeof modelJson.material !== "string") continue;
		const matJson = access.readJson(modelJson.material);
		if (!matJson || !Array.isArray(matJson.passes)) continue;
		const pass0 = matJson.passes[0];
		const layerShader = typeof pass0?.shader === "string" ? pass0.shader : void 0;
		const texRefs = (Array.isArray(pass0?.textures) ? pass0.textures : []).map((t) => String(t)).filter((t) => !t.startsWith("_rt_"));
		if (texRefs.length === 0) continue;
		const texName = texRefs[0];
		if (layerShader !== "flowimage" && isLikelyMaskOrHelper(texName)) continue;
		const resolveLayerTex = (ref) => allTex.find((p) => p.toLowerCase() === ref.toLowerCase() || p.toLowerCase() === ("materials/" + ref + ".tex").toLowerCase() || p.toLowerCase() === (ref + ".tex").toLowerCase() || p.toLowerCase().endsWith("/" + ref.toLowerCase() + ".tex") || p.toLowerCase().endsWith("/" + ref.toLowerCase()));
		const texPath = resolveLayerTex(texName);
		if (!texPath) continue;
		const file = access.readFile(texPath);
		if (!file) continue;
		const texPaths = texRefs.map((ref) => resolveLayerTex(ref)).filter((p) => Boolean(p));
		const nums = {};
		const csv = pass0?.constantshadervalues;
		if (csv) {
			for (const [k, v] of Object.entries(csv)) if (typeof v === "number" && Number.isFinite(v)) nums[k] = v;
		}
		let layerUserColors;
		const lusv = pass0?.usershadervalues;
		if (lusv) for (const [key, uniformName] of Object.entries(lusv)) {
			if (typeof uniformName !== "string") continue;
			const pv = props?.[key]?.value;
			if (typeof pv === "string") {
				layerUserColors = layerUserColors ?? {};
				layerUserColors[uniformName] = parseVec3(pv, [
					1,
					1,
					1
				]);
			}
		}
		let decoded = null;
		try {
			decoded = decodeTex(file.bytes);
		} catch {
			decoded = null;
		}
		const resolvedTransform = resolveObjectTransform(obj);
		const objOrigin = [...resolvedTransform.origin];
		const objScale = resolvedTransform.scale;
		const objAngles = [
			0,
			0,
			resolvedTransform.angle
		];
		let lw = 0;
		let lh = 0;
		if (typeof modelJson.width === "number" && typeof modelJson.height === "number") {
			lw = modelJson.width;
			lh = modelJson.height;
		} else if (typeof obj.size === "string") {
			const parts = obj.size.trim().split(/\s+/).map(parseFloat);
			if (parts.length >= 2 && !parts.some(isNaN)) {
				lw = parts[0];
				lh = parts[1];
			}
		}
		if ((!lw || !lh) && decoded) {
			lw = decoded.width;
			lh = decoded.height;
		}
		if (!lw || !lh) continue;
		if (!decoded && !access.readFile(texPath)) continue;
		if (decoded && !modelJson.width && decoded.width < 64 && decoded.height < 64) continue;
		lw *= Math.abs(objScale[0]) || 1;
		lh *= Math.abs(objScale[1]) || 1;
		if (modelJson.fullscreen === true) {
			lw = width;
			lh = height;
			objOrigin[0] = width / 2;
			objOrigin[1] = height / 2;
			objAngles[2] = 0;
		}
		const alignment = typeof obj.alignment === "string" ? obj.alignment.toLowerCase() : "";
		let alignDx = 0;
		let alignDy = 0;
		if (alignment.includes("left")) alignDx = lw / 2;
		else if (alignment.includes("right")) alignDx = -lw / 2;
		if (alignment.includes("top")) alignDy = -lh / 2;
		else if (alignment.includes("bottom")) alignDy = lh / 2;
		let ox = 0;
		let oy = 0;
		if (typeof modelJson.cropoffset === "string") {
			const parts = modelJson.cropoffset.trim().split(/\s+/);
			ox = parseFloat(parts[0]) || 0;
			oy = parseFloat(parts[1]) || 0;
		}
		const alpha = typeof obj.alpha === "number" && Number.isFinite(obj.alpha) ? Math.min(1, Math.max(0, obj.alpha)) : 1;
		let videoUrl;
		try {
			if (parseTexInternal(file.bytes).isVideoMp4) videoUrl = resourceBase + texPath;
		} catch {}
		let uvCrop;
		if (decoded && typeof modelJson.width === "number" && typeof modelJson.height === "number") {
			const u0 = ox / decoded.width;
			const u1 = (ox + modelJson.width) / decoded.width;
			const v0 = oy / decoded.height;
			const v1 = (oy + modelJson.height) / decoded.height;
			if (u0 !== 0 || v0 !== 0 || u1 < .999 || v1 < .999) uvCrop = [
				u0,
				v0,
				u1,
				v1
			];
		}
		const isGround = nameLower.includes("land") || nameLower.includes("grass") || nameLower.includes("railing") || nameLower.includes("betong") || nameLower.includes("sign") || nameLower.includes("cabinet") || nameLower.includes("bush") || nameLower.includes("fence");
		const layerX = objOrigin[0] + alignDx;
		const layerY = objOrigin[1] + alignDy;
		if (hasReflectionEffect(obj) || nameLower === "reflection") {
			const reflTex = allTex.find((p) => p.toLowerCase().includes("reflection_mask"));
			if (reflTex) manifest.layers.push({
				name: "Reflection",
				isReflection: true,
				texUrl: resourceBase + reflTex,
				x: layerX,
				y: layerY,
				w: lw,
				h: lh,
				waterLine: Math.min(1, Math.max(0, 1 - (layerY + lh / 2) / height))
			});
		}
		manifest.layers.push({
			name: typeof obj.name === "string" ? obj.name : "layer",
			texUrl: resourceBase + texPath,
			x: layerX,
			y: layerY,
			w: lw,
			h: lh,
			alpha,
			angle: objAngles[2] || 0,
			uvCrop,
			shader: layerShader,
			texUrls: texPaths.length > 1 ? texPaths.map((p) => resourceBase + p) : void 0,
			userColors: layerUserColors,
			nums: Object.keys(nums).length > 0 ? nums : void 0,
			isGround,
			sway: 0,
			swaySpeed: 1.5,
			timePeriod: isTimePeriodLayer ? nameLower === "mddn" ? "manual" : nameLower : void 0,
			videoUrl
		});
	}
	if (manifest.layers.length === 0) return null;
	return manifest;
}
function extractSceneResourceVia(access, subpath) {
	const norm = subpath.replace(/\\/g, "/");
	const file = access.readFile(norm) || access.readFile("materials/" + norm) || access.readFile(norm + ".tex");
	if (!file) return null;
	try {
		const parsed = parseTexInternal(file.bytes);
		const mip0 = parsed.mipmaps[0];
		if (parsed.isVideoMp4) return embeddedMp4Bytes(file.bytes) ?? mip0.bytes;
		if (isPngBuffer(mip0.bytes)) return Buffer$1.from(mip0.bytes);
		const dec = decodeTex(file.bytes);
		return Buffer$1.from(encodePng(dec.width, dec.height, dec.rgba));
	} catch {
		return file.bytes;
	}
}
function buildSceneManifest(pkgData, token, project) {
	return buildSceneManifestVia(pkgSceneAccess(pkgData), token, project);
}
function buildSceneManifestFromDir(dir, token) {
	return buildSceneManifestVia(dirSceneAccess(dir), token);
}
function extractSceneResource(pkgData, subpath) {
	return extractSceneResourceVia(pkgSceneAccess(pkgData), subpath);
}
function extractSceneResourceFromDir(dir, subpath) {
	return extractSceneResourceVia(dirSceneAccess(dir), subpath);
}
//#endregion
//#region src/we-shim-source.ts
/**
* The Wallpaper Engine Web API shim, served to web-type wallpaper iframes.
*
* Web wallpapers are authored against APIs that Wallpaper Engine injects
* into its CEF host before the page scripts run: property listeners (user
* customization values), the audio-level listener (64 stereo bands), and
* LED/RGB hardware hooks. Inside the skin center there is no editor session
* and no hardware, so the shim installs benign defaults: user properties are
* seeded from the wallpaper's project.json defaults and delivered once the
* page registers its listener, the audio listener registers but is fed
* silence, and hardware APIs become no-ops. Wallpapers that never touch these
* APIs are unaffected; wallpapers that do degrade to their non-reactive
* visuals instead of crashing on undefined globals.
* @module @linxin666/dsh-client-ui-skin-center/we-shim-source
*/
/** The shim source, injected ahead of every web wallpaper HTML document. */
const WE_SHIM_JS = [
	"(function () {",
	"  if (window.__dshWeShim) return;",
	"  window.__dshWeShim = true;",
	"  var props = {};",
	"  var defaults = window.__dshWeDefaultProps || {};",
	"  for (var dk in defaults) { props[dk] = defaults[dk]; }",
	"  window.wallpaperPropertyListener = {",
	"    applyUserProperties: function (p) {",
	"      if (p && typeof p === \"object\") { for (var k in p) { props[k] = p[k]; } }",
	"    },",
	"    applyGeneralProperties: function () {},",
	"    setUserProperty: function (k, v) { props[k] = v; },",
	"    getUserProperty: function (k) { return props[k]; }",
	"  };",
	"  // WE delivers the property defaults once the page listener is in place.",
	"  // Wallpapers typically replace wallpaperPropertyListener with their own",
	"  // object; frameworks (Angular etc.) bootstrap asynchronously and may not",
	"  // survive property delivery before their services are ready, so deliver",
	"  // at a few staggered points after load.",
	"  var deliver = function () {",
	"    try {",
	"      var l = window.wallpaperPropertyListener;",
	"      if (l && typeof l.applyUserProperties === \"function\" && Object.keys(defaults).length) {",
	"        l.applyUserProperties(defaults);",
	"      }",
	"    } catch (e) {}",
	"  };",
	"  var kick = function () {",
	"    var delays = [800, 2000, 4000];",
	"    for (var di = 0; di < delays.length; di++) {",
	"      setTimeout(deliver, delays[di]);",
	"    }",
	"  };",
	"  if (document.readyState === 'complete') { kick(); }",
	"  else { window.addEventListener('load', kick); }",
	"  var audioListener = null;",
	"  window.wallpaperRegisterAudioListener = function (cb) {",
	"    if (typeof cb === \"function\") audioListener = cb;",
	"  };",
	"  // Silence buffer WE wallpapers expect: 64 bands x 2 channels.",
	"  var silence = [];",
	"  for (var i = 0; i < 128; i++) silence.push(0);",
	"  window.__dshWeAudio = {",
	"    listener: function () { return audioListener; },",
	"    silence: silence,",
	"    pump: function () { if (audioListener) { try { audioListener(silence); } catch (e) {} } }",
	"  };",
	"  window.wallpaperRegisterLEDColorListener = function () {};",
	"  window.wallpaperRegisterFPSListener = function () {};",
	"})();",
	""
].join("\n");
//#endregion
//#region src/we-player-source.ts
/**
* @license MIT
* Self-contained WebGL Scene Player runtime page for Wallpaper Engine scenes.
* Renders 2D layered scenes, post-processing shaders (reflection, waterwaves,
* foliagesway, tint), and GPU/CPU particle systems (shooting stars, fireflies).
*/
const WE_SCENE_PLAYER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>Wallpaper Engine Scene Player</title>
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
  }
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<script>
(function() {
  'use strict';

  const canvas = document.getElementById('canvas');
  const gl = canvas.getContext('webgl', { alpha: true, depth: true, antialias: true, premultipliedAlpha: false }) ||
             canvas.getContext('experimental-webgl', { alpha: true, depth: true });
  if (!gl) return;

  let sceneData = null;
  let isPaused = false;
  let contextLost = false;
  let fitMode = 'cover';
  let startTime = performance.now();
  let lastTime = performance.now();
  let textureCache = new Map();
  let videoTextureCache = new Map();
  let activeParticles = [];
  let mouseX = 0.5, mouseY = 0.5;
  let curRotX = 0, curRotY = 0;

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX / window.innerWidth;
    mouseY = e.clientY / window.innerHeight;
  });

  // 3D Shaders
  const vs3D = \`
    attribute vec3 a_pos;
    attribute vec3 a_norm;
    attribute vec2 a_uv;
    attribute vec2 a_uv2;
    uniform mat4 u_proj;
    uniform mat4 u_view;
    uniform mat4 u_model;
    uniform mat3 u_normMat;
    uniform float u_time;
    uniform int u_isJet;
    uniform int u_isAurora;
    uniform int u_isThunder;
    uniform int u_isBg;
    uniform int u_isNeonSun;
    varying vec3 v_norm;
    varying vec3 v_worldPos;
    varying vec2 v_uv;
    varying vec2 v_uv2;
    varying vec4 v_uv4;
    varying float v_alpha;
    void main() {
      v_uv = a_uv;
      v_uv2 = a_uv2;
      v_uv4 = a_uv.xyxy;
      v_alpha = 1.0;
      vec3 pos = a_pos;
      // WE ricepodjet shader: flame pulse along the jet cone.
      if (u_isJet == 1) {
        float outside = step(0.5, a_uv.x);
        float pulseSpeed = 5.0 + outside * 10.0;
        float pulseAmount = 1.0 - a_uv.y;
        float pulseStrong = sin(u_time * pulseSpeed);
        pos.xy *= mix(1.0, pulseStrong * 0.05 + 1.0, pulseAmount);
        pos.z += pulseAmount * (cos(u_time * pulseSpeed) * 0.02 + 0.02);
        v_alpha = pulseStrong * 0.25 + 0.75;
      }
      // WE ricepodorbitalaurora: swaying curtain with scrolled multi-sample UVs.
      if (u_isAurora == 1) {
        pos.x += sin(0.1 * u_time + a_uv.x * 5.0) * 0.05;
        pos.y += sin(0.1 * u_time + a_uv.x * 3.0) * 0.02;
        v_uv4.xy = a_uv;
        v_uv4.x *= 5.7;
        v_uv4.x += fract(u_time * 0.05);
        v_uv4.zw = a_uv.xx;
        v_uv4.z *= 0.5;
        v_uv4.w *= 8.3;
        v_uv4.z += fract(u_time * 0.04);
        v_uv4.w -= fract(u_time * 0.03);
        v_alpha = smoothstep(0.0, 0.1, a_uv.x) * smoothstep(1.0, 0.9, a_uv.x) * 0.6;
      }
      // WE ricepodorbitalthunder: sparkle cells with drifting sample offsets.
      if (u_isThunder == 1) {
        v_uv4.xy = a_uv * 0.777;
        v_uv4.wz = a_uv * 0.3; // wz swizzle: w = x*0.3, z = y*0.3
        v_uv4.z += sin((1.7 + u_time) * 0.1);
        v_uv4.w += cos(u_time * 0.22);
      }
      // WE bg.vert: fullscreen background quad, position from UV directly.
      if (u_isBg == 1) {
        v_uv4 = vec4(a_uv + u_time * 0.03, a_uv.x * 2.0 - u_time * 0.0111, a_uv.y * 2.0 - u_time * 0.0111);
        gl_Position = vec4(a_uv * 2.0 - 1.0, 0.5, 1.0);
        return;
      }
      // WE neonsun.vert: procedural sun, uv remapped to a small disc space.
      if (u_isNeonSun == 1) {
        v_uv = (a_uv * 2.0 - 1.0) * 0.3;
      }
      vec4 worldPos = u_model * vec4(pos, 1.0);
      v_worldPos = worldPos.xyz;
      v_norm = normalize(u_normMat * a_norm);
      gl_Position = u_proj * u_view * worldPos;
    }
  \`;

  const fs3D = \`
    precision mediump float;
    varying vec3 v_norm;
    varying vec3 v_worldPos;
    varying vec2 v_uv;
    varying vec2 v_uv2;
    varying vec4 v_uv4;
    varying float v_alpha;
    uniform sampler2D u_tex;
    uniform int u_hasTex;
    uniform int u_isCarBody;
    uniform int u_isGlass;
    uniform int u_isDome;
    uniform int u_isShadow;
    uniform int u_isGrid;
    uniform int u_isSkybox;
    uniform int u_isSelfIllum;
    uniform highp int u_isJet;
    uniform highp int u_isAurora;
    uniform highp int u_isThunder;
    uniform highp int u_isBg;
    uniform highp int u_isNeonSun;
    uniform int u_gradFade;
    uniform int u_sceneStd;
    uniform vec3 u_jetPos[4];
    uniform int u_jetCount;
    uniform vec3 u_color;
    uniform vec3 u_paintColor;
    uniform vec3 u_stripeColor;
    uniform vec3 u_ambientColor;
    uniform vec3 u_cameraPos;
    uniform vec3 u_lightDir;
    uniform float u_specStrength;
    uniform float u_specPower;
    uniform highp float u_time;
    uniform int u_hasTint;
    uniform vec3 u_tint;
    uniform vec3 u_tint2;
    uniform sampler2D u_tex2;
    uniform sampler2D u_lightmap;
    uniform int u_hasLightmap;
    uniform vec3 u_lightPos[4];
    uniform vec4 u_lightColorRadius[4];
    uniform int u_lightCount;
    uniform vec3 u_skyLightColor;
    uniform sampler2D u_reflTex;
    uniform vec2 u_resolution;
    uniform int u_hasReflTex;
    void main() {
      // Skybox: textured background sphere (no lighting)
      if (u_isSkybox == 1) {
        vec3 col = u_hasTex == 1 ? texture2D(u_tex, v_uv).rgb : u_ambientColor * 0.5;
        gl_FragColor = vec4(col, 1.0);
        return;
      }
      // Dome: gradient sphere background (car scenes)
      if (u_isDome == 1) {
        vec3 tint = u_ambientColor;
        float h = normalize(v_worldPos).y * 0.5 + 0.5;
        vec3 col = mix(tint * 0.35, tint, h);
        gl_FragColor = vec4(col, 1.0);
        return;
      }
      // Shadow: smooth radial gradient under car
      if (u_isShadow == 1) {
        float d = length(v_worldPos.xz);
        float radial = 1.0 - smoothstep(0.0, 1.8, d);
        float yFade = pow(clamp(1.0 - v_uv.y, 0.0, 1.0), 1.5);
        float a = radial * yFade * 0.65;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a);
        return;
      }
      // Grid floor: screen-space reflection from FBO
      if (u_isGrid == 1) {
        vec3 norm = normalize(v_norm);
        vec3 lightDir = normalize(u_lightDir);
        vec3 viewDir = normalize(u_cameraPos - v_worldPos);
        // Base grid color
        vec3 gridColor = u_ambientColor * 0.6;
        // Screen-space reflection from the mirrored-camera FBO
        vec3 reflColor = vec3(0.0);
        if (u_hasReflTex == 1) {
          vec2 screenUV = gl_FragCoord.xy / u_resolution;
          reflColor = texture2D(u_reflTex, screenUV).rgb;
        }
        // Distance-based fade for reflection
        float dist = length(v_worldPos.xz);
        float fade = 1.0 - smoothstep(0.0, 3.5, dist);
        // Fresnel for reflectivity at grazing angles
        float fresnel = 1.0 - max(dot(norm, viewDir), 0.0);
        fresnel = pow(fresnel, 2.0);
        // Specular highlight
        vec3 halfDir = normalize(lightDir + viewDir);
        float gridSpec = pow(max(dot(norm, halfDir), 0.0), 100.0) * 0.2;
        // Mix reflection with base color
        float reflStrength = fade * 0.55 + fresnel * 0.3;
        vec3 result = mix(gridColor, reflColor, reflStrength) + gridSpec;
        float alpha = 0.9 * fade + 0.1;
        gl_FragColor = vec4(result, alpha);
        return;
      }
      // Self-illuminated: emissive glow (jet engines, taillights with selfillum combo)
      if (u_isSelfIllum == 1) {
        vec3 col = u_hasTex == 1 ? texture2D(u_tex, v_uv).rgb : u_color;
        if (u_hasTint == 1) {
          // WE tinted-glow shaders (technoglow): pow falloff, scheme-color
          // tint, gentle pulse.
          float pulse = sin(u_time) * 0.25 + 0.75;
          col = col * col * u_tint * 3.0 * pulse;
          gl_FragColor = vec4(col, u_hasTex == 1 ? texture2D(u_tex, v_uv).a : 1.0);
        } else {
          gl_FragColor = vec4(col * 1.5, 1.0);
        }
        return;
      }
      // WE neonsun fragment: procedural retrowave sun (gradient disc, scanline
      // cutouts, glow halo). u_tint = colorsuntop, u_tint2 = colorsunbottom.
      if (u_isNeonSun == 1) {
        float sunSize = 0.05;
        float sunSizeSqrt = sqrt(sunSize);
        float blendSunColor = (v_uv.y + sunSize * 2.5) / sunSizeSqrt;
        vec4 colorSun = vec4(mix(u_tint, u_tint2, blendSunColor), 0.0);
        float sunRadius = dot(v_uv.xy, v_uv.xy);
        colorSun.a = 1.0 - step(0.05, sunRadius);
        float glowAlpha = pow(smoothstep(0.08, 0.045, sunRadius), 2.0);
        float barPos = v_uv.y + 0.1;
        float sunCutOut = 1.0 - clamp(smoothstep(0.0, 0.005, barPos) * smoothstep(1.0 - barPos * 9.0, 1.0 - barPos * 8.0, sin(barPos * 200.0 + u_time)), 0.0, 1.0);
        float sunCutOutSmooth = 1.0 - clamp(smoothstep(0.0, 0.05, barPos) * smoothstep(-1.0 - barPos * 8.0, 1.0 - barPos * 8.0, sin(barPos * 200.0 + u_time)), 0.0, 1.0);
        vec3 rgb = mix(u_tint2, colorSun.rgb, colorSun.a * sunCutOut);
        float sunA = max(glowAlpha * sunCutOutSmooth, colorSun.a * sunCutOut);
        gl_FragColor = vec4(rgb, sunA);
        return;
      }
      // WE ricepodjet fragment: flame texture fades along uv.y with pulse alpha.
      if (u_isJet == 1) {
        vec3 col = u_hasTex == 1 ? texture2D(u_tex, v_uv).rgb : u_color;
        col *= v_uv.y * v_alpha;
        gl_FragColor = vec4(col, 1.0);
        return;
      }
      // WE bg fragment: fullscreen tinted clouds + pattern background.
      if (u_isBg == 1) {
        float clouds = texture2D(u_tex, v_uv4.xy).a * texture2D(u_tex, v_uv4.zw).a * 1.4;
        clouds = clouds * clouds;
        float vignette = smoothstep(1.2, 0.0, length(v_uv - 0.5)) * 2.0;
        float pattern = texture2D(u_tex2, v_uv * 50.0).a * 0.1;
        pattern *= smoothstep(0.1, 0.7, length(v_uv - 0.5));
        vec3 albedo = mix(u_tint, u_tint2, v_uv.y * v_uv.y) * (clouds + pattern) * vignette;
        float bgAlpha = 1.0;
        if (u_gradFade == 1) {
          bgAlpha = smoothstep(0.2, 0.45, abs(v_uv.y - 0.5));
        }
        gl_FragColor = vec4(albedo, bgAlpha);
        return;
      }
      // WE ricepodorbitalaurora fragment: layered scrolling aurora curtains.
      if (u_isAurora == 1) {
        vec3 color = texture2D(u_tex, v_uv4.xy).rgb;
        vec3 color2 = texture2D(u_tex, v_uv4.wy).rgb;
        vec3 blend = texture2D(u_tex, v_uv4.zy).rgb;
        color = mix(color * color2, blend, blend.r);
        gl_FragColor = vec4(color, v_alpha);
        return;
      }
      // WE ricepodorbitalthunder fragment: sparkling blue cells.
      if (u_isThunder == 1) {
        float amt = texture2D(u_tex, v_uv4.xy).r;
        amt *= texture2D(u_tex, v_uv4.zw).r;
        vec3 color = mix(vec3(0.6, 0.5, 0.4), vec3(0.1, 0.3, 1.0), amt);
        gl_FragColor = vec4(color, amt);
        return;
      }

      vec4 baseColor = u_hasTex == 1 ? texture2D(u_tex, v_uv) : vec4(u_color, 1.0);
      float alpha = 1.0;

      // Car body paintwork: mix(paintColor, stripesColor, R) * G
      if (u_isCarBody == 1 && u_hasTex == 1) {
        vec3 bodyColor = mix(u_paintColor, u_stripeColor, baseColor.r) * baseColor.g;
        baseColor = vec4(bodyColor, 1.0);
      } else if (u_isGlass == 1) {
        alpha = u_hasTex == 1 ? baseColor.a * 0.6 : 0.3;
        baseColor.rgb = u_hasTex == 1 ? baseColor.rgb : vec3(0.15, 0.2, 0.28);
      }

      vec3 norm = normalize(v_norm);
      vec3 lightDir = normalize(u_lightDir);
      vec3 viewDir = normalize(u_cameraPos - v_worldPos);
      vec3 halfDir = normalize(lightDir + viewDir);

      if (u_sceneStd == 1) {
        // Wallpaper Engine generic.frag: authored point lights, black-capable
        // ambient/skylight, and the first light attenuated by the baked map.
        vec3 lighting = u_ambientColor;
        vec3 specularResult = vec3(0.0);
        for (int li = 0; li < 4; li++) {
          if (li < u_lightCount) {
            vec3 delta = u_lightPos[li] - v_worldPos;
            float distanceToLight = length(delta);
            vec3 pointDir = delta / max(distanceToLight, 0.0001);
            float attenuation = clamp((u_lightColorRadius[li].w - distanceToLight) / u_lightColorRadius[li].w, 0.0, 1.0);
            vec3 pointColor = u_lightColorRadius[li].rgb;
            float diffuse = max(dot(norm, pointDir), 0.0) * attenuation * attenuation;
            vec3 diffuseLight = pointColor * diffuse;
            if (li == 0 && u_hasLightmap == 1) {
              diffuseLight *= texture2D(u_lightmap, v_uv2).rgb;
            }
            lighting += diffuseLight;
            vec3 pointHalf = normalize(pointDir + viewDir);
            specularResult += pointColor * pow(max(dot(norm, pointHalf), 0.0), u_specPower) * u_specStrength * attenuation;
          }
        }
        lighting += max(dot(norm, vec3(0.0, -1.0, 0.0)), 0.0) * u_skyLightColor;
        float boostAmt = 0.0;
        for (int i = 0; i < 4; i++) {
          if (i < u_jetCount) {
            boostAmt += 1.0 - min(1.0, 2.0 * length(u_jetPos[i] - v_worldPos));
          }
        }
        vec3 boost = vec3(3.0, 1.2, 0.2) * boostAmt;
        gl_FragColor = vec4(baseColor.rgb * (lighting + boost) + specularResult, alpha);
        return;
      }

      // Key light (squared falloff for car, linear for generic)
      float NdotL = max(dot(norm, lightDir), 0.0);
      float lighting = u_isCarBody == 1 ? NdotL * NdotL * 0.9 : NdotL * 1.1;

      // Fill light from opposite side
      vec3 fillDir = normalize(vec3(-lightDir.x, 0.3, -lightDir.z));
      float fillNdotL = max(dot(norm, fillDir), 0.0);
      lighting += fillNdotL * 0.25;

      // Sky light from below for generic scenes
      float skyLight = max(dot(norm, vec3(0.0, -1.0, 0.0)), 0.0);
      lighting += skyLight * 0.15;

      // Rim light
      float rim = 1.0 - max(dot(norm, viewDir), 0.0);
      rim = pow(rim, 3.0) * 0.3;

      // Specular
      float specBase = max(dot(halfDir, norm), 0.0);
      float spec = pow(specBase, u_specPower);
      if (u_isCarBody == 1) {
        spec = spec * smoothstep(0.0, 0.1, sin(spec * 12.0));
      }
      float specular = spec * u_specStrength;

      // Ricepod shader: specular += pow(specBase, 25 + 100 * smoothstep(0.3, 0.15, color.r)) * 2
      // Generic scenes get extra specular for metallic look
      if (u_isCarBody == 0 && u_isGlass == 0) {
        float extraSpec = pow(specBase, 25.0 + 100.0 * smoothstep(0.3, 0.15, baseColor.r)) * 2.0;
        specular += extraSpec * u_specStrength;
      }

      vec3 result = (u_ambientColor * 0.5 + lighting) * baseColor.rgb + specular + rim * u_ambientColor * 0.5;

      gl_FragColor = vec4(result, alpha);
    }
  \`;

  // Vertex shader for basic 2D quads
  const vsBasic = \`
    attribute vec2 a_pos;
    attribute vec2 a_uv;
    uniform mat4 u_proj;
    uniform mat4 u_model;
    uniform vec4 u_uvRect;
    varying vec2 v_uv;
    void main() {
      v_uv = u_uvRect.xy + a_uv * (u_uvRect.zw - u_uvRect.xy);
      gl_Position = u_proj * u_model * vec4(a_pos, 0.0, 1.0);
    }
  \`;

  // Fragment shader for standard textures
  const fsBasic = \`
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform float u_alpha;
    uniform vec3 u_tint;
    uniform float u_bright;
    uniform float u_power;
    void main() {
      vec4 col = texture2D(u_tex, v_uv);
      col.rgb *= u_tint;
      col.rgb *= u_bright;
      col.rgb = pow(col.rgb, vec3(u_power));
      col.a *= u_alpha;
      gl_FragColor = col;
    }
  \`;

  // Fragment shader for water reflection
  const fsReflection = \`
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_fbo;
    uniform sampler2D u_mask;
    uniform float u_time;
    uniform float u_alpha;
    // Scene-uv rect of the reflection quad: (leftU, topV, scaleU, scaleV);
    // (0,0,1,1) for a fullscreen layer. Scene v grows downward (0 at the top).
    uniform vec4 u_rect;
    // Data-driven water surface from the scene object (legacy default 0.65).
    uniform float u_waterLine;
    // Reflection sample window: start + puddleDepth * span (legacy 0.42/0.38).
    uniform vec2 u_reflectRange;
    void main() {
      float mask = texture2D(u_mask, v_uv).r;
      vec2 sceneUv = u_rect.xy + v_uv * u_rect.zw;
      if (mask < 0.05 || sceneUv.y < u_waterLine) {
        discard;
      }
      float puddleDepth = (sceneUv.y - u_waterLine) / max(1.0 - u_waterLine, 0.0001);
      vec2 uvReflect = vec2(sceneUv.x, u_reflectRange.x + puddleDepth * u_reflectRange.y);
      // water wave ripple perturbation
      float wave = sin(v_uv.y * 120.0 + u_time * 2.8) * 0.002 +
                   cos(v_uv.x * 90.0 + u_time * 1.9) * 0.0015;
      uvReflect.x += wave * mask;
      uvReflect.y += wave * mask;
      vec4 reflected = texture2D(u_fbo, clamp(uvReflect, 0.0, 1.0));
      reflected.rgb *= vec3(0.70, 0.75, 0.90);
      gl_FragColor = vec4(reflected.rgb, mask * u_alpha * 0.28);
    }
  \`;

  // WE flag shader (TINT combo): rippling cloth via two scrolling normal
  // samples, region colors remapped through texture channels.
  const fsFlag = \`
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform sampler2D u_normal;
    uniform sampler2D u_cloth;
    uniform float u_time;
    uniform float u_speed;
    uniform float u_strength;
    uniform vec3 u_color1;
    uniform vec3 u_color2;
    uniform vec3 u_color3;
    void main() {
      vec2 nc1 = v_uv * vec2(1.0, 0.3) * 0.7;
      nc1.x -= u_time * u_speed;
      nc1.x -= ((0.5 - v_uv.x) * (1.0 - v_uv.y)) * 3.0;
      nc1.x += 2.0 * pow(v_uv.y - 0.1, 3.0) * pow(v_uv.x, 2.0);
      vec2 nc2 = v_uv * vec2(1.0, 0.7) * 0.3;
      nc2.x -= u_time * u_speed * 0.5;
      nc2.x -= ((1.0 - v_uv.x) * (1.0 - v_uv.y)) * 2.0;
      vec3 normal = texture2D(u_normal, nc1).rgb * 2.0 - 1.0;
      normal *= texture2D(u_normal, nc2).rgb * 2.0 - 1.0;
      normal = mix(vec3(0.0, 0.0, 1.0), normal, u_strength);
      normal = normalize(normal);
      vec2 baseCoords = v_uv + normal.xy * 0.02;
      vec3 albedo = texture2D(u_tex, baseCoords).rgb;
      float cloth = texture2D(u_cloth, baseCoords * 4.0).r;
      vec3 color = mix(u_color1, u_color2, albedo.r);
      color = mix(color, u_color3, albedo.g);
      color *= albedo.b * cloth;
      color += cloth * 0.1;
      float light = 0.2 + dot(vec3(0.707, 0.707, 0.0), normal) * 0.5 + 0.5;
      light += pow(light, 5.0) * 0.5;
      color *= light + light * clamp(cloth * 2.0 - 1.0, 0.0, 1.0);
      gl_FragColor = vec4(color, 1.0);
    }
  \`;

  // Fragment shader for particles
  const fsParticle = \`
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform vec4 u_color;
    void main() {
      vec4 tex = texture2D(u_tex, v_uv);
      gl_FragColor = tex * u_color;
    }
  \`;

  // WE flowimage shader: 3 content layers cross-faded while their UVs drift
  // along the flow mask (deep_space nebula background).
  const fsFlow = \`
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_mask;
    uniform sampler2D u_l1;
    uniform sampler2D u_l2;
    uniform sampler2D u_l3;
    uniform float u_time;
    uniform vec3 u_speeds;
    uniform float u_amp;
    uniform float u_bright;
    void main() {
      vec3 flowColors = texture2D(u_mask, v_uv).rgb;
      vec2 flowMask = (flowColors.rg - vec2(0.5, 0.5)) * 2.0;
      float c0 = fract(u_time * u_speeds.x);
      float c0b = fract(u_time * u_speeds.x + 0.5);
      float c1 = fract(u_time * u_speeds.y);
      float c1b = fract(u_time * u_speeds.y + 0.5);
      float c2 = fract(u_time * u_speeds.z);
      float c2b = fract(u_time * u_speeds.z + 0.5);
      float b0 = 2.0 * abs(c0 - 0.5);
      float b1 = 2.0 * abs(c1 - 0.5);
      float b2 = 2.0 * abs(c2 - 0.5);
      vec2 cuv = v_uv;
      vec4 albedo = mix(texture2D(u_l1, cuv + flowMask * u_amp * 0.1 * c0),
                        texture2D(u_l1, cuv + flowMask * u_amp * 0.1 * c0b), b0);
      vec4 s1 = mix(texture2D(u_l2, cuv + flowMask * u_amp * 0.1 * c1),
                    texture2D(u_l2, cuv + flowMask * u_amp * 0.1 * c1b), b1);
      albedo.rgb = mix(albedo.rgb, s1.rgb, s1.a);
      albedo.a = max(albedo.a, s1.a);
      vec4 s2 = mix(texture2D(u_l3, cuv + flowMask * u_amp * 0.1 * c2),
                    texture2D(u_l3, cuv + flowMask * u_amp * 0.1 * c2b), b2);
      albedo.rgb = mix(albedo.rgb, s2.rgb, s2.a);
      albedo.a = max(albedo.a, s2.a);
      albedo.rgb *= u_bright;
      gl_FragColor = albedo;
    }
  \`;

  function createShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('we-scene-player shader compile failed:', gl.getShaderInfoLog(s));
    }
    return s;
  }

  function createProgram(vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, createShader(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, createShader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('we-scene-player program link failed:', gl.getProgramInfoLog(p));
    }
    return p;
  }

  const progBasic = createProgram(vsBasic, fsBasic);
  const progReflection = createProgram(vsBasic, fsReflection);
  const progParticle = createProgram(vsBasic, fsParticle);
  const progFlow = createProgram(vsBasic, fsFlow);
  const progFlag = createProgram(vsBasic, fsFlag);
  const prog3D = createProgram(vs3D, fs3D);

  // Camera-facing 3D billboard (sun sprites, 3D particle streaks). The quad is
  // offset in view space along two CPU-computed axes so streaks can stretch
  // along the velocity direction (WE spritetrail renderer).
  const vsSprite = \`
    attribute vec2 a_corner;
    attribute vec2 a_uv;
    uniform mat4 u_proj;
    uniform mat4 u_view;
    uniform vec3 u_center;
    uniform vec2 u_axisX;
    uniform vec2 u_axisY;
    varying vec2 v_uv;
    void main() {
      v_uv = a_uv;
      vec4 centerView = u_view * vec4(u_center, 1.0);
      gl_Position = u_proj * vec4(centerView.xy + a_corner.x * u_axisX + a_corner.y * u_axisY, centerView.zw);
    }
  \`;
  const fsSprite = \`
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform int u_hasTex;
    uniform vec4 u_color;
    void main() {
      vec4 t = u_hasTex == 1 ? texture2D(u_tex, v_uv) : vec4(1.0);
      gl_FragColor = vec4(t.rgb * u_color.rgb, t.a * u_color.a);
    }
  \`;
  const progSprite = createProgram(vsSprite, fsSprite);

  // WE neongrid shader: procedural scrolling retrowave grid with fbm mountains.
  // Needs OES_standard_derivatives for the screen-space normal.
  const derivExt = gl.getExtension('OES_standard_derivatives');
  const vsNeonGrid = \`
    attribute vec3 a_pos;
    attribute vec2 a_uv;
    uniform mat4 u_proj;
    uniform mat4 u_view;
    uniform mat4 u_model;
    uniform float u_time;
    uniform float u_mountainScale;
    varying vec4 v_tc;
    varying vec4 v_vars;
    varying vec3 v_pos;
    float rand2(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }
    float noise2(vec2 p) {
      vec2 ip = floor(p);
      vec2 u = fract(p);
      u = u * u * (3.0 - 2.0 * u);
      float res = mix(mix(rand2(ip), rand2(ip + vec2(1.0, 0.0)), u.x), mix(rand2(ip + vec2(0.0, 1.0)), rand2(ip + vec2(1.0, 1.0)), u.x), u.y);
      return res * res;
    }
    float fbm(vec2 x) {
      float v = 0.0;
      float a = 0.5;
      vec2 shift = vec2(100.0);
      mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
      for (int i = 0; i < 5; ++i) {
        v += a * noise2(x);
        x = x * rot * 2.0 + shift;
        a *= 0.5;
      }
      return v;
    }
    void main() {
      v_vars = vec4(0.0);
      float speed = u_time * 2.0;
      vec3 localPos = a_pos;
      vec2 gridPos = floor(a_uv * 50.0 + vec2(0.0, speed));
      float dampenDistance = abs(a_uv.x * 2.0 - 1.0);
      float fallOffSides = pow(1.05 - dampenDistance, 0.5);
      float fallOffCenter = (0.2 + 0.8 * pow(dampenDistance, 2.0));
      float speedFrac = fract(speed) / 50.0;
      v_vars.x = a_uv.y - speedFrac;
      float dampenY = a_uv.y - speedFrac;
      float clipCenter = clamp(0.8 - dampenDistance, 0.0, 1.0);
      float offsetY = max(0.0, fbm(gridPos * 0.1) * 2.0 - clipCenter) * fallOffCenter * u_mountainScale;
      float maskUVSmoothing = step(0.005, offsetY);
      offsetY = offsetY * fallOffSides * dampenY + pow(dampenDistance, 2.0) * 0.02;
      localPos.z -= speedFrac * 2.0;
      localPos.y += offsetY;
      vec4 worldPos = u_model * vec4(localPos, 1.0);
      v_pos = worldPos.xyz;
      gl_Position = u_proj * u_view * worldPos;
      v_tc.xy = a_uv;
      v_tc.zw = a_uv * 50.0;
      float dampenUVSmoothing = clamp(abs(a_uv.x - 0.5) * 2.0 + maskUVSmoothing, 0.0, 1.0);
      v_vars.yz = vec2(0.45) - v_tc.y * vec2(0.05, 0.75 - dampenUVSmoothing * 0.7);
    }
  \`;
  const fsNeonGrid = (derivExt ? '#extension GL_OES_standard_derivatives : enable\\n' : '') + \`
    precision mediump float;
    varying vec4 v_tc;
    varying vec4 v_vars;
    varying vec3 v_pos;
    uniform vec3 u_gridNear;
    uniform vec3 u_gridFar;
    uniform vec3 u_gridBg;
    void main() {
      vec3 n = vec3(0.0, 1.0, 0.0);
      #ifdef GL_OES_standard_derivatives
      vec3 dx = dFdx(v_pos);
      vec3 dy = dFdy(v_pos);
      n = normalize(cross(dy, dx));
      #endif
      vec3 lightDir = normalize(vec3(0.0, -0.15, -2.0) - v_pos);
      vec2 grid = abs(fract(v_tc.zw) - 0.5);
      vec2 gridBlend = smoothstep(v_vars.yz, vec2(0.5), grid);
      float gridAlpha = gridBlend.x + gridBlend.y;
      gridBlend = smoothstep(vec2(0.0), vec2(1.0), grid);
      gridAlpha += (gridBlend.x + gridBlend.y) * clamp(0.3 - v_tc.y, 0.0, 1.0);
      float alphaDistanceFade = smoothstep(1.0, 0.9, v_vars.x);
      float colorDistanceBlend = pow(v_tc.y, 0.8);
      float shadingNear = dot(vec3(0.0, 0.0, 1.0), n);
      float shadingFar = dot(lightDir, n);
      vec3 shadingColor = clamp(shadingNear, 0.0, 1.0) * u_gridNear * (1.0 - colorDistanceBlend)
                        + clamp(shadingFar, 0.0, 1.0) * u_gridFar;
      vec3 colorGrid = u_gridBg + shadingColor;
      vec3 resultColor = mix(colorGrid, mix(u_gridNear, u_gridFar, colorDistanceBlend), gridAlpha * alphaDistanceFade);
      gl_FragColor = vec4(resultColor, alphaDistanceFade);
    }
  \`;
  const progNeonGrid = createProgram(vsNeonGrid, fsNeonGrid);

  function drawNeonGrid(model, mesh, proj, view, elapsed) {
    const uc = mesh.userColors || {};
    const un = mesh.userNums || {};
    gl.useProgram(progNeonGrid);
    gl.uniformMatrix4fv(gl.getUniformLocation(progNeonGrid, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(progNeonGrid, 'u_view'), false, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(progNeonGrid, 'u_model'), false, mat4Transform3D(model.origin, model.angles, model.scale));
    gl.uniform1f(gl.getUniformLocation(progNeonGrid, 'u_time'), elapsed);
    gl.uniform1f(gl.getUniformLocation(progNeonGrid, 'u_mountainScale'), un.mountainscale != null ? un.mountainscale : 1);
    const near = uc.gridnear || [1, 0, 0.2];
    const far = uc.gridfar || [0, 0, 1];
    const bgc = uc.gridbackground || [0.1, 0, 0.1];
    gl.uniform3f(gl.getUniformLocation(progNeonGrid, 'u_gridNear'), near[0], near[1], near[2]);
    gl.uniform3f(gl.getUniformLocation(progNeonGrid, 'u_gridFar'), far[0], far[1], far[2]);
    gl.uniform3f(gl.getUniformLocation(progNeonGrid, 'u_gridBg'), bgc[0], bgc[1], bgc[2]);
    const gpu = getGpuMesh(mesh);
    const gPos = gl.getAttribLocation(progNeonGrid, 'a_pos');
    const gUv = gl.getAttribLocation(progNeonGrid, 'a_uv');
    gl.enableVertexAttribArray(gPos);
    gl.enableVertexAttribArray(gUv);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
    gl.vertexAttribPointer(gPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uvBuf);
    gl.vertexAttribPointer(gUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.idxBuf);
    gl.drawElements(gl.TRIANGLES, gpu.iCount, gpu.idxType, 0);
  }

  // WE cloudsbg shader: fullscreen scrolling clouds + horizon glow.
  const vsCloudsBg = \`
    attribute vec2 a_corner;
    attribute vec2 a_uv;
    uniform float u_time;
    uniform float u_aspect;
    varying vec2 v_uv;
    varying vec4 v_tcClouds;
    void main() {
      gl_Position = vec4(a_corner * 2.0, 0.0, 1.0);
      v_uv = a_uv;
      v_tcClouds.xy = (a_uv + u_time * 0.0007) * vec2(1.1, 1.1);
      v_tcClouds.zw = (a_uv - u_time * 0.0011) * vec2(0.7, 0.7);
      v_tcClouds.xz *= u_aspect;
      v_tcClouds.zw = vec2(-v_tcClouds.w, v_tcClouds.z);
    }
  \`;
  const fsCloudsBg = \`
    precision mediump float;
    varying vec2 v_uv;
    varying vec4 v_tcClouds;
    uniform sampler2D u_tex;
    uniform int u_hasTex;
    uniform vec3 u_color1;
    uniform vec3 u_colorHorizon;
    void main() {
      float cloud0 = u_hasTex == 1 ? texture2D(u_tex, v_tcClouds.xy).r : 0.0;
      float cloud1 = u_hasTex == 1 ? texture2D(u_tex, v_tcClouds.zw).r : 0.0;
      float cloudBlend = cloud0 * cloud1;
      vec3 albedo = u_color1 * cloudBlend;
      albedo += (u_color1 * 0.5 + albedo) * pow(smoothstep(0.5, 0.0, v_uv.y), 2.0) * 2.0;
      float horizonBend = 1.0 - cos(clamp(v_uv.x * 2.0 - 0.5, 0.0, 1.0) * 2.0 * 3.14159265);
      vec2 horizonDelta = (v_uv - vec2(0.5, 0.6)) * vec2(0.5, 1.5 - horizonBend * 0.3);
      albedo += u_colorHorizon * pow(smoothstep(0.5, 0.0, length(horizonDelta)), 2.0) * 2.0;
      gl_FragColor = vec4(albedo, 1.0);
    }
  \`;
  const progCloudsBg = createProgram(vsCloudsBg, fsCloudsBg);

  function drawCloudsBgLayer(layer, elapsed, width, height) {
    gl.useProgram(progCloudsBg);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
    const cPos = gl.getAttribLocation(progCloudsBg, 'a_corner');
    const cUv = gl.getAttribLocation(progCloudsBg, 'a_uv');
    gl.enableVertexAttribArray(cPos);
    gl.enableVertexAttribArray(cUv);
    gl.vertexAttribPointer(cPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(cUv, 2, gl.FLOAT, false, 16, 8);
    gl.uniform1f(gl.getUniformLocation(progCloudsBg, 'u_time'), elapsed);
    gl.uniform1f(gl.getUniformLocation(progCloudsBg, 'u_aspect'), width / Math.max(height, 1));
    const uc = layer.userColors || {};
    const c1 = uc.clouds || [0.05, 0.15, 0.4];
    const ch = uc.horizon || [0.05, 0.15, 0.4];
    gl.uniform3f(gl.getUniformLocation(progCloudsBg, 'u_color1'), c1[0], c1[1], c1[2]);
    gl.uniform3f(gl.getUniformLocation(progCloudsBg, 'u_colorHorizon'), ch[0], ch[1], ch[2]);
    if (layer.texUrl) {
      const texRec = loadTexture(layer.texUrl, true);
      if (texRec.loaded) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texRec.texture);
        gl.uniform1i(gl.getUniformLocation(progCloudsBg, 'u_tex'), 0);
        gl.uniform1i(gl.getUniformLocation(progCloudsBg, 'u_hasTex'), 1);
      } else {
        gl.uniform1i(gl.getUniformLocation(progCloudsBg, 'u_hasTex'), 0);
      }
    } else {
      gl.uniform1i(gl.getUniformLocation(progCloudsBg, 'u_hasTex'), 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  const spriteBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -0.5, -0.5, 0.0, 0.0,
     0.5, -0.5, 1.0, 0.0,
    -0.5,  0.5, 0.0, 1.0,
     0.5,  0.5, 1.0, 1.0,
  ]), gl.STATIC_DRAW);

  function drawBillboard(center, axisX, axisY, texUrl, color, proj, view) {
    gl.useProgram(progSprite);
    gl.uniformMatrix4fv(gl.getUniformLocation(progSprite, 'u_proj'), false, proj);
    gl.uniformMatrix4fv(gl.getUniformLocation(progSprite, 'u_view'), false, view);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
    const cPos = gl.getAttribLocation(progSprite, 'a_corner');
    const cUv = gl.getAttribLocation(progSprite, 'a_uv');
    gl.enableVertexAttribArray(cPos);
    gl.enableVertexAttribArray(cUv);
    gl.vertexAttribPointer(cPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(cUv, 2, gl.FLOAT, false, 16, 8);
    gl.uniform3f(gl.getUniformLocation(progSprite, 'u_center'), center[0], center[1], center[2]);
    gl.uniform2f(gl.getUniformLocation(progSprite, 'u_axisX'), axisX[0], axisX[1]);
    gl.uniform2f(gl.getUniformLocation(progSprite, 'u_axisY'), axisY[0], axisY[1]);
    gl.uniform4f(gl.getUniformLocation(progSprite, 'u_color'), color[0], color[1], color[2], color[3]);
    if (texUrl) {
      const texRec = loadTexture(texUrl);
      if (texRec.loaded) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texRec.texture);
        gl.uniform1i(gl.getUniformLocation(progSprite, 'u_tex'), 0);
        gl.uniform1i(gl.getUniformLocation(progSprite, 'u_hasTex'), 1);
      } else {
        gl.uniform1i(gl.getUniformLocation(progSprite, 'u_hasTex'), 0);
      }
    } else {
      gl.uniform1i(gl.getUniformLocation(progSprite, 'u_hasTex'), 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // 3D particle system state, seeded from manifest.particles3d
  const particles3dState = new Map();
  function getParticles3d(sys) {
    if (!particles3dState.has(sys)) particles3dState.set(sys, { list: [], acc: 0 });
    return particles3dState.get(sys);
  }
  function updateParticles3d(sys, dt) {
    const st = getParticles3d(sys);
    st.acc += sys.rate * dt;
    while (st.acc >= 1 && st.list.length < sys.maxCount) {
      st.acc -= 1;
      // Random point on a sphere shell around the emitter origin.
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const r = sys.distMin + Math.random() * (sys.distMax - sys.distMin);
      const lerp = (a, b) => a + Math.random() * (b - a);
      st.list.push({
        x: sys.origin[0] + r * Math.sin(ph) * Math.cos(th),
        y: sys.origin[1] + r * Math.sin(ph) * Math.sin(th),
        z: sys.origin[2] + r * Math.cos(ph),
        vx: lerp(sys.velMin[0], sys.velMax[0]),
        vy: lerp(sys.velMin[1], sys.velMax[1]),
        vz: lerp(sys.velMin[2], sys.velMax[2]),
        size: lerp(sys.sizeMin, sys.sizeMax),
        life: 0,
        maxLife: lerp(sys.lifeMin, sys.lifeMax),
        color: [lerp(sys.colorMin[0], sys.colorMax[0]), lerp(sys.colorMin[1], sys.colorMax[1]), lerp(sys.colorMin[2], sys.colorMax[2])],
      });
    }
    st.acc = Math.min(st.acc, 4);
    for (let i = st.list.length - 1; i >= 0; i--) {
      const p = st.list[i];
      p.life += dt;
      if (p.life >= p.maxLife) { st.list.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
  }

  // Shared unit quad geometry (-0.5 to 0.5)
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -0.5, -0.5, 0.0, 1.0,
     0.5, -0.5, 1.0, 1.0,
    -0.5,  0.5, 0.0, 0.0,
     0.5,  0.5, 1.0, 0.0,
  ]), gl.STATIC_DRAW);

  function loadTexture(url, repeat) {
    const key = repeat ? url + '|repeat' : url;
    if (textureCache.has(key)) return textureCache.get(key);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,0]));
    const record = { texture: tex, loaded: false, width: 1, height: 1 };
    textureCache.set(key, record);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      record.loaded = true;
      record.width = img.width;
      record.height = img.height;
    };
    img.src = url;
    return record;
  }

  function activeTimePeriod(schedule, date) {
    if (!schedule) return null;
    const hour = date.getHours() + date.getMinutes() / 60;
    if (hour >= schedule.morning && hour < schedule.day) return 'morning';
    if (hour >= schedule.day && hour < schedule.dusk) return 'day';
    if (hour >= schedule.dusk && hour < schedule.night) return 'dusk';
    return 'night';
  }

  function layerEnabledByTime(layer, period) {
    return !layer.timePeriod || layer.timePeriod === period || (layer.timePeriod === 'manual' && period === null);
  }

  function loadVideoTexture(layer, enabled) {
    let record = videoTextureCache.get(layer.videoUrl);
    if (!record) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,0]));
      const video = document.createElement('video');
      // The player iframe is sandboxed without allow-same-origin, so every
      // texture load is a cross-origin fetch from an opaque origin. Without
      // CORS mode the video taints the WebGL texture and texImage2D throws a
      // SecurityError, leaving the canvas blank (the scene-resource route
      // answers Origin: null with access-control-allow-origin: null).
      video.crossOrigin = 'anonymous';
      video.src = layer.videoUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      record = { texture, video, loaded: false };
      video.addEventListener('loadeddata', () => { record.loaded = true; });
      videoTextureCache.set(layer.videoUrl, record);
    }
    if (enabled && !isPaused) { void record.video.play().catch(() => {}); }
    else record.video.pause();
    if (enabled && record.loaded && record.video.readyState >= 2) {
      gl.bindTexture(gl.TEXTURE_2D, record.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, record.video);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return record;
  }

  // FBO setup for reflection passes
  let fbo = null, fboTex = null, fboWidth = 0, fboHeight = 0;
  function ensureFbo(w, h) {
    if (fbo && fboWidth === w && fboHeight === h) return;
    fboWidth = w; fboHeight = h;
    if (fbo) gl.deleteFramebuffer(fbo);
    if (fboTex) gl.deleteTexture(fboTex);
    fbo = gl.createFramebuffer();
    fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function mat4Ortho(left, right, bottom, top, near, far) {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    return new Float32Array([
      -2 * lr, 0, 0, 0,
      0, -2 * bt, 0, 0,
      0, 0, 2 * nf, 0,
      (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1
    ]);
  }

  function mat4Perspective(fovRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovRad / 2);
    const nf = 1.0 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  function mat4LookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;

    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xy /= len; xz /= len;

    let yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;

    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1
    ]);
  }

  function mat4Transform3D(origin, angles, scale) {
    const ox = origin[0] || 0, oy = origin[1] || 0, oz = origin[2] || 0;
    const sx = scale[0] || 1, sy = scale[1] || 1, sz = scale[2] || 1;
    const ax = (angles[0] || 0) * Math.PI / 180;
    const ay = (angles[1] || 0) * Math.PI / 180;
    const az = (angles[2] || 0) * Math.PI / 180;

    const cx = Math.cos(ax), sxn = Math.sin(ax);
    const cy = Math.cos(ay), syn = Math.sin(ay);
    const cz = Math.cos(az), szn = Math.sin(az);

    const m00 = (cy * cz) * sx;
    const m01 = (cx * szn + sxn * syn * cz) * sx;
    const m02 = (sxn * szn - cx * syn * cz) * sx;

    const m10 = (-cy * szn) * sy;
    const m11 = (cx * cz - sxn * syn * szn) * sy;
    const m12 = (sxn * cz + cx * syn * szn) * sy;

    const m20 = syn * sz;
    const m21 = (-sxn * cy) * sz;
    const m22 = (cx * cy) * sz;

    return new Float32Array([
      m00, m01, m02, 0,
      m10, m11, m12, 0,
      m20, m21, m22, 0,
      ox,  oy,  oz,  1
    ]);
  }

  function mat3NormalMatrix(m4) {
    return new Float32Array([
      m4[0], m4[1], m4[2],
      m4[4], m4[5], m4[6],
      m4[8], m4[9], m4[10]
    ]);
  }

  const modelGpuCache = new Map();
  function getGpuMesh(mesh) {
    if (modelGpuCache.has(mesh)) return modelGpuCache.get(mesh);
    
    function b64ToF32(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Float32Array(bytes.buffer);
    }
    function b64ToU16(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Uint16Array(bytes.buffer);
    }
    function b64ToU32(b64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Uint32Array(bytes.buffer);
    }
    // Meshes above 65535 vertices carry u32 indices (mesh.idx32), which
    // WebGL1 only exposes via OES_element_index_uint.
    const uintIndexExt = gl.getExtension('OES_element_index_uint');

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, b64ToF32(mesh.posB64), gl.STATIC_DRAW);

    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, b64ToF32(mesh.normB64), gl.STATIC_DRAW);

    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, b64ToF32(mesh.uvB64), gl.STATIC_DRAW);

    const uv2Buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uv2Buf);
    gl.bufferData(gl.ARRAY_BUFFER, b64ToF32(mesh.uv2B64 || mesh.uvB64), gl.STATIC_DRAW);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    const idx32 = Boolean(mesh.idx32) && uintIndexExt;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx32 ? b64ToU32(mesh.indicesB64) : b64ToU16(mesh.indicesB64), gl.STATIC_DRAW);

    const gpu = { posBuf, normBuf, uvBuf, uv2Buf, idxBuf, iCount: mesh.iCount, idxType: idx32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    modelGpuCache.set(mesh, gpu);
    return gpu;
  }

  function mat4Transform2D(x, y, w, h, angleRad) {
    const c = Math.cos(angleRad || 0);
    const s = Math.sin(angleRad || 0);
    return new Float32Array([
      w * c,  w * s,  0, 0,
     -h * s,  h * c,  0, 0,
      0,      0,      1, 0,
      x,      y,      0, 1
    ]);
  }

  function spawnParticle(emitter, system) {
    const lifeMin = system.lifeMin || 3;
    const lifeMax = system.lifeMax || 5;
    const lifetime = lifeMin + Math.random() * (lifeMax - lifeMin);
    
    // Position
    let x = 0, y = 0, vx = 0, vy = 0;
    if (system.type === 'meteor') {
      x = 500 + Math.random() * 3000;
      y = 1200 + Math.random() * 800;
      const speed = 700 + Math.random() * 500;
      vx = -speed * 0.85;
      vy = -speed * 0.52;
    } else { // fireflies / sparkles
      x = 200 + Math.random() * 3440;
      y = 100 + Math.random() * 900;
      vx = (Math.random() - 0.5) * 25;
      vy = 10 + Math.random() * 20;
    }
    
    const size = system.size || (15 + Math.random() * 20);
    activeParticles.push({
      system,
      x, y, vx, vy,
      size,
      life: 0,
      maxLife: lifetime,
      color: system.color || [1, 1, 0.8, 1],
      trail: []
    });
  }

  function updateParticles(dt) {
    for (let i = activeParticles.length - 1; i >= 0; i--) {
      const p = activeParticles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        activeParticles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.system.type === 'meteor') {
        p.trail.push({ x: p.x, y: p.y, life: p.life });
        if (p.trail.length > 8) p.trail.shift();
      } else {
        // Floating wander
        p.vx += (Math.random() - 0.5) * 15 * dt;
        p.vy += (Math.random() - 0.5) * 15 * dt;
      }
    }
  }
  // FBO for screen-space reflection (grid floor)
  let reflFbo = null;
  let reflTex = null;
  let reflDepth = null;
  let reflW = 0, reflH = 0;
  function ensureReflFbo(w, h) {
    if (reflW === w && reflH === h && reflFbo) return;
    if (reflFbo) { gl.deleteFramebuffer(reflFbo); gl.deleteTexture(reflTex); gl.deleteRenderbuffer(reflDepth); }
    reflFbo = gl.createFramebuffer();
    reflTex = gl.createTexture();
    reflDepth = gl.createRenderbuffer();
    gl.bindTexture(gl.TEXTURE_2D, reflTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, reflDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, reflFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, reflTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, reflDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    reflW = w; reflH = h;
  }

  function renderFrame(now) {
    if (!sceneData) {
      requestAnimationFrame(render);
      return;
    }

    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    const elapsed = (now - startTime) / 1000;

    if (!isPaused) {
      // Spawn particles periodically
      if (sceneData.hasMeteors && Math.random() < dt * 1.8) {
        spawnParticle({}, { type: 'meteor', lifeMin: 1.2, lifeMax: 2.2, size: 28, color: [1, 0.95, 0.85, 1], texUrl: sceneData.meteorTex });
      }
      if (sceneData.hasFireflies && activeParticles.filter(p => p.system.type === 'firefly').length < 35) {
        spawnParticle({}, { type: 'firefly', lifeMin: 4, lifeMax: 8, size: 14, color: [0.8, 1.0, 0.5, 0.85], texUrl: sceneData.sparkleTex });
      }
      updateParticles(dt);
    }

    // Size the backing store in device pixels: on HiDPI displays a CSS-pixel
    // canvas is upscaled by the compositor and the wallpaper looks soft
    // (capped at 2x to bound GPU cost on very high DPR screens).
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    // Some WE scenes mark the project as 3D solely because they contain 3D
    // particle systems while their visual base is still ordinary image layers.
    // Route those mixed scenes through the 2D compositor and draw the decoded
    // artwork; the 3D-only branch otherwise clears an opaque canvas and shows
    // only particles over a gradient.
    if (sceneData.is3D && sceneData.models && sceneData.models.length > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      const bg = sceneData.clearColor || [0.1, 0.1, 0.15];
      gl.clearColor(bg[0] * 0.4, bg[1] * 0.4, bg[2] * 0.4, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);

      const isCarScene = Boolean(sceneData.carBodyColor);
      const aspect = width / height;
      const cam = sceneData.camera || { eye: [2.18, 1.98, 4.63], center: [0, 0.45, 0], up: [0, 1, 0], fov: 50 };
      const proj3D = mat4Perspective((cam.fov || 50) * Math.PI / 180, aspect, 0.1, 1000.0);

      // Camera animation: use scene-specific paths if available, otherwise slow orbit
      const camPaths = sceneData.cameraPaths;
      let eye, center, upVec;
      if (camPaths && camPaths.length > 0) {
        const totalDur = camPaths.reduce((s, p) => s + p.d, 0);
        const cycleTime = elapsed % totalDur;
        let accum = 0, seg = camPaths[0], segT = 0;
        for (const p of camPaths) {
          if (cycleTime < accum + p.d) { seg = p; segT = (cycleTime - accum) / p.d; break; }
          accum += p.d;
        }
        segT = segT * segT * (3 - 2 * segT);
        const lerp3 = (a, b, t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
        eye = lerp3(seg.e0, seg.e1, segT);
        center = lerp3(seg.c0, seg.c1, segT);
        upVec = lerp3(seg.u0, seg.u1, segT);
      } else if (sceneData.cameraStatic) {
        // Fixed scene camera (no animation paths)
        eye = [cam.eye[0], cam.eye[1], cam.eye[2]];
        center = [cam.center[0], cam.center[1], cam.center[2]];
        upVec = [cam.up[0], cam.up[1], cam.up[2]];
      } else {
        const cx = cam.center[0], cy = cam.center[1], cz = cam.center[2];
        const dx = cam.eye[0] - cx, dy = cam.eye[1] - cy, dz = cam.eye[2] - cz;
        const radius = Math.hypot(dx, dy, dz) || 4.5;
        const baseAngle = Math.atan2(dx, dz);
        const pitchAngle = Math.atan2(dy, Math.hypot(dx, dz));
        const yaw = baseAngle + elapsed * 0.05;
        const pitch = pitchAngle;
        eye = [cx + Math.sin(yaw) * Math.cos(pitch) * radius, cy + Math.sin(pitch) * radius, cz + Math.cos(yaw) * Math.cos(pitch) * radius];
        center = [cx, cy, cz];
        upVec = [0, 1, 0];
      }
      // Mouse parallax
      const targetYaw = (mouseX - 0.5) * 0.6;
      const targetPitch = (mouseY - 0.5) * 0.3;
      curRotY += (targetYaw - curRotY) * 0.04;
      curRotX += (targetPitch - curRotX) * 0.04;
      eye[0] += curRotY * 0.5;
      eye[1] += curRotX * 0.3;

      const view3D = mat4LookAt(eye, center, upVec);
      // Planar reflection: the FBO pass renders from a camera mirrored below
      // the floor plane (y=0), so the grid can sample it 1:1 by screen UV.
      const view3DRefl = mat4LookAt(
        [eye[0], -eye[1], eye[2]],
        [center[0], -center[1], center[2]],
        [upVec[0], -upVec[1], upVec[2]]);
      const bodyCol = sceneData.carBodyColor || [1, 0, 0];

      // (Re-)bind prog3D with all scene uniforms. Must be re-invoked after any
      // pass that switches to another program (bgLayers, billboards).
      function bindProg3D(viewOverride) {
        gl.useProgram(prog3D);
        gl.uniformMatrix4fv(gl.getUniformLocation(prog3D, 'u_proj'), false, proj3D);
        gl.uniformMatrix4fv(gl.getUniformLocation(prog3D, 'u_view'), false, viewOverride || view3D);
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_cameraPos'), eye[0], eye[1], eye[2]);
        gl.uniform1f(gl.getUniformLocation(prog3D, 'u_time'), elapsed);
        // WE-standard scene shading for generic scenes; car scenes keep their
        // dedicated paint/grid pipeline.
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_sceneStd'), isCarScene ? 0 : 1);
        // Engine-glow boost positions: origins of jet models (ricepod.vert).
        const jetPos = [];
        for (const model of sceneData.models) {
          const mName = (model.name || '').toLowerCase();
          const jetLike = mName.includes('jet') || (model.meshes || []).some((mm) => (mm.shader || '').toLowerCase().includes('jet'));
          if (jetLike && jetPos.length < 4) jetPos.push(model.origin || [0, 0, 0]);
        }
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_jetCount'), jetPos.length);
        for (let ji = 0; ji < 4; ji++) {
          const jp = jetPos[ji] || [0, 0, 0];
          gl.uniform3f(gl.getUniformLocation(prog3D, 'u_jetPos[' + ji + ']'), jp[0], jp[1], jp[2]);
        }
        const pointLights = sceneData.pointLights || [];
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_lightCount'), pointLights.length);
        for (let li = 0; li < 4; li++) {
          const light = pointLights[li] || { origin: [0, 0, 0], color: [0, 0, 0], radius: 1 };
          gl.uniform3f(gl.getUniformLocation(prog3D, 'u_lightPos[' + li + ']'), light.origin[0], light.origin[1], light.origin[2]);
          gl.uniform4f(gl.getUniformLocation(prog3D, 'u_lightColorRadius[' + li + ']'), light.color[0], light.color[1], light.color[2], light.radius);
        }
        const sky = sceneData.skyLightColor || [0, 0, 0];
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_skyLightColor'), sky[0], sky[1], sky[2]);
        // Ricepod uses lightDir (-0.577, 0.577, 0.577), car uses (0.577, 0.577, 0.577)
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_lightDir'), isCarScene ? 0.577 : -0.577, 0.577, 0.577);
        const amb = sceneData.clearColor || [0.1, 0.1, 0.15];
        // Generic scenes must preserve authored black ambient. Artificially
        // lifting it illuminated distant geometry that WE intentionally hides.
        const ambColor = isCarScene ? amb : (sceneData.ambientColor || [0, 0, 0]);
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_ambientColor'), ambColor[0], ambColor[1], ambColor[2]);
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_paintColor'), bodyCol[0], bodyCol[1], bodyCol[2]);
      }
      bindProg3D();

      const locPos = gl.getAttribLocation(prog3D, 'a_pos');
      const locNorm = gl.getAttribLocation(prog3D, 'a_norm');
      const locUv = gl.getAttribLocation(prog3D, 'a_uv');
      const locUv2 = gl.getAttribLocation(prog3D, 'a_uv2');
      gl.enableVertexAttribArray(locPos);
      gl.enableVertexAttribArray(locNorm);
      gl.enableVertexAttribArray(locUv);
      gl.enableVertexAttribArray(locUv2);

      // Per-submesh specular params (from WE material JSONs)
      const specMap = {
        body: [0.4, 6], glass: [5, 50], interior: [0.2, 15],
        matte: [0.5, 10], taillights: [0.25, 10], wheel: [1, 10],
      };
      function getSpecParams(texUrl) {
        if (!texUrl) return [0.3, 10];
        for (const [k, v] of Object.entries(specMap)) {
          if (texUrl.includes(k)) return v;
        }
        return [0.3, 10];
      }

      // Render in correct order: skybox/dome, opaque, shadow, grid, glass/additive
      const skyboxModels = [];
      const domeModels = [];
      const opaqueModels = [];
      const shadowModels = [];
      const gridModels = [];
      const glassQueue = [];
      const additiveQueue = [];
      const translucentQueue = [];
      const neonGridQueue = [];

      for (const model of sceneData.models) {
        const mName = (model.name || '').toLowerCase();
        if (mName === 'skybox') { skyboxModels.push(model); continue; }
        if (mName === 'dome') { domeModels.push(model); continue; }
        if (mName === 'shadow') { shadowModels.push(model); continue; }
        if (mName === 'grid') { gridModels.push(model); continue; }
        // Material blending flags decide the queue per mesh; the model name
        // 'jet' heuristic stays as a fallback for legacy manifests.
        const opaqueMeshes = [];
        for (const mesh of model.meshes) {
          const shName = (mesh.shader || '').toLowerCase();
          if (shName === 'neongrid') neonGridQueue.push({ model, mesh });
          else if (mesh.additive || mName.includes('jet')) additiveQueue.push({ model, mesh });
          else if (mesh.translucent) translucentQueue.push({ model, mesh });
          else opaqueMeshes.push(mesh);
        }
        if (opaqueMeshes.length > 0) opaqueModels.push({ ...model, meshes: opaqueMeshes });
      }

      // Helper to draw a mesh with given uniforms
      function drawMesh(model, mesh, flags) {
        let modelMat = mat4Transform3D(model.origin, model.angles, model.scale);
        // Skybox/aurora/thunder follow the camera position (WE shaders add
        // g_EyePosition to the vertex instead of a model transform).
        if (flags.skybox || flags.followEye) {
          modelMat = mat4Transform3D([eye[0], eye[1], eye[2]], model.angles, model.scale);
        }
        gl.uniformMatrix4fv(gl.getUniformLocation(prog3D, 'u_model'), false, modelMat);
        const normMat = mat3NormalMatrix(modelMat);
        gl.uniformMatrix3fv(gl.getUniformLocation(prog3D, 'u_normMat'), false, normMat);

        const gpu = getGpuMesh(mesh);
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.posBuf);
        gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.normBuf);
        gl.vertexAttribPointer(locNorm, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uvBuf);
        gl.vertexAttribPointer(locUv, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uv2Buf);
        gl.vertexAttribPointer(locUv2, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.idxBuf);

        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isDome'), flags.dome ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isShadow'), flags.shadow ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isGrid'), flags.grid ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isSkybox'), flags.skybox ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isSelfIllum'), flags.selfIllum ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isCarBody'), flags.body ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isGlass'), flags.glass ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isJet'), flags.jet ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isAurora'), flags.aurora ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isThunder'), flags.thunder ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isBg'), flags.bg ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_isNeonSun'), flags.neonSun ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_gradFade'), mesh.gradFade ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasTint'), mesh.tint || flags.neonSun ? 1 : 0);
        const uc = mesh.userColors || {};
        let tintCol = mesh.tint || [1, 1, 1];
        let tint2Col = mesh.tint2 || tintCol;
        if (flags.neonSun) {
          tintCol = uc.colorsuntop || tintCol;
          tint2Col = uc.colorsunbottom || tint2Col;
        }
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_tint'), tintCol[0], tintCol[1], tintCol[2]);
        gl.uniform3f(gl.getUniformLocation(prog3D, 'u_tint2'), tint2Col[0], tint2Col[1], tint2Col[2]);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasLightmap'), 0);
        if (mesh.lightmapUrl) {
          const lightmapRec = loadTexture(mesh.lightmapUrl, false);
          if (lightmapRec.loaded) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, lightmapRec.texture);
            gl.uniform1i(gl.getUniformLocation(prog3D, 'u_lightmap'), 2);
            gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasLightmap'), 1);
            gl.activeTexture(gl.TEXTURE0);
          }
        }
        // Second pass texture (normal/pattern slot), repeat-wrapped like bg clouds.
        if (mesh.texUrl2) {
          const tex2Rec = loadTexture(mesh.texUrl2, true);
          if (tex2Rec.loaded) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tex2Rec.texture);
            gl.uniform1i(gl.getUniformLocation(prog3D, 'u_tex2'), 1);
            gl.activeTexture(gl.TEXTURE0);
          }
        }

        // WE material depth flags (orbital glows disable both).
        if (mesh.noDepthTest) gl.disable(gl.DEPTH_TEST);
        if (mesh.noDepthWrite) gl.depthMask(false);

        const sp = getSpecParams(mesh.texUrl);
        gl.uniform1f(gl.getUniformLocation(prog3D, 'u_specStrength'), sp[0]);
        gl.uniform1f(gl.getUniformLocation(prog3D, 'u_specPower'), sp[1]);

        if (flags.body) {
          const strCol = sceneData.carStripesColor || [0, 0, 0];
          gl.uniform3f(gl.getUniformLocation(prog3D, 'u_paintColor'), bodyCol[0], bodyCol[1], bodyCol[2]);
          gl.uniform3f(gl.getUniformLocation(prog3D, 'u_stripeColor'), strCol[0], strCol[1], strCol[2]);
        }

        // Load texture for all meshes that have one (including skybox)
        if (mesh.texUrl && !flags.dome && !flags.shadow && !flags.grid) {
          const texRec = loadTexture(mesh.texUrl, Boolean(mesh.repeatBase || flags.aurora || flags.bg));
          if (texRec.loaded) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texRec.texture);
            gl.uniform1i(gl.getUniformLocation(prog3D, 'u_tex'), 0);
            gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasTex'), 1);
          } else {
            gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasTex'), 0);
            gl.uniform3f(gl.getUniformLocation(prog3D, 'u_color'), 0.7, 0.7, 0.75);
          }
        } else {
          gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasTex'), 0);
          gl.uniform3f(gl.getUniformLocation(prog3D, 'u_color'), 0.65, 0.68, 0.72);
        }

        gl.drawElements(gl.TRIANGLES, gpu.iCount, gpu.idxType, 0);

        if (mesh.noDepthTest) gl.enable(gl.DEPTH_TEST);
        if (mesh.noDepthWrite) gl.depthMask(true);
      }

      // --- Pass 1: Render to FBO for reflection source (if car scene with grid) ---
      const hasGrid = isCarScene && gridModels.length > 0;
      if (hasGrid) {
        bindProg3D(view3DRefl); // mirrored camera for the reflection pass
        ensureReflFbo(width, height);
        // Unbind the reflection texture before rendering into its own FBO
        // (avoids a framebuffer/texture feedback loop from the last frame).
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, reflFbo);
        gl.viewport(0, 0, width, height);
        gl.clearColor(bg[0] * 0.4, bg[1] * 0.4, bg[2] * 0.4, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Dome to FBO
        gl.depthMask(false);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasReflTex'), 0);
        for (const model of domeModels) {
          for (const mesh of model.meshes) drawMesh(model, mesh, { dome: true });
        }
        gl.depthMask(true);

        // Opaque car to FBO
        gl.disable(gl.BLEND);
        for (const model of opaqueModels) {
          for (const mesh of model.meshes) {
            const isBody = Boolean(isCarScene && mesh.texUrl && mesh.texUrl.includes('body'));
            const isGlass = Boolean(mesh.texUrl && mesh.texUrl.includes('glass'));
            if (!isGlass) drawMesh(model, mesh, { body: isBody });
          }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      // --- Pass 2: Render to screen ---
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.clearColor(bg[0] * 0.4, bg[1] * 0.4, bg[2] * 0.4, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      bindProg3D(); // restore the real camera after the reflection pass

      // 0. Fullscreen background layers (cloudsbg etc.), no depth
      const bgLayers = sceneData.bgLayers || [];
      if (bgLayers.length > 0) {
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        for (const layer of bgLayers) {
          if ((layer.shader || '') === 'cloudsbg') drawCloudsBgLayer(layer, elapsed, width, height);
        }
        gl.enable(gl.DEPTH_TEST);
        bindProg3D(); // drawCloudsBgLayer switched the bound program
      }

      // 1. Skybox / Dome: render first, no depth write
      gl.depthMask(false);
      gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasReflTex'), 0);
      for (const model of skyboxModels) {
        for (const mesh of model.meshes) drawMesh(model, mesh, { skybox: true });
      }
      for (const model of domeModels) {
        for (const mesh of model.meshes) drawMesh(model, mesh, { dome: true });
      }
      gl.depthMask(true);

      // 2. Opaque parts (bg shader meshes render as fullscreen background)
      gl.disable(gl.BLEND);
      for (const model of opaqueModels) {
        for (const mesh of model.meshes) {
          const isBody = Boolean(isCarScene && mesh.texUrl && mesh.texUrl.includes('body'));
          const isGlass = Boolean(mesh.texUrl && mesh.texUrl.includes('glass'));
          if (isGlass) {
            glassQueue.push({ model, mesh });
            continue;
          }
          drawMesh(model, mesh, { body: isBody, bg: (mesh.shader || '') === 'bg' });
        }
      }

      // 2b. Translucent overlays, far-to-near: neongrid floor first, then
      // bgfade/neonsun on top. Translucent passes never write depth so their
      // transparent pixels cannot occlude later geometry.
      if (translucentQueue.length > 0 || neonGridQueue.length > 0) {
        gl.enable(gl.BLEND);
        gl.depthMask(false);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        for (const { model, mesh } of neonGridQueue) {
          drawNeonGrid(model, mesh, proj3D, view3D, elapsed);
        }
        gl.useProgram(prog3D);
        for (const { model, mesh } of translucentQueue) {
          drawMesh(model, mesh, { bg: (mesh.shader || '') === 'bg', neonSun: (mesh.shader || '') === 'neonsun' });
        }
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

      // 3. Shadow (blended)
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      for (const model of shadowModels) {
        for (const mesh of model.meshes) drawMesh(model, mesh, { shadow: true });
      }

      // 4. Grid floor with FBO reflection
      if (hasGrid && reflTex) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, reflTex);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_reflTex'), 1);
        gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasReflTex'), 1);
        gl.uniform2f(gl.getUniformLocation(prog3D, 'u_resolution'), width, height);
      }
      for (const model of gridModels) {
        for (const mesh of model.meshes) drawMesh(model, mesh, { grid: true });
      }
      gl.uniform1i(gl.getUniformLocation(prog3D, 'u_hasReflTex'), 0);

      // 5. Glass (blended)
      for (const { model, mesh } of glassQueue) {
        drawMesh(model, mesh, { glass: true });
      }

      // 6. Additive glow queue (jets, orbital effects, self-illuminated)
      // SRC_ALPHA, ONE: shaped by the shader's output alpha (aurora fade,
      // thunder sparkle); jets output alpha 1 so they behave as pure additive.
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      for (const { model, mesh } of additiveQueue) {
        const shaderName = (mesh.shader || '').toLowerCase();
        const jetLike = shaderName.includes('jet') || (mesh.texUrl || '').toLowerCase().includes('jet');
        const isAurora = !jetLike && shaderName.includes('aurora');
        const isThunder = !jetLike && shaderName.includes('thunder');
        drawMesh(model, mesh, {
          jet: jetLike,
          aurora: isAurora,
          thunder: isThunder,
          selfIllum: !jetLike && !isAurora && !isThunder,
          followEye: isAurora || isThunder,
        });
      }

      // 7. 3D sprites (sun glow billboards) and particle streaks (starfield)
      const sprites3d = sceneData.sprites || [];
      const systems3d = sceneData.particles3d || [];
      if (sceneData.models && sceneData.models.length > 0 && (sprites3d.length > 0 || systems3d.length > 0)) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive, texture-alpha shaped
        for (const sp of sprites3d) {
          // View-space offset = camera-facing quad (WE sprite.vert semantics:
          // right*(u-0.5) + up*(v-0.5), scaled by 0.5 * object scale).
          const w = 0.5 * (sp.scale ? sp.scale[0] : 1);
          const h = 0.5 * (sp.scale ? sp.scale[1] : 1);
          drawBillboard(sp.origin, [w, 0], [0, h], sp.texUrl, [1, 1, 1, 1], proj3D, view3D);
        }
        for (const sys of systems3d) {
          if (!isPaused) updateParticles3d(sys, dt);
          const st = getParticles3d(sys);
          for (const p of st.list) {
            const fade = Math.min(1, Math.min(p.life, p.maxLife - p.life) / (0.2 * p.maxLife));
            // Streak: stretch the quad along the view-space velocity.
            const vv = [
              view3D[0] * p.vx + view3D[4] * p.vy + view3D[8] * p.vz,
              view3D[1] * p.vx + view3D[5] * p.vy + view3D[9] * p.vz,
            ];
            const speed = Math.hypot(vv[0], vv[1]);
            const halfLen = p.size * 0.5 * (1 + Math.min(speed * 0.08, 4));
            const halfWid = p.size * 0.5;
            let px = 1, py = 0;
            if (speed > 0.001) { px = vv[0] / speed; py = vv[1] / speed; }
            const axisX = [px * halfLen * 2, py * halfLen * 2];
            const axisY = [-py * halfWid * 2, px * halfWid * 2];
            drawBillboard([p.x, p.y, p.z], axisX, axisY, sys.texUrl, [p.color[0], p.color[1], p.color[2], fade], proj3D, view3D);
          }
        }
      }

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      requestAnimationFrame(render);
      return;
    }

    const sceneW = sceneData.width || 3840;
    const sceneH = sceneData.height || 2160;

    let scale = 1;
    if (fitMode === 'cover') {
      scale = Math.max(width / sceneW, height / sceneH);
    } else if (fitMode === 'contain') {
      scale = Math.min(width / sceneW, height / sceneH);
    } // fill: viewport covers the whole canvas (non-uniform stretch)

    const vpW = fitMode === 'fill' ? width : Math.round(sceneW * scale);
    const vpH = fitMode === 'fill' ? height : Math.round(sceneH * scale);
    const vpX = fitMode === 'fill' ? 0 : Math.round((width - vpW) / 2);
    const vpY = fitMode === 'fill' ? 0 : Math.round((height - vpH) / 2);

    ensureFbo(Math.min(sceneW, 2048), Math.min(sceneH, 1080));

    // Projection matrix mapping scene coords (0..sceneW, 0..sceneH) to clip space (-1..1)
    const proj = mat4Ortho(0, sceneW, 0, sceneH, -1000, 1000);

    // WE serializes scene image objects in painter order: the base is first and
    // overlays/effect layers follow it. Preserve that order. Reversing it makes
    // an opaque base layer cover flow/sway shaders and every foreground component,
    // which presents live scenes as a wrongly cropped static texture.
    const currentPeriod = activeTimePeriod(sceneData.timeSchedule, new Date());
    const renderLayers = sceneData.layers.filter((layer) => layerEnabledByTime(layer, currentPeriod));
    // Pause inactive time-period videos immediately; only the author-selected
    // morning/day/dusk/night layer may consume decode resources.
    for (const layer of sceneData.layers) {
      if (layer.videoUrl) loadVideoTexture(layer, layerEnabledByTime(layer, currentPeriod));
    }

    // Pass 1: Render background and sky layers into FBO for reflections
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, fboWidth, fboHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(progBasic);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    const aPos = gl.getAttribLocation(progBasic, 'a_pos');
    const aUv = gl.getAttribLocation(progBasic, 'a_uv');
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    gl.uniformMatrix4fv(gl.getUniformLocation(progBasic, 'u_proj'), false, proj);
    gl.uniform1f(gl.getUniformLocation(progBasic, 'u_time'), elapsed);
    gl.uniform4f(gl.getUniformLocation(progBasic, 'u_uvRect'), 0, 0, 1, 1);
    gl.uniform1f(gl.getUniformLocation(progBasic, 'u_bright'), 1);
    gl.uniform1f(gl.getUniformLocation(progBasic, 'u_power'), 1);

    // Render sky & upper layers into FBO
    for (const layer of renderLayers) {
      if (layer.isGround || layer.isReflection) continue;
      const texRec = layer.videoUrl ? loadVideoTexture(layer, true) : loadTexture(layer.texUrl);
      if (!texRec.loaded) continue;

      const model = mat4Transform2D(layer.x, layer.y, layer.w, layer.h, layer.angle || 0);
      gl.uniformMatrix4fv(gl.getUniformLocation(progBasic, 'u_model'), false, model);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_alpha'), layer.alpha != null ? layer.alpha : 1.0);
      gl.uniform3f(gl.getUniformLocation(progBasic, 'u_tint'), 1, 1, 1);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_sway'), layer.sway || 0);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_sway_speed'), layer.swaySpeed || 1.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texRec.texture);
      gl.uniform1i(gl.getUniformLocation(progBasic, 'u_tex'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Pass 2: Render to screen viewport
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(vpX, vpY, vpW, vpH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Render all layers (Sky -> Ground -> Reflection -> Particles)
    for (const layer of renderLayers) {
      if (layer.isReflection) {
        // Water Reflection Pass
        const maskRec = loadTexture(layer.texUrl);
        if (!maskRec.loaded) continue;

        gl.useProgram(progReflection);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        const rPos = gl.getAttribLocation(progReflection, 'a_pos');
        const rUv = gl.getAttribLocation(progReflection, 'a_uv');
        gl.enableVertexAttribArray(rPos);
        gl.enableVertexAttribArray(rUv);
        gl.vertexAttribPointer(rPos, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(rUv, 2, gl.FLOAT, false, 16, 8);

        // Draw the reflection quad at the layer's own rect (fullscreen for
        // legacy scene-wide reflection layers).
        const model = mat4Transform2D(layer.x, layer.y, layer.w, layer.h, layer.angle || 0);
        gl.uniformMatrix4fv(gl.getUniformLocation(progReflection, 'u_proj'), false, proj);
        gl.uniformMatrix4fv(gl.getUniformLocation(progReflection, 'u_model'), false, model);
        gl.uniform4f(gl.getUniformLocation(progReflection, 'u_uvRect'), 0, 0, 1, 1);
        gl.uniform1f(gl.getUniformLocation(progReflection, 'u_time'), elapsed);
        gl.uniform1f(gl.getUniformLocation(progReflection, 'u_alpha'), 0.85);

        // Scene-uv rect of the quad (scene v grows downward, 0 at the top).
        const rectLeftU = (layer.x - layer.w / 2) / sceneW;
        const rectTopV = 1 - (layer.y + layer.h / 2) / sceneH;
        gl.uniform4f(gl.getUniformLocation(progReflection, 'u_rect'),
          rectLeftU, rectTopV, layer.w / sceneW, layer.h / sceneH);
        // Water line follows the scene data when the parser resolved one;
        // otherwise keep the legacy 0.65 / 0.42 / 0.38 window.
        const waterLine = typeof layer.waterLine === 'number' ? layer.waterLine : 0.65;
        const depthScale = (1 - waterLine) / 0.35;
        gl.uniform1f(gl.getUniformLocation(progReflection, 'u_waterLine'), waterLine);
        gl.uniform2f(gl.getUniformLocation(progReflection, 'u_reflectRange'),
          waterLine - 0.23 * depthScale, 0.38 * depthScale);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fboTex);
        gl.uniform1i(gl.getUniformLocation(progReflection, 'u_fbo'), 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, maskRec.texture);
        gl.uniform1i(gl.getUniformLocation(progReflection, 'u_mask'), 1);

        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        continue;
      }

      // WE flowimage layer (flowing nebula): mask + 3 cross-fading layers.
      // All four textures are sampled with the plain quad UV (WE stretches
      // mask and content over the whole quad); served PNGs are already
      // cropped to the image rect, and clamp wrapping matches clampuvs.
      if (layer.shader === 'flowimage' && layer.texUrls && layer.texUrls.length >= 4) {
        const recs = layer.texUrls.slice(0, 4).map((u) => loadTexture(u));
        if (!recs.every((r) => r.loaded)) continue;
        gl.useProgram(progFlow);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        const fPos = gl.getAttribLocation(progFlow, 'a_pos');
        const fUv = gl.getAttribLocation(progFlow, 'a_uv');
        gl.enableVertexAttribArray(fPos);
        gl.enableVertexAttribArray(fUv);
        gl.vertexAttribPointer(fPos, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(fUv, 2, gl.FLOAT, false, 16, 8);
        const model = mat4Transform2D(layer.x, layer.y, layer.w, layer.h, layer.angle || 0);
        gl.uniformMatrix4fv(gl.getUniformLocation(progFlow, 'u_proj'), false, proj);
        gl.uniformMatrix4fv(gl.getUniformLocation(progFlow, 'u_model'), false, model);
        const fcrop = layer.uvCrop || [0, 0, 1, 1];
        gl.uniform4f(gl.getUniformLocation(progFlow, 'u_uvRect'), fcrop[0], fcrop[1], fcrop[2], fcrop[3]);
        gl.uniform1f(gl.getUniformLocation(progFlow, 'u_time'), elapsed);
        const nums = layer.nums || {};
        gl.uniform3f(gl.getUniformLocation(progFlow, 'u_speeds'),
          nums.Speed0 ?? 0.01, nums.Speed1 ?? 0.01, nums.Speed2 ?? 0.01);
        gl.uniform1f(gl.getUniformLocation(progFlow, 'u_amp'), nums.Amount ?? 1);
        gl.uniform1f(gl.getUniformLocation(progFlow, 'u_bright'), nums.Bright ?? 1);
        const units = ['u_mask', 'u_l1', 'u_l2', 'u_l3'];
        for (let ui = 0; ui < 4; ui++) {
          gl.activeTexture(gl.TEXTURE0 + ui);
          gl.bindTexture(gl.TEXTURE_2D, recs[ui].texture);
          gl.uniform1i(gl.getUniformLocation(progFlow, units[ui]), ui);
        }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.activeTexture(gl.TEXTURE0);
        continue;
      }

      // WE flag layer (rippling tinted cloth): eagleflag
      if (layer.shader === 'flag' && layer.texUrls && layer.texUrls.length >= 3) {
        const recs = layer.texUrls.slice(0, 3).map((u) => loadTexture(u, true));
        if (!recs.every((r) => r.loaded)) continue;
        gl.useProgram(progFlag);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        const flPos = gl.getAttribLocation(progFlag, 'a_pos');
        const flUv = gl.getAttribLocation(progFlag, 'a_uv');
        gl.enableVertexAttribArray(flPos);
        gl.enableVertexAttribArray(flUv);
        gl.vertexAttribPointer(flPos, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(flUv, 2, gl.FLOAT, false, 16, 8);
        const model = mat4Transform2D(layer.x, layer.y, layer.w, layer.h, layer.angle || 0);
        gl.uniformMatrix4fv(gl.getUniformLocation(progFlag, 'u_proj'), false, proj);
        gl.uniformMatrix4fv(gl.getUniformLocation(progFlag, 'u_model'), false, model);
        const flcrop = layer.uvCrop || [0, 0, 1, 1];
        gl.uniform4f(gl.getUniformLocation(progFlag, 'u_uvRect'), flcrop[0], flcrop[1], flcrop[2], flcrop[3]);
        gl.uniform1f(gl.getUniformLocation(progFlag, 'u_time'), elapsed);
        const fnums = layer.nums || {};
        gl.uniform1f(gl.getUniformLocation(progFlag, 'u_speed'), fnums.Speed ?? 0.4);
        gl.uniform1f(gl.getUniformLocation(progFlag, 'u_strength'), fnums.Strength ?? 0.5);
        const fcols = layer.userColors || {};
        const fc1 = fcols.color1 || [0, 0, 0];
        const fc2 = fcols.color2 || [0, 0, 0];
        const fc3 = fcols.color3 || [1, 1, 1];
        gl.uniform3f(gl.getUniformLocation(progFlag, 'u_color1'), fc1[0], fc1[1], fc1[2]);
        gl.uniform3f(gl.getUniformLocation(progFlag, 'u_color2'), fc2[0], fc2[1], fc2[2]);
        gl.uniform3f(gl.getUniformLocation(progFlag, 'u_color3'), fc3[0], fc3[1], fc3[2]);
        const funits = ['u_tex', 'u_normal', 'u_cloth'];
        for (let ui = 0; ui < 3; ui++) {
          gl.activeTexture(gl.TEXTURE0 + ui);
          gl.bindTexture(gl.TEXTURE_2D, recs[ui].texture);
          gl.uniform1i(gl.getUniformLocation(progFlag, funits[ui]), ui);
        }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.activeTexture(gl.TEXTURE0);
        continue;
      }

      // Standard image or embedded-video layer.
      const texRec = layer.videoUrl ? loadVideoTexture(layer, true) : loadTexture(layer.texUrl);
      if (!texRec.loaded) continue;

      gl.useProgram(progBasic);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

      const crop = layer.uvCrop || [0, 0, 1, 1];
      gl.uniform4f(gl.getUniformLocation(progBasic, 'u_uvRect'), crop[0], crop[1], crop[2], crop[3]);
      const lnums = layer.nums || {};
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_bright'), lnums.Bright ?? 1);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_power'), lnums.Power ?? 1);

      const model = mat4Transform2D(layer.x, layer.y, layer.w, layer.h, layer.angle || 0);
      gl.uniformMatrix4fv(gl.getUniformLocation(progBasic, 'u_proj'), false, proj);
      gl.uniformMatrix4fv(gl.getUniformLocation(progBasic, 'u_model'), false, model);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_time'), elapsed);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_alpha'), layer.alpha != null ? layer.alpha : 1.0);
      gl.uniform3f(gl.getUniformLocation(progBasic, 'u_tint'), 1, 1, 1);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_sway'), layer.sway || 0);
      gl.uniform1f(gl.getUniformLocation(progBasic, 'u_sway_speed'), layer.swaySpeed || 1.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texRec.texture);
      gl.uniform1i(gl.getUniformLocation(progBasic, 'u_tex'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Render Particles (Shooting Stars, Fireflies)
    if (activeParticles.length > 0) {
      gl.useProgram(progParticle);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      const pPos = gl.getAttribLocation(progParticle, 'a_pos');
      const pUv = gl.getAttribLocation(progParticle, 'a_uv');
      gl.enableVertexAttribArray(pPos);
      gl.enableVertexAttribArray(pUv);
      gl.vertexAttribPointer(pPos, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(pUv, 2, gl.FLOAT, false, 16, 8);
      gl.uniformMatrix4fv(gl.getUniformLocation(progParticle, 'u_proj'), false, proj);
      gl.uniform4f(gl.getUniformLocation(progParticle, 'u_uvRect'), 0, 0, 1, 1);

      gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive luminous particles

      for (const p of activeParticles) {
        const progress = p.life / p.maxLife;
        const alpha = Math.sin(progress * Math.PI); // Fade in & out
        const texRec = p.system.texUrl ? loadTexture(p.system.texUrl) : null;
        if (texRec && texRec.loaded) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texRec.texture);
          gl.uniform1i(gl.getUniformLocation(progParticle, 'u_tex'), 0);
        }

        // Draw trail if meteor
        if (p.trail && p.trail.length > 1) {
          for (let ti = 0; ti < p.trail.length; ti++) {
            const tp = p.trail[ti];
            const tRatio = (ti + 1) / p.trail.length;
            const tAlpha = alpha * tRatio * 0.6;
            const tModel = mat4Transform2D(tp.x, tp.y, p.size * tRatio * 1.5, p.size * 0.4, Math.atan2(p.vy, p.vx));
            gl.uniformMatrix4fv(gl.getUniformLocation(progParticle, 'u_model'), false, tModel);
            gl.uniform4f(gl.getUniformLocation(progParticle, 'u_color'), p.color[0], p.color[1], p.color[2], tAlpha);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          }
        }

        const model = mat4Transform2D(p.x, p.y, p.size * (p.system.type === 'meteor' ? 3 : 1), p.size, Math.atan2(p.vy, p.vx));
        gl.uniformMatrix4fv(gl.getUniformLocation(progParticle, 'u_model'), false, model);
        gl.uniform4f(gl.getUniformLocation(progParticle, 'u_color'), p.color[0], p.color[1], p.color[2], alpha * p.color[3]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    requestAnimationFrame(render);
  }

  // Crash guard: a render exception must not freeze the wallpaper silently.
  function render(now) {
    try {
      if (contextLost) { requestAnimationFrame(render); return; }
      renderFrame(now);
    } catch (e) {
      if (!window.__weRenderErr) {
        window.__weRenderErr = 1;
        console.error('we-scene-player render error:', e && e.stack || String(e));
      }
      requestAnimationFrame(render);
    }
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    // WebGL objects are invalid after restoration. Ask the embedding
    // controller to rebuild this isolated renderer instead of drawing with
    // stale programs/textures. The player frame is sandboxed without
    // allow-same-origin, so the embedding page's origin is unknown here;
    // '*' delivers to the window the event source check identifies.
    window.parent.postMessage({ type: 'dsh-scene-needs-reload' }, '*');
  });

  // Load manifest
  const token = window.location.pathname.split('/').filter(Boolean).pop();
  fetch('/api/skin-center/we/scene-manifest/' + token)
    .then(res => res.json())
    .then(data => {
      if (data.ok && data.manifest) {
        sceneData = data.manifest;
      }
    })
    .catch(err => console.error('Failed to load scene manifest', err));

  // Listen for controller messages; only the embedding parent may steer the
  // player. Origin cannot filter here: the player runs sandboxed without
  // allow-same-origin, so an origin compare would be browser-dependent and
  // the parent's messages carry its real origin. Only the identity of the
  // sender (the exact embedding window) is trustworthy.
  window.addEventListener('message', (ev) => {
    if (ev.source !== window.parent) return;
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'dsh-set-fit' && msg.fit) {
      fitMode = msg.fit;
    } else if (msg.type === 'dsh-set-pause') {
      isPaused = !!msg.paused;
    } else if (msg.type === 'dsh-recover-renderer') {
      if (gl.isContextLost()) {
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.restoreContext();
        else window.parent.postMessage({ type: 'dsh-scene-needs-reload' }, '*');
      } else {
        // Force an immediate fresh frame after compositor/theme changes.
        renderFrame(performance.now());
      }
    }
  });

  requestAnimationFrame(render);
})();
<\/script>
</body>
</html>
`;
/**
* Delete same-wallpaper cache files left by earlier extractor versions or
* older mtimes, so a version bump does not leave stale debris growing the
* cache directory forever. The stem comparison is exact: the trailing
* `[_vN_]<mtime>.<ext>` suffix is stripped first, so one base64url path
* never prunes another (base64url output can itself contain underscores).
*/
function pruneStaleSceneCache(cacheDir, base, keep) {
	let entries;
	try {
		entries = readdirSync(cacheDir);
	} catch {
		return;
	}
	for (const name of entries) {
		if (name === keep) continue;
		if (name.replace(/_(?:v\d+_)?\d+\.[a-z0-9]+$/i, "") === base) try {
			rmSync(join(cacheDir, name), { force: true });
		} catch {}
	}
}
/**
* Read a web wallpaper's project.json property defaults so the shim can
* deliver them like WE does on startup. Values pass through raw: colors stay
* 'r g b' strings, sliders numbers, checkboxes booleans — exactly what the
* web API hands to applyUserProperties.
*/
function webPropertyDefaults(projectRoot) {
	const out = {};
	try {
		const raw = readFileSync(join(projectRoot, "project.json"), "utf8");
		const props = JSON.parse(raw).general?.properties;
		if (props) {
			for (const [key, def] of Object.entries(props)) if (def && typeof def === "object" && "value" in def) out[key] = { value: def.value };
		}
	} catch {}
	return out;
}
/** Browser-facing base path of the wallpaper API. */
const WE_API_PREFIX = "/api/skin-center/we";
/** Sanitize a wallpaper id into a safe store directory name. */
function safeStoreId(id) {
	return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}
/** Minimal mime map for wallpaper payloads. */
function mimeFor(absPath) {
	return {
		mp4: "video/mp4",
		webm: "video/webm",
		mkv: "video/x-matroska",
		avi: "video/x-msvideo",
		mov: "video/quicktime",
		html: "text/html; charset=utf-8",
		htm: "text/html; charset=utf-8",
		js: "text/javascript; charset=utf-8",
		mjs: "text/javascript; charset=utf-8",
		css: "text/css; charset=utf-8",
		json: "application/json; charset=utf-8",
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		webp: "image/webp",
		svg: "image/svg+xml",
		ico: "image/x-icon",
		mp3: "audio/mpeg",
		wav: "audio/wav",
		ogg: "audio/ogg",
		woff: "font/woff",
		woff2: "font/woff2",
		ttf: "font/ttf",
		otf: "font/otf",
		wasm: "application/wasm"
	}[extname(absPath).slice(1).toLowerCase()] || "application/octet-stream";
}
/** Pipe one file while coupling its descriptor lifetime to the HTTP response. */
function pipeFile(absPath, res, openReadStream, options) {
	if (res.destroyed || res.writableEnded) return;
	const source = openReadStream(absPath, options);
	const closeSource = () => source.destroy();
	res.once("close", closeSource);
	if (res.destroyed || res.writableEnded) {
		res.off("close", closeSource);
		source.destroy();
		return;
	}
	try {
		pipeline(source, res, () => {
			res.off("close", closeSource);
		});
	} catch {
		res.off("close", closeSource);
		source.destroy();
	}
}
/** Stream one file with Range support (video seeking needs 206). */
function serveFile(absPath, req, res, openReadStream, extraHeaders = {}) {
	if (!existsSync(absPath) || !statSync(absPath).isFile()) {
		writeJson(res, 404, {
			ok: false,
			error: "not-found"
		});
		return;
	}
	const size = statSync(absPath).size;
	res.setHeader("Content-Type", mimeFor(absPath));
	res.setHeader("Accept-Ranges", "bytes");
	for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
	const range = req.headers.range;
	if (range) {
		const match = /bytes=(\d*)-(\d*)/.exec(range);
		let start = match && match[1] ? parseInt(match[1], 10) : 0;
		let end = match && match[2] ? parseInt(match[2], 10) : size - 1;
		if (Number.isNaN(start)) start = 0;
		if (Number.isNaN(end) || end >= size) end = size - 1;
		if (start > end) {
			res.statusCode = 416;
			res.setHeader("Content-Range", "bytes */" + String(size));
			res.end();
			return;
		}
		res.statusCode = 206;
		res.setHeader("Content-Range", "bytes " + String(start) + "-" + String(end) + "/" + String(size));
		res.setHeader("Content-Length", String(end - start + 1));
		pipeFile(absPath, res, openReadStream, {
			start,
			end
		});
		return;
	}
	res.setHeader("Content-Length", String(size));
	pipeFile(absPath, res, openReadStream);
}
/** Cached per-scene capability probe result. */
const SCENE_PROBE_VERSION = 4;
/** Shape-check an entry loaded from the persisted probe cache. */
function isSceneProbe(value) {
	return value !== null && typeof value === "object" && value.v === SCENE_PROBE_VERSION && typeof value.hasVideo === "boolean" && typeof value.hasSceneWebGL === "boolean" && (value.compatibility === "full" || value.compatibility === "partial" || value.compatibility === "static-only") && Array.isArray(value.unsupportedFeatures);
}
/** Build the route family. */
function makeWeRoutes(deps) {
	const openReadStream = deps.openReadStream ?? createReadStream;
	const tokenStorePath = join(deps.storeDir, ".cache", "we-tokens.json");
	let mediaMap = /* @__PURE__ */ new Map();
	try {
		const saved = JSON.parse(readFileSync(tokenStorePath, "utf8"));
		if (saved !== null && typeof saved === "object") mediaMap = new Map(Object.entries(saved));
	} catch {}
	const persistTokens = () => {
		try {
			mkdirSync(dirname(tokenStorePath), { recursive: true });
			writeFileSync(tokenStorePath, JSON.stringify(Object.fromEntries(mediaMap)), "utf8");
		} catch {}
	};
	const tokenFor = (absPath) => {
		const token = Buffer.from(absPath, "utf8").toString("base64url");
		mediaMap.set(token, absPath);
		return token;
	};
	let inventoryCache = null;
	const invalidateInventory = () => {
		inventoryCache = null;
	};
	const freshInventory = () => {
		const manualDirs = deps.getConfig().weLibraryDirs ?? [];
		const autoDetect = deps.autoDetect ?? true;
		const installDir = autoDetect ? locateWallpaperEngine() : null;
		const libraryDirs = autoDetect ? owningLibraries() : [];
		const macos = deps.macosRoots !== void 0 ? deps.macosRoots : autoDetect && process.platform === "darwin" ? defaultMacosWallpaperRoots() : null;
		const key = inventoryFingerprint({
			installDir,
			libraryDirs,
			manualDirs,
			storeDir: deps.storeDir,
			entries: inventoryCache?.value.wallpapers,
			macos
		});
		if (inventoryCache && inventoryCache.key === key) return inventoryCache.value;
		const value = buildInventory({
			manualDirs,
			storeDir: deps.storeDir,
			autoDetect: false,
			installDir,
			libraryDirs,
			macos,
			platform: deps.platform
		});
		inventoryCache = {
			key: inventoryFingerprint({
				installDir,
				libraryDirs,
				manualDirs,
				storeDir: deps.storeDir,
				entries: value.wallpapers,
				macos
			}),
			value
		};
		return value;
	};
	const probeCachePath = join(deps.storeDir, ".cache", "we-scene-probes.json");
	let sceneProbeCache = /* @__PURE__ */ new Map();
	try {
		const saved = JSON.parse(readFileSync(probeCachePath, "utf8"));
		if (saved !== null && typeof saved === "object") {
			for (const [key, value] of Object.entries(saved)) if (isSceneProbe(value)) sceneProbeCache.set(key, value);
		}
	} catch {}
	const MAX_PROBE_CACHE = 256;
	const persistProbes = () => {
		try {
			mkdirSync(dirname(probeCachePath), { recursive: true });
			writeFileSync(probeCachePath, JSON.stringify(Object.fromEntries(sceneProbeCache)), "utf8");
		} catch {}
	};
	const entryToJson = (entry) => {
		const hasFile = existsSync(entry.fileAbs);
		if (entry.type === "image") return {
			id: entry.id,
			title: entry.title,
			type: entry.type,
			source: entry.source,
			playable: false,
			updateAvailable: false,
			videoUrl: null,
			webUrl: null,
			frameUrl: null,
			sceneUrl: null,
			previewUrl: hasFile ? "/api/skin-center/we/image/" + tokenFor(entry.fileAbs) : null
		};
		return {
			id: entry.id,
			title: entry.title,
			type: entry.type,
			source: entry.source,
			playable: entry.playable,
			updateAvailable: entry.updateAvailable,
			videoUrl: entry.type === "video" && hasFile ? "/api/skin-center/we/media/" + tokenFor(entry.fileAbs) : null,
			webUrl: entry.type === "web" && hasFile ? "/api/skin-center/we/web/" + tokenFor(entry.fileAbs) + "/" : null,
			frameUrl: entry.type === "scene" && hasFile ? "/api/skin-center/we/scene-frame/" + tokenFor(entry.fileAbs) : null,
			sceneUrl: null,
			previewUrl: entry.previewAbs ? "/api/skin-center/we/preview/" + tokenFor(entry.previewAbs) : null
		};
	};
	/**
	* Resolve a token from a prefix route, or answer 404. Tokens resolve
	* through the issued-token map only: a client-supplied path must never
	* reach the filesystem, otherwise any wallpaper (web wallpapers run
	* arbitrary JS same-origin) could read arbitrary local files.
	*/
	const resolveToken = (req, res, prefix) => {
		let token = "";
		try {
			const pathname = new URL(req.url || "/", "http://localhost").pathname;
			token = decodeURIComponent(pathname.slice(prefix.length).split("/")[0] ?? "");
		} catch {}
		const abs = mediaMap.get(token);
		if (!abs) {
			writeJson(res, 404, {
				ok: false,
				error: "unknown-token"
			});
			return null;
		}
		return abs;
	};
	const routes = [];
	routes.push({
		kind: "exact",
		path: "/api/skin-center/we/inventory",
		handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!requireSameOrigin(req, res)) return;
			try {
				const inventory = freshInventory();
				const wallpapers = inventory.wallpapers.map(entryToJson);
				persistTokens();
				writeJson(res, 200, {
					ok: true,
					installDir: inventory.installDir,
					total: inventory.total,
					portableCount: inventory.portableCount,
					systemCount: inventory.wallpapers.filter((w) => w.source === "system").length,
					wallpapers
				});
			} catch (error) {
				writeJson(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}
	});
	routes.push({
		kind: "exact",
		path: "/api/skin-center/we/scene-probe",
		handler: async (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!requireSameOrigin(req, res)) return;
			try {
				const id = new URL(req.url ?? "", "http://localhost").searchParams.get("id");
				if (!id) {
					writeJson(res, 400, {
						ok: false,
						error: "missing-id"
					});
					return;
				}
				const entry = freshInventory().wallpapers.find((w) => w.id === id && w.type === "scene");
				if (!entry || !existsSync(entry.fileAbs)) {
					writeJson(res, 404, {
						ok: false,
						error: "not-found"
					});
					return;
				}
				let mtimeMs = 0;
				let size = 0;
				try {
					const st = await stat(entry.fileAbs);
					mtimeMs = st.mtimeMs;
					size = st.size;
				} catch {}
				if (entry.fileAbs.toLowerCase().endsWith(".json")) mtimeMs = 0;
				const key = entry.fileAbs + ":" + mtimeMs + ":" + size;
				let probe = mtimeMs > 0 ? sceneProbeCache.get(key) : void 0;
				if (!probe) {
					let hasVideo = false;
					let hasSceneWebGL = false;
					let compatibility = "full";
					const unsupportedFeatures = [];
					try {
						const pkgData = await readFile(entry.fileAbs);
						hasVideo = entry.fileAbs.toLowerCase().endsWith(".json") ? hasSceneVideoFromDir(dirname(entry.fileAbs)) : hasSceneVideo(pkgData);
						{
							const manifest = entry.fileAbs.toLowerCase().endsWith(".json") ? buildSceneManifestFromDir(dirname(entry.fileAbs), "check") : buildSceneManifest(pkgData, "check", (() => {
								try {
									return JSON.parse(readFileSync(join(entry.dir, "project.json"), "utf8"));
								} catch {
									return null;
								}
							})());
							if (manifest?.scripted) {
								compatibility = "partial";
								unsupportedFeatures.push("embedded-script");
							}
							hasSceneWebGL = Boolean(manifest && (manifest.layers && manifest.layers.length >= 1 || manifest.is3D && manifest.models && manifest.models.length > 0));
						}
					} catch {}
					probe = {
						v: SCENE_PROBE_VERSION,
						hasVideo,
						hasSceneWebGL,
						compatibility,
						unsupportedFeatures
					};
					if (mtimeMs > 0) {
						sceneProbeCache.set(key, probe);
						while (sceneProbeCache.size > MAX_PROBE_CACHE) {
							const oldest = sceneProbeCache.keys().next().value;
							if (oldest === void 0) break;
							sceneProbeCache.delete(oldest);
						}
						persistProbes();
					}
				}
				const videoToken = probe.hasVideo && !probe.hasSceneWebGL ? tokenFor(entry.fileAbs) : null;
				const sceneToken = probe.hasSceneWebGL ? tokenFor(entry.fileAbs) : null;
				persistTokens();
				writeJson(res, 200, {
					ok: true,
					videoUrl: videoToken !== null ? "/api/skin-center/we/scene-video/" + videoToken : null,
					sceneUrl: sceneToken !== null ? "/api/skin-center/we/scene-runtime/" + sceneToken : null,
					compatibility: probe.compatibility,
					unsupportedFeatures: probe.unsupportedFeatures
				});
			} catch (error) {
				writeJson(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}
	});
	routes.push({
		kind: "exact",
		path: "/api/skin-center/we/shim.js",
		handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!requireContentOrigin(req, res)) return;
			res.writeHead(200, {
				"content-type": "text/javascript; charset=utf-8",
				"cache-control": "no-store",
				"access-control-allow-origin": "null"
			});
			res.end(WE_SHIM_JS);
		}
	});
	for (const seg of ["media", "preview"]) {
		const prefix = "/api/skin-center/we/" + seg + "/";
		routes.push({
			kind: "prefix",
			path: "/api/skin-center/we/" + seg,
			handler: (req, res) => {
				if (req.method !== "GET") {
					writeJson(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				if (!requireSameOrigin(req, res)) return;
				const abs = resolveToken(req, res, prefix);
				if (!abs) return;
				if (abs.toLowerCase().endsWith(".tex")) try {
					const texBuf = readFileSync(abs);
					const decoded = decodeTex(new Uint8Array(texBuf.buffer, texBuf.byteOffset, texBuf.byteLength));
					const pngBuf = encodePng(decoded.width, decoded.height, decoded.rgba);
					res.writeHead(200, {
						"Content-Type": "image/png",
						"Content-Length": pngBuf.length,
						"Cache-Control": "public, max-age=86400"
					});
					res.end(pngBuf);
					return;
				} catch {}
				serveFile(abs, req, res, openReadStream);
			}
		});
	}
	/**
	* Convert one HEIC wallpaper into a <=2560px JPEG with the macOS-native
	* sips tool (no extra dependency). Darwin-only: Desktop Pictures scanning
	* only runs there, and the token map only ever holds scanned paths.
	*/
	const defaultConvertImage = (src, dest) => new Promise((resolvePromise, reject) => {
		if (process.platform !== "darwin") {
			reject(/* @__PURE__ */ new Error("heic conversion requires macOS"));
			return;
		}
		execFile("/usr/bin/sips", [
			"-s",
			"format",
			"jpeg",
			"-s",
			"formatOptions",
			"85",
			"-Z",
			"2560",
			src,
			"--out",
			dest
		], { timeout: 6e4 }, (error) => {
			if (error !== null) reject(error);
			else resolvePromise();
		});
	});
	const imagePrefix = "/api/skin-center/we/image/";
	routes.push({
		kind: "prefix",
		path: "/api/skin-center/we/image",
		handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!requireSameOrigin(req, res)) return;
			const abs = resolveToken(req, res, imagePrefix);
			if (!abs) return;
			if (/\.(jpe?g|png|webp)$/i.test(abs)) {
				serveFile(abs, req, res, openReadStream);
				return;
			}
			if (!/\.hei[cf]$/i.test(abs)) {
				writeJson(res, 400, {
					ok: false,
					error: "not-an-image"
				});
				return;
			}
			(async () => {
				let mtime = 0;
				try {
					mtime = statSync(abs).mtimeMs;
				} catch {}
				const cacheDir = join(deps.storeDir, ".cache", "images");
				const base = Buffer.from(abs, "utf8").toString("base64url");
				const key = base + "_v1_" + String(Math.round(mtime)) + ".jpg";
				const cachePath = join(cacheDir, key);
				if (!existsSync(cachePath)) {
					mkdirSync(cacheDir, { recursive: true });
					await (deps.convertImage ?? defaultConvertImage)(abs, cachePath);
					pruneStaleSceneCache(cacheDir, base, key);
				}
				serveFile(cachePath, req, res, openReadStream);
			})().catch((error) => {
				writeJson(res, 422, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	});
	const sceneVideoPrefix = "/api/skin-center/we/scene-video/";
	routes.push({
		kind: "prefix",
		path: "/api/skin-center/we/scene-video",
		handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!requireSameOrigin(req, res)) return;
			const abs = resolveToken(req, res, sceneVideoPrefix);
			if (!abs) return;
			(async () => {
				let mtime = 0;
				try {
					mtime = statSync(abs).mtimeMs;
				} catch {}
				const cacheDir = join(deps.storeDir, ".cache", "videos");
				const base = Buffer.from(abs, "utf8").toString("base64url");
				const key = base + "_v" + String(2) + "_" + String(Math.round(mtime)) + ".mp4";
				const cachePath = join(cacheDir, key);
				if (!existsSync(cachePath)) {
					const { extractSceneVideo, extractSceneVideoFromDir } = await Promise.resolve().then(() => pkg_extract_exports);
					const videoBytes = abs.toLowerCase().endsWith(".json") ? extractSceneVideoFromDir(dirname(abs)) : extractSceneVideo(new Uint8Array(readFileSync(abs)));
					if (!videoBytes) {
						writeJson(res, 404, {
							ok: false,
							error: "no-video-found"
						});
						return;
					}
					mkdirSync(cacheDir, { recursive: true });
					writeFileSync(cachePath, videoBytes);
					pruneStaleSceneCache(cacheDir, base, key);
				}
				serveFile(cachePath, req, res, openReadStream);
			})().catch((error) => {
				writeJson(res, 422, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	});
	routes.push({
		kind: "prefix",
		path: "/api/skin-center/we/web",
		handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!requireContentOrigin(req, res)) return;
			const pathname = new URL(req.url || "/", "http://localhost").pathname;
			let rest = "";
			try {
				rest = decodeURIComponent(pathname.slice(24));
			} catch {
				writeJson(res, 400, {
					ok: false,
					error: "bad-request"
				});
				return;
			}
			const token = rest.split("/")[0] ?? "";
			const entryAbs = mediaMap.get(token);
			if (!entryAbs) {
				writeJson(res, 404, {
					ok: false,
					error: "unknown-token"
				});
				return;
			}
			const root = dirname(entryAbs);
			const abs = resolve(root, rest.slice(token.length).replace(/^\/+/, "") || basename(entryAbs));
			if (abs !== root && !abs.startsWith(root + sep)) {
				writeJson(res, 403, {
					ok: false,
					error: "path-escape-rejected"
				});
				return;
			}
			if (!existsSync(abs) || !statSync(abs).isFile()) {
				writeJson(res, 404, {
					ok: false,
					error: "not-found"
				});
				return;
			}
			if (/\.html?$/i.test(abs)) {
				const html = readFileSync(abs, "utf8");
				const tag = "<script>window.__dshWeDefaultProps = " + JSON.stringify(webPropertyDefaults(root)).replace(/</g, "\\u003c") + ";<\/script><script src=\"/api/skin-center/we/shim.js\"><\/script>";
				const injected = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
				res.writeHead(200, {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-store",
					"access-control-allow-origin": "null"
				});
				res.end(injected);
				return;
			}
			serveFile(abs, req, res, openReadStream, { "Access-Control-Allow-Origin": "null" });
		}
	});
	const framePrefix = "/api/skin-center/we/scene-frame/";
	routes.push({
		kind: "prefix",
		path: "/api/skin-center/we/scene-frame",
		handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!requireSameOrigin(req, res)) return;
			const abs = resolveToken(req, res, framePrefix);
			if (!abs) return;
			(async () => {
				let mtime = 0;
				try {
					mtime = statSync(abs).mtimeMs;
				} catch {}
				const cacheDir = join(deps.storeDir, ".cache", "frames");
				const base = Buffer.from(abs, "utf8").toString("base64url");
				const key = base + "_v" + String(2) + "_" + String(Math.round(mtime)) + ".png";
				const cachePath = join(cacheDir, key);
				if (!existsSync(cachePath)) {
					const { extractSceneMainImage, extractSceneMainImageFromDir } = await Promise.resolve().then(() => pkg_extract_exports);
					const frame = abs.toLowerCase().endsWith(".json") ? extractSceneMainImageFromDir(dirname(abs)) : extractSceneMainImage(new Uint8Array(readFileSync(abs)));
					mkdirSync(cacheDir, { recursive: true });
					writeFileSync(cachePath, frame.png);
					pruneStaleSceneCache(cacheDir, base, key);
				}
				res.setHeader("Content-Type", "image/png");
				res.setHeader("Cache-Control", "no-store");
				pipeFile(cachePath, res, openReadStream);
			})().catch((error) => {
				if (error instanceof TexUnsupportedError) {
					writeJson(res, 422, {
						ok: false,
						error: "unsupported-tex-format",
						format: error.format,
						formatName: error.formatName,
						message: error.message
					});
					return;
				}
				writeJson(res, 422, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	});
	routes.push({
		kind: "prefix",
		path: "/api/skin-center/we/scene-runtime",
		handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!requireSameOrigin(req, res)) return;
			res.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store"
			});
			res.end(WE_SCENE_PLAYER_HTML);
		}
	});
	const sceneManifestPrefix = "/api/skin-center/we/scene-manifest/";
	routes.push({
		kind: "prefix",
		path: "/api/skin-center/we/scene-manifest",
		handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!requireContentOrigin(req, res)) return;
			const abs = resolveToken(req, res, sceneManifestPrefix);
			if (!abs) return;
			try {
				const token = Buffer.from(abs, "utf8").toString("base64url");
				const manifest = abs.toLowerCase().endsWith(".json") ? buildSceneManifestFromDir(dirname(abs), token) : buildSceneManifest(new Uint8Array(readFileSync(abs)), token, (() => {
					try {
						return JSON.parse(readFileSync(join(dirname(abs), "project.json"), "utf8"));
					} catch {
						return null;
					}
				})());
				if (!manifest) {
					writeJson(res, 404, {
						ok: false,
						error: "manifest-build-failed"
					});
					return;
				}
				writeJson(res, 200, {
					ok: true,
					manifest
				}, { "access-control-allow-origin": "null" });
			} catch (err) {
				writeJson(res, 500, {
					ok: false,
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}
	});
	routes.push({
		kind: "prefix",
		path: "/api/skin-center/we/scene-resource",
		handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!requireContentOrigin(req, res)) return;
			const pathname = new URL(req.url || "/", "http://localhost").pathname;
			let rest = "";
			try {
				rest = decodeURIComponent(pathname.slice(35));
			} catch {
				writeJson(res, 400, {
					ok: false,
					error: "bad-request"
				});
				return;
			}
			const token = rest.split("/")[0] ?? "";
			const entryAbs = mediaMap.get(token);
			if (!entryAbs) {
				writeJson(res, 404, {
					ok: false,
					error: "unknown-token"
				});
				return;
			}
			const subpath = rest.slice(token.length).replace(/^\/+/, "");
			if (!subpath) {
				writeJson(res, 400, {
					ok: false,
					error: "missing-subpath"
				});
				return;
			}
			try {
				const resBytes = entryAbs.toLowerCase().endsWith(".json") ? extractSceneResourceFromDir(dirname(entryAbs), subpath) : extractSceneResource(new Uint8Array(readFileSync(entryAbs)), subpath);
				if (!resBytes) {
					writeJson(res, 404, {
						ok: false,
						error: "resource-not-found"
					});
					return;
				}
				const isPng = resBytes.length > 8 && resBytes[0] === 137 && resBytes[1] === 80 && resBytes[2] === 78 && resBytes[3] === 71;
				const isMp4 = resBytes.length > 12 && resBytes[4] === 102 && resBytes[5] === 116 && resBytes[6] === 121 && resBytes[7] === 112;
				res.writeHead(200, {
					"content-type": isPng ? "image/png" : isMp4 ? "video/mp4" : "application/octet-stream",
					"cache-control": "no-store",
					"access-control-allow-origin": "null"
				});
				res.end(Buffer.from(resBytes));
			} catch (err) {
				writeJson(res, 500, {
					ok: false,
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}
	});
	/** Read the {id} field of a wallpaper POST body. */
	const readId = (body) => {
		if (typeof body !== "object" || body === null) return "";
		const id = body.id;
		return typeof id === "string" ? id : "";
	};
	/** Copy one library entry into the import store; dest must not exist. */
	const copyIntoStore = (entry, dest) => {
		mkdirSync(dest, { recursive: true });
		cpSync(entry.dir, join(dest, "project"), { recursive: true });
		const manifest = {
			sourceId: entry.id,
			title: entry.title,
			type: entry.type,
			srcMtime: entry.srcMtime,
			srcSize: entry.srcSize,
			importedAt: Date.now(),
			file: join("project", entry.file),
			preview: entry.preview ? join("project", entry.preview) : null
		};
		writeFileSync(join(dest, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
	};
	/** Register one JSON POST route with the standard error envelope. */
	const postJson = (path, run) => {
		routes.push({
			kind: "exact",
			path,
			handler: (req, res) => {
				if (req.method !== "POST") {
					writeJson(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				if (!requireSameOrigin(req, res)) return;
				readJsonBody(req).then((body) => {
					if (body === null) {
						writeJson(res, 400, {
							ok: false,
							error: "invalid-body"
						});
						return;
					}
					run(readId(body), res);
				}).catch((error) => {
					writeJson(res, 500, {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					});
				});
			}
		});
	};
	postJson("/api/skin-center/we/import", (id, res) => {
		if (id === "" || id.startsWith("imported/")) {
			writeJson(res, 400, {
				ok: false,
				error: "bad-id"
			});
			return;
		}
		const entry = freshInventory().wallpapers.find((w) => w.id === id);
		if (!entry) {
			writeJson(res, 404, {
				ok: false,
				error: "wallpaper-not-found"
			});
			return;
		}
		if (entry.source === "system") {
			writeJson(res, 400, {
				ok: false,
				error: "not-importable"
			});
			return;
		}
		const dest = join(deps.storeDir, safeStoreId(id));
		if (existsSync(dest)) {
			writeJson(res, 409, {
				ok: false,
				error: "already-imported"
			});
			return;
		}
		copyIntoStore(entry, dest);
		invalidateInventory();
		writeJson(res, 200, {
			ok: true,
			id: "imported/" + entry.id
		});
	});
	postJson("/api/skin-center/we/reimport", (id, res) => {
		if (!id.startsWith("imported/")) {
			writeJson(res, 400, {
				ok: false,
				error: "bad-id"
			});
			return;
		}
		const sourceId = id.slice(9);
		const dest = join(deps.storeDir, safeStoreId(sourceId));
		if (!existsSync(dest)) {
			writeJson(res, 404, {
				ok: false,
				error: "import-not-found"
			});
			return;
		}
		const source = freshInventory().wallpapers.find((w) => w.id === sourceId && w.source !== "imported");
		if (!source) {
			writeJson(res, 410, {
				ok: false,
				error: "source-gone"
			});
			return;
		}
		rmSync(dest, {
			recursive: true,
			force: true
		});
		copyIntoStore(source, dest);
		invalidateInventory();
		writeJson(res, 200, {
			ok: true,
			id
		});
	});
	postJson("/api/skin-center/we/remove", (id, res) => {
		if (!id.startsWith("imported/")) {
			writeJson(res, 400, {
				ok: false,
				error: "bad-id"
			});
			return;
		}
		const dest = join(deps.storeDir, safeStoreId(id.slice(9)));
		if (!existsSync(dest)) {
			writeJson(res, 404, {
				ok: false,
				error: "import-not-found"
			});
			return;
		}
		rmSync(dest, {
			recursive: true,
			force: true
		});
		invalidateInventory();
		writeJson(res, 200, { ok: true });
	});
	return routes;
}
//#endregion
//#region src/mount-once.ts
/**
* Host single-instance guard shared by the plugin family. The family bundle
* (dsh-web-all / dsh-skins) namespaces every child row id (web-ui-*), so
* the loader accepts a standalone install of the same package side by side;
* without this guard the second instance would still re-register the same
* webserver routes, tools, settings namespaces, and system-prompt sections
* and fail the boot. mountOnce makes the second host apply a no-op for the
* lifetime of the first instance (the browser half is already deduped by
* package name in the client module host).
*
* The registry rides a global symbol so two module instances of the same
* package (npm copy vs repository link) still share one verdict. cordis
* `ctx.effect` runs its callback immediately and treats the callback's
* return value as the fiber disposer, so the unmarker is returned, not run.
*/
const MOUNTED = Symbol.for("dsh-web.mounted-plugins");
function mountedSet() {
	const registry = globalThis;
	return registry[MOUNTED] ??= /* @__PURE__ */ new Set();
}
/**
* Wrap a cordis plugin apply so the package runs at most once per process.
* The first mount registers normally and unmarks when its fiber disposes;
* any later mount of the same package name is a no-op.
* @param packageName - npm package identity shared by every install source.
* @param fn - the original plugin apply.
* @returns an apply of the same shape.
*/
function mountOnce(packageName, fn) {
	return ((...args) => {
		const mounted = mountedSet();
		if (mounted.has(packageName)) return;
		mounted.add(packageName);
		args[0]?.effect?.(() => () => {
			mounted.delete(packageName);
		});
		return fn(...args);
	});
}
//#endregion
//#region src/core/custom-theme.ts
/** Versioned user theme derived from the official stock theme. */
const SKIN_CUSTOM_THEME_NS = "skin-custom-theme";
const CUSTOM_THEME_DEFAULTS = {
	version: 1,
	applied: false,
	light: {
		accent: "#4d6bfe",
		background: "#f7f8fa",
		foreground: "#262626",
		contrast: 50
	},
	dark: {
		accent: "#7c91ff",
		background: "#171719",
		foreground: "#f3f3f3",
		contrast: 50
	}
};
//#endregion
//#region src/index.ts
/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
const name = "ui-skin-center";
/** Services required before the skin-center can mount its routes. */
const inject = ["webServer"];
/**
* Settings namespace for the main-interface background scrim, owned by the
* skin center. The browser half spells the same string so it can bind the
* scope without depending on this Host package.
*/
const SKIN_BACKGROUND_NAMESPACE = "skin-background";
/** Versioned settings namespace for the official-theme palette editor. */
const SKIN_CUSTOM_THEME_NAMESPACE = SKIN_CUSTOM_THEME_NS;
const CustomThemeProfileSchema = z.object({
	accent: z.string().default(CUSTOM_THEME_DEFAULTS.light.accent),
	background: z.string().default(CUSTOM_THEME_DEFAULTS.light.background),
	foreground: z.string().default(CUSTOM_THEME_DEFAULTS.light.foreground),
	contrast: z.number().min(0).max(100).step(1).default(50)
});
/** Host-side persistence schema; browser normalization remains fail-closed. */
const SkinCustomThemeConfigSchema = z.object({
	version: z.number().min(1).max(1).step(1).default(1),
	applied: z.boolean().default(false),
	light: CustomThemeProfileSchema.default(CUSTOM_THEME_DEFAULTS.light),
	dark: z.object({
		accent: z.string().default(CUSTOM_THEME_DEFAULTS.dark.accent),
		background: z.string().default(CUSTOM_THEME_DEFAULTS.dark.background),
		foreground: z.string().default(CUSTOM_THEME_DEFAULTS.dark.foreground),
		contrast: z.number().min(0).max(100).step(1).default(50)
	}).default(CUSTOM_THEME_DEFAULTS.dark)
});
/**
* Runtime schema for SkinBackgroundConfig. Persists the master switch
* (`enabled`) alongside the background strength fields.
*/
const SkinBackgroundConfigSchema = z.object({
	enabled: z.boolean().default(SKIN_BACKGROUND_DEFAULTS.enabled),
	backgroundOpacity: z.number().min(0).max(100).step(5).default(SKIN_BACKGROUND_DEFAULTS.backgroundOpacity),
	backgroundBlurEmpty: z.number().min(0).max(20).step(1).default(SKIN_BACKGROUND_DEFAULTS.backgroundBlurEmpty),
	backgroundBlurContent: z.number().min(0).max(20).step(1).default(SKIN_BACKGROUND_DEFAULTS.backgroundBlurContent),
	inputCardBlur: z.number().min(0).max(20).step(1).default(SKIN_BACKGROUND_DEFAULTS.inputCardBlur),
	bubbleOpacity: z.number().min(0).max(100).step(5).default(SKIN_BACKGROUND_DEFAULTS.bubbleOpacity)
});
/**
* Settings namespace for the Wallpaper Engine bridge, owned by the skin
* center. The browser half renders the applied wallpaper behind the GUI and
* persists the selection here; the host half reads weLibraryDirs to extend
* the library scan beyond the auto-detected Steam folders.
*/
const SKIN_WALLPAPER_NAMESPACE = "skin-wallpaper";
/** Runtime schema for SkinWallpaperConfig. */
const SkinWallpaperConfigSchema = z.object({
	enabled: z.boolean().default(true),
	weLibraryDirs: z.array(z.string()).default([]),
	selection: z.string().default(""),
	mode: z.union(["live", "frame"]).default("live"),
	pauseOnHidden: z.boolean().default(true),
	dim: z.number().min(0).max(90).step(5).default(25),
	wallpaperBlur: z.number().min(0).max(60).step(1).default(0),
	wallpaperOpacity: z.number().min(0).max(100).step(5).default(100),
	fit: z.union([
		"cover",
		"contain",
		"fill"
	]).default("cover")
});
/**
* Register the skin-center API routes.
*
* Failure policy: route mounting problems are logged, never thrown — the web
* shell fails the whole boot when a plugin apply throws, and the skin center
* must not take the GUI down.
* @param ctx - cordis context.
*/
const apply = mountOnce("@linxin666/dsh-client-ui-skin-center", applyImpl);
function applyImpl(ctx) {
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, SKIN_BACKGROUND_NAMESPACE, SkinBackgroundConfigSchema, {}, {
			setSource: (source) => {
				const migration = migrateBackgroundFromSettings({
					activeStatePath: defaultActiveStatePath(),
					readSettings: source
				});
				for (const note of migration.notes) if (migration.migrated) console.info(`[ui-skin-center] background migration: ${note}`);
				else console.error(`[ui-skin-center] background migration: ${note}`);
			},
			onChange: () => {}
		});
	});
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, SKIN_CUSTOM_THEME_NAMESPACE, SkinCustomThemeConfigSchema, {
			...CUSTOM_THEME_DEFAULTS,
			light: { ...CUSTOM_THEME_DEFAULTS.light },
			dark: { ...CUSTOM_THEME_DEFAULTS.dark }
		}, {
			setSource: () => {},
			onChange: () => {}
		});
	});
	let wallpaperSource = () => ({});
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, SKIN_WALLPAPER_NAMESPACE, SkinWallpaperConfigSchema, {}, {
			setSource: (source) => {
				wallpaperSource = source;
			},
			onChange: () => {}
		});
	});
	const routes = [...makeSkinCenterV2Routes(), ...makeWeRoutes({
		getConfig: () => wallpaperSource(),
		storeDir: defaultWallpapersStoreDir(resolveHarnessHome())
	})];
	try {
		ctx.effect(() => {
			const disposers = [];
			try {
				for (const route of routes) disposers.push(ctx.webServer.register(route));
				const statePath = defaultActiveStatePath();
				const indexDeps = { readActiveId: () => readActiveSelection(statePath) };
				const collectSkinRows = makeSkinIndexRows(indexDeps);
				disposers.push(ctx.on("webserver/index-inject", (table) => {
					table.push(...collectSkinRows());
				}));
				disposers.push(ctx.webServer.tapIndex(makeSkinIndexTap(indexDeps)));
			} catch (error) {
				for (const dispose of disposers) dispose();
				throw error;
			}
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "ui-skin-center: routes");
	} catch (error) {
		console.error("[ui-skin-center] route registration failed:", error);
	}
	try {
		seedDefaultActiveSkin(defaultActiveStatePath(), (id) => findSkin(loadSkinCatalog(), id) !== null);
	} catch (error) {
		console.error("[ui-skin-center] default-skin seed failed:", error);
	}
	try {
		const statePath = defaultActiveStatePath();
		const migration = migrateLegacySelection({
			knownIds: loadSkinCatalog().skins.map((s) => s.manifest.id),
			activeStatePath: statePath
		});
		if (migration.failed) for (const note of migration.notes) console.error(`[ui-skin-center] legacy bridge: ${note}`);
		else if (migration.migrated !== null || migration.patchCleaned) for (const note of migration.notes) console.info(`[ui-skin-center] legacy bridge: ${note}`);
	} catch (error) {
		console.error("[ui-skin-center] legacy bridge failed:", error);
	}
}
//#endregion
export { SKIN_BACKGROUND_NAMESPACE, SKIN_CENTER_V2_PREFIX, SKIN_CUSTOM_THEME_NAMESPACE, SKIN_WALLPAPER_NAMESPACE, SkinBackgroundConfigSchema, SkinCssSafetyError, SkinCustomThemeConfigSchema, SkinWallpaperConfigSchema, WE_API_PREFIX, apply, auditTokenContract, builtinSkinsDir, canServeSkinHooks, defaultActiveStatePath, findSkin, inject, loadSkinCatalog, makeSkinCenterV2Routes, makeWeRoutes, name, readActiveSelection, resolveInsideSkin, transformSkinCss, userSkinsDir, validateSkinManifestV2, writeActiveSelection };
