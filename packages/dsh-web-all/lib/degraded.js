//#region src/degraded.ts
const degraded = /* @__PURE__ */ new Map();
/** Record (or refresh) one plugin's degraded state. Errors are logged here once. */
function recordDegraded(plugin, stage, error) {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	console.error(`[dsh-web-all] plugin degraded (${stage}): ${plugin}\n${message}`);
	degraded.set(plugin, {
		plugin,
		stage,
		message,
		at: (/* @__PURE__ */ new Date()).toISOString()
	});
}
/** Clear one plugin's degraded record (successful start after a retry/HMR reload). */
function clearDegraded(plugin) {
	degraded.delete(plugin);
}
/** Snapshot of all currently degraded plugins. */
function listDegraded() {
	return [...degraded.values()];
}
//#endregion
export { clearDegraded, listDegraded, recordDegraded };

//# sourceMappingURL=degraded.js.map