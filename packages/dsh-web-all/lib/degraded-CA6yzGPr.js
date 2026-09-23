//#region src/state.ts
const KEY = Symbol.for("dsh-web-all.shell-state");
/** The process-wide shared shell state (one instance across module copies). */
function shellState() {
	const registry = globalThis;
	return registry[KEY] ??= {
		activeRows: /* @__PURE__ */ new Set(),
		degraded: /* @__PURE__ */ new Map(),
		healthRoutes: { count: 0 }
	};
}
//#endregion
//#region src/degraded.ts
/** Record (or refresh) one plugin's degraded state. Errors are logged here once. */
function recordDegraded(plugin, stage, error) {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	console.error(`[dsh-web-all] plugin degraded (${stage}): ${plugin}\n${message}`);
	shellState().degraded.set(plugin, {
		plugin,
		stage,
		message,
		at: (/* @__PURE__ */ new Date()).toISOString()
	});
}
/** Clear one plugin's degraded record (successful start after a retry/HMR reload). */
function clearDegraded(plugin) {
	shellState().degraded.delete(plugin);
}
/** Snapshot of all currently degraded plugins. */
function listDegraded() {
	return [...shellState().degraded.values()];
}
//#endregion
export { shellState as i, listDegraded as n, recordDegraded as r, clearDegraded as t };

//# sourceMappingURL=degraded-CA6yzGPr.js.map