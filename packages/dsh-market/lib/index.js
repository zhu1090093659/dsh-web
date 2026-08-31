import z from "schemastery";
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path, { isAbsolute, join, sep } from "node:path";
import { homedir } from "node:os";
import { isAbsolute as isAbsolute$1, join as join$1 } from "node:path/posix";
import { createHash } from "node:crypto";
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
//#region src/dsh-home.ts
/**
* DSH_HOME resolution shared by the plugin family's Host halves: the
* environment override wins, the platform home fallback follows. Mirrors
* what dsh-pet and dsh-liangshen each used to implement locally.
*/
/** Expand a leading ~ (or ~user) in a path, platform-style. */
function expandHome(path, home = homedir()) {
	const j = home.startsWith("/") ? join$1 : join;
	if (path === "~") return home;
	if (path.startsWith("~/") || path.startsWith("~\\")) return j(home, path.slice(2));
	return path;
}
/**
* Resolve the DSH home directory.
* @param env - process environment to read DSH_HOME from.
* @param home - platform home directory fallback (test seam).
* @returns the absolute DSH home path.
*/
function resolveDshHome(env = process.env, home = homedir()) {
	const isPosix = home.startsWith("/");
	const j = isPosix ? join$1 : join;
	const isAbs = isPosix ? isAbsolute$1 : isAbsolute;
	const raw = env.DSH_HOME;
	if (raw !== void 0 && raw.trim() !== "") {
		const expanded = expandHome(raw.trim(), home);
		return isAbs(expanded) ? expanded : j(process.cwd(), expanded);
	}
	return j(home, ".dsh");
}
/** Resolve the DSH home directory from the live environment. */
function dshHome() {
	return resolveDshHome();
}
//#endregion
//#region src/loopback.ts
/** IPv4 127/8 predicate (four decimal octets, first == 127). */
function isIPv4Loopback(v4) {
	const parts = v4.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Whether a socket remote address names the loopback range (127/8, ::1, IPv4-mapped). */
function isLoopbackAddress(address) {
	if (address === void 0) return false;
	const normalized = address.toLowerCase();
	if (normalized === "::1") return true;
	if (normalized.startsWith("::ffff:")) return isIPv4Loopback(normalized.slice(7));
	return isIPv4Loopback(normalized);
}
/** Whether a normalized URL hostname names the loopback authority (localhost, [::1], 127/8). */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	return isIPv4Loopback(hostname);
}
/**
* Request-level trust fence: a loopback socket address AND a loopback Host
* header, plus browser same-origin markers. The socket address is
* authoritative; X-Forwarded-For is never trusted.
*/
function isLoopbackRequest(request) {
	if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL("http://" + host);
	} catch {
		return false;
	}
	if (!isLoopbackHostname(hostUrl.hostname)) return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/core/installer.ts
