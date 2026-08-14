import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
//#region lib/types/index.js
/**
* Configurable registry for package-owned runtime invariant contributions.
* Every workspace package registers checks from a `./invariant` companion;
* ordinary package entrypoints stay independent of diagnostics.
*
* @module @deepseek-ai/dsh-invariants
*/
/** Thrown when a package-owned runtime invariant is violated. */
var InvariantError = class extends Error {
	/** Stable machine-readable invariant failure code. */
	code = "INVARIANT";
	/** Full npm package name that owns the violated invariant. */
	packageName;
	/**
	* Construct a package-attributed invariant failure.
	* @param packageName - full npm package name that registered the check.
	* @param message - violated contract, without the standard error prefix.
	*/
	constructor(packageName, message) {
		super(`invariant violated by "${packageName}": ${message}`);
		this.name = "InvariantError";
		this.packageName = packageName;
	}
};
/** Compile and validate one package-filter list. */
function compilePatterns(field, values) {
	const seen = /* @__PURE__ */ new Set();
	return values.map((value) => {
		if (value.length === 0 || value.trim() !== value) throw new Error(`invariants: ${field} entries must be non-blank and have no surrounding whitespace`);
		if (seen.has(value)) throw new Error(`invariants: ${field} contains duplicate regex ${JSON.stringify(value)}`);
		seen.add(value);
		try {
			return new RegExp(value);
		} catch (cause) {
			throw new Error(`invariants: ${field} contains invalid regex ${JSON.stringify(value)}`, { cause });
		}
	});
}
/** Package-owned invariant registry with global and regex-based selection. */
var InvariantRegistry = class extends Service {
	static Config = z.object({
		enabled: z.boolean().default(true),
		package_allowlist: z.array(z.string()).default([]),
		package_blocklist: z.array(z.string()).default([])
	});
	enabled;
	ownerCtx;
	packageAllowlist;
	packageBlocklist;
	registrations = /* @__PURE__ */ new Set();
	/**
	* Create and install the invariant registry.
	* @param ctx - Cordis context that owns the service.
	* @param config - global enablement and package-name regex filters.
	*/
	constructor(ctx, config = {}) {
		super(ctx, "invariants");
		this.ownerCtx = ctx;
		this.enabled = config.enabled ?? true;
		this.packageAllowlist = compilePatterns("package_allowlist", config.package_allowlist ?? []);
		this.packageBlocklist = compilePatterns("package_blocklist", config.package_blocklist ?? []);
	}
	/** Return whether one full package name passes the configured filters. */
	selected(packageName) {
		if (!this.enabled) return false;
		if (this.packageAllowlist.length > 0 && !this.packageAllowlist.some((pattern) => pattern.test(packageName))) return false;
		return !this.packageBlocklist.some((pattern) => pattern.test(packageName));
	}
	/**
	* Register one package's invariant installer. The package name is reserved
	* even when filtering disables its checks. Enabled installers run in a child
	* fiber; failure disposes that fiber and releases the reservation.
	* @param packageName - full npm package name that owns the contribution.
	* @param installer - listener or startup-check installer for the child context.
	* @returns an effect-scoped disposer for the registration.
	*/
	register(packageName, installer) {
		if (packageName.length === 0 || packageName.trim() !== packageName || /\s/.test(packageName)) throw new Error("invariants: packageName must be non-blank and contain no whitespace");
		if (this.registrations.has(packageName)) throw new Error(`invariants: package "${packageName}" is already registered`);
		const ctx = this.ownerCtx;
		const registrations = this.registrations;
		registrations.add(packageName);
		let registration;
		try {
			registration = ctx.effect(async () => {
				if (!this.selected(packageName)) return () => {
					registrations.delete(packageName);
				};
				const installInvariant = (childCtx) => installer(childCtx, (message) => {
					throw new InvariantError(packageName, message);
				});
				try {
					const child = ctx.plugin(installer.inject === void 0 ? installInvariant : Object.assign(installInvariant, { inject: installer.inject }));
					try {
						await child;
					} catch (error) {
						await child.dispose();
						throw error;
					}
					return async () => {
						try {
							await child.dispose();
						} finally {
							registrations.delete(packageName);
						}
					};
				} catch (error) {
					registrations.delete(packageName);
					throw error;
				}
			}, `invariants.register(${JSON.stringify(packageName)})`);
		} catch (error) {
			registrations.delete(packageName);
			throw error;
		}
		return registration;
	}
};
//#endregion
export { InvariantError, InvariantRegistry, InvariantRegistry as default };
