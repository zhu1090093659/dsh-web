import { listDegraded, recordDegraded } from "./degraded.js";
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
/** Config shapes that must mount quietly: absent (self row) or a bare-row override. */
function isOverrideShape(config) {
	if (config === void 0) return true;
	if (typeof config !== "object" || config === null) return false;
	return Object.keys(config).length === 0 || !("plugin" in config);
}
/** Apply one shell entry: mount the configured real plugin behind an isolation boundary. */
async function apply(ctx, config) {
	const spec = config?.plugin;
	if (typeof spec !== "string" || spec === "") {
		if (isOverrideShape(config)) return;
		recordDegraded("(no plugin)", "shape", /* @__PURE__ */ new Error(`shell row config is missing the "plugin" package name (row config: ${JSON.stringify(config ?? null)}); the entry mounted empty`));
		return;
	}
	const disposeRoute = ctx.reflect.get("webServer", false)?.register(makeDegradedRoute());
	ctx.effect(() => () => disposeRoute?.(), "dsh-web-all: degraded route");
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
export { apply, inject };

//# sourceMappingURL=shell.js.map