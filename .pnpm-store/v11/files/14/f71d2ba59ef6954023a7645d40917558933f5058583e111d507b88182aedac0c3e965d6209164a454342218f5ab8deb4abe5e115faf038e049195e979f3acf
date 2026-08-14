import { execFile } from "node:child_process";
//#region lib/types/index.js
/**
* Shared no-shell `execFile` runner for host-native OS integrations (the
* native directory chooser, the open-with-default-application hand-off):
* utf8 stdio capture, abort propagation, Windows console hide. A library,
* not a plugin — no ctx, no state, no events.
* @module @deepseek-ai/dsh-native-command
*/
/**
* Run a host command with utf8 stdio, abort propagation, and Windows hide.
* @param command - executable path or PATH name.
* @param args - argv (never a shell string).
* @param signal - caller/connection lifetime; abort terminates the child.
* @returns captured stdout/stderr on exit 0.
*/
const runNativeCommand = (command, args, signal) => new Promise((resolve, reject) => {
	execFile(command, [...args], {
		encoding: "utf8",
		signal,
		windowsHide: true
	}, (error, stdout, stderr) => {
		if (error !== null) {
			reject(Object.assign(new Error(error.message, { cause: error }), {
				code: error.code,
				stdout,
				stderr
			}));
			return;
		}
		resolve({
			stdout,
			stderr
		});
	});
});
//#endregion
export { runNativeCommand };
