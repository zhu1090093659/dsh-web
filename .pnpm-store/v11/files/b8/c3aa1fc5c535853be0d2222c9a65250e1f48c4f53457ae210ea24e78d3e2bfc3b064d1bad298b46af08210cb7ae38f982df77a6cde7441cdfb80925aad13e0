import { spawn, spawnSync } from "node:child_process";
import { cwd } from "node:process";
import { basename, delimiter, dirname, normalize, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";
import readline from "node:readline";
import { closeSync, openSync, readSync, statSync } from "node:fs";
//#region src/env.ts
const isPathLikePattern = /^path$/i;
const defaultEnvPathInfo = {
	key: "PATH",
	value: ""
};
function getPathFromEnv(env) {
	for (const key in env) {
		if (!Object.prototype.hasOwnProperty.call(env, key) || !isPathLikePattern.test(key)) continue;
		const value = env[key];
		if (!value) return defaultEnvPathInfo;
		return {
			key,
			value
		};
	}
	return defaultEnvPathInfo;
}
function addNodeBinToPath(cwd, path) {
	const parts = path.value.split(delimiter);
	const nodeBinPaths = [];
	let currentPath = cwd;
	let lastPath;
	do {
		nodeBinPaths.push(resolve(currentPath, "node_modules", ".bin"));
		lastPath = currentPath;
		currentPath = dirname(currentPath);
	} while (currentPath !== lastPath);
	nodeBinPaths.push(dirname(process.execPath));
	const newPath = nodeBinPaths.concat(parts).join(delimiter);
	return {
		key: path.key,
		value: newPath
	};
}
function computeEnv(cwd, env, nodePath = true) {
	const envWithDefault = {
		...process.env,
		...env
	};
	if (!nodePath) return envWithDefault;
	const envPathInfo = addNodeBinToPath(cwd, getPathFromEnv(envWithDefault));
	envWithDefault[envPathInfo.key] = envPathInfo.value;
	return envWithDefault;
}
//#endregion
//#region src/stream.ts
const combineStreams = (streams) => {
	let streamCount = streams.length;
	const combined = new PassThrough();
	const maybeEmitEnd = () => {
		if (--streamCount === 0) combined.end();
	};
	for (const stream of streams) pipeline(stream, combined, { end: false }).then(maybeEmitEnd).catch(maybeEmitEnd);
	return combined;
};
//#endregion
//#region src/normalize.ts
const metaCharsRegExp = /([()\][%!^"`<>&|;, *?])/g;
const shebangRegExp = /^#!\s*(.+)/;
const isWindowsExecutableRegExp = /\.(?:com|exe)$/i;
const isNodeModulesCmdRegExp = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;
const isWindows = process.platform === "win32";
const defaultPathExt = [
	".EXE",
	".CMD",
	".BAT",
	".COM"
];
const noPathExt = [""];
/**
* Normalizes the command and arguments to work cross-platform.
* On Windows, this basically handles things like shebangs, calling
* `node_modules/.bin` commands, and escaping meta characters.
* On other platforms, it just returns the command and arguments as-is.
*/
function normalizeSpawnCommand(command, args = [], options = {}) {
	if (options.shell === true || !isWindows) return {
		command,
		args,
		options
	};
	let file = resolveCommand(command, options);
	let shebang = null;
	if (file !== null) {
		const size = 150;
		const buffer = Buffer.alloc(size);
		let fd = null;
		try {
			fd = openSync(file, "r");
			readSync(fd, buffer, 0, size, 0);
		} catch {} finally {
			if (fd !== null) closeSync(fd);
		}
		const match = buffer.toString().match(shebangRegExp);
		if (match !== null) {
			const line = match[1].trim();
			const separatorIndex = line.indexOf(" ");
			const path = separatorIndex !== -1 ? line.slice(0, separatorIndex) : line;
			const argument = separatorIndex !== -1 ? line.slice(separatorIndex + 1) : "";
			const binary = basename(path);
			shebang = binary === "env" ? argument || null : binary;
		}
	}
	if (shebang !== null && file !== null) {
		args = [file, ...args];
		command = shebang;
		file = resolveCommand(command, options);
	}
	if (file === null || !isWindowsExecutableRegExp.test(file)) {
		const needsDoubleEscapeMetaChars = file !== null && isNodeModulesCmdRegExp.test(file);
		command = normalize(command);
		command = command.replace(metaCharsRegExp, "^$1");
		args = args.map((arg) => {
			arg = arg.replace(/(?=(\\+?)?)\1"/g, "$1$1\\\"");
			arg = arg.replace(/(?=(\\+?)?)\1$/, "$1$1");
			arg = `"${arg}"`;
			arg = arg.replace(metaCharsRegExp, "^$1");
			if (needsDoubleEscapeMetaChars) arg = arg.replace(metaCharsRegExp, "^$1");
			return arg;
		});
		args = [
			"/d",
			"/s",
			"/c",
			`"${[command, ...args].join(" ")}"`
		];
		command = options.env?.comspec ?? "cmd.exe";
		options = {
			...options,
			windowsVerbatimArguments: true
		};
	}
	return {
		command,
		args,
		options
	};
}
/**
* Resolves the command to an absolute path if possible.
* Handles things like traversing PATH and adding extensions from PATHEXT
*/
function resolveCommand(command, options) {
	const cwd$3 = (options.cwd ?? cwd()).toString();
	const env = options.env ?? process.env;
	const PATH = getPathFromEnv(env).value;
	const pathEnv = command.includes("/") || command.includes("\\") ? [""] : [cwd$3, ...PATH.split(delimiter)];
	let pathExt = env.PATHEXT ? env.PATHEXT.split(delimiter) : defaultPathExt;
	if (command.includes(".") && pathExt[0] !== "") pathExt = ["", ...pathExt];
	for (const extensions of [pathExt, noPathExt]) for (const path of pathEnv) {
		const dest = resolve(cwd$3, path.startsWith("\"") && path.endsWith("\"") && path.length > 1 ? path.slice(1, -1) : path, command);
		for (const ext of extensions) {
			const destWithExt = dest + ext;
			try {
				if (statSync(destWithExt).isFile()) return destWithExt;
			} catch {}
		}
	}
	return null;
}
//#endregion
//#region src/non-zero-exit-error.ts
var NonZeroExitError = class extends Error {
	result;
	output;
	exitCode;
	get signalCode() {
		return this.result.signalCode;
	}
	constructor(result, output, command, args) {
		let target = "The process";
		if (command) target = `The command \`${args?.length ? `${command} ${args.map((a) => /[ "'`()]/.test(a) ? JSON.stringify(a) : a).join(" ")}` : command}\``;
		const exitCode = result.exitCode ?? 1;
		super(result.signalCode !== null ? `${target} was killed by the signal ${result.signalCode}` : `${target} exited with a non-zero status (${exitCode})`);
		this.result = result;
		this.output = output;
		this.exitCode = exitCode;
		Object.defineProperty(this, "result", {
			enumerable: false,
			writable: false,
			configurable: false
		});
	}
};
//#endregion
//#region src/main.ts
const LINE_SEPARATOR_REGEX = /\r?\n/;
const defaultOptions = {
	timeout: void 0,
	persist: false
};
const defaultSyncOptions = { timeout: void 0 };
const defaultNodeOptions = { windowsHide: true };
function combineSignals(signals) {
	const controller = new AbortController();
	for (const signal of signals) {
		if (signal.aborted) {
			controller.abort();
			return signal;
		}
		const onAbort = () => {
			controller.abort(signal.reason);
		};
		signal.addEventListener("abort", onAbort, { signal: controller.signal });
	}
	return controller.signal;
}
async function readStream(stream) {
	let output = "";
	try {
		for await (const chunk of stream) output += chunk.toString();
	} catch {}
	return output;
}
var ExecProcess = class {
	_process;
	_aborted = false;
	_options;
	_command;
	_args;
	_resolveClose;
	_processClosed;
	_thrownError;
	get process() {
		return this._process;
	}
	get pid() {
		return this._process?.pid;
	}
	get exitCode() {
		if (this._process && this._process.exitCode !== null) return this._process.exitCode;
	}
	get signalCode() {
		return this._process?.signalCode ?? null;
	}
	constructor(command, args, options) {
		this._options = {
			...defaultOptions,
			...options
		};
		this._command = command;
		this._args = args ?? [];
		this._processClosed = new Promise((resolve) => {
			this._resolveClose = resolve;
		});
	}
	kill(signal) {
		return this._process?.kill(signal) === true;
	}
	get aborted() {
		return this._aborted;
	}
	get killed() {
		return this._process?.killed === true;
	}
	pipe(command, args, options) {
		return exec(command, args, {
			...options,
			stdin: this
		});
	}
	async *[Symbol.asyncIterator]() {
		const proc = this._process;
		if (!proc) return;
		const streams = [];
		if (this._streamErr) streams.push(this._streamErr);
		if (this._streamOut) streams.push(this._streamOut);
		const streamCombined = combineStreams(streams);
		const rl = readline.createInterface({ input: streamCombined });
		for await (const chunk of rl) yield chunk.toString();
		await this._processClosed;
		proc.removeAllListeners();
		if (this._thrownError) throw this._thrownError;
		if (this._options?.throwOnError && (this.exitCode !== 0 && this.exitCode !== void 0 || this.signalCode !== null)) throw new NonZeroExitError(this, void 0, this._command, this._args);
	}
	async _waitForOutput() {
		const proc = this._process;
		if (!proc) throw new Error("No process was started");
		const [stdout, stderr] = await Promise.all([this._streamOut ? readStream(this._streamOut) : "", this._streamErr ? readStream(this._streamErr) : ""]);
		await this._processClosed;
		const { stdin } = this._options;
		if (stdin && typeof stdin !== "string") await stdin;
		proc.removeAllListeners();
		if (this._thrownError) throw this._thrownError;
		const result = {
			stderr,
			stdout,
			exitCode: this.exitCode
		};
		if (this._options.throwOnError && (this.exitCode !== 0 && this.exitCode !== void 0 || this.signalCode !== null)) throw new NonZeroExitError(this, result, this._command, this._args);
		return result;
	}
	then(onfulfilled, onrejected) {
		return this._waitForOutput().then(onfulfilled, onrejected);
	}
	_streamOut;
	_streamErr;
	spawn() {
		const cwd$1 = cwd();
		const options = this._options;
		const nodeOptions = {
			...defaultNodeOptions,
			...options.nodeOptions
		};
		const signals = [];
		this._resetState();
		if (options.timeout !== void 0) signals.push(AbortSignal.timeout(options.timeout));
		if (options.signal !== void 0) signals.push(options.signal);
		if (options.persist === true) nodeOptions.detached = true;
		if (signals.length > 0) nodeOptions.signal = combineSignals(signals);
		nodeOptions.env = computeEnv(cwd$1, nodeOptions.env, options.nodePath);
		const crossResult = normalizeSpawnCommand(this._command, this._args, nodeOptions);
		const handle = spawn(crossResult.command, crossResult.args, crossResult.options);
		if (handle.stderr) this._streamErr = handle.stderr;
		if (handle.stdout) this._streamOut = handle.stdout;
		this._process = handle;
		handle.once("error", this._onError);
		handle.once("close", this._onClose);
		if (handle.stdin) {
			const { stdin } = options;
			if (typeof stdin === "string") handle.stdin.end(stdin);
			else stdin?.process?.stdout?.pipe(handle.stdin);
		}
	}
	_resetState() {
		this._aborted = false;
		this._processClosed = new Promise((resolve) => {
			this._resolveClose = resolve;
		});
		this._thrownError = void 0;
	}
	_onError = (err) => {
		if (err.name === "AbortError" && (!(err.cause instanceof Error) || err.cause.name !== "TimeoutError")) {
			this._aborted = true;
			return;
		}
		this._thrownError = err;
	};
	_onClose = () => {
		if (this._resolveClose) this._resolveClose();
	};
};
function xSync(command, args, options) {
	const opts = {
		...defaultSyncOptions,
		...options
	};
	const cwd$2 = cwd();
	const nodeOptions = {
		windowsHide: true,
		...opts.nodeOptions
	};
	if (opts.timeout !== void 0) nodeOptions.timeout = opts.timeout;
	nodeOptions.env = computeEnv(cwd$2, nodeOptions.env, opts.nodePath);
	const crossResult = normalizeSpawnCommand(command, args ?? [], nodeOptions);
	const spawnResult = spawnSync(crossResult.command, crossResult.args, crossResult.options);
	if (spawnResult.error) throw spawnResult.error;
	const stdout = spawnResult.stdout?.toString() ?? "";
	const stderr = spawnResult.stderr?.toString() ?? "";
	const exitCode = spawnResult.status ?? void 0;
	const signalCode = spawnResult.signal ?? null;
	const killed = signalCode !== null;
	const result = {
		stdout,
		stderr,
		get exitCode() {
			return exitCode;
		},
		get signalCode() {
			return signalCode;
		},
		get pid() {
			return spawnResult.pid;
		},
		get killed() {
			return killed;
		},
		*[Symbol.iterator]() {
			for (const text of [stdout, stderr]) {
				if (!text) continue;
				const lines = text.split(LINE_SEPARATOR_REGEX);
				if (lines[lines.length - 1] === "") lines.pop();
				yield* lines;
			}
		}
	};
	if (opts.throwOnError && (exitCode !== 0 && exitCode !== void 0 || signalCode !== null)) throw new NonZeroExitError(result, {
		stdout: result.stdout,
		stderr: result.stderr,
		exitCode: result.exitCode
	}, command, args);
	return result;
}
const x = (command, args, userOptions) => {
	const proc = new ExecProcess(command, args, userOptions);
	proc.spawn();
	return proc;
};
const exec = x;
const execSync = xSync;
//#endregion
export { ExecProcess, NonZeroExitError, exec, execSync, normalizeSpawnCommand, x, xSync };
