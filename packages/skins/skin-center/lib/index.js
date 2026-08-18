import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "schemastery";
import { chmodSync, cpSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
//#region src/skin-switch.ts
/**
* In-process skin switching for the skin center — the official `dsh-skin use`
* CLI, re-implemented as a pure ESM module so the host half never needs a
* `dsh-skin` binary on PATH (the bug zhu1090093659/dsh-web-ui#5: "dsh-skin
* CLI not found on PATH").
*
* `use` owns the `dsh-skin managed` section of the active profile's
* `cordis.patch.yml` (atomic rewrite, hot-reloaded by the DSH config watcher
* within seconds, no restart) and the profile node_modules symlink that makes
* the selected skin resolvable from the running profile. `current` reads the
* active state back. Keeping the patch profile-scoped prevents non-Web
* profiles such as dsh-tui from trying to resolve browser-only skin packages.
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
/** Legal npm package name (scoped or unscoped). skin.json `package` is joined
* into profile node_modules paths and rendered into YAML, so it must never
* carry path separators, quotes, newlines, or leading dots. */
const NPM_PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/** Legal cordis loader entry id for a skin insert row. */
const WIRING_ID_RE = /^ui-skin-[a-z0-9-]+$/;
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
		if (typeof record.package !== "string" || !NPM_PACKAGE_NAME_RE.test(record.package)) return null;
		const wiring = record.wiring;
		const wiringRecord = typeof wiring === "object" && wiring !== null ? wiring : null;
		if (wiringRecord === null || typeof wiringRecord.id !== "string" || !WIRING_ID_RE.test(wiringRecord.id)) return null;
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
* from each skin.json wiring.bundleWired (the repo's static truth). Skins
* wired by an installed per-skin bundle are detected dynamically per profile
* by activeSkinIsBundleWired / registryWithProfileWiring.
* @param registry - the derived registry (or a partial override in tests).
*/
function wiredNames(registry) {
	const out = /* @__PURE__ */ new Set();
	for (const [name, skin] of Object.entries(registry)) if (skin.bundleWired) out.add(name);
	return out;
}
/**
* Drop legacy hand-written skin rows (insert rows with a name) and old touch
* comments. Historical writers emitted a comment line above the row with
* either npm scope, but the row must go regardless of the comment line,
* indentation or scope — any leftover insert row for a ui-skin-* id plus the
* managed section's own row produces two insert rows for one loader id, and
* the boot fails with "duplicate loader entry id" (issue #267). Id-target
* rows (`- id: ui-skin-xp` + `disabled: true`) carry no `name:` line and
* must survive: they are the mutual-exclusion wiring, not inserts.
* @param patch - raw patch file text.
*/
function stripLegacySkinRows(patch) {
	const lines = patch.split(/\r?\n/);
	const kept = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (/^\s*- id:\s*(ui-skin-[a-z0-9-]+)\s*$/.exec(line) !== null) {
			const next = lines[i + 1];
			if ((next === void 0 ? null : /^\s*name:\s*['"]?@[a-z0-9][a-z0-9._-]*\/dsh-client-ui-skin-[^'"]*['"]?\s*$/.exec(next)) !== null) {
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
/** Remove `- insert:` items left with no `- id:` rows after legacy cleanup,
* so an emptied block cannot perturb the loader or later renders. Blocks that
* still carry rows (any plugin id, skin or not) are kept byte-for-byte. */
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
* Remove the managed skin section. Throws on an unterminated section (a
* malformed boot patch must fail loudly, never be silently half-written).
* @param patch - raw patch file text.
*/
function stripManaged(patch) {
	const start = patch.indexOf(MANAGED_START);
	if (start === -1) return patch;
	const end = patch.indexOf(MANAGED_END, start);
	if (end === -1) throw new Error("managed skin section is unterminated; fix the harness cordis.patch.yml");
	return patch.slice(0, start) + patch.slice(end + 30);
}
/**
* Drop bare top-level empty flow lists (`[]`) left by the stock profile
* template. The managed skin section below provides the actual patch array,
* and an empty flow list followed by block entries is not parseable YAML
* ("end of the stream or a document separator is expected"), which breaks the
* next dsh boot. Nested `list: []` mapping values are untouched (the line
* does not match a standalone `[]`). Runs before
* normalizePatchForManagedAppend so a template `[]` sitting above the
* user's own block rows is removed instead of failing that stricter check.
* @param patch - raw patch file text.
*/
function stripEmptyPatchList(patch) {
	return patch.replace(/^[ \t]*\[\s*\][ \t]*\r?\n?/gm, "");
}
/**
* Prepare a user patch for appending the managed block sequence. DSH creates
* new profile overlays with a flow-style empty sequence (`[]`); appending
* block rows after that root would create a second YAML root and break boot.
* Existing block sequences and comments are preserved byte-for-byte.
* @param patch - raw patch text after old managed rows were removed.
*/
function normalizePatchForManagedAppend(patch) {
	const lines = (patch.match(/[^\r\n]*(?:\r\n|\n|$)/g) ?? []).filter((line) => line !== "");
	const significant = [];
	let sawDocumentStart = false;
	for (let index = 0; index < lines.length; index += 1) {
		const body = lines[index].replace(/\r?\n$/, "");
		const text = body.trim();
		if (text === "" || text.startsWith("#")) continue;
		if (/^---(?:\s+#.*)?$/.test(text)) {
			if (sawDocumentStart || significant.length > 0) throw new Error("cordis.patch.yml must contain one YAML document before dsh-skin can append its managed section");
			sawDocumentStart = true;
			continue;
		}
		if (/^\.\.\.(?:\s+#.*)?$/.test(text)) throw new Error("cordis.patch.yml document-end markers are not supported before the dsh-skin managed section");
		significant.push({
			index,
			text,
			indent: body.length - body.trimStart().length
		});
	}
	if (significant.length === 0) return patch;
	const root = significant[0];
	if (/^\[\]\s*(?:#.*)?$/.test(root.text)) {
		if (significant.length !== 1) throw new Error("cordis.patch.yml must contain one top-level sequence before dsh-skin can append its managed section");
		lines.splice(root.index, 1);
		return lines.join("");
	}
	if (!root.text.startsWith("-")) throw new Error("cordis.patch.yml must use a top-level block sequence before dsh-skin can append its managed section");
	for (const entry of significant.slice(1)) if (entry.indent < root.indent || entry.indent === root.indent && !entry.text.startsWith("-")) throw new Error("cordis.patch.yml must contain one top-level block sequence before dsh-skin can append its managed section");
	return patch;
}
/** Render one managed block after the user patch using its existing line ending. */
function appendManagedPatch(patch, managed) {
	const eol = patch.includes("\r\n") ? "\r\n" : "\n";
	const base = patch.replace(/\s+$/, "");
	const block = managed.replace(/\n/g, eol);
	return `${base}${base === "" ? "" : eol + eol}${block}${eol}`;
}
/** YAML single-quoted scalar: a literal single quote doubles. `wiring.id` is
* already validated before it ever reaches a registry, so only `package`
* needs escaping here. */
function yamlSingleQuote(value) {
	return `'${value.replace(/'/g, "''")}'`;
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
	if (active !== null && !wired.has(active)) lines.push("- insert:", `    - id: ${registry[active].id}`, `      name: ${yamlSingleQuote(registry[active].pkg)}`);
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
* Count the `insert:` list rows for a loader entry id in a patch text (the
* rows a skin bundle would contribute, as opposed to home-layer
* `disabled: true` id-target rows). The patch format is small and
* line-based; a YAML parser dependency is not worth the weight for this one
* probe. Two insert rows for one id fail the boot with "duplicate loader
* entry id" (issue #267), so the count is what the self-heal in useSkin
* keys on.
* @param patch - raw patch text.
* @param id - the loader entry id to look for.
*/
function countInsertId(patch, id) {
	let count = 0;
	let insertIndent = null;
	for (const line of patch.split(/\r?\n/)) {
		const trimmed = line.trimStart();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		const indent = line.length - trimmed.length;
		if (/^- insert:\s*$/.exec(trimmed) !== null) {
			insertIndent = indent;
			continue;
		}
		if (insertIndent === null) continue;
		if (indent <= insertIndent) {
			insertIndent = null;
			if (/^- insert:\s*$/.exec(trimmed) !== null) insertIndent = indent;
			continue;
		}
		const row = /^- id:\s*['"]?([^'"]+)['"]?\s*$/.exec(trimmed);
		if (row !== null && row[1] === id) count += 1;
	}
	return count;
}
/** Whether a patch contains at least one insert row for `id` (see countInsertId). */
function patchHasInsertId(patch, id) {
	return countInsertId(patch, id) > 0;
}
/**
* Bundle entries from the active profile manifest's `dsh.profile.bundles` —
* the authoritative wiring source used by scripts/dsh-skin
* (`bundleWiredFromProfile`, lines 68-75). Unreadable/malformed manifests
* contribute nothing, matching the CLI's try/catch fallback.
* @param profileManifestPath - `<harnessHome>/profiles/<profile>/package.json`.
*/
function readProfileBundles(profileManifestPath) {
	const out = /* @__PURE__ */ new Set();
	if (profileManifestPath === void 0) return out;
	try {
		const manifest = JSON.parse(readFileSync(profileManifestPath, "utf8"));
		if (typeof manifest !== "object" || manifest === null) return out;
		const dsh = manifest.dsh;
		if (typeof dsh !== "object" || dsh === null) return out;
		const profile = dsh.profile;
		if (typeof profile !== "object" || profile === null) return out;
		const bundles = profile.bundles;
		if (!Array.isArray(bundles)) return out;
		for (const bundle of bundles) if (typeof bundle === "string") out.add(bundle);
	} catch {}
	return out;
}
/**
* Dependency keys from the active profile manifest's `dependencies` — the
* profile top-level packages the loader reconciles patch rows from (the
* second wiring channel beside dsh.profile.bundles; `dsh plugin add` and
* npm installs land here). Unreadable/malformed manifests contribute
* nothing, matching readProfileBundles.
* @param profileManifestPath - <harnessHome>/profiles/<profile>/package.json.
*/
function readProfileDependencies(profileManifestPath) {
	const out = /* @__PURE__ */ new Set();
	if (profileManifestPath === void 0) return out;
	try {
		const manifest = JSON.parse(readFileSync(profileManifestPath, "utf8"));
		if (typeof manifest !== "object" || manifest === null) return out;
		const deps = manifest.dependencies;
		if (typeof deps !== "object" || deps === null) return out;
		for (const key of Object.keys(deps)) out.add(key);
	} catch {}
	return out;
}
/** Whether an absolute path sits inside the `dsh-skins/skins/` bundled
* carrier (the path-segment heuristic documented on the symlink branch). */
function isDshSkinsCarrierPath(dir) {
	const parts = dir.split(sep);
	return parts.includes("dsh-skins") && parts.includes("skins");
}
/**
* Whether the active skin's loader entry is already provided by the skin
* package's own bundle patch, so the home-layer managed section must NOT add
* a duplicate insert row (issue #148: `duplicate loader entry id`).
*
* True when:
*  - the registry marks the skin `bundleWired` (skin.json wiring flag), or
*  - the active profile manifest's `dsh.profile.bundles` contains entry.pkg
*    (the scripts/dsh-skin `bundleWiredFromProfile` authority — true whether
*    the profile target is a real directory or a symlink), or
*  - the profile manifest's `dependencies` contains entry.pkg (installed via
*    `dsh plugin add` / npm — the loader reconciles patch rows of the
*    profile's top-level packages, which is how these bundles get wired).
*
* When the profile manifest exists, its wiring lists are the whole truth:
* the loader reconciles ONLY bundle entries and dependency packages. In
* particular, the node_modules symlinks ensureSymlink creates for the
* skin-center itself are pure resolvability links — they are never
* reconciled — and must not be mistaken for installed bundles, otherwise
* useSkin skips the home insert row and no skin ever activates.
*
* Only when the manifest is absent/unreadable does the function fall back to
* the structural probe (a real installed dir, or a symlink to an independent
* package outside the dsh-skins/skins carrier, whose own cordis.patch.yml
* inserts entry.id). A symlink into the bundled carrier asset dir is never an
* active per-skin bundle in any layout.
* @param entry - the skin switch entry.
* @param profileModulesDir - the profile's node_modules dir.
* @param profileManifestPath - optional profile package.json path.
*/
function activeSkinIsBundleWired(entry, profileModulesDir, profileManifestPath) {
	if (entry.bundleWired) return true;
	if (readProfileBundles(profileManifestPath).has(entry.pkg)) return true;
	if (readProfileDependencies(profileManifestPath).has(entry.pkg)) return true;
	if (profileManifestPath !== void 0 && statSync(profileManifestPath, { throwIfNoEntry: false })) return false;
	const target = join(profileModulesDir, entry.pkg);
	let stat;
	try {
		stat = lstatSync(target, { throwIfNoEntry: false });
	} catch {
		return false;
	}
	if (stat === void 0 || !stat.isDirectory() && !stat.isSymbolicLink()) return false;
	let probeDir = target;
	if (stat.isSymbolicLink()) {
		let real;
		try {
			real = realpathSync(target);
		} catch {
			return false;
		}
		let entryReal;
		try {
			entryReal = realpathSync(entry.dir);
		} catch {
			entryReal = entry.dir;
		}
		if (isDshSkinsCarrierPath(real) || real === entryReal && isDshSkinsCarrierPath(entryReal)) return false;
		probeDir = real;
	}
	let patch;
	try {
		patch = readFileSync(join(probeDir, "cordis.patch.yml"), "utf8");
	} catch {
		return false;
	}
	return patchHasInsertId(patch, entry.id);
}
/**
* Copy a registry with `bundleWired` enriched from the profile layout, so
* patch rendering and active reading agree on skins whose insert row the
* installed per-skin bundle provides.
*/
function registryWithProfileWiring(registry, profileModulesDir, profileManifestPath) {
	const out = {};
	for (const [name, entry] of Object.entries(registry)) out[name] = activeSkinIsBundleWired(entry, profileModulesDir, profileManifestPath) ? {
		...entry,
		bundleWired: true
	} : entry;
	return out;
}
/**
* Derive the running harness home + profile from the skin-center package's
* own install location — the one authority that is true regardless of how
* the GUI was launched (issue #254: no DSH_PROFILE env var, cwd outside
* profiles/<name>, so every legacy fallback ends on the wrong profile).
* Both the literal module path and its realpath are scanned, because profile
* node_modules entries are commonly symlinks (per-skin links, pnpm store):
* the literal chain preserves the profiles/<name>/node_modules segment while
* the realpath chain covers store-resolved loads. The first ancestor matching
* <harnessHome>/profiles/<name>/node_modules wins; the inner node_modules
* under .pnpm/<pkg> never matches because its grandparent is .pnpm, not
* profiles.
* @param fromUrl - the module URL to resolve from (defaults to this module's
*   own import.meta.url); injectable so tests can place the module inside a
*   simulated install layout.
* @returns the harness home (already the .dsh dir — no suffix is appended)
*   and the profile name, or null when the module is not installed under a
*   profiles tree (monorepo dev checkout — callers keep their legacy
*   fallbacks).
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
* First non-blank string in a list of candidate values. Whitespace-only
* values (including environment variables set to spaces) count as unset.
*/
function firstNonBlank$1(...values) {
	for (const value of values) if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed !== "") return trimmed;
	}
}
/**
* Resolve the DSH harness home exactly like the dsh launcher:
*  - an injected `home` option (tests pass a throwaway HOME) maps to
*    `<home>/.dsh`;
*  - otherwise a trimmed non-empty `$DSH_HOME` is the harness home directly
*    (dsh's `resolveDshHome()` contract — the env var already points at the
*    `.dsh` directory, so no suffix is appended);
*  - otherwise the harness home derived from this package's install layout
*    (issue #254: the launcher may have configured the home without any env
*    var reaching this process) — already the `.dsh` dir, no suffix;
*  - otherwise `homedir()/.dsh`.
* @param optsHome - injectable HOME (tests); default resolves from env/homedir.
* @param env - environment map (defaults to process.env).
* @param installHome - harness home from resolveInstallLayout (no suffix).
*/
function resolveHarnessHome(optsHome, env = process.env, installHome) {
	if (optsHome !== void 0) return join(optsHome, ".dsh");
	return firstNonBlank$1(env.DSH_HOME, installHome) ?? join(homedir(), ".dsh");
}
/**
* The profile name when cwd sits directly under `<harnessHome>/profiles/<name>`
* — else undefined. Pure so resolvePaths can reuse it with an install-derived
* profiles root while resolveProfile keeps its own signature for callers.
*/
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
* Resolve the DSH paths under a HOME. home/profile are injectable so tests
* can point at a throwaway HOME (mirrors scripts/dsh-skin.test.mjs).
* Precedence for the harness home: injected home > $DSH_HOME > install
* layout > homedir()/.dsh. For the profile: injected profile >
* $DSH_SKIN_PROFILE > $DSH_PROFILE > cwd under profiles/<name> > install
* layout profile > web (issue #254: the install layout is what makes a
* non-web profile resolve when no env var or cwd hint exists).
* @param home - home dir (defaults to $DSH_HOME or the process HOME).
* @param profile - profile name (defaults via the precedence above).
* @param fromUrl - module URL the install layout is derived from (defaults
*   to this module's import.meta.url); injectable for tests.
*/
function resolvePaths(home, profile, fromUrl = import.meta.url) {
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
* the parent dir if missing, preserves the target's existing permission bits,
* uses a fresh mkdtemp directory (same dir as the target) so concurrent
* writers can never preempt the same temp name, and always cleans the temp
* directory on error.
* @param filePath - target file.
* @param next - full next content.
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
	let renderRegistry = registry;
	if (!official) {
		const entry = registry[name];
		symlinkFriendly(`switching to "${name}"`, () => {
			ensureSymlink(entry, paths.profileModulesDir);
		});
		const problem = checkResolvable(entry, paths.profileModulesDir);
		if (problem !== null) throw new Error(problem);
		renderRegistry = registryWithProfileWiring(registry, paths.profileModulesDir, paths.profileManifestPath);
	}
	const legacyPatch = readPatch(paths.legacyPatchPath);
	const migratedLegacyPatch = stripLegacySkinRows(stripManaged(legacyPatch));
	if (migratedLegacyPatch !== legacyPatch) writePatchAtomic(paths.legacyPatchPath, migratedLegacyPatch);
	const patch = normalizePatchForManagedAppend(stripEmptyPatchList(stripLegacySkinRows(stripManaged(readPatch(paths.patchPath)))));
	let next = appendManagedPatch(patch, renderManaged(official ? null : name, renderRegistry));
	let skippedInsert = false;
	if (!official && countInsertId(next, renderRegistry[name].id) > 1) {
		next = appendManagedPatch(patch, renderManaged(name, {
			...renderRegistry,
			[name]: {
				...renderRegistry[name],
				bundleWired: true
			}
		}));
		skippedInsert = true;
	}
	writePatchAtomic(paths.patchPath, next);
	return (official ? "restored the official stock look — the config watcher applies it within seconds; refresh the page to see it." : `skin switched to "${name}" — the config watcher applies it within seconds; refresh the page (or the manifest re-fetches) to see it.`) + (skippedInsert ? " （检测到补丁中已有该皮肤的 insert 行，已跳过本层 insert，避免 duplicate loader entry id。）" : "");
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
	let activePatch = patch ?? readPatch(paths.patchPath);
	if (patch === void 0 && !activePatch.includes("# --- dsh-skin managed (auto-generated; do not edit) ---")) activePatch = readPatch(paths.legacyPatchPath);
	return currentActive(activePatch, registryWithProfileWiring(registry, paths.profileModulesDir, paths.profileManifestPath)) ?? "none";
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
* the active profile's `cordis.patch.yml` and the profile symlink, exactly like
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
/** One JSON response. Shared with the wallpaper routes (we-routes.ts). */
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
/** Reject cross-site requests with 403. Shared with we-routes.ts. */
function requireSameOrigin(req, res) {
	if (isSameOriginRequest(req)) return true;
	json(res, 403, {
		ok: false,
		error: "cross-site-request-rejected"
	});
	return false;
}
/**
* Read a JSON request body (bounded to 64KB). Shared with we-routes.ts.
* Note: wallpaper imports copy files host-side, so no large upload ever
* travels this helper.
*/
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
* @param args - command arguments (e.g. `['use', 'xp']`).
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
	const currentCacheTtlMs = 750;
	let currentCache = null;
	const current = () => {
		const paths = resolvePaths();
		const key = `${paths.patchPath}|${paths.profileManifestPath}`;
		const now = Date.now();
		if (currentCache !== null && currentCache.key === key && now - currentCache.at < currentCacheTtlMs) return Promise.resolve(currentCache.value);
		return run(["current"]).then((out) => {
			const value = out.trim() || "none";
			currentCache = {
				key,
				value,
				at: Date.now()
			};
			return value;
		});
	};
	const invalidateCurrent = () => {
		currentCache = null;
	};
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
			invalidateCurrent();
			return {
				ok: true,
				active: await current(),
				message: out.trim()
			};
		})
	];
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
/** Build one entry from a project directory. */
function entryFromDir(dir, source, project, id) {
	const fileAbs = resolve(dir, project.file);
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
		file: project.file,
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
		const fileAbs = resolve(dir, manifest.file);
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
			file: manifest.file,
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
					const { extractSceneMainImage } = await import("./pkg-extract-D1jRneRL.js");
					const frame = extractSceneMainImage(new Uint8Array(readFileSync(abs)));
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
	const routes = [...makeSkinCenterRoutes(), ...makeWeRoutes({
		getConfig: () => wallpaperSource(),
		storeDir: defaultWallpapersStoreDir(resolveHarnessHome())
	})];
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
export { SKIN_BACKGROUND_NAMESPACE, SKIN_CENTER_API_PREFIX, SKIN_WALLPAPER_NAMESPACE, SkinBackgroundConfigSchema, SkinWallpaperConfigSchema, WE_API_PREFIX, apply, inject, makeSkinCenterRoutes, makeWeRoutes, name };
