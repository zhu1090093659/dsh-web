import { s as resolveComma, u as toArray } from "./general-Cp4NiJNK.mjs";
import { createDebug, enable, namespaces } from "obug";
//#region package.json
var version = "0.22.2";
//#endregion
//#region src/features/debug.ts
const debugLog = createDebug("tsdown:debug");
function enableDebug(debug) {
	if (!debug) return;
	let namespace;
	if (debug === true) namespace = "tsdown:*";
	else namespace = resolveComma(toArray(debug)).map((v) => `tsdown:${v}`).join(",");
	const ns = namespaces();
	if (ns) namespace += `,${ns}`;
	enable(namespace);
	debugLog("Debugging enabled", namespace);
}
//#endregion
export { version as n, enableDebug as t };
