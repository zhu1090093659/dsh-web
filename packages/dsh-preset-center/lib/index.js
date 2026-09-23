import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { isAbsolute as isAbsolute$1, join as join$1 } from "node:path/posix";
import { pathToFileURL } from "node:url";
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
//#region src/host/declarations.ts
/** A refused declaration. */
var DeclarationError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "DeclarationError";
	}
};
/** The registry's own refusal for an id another declaration already owns. */
const DUPLICATE_RE = /duplicate agent preset/i;
/** Registry declarations held by this plugin, keyed by preset id. */
var PresetDeclarations = class {
	live = /* @__PURE__ */ new Map();
	registry;
	/**
	* @param registry - resolver for the `agentPresets` service; undefined when
	*   the deployment supplies no preset registry.
	*/
	constructor(registry) {
		this.registry = registry;
	}
	/** Ids this plugin currently declares. */
	declared() {
		return new Set(this.live.keys());
	}
	/** Whether this plugin currently declares `id`. */
	has(id) {
		return this.live.has(id);
	}
	/**
	* Register one preset and keep its disposer. Declaring an already-declared
	* id is a no-op, so a repeated install does not restart the mounted rows.
	* @param definition - the definition read from the installed bytes.
	* @throws {DeclarationError} unavailable, shadowed, or invalid.
	*/
	async declare(definition) {
		const registry = this.registry();
		if (registry === void 0) throw new DeclarationError("unavailable", "the agent-preset registry is unavailable");
		if (this.live.has(definition.id)) return;
		let dispose;
		try {
			dispose = await registry.register(definition);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new DeclarationError(DUPLICATE_RE.test(message) ? "shadowed" : "invalid", message);
		}
		this.live.set(definition.id, dispose);
	}
	/**
	* Drop one declaration; the installed bytes stay in place.
	* @param id - preset id.
	* @returns whether a declaration was dropped.
	*/
	async undeclare(id) {
		const dispose = this.live.get(id);
		if (dispose === void 0) return false;
		this.live.delete(id);
		await dispose();
		return true;
	}
	/** Drop every declaration (plugin unload); failures never mask the rest. */
	async release() {
		const all = [...this.live.values()];
		this.live.clear();
		for (const dispose of all) try {
			await dispose();
		} catch {}
	}
};
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
//#region src/host/run-guarded.ts
/**
* Async-boundary guard shared by the plugin family's Host halves: every
* fire-and-forget promise chain and callback the host runtime does not own
* (route handlers, timers, event listeners, spawned work) funnels through
* these helpers. The dsh host installs a process-level fail-loud guard that
* turns ANY unhandled promise rejection into a whole-process exit — one
* plugin's stray rejection would otherwise take every plugin down. These
* helpers exist so that failure mode is structurally impossible in family
* code: the rejection becomes a logged error at the plugin boundary instead.
*
* Complements the aggregate's shell isolation (packages/dsh-web-all): the
* shell contains import/activation failures at boot; runGuarded contains
* run-time failures after activation.
* @module dsh-web-shared/host/run-guarded
*/
/** Format one failure line for logging. */
function formatFailure(label, error) {
	return /* @__PURE__ */ new Error(`[${label}] unhandled async failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
}
/**
* Wrap one callback so every invocation is individually guarded: a rejection
* inside one call is logged and swallowed instead of escaping into whatever
* infrastructure invoked the callback (HTTP server, EventEmitter, interval).
* Sync throws are caught identically; a returned promise is replaced by
* `undefined` after guarding (callers that need the original rejection should
* await inside their own try/catch instead).
* @param label - log prefix naming the callback site.
* @param handler - the work to guard.
* @param log - error sink; defaults to console.error.
* @returns a wrapped callback with the same parameter list.
*/
function guardedHandler(label, handler, log = console.error) {
	return (...args) => {
		try {
			const result = handler(...args);
			if (isPromiseLike(result)) {
				Promise.resolve(result).catch((error) => {
					log(formatFailure(label, error));
				});
				return;
			}
			return result;
		} catch (error) {
			log(formatFailure(label, error));
			return;
		}
	};
}
function isPromiseLike(value) {
	return typeof value === "object" && value !== null && typeof value.then === "function";
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
//#region src/core/paths.ts
/**
* The preset-center storage contract: one directory, one meaning.
*
* The library under the DSH home is where the market installs a preset and
* the only place the preset center reads from. Nothing scans it: the harness
* no longer discovers presets on disk, so a downloaded directory stays inert
* until this plugin declares it to `ctx.agentPresets` at runtime.
*
* The path is a cross-package contract, not private state: it is the
* destination the market installer writes (`preset` asset kind).
* @module @linxin666/dsh-client-ui-preset-center/core/paths
*/
/** Library directory under the DSH home: the market install target. */
const LIBRARY_DIR = "agent-presets";
/**
* Provenance filename written by the market installer (mirrors
* `PROVENANCE_FILENAME` in `@linxin666/dsh-client-ui-market`; no
* cross-package runtime import, the same way the skin center mirrors it).
*/
const PROVENANCE_FILENAME = "dsh-market.provenance.json";
/** The composition file that makes a directory a preset. */
const COMPOSITION_FILE = "agent.cordis.yml";
/** The display-text file the composition's registry declaration reads. */
const METADATA_FILE = "preset.yml";
/** Official preset id rule (mirrors the harness's preset identity rule). */
const PRESET_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
/** Whether `id` is a usable preset directory name. */
function isPresetId(id) {
	return typeof id === "string" && PRESET_ID_RE.test(id);
}
/** The library directory for one DSH home. */
function libraryRoot(dshHome) {
	return join(dshHome, LIBRARY_DIR);
}
//#endregion
//#region src/core/yaml.ts
/**
* The composition reader: just enough YAML to turn a cordis entry list (or the
* flat display map of `preset.yml`) into the values the preset registry takes.
*
* The harness parses composition files with its own YAML loader and preserves
* `!!js` expressions as data (`{ __jsExpr }`); this reader reproduces that
* contract for the one file shape a preset ships. No YAML package is
* resolvable from this package (the market build reads `preset.yml` with a
* line reader for the same reason), so the subset is owned here and fenced by
* tests over the whole shipped catalog.
*
* Fail-closed: a construct outside the subset (anchors, aliases, flow
* collections, extra tags, multiple documents, tabs) raises
* {@link CompositionError} instead of being guessed at, so an unreadable
* composition is refused rather than half-declared.
* @module @linxin666/dsh-client-ui-preset-center/core/yaml
*/
/** A construct outside the supported subset, or malformed YAML. */
var CompositionError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "CompositionError";
	}
};
const BLANK_OR_COMMENT_RE = /^[ \t]*(?:#.*)?$/;
const INTEGER_RE = /^[+-]?\d+$/;
const FLOAT_RE = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/;
/** The indentation width of one line (its leading spaces). */
function indentOf(line) {
	const match = /^ */.exec(line);
	return match === null ? 0 : match[0].length;
}
/**
* The indentation of one structurally significant line.
* A tab in that indentation is forbidden by YAML; block-scalar content is
* verbatim and is never measured here.
*/
function significantIndent(line, lineNumber) {
	const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
	if (leading.includes("	")) throw new CompositionError(`line ${String(lineNumber)}: tabs must not be used for indentation`);
	return leading.length;
}
/** Advance past blank and comment-only lines. */
function skipInsignificant(cursor) {
	while (cursor.index < cursor.lines.length && BLANK_OR_COMMENT_RE.test(cursor.lines[cursor.index] ?? "")) cursor.index += 1;
}
/** Whether a line at `indent` opens a block sequence entry. */
function isSequenceEntry(line, indent) {
	if (line[indent] !== "-") return false;
	return line.length === indent + 1 || line[indent + 1] === " ";
}
/**
* Split one block-map line into its key and the raw text after the colon.
* @param text - the line content from its first non-space character.
* @returns the key and remainder, or undefined when the line is not a map entry.
*/
function matchKeyEntry(text) {
	if (text.startsWith("'") || text.startsWith("\"")) {
		const end = closingQuote(text);
		if (end === -1) return void 0;
		const after = text.slice(end + 1).trimStart();
		if (!after.startsWith(":")) return void 0;
		return {
			key: unquote$1(text.slice(0, end + 1)),
			rest: after.slice(1).trim()
		};
	}
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === "#" && index > 0 && text[index - 1] === " ") break;
		if (char === ":" && (index + 1 === text.length || text[index + 1] === " ")) return {
			key: text.slice(0, index),
			rest: text.slice(index + 1).trim()
		};
	}
}
/** The index of the quote that closes a quoted scalar starting at index 0. */
function closingQuote(text) {
	const quote = text[0];
	for (let index = 1; index < text.length; index += 1) {
		const char = text[index];
		if (quote === "\"" && char === "\\") {
			index += 1;
			continue;
		}
		if (quote === "'" && char === "'" && text[index + 1] === "'") {
			index += 1;
			continue;
		}
		if (char === quote) return index;
	}
	return -1;
}
/** Resolve one quoted scalar, or return the text unchanged when unquoted. */
function unquote$1(text) {
	const trimmed = text.trim();
	if (trimmed.startsWith("\"")) {
		const end = closingQuote(trimmed);
		if (end !== trimmed.length - 1) throw new CompositionError(`unterminated double-quoted scalar: ${trimmed}`);
		return trimmed.slice(1, end).replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, escape) => {
			switch (escape[0]) {
				case "n": return "\n";
				case "t": return "	";
				case "r": return "\r";
				case "0": return "\0";
				case "u": return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
				case "x": return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
				default: return escape;
			}
		});
	}
	if (trimmed.startsWith("'")) {
		const end = closingQuote(trimmed);
		if (end !== trimmed.length - 1) throw new CompositionError(`unterminated single-quoted scalar: ${trimmed}`);
		return trimmed.slice(1, end).replaceAll("''", "'");
	}
	return trimmed;
}
/** Resolve a plain scalar to the value YAML's JSON schema would produce. */
function plainScalar(text) {
	const comment = text.indexOf(" #");
	const value = (comment === -1 ? text : text.slice(0, comment)).trim();
	if (value === "" || value === "~" || value === "null" || value === "Null" || value === "NULL") return null;
	if (value === "true" || value === "True" || value === "TRUE") return true;
	if (value === "false" || value === "False" || value === "FALSE") return false;
	if (INTEGER_RE.test(value)) return Number(value);
	if (FLOAT_RE.test(value)) return Number(value);
	return value;
}
/** Resolve the text that follows a colon or a dash on one line. */
function inlineScalar(text) {
	const value = text.trim();
	if (value.startsWith("!!js")) {
		const expression = value.slice(4).trim();
		if (expression === "") throw new CompositionError("!!js requires an expression");
		return { __jsExpr: unquote$1(expression) };
	}
	if (value.startsWith("'") || value.startsWith("\"")) {
		const end = closingQuote(value);
		if (end === -1) throw new CompositionError(`unterminated quoted scalar: ${value}`);
		const tail = value.slice(end + 1).trim();
		if (tail !== "" && !tail.startsWith("#")) throw new CompositionError(`unexpected content after a quoted scalar: ${tail}`);
		return unquote$1(value.slice(0, end + 1));
	}
	if (value.startsWith("[") || value.startsWith("{")) throw new CompositionError(`flow collections are not supported: ${value}`);
	if (value.startsWith("|") || value.startsWith(">")) throw new CompositionError(`block scalars need their own line: ${value}`);
	if (value.startsWith("!") || value.startsWith("&") || value.startsWith("*")) throw new CompositionError(`unsupported YAML node: ${value}`);
	return plainScalar(value);
}
/**
* Read one literal (`|`) or folded (`>`) block scalar, consuming its lines.
* @param cursor - line cursor positioned on the line that follows the header.
* @param parentIndent - indentation of the node that owns the scalar.
* @param header - the header text (`|-`, `>+2`, ...) possibly with a comment.
* @returns the scalar text after indentation stripping and chomping.
*/
function blockScalar(cursor, parentIndent, header) {
	const style = header[0];
	const indicators = header.slice(1).split("#")[0]?.trim() ?? "";
	let explicitIndent;
	let chomp = "clip";
	for (const char of indicators) if (char === "-") chomp = "strip";
	else if (char === "+") chomp = "keep";
	else if (char >= "1" && char <= "9") explicitIndent = Number(char);
	else throw new CompositionError(`unsupported block scalar header: ${header}`);
	const body = [];
	let blockIndent;
	let trailing = 0;
	while (cursor.index < cursor.lines.length) {
		const line = cursor.lines[cursor.index] ?? "";
		if (line.trim() === "") {
			body.push("");
			trailing += 1;
			cursor.index += 1;
			continue;
		}
		const indent = indentOf(line);
		if (indent <= parentIndent) break;
		if (blockIndent === void 0) blockIndent = explicitIndent === void 0 ? indent : parentIndent + explicitIndent;
		if (indent < blockIndent) break;
		body.push(line.slice(blockIndent));
		trailing = 0;
		cursor.index += 1;
	}
	const lines = body.slice(0, body.length - trailing);
	const tail = trailing;
	if (style === ">") {
		let folded = "";
		let blank = 0;
		let started = false;
		for (const line of lines) {
			if (line === "") {
				blank += 1;
				continue;
			}
			if (!started) {
				folded = line;
				started = true;
				blank = 0;
				continue;
			}
			folded += blank === 0 ? " " + line : "\n".repeat(blank) + line;
			blank = 0;
		}
		if (chomp === "strip") return folded;
		if (chomp === "keep") return folded + "\n".repeat(tail + 1);
		return folded === "" ? "" : folded + "\n";
	}
	const text = lines.join("\n");
	if (chomp === "strip") return text;
	if (chomp === "keep") return text + "\n".repeat(tail + 1);
	return text === "" ? "" : text + "\n";
}
/** Resolve the value of one entry whose line has already been consumed. */
function parseValue(cursor, parentIndent, rest) {
	if (rest !== "") {
		if (rest.startsWith("|") || rest.startsWith(">")) return blockScalar(cursor, parentIndent, rest);
		return inlineScalar(rest);
	}
	skipInsignificant(cursor);
	const line = cursor.lines[cursor.index];
	if (line === void 0 || indentOf(line) <= parentIndent) return null;
	return parseNode(cursor, parentIndent + 1);
}
/** Parse a block map whose keys sit at exactly `indent`. */
function parseMap(cursor, indent) {
	const map = {};
	while (true) {
		skipInsignificant(cursor);
		const line = cursor.lines[cursor.index];
		if (line === void 0) break;
		const lineIndent = significantIndent(line, cursor.index + 1);
		if (lineIndent < indent) break;
		if (lineIndent > indent) throw new CompositionError(`line ${String(cursor.index + 1)}: unexpected indentation`);
		if (isSequenceEntry(line, indent)) break;
		const entry = matchKeyEntry(line.slice(indent));
		if (entry === void 0) throw new CompositionError(`line ${String(cursor.index + 1)}: expected "key: value", got "${line.trim()}"`);
		if (Object.hasOwn(map, entry.key)) throw new CompositionError(`line ${String(cursor.index + 1)}: duplicate key "${entry.key}"`);
		cursor.index += 1;
		map[entry.key] = parseValue(cursor, indent, entry.rest);
	}
	return map;
}
/** Parse a block sequence whose dashes sit at exactly `indent`. */
function parseSequence(cursor, indent) {
	const items = [];
	while (true) {
		skipInsignificant(cursor);
		const line = cursor.lines[cursor.index];
		if (line === void 0) break;
		if (significantIndent(line, cursor.index + 1) !== indent || !isSequenceEntry(line, indent)) break;
		const rest = line.slice(indent + 1);
		const content = rest.trimStart();
		if (content === "") {
			cursor.index += 1;
			skipInsignificant(cursor);
			const nested = cursor.lines[cursor.index];
			const nestedIndent = nested === void 0 ? -1 : significantIndent(nested, cursor.index + 1);
			items.push(nestedIndent <= indent ? null : parseNode(cursor, indent + 1));
			continue;
		}
		const contentIndent = indent + 1 + (rest.length - content.length);
		if (matchKeyEntry(content) !== void 0) {
			cursor.lines[cursor.index] = " ".repeat(contentIndent) + content;
			items.push(parseMap(cursor, contentIndent));
			continue;
		}
		cursor.index += 1;
		items.push(parseValue(cursor, indent, content));
	}
	return items;
}
/** Parse the block node that starts at the cursor. */
function parseNode(cursor, minIndent) {
	skipInsignificant(cursor);
	const line = cursor.lines[cursor.index];
	if (line === void 0) return null;
	const indent = significantIndent(line, cursor.index + 1);
	if (indent < minIndent) return null;
	return isSequenceEntry(line, indent) ? parseSequence(cursor, indent) : parseMap(cursor, indent);
}
/**
* Read one cordis YAML document (or the flat map of `preset.yml`).
* @param text - file content.
* @returns the parsed value: a list of entries, a map, or null when empty.
* @throws {CompositionError} on malformed YAML or an unsupported construct.
*/
function readCordisYaml(text) {
	const cursor = {
		lines: (text.startsWith("﻿") ? text.slice(1) : text).split("\n"),
		index: 0
	};
	const value = parseNode(cursor, 0);
	skipInsignificant(cursor);
	const extra = cursor.lines[cursor.index];
	if (extra !== void 0) throw new CompositionError(`line ${String(cursor.index + 1)}: unexpected content "${extra.trim()}"`);
	return value;
}
//#endregion
//#region src/core/definition.ts
/**
* The declaration an installed preset makes to the agent-preset registry: its
* identity and display text from `preset.yml`, its child plugin rows from
* `agent.cordis.yml`, both read from the bytes the market installed.
*
* This is the one place the plugin turns a downloaded directory into a
* registry definition, so it also owns the fail-closed rule: an unreadable or
* unsupported composition raises instead of declaring a partial preset.
* @module @linxin666/dsh-client-ui-preset-center/core/definition
*/
function asRecord(value, what) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CompositionError(`${what} must be a mapping`);
	return value;
}
/** Read the single-line display scalars of one `preset.yml`. */
function readPresetMetadata(text) {
	const record = asRecord(readCordisYaml(text), METADATA_FILE);
	const metadata = {};
	if (record["name"] !== void 0 && record["name"] !== null) {
		if (typeof record["name"] !== "string" || record["name"].includes("\n")) throw new CompositionError(`${METADATA_FILE}: name must be a single-line string`);
		metadata.name = record["name"];
	}
	if (record["description"] !== void 0 && record["description"] !== null) {
		if (typeof record["description"] !== "string" || record["description"].includes("\n")) throw new CompositionError(`${METADATA_FILE}: description must be a single-line string`);
		metadata.description = record["description"];
	}
	if (record["order"] !== void 0 && record["order"] !== null) {
		if (typeof record["order"] !== "number" || !Number.isFinite(record["order"])) throw new CompositionError(`${METADATA_FILE}: order must be a number`);
		metadata.order = record["order"];
	}
	return metadata;
}
function asRow(value, at) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CompositionError(`${at} must be a mapping`);
	const row = value;
	if (typeof row.name !== "string" || row.name === "") throw new CompositionError(`${at} names no plugin (a "name" string is required)`);
	return row;
}
/**
* Rewrite the relative module names of one row list, recursively through the
* nested entry lists of group rows, into absolute file URLs. The registry
* mounts a declaration under the DECLARING plugin's base URL, so a preset that
* ships its own code files would otherwise resolve them against this package.
*/
function absolutizeRows(rows, baseDir, at = "row") {
	return rows.map((row, index) => {
		const label = `${at} ${String(index + 1)}`;
		const checked = asRow(row, label);
		const name = checked.name ?? "";
		const out = { ...checked };
		if (name.startsWith("./") || name.startsWith("../")) out.name = pathToFileURL(resolve(baseDir, name)).href;
		if (checked.group === true) {
			if (!Array.isArray(checked.config)) throw new CompositionError(`group ${label} must hold a list of plugin rows`);
			out.config = absolutizeRows(checked.config, baseDir, `${label} group`);
		}
		return out;
	});
}
/**
* Read the child plugin rows of one `agent.cordis.yml`.
* @param text - the raw composition document.
* @param baseDir - directory a relative row `name` resolves against (the preset's own directory).
* @returns the row list to hand the registry, relative names resolved to file URLs.
*/
function readCompositionRows(text, baseDir) {
	const value = readCordisYaml(text);
	if (!Array.isArray(value)) throw new CompositionError(`${COMPOSITION_FILE} must be a top-level list of plugin rows`);
	return absolutizeRows(value, baseDir);
}
/** Build the registry definition of one installed preset from its own bytes. */
function presetDefinition(id, composition, metadata, baseDir) {
	return {
		id,
		...readPresetMetadata(metadata),
		plugins: readCompositionRows(composition, baseDir)
	};
}
/**
* Build the registry definition of one installed preset directory.
* @param id - preset id (the library directory name).
* @param dir - absolute preset directory.
* @returns the definition to submit to `ctx.agentPresets.register`.
* @throws {CompositionError} when either file is missing or unreadable.
*/
function readPresetDefinition(id, dir) {
	const read = (name) => {
		try {
			return readFileSync(join(dir, name), "utf8");
		} catch (err) {
			throw new CompositionError(`${name} is unreadable: ${err instanceof Error ? err.message : String(err)}`);
		}
	};
	return presetDefinition(id, read(COMPOSITION_FILE), read(METADATA_FILE), dir);
}
//#endregion
//#region src/core/provenance.ts
/**
* Market provenance for one installed preset: the record the market installer
* writes at install time (market origin, asset version, per-file sha256).
*
* It is what lets the panel tell a workshop-managed preset apart from a
* hand-authored directory, and a pristine copy apart from one edited after
* install. Fail-closed: unreadable or wrongly-shaped provenance is `missing`,
* never trusted.
* @module @linxin666/dsh-client-ui-preset-center/core/provenance
*/
/** Market origin the provenance must pin (mirrors MARKET_ORIGIN in the market package). */
const MARKET_ORIGIN = "https://dsh-market.com";
function sha256Hex(abs) {
	try {
		return createHash("sha256").update(readFileSync(abs)).digest("hex");
	} catch {
		return null;
	}
}
/** Every regular file under `dir`, as sorted relative POSIX paths. */
function listFiles(dir, base = "") {
	const out = [];
	let entries;
	try {
		entries = readdirSync(join(dir, base), { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
		if (entry.name.startsWith(".")) continue;
		const rel = base === "" ? entry.name : base + "/" + entry.name;
		if (entry.isDirectory()) out.push(...listFiles(dir, rel));
		else out.push(rel);
	}
	return out;
}
/** Read one preset directory's provenance record; null when absent or malformed. */
function readProvenance(dir, id) {
	let raw;
	try {
		raw = JSON.parse(readFileSync(join(dir, PROVENANCE_FILENAME), "utf8"));
	} catch {
		return null;
	}
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw;
	if (record.version !== 1) return null;
	if (record.source !== "https://dsh-market.com") return null;
	if (record.id !== id) return null;
	const files = record.files;
	if (typeof files !== "object" || files === null) return null;
	const hashes = {};
	for (const [rel, hash] of Object.entries(files)) {
		if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return null;
		hashes[rel] = hash;
	}
	const installedAt = typeof record.installedAt === "string" ? record.installedAt : "";
	const assetVersion = typeof record.assetVersion === "string" ? record.assetVersion : void 0;
	return {
		version: 1,
		source: MARKET_ORIGIN,
		id,
		installedAt,
		...assetVersion === void 0 ? {} : { assetVersion },
		files: hashes
	};
}
/** Verify one directory's bytes against its own provenance record. */
function verifyProvenance(dir, id) {
	const provenance = readProvenance(dir, id);
	if (provenance === null) return {
		state: "missing",
		provenance: null,
		mismatches: [],
		missing: [],
		extra: []
	};
	const mismatches = [];
	const missing = [];
	for (const [rel, expected] of Object.entries(provenance.files)) {
		const actual = sha256Hex(join(dir, ...rel.split("/")));
		if (actual === null) missing.push(rel);
		else if (actual !== expected) mismatches.push(rel);
	}
	const extra = listFiles(dir).filter((rel) => rel !== "dsh-market.provenance.json" && provenance.files[rel] === void 0);
	return {
		state: mismatches.length === 0 && missing.length === 0 ? "valid" : "modified",
		provenance,
		mismatches,
		missing,
		extra
	};
}
/** Whether `dir` is a directory that exists. */
function isDirectory(dir) {
	try {
		return statSync(dir).isDirectory();
	} catch {
		return false;
	}
}
//#endregion
//#region src/core/profile.ts
/**
* What a preset's composition will actually load, read from the installed
* bytes on the host — never from the market catalog, which a client could
* restate.
*
* The profile answers three questions the install confirmation needs: which
* plugins the composition names, which of those are files that travel inside
* the preset directory, and whether the file carries inline `!!js`
* expressions. All three are execution surfaces: a relative row and an inline
* expression both run inside the host process once the preset is declared to
* the registry, exactly like an npm plugin does.
*
* The scan is deliberately shallow (line-oriented) and is a display signal,
* not a sandbox: what the registry actually mounts comes from the parsed
* definition (`core/definition.ts`), and the health verdict from the registry
* roster after the declaration. A preset that hides a row from this scan is
* still gated by the downloaded-but-undeclared state and the operator's
* confirmation.
* @module @linxin666/dsh-client-ui-preset-center/core/profile
*/
const CODE_FILE_RE = /\.(?:mjs|cjs|js)$/;
/** Unquote a YAML scalar the shallow way (the profile is not a parser). */
function unquote(value) {
	const trimmed = value.trim();
	if (trimmed.startsWith("'") && trimmed.endsWith("'") || trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.slice(1, -1);
	return trimmed;
}
/** Profile one composition document. */
function profileComposition(text, codeFiles) {
	const plugins = [];
	const relativeNames = [];
	let inlineExpressions = 0;
	let rows = 0;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.replace(/\s+#.*$/, "");
		if (line.includes("!!js")) inlineExpressions += 1;
		const match = /^\s*-?\s*name:\s*(.+?)\s*$/.exec(line);
		if (match === null) continue;
		rows += 1;
		const name = unquote(match[1]);
		if (name === "" || name === "cordis:group") continue;
		if (name.startsWith(".")) relativeNames.push(name);
		else plugins.push(name);
	}
	const localCode = codeFiles.filter((rel) => CODE_FILE_RE.test(rel));
	const codeExecution = localCode.length > 0 || relativeNames.length > 0 ? "local" : inlineExpressions > 0 ? "inline" : "none";
	return {
		plugins: [...new Set(plugins)],
		relativeNames: [...new Set(relativeNames)],
		inlineExpressions,
		codeFiles: localCode,
		codeExecution,
		rows
	};
}
/** Profile one installed preset directory; an unreadable composition yields an empty profile. */
function profilePresetDir(dir) {
	let text = "";
	try {
		text = readFileSync(join(dir, COMPOSITION_FILE), "utf8");
	} catch {
		text = "";
	}
	return profileComposition(text, listFiles(dir));
}
/** Whether enabling this profile needs an explicit confirmation from the operator. */
function needsConfirmation(profile) {
	return profile.codeExecution !== "none";
}
//#endregion
//#region src/core/library.ts
/**
* The preset library: one directory, and the filesystem-derived state every
* surface reads.
*
* A directory under the library is installed and inert — the harness no longer
* scans any on-disk preset root, so a downloaded composition runs only once
* this plugin declares it to `ctx.agentPresets`. `enabled` therefore comes
* from the live declarations, not from the filesystem, and no operation here
* moves a directory: enabling is a registry call, disabling drops that call,
* and uninstalling deletes the bytes.
*
* The module owns no policy: reserved ids and the default-preset guard live in
* the route layer, which is the only place that can read the roster.
* @module @linxin666/dsh-client-ui-preset-center/core/library
*/
/** A refused library operation. */
var PresetOperationError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
	}
};
/** Subdirectory ids of the library, sorted; an absent root yields none. */
function scanPresetIds(root) {
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && isPresetId(entry.name)).map((entry) => entry.name).sort();
}
/**
* The state of one id, derived from the library directory and the live
* declarations.
* @param dshHome - DSH home root.
* @param id - preset id.
* @param declared - ids this plugin has declared to the registry.
* @returns the row every surface renders.
*/
function readPresetState(dshHome, id, declared) {
	const dir = libraryDirOf(dshHome, id);
	const installed = isDirectory(dir);
	const report = installed ? verifyProvenance(dir, id) : {
		state: "missing",
		provenance: null,
		mismatches: [],
		missing: [],
		extra: []
	};
	const provenance = report.provenance;
	return {
		id,
		installed,
		enabled: installed && declared.has(id),
		managed: provenance !== null,
		...provenance?.assetVersion === void 0 ? {} : { assetVersion: provenance.assetVersion },
		...provenance?.installedAt === void 0 ? {} : { installedAt: provenance.installedAt },
		integrity: installed ? report.state : "none",
		dir
	};
}
/** Every installed id with its state, sorted. */
function listPresetStates(dshHome, declared) {
	return scanPresetIds(libraryRoot(dshHome)).map((id) => readPresetState(dshHome, id, declared));
}
/** Absolute library path of one id. */
function libraryDirOf(dshHome, id) {
	return join(libraryRoot(dshHome), id);
}
/**
* Delete the library copy of a workshop-managed preset.
* @param dshHome - DSH home root.
* @param id - preset id.
* @throws {PresetOperationError} invalid-id or not-managed when the directory
*   exists without market provenance (a hand-authored directory is never
*   deleted); an absent preset is a no-op.
*/
function uninstallPreset(dshHome, id) {
	if (!isPresetId(id)) throw new PresetOperationError("invalid-id", `invalid preset id: ${String(id)}`);
	const dir = libraryDirOf(dshHome, id);
	if (!isDirectory(dir)) return;
	if (!verifyProvenance(dir, id).provenance) throw new PresetOperationError("not-managed", `preset was not installed from the Workshop: ${id}`);
	try {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 3,
			retryDelay: 50
		});
	} catch (err) {
		throw new PresetOperationError("write", err instanceof Error ? err.message : String(err));
	}
}
//#endregion
//#region src/routes.ts
const PRESET_CENTER_API_PREFIX = "/api/preset-center";
/** Composition viewer size cap (bytes). */
const COMPOSITION_MAX_BYTES = 256 * 1024;
const ERRORS = {
	"invalid-id": {
		status: 400,
		error: "invalid-id",
		message: "invalid preset id"
	},
	"invalid-body": {
		status: 400,
		error: "invalid-body"
	},
	"loopback-only": {
		status: 403,
		error: "loopback-only"
	},
	"method-not-allowed": {
		status: 405,
		error: "method-not-allowed"
	},
	"not-installed": {
		status: 404,
		error: "not-installed"
	},
	"not-enabled": {
		status: 404,
		error: "not-enabled"
	},
	"not-managed": {
		status: 409,
		error: "not-managed"
	},
	"shadowed": {
		status: 409,
		error: "shadowed"
	},
	"confirmation-required": {
		status: 409,
		error: "confirmation-required"
	},
	"broken": {
		status: 409,
		error: "broken"
	},
	"invalid-composition": {
		status: 409,
		error: "invalid-composition"
	},
	"default-preset": {
		status: 409,
		error: "default-preset"
	},
	"roster-unavailable": {
		status: 503,
		error: "roster-unavailable"
	},
	"write": {
		status: 500,
		error: "write"
	}
};
function send(res, status, payload) {
	writeJson(res, status, payload, { "cache-control": "no-store" });
}
function sendError(res, err, message) {
	send(res, err.status, {
		ok: false,
		error: err.error,
		...message === void 0 && err.message === void 0 ? {} : { message: message ?? err.message }
	});
}
/** One state row enriched with the composition profile. */
function rowPayload(home, row) {
	return {
		...row,
		profile: profilePresetDir(row.dir)
	};
}
/** Build the preset-center routes. */
function makePresetCenterRoutes(deps = {}) {
	const home = deps.dshHome ?? dshHome();
	const registryOf = deps.registry ?? (() => deps.ctx?.get("agentPresets"));
	const declarations = deps.declarations ?? new PresetDeclarations(registryOf);
	const declared = () => declarations.declared();
	const stateOf = (id) => readPresetState(home, id, declared());
	const guard = (req, res, method) => {
		if (!isLoopbackRequest(req)) {
			sendError(res, ERRORS["loopback-only"]);
			return false;
		}
		if (req.method !== method) {
			sendError(res, ERRORS["method-not-allowed"]);
			return false;
		}
		return true;
	};
	const readId = async (req, res) => {
		let body;
		try {
			body = await readJsonBody(req, { maxBytes: 16 * 1024 }) ?? {};
		} catch {
			sendError(res, ERRORS["invalid-body"]);
			return null;
		}
		if (!isPresetId(body.id)) {
			sendError(res, ERRORS["invalid-id"]);
			return null;
		}
		return {
			id: body.id,
			confirm: body.confirm === true
		};
	};
	const handleState = guardedHandler("preset-center/state", async (req, res) => {
		if (!guard(req, res, "GET")) return;
		const registry = registryOf();
		const ours = declared();
		let occupied = null;
		if (registry !== void 0) try {
			occupied = (await registry.list()).map((row) => row.id).filter((id) => !ours.has(id)).sort();
		} catch {
			occupied = null;
		}
		send(res, 200, {
			ok: true,
			defaultId: defaultIdOf(registry),
			occupied: occupied ?? [],
			rosterAvailable: occupied !== null,
			presets: listPresetStates(home, ours).map((row) => rowPayload(home, row))
		});
	});
	const handleComposition = guardedHandler("preset-center/composition", async (req, res) => {
		if (!guard(req, res, "GET")) return;
		const id = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("id");
		if (!isPresetId(id)) {
			sendError(res, ERRORS["invalid-id"]);
			return;
		}
		const row = stateOf(id);
		if (!row.installed) {
			sendError(res, ERRORS["not-installed"]);
			return;
		}
		const file = join(row.dir, COMPOSITION_FILE);
		try {
			if (statSync(file).size > 262144) {
				send(res, 200, {
					ok: true,
					id,
					text: "",
					truncated: true,
					profile: profilePresetDir(row.dir)
				});
				return;
			}
			send(res, 200, {
				ok: true,
				id,
				text: readFileSync(file, "utf8"),
				truncated: false,
				profile: profilePresetDir(row.dir)
			});
		} catch {
			sendError(res, ERRORS["not-installed"], "composition file is missing");
		}
	});
	const handleInstall = guardedHandler("preset-center/install", async (req, res) => {
		if (!guard(req, res, "POST")) return;
		const parsed = await readId(req, res);
		if (parsed === null) return;
		const { id, confirm } = parsed;
		const state = stateOf(id);
		if (!state.installed) {
			sendError(res, ERRORS["not-installed"]);
			return;
		}
		if (!state.managed) {
			sendError(res, ERRORS["not-managed"]);
			return;
		}
		if (state.enabled) {
			send(res, 200, {
				ok: true,
				state: rowPayload(home, state)
			});
			return;
		}
		const registry = registryOf();
		if (registry === void 0) {
			sendError(res, ERRORS["roster-unavailable"], "the agent-preset registry is unavailable");
			return;
		}
		try {
			if ((await registry.list()).map((row) => row.id).includes(id)) {
				sendError(res, ERRORS["shadowed"], `preset id is already declared by another plugin: ${id}`);
				return;
			}
		} catch {
			sendError(res, ERRORS["roster-unavailable"], "the agent-preset registry is unavailable");
			return;
		}
		const profile = profilePresetDir(state.dir);
		if (needsConfirmation(profile) && !confirm) {
			send(res, 409, {
				ok: false,
				error: "confirmation-required",
				message: "preset carries executable content",
				profile
			});
			return;
		}
		let definition;
		try {
			definition = readPresetDefinition(id, state.dir);
		} catch (err) {
			if (err instanceof CompositionError) {
				sendError(res, ERRORS["invalid-composition"], err.message);
				return;
			}
			throw err;
		}
		try {
			await declarations.declare(definition);
		} catch (err) {
			if (err instanceof DeclarationError) {
				sendError(res, err.code === "unavailable" ? ERRORS["roster-unavailable"] : ERRORS[err.code] ?? ERRORS.write, err.message);
				return;
			}
			throw err;
		}
		const broken = await brokenReason(registry, id);
		if (broken !== void 0) {
			try {
				await declarations.undeclare(id);
			} catch {}
			send(res, 409, {
				ok: false,
				error: "broken",
				message: broken
			});
			return;
		}
		send(res, 200, {
			ok: true,
			state: rowPayload(home, stateOf(id))
		});
	});
	const handleDisable = guardedHandler("preset-center/disable", async (req, res) => {
		if (!guard(req, res, "POST")) return;
		const parsed = await readId(req, res);
		if (parsed === null) return;
		const { id } = parsed;
		const refusal = refusalForProtected(registryOf(), id);
		if (refusal !== null) {
			sendError(res, ERRORS["default-preset"], refusal);
			return;
		}
		if (!await declarations.undeclare(id)) {
			sendError(res, ERRORS["not-enabled"]);
			return;
		}
		send(res, 200, {
			ok: true,
			state: rowPayload(home, stateOf(id))
		});
	});
	const handleUninstall = guardedHandler("preset-center/uninstall", async (req, res) => {
		if (!guard(req, res, "POST")) return;
		const parsed = await readId(req, res);
		if (parsed === null) return;
		const { id } = parsed;
		const refusal = refusalForProtected(registryOf(), id);
		if (refusal !== null) {
			sendError(res, ERRORS["default-preset"], refusal);
			return;
		}
		try {
			await declarations.undeclare(id);
		} catch (err) {
			if (err instanceof DeclarationError) {
				sendError(res, ERRORS[err.code] ?? ERRORS.write, err.message);
				return;
			}
			throw err;
		}
		try {
			uninstallPreset(home, id);
		} catch (err) {
			if (err instanceof PresetOperationError) {
				sendError(res, ERRORS[err.code] ?? ERRORS.write, err.message);
				return;
			}
			throw err;
		}
		send(res, 200, {
			ok: true,
			id
		});
	});
	const route = (path, handler) => ({
		kind: "exact",
		path,
		handler: (req, res) => {
			handler(req, res);
		}
	});
	return [
		route(`${PRESET_CENTER_API_PREFIX}/state`, handleState),
		route(`${PRESET_CENTER_API_PREFIX}/composition`, handleComposition),
		route(`${PRESET_CENTER_API_PREFIX}/install`, handleInstall),
		route(`${PRESET_CENTER_API_PREFIX}/disable`, handleDisable),
		route(`${PRESET_CENTER_API_PREFIX}/uninstall`, handleUninstall)
	];
}
/** Why a disable/uninstall of `id` is refused, or null when it is allowed. */
function refusalForProtected(registry, id) {
	const current = defaultIdOf(registry);
	if (current !== null && current === id) return `preset is the current default; change the default in Settings - Agent presets first: ${id}`;
	return null;
}
/** The registry's current default preset id, or null when it is unavailable. */
function defaultIdOf(registry) {
	if (registry === void 0) return null;
	try {
		return registry.defaultId;
	} catch {
		return null;
	}
}
/** The registry's broken reason for `id`, or undefined when healthy or unknown. */
async function brokenReason(registry, id) {
	if (registry === void 0) return void 0;
	try {
		return (await registry.list()).find((entry) => entry.id === id)?.broken;
	} catch {
		return;
	}
}
//#endregion
//#region src/index.ts
/** Stable cordis plugin name (matches the cordis.patch.yml insert id). */
const name = "ui-preset-center";
/** The gateway requires the host webserver; the registry is read opportunistically. */
const inject = ["webServer"];
/** Mount the preset-center gateway (once per process). */
const apply = mountOnce("@linxin666/dsh-client-ui-preset-center", applyImpl);
function applyImpl(ctx) {
	const declarations = new PresetDeclarations(() => ctx.get("agentPresets"));
	ctx.effect(() => () => declarations.release(), "dsh-preset-center: preset declarations");
	const routes = makePresetCenterRoutes({
		ctx,
		declarations
	});
	for (const route of routes) try {
		ctx.effect(() => {
			const dispose = ctx.webServer.register(route);
			return () => {
				dispose();
			};
		}, `dsh-preset-center: route ${route.path}`);
	} catch {}
}
//#endregion
export { COMPOSITION_FILE, COMPOSITION_MAX_BYTES, CompositionError, DeclarationError, LIBRARY_DIR, METADATA_FILE, PRESET_CENTER_API_PREFIX, PRESET_ID_RE, PROVENANCE_FILENAME, PresetDeclarations, PresetOperationError, apply, inject, isPresetId, libraryDirOf, libraryRoot, listFiles, listPresetStates, makePresetCenterRoutes, name, needsConfirmation, presetDefinition, profileComposition, profilePresetDir, readCompositionRows, readCordisYaml, readPresetDefinition, readPresetMetadata, readPresetState, readProvenance, scanPresetIds, uninstallPreset, verifyProvenance };
