import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "schemastery";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
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
/**
* Walk up from a file location to the nearest @linxin666/ scoped dir
* whose entries actually hold skin packages (dsh-skins carrier or
* dsh-client-ui-skin-* packages). pnpm's virtual store realpaths packages
* into node_modules/.pnpm/<pkg>@<ver>/node_modules/<name>, so a plain
* '../../' from the skin-center package can never see its siblings there —
* this anchor finds the scoped dir that owns them.
* @param fromDir - the realpathed package dir to walk up from.
* @returns the scoped skin dir (the skins root), or null when none is found.
*/
function findScopedAnchor(fromDir) {
	let current = fromDir;
	for (;;) {
		const scoped = join(current, "@linxin666");
		try {
			for (const entry of readdirSync(scoped)) {
				if (entry === "dsh-skins") return scoped;
				if (entry.startsWith("dsh-client-ui-skin-") && entry !== "dsh-client-ui-skin-center") return scoped;
			}
		} catch {}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
/**
* Resolve the directory that holds the skin packages (each a dir carrying a
* skin.json). Candidates, in order:
*  - monorepo / flat npm layout: new URL('../../', import.meta.url)
*    (packages/skins/ or node_modules/@linxin666/);
*  - pnpm virtual-store layout: the nearest @linxin666/ scoped dir found by
*    walking up from this package's realpathed location;
*  - the legacy '../../../skins/' spelling (which pointed at
*    node_modules/skins/ under npm — the ENOENT of
*    zhu1090093659/dsh-web-ui#21/#33/#34), kept as a fallback.
* DSH_SKINS_DIR overrides everything (tests use it).
* @param fromUrl - the module URL to resolve from (defaults to this module's
*   own import.meta.url); injectable so tests can place the module inside a
*   simulated install layout and exercise the real candidate chain.
*/
function resolveSkinsDir(fromUrl = import.meta.url) {
	const fromEnv = process.env.DSH_SKINS_DIR;
	if (fromEnv !== void 0 && fromEnv !== "") return fromEnv;
	const here = fileURLToPath(fromUrl);
	const candidates = [
		fileURLToPath(new URL("../../", fromUrl)),
		findScopedAnchor(dirname(here)),
		fileURLToPath(new URL("../../../skins/", fromUrl))
	].filter((candidate) => candidate !== null);
	for (const candidate of candidates) if (listSkinDirCandidates(candidate).length > 0) return candidate;
	return candidates[0];
}
/** The skin-package root for this install (see resolveSkinsDir). */
const SKINS_DIR = resolveSkinsDir();
/** Managed patch-section delimiters (the CLI's SINGLE authority boundaries). */
const MANAGED_START = "# --- dsh-skin managed (auto-generated; do not edit) ---";
const MANAGED_END = "# --- end dsh-skin managed ---";
/** The GUI profile this machine runs (dsh web); overridable via DSH_SKIN_PROFILE. */
const DEFAULT_PROFILE = process.env.DSH_SKIN_PROFILE ?? "web";
/**
* Parse the switch-relevant fields of one skin.json. Returns null for
* anything that is not a valid skin so it is simply skipped — never walking
* outside the skins tree (the id is validated before any path use).
* @param absDir - absolute path of the candidate skin directory.
*/
function readSkinMeta(absDir) {
	try {
		const meta = JSON.parse(readFileSync(join(absDir, "skin.json"), "utf8"));
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
* Enumerate every candidate skin directory under a skins root. Two shapes:
*  - direct subdirectories carrying a skin.json (monorepo packages/skins/<id>,
*    and per-skin npm packages @linxin666/dsh-client-ui-skin-<id>);
*  - the bundled-skins carrier: @linxin666/dsh-skins/skins/<id> (skin assets
*    shipped inside the dsh-skins aggregate so npm needs no per-skin
*    package names). Directories without a skin.json are skipped.
* @param skinsDir - the skins root.
* @returns absolute candidate dirs (possibly empty).
*/
function listSkinDirCandidates(skinsDir) {
	const out = [];
	let entries;
	try {
		entries = readdirSync(skinsDir);
	} catch {
		return out;
	}
	const isDir = (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
	for (const dir of entries) {
		const candidate = join(skinsDir, dir);
		if (lstatSync(candidate, { throwIfNoEntry: false })?.isSymbolicLink() === true) continue;
		if (!isDir(candidate)) continue;
		if (statSync(join(candidate, "skin.json"), { throwIfNoEntry: false })) out.push(candidate);
	}
	const bundled = join(skinsDir, "dsh-skins", "skins");
	let subdirs;
	try {
		subdirs = readdirSync(bundled);
	} catch {
		return out;
	}
	for (const sub of subdirs) {
		const subDir = join(bundled, sub);
		if (!isDir(subDir)) continue;
		if (statSync(join(subDir, "skin.json"), { throwIfNoEntry: false })) out.push(subDir);
	}
	return out;
}
/**
* Derive the skin registry from each skin dir's skin.json — the single
* source of truth (skin.json already carries package/wiring.id/bundleWired).
* Replaces the CLI's hand-maintained SKINS dictionary, so adding a skin
* needs no code change here. Candidate dirs come from
* listSkinDirCandidates (direct skin dirs + the dsh-skins bundled carrier).
* The root is injectable so tests can point at either install layout.
* @param skinsDir - the skins root (defaults to the resolved install layout).
* @returns skin id -> switch metadata.
*/
function loadRegistry(skinsDir = SKINS_DIR) {
	const out = {};
	const seenReal = /* @__PURE__ */ new Set();
	for (const dir of listSkinDirCandidates(skinsDir)) {
		let real;
		try {
			real = realpathSync(dir);
		} catch {
			real = dir;
		}
		if (seenReal.has(real)) {
			console.warn("[skin-center] duplicate skin dir (realpath) \"" + real + "\": keeping the real directory, ignoring " + dir);
			continue;
		}
		seenReal.add(real);
		const meta = readSkinMeta(dir);
		if (meta === null || meta.wiring === void 0 || meta.package === void 0) continue;
		if (out[meta.id] !== void 0) {
			console.warn("[skin-center] duplicate skin id \"" + meta.id + "\": keeping " + out[meta.id].dir + ", ignoring " + dir);
			continue;
		}
		out[meta.id] = {
			pkg: meta.package,
			id: meta.wiring.id,
			dir,
			bundleWired: meta.wiring.bundleWired === true
		};
	}
	return out;
}
/**
* The skins the bundle layer already wires (no insert row needed) — derived
* from each skin.json wiring.bundleWired (the repo's static truth).
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
* Make the profile node_modules link for a skin. Returns true when a new
* link was created, false when the target was already resolvable.
*
* A target that already resolves (a REAL installed directory, e.g. the npm
* layout where the skin package sits at node_modules/@linxin666/..., or a
* symlink/junction pointing at the skin dir) is left untouched — there is
* nothing to link. Only an existing link pointing elsewhere is refreshed.
* A plain FILE target is still refused (that path is not ours to clobber).
*
* On win32 the link falls back to a directory junction (absolute target) when
* symlink creation fails with a privilege error, so no Developer Mode or
* elevation is required (zhu1090093659/dsh-web-ui#24).
* @param entry - the skin switch entry.
* @param profileModulesDir - the profile's node_modules dir.
*/
/** Canonical path a symlink resolves to, tolerant of a degraded link (a
* self-referential link whose realpath would throw ELOOP); '' when absent. */
function resolveLinkReal(linkPath) {
	try {
		return realpathSync(linkPath);
	} catch {
		return "";
	}
}
function ensureSymlink(entry, profileModulesDir) {
	const target = join(profileModulesDir, entry.pkg);
	let entryReal;
	try {
		entryReal = realpathSync(entry.dir);
	} catch {
		entryReal = entry.dir;
	}
	if (entry.dir === target || entryReal === target) return false;
	let stat = null;
	try {
		stat = lstatSync(target);
	} catch {}
	if (stat) if (stat.isSymbolicLink()) {
		if (resolveLinkReal(target) === entryReal) return false;
		if (process.platform === "win32" && stat.isDirectory()) rmdirSync(target);
		else unlinkSync(target);
	} else if (stat.isDirectory()) {
		if (isSkinPackageDir(target, entry)) return false;
		throw new Error(target + " exists as a directory but does not look like " + entry.pkg + " — refusing to treat it as installed");
	} else throw new Error(target + " exists and is not a symlink or directory — refusing to touch it");
	mkdirSync(dirname(target), { recursive: true });
	try {
		symlinkSync(entry.dir, target);
	} catch (error) {
		const code = error?.code;
		if (process.platform === "win32" && typeof code === "string" && SYMLINK_PRIVILEGE_CODES.includes(code)) symlinkSync(entry.dir, target, "junction");
		else throw error;
	}
	return true;
}
/**
* Whether an existing directory at a profile link path really is the target
* skin's installed package (skin.json id + package match). Keeps the
* npm-install-layout pass-through from silently accepting an unrelated
* directory left over at the link path.
* @param dir - the directory to inspect.
* @param entry - the expected skin.
*/
function isSkinPackageDir(dir, entry) {
	try {
		const meta = JSON.parse(readFileSync(join(dir, "skin.json"), "utf8"));
		if (typeof meta !== "object" || meta === null) return false;
		const record = meta;
		return record.id === entry.id.replace(/^ui-skin-/, "") && record.package === entry.pkg;
	} catch {
		return false;
	}
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
* Whether the skin package is actually resolvable as a plugin from the web
* profile - the same directory contract the boot graph relies on when it
* loads the `useSkin` insert row. Unlike the old soft warning, this is a
* hard gate: the skin-center /apply endpoint must not report ok:true for a
* skin the host cannot load. The npm aggregate layout shipped skin dirs
* without a package.json + host entry, so /apply wrote the patch, reported
* success, and the boot then died on MODULE_NOT_FOUND .../package.json.
*
* The check is structural and deterministic (pure fs): resolves what node
* would - the profile-target package dir must carry a package.json whose
* name is this skin's package, and a host entry (main, else index.js) that
* actually exists. That is exactly the resolution that failed before.
* @param entry - the skin switch entry.
* @param profileModulesDir - the profile's node_modules dir.
* @returns an error message when the skin is not resolvable, else null.
*/
function checkResolvable(entry, profileModulesDir) {
	const target = join(profileModulesDir, entry.pkg);
	if (!statSync(target, { throwIfNoEntry: false })?.isDirectory()) return `${entry.pkg} 未安装到 profile（profile 中无 ${target}）。请先用 dsh-skin install ${entry.id.replace(/^ui-skin-/, "")} 安装，否则宿主无法加载。`;
	const pkgPath = join(target, "package.json");
	if (!statSync(pkgPath, { throwIfNoEntry: false })) return `${entry.pkg} 在 profile 中缺少 package.json（${pkgPath}）——聚合包皮肤目录未带可解析包元数据。`;
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(pkgPath, "utf8"));
	} catch {
		parsed = {};
	}
	if (parsed.name !== entry.pkg) return `${entry.pkg} 解析到的 package.json 名为 ${String(parsed.name)}，不是本皮肤（${pkgPath}）。`;
	const mainPath = join(target, typeof parsed.main === "string" ? parsed.main : "index.js");
	if (!statSync(mainPath, { throwIfNoEntry: false })) return `${entry.pkg} 缺少 host 入口 ${mainPath}（package.json main 未指到可加载文件）。`;
	return null;
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
	if (!official) {
		const entry = registry[name];
		symlinkFriendly(`switching to "${name}"`, () => {
			ensureSymlink(entry, paths.profileModulesDir);
		});
		const problem = checkResolvable(entry, paths.profileModulesDir);
		if (problem !== null) throw new Error(problem);
	}
	const next = `${stripLegacySkinRows(stripManaged(readPatch(paths.patchPath))).replace(/\s+$/, "")}\n\n${renderManaged(official ? null : name, registry)}\n`;
	writePatchAtomic(paths.patchPath, next);
	return official ? "restored the official stock look — the config watcher applies it within seconds; refresh the page to see it." : `skin switched to "${name}" — the config watcher applies it within seconds; refresh the page (or the manifest re-fetches) to see it.`;
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
/**
* Map skin id -> directory under the skins root, scanned from each
* skin.json. The id is validated against this map (never used as a raw
* path) so the bundle route cannot be walked off the skins tree. The root
* resolves per install layout (monorepo packages/skins/, npm
* node_modules/@linxin666/) and candidates include the bundled dsh-skins
* carrier (npm layout) — see skin-switch resolveSkinsDir /
* listSkinDirCandidates.
* @returns skin id -> directory name.
*/
/** Memoized id -> dir map; invalidated when the skins root (or the bundled
* carrier dir) changes on disk, so a skin added mid-session still appears
* without restarting. */
let directoriesCache = null;
function skinDirectories() {
	const rootStat = statSync(SKINS_DIR, { throwIfNoEntry: false });
	const carrierStat = statSync(join(SKINS_DIR, "dsh-skins", "skins"), { throwIfNoEntry: false });
	const key = `${rootStat?.mtimeMs ?? -1}|${carrierStat?.mtimeMs ?? -1}`;
	if (directoriesCache !== null && directoriesCache.key === key) return directoriesCache.map;
	const out = /* @__PURE__ */ new Map();
	for (const dir of listSkinDirCandidates(SKINS_DIR)) {
		let meta;
		try {
			meta = JSON.parse(readFileSync(join(dir, "skin.json"), "utf8"));
		} catch {
			continue;
		}
		if (typeof meta.id === "string" && /^[a-z0-9-]+$/.test(meta.id)) out.set(meta.id, dir);
	}
	directoriesCache = {
		key,
		map: out
	};
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
				const bundle = join(dir, "lib", "client.js");
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
