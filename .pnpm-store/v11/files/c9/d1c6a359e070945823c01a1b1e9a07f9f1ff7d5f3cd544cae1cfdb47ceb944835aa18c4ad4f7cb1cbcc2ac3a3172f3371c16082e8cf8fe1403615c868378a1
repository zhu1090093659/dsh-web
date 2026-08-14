import { Service } from "@deepseek-ai/cordis";
//#region lib/types/index.js
/**
* Service Definition for the `ctx.directoryPicker` capability seam: how the web-GUI host lets an operator
* select a workspace directory. Backends differ in interaction shape, not
* just mechanism, so the service exposes a discriminated capability instead
* of one method set: a `native` backend opens one OS chooser on the
* host's display, while a `browse` backend serves listing/creation primitives
* for an in-app browser (and thereby works for remote clients no OS dialog
* can reach). Consumers switch on `capability().kind`; the union is
* merge-extensible, and the documented default for an unknown kind is to
* hide the picking affordance rather than fail.
* @module @deepseek-ai/dsh-host-directory-picker
*/
/** Typed failure thrown by browse primitives so consumers can map business codes without string matching. */
var DirectoryPickerError = class extends Error {
	code;
	path;
	/**
	* @param code - closed business code of the failure.
	* @param path - the absolute path the failure is about.
	* @param message - operator-facing description.
	*/
	constructor(code, path, message) {
		super(message);
		this.code = code;
		this.path = path;
		this.name = "DirectoryPickerError";
	}
};
/**
* Abstract directory-picking service. Subclass, implement `capability()`, and
* load the subclass as a plugin — it registers as `ctx.directoryPicker` (one
* implementation per context; loading a second throws, cordis' standard
* duplicate-service behavior). The capability object must be stable for the
* service lifetime: consumers may capture it across calls.
*/
var DirectoryPicker = class extends Service {
	constructor(ctx) {
		super(ctx, "directoryPicker");
	}
};
//#endregion
export { DirectoryPicker, DirectoryPicker as default, DirectoryPickerError };
