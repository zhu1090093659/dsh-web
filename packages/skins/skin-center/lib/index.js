import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "schemastery";
import { chmodSync, cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { transform } from "lightningcss";
import { execFileSync } from "node:child_process";
//#region src/http-utils.ts
/** One JSON response. */
function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
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
	const origin = req.headers.origin;
	if (typeof origin === "string" && origin !== "" && origin !== "null") {
		const host = req.headers.host;
		if (typeof host !== "string" || host === "") return false;
		try {
			if (new URL(origin).host !== host) return false;
		} catch {
			return false;
		}
	}
	return true;
}
/** Reject cross-site requests with 403. */
function requireSameOrigin(req, res) {
	if (isSameOriginRequest(req)) return true;
	json(res, 403, {
		ok: false,
		error: "cross-site-request-rejected"
	});
	return false;
}
/** Read a JSON request body (bounded to 64KB). */
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 64 * 1024) {
				reject(/* @__PURE__ */ new Error("body-too-large"));
				queueMicrotask(() => req.destroy());
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (chunks.length === 0) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(/* @__PURE__ */ new Error("invalid-json"));
			}
		});
		req.on("error", reject);
	});
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
const SKIN_ID = /^[a-z][a-z0-9-]{0,31}$/;
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
	if (typeof input.id !== "string" || !SKIN_ID.test(input.id)) errors.push(`manifest.id: must match ${SKIN_ID} (got ${JSON.stringify(input.id)})`);
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
* @module @linxin666/dsh-client-ui-skin-center/skin-repo
*/
/** Built-in skins ship inside the skin-center package under skins/. */
function builtinSkinsDir(fromUrl = import.meta.url) {
	return join(dirname(fileURLToPath(fromUrl)), "..", "skins");
}
/** User skins live in $DSH_HOME/skins/. DSH_SKINS_HOME overrides (tests). */
function userSkinsDir(env = process.env) {
	const override = env.DSH_SKINS_HOME;
	if (override && override.trim() !== "") return resolve(override);
	return join(resolveHarnessHome(), "skins");
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
				if (manifest.facets?.client) winnerWarnings.push("declares hooks.mjs, but hooks only run for built-in (same-review) skins; the hooks facet will be refused");
				const winner = {
					manifest,
					origin: "user",
					dir,
					warnings: winnerWarnings
				};
				claimed.set(manifest.id, winner);
				catalog.skins.push(winner);
			} else existing.warnings.push(`duplicate ${spec.origin} id "${manifest.id}" ignored from ${dir}`);
			continue;
		}
		const warnings = [...result.warnings];
		if (spec.origin === "user" && manifest.facets?.client) warnings.push("declares hooks.mjs, but hooks only run for built-in (same-review) skins; the hooks facet will be refused");
		const entry = {
			manifest,
			origin: spec.origin,
			dir,
			warnings
		};
		claimed.set(manifest.id, entry);
		catalog.skins.push(entry);
	}
}
/**
* Snapshot the skin catalog from both sources. Never throws: unreadable
* roots and invalid skins land in diagnostics instead.
*/
function loadSkinCatalog(options = {}) {
	const catalog = {
		skins: [],
		diagnostics: [],
		capturedAt: (options.now ?? Date.now)()
	};
	const claimed = /* @__PURE__ */ new Map();
	collectSource({
		origin: "builtin",
		root: options.builtinDir ?? builtinSkinsDir()
	}, catalog, claimed);
	collectSource({
		origin: "user",
		root: options.userDir ?? userSkinsDir()
	}, catalog, claimed);
	catalog.skins.sort((a, b) => (a.manifest.order ?? Number.MAX_SAFE_INTEGER) - (b.manifest.order ?? Number.MAX_SAFE_INTEGER) || a.manifest.id.localeCompare(b.manifest.id));
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
//#endregion
//#region src/active-state.ts
/**
* Active-skin selection persistence (issue #506): a tiny JSON document under
* $DSH_HOME written by POST /api/skin-center/v2/active and read on every
* index.html response by the tapIndex adapter. Kept dependency-free and
* synchronous: the tap runs per response and must never await.
* @module @linxin666/dsh-client-ui-skin-center/active-state
*/
/** Default location: $DSH_HOME/skin-center-active.json. */
function defaultActiveStatePath() {
	return join(userSkinsDir(), "..", "skin-center-active.json");
}
/** Read the persisted active skin id (null = stock look / unreadable). */
function readActiveSelection(path) {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed.active === "string" ? parsed.active : null;
	} catch {
		return null;
	}
}
/** Persist the active skin id (creates the parent directory). */
function writeActiveSelection(path, id) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ active: id }, null, 2) + "\n", "utf8");
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
		if (/^:root\b/.test(selectorText.trim()) && close !== -1) {
			const props = css.slice(span.openBrace + 1, close).split("\n").map((line) => line.trim()).filter((line) => /^--[\w-]+\s*:/.test(line) || /^background-(color|image)\s*:/.test(line));
			if (props.length > 0) out += `\n${scope} body {\n  ${props.join("\n  ")}\n}\n`;
		}
		cursor = close === -1 ? span.openBrace : close + 1;
	}
	out += css.slice(cursor);
	out += `\n${scope} [id="root"] { background: transparent; }\n`;
	if (options.deriveFallbacks === true) {
		const fallbacks = deriveFallbackTokens(defined);
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
*  - GET  /catalog                     catalog snapshot (skins + diagnostics)
*  - GET  /skins/<id>/stylesheet       transformed + scoped skin.css
*  - GET  /skins/<id>/patches          transformed + scoped patches.css (404 when absent)
*  - GET  /skins/<id>/hooks.mjs        the escape-hatch entry (404 when absent)
*  - GET  /skins/<id>/assets/<path>    static in-directory assets (incl. preview/)
*  - GET  /active                      the persisted active skin id (or null)
*  - POST /active                      persist the active skin id (same-origin fenced)
*
* The stylesheet/patches responses pass through the CSS safety pipeline
* (force-scoped under html[data-dsh-skin="<id>"], whitelist fail-closed), so
* the browser can inject them blindly. hooks.mjs is served verbatim — it is
* trusted, same-review same-release code (high sensitivity, see contracts/).
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
		json(res, 404, {
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
			json(res, 422, {
				ok: false,
				error: "css-whitelist-violation",
				violations: error.violations
			});
			return;
		}
		json(res, 500, {
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
		json(res, 404, {
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
function readBody(req) {
	return new Promise((resolveBody, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 16 * 1024) {
				reject(/* @__PURE__ */ new Error("body-too-large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolveBody(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(/* @__PURE__ */ new Error("invalid-json"));
			}
		});
		req.on("error", reject);
	});
}
/**
* Build the v2 route set. Registration is the caller's job (the host entry
* keeps the mount-once discipline).
*/
function makeSkinCenterV2Routes(deps = {}) {
	const loadCatalog = deps.loadCatalog ?? (() => loadSkinCatalog());
	const activeStatePath = deps.activeStatePath ?? defaultActiveStatePath();
	const catalogHandler = (_req, res) => {
		const catalog = loadCatalog();
		json(res, 200, {
			ok: true,
			capturedAt: catalog.capturedAt,
			skins: catalog.skins.map((s) => ({
				origin: s.origin,
				warnings: s.warnings,
				manifest: s.manifest
			})),
			diagnostics: catalog.diagnostics
		});
	};
	const skinPrefix = `${SKIN_CENTER_V2_PREFIX}/skins/`;
	const skinsHandler = (req, res) => {
		const [id, ...tail] = new URL(req.url ?? "/", "http://localhost").pathname.slice(skinPrefix.length).split("/");
		const sub = tail.join("/");
		const catalog = loadCatalog();
		const entry = id ? findSkin(catalog, id) : null;
		if (!entry) {
			json(res, 404, {
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
				json(res, 404, {
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
				json(res, 404, {
					ok: false,
					error: "no-hooks"
				});
				return;
			}
			if (entry.origin !== "builtin") {
				json(res, 403, {
					ok: false,
					error: "hooks-require-review",
					origin: entry.origin
				});
				return;
			}
			const abs = resolveInsideSkin(entry, facet.entry);
			if (!abs || !existsSync(abs)) {
				json(res, 404, {
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
		json(res, 404, {
			ok: false,
			error: "unknown-skin-resource"
		});
	};
	const activeGetHandler = (_req, res) => {
		json(res, 200, {
			ok: true,
			active: readActiveSelection(activeStatePath)
		});
	};
	const activePostHandler = async (req, res) => {
		if (!requireSameOrigin(req, res)) return;
		let body;
		try {
			body = await readBody(req);
		} catch {
			json(res, 400, {
				ok: false,
				error: "invalid-body"
			});
			return;
		}
		const active = body.active;
		if (active !== null && typeof active !== "string") {
			json(res, 400, {
				ok: false,
				error: "active-must-be-string-or-null"
			});
			return;
		}
		if (typeof active === "string" && !findSkin(loadCatalog(), active)) {
			json(res, 404, {
				ok: false,
				error: "skin-not-found"
			});
			return;
		}
		writeActiveSelection(activeStatePath, active);
		json(res, 200, {
			ok: true,
			active
		});
	};
	return [
		{
			kind: "exact",
			path: `${SKIN_CENTER_V2_PREFIX}/catalog`,
			handler: catalogHandler
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
				json(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
			}
		}
	];
}
//#endregion
//#region src/tap-index-adapter.ts
/**
* tapIndex adapter (issue #506, contract section 8) — the ONLY module in the
* repo that calls webServer.tapIndex for skin purposes. All tapIndex usage
* converges here so an upstream semantic change has exactly one fail-closed
* off switch.
*
* What it does on every index.html response:
*  1. stamps html[data-dsh-skin="<id>"] for the persisted active skin;
*  2. inserts render-blocking <link> tags for the transformed stylesheet
*     (and patches, when declared) so first paint is already skinned
*     (anti-FOUC; mirrors the official boot-theme precedent).
*
* Fail-closed: any problem (no active skin, unknown id, invalid manifest,
* malformed html) yields the unmodified document — the stock look — plus at
* most one warning per process per reason. The tap never throws.
* @module @linxin666/dsh-client-ui-skin-center/tap-index-adapter
*/
const HTML_TAG = /<html(\s[^>]*)?>/i;
const HEAD_CLOSE = /<\/head>/i;
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
	const base = `${SKIN_CENTER_V2_PREFIX}/skins/${skinId}`;
	const links = [`<link rel="stylesheet" href="${base}/stylesheet" data-dsh-skin-link="stylesheet">`];
	if (hasPatches) links.push(`<link rel="stylesheet" href="${base}/patches" data-dsh-skin-link="patches">`);
	return links.join("");
}
/**
* Create the index.html tap. Pure html→html, safe to register with
* webServer.tapIndex; never throws.
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
			const links = skinLinkTags(active, entry.manifest.contributes.patches !== void 0);
			return stampSkinAttribute(html, active).replace(HEAD_CLOSE, `${links}</head>`);
		} catch (error) {
			warnOnce("tap-error", `skin index tap failed closed: ${error?.message ?? error}`);
			return html;
		}
	};
}
//#endregion
//#region src/legacy-bridge.ts
/**
* Legacy bridge (issue #506, migration path): ONE-SHOT, THIN. On the first
* v2 boot it reads the retired dsh-skin machinery's state — the
* "dsh-skin managed" section of the active profile's cordis.patch.yml —
* migrates the active skin id into the v2 selection store
* (skin-center-active.json), and strips the managed/legacy skin rows so the
* config watcher's next reload boots without the old bundle. No old runtime
* is kept: after the migration the managed section is gone for good.
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
* Remove the managed skin section. Throws on an unterminated section (a
* malformed boot patch must fail loudly, never be silently half-written).
*/
function stripManaged(patch) {
	const start = patch.indexOf(MANAGED_START);
	if (start === -1) return patch;
	const end = patch.indexOf(MANAGED_END, start);
	if (end === -1) throw new Error("managed skin section is unterminated; fix the harness cordis.patch.yml");
	return patch.slice(0, start) + patch.slice(end + 30);
}
/** Remove - insert: items left with no - id: rows after legacy cleanup. */
function dropEmptyInserts(text) {
	const lines = text.split("\n");
	const out = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();
		if (/^-\s*insert:\s*$/.exec(trimmed) === null) {
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
	for (const m of patch.matchAll(/^- id: (ui-skin-[a-z0-9-]+)\n  disabled: true/gm)) disabled.add(m[1].replace("ui-skin-", ""));
	const candidates = knownIds.filter((id) => !disabled.has(id));
	return candidates.length === 1 ? candidates[0] : null;
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
		notes
	};
	try {
		const patchPath = options.patchPath ?? resolveHarnessPaths().patchPath;
		let patch;
		try {
			patch = readFileSync(patchPath, "utf8");
		} catch {
			notes.push("no readable cordis.patch.yml; nothing to migrate");
			return result;
		}
		const hasLegacyState = patch.includes("# --- dsh-skin managed (auto-generated; do not edit) ---") || /name:\s*['"]?@linxin666\/dsh-client-ui-skin-/.test(patch);
		const alreadyMigrated = readActiveSelection(options.activeStatePath) !== null;
		if (!hasLegacyState) {
			notes.push("no legacy managed skin state; nothing to migrate");
			return result;
		}
		if (!alreadyMigrated) {
			const active = readLegacyActiveId(patch, options.knownIds);
			if (active !== null) {
				writeActiveSelection(options.activeStatePath, active);
				result.migrated = active;
				notes.push(`migrated active skin "${active}" to the v2 selection store`);
			} else notes.push("legacy state resolves to the stock look; selection store left unset");
		} else notes.push("v2 selection already present; skipped id migration");
		let cleaned = stripLegacySkinState(patch);
		if (cleaned.split(/\r?\n/).every((line) => line.trim() === "" || line.trimStart().startsWith("#"))) cleaned = "[]\n";
		if (cleaned !== patch) {
			(options.writePatch ?? writePatchAtomic)(patchPath, cleaned);
			result.patchCleaned = true;
			notes.push("stripped the legacy managed skin rows from cordis.patch.yml");
		}
		return result;
	} catch (error) {
		notes.push(`legacy migration failed closed: ${error?.message ?? error}`);
		return result;
	}
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
*   3. The import store (<harnessHome>/skin-center/wallpapers/<id>/): copies
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
function steamPathFromRegistry(run = (args) => execFileSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe"), [
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
		const match = /SteamPath\s+REG_SZ\s+(.+)/i.exec(run([]));
		return match ? match[1].trim() : null;
	} catch {
		return null;
	}
}
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
		const registry = opts.registry ?? (() => steamPathFromRegistry());
		const probes = [...new Set([registry(), ...STEAM_PROBE_DIRS].filter((d) => !!d))];
		const libraries = [];
		for (const probe of probes) {
			const vdf = join(probe, "steamapps", "libraryfolders.vdf");
			if (exists(vdf)) try {
				libraries.push(...librariesFromVdf(readFileSync(vdf, "utf8")));
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
	const registry = opts.registry ?? (() => steamPathFromRegistry());
	const probes = [...new Set([registry(), ...STEAM_PROBE_DIRS].filter((d) => !!d))];
	const libraries = [];
	for (const probe of probes) {
		const vdf = join(probe, "steamapps", "libraryfolders.vdf");
		if (exists(vdf)) try {
			libraries.push(...librariesFromVdf(readFileSync(vdf, "utf8")));
		} catch {}
	}
	return [...new Set(libraries)];
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
		if (dir !== void 0 && existsSync(dir)) for (const entry of scanProjectsRoot(dir, "local")) add(entry);
	}
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
//#endregion
//#region src/we-shim-source.ts
/**
* The Wallpaper Engine Web API shim, served to web-type wallpaper iframes.
*
* Web wallpapers are authored against APIs that Wallpaper Engine injects
* into its CEF host before the page scripts run: property listeners (user
* customization values), the audio-level listener (64 stereo bands), and
* LED/RGB hardware hooks. Inside the skin center there is no editor session
* and no hardware, so the shim installs benign defaults: properties resolve
* to empty objects, the audio listener registers but is fed silence, and
* hardware APIs become no-ops. Wallpapers that never touch these APIs are
* unaffected; wallpapers that do degrade to their non-reactive visuals
* instead of crashing on undefined globals.
* @module @linxin666/dsh-client-ui-skin-center/we-shim-source
*/
/** The shim source, injected ahead of every web wallpaper HTML document. */
const WE_SHIM_JS = [
	"(function () {",
	"  if (window.__dshWeShim) return;",
	"  window.__dshWeShim = true;",
	"  var props = {};",
	"  window.wallpaperPropertyListener = {",
	"    applyUserProperties: function (p) {",
	"      if (p && typeof p === \"object\") { for (var k in p) { props[k] = p[k]; } }",
	"    },",
	"    applyGeneralProperties: function () {},",
	"    setUserProperty: function (k, v) { props[k] = v; },",
	"    getUserProperty: function (k) { return props[k]; }",
	"  };",
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
//#region src/we-routes.ts
/**
* Wallpaper Engine HTTP routes for the skin center — the browser half talks
* to the host through same-origin endpoints under /api/skin-center/we:
*
*   GET  /inventory           → JSON wallpaper list (library + import store)
*   GET  /media/<token>       → video stream (Range supported)
*   GET  /preview/<token>     → preview image
*   GET  /web/<token>/<path>  → web-wallpaper project files (HTML is served
*                               with the WE API shim injected)
*   GET  /shim.js             → the WE API shim source (we-shim-source.ts)
*   GET  /scene-frame/<token> → PNG of a scene wallpaper's main texture,
*                               decoded in-process (pkg-extract.ts), cached
*                               under the import store's .cache directory
*   POST /import              → copy a library wallpaper into the import
*                               store (<harnessHome>/skin-center/wallpapers)
*   POST /reimport            → refresh an imported copy from its source
*   POST /remove              → delete an imported copy
*
* Tokens are base64url of an absolute path, issued only by the inventory
* handler, so a crafted token can never reach a path the library scan did
* not already expose. Every route rides the skin-center same-origin fence
* (routes.ts) — wallpaper imports must not be triggerable cross-site.
*
* Compliance note: this module only ever reads files already present on the
* user's machine (their own Wallpaper Engine library) or copies them within
* it. Nothing is downloaded, uploaded, or redistributed.
* @module @linxin666/dsh-client-ui-skin-center/we-routes
*/
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
/** Stream one file with Range support (video seeking needs 206). */
function serveFile(absPath, req, res) {
	if (!existsSync(absPath) || !statSync(absPath).isFile()) {
		json(res, 404, {
			ok: false,
			error: "not-found"
		});
		return;
	}
	const size = statSync(absPath).size;
	res.setHeader("Content-Type", mimeFor(absPath));
	res.setHeader("Accept-Ranges", "bytes");
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
		createReadStream(absPath, {
			start,
			end
		}).pipe(res);
		return;
	}
	res.setHeader("Content-Length", String(size));
	createReadStream(absPath).pipe(res);
}
/** Build the route family. */
function makeWeRoutes(deps) {
	const mediaMap = /* @__PURE__ */ new Map();
	const tokenFor = (absPath) => {
		const token = Buffer.from(absPath, "utf8").toString("base64url");
		mediaMap.set(token, absPath);
		return token;
	};
	const freshInventory = () => buildInventory({
		manualDirs: deps.getConfig().weLibraryDirs ?? [],
		storeDir: deps.storeDir
	});
	const entryToJson = (entry) => {
		const hasFile = existsSync(entry.fileAbs);
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
			previewUrl: entry.previewAbs ? "/api/skin-center/we/preview/" + tokenFor(entry.previewAbs) : null
		};
	};
	/** Resolve a token from a prefix route, or answer 404. */
	const resolveToken = (req, res, prefix) => {
		const pathname = new URL(req.url || "/", "http://localhost").pathname;
		const token = decodeURIComponent(pathname.slice(prefix.length).split("/")[0] ?? "");
		const abs = mediaMap.get(token);
		if (!abs) {
			json(res, 404, {
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
				json(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			if (!requireSameOrigin(req, res)) return;
			try {
				const inventory = freshInventory();
				json(res, 200, {
					ok: true,
					installDir: inventory.installDir,
					total: inventory.total,
					portableCount: inventory.portableCount,
					wallpapers: inventory.wallpapers.map(entryToJson)
				});
			} catch (error) {
				json(res, 500, {
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
				json(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			res.writeHead(200, {
				"content-type": "text/javascript; charset=utf-8",
				"cache-control": "no-store"
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
					json(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				const abs = resolveToken(req, res, prefix);
				if (abs) serveFile(abs, req, res);
			}
		});
	}
	routes.push({
		kind: "prefix",
		path: "/api/skin-center/we/web",
		handler: (req, res) => {
			if (req.method !== "GET") {
				json(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			const pathname = new URL(req.url || "/", "http://localhost").pathname;
			const rest = decodeURIComponent(pathname.slice(24));
			const token = rest.split("/")[0] ?? "";
			const entryAbs = mediaMap.get(token);
			if (!entryAbs) {
				json(res, 404, {
					ok: false,
					error: "unknown-token"
				});
				return;
			}
			const root = dirname(entryAbs);
			const abs = resolve(root, rest.slice(token.length).replace(/^\/+/, "") || basename(entryAbs));
			if (abs !== root && !abs.startsWith(root + sep)) {
				json(res, 403, {
					ok: false,
					error: "path-escape-rejected"
				});
				return;
			}
			if (!existsSync(abs) || !statSync(abs).isFile()) {
				json(res, 404, {
					ok: false,
					error: "not-found"
				});
				return;
			}
			if (/\.html?$/i.test(abs)) {
				const html = readFileSync(abs, "utf8");
				const tag = "<script src=\"/api/skin-center/we/shim.js\"><\/script>";
				const injected = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
				res.writeHead(200, {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-store"
				});
				res.end(injected);
				return;
			}
			serveFile(abs, req, res);
		}
	});
	const framePrefix = "/api/skin-center/we/scene-frame/";
	routes.push({
		kind: "prefix",
		path: "/api/skin-center/we/scene-frame",
		handler: (req, res) => {
			if (req.method !== "GET") {
				json(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			const abs = resolveToken(req, res, framePrefix);
			if (!abs) return;
			(async () => {
				let mtime = 0;
				try {
					mtime = statSync(abs).mtimeMs;
				} catch {}
				const cacheDir = join(deps.storeDir, ".cache", "frames");
				const cachePath = join(cacheDir, Buffer.from(abs, "utf8").toString("base64url") + "_" + String(Math.round(mtime)) + ".png");
				if (!existsSync(cachePath)) {
					const { extractSceneMainImage, extractSceneMainImageFromDir } = await import("./pkg-extract-Dmt-pjwV.js");
					const frame = abs.toLowerCase().endsWith(".json") ? extractSceneMainImageFromDir(dirname(abs)) : extractSceneMainImage(new Uint8Array(readFileSync(abs)));
					mkdirSync(cacheDir, { recursive: true });
					writeFileSync(cachePath, frame.png);
				}
				res.setHeader("Content-Type", "image/png");
				res.setHeader("Cache-Control", "no-store");
				createReadStream(cachePath).pipe(res);
			})().catch((error) => {
				json(res, 422, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
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
					json(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				if (!requireSameOrigin(req, res)) return;
				readJsonBody(req).then((body) => run(readId(body), res)).catch((error) => {
					json(res, 500, {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					});
				});
			}
		});
	};
	postJson("/api/skin-center/we/import", (id, res) => {
		if (id === "" || id.startsWith("imported/")) {
			json(res, 400, {
				ok: false,
				error: "bad-id"
			});
			return;
		}
		const entry = freshInventory().wallpapers.find((w) => w.id === id);
		if (!entry) {
			json(res, 404, {
				ok: false,
				error: "wallpaper-not-found"
			});
			return;
		}
		const dest = join(deps.storeDir, safeStoreId(id));
		if (existsSync(dest)) {
			json(res, 409, {
				ok: false,
				error: "already-imported"
			});
			return;
		}
		copyIntoStore(entry, dest);
		json(res, 200, {
			ok: true,
			id: "imported/" + entry.id
		});
	});
	postJson("/api/skin-center/we/reimport", (id, res) => {
		if (!id.startsWith("imported/")) {
			json(res, 400, {
				ok: false,
				error: "bad-id"
			});
			return;
		}
		const sourceId = id.slice(9);
		const dest = join(deps.storeDir, safeStoreId(sourceId));
		if (!existsSync(dest)) {
			json(res, 404, {
				ok: false,
				error: "import-not-found"
			});
			return;
		}
		const source = freshInventory().wallpapers.find((w) => w.id === sourceId && w.source !== "imported");
		if (!source) {
			json(res, 410, {
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
		json(res, 200, {
			ok: true,
			id
		});
	});
	postJson("/api/skin-center/we/remove", (id, res) => {
		if (!id.startsWith("imported/")) {
			json(res, 400, {
				ok: false,
				error: "bad-id"
			});
			return;
		}
		const dest = join(deps.storeDir, safeStoreId(id.slice(9)));
		if (!existsSync(dest)) {
			json(res, 404, {
				ok: false,
				error: "import-not-found"
			});
			return;
		}
		rmSync(dest, {
			recursive: true,
			force: true
		});
		json(res, 200, { ok: true });
	});
	return routes;
}
//#endregion
//#region src/mount-once.ts
/**
* Host single-instance guard shared by the plugin family. The family bundle
* (dsh-web-ui-all / dsh-skins) namespaces every child row id (web-ui-*), so
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
const MOUNTED = Symbol.for("dsh-web-ui.mounted-plugins");
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
const SKIN_BACKGROUND_NAMESPACE = settingsNamespace("skin-background");
/**
* Runtime schema for SkinBackgroundConfig. Persists the master switch
* (`enabled`) alongside the background strength fields.
*/
const SkinBackgroundConfigSchema = z.object({
	enabled: z.boolean().default(true),
	backgroundOpacity: z.number().min(0).max(100).step(5).default(0),
	backgroundBlurEmpty: z.number().min(0).max(20).step(1).default(0),
	backgroundBlurContent: z.number().min(0).max(20).step(1).default(0)
});
/**
* Settings namespace for the Wallpaper Engine bridge, owned by the skin
* center. The browser half renders the applied wallpaper behind the GUI and
* persists the selection here; the host half reads weLibraryDirs to extend
* the library scan beyond the auto-detected Steam folders.
*/
const SKIN_WALLPAPER_NAMESPACE = settingsNamespace("skin-wallpaper");
/** Runtime schema for SkinWallpaperConfig. */
const SkinWallpaperConfigSchema = z.object({
	enabled: z.boolean().default(true),
	weLibraryDirs: z.array(z.string()).default([]),
	selection: z.string().default(""),
	mode: z.union(["live", "frame"]).default("live"),
	pauseOnHidden: z.boolean().default(true),
	dim: z.number().min(0).max(90).step(5).default(25),
	wallpaperBlur: z.number().min(0).max(60).step(1).default(0)
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
	installSettingsSection(ctx, SKIN_BACKGROUND_NAMESPACE, SkinBackgroundConfigSchema, {}, {
		setSource: () => {},
		onChange: () => {}
	});
	let wallpaperSource = () => ({});
	installSettingsSection(ctx, SKIN_WALLPAPER_NAMESPACE, SkinWallpaperConfigSchema, {}, {
		setSource: (source) => {
			wallpaperSource = source;
		},
		onChange: () => {}
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
				disposers.push(ctx.webServer.tapIndex(makeSkinIndexTap({ readActiveId: () => readActiveSelection(statePath) })));
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
		const statePath = defaultActiveStatePath();
		const migration = migrateLegacySelection({
			knownIds: loadSkinCatalog().skins.map((s) => s.manifest.id),
			activeStatePath: statePath
		});
		for (const note of migration.notes) console.info(`[ui-skin-center] legacy bridge: ${note}`);
	} catch (error) {
		console.error("[ui-skin-center] legacy bridge failed:", error);
	}
}
//#endregion
export { SKIN_BACKGROUND_NAMESPACE, SKIN_CENTER_V2_PREFIX, SKIN_WALLPAPER_NAMESPACE, SkinBackgroundConfigSchema, SkinCssSafetyError, SkinWallpaperConfigSchema, WE_API_PREFIX, apply, builtinSkinsDir, defaultActiveStatePath, findSkin, inject, loadSkinCatalog, makeSkinCenterV2Routes, makeWeRoutes, name, readActiveSelection, resolveInsideSkin, transformSkinCss, userSkinsDir, validateSkinManifestV2, writeActiveSelection };
