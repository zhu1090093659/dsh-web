import { Service } from "@deepseek-ai/cordis";
//#region lib/types/brand.js
/** Attachment identifier brand. @module @deepseek-ai/dsh-attachment/brand */
/**
* Brand a validated storage identifier.
* @param value - backend-produced opaque identifier.
* @returns the branded identifier.
*/
function AttachmentId(value) {
	return value;
}
//#endregion
//#region lib/types/error.js
/** Attachment failure class. @module @deepseek-ai/dsh-attachment/error */
/**
* Stable failures suitable for host RPC error mapping.
*
* Deliberately re-implements the `HarnessError` shape instead of extending it:
* the base lives in `@deepseek-ai/dsh-llm`, which itself depends on this
* package (`ImageBlock` references `ImageAttachmentRef`), so sharing the base
* would create a dependency cycle. Consumers route on `code`, never on the
* prototype chain, so the shapes stay interchangeable at the wire boundary.
*/
var AttachmentError = class extends Error {
	/** Stable machine-routing failure code. */
	code;
	/**
	* @param message - human-readable failure description without raw bytes or host paths.
	* @param code - stable machine-routing code.
	* @param options - optional chained cause.
	*/
	constructor(message, code, options) {
		super(message, options);
		this.name = "AttachmentError";
		this.code = code;
	}
};
//#endregion
//#region lib/types/index.js
/** Durable attachment storage seam (`ctx.attachments`). @module @deepseek-ai/dsh-attachment */
/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
var AttachmentStore = class extends Service {
	constructor(ctx) {
		super(ctx, "attachments");
	}
};
//#endregion
export { AttachmentError, AttachmentId, AttachmentStore, AttachmentStore as default };
