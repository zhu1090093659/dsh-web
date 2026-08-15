import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
//#region src/pet-switch.ts
/**
* In-process pet switching for the pet center — which pet is active is
* controlled by a managed section of `~/.dsh/cordis.patch.yml` (atomic
* rewrite, hot-reloaded by the DSH config watcher within seconds, no
* restart), mirroring how the skin center switches skins.
*
* The two pets are both bundle-wired rows of the family aggregate (no insert
* row needed): the active pet is the one the managed section does NOT
* disable. `usePet` rewrites the section so exactly one pet stays enabled and
* the other is disabled; `current` reads the active back.
*
* The behaviour/text is a focused port of the skin center's skin-switch.ts.
* @module @linxin666/dsh-client-ui-pet-center/pet-switch
*/
/** Pets the center can select between. */
const PETS = [{
	id: "pet",
	pkg: "@linxin666/dsh-pet",
	key: "original"
}, {
	id: "pet-maid",
	pkg: "@linxin666/dsh-pet-maid",
	key: "introduced"
}];
/** The default pet when the managed section is absent / both are enabled. */
const DEFAULT_PET = "pet";
/** Managed patch-section delimiters (the single authority of pet switching). */
const MANAGED_START = "# --- dsh-pet managed (auto-generated; do not edit) ---";
const MANAGED_END = "# --- end dsh-pet managed ---";
/** The GUI profile this machine runs (dsh web); overridable via DSH_PET_PROFILE. */
const DEFAULT_PROFILE = process.env.DSH_PET_PROFILE ?? "web";
/**
* Resolve the DSH paths under a HOME. home/profile are injectable so tests
* can point at a throwaway HOME.
* @param home - home dir (defaults to the process HOME).
* @param profile - profile name (defaults to DSH_PET_PROFILE or 'web').
*/
function resolvePetPaths(home = homedir(), profile = DEFAULT_PROFILE) {
	return {
		patchPath: join(home, ".dsh", "cordis.patch.yml"),
		profileDir: join(home, ".dsh", "profiles", profile)
	};
}
/** Read a patch file, tolerating absence. */
function readPatch(patchPath) {
	try {
		return readFileSync(patchPath, "utf8");
	} catch {
		return "";
	}
}
/** Atomic replace: write a sibling temp file then rename over the target. */
function writePatchAtomic(filePath, next) {
	mkdirSync(dirname(filePath), { recursive: true });
	const tmp = `${filePath}.tmp-${process.pid}`;
	writeFileSync(tmp, next);
	renameSync(tmp, filePath);
}
/** Remove the managed pet section; throws on an unterminated section. */
function stripManaged(patch) {
	const start = patch.indexOf(MANAGED_START);
	if (start === -1) return patch;
	const end = patch.indexOf(MANAGED_END, start);
	if (end === -1) throw new Error("managed pet section is unterminated; fix ~/.dsh/cordis.patch.yml");
	return patch.slice(0, start) + patch.slice(end + 29);
}
/**
* Render the managed section so exactly `active` stays enabled: every other
* pet gets `disabled: true`; both pets are bundle-wired, so the active needs
* no insert row.
* @param active - the pet to keep enabled.
*/
function renderManaged(active) {
	const lines = [MANAGED_START];
	for (const pet of PETS) {
		if (pet.id === active) continue;
		lines.push(`- id: ${pet.id}`, "  disabled: true");
	}
	lines.push(MANAGED_END);
	return lines.join("\n");
}
/**
* Which pet a patch keeps active: the bundle-wired pet the patch resource of
* the managed section does NOT disable. When neither is disabled (or the
* section is absent) both are live and the default is reported.
* @param patch - raw patch file text.
* @param fallback - pet id to report when neither is disabled.
*/
function currentActive(patch, fallback = "pet") {
	const managed = patch.slice(patch.indexOf("# --- dsh-pet managed (auto-generated; do not edit) ---") === -1 ? 0 : patch.indexOf(MANAGED_START), patch.indexOf("# --- end dsh-pet managed ---") === -1 ? patch.length : patch.indexOf(MANAGED_END));
	const disabled = /* @__PURE__ */ new Set();
	for (const m of managed.matchAll(/^- id: (pet|pet-maid)\n  disabled: true/gm)) if (m[1] === "pet" || m[1] === "pet-maid") disabled.add(m[1]);
	const live = PETS.filter((pet) => !disabled.has(pet.id)).map((pet) => pet.id);
	return live.length === 1 ? live[0] : fallback;
}
/**
* Switch the active pet: rewrite the managed section of the boot patch so
* exactly one pet stays enabled, atomically.
* @param name - pet id to activate.
* @param opts - injectable HOME/profile.
* @returns the human-facing confirmation string.
*/
function usePet(name, opts = {}) {
	if (name !== "pet" && name !== "pet-maid") throw new Error(`unknown pet "${name}". Known: pet, pet-maid`);
	const paths = resolvePetPaths(opts.home, opts.profile);
	const next = `${stripManaged(readPatch(paths.patchPath)).replace(/\s+$/, "")}\n\n${renderManaged(name)}\n`;
	writePatchAtomic(paths.patchPath, next);
	return `pet switched to "${name}" — the config watcher applies it within seconds; refresh the page to see it.`;
}
/**
* Read the active pet.
* @param patch - optional pre-read patch text.
* @param opts - injectable HOME/profile.
* @returns the active pet id (defaults to `pet` when both are live).
*/
function currentPet(patch, opts = {}) {
	const paths = resolvePetPaths(opts.home, opts.profile);
	return currentActive(patch ?? readPatch(paths.patchPath));
}
//#endregion
//#region src/routes.ts
/** Browser-facing base path of the pet-center API. */
const PET_CENTER_API_PREFIX = "/api/pet-center";
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
* Same-origin fence. Browsers send `Sec-Fetch-Site` on every fetch: a
* `cross-site` fetch is always rejected, and an `Origin` that does not match
* the request `Host` is rejected. Requests without either header pass — this
* is a local single-user tool, and the fence only targets the cross-site
* browser vector.
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
* Build the pet-center route family.
* @param deps - optional overlay to read/write the patch against a custom
*   HOME (tests use a throwaway HOME). Defaults to the real user HOME.
*/
function makePetCenterRoutes(deps = {}) {
	const active = () => currentPet(void 0, deps);
	return [getRoute(`${PET_CENTER_API_PREFIX}/state`, async () => ({
		ok: true,
		active: active(),
		pets: PETS.map((pet) => pet.id)
	})), postRoute(`${PET_CENTER_API_PREFIX}/apply`, async (body) => {
		const pet = body.pet;
		if (typeof pet !== "string" || pet !== "pet" && pet !== "pet-maid") throw new Error("invalid-pet: pass pet: \"pet\" or \"pet-maid\"");
		const out = usePet(pet, deps);
		return {
			ok: true,
			active: active(),
			message: out.trim()
		};
	})];
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
const name = "ui-pet-center";
/** Services required before the pet center can mount its routes. */
const inject = ["webServer"];
/**
* Register the pet-center API routes.
*
* Failure policy: route mounting problems are logged, never thrown — the web
* shell fails the whole boot when a plugin apply throws, and the pet center
* must not take the GUI down.
* @param ctx - cordis context.
*/
function apply(ctx) {
	const routes = makePetCenterRoutes();
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
		}, "ui-pet-center: routes");
	} catch (error) {
		console.error("[ui-pet-center] route registration failed:", error);
	}
}
//#endregion
export { DEFAULT_PET, PETS, PET_CENTER_API_PREFIX, apply, currentActive, currentPet, inject, makePetCenterRoutes, name, renderManaged, stripManaged, usePet };
