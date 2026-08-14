import { Service } from "@deepseek-ai/cordis";
//#region lib/types/index.js
/**
* Service Definition for the credential-reference capability seam (`ctx.credentials`). Settings and composition files carry
* *references* to secrets — environment-variable names — while providers own
* the actual values and their storage. Consumers resolve a reference once per
* operation, so a changed credential reaches the next operation without any
* plugin restart, and configuration surfaces describe a reference without
* ever seeing its value.
* @module @deepseek-ai/dsh-credentials
*/
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
* Brand a raw string as a {@link CredentialRef}.
* @param value - candidate reference; a POSIX shell identifier such as `DEEPSEEK_API_KEY`.
* @returns the branded reference.
*/
function credentialRef(value) {
	if (!REF_PATTERN.test(value)) throw new TypeError(`credential ref "${value}" must match ${String(REF_PATTERN)}`);
	return value;
}
/**
* Abstract credential service. Providers implement the four operations over
* their source layers; one seam-wide rule binds them all: an empty stored
* value is absent everywhere — `resolve` skips it, `describe` reports it
* unconfigured — so a blank never masquerades as a configured secret.
*/
var CredentialProvider = class extends Service {
	constructor(ctx) {
		super(ctx, "credentials");
	}
	/**
	* Fan `credentials/updated` out with contained listener failures: every
	* listener runs, and a sync throw or async rejection is logged without
	* changing the committed operation's outcome — except `INVARIANT`-coded
	* failures, which rethrow after every listener ran (the rethrow reaches the
	* caller only from synchronous listeners, so invariant checks on this event
	* must not be async functions). Providers call this only after the write or
	* reload actually committed, so a broken observer can never make a durable
	* change look failed.
	* @param ref - the reference whose stored value changed.
	*/
	notifyUpdated(ref) {
		let invariantFailure;
		const args = ["credentials/updated", ref];
		for (const listener of this.ctx.events.dispatch("emit", args)) try {
			const returned = listener(ref);
			if (returned != null && typeof returned.then === "function") Promise.resolve(returned).then(void 0, (error) => {
				this.warnListenerFailure(ref, error);
			});
		} catch (error) {
			if (error?.code === "INVARIANT") {
				invariantFailure ??= error;
				continue;
			}
			this.warnListenerFailure(ref, error);
		}
		if (invariantFailure !== void 0) throw invariantFailure;
	}
	/** Contained-listener diagnostic shared by the sync and async failure paths. */
	warnListenerFailure(ref, error) {
		this.ctx.logger.warn("credentials: a credentials/updated listener for \"%s\" failed", ref);
		this.ctx.logger.warn(error);
	}
};
//#endregion
export { CredentialProvider, CredentialProvider as default, credentialRef };
