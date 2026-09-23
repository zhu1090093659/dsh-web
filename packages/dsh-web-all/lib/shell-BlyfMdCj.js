import { i as shellState, n as listDegraded, r as recordDegraded } from "./degraded-CA6yzGPr.js";
//#region src/rows.ts
/**
* Active-row ledger for the dsh-web-all fault-isolation shell. Each family
* patch row runs one shell apply carrying the real plugin package name in
* `config.plugin`; the shell records that name here when the row applies and
* removes it when the entry disposes. The browser half reads the ledger
* through GET /api/dsh-web-all/rows to gate which folded client children
* mount: a row the loader never started (disabled by a user patch override)
* has no shell apply, so its settings tabs and surfaces stay off the page
* instead of rendering an entry that errors on click (#1372).
*
* Recording happens at apply start, not after the real plugin starts: a row
* whose plugin degraded (import/start failure captured by the shell) is still
* an ACTIVE row and keeps its UI entry — the degraded state is the honest
* signal the user must see. Only a row the loader never applied (disabled)
* drops out of the ledger.
*
* The ledger lives in the process-wide shared state (src/state.ts): the shell
* loads through two entry artifacts whose bundler chunk split would otherwise
* give each its own copy.
*/
/** Mark one family row active (its shell entry applied). */
function recordActiveRow(plugin) {
	shellState().activeRows.add(plugin);
}
/** Mark one family row inactive (its shell entry disposed). */
function removeActiveRow(plugin) {
	shellState().activeRows.delete(plugin);
}
/** Snapshot of the active real-plugin package names, in insertion order. */
function listActiveRows() {
	return [...shellState().activeRows];
}
//#endregion
//#region src/shell.ts
/** Required services: none — the shell must activate before anything else. */
const inject = [];
/** Loopback-fenced degraded-state route (installed once per shell context). */
function makeDegradedRoute() {
	return {
		kind: "exact",
		path: "/api/dsh-web-all/degraded",
		handler: async (req, res) => {
			let remote = req.socket.remoteAddress ?? "";
			if (remote.startsWith("::ffff:")) remote = remote.slice(7);
			if (remote !== "127.0.0.1" && remote !== "::1") {
				res.writeHead(403, { "content-type": "application/json" });
				res.end(JSON.stringify({
					ok: false,
					error: "forbidden: loopback-only"
				}));
				return;
			}
			res.writeHead(200, {
				"content-type": "application/json",
				"cache-control": "no-store"
			});
			res.end(JSON.stringify({
				ok: true,
				degraded: listDegraded()
			}));
		}
	};
}
/**
* Row-state route: answers the active family rows (real plugin package
* names) for the browser half's mount gating (#1372). NOT loopback-fenced:
* remote browsers read it same-origin like every other family /api route;
* the payload (active family package names) is already public through the
* served client bundle.
*/
function makeRowsRoute() {
	return {
		kind: "exact",
		path: "/api/dsh-web-all/rows",
		handler: async (_req, res) => {
			res.writeHead(200, {
				"content-type": "application/json",
				"cache-control": "no-store"
			});
			res.end(JSON.stringify({
				ok: true,
				children: listActiveRows()
			}));
		}
	};
}
/**
* Route registration state lives in the process-wide shared state
* (src/state.ts): multiple shell entries (the self row plus one per family
* plugin) mount sequentially under the aggregate, AND the bundler splits the
* two entry artifacts (lib/index.js vs lib/shells/shell.js) into separate
* module copies — module-local state would double-register the routes. Both
* health routes are singletons on the host webServer; ref-counting registers
* them exactly once on the first shell entry and tears them down with the
* last.
*/
/** For test teardown and test isolation only. */
function _resetDegradedRouteForTest() {
	const routes = shellState().healthRoutes;
	routes.count = 0;
	try {
		routes.unregister?.();
	} catch {}
	routes.unregister = void 0;
}
/**
* Hold both health routes (degraded + rows) for this shell entry's lifetime.
* Every shell entry calls this — including the config-less self row — so the
* rows route stays up even when every family row is disabled.
*
* The shell applies with inject=[] (it must activate before anything else),
* which means it usually runs BEFORE the web app provides webServer. A direct
* read at apply time therefore misses the service and the routes would never
* register — registration instead rides a nested inject fiber that starts
* when webServer appears and disposes with this entry. Hosts without
* webServer (some minimal profiles) simply never start the fiber: no routes,
* no error.
*/
function holdHealthRoutes(ctx) {
	ctx.inject(["webServer"], (scoped) => {
		const webServer = scoped.webServer;
		if (webServer === void 0) return;
		const routes = shellState().healthRoutes;
		if (routes.count === 0) try {
			const unregisterDegraded = webServer.register(makeDegradedRoute());
			let unregisterRows;
			try {
				unregisterRows = webServer.register(makeRowsRoute());
			} catch (error) {
				unregisterDegraded();
				throw error;
			}
			routes.unregister = () => {
				try {
					unregisterRows?.();
				} finally {
					unregisterDegraded();
				}
			};
		} catch (error) {
			console.warn("[dsh-web-all] failed to register health routes:", error);
		}
		routes.count += 1;
		scoped.effect(() => () => {
			routes.count -= 1;
			if (routes.count <= 0) {
				routes.count = 0;
				try {
					routes.unregister?.();
				} catch {}
				routes.unregister = void 0;
			}
		}, "dsh-web-all: health routes");
	});
}
/** Config shapes that must mount quietly: absent (self row) or a bare-row override. */
function isOverrideShape(config) {
	if (config === void 0) return true;
	if (typeof config !== "object" || config === null) return false;
	return Object.keys(config).length === 0 || !("plugin" in config);
}
/**
* Known retired family plugins: stale rows from older user profiles mount as
* silent no-ops so upgrading the aggregate package never breaks the host boot.
*/
const RETIRED_PLUGINS = /* @__PURE__ */ new Set(["@linxin666/dsh-perf", "@linxin666/dsh-desktop-launcher"]);
/** Apply one shell entry: mount the configured real plugin behind an isolation boundary. */
async function apply(ctx, config) {
	holdHealthRoutes(ctx);
	const spec = config?.plugin;
	if (typeof spec === "string" && RETIRED_PLUGINS.has(spec)) return;
	if (typeof spec !== "string" || spec === "") {
		if (isOverrideShape(config)) return;
		recordDegraded("(no plugin)", "shape", /* @__PURE__ */ new Error(`shell row config is missing the "plugin" package name (row config: ${JSON.stringify(config ?? null)}); the entry mounted empty`));
		return;
	}
	recordActiveRow(spec);
	ctx.effect(() => () => {
		removeActiveRow(spec);
	}, "dsh-web-all: active row ledger");
	let mod;
	try {
		mod = await import(
			/* @vite-ignore */
			spec
);
	} catch (error) {
		recordDegraded(spec, "import", error);
		return;
	}
	const plugin = mod?.default ?? mod;
	if (typeof plugin !== "function" && !(typeof plugin === "object" && plugin !== null && typeof plugin.apply === "function")) {
		recordDegraded(spec, "shape", /* @__PURE__ */ new Error(`module has no usable plugin shape (expected a function or { apply })`));
		return;
	}
	try {
		const fiber = ctx.plugin(plugin, config?.config);
		Promise.resolve(fiber).then(() => {}, (error) => recordDegraded(spec, "start", error));
	} catch (error) {
		recordDegraded(spec, "start", error);
	}
}
//#endregion
export { apply as n, inject as r, _resetDegradedRouteForTest as t };

//# sourceMappingURL=shell-BlyfMdCj.js.map