import path from 'node:path';
import { promises as fs } from 'node:fs';

const POSIX_SEP_RE = new RegExp('\\' + path.posix.sep, 'g');
const NATIVE_SEP_RE = new RegExp('\\' + path.sep, 'g');
/** @type {Map<string,RegExp>}*/
const PATTERN_REGEX_CACHE = new Map();
const GLOB_ALL_PATTERN = `**/*`;
const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const JS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];
const TSJS_EXTENSIONS = TS_EXTENSIONS.concat(JS_EXTENSIONS);
const TS_EXTENSIONS_RE_GROUP = `\\.(?:${TS_EXTENSIONS.map((ext) => ext.substring(1)).join('|')})`;
const TSJS_EXTENSIONS_RE_GROUP = `\\.(?:${TSJS_EXTENSIONS.map((ext) => ext.substring(1)).join(
	'|'
)})`;
const IS_POSIX = path.posix.sep === path.sep;

/**
 * @template T
 * @returns {{resolve:(result:T)=>void, reject:(error:any)=>void, promise: Promise<T>}}
 */
export function makePromise() {
	let resolve, reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/**
 * loads typescript async to avoid direct dependency
 * @returns {Promise<any>}
 */
export async function loadTS() {
	try {
		return import('typescript').then((m) => m.default);
	} catch (e) {
		console.error('typescript must be installed to use "native" functions');
		throw e;
	}
}

/**
 * @param {string} filename
 * @param {import('./cache.js').TSConfckCache} [cache]
 * @returns {Promise<string|void>}
 */
export async function resolveTSConfigJson(filename, cache) {
	if (path.extname(filename) !== '.json') {
		return; // ignore files that are not json
	}
	const tsconfig = path.resolve(filename);
	if (cache && (cache.hasParseResult(tsconfig) || cache.hasParseResult(filename))) {
		return tsconfig;
	}
	return fs.stat(tsconfig).then((stat) => {
		if (stat.isFile() || stat.isFIFO()) {
			return tsconfig;
		} else {
			throw new Error(`${filename} exists but is not a regular file.`);
		}
	});
}

/**
 *
 * @param {string} dir an absolute directory path
 * @returns {boolean}  if dir path includes a node_modules segment
 */
export const isInNodeModules = IS_POSIX
	? (dir) => dir.includes('/node_modules/')
	: (dir) => dir.match(/[/\\]node_modules[/\\]/);

/**
 * convert posix separator to native separator
 *
 * eg.
 * windows: C:/foo/bar -> c:\foo\bar
 * linux: /foo/bar -> /foo/bar
 *
 * @param {string} filename with posix separators
 * @returns {string} filename with native separators
 */
export const posix2native = IS_POSIX
	? (filename) => filename
	: (filename) => filename.replace(POSIX_SEP_RE, path.sep);

/**
 * convert native separator to posix separator
 *
 * eg.
 * windows: C:\foo\bar -> c:/foo/bar
 * linux: /foo/bar -> /foo/bar
 *
 * @param {string} filename - filename with native separators
 * @returns {string} filename with posix separators
 */
export const native2posix = IS_POSIX
	? (filename) => filename
	: (filename) => filename.replace(NATIVE_SEP_RE, path.posix.sep);

/**
 * converts params to native separator, resolves path and converts native back to posix
 *
 * needed on windows to handle posix paths in tsconfig
 *
 * @param dir {string|null} directory to resolve from
 * @param filename {string} filename or pattern to resolve
 * @returns string
 */
export const resolve2posix = IS_POSIX
	? (dir, filename) => (dir ? path.resolve(dir, filename) : path.resolve(filename))
	: (dir, filename) =>
			native2posix(
				dir
					? path.resolve(posix2native(dir), posix2native(filename))
					: path.resolve(posix2native(filename))
			);

/**
 *
 * @param {import('./public.d.ts').TSConfckParseResult} result
 * @param {import('./public.d.ts').TSConfckParseOptions} [options]
 * @returns {string[]}
 */
export function resolveReferencedTSConfigFiles(result, options) {
	const dir = path.dirname(result.tsconfigFile);
	return result.tsconfig.references.map((ref) => {
		const refPath = ref.path.endsWith('.json')
			? ref.path
			: path.join(ref.path, options?.configName ?? 'tsconfig.json');
		return resolve2posix(dir, refPath);
	});
}

/**
 * @param {string} filename
 * @param {import('./public.d.ts').TSConfckParseResult} result
 * @returns {import('./public.d.ts').TSConfckParseResult}
 */
export function resolveSolutionTSConfig(filename, result) {
	const allowJs = result.tsconfig.compilerOptions?.allowJs;
	const extensions = allowJs ? TSJS_EXTENSIONS : TS_EXTENSIONS;
	if (
		result.referenced &&
		extensions.some((ext) => filename.endsWith(ext)) &&
		!isIncluded(filename, result)
	) {
		const solutionTSConfig = result.referenced.find((referenced) =>
			isIncluded(filename, referenced)
		);
		if (solutionTSConfig) {
			return solutionTSConfig;
		}
	}
	return result;
}

/**
 *
 * @param {string} filename
 * @param {import('./public.d.ts').TSConfckParseResult} result
 * @returns {boolean}
 */
function isIncluded(filename, result) {
	const dir = native2posix(path.dirname(result.tsconfigFile));
	const files = (result.tsconfig.files || []).map((file) => resolve2posix(dir, file));
	const absoluteFilename = resolve2posix(null, filename);
	if (files.includes(filename)) {
		return true;
	}
	const allowJs = result.tsconfig.compilerOptions?.allowJs;
	const isIncluded = isGlobMatch(
		absoluteFilename,
		dir,
		result.tsconfig.include || (result.tsconfig.files ? [] : [GLOB_ALL_PATTERN]),
		allowJs
	);
	if (isIncluded) {
		const isExcluded = isGlobMatch(absoluteFilename, dir, result.tsconfig.exclude || [], allowJs);
		return !isExcluded;
	}
	return false;
}

/**
 * test filenames agains glob patterns in tsconfig
 *
 * @param filename {string} posix style abolute path to filename to test
 * @param dir {string} posix style absolute path to directory of tsconfig containing patterns
 * @param patterns {string[]} glob patterns to match against
 * @param allowJs {boolean} allowJs setting in tsconfig to include js extensions in checks
 * @returns {boolean} true when at least one pattern matches filename
 */
export function isGlobMatch(filename, dir, patterns, allowJs) {
	const extensions = allowJs ? TSJS_EXTENSIONS : TS_EXTENSIONS;
	return patterns.some((pattern) => {
		// filename must end with part of pattern that comes after last wildcard
		let lastWildcardIndex = pattern.length;
		let hasWildcard = false;
		let hasExtension = false;
		let hasSlash = false;
		let lastSlashIndex = -1;
		for (let i = pattern.length - 1; i > -1; i--) {
			const c = pattern[i];
			if (!hasWildcard) {
				if (c === '*' || c === '?') {
					lastWildcardIndex = i;
					hasWildcard = true;
				}
			}
			if (!hasSlash) {
				if (c === '.') {
					hasExtension = true;
				} else if (c === '/') {
					lastSlashIndex = i;
					hasSlash = true;
				}
			}
			if (hasWildcard && hasSlash) {
				break;
			}
		}
		if (!hasExtension && (!hasWildcard || lastWildcardIndex < lastSlashIndex)) {
			// add implicit glob
			pattern += `${pattern.endsWith('/') ? '' : '/'}${GLOB_ALL_PATTERN}`;
			lastWildcardIndex = pattern.length - 1;
			hasWildcard = true;
		}

		// if pattern does not end with wildcard, filename must end with pattern after last wildcard
		if (
			lastWildcardIndex < pattern.length - 1 &&
			!filename.endsWith(pattern.slice(lastWildcardIndex + 1))
		) {
			return false;
		}

		// if pattern ends with *, filename must end with a default extension
		if (pattern.endsWith('*') && !extensions.some((ext) => filename.endsWith(ext))) {
			return false;
		}

		// for **/* , filename must start with the dir
		if (pattern === GLOB_ALL_PATTERN) {
			return filename.startsWith(`${dir}/`);
		}

		const resolvedPattern = resolve2posix(dir, pattern);

		// filename must start with part of pattern that comes before first wildcard
		let firstWildcardIndex = -1;
		for (let i = 0; i < resolvedPattern.length; i++) {
			if (resolvedPattern[i] === '*' || resolvedPattern[i] === '?') {
				firstWildcardIndex = i;
				hasWildcard = true;
				break;
			}
		}
		if (
			firstWildcardIndex > 1 &&
			!filename.startsWith(resolvedPattern.slice(0, firstWildcardIndex - 1))
		) {
			return false;
		}

		if (!hasWildcard) {
			//  no wildcard in pattern, filename must be equal to resolved pattern
			return filename === resolvedPattern;
		} else if (
			firstWildcardIndex + GLOB_ALL_PATTERN.length ===
				resolvedPattern.length - (pattern.length - 1 - lastWildcardIndex) &&
			resolvedPattern.slice(firstWildcardIndex, firstWildcardIndex + GLOB_ALL_PATTERN.length) ===
				GLOB_ALL_PATTERN
		) {
			// singular glob-all pattern and we already validated prefix and suffix matches
			return true;
		}
		// complex pattern, use regex to check it
		if (PATTERN_REGEX_CACHE.has(resolvedPattern)) {
			return PATTERN_REGEX_CACHE.get(resolvedPattern).test(filename);
		}
		const regex = pattern2regex(resolvedPattern, allowJs);
		PATTERN_REGEX_CACHE.set(resolvedPattern, regex);
		return regex.test(filename);
	});
}

/**
 * @param {string} resolvedPattern
 * @param {boolean} allowJs
 * @returns {RegExp}
 */
function pattern2regex(resolvedPattern, allowJs) {
	let regexStr = '^';
	for (let i = 0; i < resolvedPattern.length; i++) {
		const char = resolvedPattern[i];
		if (char === '?') {
			regexStr += '[^\\/]';
			continue;
		}
		if (char === '*') {
			if (resolvedPattern[i + 1] === '*' && resolvedPattern[i + 2] === '/') {
				i += 2;
				regexStr += '(?:[^\\/]*\\/)*'; // zero or more path segments
				continue;
			}
			regexStr += '[^\\/]*';
			continue;
		}
		if ('/.+^${}()|[]\\'.includes(char)) {
			regexStr += `\\`;
		}
		regexStr += char;
	}

	// add known file endings if pattern ends on *
	if (resolvedPattern.endsWith('*')) {
		regexStr += allowJs ? TSJS_EXTENSIONS_RE_GROUP : TS_EXTENSIONS_RE_GROUP;
	}
	regexStr += '$';

	return new RegExp(regexStr);
}

/**
 * replace tokens like ${configDir}
 * @param {import('./public.d.ts').TSConfckParseResult} result
 */
export function replaceTokens(result) {
	if (result.tsconfig) {
		result.tsconfig = JSON.parse(
			JSON.stringify(result.tsconfig)
				// replace ${configDir}
				.replaceAll(/"\${configDir}/g, `"${native2posix(path.dirname(result.tsconfigFile))}`)
		);
	}
}
