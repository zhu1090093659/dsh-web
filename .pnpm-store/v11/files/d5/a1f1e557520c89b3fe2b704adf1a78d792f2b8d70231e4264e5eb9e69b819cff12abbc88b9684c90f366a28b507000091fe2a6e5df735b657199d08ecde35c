//#region src/utils/misc.ts
function arraify(value) {
	return Array.isArray(value) ? value : [value];
}
function isPromiseLike(value) {
	return value && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
}
function unimplemented(info) {
	if (info) throw new Error(`unimplemented: ${info}`);
	throw new Error("unimplemented");
}
function unreachable(info) {
	if (info) throw new Error(`unreachable: ${info}`);
	throw new Error("unreachable");
}
function unsupported(info) {
	throw new Error(`UNSUPPORTED: ${info}`);
}
function noop(..._args) {}
const ABSOLUTE_PATH_REGEX = /^(?:\/|(?:[A-Za-z]:)?[/\\|])/;
/**
* Whether `name` is a path fragment — an absolute or relative path. Emitted file
* names, `[name]` substitutions and file-name patterns can be neither.
*/
function isPathFragment(name) {
	return name[0] === "/" || name[0] === "." && (name[1] === "/" || name[1] === ".") || ABSOLUTE_PATH_REGEX.test(name);
}
//#endregion
export { unimplemented as a, noop as i, isPathFragment as n, unreachable as o, isPromiseLike as r, unsupported as s, arraify as t };