/**
* Market asset installer core: builds the download plan from the public
* dsh-market.com manifest and writes it into the DSH home asset
* directories ($DSH_HOME/skins/<id>, $DSH_HOME/pets/<id>).
*
* Security model (host half):
*  - the manifest is fetched from MARKET_ORIGIN only;
*  - every relative path comes from that manifest and is validated against
*    a conservative allowlist (no '..', no absolute paths, no empty parts);
*  - the download URL is rebuilt from the validated rel, never taken from
*    the client (the client only sends the asset id);
*  - the manifest and every downloaded file are size-capped (1 MiB manifest,
*    200 files per asset, 200 MiB per file) and every fetch has a 30 s
*    timeout, so a hostile manifest cannot exhaust host memory or disk;
*  - writes are staged in a temp dir next to the destination and renamed
*    into place only after every file downloaded successfully, so a failed
*    install never leaves a half-written asset directory;
*  - an existing directory is replaced only with force (the UI confirms);
*  - every install records dsh-market.provenance.json (sha256 of each
*    installed file, pinned to MARKET_ORIGIN), so consumers like the skin
*    center can tell official-market content — same-review code built from
*    the dsh-web repository — apart from hand-dropped directories
*    (issue #1073).
* @module @linxin666/dsh-client-ui-market/core
*/
const MARKET_ORIGIN = "https://dsh-market.com";
/** Provenance manifest written into every installed asset directory. */
const PROVENANCE_FILENAME = "dsh-market.provenance.json";
const SAFE_REL_RE = /^[A-Za-z0-9._][A-Za-z0-9._\-/]{0,199}$/;
/** Whether one manifest-relative path passes the conservative allowlist. */
function isSafeRel(rel) {
	if (typeof rel !== "string" || !SAFE_REL_RE.test(rel)) return false;
	if (rel.includes("..") || rel.includes("//") || rel.startsWith("/") || rel.endsWith("/")) return false;
	return true;
}
/** The market asset base URL for one kind/id (skins/<id>/ or pets/<id>/). */
function assetBase(kind, id) {
	return `${MARKET_ORIGIN}/assets/${kind === "skin" ? "skins" : "pets"}/${encodeURIComponent(id)}/`;
}
/** Build the validated download plan from a manifest file list. */
function planDownload(kind, id, files) {
	if (!id || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error(`invalid asset id: ${id}`);
	if (!Array.isArray(files) || files.length === 0) throw new Error(`asset ${id} declares no files`);
	if (files.length > 200) throw new Error(`asset ${id} declares too many files (${files.length}, max 200)`);
	const base = assetBase(kind, id);
	const plan = [];
	const seen = /* @__PURE__ */ new Set();
	for (const rel of files) {
		if (!isSafeRel(rel)) throw new Error(`unsafe manifest path: ${rel}`);
		if (seen.has(rel)) throw new Error(`duplicate manifest path: ${rel}`);
		seen.add(rel);
		plan.push({
			rel,
			url: base + rel.split("/").map(encodeURIComponent).join("/")
		});
	}
	return plan;
}
/** The destination directory for one asset (dsh home + skins|pets + id). */
function targetDir(dshHome, kind, id) {
	return join(dshHome, kind === "skin" ? "skins" : "pets", id);
}
var MarketInstallError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
	}
};
function isAbortError(err) {
	const name = typeof err === "object" && err !== null ? err.name : void 0;
	return name === "AbortError" || name === "TimeoutError";
}
/** fetch with a hard timeout; a timeout becomes a typed MarketInstallError. */
async function fetchWithTimeout(url, fetchImpl, code, timeoutMs) {
	try {
		return await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
	} catch (err) {
		if (isAbortError(err)) throw new MarketInstallError(code, `fetch timed out after ${timeoutMs}ms: ${url}`);
		throw err;
	}
}
/**
* Read a response body capped at maxBytes: a Content-Length pre-check when
* present, then a streaming count that cancels the body (and throws) once the
* cap is crossed, so an unannounced oversized body never fully buffers.
*/
async function readBodyLimited(res, maxBytes, code, what, timeoutMs) {
	const declared = Number(res.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > maxBytes) throw new MarketInstallError(code, `${what} exceeds ${maxBytes} bytes (content-length: ${declared})`);
	const body = res.body;
	if (body === null) {
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.byteLength > maxBytes) throw new MarketInstallError(code, `${what} exceeds ${maxBytes} bytes (received: ${buf.byteLength})`);
		return buf;
	}
	const reader = body.getReader();
	const chunks = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) throw new MarketInstallError(code, `${what} exceeds ${maxBytes} bytes (received: ${total})`);
			chunks.push(value);
		}
	} catch (err) {
		if (isAbortError(err)) throw new MarketInstallError(code, `read timed out after ${timeoutMs}ms: ${what}`);
		throw err;
	} finally {
		try {
			await reader.cancel();
		} catch {}
	}
	return Buffer.concat(chunks, total);
}
async function fetchManifest(kind, fetchImpl, maxBytes, timeoutMs) {
	const url = `${MARKET_ORIGIN}/manifest/${kind === "skin" ? "skins" : "pets"}.json`;
	const res = await fetchWithTimeout(url, fetchImpl, "manifest", timeoutMs);
	if (!res.ok) throw new MarketInstallError("manifest", `manifest fetch failed: ${res.status}`);
	const text = await readBodyLimited(res, maxBytes, "manifest", `manifest ${url}`, timeoutMs);
	const data = JSON.parse(text.toString("utf8"));
	if (!data || !Array.isArray(data.items)) throw new MarketInstallError("manifest", "manifest shape invalid");
	return data;
}
/**
* Install one market asset into its DSH home directory (atomic, replace
* with force). Throws MarketInstallError on any failure; an existing
* directory is left untouched unless force is true and all files arrived.
*/
async function installAsset(kind, id, options) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const manifestMaxBytes = options.manifestMaxBytes ?? 1048576;
	const fileMaxBytes = options.fileMaxBytes ?? 209715200;
	const fetchTimeoutMs = options.fetchTimeoutMs ?? 3e4;
	const item = (await fetchManifest(kind, fetchImpl, manifestMaxBytes, fetchTimeoutMs)).items.find((entry) => entry.id === id);
	if (!item) throw new MarketInstallError("manifest", `asset not in manifest: ${id}`);
	const plan = planDownload(kind, id, item.files ?? []);
	const dest = targetDir(options.dshHome, kind, id);
	let exists = false;
	try {
		statSync(dest);
		exists = true;
	} catch {
		exists = false;
	}
	if (exists && options.force !== true) throw new MarketInstallError("conflict", `destination already exists: ${dest}`);
	const tmp = dest + ".install-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
	try {
		mkdirSync(tmp, { recursive: true });
		const hashes = {};
		for (const entry of plan) {
			const res = await fetchWithTimeout(entry.url, fetchImpl, "download", fetchTimeoutMs);
			if (!res.ok) throw new MarketInstallError("download", `${entry.url} failed: ${res.status}`);
			const buf = await readBodyLimited(res, fileMaxBytes, "download", entry.url, fetchTimeoutMs);
			const target = join(tmp, ...entry.rel.split("/"));
			const guard = entry.rel.split("/").slice(0, -1).join(sep);
			if (guard) mkdirSync(join(tmp, guard), { recursive: true });
			writeFileSync(target, buf);
			hashes[entry.rel] = createHash("sha256").update(buf).digest("hex");
		}
		const provenance = {
			version: 1,
			source: MARKET_ORIGIN,
			kind,
			id,
			installedAt: (/* @__PURE__ */ new Date()).toISOString(),
			files: hashes
		};
		writeFileSync(join(tmp, PROVENANCE_FILENAME), JSON.stringify(provenance, null, 2) + "\n");
		if (exists) rmSync(dest, {
			recursive: true,
			force: true,
			maxRetries: 3,
			retryDelay: 50
		});
		try {
			renameSync(tmp, dest);
		} catch {
			const start = Date.now();
			while (Date.now() - start < 50);
			renameSync(tmp, dest);
		}
	} catch (err) {
		try {
			rmSync(tmp, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 50
			});
		} catch {}
		if (err instanceof MarketInstallError) throw err;
		throw new MarketInstallError("write", err instanceof Error ? err.message : String(err));
	}
	return {
		ok: true,
		kind,
		id,
		files: plan.length,
		dest
	};
}
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
//#region src/routes.ts
/**
* Market host HTTP routes — the loopback-only install gateway the browser
* half calls to install skins/pets from dsh-market.com into the DSH home
* asset directories. Endpoints (all under /api/market):
*  - POST /api/market/install-skin { id, force? }
*  - POST /api/market/install-pet { id, force? }
* The host fetches the manifest itself, validates every path, and never
* accepts a URL or a file list from the client (see core/installer).
* @module @linxin666/dsh-client-ui-market/routes
*/
const MARKET_API_PREFIX = "/api/market";
function isLoopback(req) {
	try {
		return isLoopbackRequest(req);
	} catch {
		return false;
	}
}
/** Build the market install routes. */
function makeMarketRoutes(deps = {}) {
	const home = deps.dshHome ?? dshHome();
	const fetchImpl = deps.fetchImpl ?? fetch;
	const handleInstall = (kind) => async (req, res) => {
		if (!isLoopback(req)) {
			writeJson(res, 403, {
				ok: false,
				error: "loopback-only"
			}, { "cache-control": "no-store" });
			return;
		}
		if (req.method !== "POST") {
			writeJson(res, 405, {
				ok: false,
				error: "method-not-allowed"
			}, { "cache-control": "no-store" });
			return;
		}
		let body;
		try {
			body = await readJsonBody(req, { maxBytes: 16 * 1024 }) ?? {};
		} catch {
			writeJson(res, 400, {
				ok: false,
				error: "invalid-body"
			}, { "cache-control": "no-store" });
			return;
		}
		const id = typeof body.id === "string" ? body.id : "";
		if (!id || typeof id === "string" && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
			writeJson(res, 400, {
				ok: false,
				error: "invalid-id"
			}, { "cache-control": "no-store" });
			return;
		}
		try {
			writeJson(res, 200, await installAsset(kind, id, {
				dshHome: home,
				force: body.force === true,
				fetchImpl
			}), { "cache-control": "no-store" });
		} catch (err) {
			const code = err instanceof Error && "code" in err ? String(err.code) : "write";
			writeJson(res, code === "conflict" ? 409 : code === "manifest" ? 502 : 500, {
				ok: false,
				error: code,
				message: err instanceof Error ? err.message : String(err)
			}, { "cache-control": "no-store" });
		}
	};
	const handleInstalled = async (req, res) => {
		if (!isLoopback(req)) {
			writeJson(res, 403, {
				ok: false,
				error: "loopback-only"
			}, { "cache-control": "no-store" });
			return;
		}
		if (req.method !== "GET") {
			writeJson(res, 405, {
				ok: false,
				error: "method-not-allowed"
			}, { "cache-control": "no-store" });
			return;
		}
		const listDirs = (base) => {
			try {
				return readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
			} catch {
				return [];
			}
		};
		writeJson(res, 200, {
			skins: listDirs(path.join(home, "skins")),
			pets: listDirs(path.join(home, "pets"))
		}, { "cache-control": "no-store" });
	};
	const installSkin = handleInstall("skin");
	const installPet = handleInstall("pet");
	return [
		{
			kind: "exact",
			path: `${MARKET_API_PREFIX}/installed`,
			handler: handleInstalled
		},
		{
			kind: "exact",
			path: `${MARKET_API_PREFIX}/install-skin`,
			handler: installSkin
		},
		{
			kind: "exact",
			path: `${MARKET_API_PREFIX}/install-pet`,
			handler: installPet
		}
	];
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
const name = "ui-market";
/** Services the routes need; the gateway requires the host webserver. */
const inject = ["webServer"];
/** Settings namespace of the card's enable switch. */
const MARKET_SETTINGS_NAMESPACE = "dsh-web-ui-market";
const Config = z.object({ enabled: z.boolean().default(true) });
/** Register the namespace and mount the install gateway (once). */
const apply = mountOnce("@linxin666/dsh-client-ui-market", applyImpl);
function applyImpl(ctx) {
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.installSection(ctx, MARKET_SETTINGS_NAMESPACE, Config, {}, {
			setSource: () => {},
			onChange: () => {}
		});
	});
	const routes = makeMarketRoutes();
	for (const route of routes) try {
		ctx.effect(() => {
			const dispose = ctx.webServer.register(route);
			return () => {
				dispose();
			};
		}, "dsh-web-ui-market: routes");
	} catch {}
}
//#endregion
export { Config, MARKET_API_PREFIX, MARKET_ORIGIN, MARKET_SETTINGS_NAMESPACE, PROVENANCE_FILENAME, apply, inject, installAsset, isSafeRel, makeMarketRoutes, name, planDownload };
