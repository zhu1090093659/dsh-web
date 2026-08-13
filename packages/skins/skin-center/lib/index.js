import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "schemastery";
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
//#region src/skin-switch.ts
/**
* In-process skin switching for the skin center — the official `dsh-skin use`
* CLI, re-implemented as a pure ESM module so the host half never needs a
* `dsh-skin` binary on PATH (the bug zhu1090093659/dsh-web-ui#5: "dsh-skin
* CLI not found on PATH").
*
* `use` owns the `dsh-skin managed` section of `~/.dsh/cordis.patch.yml`
* (atomic rewrite, hot-reloaded by the DSH config watcher within seconds,
* no restart) and the profile node_modules symlink that makes the selected
* skin resolvable from the web profile. `current` reads the active back.
*
* The behaviour/text is a 1:1 port of scripts/dsh-skin (`use`/`current`;
* workspace assets live in packages/skins/<id>). The skin registry is
* derived from each packages/skins/<id>/skin.json instead of a hand-written
* dictionary, so adding a skin needs no code change here.
* @module @linxin666/dsh-client-ui-skin-center/skin-switch
*/
/** Repo layout: skin bundles live at packages/skins/<id>. */
const SKINS_DIR$1 = fileURLToPath(new URL("../../../skins/", import.meta.url));
/** Managed patch-section delimiters (the CLI's SINGLE authority boundaries). */
const MANAGED_START = "# --- dsh-skin managed (auto-generated; do not edit) ---";
const MANAGED_END = "# --- end dsh-skin managed ---";
/** The GUI profile this machine runs (dsh web); overridable via DSH_SKIN_PROFILE. */
const DEFAULT_PROFILE = process.env.DSH_SKIN_PROFILE ?? "web";
/**
* Parse the switch-relevant fields of one skin.json. Returns null for
* anything that is not a valid skin so it is simply skipped — never walking
* outside the skins tree (the id is validated before any path use).
* @param dir - directory name under packages/skins/.
*/
function readSkinMeta(dir) {
	try {
		const meta = JSON.parse(readFileSync(join(SKINS_DIR$1, dir, "skin.json"), "utf8"));
		if (typeof meta !== "object" || meta === null) return null;
		const record = meta;
		if (typeof record.id !== "string" || !/^[a-z0-9-]+$/.test(record.id)) return null;
		if (typeof record.package !== "string") return null;
		const wiring = record.wiring;
		const wiringRecord = typeof wiring === "object" && wiring !== null ? wiring : null;
		if (wiringRecord === null || typeof wiringRecord.id !== "string") return null;
		return {
			id: record.id,
			package: record.package,
			wiring: {
				id: wiringRecord.id,
				bundleWired: wiringRecord.bundleWired === true
			}
		};
	} catch {
		return null;
	}
}
/**
* Derive the skin registry from packages/skins/<id>/skin.json — the single
* source of truth (skin.json already carries package/wiring.id/bundleWired).
* Replaces the CLI's hand-maintained SKINS dictionary, so adding a skin
* needs no code change here.
* @returns skin id -> switch metadata.
*/
function loadRegistry() {
	const out = {};
	for (const dir of readdirSync(SKINS_DIR$1)) {
		const meta = readSkinMeta(dir);
		if (meta === null || meta.wiring === void 0 || meta.package === void 0) continue;
		out[meta.id] = {
			pkg: meta.package,
			id: meta.wiring.id,
			dir: join(SKINS_DIR$1, dir),
			bundleWired: meta.wiring.bundleWired === true
		};
	}
	return out;
}
/**
* The skins the bundle layer already wires (no insert row needed) — derived
* from each skin.json wiring.bundleWired (the repo's static truth, e.g. xp).
*
* TODO: the CLI also detects skins wired via the active profile's
* dsh.profile.bundles (bundleWiredFromProfile). A skin installed from the
* web profile's manifest is still represented by skin.json's flag in this
* repo; wire further profile-based detection here if ever needed.
* @param registry - the derived registry (or a partial override in tests).
*/
function wiredNames(registry) {
	const out = /* @__PURE__ */ new Set();
	for (const [name, skin] of Object.entries(registry)) if (skin.bundleWired) out.add(name);
	return out;
}
/**
* Drop legacy hand-written skin rows (insert rows with a name) and old touch
* comments. The CLI regex matched the historical @deepseek-ai scope; this
* also matches the current @linxin666 scope so stale rows are always cleaned.
* @param patch - raw patch file text.
*/
function stripLegacySkinRows(patch) {
	return patch.replace(/^    # [^\n]*\n    - id: ui-skin-[^\n]+\n      name: '@(?:deepseek-ai|linxin666)\/dsh-client-ui-skin-[^\n]+'\n/gm, "").replace(/^# \(touch\)[^\n]*\n?/gm, "").replace(/\n{3,}/g, "\n\n");
}
/**
* Remove the managed skin section. Throws on an unterminated section (a
* malformed boot patch must fail loudly, never be silently half-written).
* @param patch - raw patch file text.
*/
function stripManaged(patch) {
	const start = patch.indexOf(MANAGED_START);
	if (start === -1) return patch;
	const end = patch.indexOf(MANAGED_END, start);
	if (end === -1) throw new Error("managed skin section is unterminated; fix ~/.dsh/cordis.patch.yml");
	return patch.slice(0, start) + patch.slice(end + 30);
}
/**
* Render the managed section for a target skin (null = official stock look:
* every skin disabled, no insert row). A wired active skin also needs no
* insert row — the bundle layer already provides it.
* @param active - skin id, or null for the official stock look.
* @param registry - registry to render against (defaults to the repo registry).
*/
function renderManaged(active, registry = loadRegistry()) {
	const wired = wiredNames(registry);
	const lines = [MANAGED_START];
	for (const name of Object.keys(registry)) {
		if (name === active) continue;
		lines.push(`- id: ${registry[name].id}`, "  disabled: true");
	}
	if (active !== null && !wired.has(active)) lines.push("- insert:", `    - id: ${registry[active].id}`, `      name: '${registry[active].pkg}'`);
	lines.push(MANAGED_END);
	return lines.join("\n");
}
/**
* Which skin is currently enabled, read from a patch file. With bundle-wired
* skins the active skin carries no insert row, so the answer is the
* bundle-wired skin that the patch does NOT disable; the legacy reading
* (last non-disabled skin row) remains for pre-bundle layouts.
* @param patch - raw patch file text.
* @param registry - registry to read against (defaults to the repo registry).
*/
function currentActive(patch, registry = loadRegistry()) {
	const disabled = /* @__PURE__ */ new Set();
	for (const m of patch.matchAll(/^- id: (ui-skin-[a-z0-9-]+)\n  disabled: true/gm)) disabled.add(m[1]);
	const wired = wiredNames(registry);
	for (const [name, skin] of Object.entries(registry)) if (wired.has(name) && !disabled.has(skin.id)) return name;
	const rows = [...patch.matchAll(/(?:^|\n) *- id: (ui-skin-[a-z0-9-]+)(\n *disabled: (true))?/g)];
	const enabled = [];
	for (const m of rows) if (!m[3]) enabled.push(m[1]);
	return enabled.length ? enabled[enabled.length - 1].replace("ui-skin-", "") : null;
}
/**
* Resolve the DSH paths under a HOME. home/profile are injectable so tests
* can point at a throwaway HOME (mirrors scripts/dsh-skin.test.mjs).
* @param home - home dir (defaults to the process HOME).
* @param profile - profile name (defaults to DSH_SKIN_PROFILE or 'web').
*/
function resolvePaths(home = homedir(), profile = DEFAULT_PROFILE) {
	return {
		patchPath: join(home, ".dsh", "cordis.patch.yml"),
		profileModulesDir: join(home, ".dsh", "profiles", profile, "node_modules")
	};
}
function readPatch(patchPath) {
	try {
		return readFileSync(patchPath, "utf8");
	} catch {
		return "";
	}
}
/**
* Atomic replace: write a sibling temp file then rename over the target, so a
* crash mid-write can never leave a half-written boot patch and the config
* watcher only ever sees complete content (the CLI's own strategy). Creates
* the parent dir if missing.
* @param filePath - target file.
* @param next - full next content.
*/
function writePatchAtomic(filePath, next) {
	mkdirSync(dirname(filePath), { recursive: true });
	const tmp = `${filePath}.tmp-${process.pid}`;
	writeFileSync(tmp, next);
	renameSync(tmp, filePath);
}
/**
* Make the profile node_modules symlink for a skin. Returns true when a new
* link was created, false when it already pointed at the skin dir. Refuses
* to touch a non-symlink target (that path is not ours to clobber).
* @param entry - the skin switch entry.
* @param profileModulesDir - the profile's node_modules dir.
*/
function ensureSymlink(entry, profileModulesDir) {
	const target = join(profileModulesDir, entry.pkg);
	let stat = null;
	try {
		stat = lstatSync(target);
	} catch {}
	if (stat) {
		if (!stat.isSymbolicLink()) throw new Error(`${target} exists and is not a symlink — refusing to touch it`);
		if (readlinkSync(target) === entry.dir) return false;
		unlinkSync(target);
	}
	mkdirSync(dirname(target), { recursive: true });
	symlinkSync(entry.dir, target);
	return true;
}
/** Windows/privilege code points where symlinkSync fails. */
const SYMLINK_PRIVILEGE_CODES = [
	"EPERM",
	"EACCES",
	"ENOSYS"
];
/**
* Wrap a symlink-labelled failure (typ. Windows without developer mode or
* elevated privileges) in a human-readable hint instead of a bare fs error.
* @param caller - the operation label for the error message.
* @param fn - the fs call to run.
*/
function symlinkFriendly(caller, fn) {
	try {
		return fn();
	} catch (error) {
		const code = error?.code;
		if (typeof code === "string" && SYMLINK_PRIVILEGE_CODES.includes(code)) throw new Error(`${caller} 需要为皮肤创建符号链接，但权限不足（${code}）。Windows 请以管理员身份或开启开发者模式后重试；若已手动把皮肤装进 profile，可跳过本步。`);
		throw error;
	}
}
/**
* Optional soft warning when a skin is not resolvable from the web profile
* (the CLI prints it; surfaced as a soft hint, not a failure — the patch
* stays authoritative).
* @param entry - the skin switch entry.
* @param profileModulesDir - the profile's node_modules dir.
*/
function checkInstalled(entry, profileModulesDir) {
	let ok = false;
	try {
		ok = lstatSync(join(profileModulesDir, entry.pkg)).isSymbolicLink();
	} catch {}
	return ok ? null : `${entry.pkg} 未安装到 profile；先用 dsh-skin install ${entry.id.replace(/^ui-skin-/, "")}（或 dsh plugin --profile ${DEFAULT_PROFILE} add ${entry.dir}）安装，否则加载会失败。`;
}
/**
* Switch the active skin. Equivalent to `dsh-skin use <name>`:
*   1. makes the profile node_modules symlink for a non-official skin,
*   2. rewrites the managed section of the boot patch atomically.
* Returns the same stdout the CLI would print (drives the GUI message).
* @param name - skin id, or 'official' for the stock look.
* @param opts - injectable HOME/profile/registry (tests use a throwaway HOME).
* @returns the human-facing confirmation string.
*/
function useSkin(name, opts = {}) {
	const official = name === "official";
	const registry = opts.registry ?? loadRegistry();
	if (!official && registry[name] === void 0) throw new Error(`unknown skin "${name}". Known: ${Object.keys(registry).join(", ")} (or "official" for the stock look)`);
	const paths = resolvePaths(opts.home, opts.profile);
	const notices = [];
	if (!official) {
		const entry = registry[name];
		symlinkFriendly(`switching to "${name}"`, () => {
			ensureSymlink(entry, paths.profileModulesDir);
		});
		const warn = checkInstalled(entry, paths.profileModulesDir);
		if (warn !== null) notices.push(warn);
	}
	const next = `${stripLegacySkinRows(stripManaged(readPatch(paths.patchPath))).replace(/\s+$/, "")}\n\n${renderManaged(official ? null : name, registry)}\n`;
	writePatchAtomic(paths.patchPath, next);
	const core = official ? "restored the official stock look — the config watcher applies it within seconds; refresh the page to see it." : `skin switched to "${name}" — the config watcher applies it within seconds; refresh the page (or the manifest re-fetches) to see it.`;
	return notices.length ? `${core}\n${notices.join("\n")}` : core;
}
/**
* Read the active skin, mirroring `dsh-skin current` (prints the name or
* 'none'). The patch is read from disk by default; a caller can pass the text
* it already holds.
* @param patch - optional pre-read patch text.
* @param opts - injectable HOME/profile/registry.
* @returns the active skin id, or 'none' for the stock look.
*/
function currentSkin(patch, opts = {}) {
	const paths = resolvePaths(opts.home, opts.profile);
	const registry = opts.registry ?? loadRegistry();
	return currentActive(patch ?? readPatch(paths.patchPath), registry) ?? "none";
}
//#endregion
//#region src/routes.ts
/**
* Skin-center HTTP routes — the browser half talks to the host through plain
* same-origin endpoints: JSON for state/apply, plus the bundle route serving
* each skin's prebuilt `lib/client.js` as a same-origin script for live
* try-on (the GUI never embeds the ~700KB of art base64 in its own bundle).
* The host half switches skins in-process (src/skin-switch.ts) — an ESM port
* of the `dsh-skin` CLI that owns the `dsh-skin managed` section of
* `~/.dsh/cordis.patch.yml` and the profile symlink, exactly like
* `dsh-skin use <name>` — so no `dsh-skin` binary is required on PATH
* (the bug zhu1090093659/dsh-web-ui#5). The config watcher hot-reloads the
* patch within seconds and the frontend reloads the page to pick up the new
* boot graph. Same pattern as dsh-pet's `/api/pet` family.
*
* Unlike pet's behavioral endpoints, `/apply` writes the user's boot config,
* so every route also rejects cross-site requests (Sec-Fetch-Site / Origin
* fence) — a malicious webpage must not be able to switch the user's skin
* through a localhost CSRF post.
* @module @linxin666/dsh-client-ui-skin-center/routes
*/
/** Browser-facing base path of the skin-center API. */
const SKIN_CENTER_API_PREFIX = "/api/skin-center";
/** One JSON response. */
function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
/** Require the method or answer 405. */
function requireMethod(req, res, method) {
	if (req.method === method) return true;
	json(res, 405, {
		ok: false,
		error: "method-not-allowed"
	});
	return false;
}
/**
* Same-origin fence. Browsers send `Sec-Fetch-Site` on every fetch: same-site
* and cross-site pages both resolve their `Origin` here, so the checks are:
* a `cross-site` fetch is always rejected, and an `Origin` that does not
* match the request `Host` is rejected. Requests without either header
* (curl, node http, old browsers) pass — this is a local single-user tool,
* and the fence only targets the cross-site browser vector.
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
/** Read a JSON request body (bounded). */
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
/**
* In-process runner fulfilling the `dsh-skin <args>` contract used by the
* routes (`['use', <name>]` and `['current']`). It never spawns a PATH
* binary — it calls the embedded port of the CLI (src/skin-switch.ts), which
* writes the boot patch and the profile symlink directly. Returns the same
* stdout text the CLI would print, and rejects with the same error messages.
* @param args - command arguments (e.g. `['use', 'qq98']`).
*/
function runDshSkin(args) {
	const [command, argument] = args;
	switch (command) {
		case "use": return Promise.resolve(useSkin(argument));
		case "current": return Promise.resolve(currentSkin(void 0));
		default: return Promise.reject(/* @__PURE__ */ new Error(`unexpected dsh-skin command: ${args.join(" ")}`));
	}
}
/** A GET route wrapping one async call, fenced to same-origin requests. */
function getRoute(path, run) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "GET")) return;
			if (!requireSameOrigin(req, res)) return;
			run().then((value) => json(res, 200, value), (error) => {
				json(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
}
/** A POST JSON route wrapping one async call, fenced to same-origin requests. */
function postRoute(path, run) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "POST")) return Promise.resolve();
			if (!requireSameOrigin(req, res)) return Promise.resolve();
			return readJsonBody(req).then((body) => {
				return run(typeof body === "object" && body !== null ? body : {}).then((value) => json(res, 200, value), (error) => {
					json(res, 400, {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					});
				});
			}, (error) => {
				json(res, 400, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
}
/** Repo layout: skin bundles live at packages/skins/<id>/lib/client.js. */
const SKINS_DIR = fileURLToPath(new URL("../../../skins/", import.meta.url));
/**
* Map skin id -> directory under packages/skins/, scanned from each
* skin.json. The id is validated against this map (never used as a raw
* path) so the bundle route cannot be walked off the skins tree.
* @returns skin id -> directory name.
*/
function skinDirectories() {
	const out = /* @__PURE__ */ new Map();
	for (const dir of readdirSync(SKINS_DIR)) {
		const metaFile = join(SKINS_DIR, dir, "skin.json");
		if (!statSync(metaFile, { throwIfNoEntry: false })) continue;
		let meta;
		try {
			meta = JSON.parse(readFileSync(metaFile, "utf8"));
		} catch {
			continue;
		}
		if (typeof meta.id === "string" && /^[a-z0-9-]+$/.test(meta.id)) out.set(meta.id, dir);
	}
	return out;
}
/**
* The on-demand bundle route: serve packages/skins/<id>/lib/client.js as a
* same-origin script. Try-on loads it through a script tag (the kernel's
* own bundle-loading mechanism), so the body registers the skin factory on
* `window.__ModuleLoader__` without any eval.
* @returns the prefix route (matches /api/skin-center/bundle/<id>).
*/
function bundleRoute() {
	const prefix = `${SKIN_CENTER_API_PREFIX}/bundle`;
	return {
		kind: "prefix",
		path: prefix,
		handler: (req, res) => {
			if (!requireMethod(req, res, "GET")) return;
			if (!requireSameOrigin(req, res)) return;
			let id;
			try {
				id = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname.slice(prefix.length + 1));
			} catch {
				json(res, 400, {
					ok: false,
					error: "invalid-skin-id"
				});
				return;
			}
			if (!/^[a-z0-9-]+$/.test(id)) {
				json(res, 400, {
					ok: false,
					error: "invalid-skin-id"
				});
				return;
			}
			try {
				const dir = skinDirectories().get(id);
				if (dir === void 0) {
					json(res, 404, {
						ok: false,
						error: "skin-not-found"
					});
					return;
				}
				const bundle = join(SKINS_DIR, dir, "lib", "client.js");
				if (!statSync(bundle, { throwIfNoEntry: false })) {
					json(res, 404, {
						ok: false,
						error: "skin-bundle-missing"
					});
					return;
				}
				res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
				res.end(readFileSync(bundle, "utf8"));
			} catch (error) {
				json(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}
	};
}
/**
* Build the skin-center route family.
* @param deps - optional runner override (tests).
*/
function makeSkinCenterRoutes(deps = {}) {
	const run = deps.run ?? runDshSkin;
	const current = () => run(["current"]).then((out) => out.trim() || "none");
	return [
		getRoute(`${SKIN_CENTER_API_PREFIX}/state`, async () => ({
			ok: true,
			active: await current()
		})),
		bundleRoute(),
		postRoute(`${SKIN_CENTER_API_PREFIX}/apply`, async (body) => {
			const official = body.official === true;
			const skin = body.skin;
			if (official) {
				if (skin !== void 0) throw new Error("invalid-skin: skin and official are mutually exclusive");
			} else if (typeof skin !== "string" || skin === "") throw new Error("invalid-skin: pass a skin name or official: true");
			const out = await run(["use", official ? "official" : skin]);
			return {
				ok: true,
				active: await current(),
				message: out.trim()
			};
		})
	];
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
/** Runtime schema for SkinBackgroundConfig. */
const SkinBackgroundConfigSchema = z.object({ backgroundOpacity: z.number().min(0).max(100).step(5).default(0) });
/**
* Register the skin-center API routes.
*
* Failure policy: route mounting problems are logged, never thrown — the web
* shell fails the whole boot when a plugin apply throws, and the skin center
* must not take the GUI down.
* @param ctx - cordis context.
*/
function apply(ctx) {
	installSettingsSection(ctx, SKIN_BACKGROUND_NAMESPACE, SkinBackgroundConfigSchema, {}, {
		setSource: () => {},
		onChange: () => {}
	});
	const routes = makeSkinCenterRoutes();
	try {
		ctx.effect(() => {
			const disposers = [];
			try {
				for (const route of routes) disposers.push(ctx.webServer.register(route));
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
}
//#endregion
export { SKIN_BACKGROUND_NAMESPACE, SKIN_CENTER_API_PREFIX, SkinBackgroundConfigSchema, apply, inject, makeSkinCenterRoutes, name };
