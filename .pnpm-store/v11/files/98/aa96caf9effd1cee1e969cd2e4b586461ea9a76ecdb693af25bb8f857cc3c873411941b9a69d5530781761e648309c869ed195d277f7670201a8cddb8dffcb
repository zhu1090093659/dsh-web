import { Service } from "@deepseek-ai/cordis";
//#region lib/types/types.js
/**
* Vocabulary for the subprocess Service Definition: fully-specified spawn requests with
* Node-shaped per-stream stdio modes, bounded collected output with spill
* recovery, raw piped streams, and tree-scoped termination. Command
* defaulting, shell semantics, protocol framing, and presentation belong to
* consumers such as the bash executor seam.
* @module dsh-subprocess/types
*/
/** Namespace prefix reserved for DeepSeek Harness-managed child environment facts. */
const DSH_ENV_PREFIX = "DSH_";
//#endregion
//#region lib/types/index.js
/**
* Service Definition for the subprocess capability seam (`ctx.subprocess`): execution-world executable lookup,
* fully specified managed process trees with raw or
* collected stdio, and one terminal-process primitive. Command defaulting,
* shell semantics, deadlines, protocol framing, terminal readiness, and
* presentation belong to consumers. The local implementation lives in
* `@deepseek-ai/dsh-subprocess-local`.
* @module @deepseek-ai/dsh-subprocess
*/
/**
* Credential-shaped environment names are NOT forwarded to children (the
* harness's own `DEEPSEEK_API_KEY`/secrets must not leak into a spawned
* process implicitly). One heuristic for every in-repo spawner; a
* deliberately supplied entry survives because explicit env layers merge
* after the scrub.
*/
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;
/**
* The ambient parent environment minus credential-shaped names and minus all
* `DSH_*` names — the canonical base every harness child starts from. `PATH`,
* `HOME`, locale, and proxy variables survive, so child CLIs run normally;
* harness identity never leaks implicitly (a deliberately forwarded
* credential or current `DSH_*` fact goes through the spec's explicit `env`,
* which merges after this scrub). Both scrubs match case-insensitively:
* Windows environment names are case-insensitive, so a parent `dsh_*` entry
* would otherwise survive and read back as `$env:DSH_*` in the child;
* deliberate lowercase `dsh_*` names on POSIX are implausible. Exported as a plain function so spawners
* that cannot route through the service (node-pty backends, SDK-managed
* transports) share the one scrub definition.
* @returns a fresh environment object safe to hand to a child spawn.
*/
function scrubbedParentEnv() {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) if (value !== void 0 && !SENSITIVE_ENV_PATTERN.test(key) && !key.toUpperCase().startsWith("DSH_")) env[key] = value;
	return env;
}
/**
* Abstract subprocess service. Subclass, implement {@link spawn}, and load the
* subclass as a plugin — it registers as `ctx.subprocess` (one implementation
* per context; loading a second throws, which is cordis' standard
* duplicate-service behavior).
*
* Implementations must honor these semantics:
* - Executable paths belong to one execution world shared with the mounted
*   filesystem provider.
* - {@link spawn} returns immediately with a live handle; `done` resolves at
*   process close with exit facts and rejects only for spawn-level failures.
* - Collect-mode readers are offset-based and non-consuming, so independent
*   readers never consume one another's output; lossy reads report truncation
*   and the spill file holding the complete stream when one exists. Piped
*   streams are handed to the caller raw and never buffered here.
* - {@link SubprocessHandle.terminate} (and the spec's abort signal) escalates
*   SIGTERM→grace→SIGKILL — the only termination verb — tree-scoped on every
*   platform. {@link SubprocessHandle.waitForExit} observes whole-tree
*   liveness, so a consumer-owned teardown ladder can hold each tier on real
*   quiescence.
* - Disposal of the service terminates all still-running managed processes
*   and awaits their exit.
* - {@link spawnTerminal} owns terminal allocation, text transport,
*   foreground groups, signalling, and whole-session quiescence behind one
*   awaited termination method; readiness and persistent-shell policy stay
*   in the PTY consumer. Its output stream ends after queued terminal output
*   when the top-level process exits.
*/
var SubprocessRuntime = class extends Service {
	constructor(ctx) {
		super(ctx, "subprocess");
	}
};
//#endregion
export { DSH_ENV_PREFIX, SENSITIVE_ENV_PATTERN, SubprocessRuntime, SubprocessRuntime as default, scrubbedParentEnv };
