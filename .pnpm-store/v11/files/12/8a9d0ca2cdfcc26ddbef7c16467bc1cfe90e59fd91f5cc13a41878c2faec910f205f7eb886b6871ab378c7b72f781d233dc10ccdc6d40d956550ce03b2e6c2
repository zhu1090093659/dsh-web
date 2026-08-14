import { Module } from "node:module";
import { MessageChannel } from "node:worker_threads";
import { fileURLToPath } from "node:url";
//#region ../../node_modules/.pnpm/fresh-import@0.2.1/node_modules/fresh-import/dist/index.js
const instanceId = Math.random().toString(36).slice(2);
const relativeImportRE = /^\.{1,2}(?:\/|\\)/;
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
* The tracking query name `fresh-import-<instance>`, where `<instance>` is a
* random value unique to this loaded module instance. Any two instances (even
* two copies of the same build loaded into the same process) get distinct
* names, so each hook only recognizes the imports it tagged itself.
*/
function buildQueryName() {
	return `fresh-import-${instanceId}`;
}
/**
* Build the regex that matches the tracking query `?<name>=<id>,<context>`
* (or the `&<name>=...` form).
*/
function buildQueryRE(queryName) {
	return new RegExp(`(?:\\?|&)${escapeRegExp(queryName)}=(\\d+),([^&]+)(?:&|$)`);
}
/**
* Build the tracking query `?<name>=<id>,<context>` that `collect` appends to
* the entry specifier. `id` cache-busts the import (a distinct URL forces a
* fresh evaluation) and `context` tags the import graph so the resolve hook can
* attribute resolved dependencies back to the originating collect.
*/
function formatTrackingQuery(queryName, id, context) {
	return `?${queryName}=${id},${context}`;
}
/**
* Shared body of the resolve hook for both the on-thread and off-thread
* importers. Given an already-resolved `result`, decides whether it is a tracked
* relative file dependency; if so, reports it via `onDependency` and tags the
* URL so the query propagates to its own dependencies.
*
* The sync/async difference between the two hooks lives entirely in the caller
* (which awaits `nextResolve` or not); this function performs no I/O. `result`
* is mutated in place and returned.
*/
function trackResolved(specifier, context, result, queryName, queryRE, onDependency) {
	const isRelativeImport = relativeImportRE.test(specifier);
	if (result.format === "builtin" || !isRelativeImport) return result;
	if (!context.parentURL || queryRE.test(result.url) || !result.url.startsWith("file:")) return result;
	const m = queryRE.exec(context.parentURL);
	if (m) {
		const [, id, contextFile] = m;
		onDependency(contextFile, result.url);
		result.url = result.url.replace(/(\?)|$/, (_n, n1) => `?${queryName}=${id},${contextFile}${n1 === "?" ? "&" : ""}`);
	}
	return result;
}
var loader_default = "data:text/javascript,Math.random().toString(36).slice(2);%0Aconst relativeImportRE = /^\\.{1,2}(%3F:\\/|\\\\)/;%0Afunction escapeRegExp(value) {%0A%09return value.replace(/[.*+%3F^${}()|[\\]\\\\]/g, \"\\\\$&\");%0A}%0A/**%0A* Build the regex that matches the tracking query `%3F<name>=<id>,<context>`%0A* (or the `&<name>=...` form).%0A*/%0Afunction buildQueryRE(queryName) {%0A%09return new RegExp(`(%3F:\\\\%3F|&)${escapeRegExp(queryName)}=(\\\\d+),([^&]+)(%3F:&|$)`);%0A}%0A/**%0A* Shared body of the resolve hook for both the on-thread and off-thread%0A* importers. Given an already-resolved `result`, decides whether it is a tracked%0A* relative file dependency; if so, reports it via `onDependency` and tags the%0A* URL so the query propagates to its own dependencies.%0A*%0A* The sync/async difference between the two hooks lives entirely in the caller%0A* (which awaits `nextResolve` or not); this function performs no I/O. `result`%0A* is mutated in place and returned.%0A*/%0Afunction trackResolved(specifier, context, result, queryName, queryRE, onDependency) {%0A%09const isRelativeImport = relativeImportRE.test(specifier);%0A%09if (result.format === \"builtin\" || !isRelativeImport) return result;%0A%09if (!context.parentURL || queryRE.test(result.url) || !result.url.startsWith(\"file:\")) return result;%0A%09const m = queryRE.exec(context.parentURL);%0A%09if (m) {%0A%09%09const [, id, contextFile] = m;%0A%09%09onDependency(contextFile, result.url);%0A%09%09result.url = result.url.replace(/(\\%3F)|$/, (_n, n1) => `%3F${queryName}=${id},${contextFile}${n1 === \"%3F\" %3F \"&\" : \"\"}`);%0A%09}%0A%09return result;%0A}%0A//%23endregion%0A//%23region src/off-thread/loader.ts%0Alet port;%0Alet queryName;%0Alet queryRE;%0Aconst initialize = async (data) => {%0A%09port = data.port;%0A%09queryName = data.queryName;%0A%09queryRE = buildQueryRE(queryName);%0A};%0Aconst resolve = async (specifier, context, nextResolve) => {%0A%09return trackResolved(specifier, context, await nextResolve(specifier, context), queryName, queryRE, (ctx, url) => {%0A%09%09port.postMessage({%0A%09%09%09context: ctx,%0A%09%09%09url%0A%09%09});%0A%09});%0A};%0A//%23endregion%0Aexport { initialize, resolve };%0A";
let nextId$1 = 0;
/**
* Off-thread importer: registers an ESM loader in a worker thread via
* `Module.register` and receives tracked dependencies over a `MessagePort`.
* Used on Node versions without `Module.registerHooks`.
*/
function createOffThreadImporter() {
	const queryName = buildQueryName();
	const { port1, port2 } = new MessageChannel();
	Module.register(loader_default, {
		data: {
			port: port2,
			queryName
		},
		transferList: [port2]
	});
	port1.unref();
	return { async collect(specifier) {
		const id = nextId$1++;
		const depsList = /* @__PURE__ */ new Set();
		const onMessage = (e) => {
			if (e.context === specifier) depsList.add(e.url);
		};
		port1.on("message", onMessage);
		port1.unref();
		try {
			const result = await import(specifier + formatTrackingQuery(queryName, id, specifier));
			await new Promise((resolve) => setImmediate(resolve));
			return {
				result,
				dependencies: [...depsList].filter((url) => url.startsWith("file:")).map((url) => fileURLToPath(url))
			};
		} finally {
			port1.off("message", onMessage);
		}
	} };
}
let nextId = 0;
/**
* On-thread importer: registers synchronous resolution hooks via
* `Module.registerHooks` (Node 22.15+/23.5+).
*/
function createOnThreadImporter() {
	const registry = /* @__PURE__ */ new Map();
	const queryName = buildQueryName();
	const queryRE = buildQueryRE(queryName);
	const resolve = (specifier, context, nextResolve) => {
		return trackResolved(specifier, context, nextResolve(specifier, context), queryName, queryRE, (ctx, url) => {
			registry.get(ctx)?.add(url);
		});
	};
	Module.registerHooks({ resolve });
	return { async collect(specifier) {
		const id = nextId++;
		const depsList = /* @__PURE__ */ new Set();
		registry.set(specifier, depsList);
		try {
			return {
				result: await import(specifier + formatTrackingQuery(queryName, id, specifier)),
				dependencies: [...depsList].filter((url) => url.startsWith("file:")).map((url) => fileURLToPath(url))
			};
		} finally {
			registry.delete(specifier);
		}
	} };
}
/**
* Create the importer best suited to the current runtime, or `undefined` if it
* provides neither module-hook API.
*/
function createImporter() {
	if (Module.registerHooks) return createOnThreadImporter();
	if (Module.register) return createOffThreadImporter();
}
let importer;
let initialized = false;
/**
* Import an ESM entry in its own fresh module graph (separate from Node's module
* cache and from other concurrent imports) and report the dependency files it
* pulled in.
*
* Each call re-evaluates the entry in a fresh graph; concurrent calls stay
* isolated from one another. Only statically-imported relative dependencies are
* tracked, not dynamic imports.
*
* Returns `undefined` on runtimes that provide neither `Module.registerHooks`
* nor `Module.register`.
*/
function freshImport(specifier) {
	if (!initialized) {
		importer = createImporter();
		initialized = true;
	}
	return importer?.collect(specifier);
}
//#endregion
export { freshImport };
