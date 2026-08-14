import { Service } from "@deepseek-ai/cordis";
//#region lib/types/brand.js
/**
* dsh-jobs' owned branded id, carried across the registry, the model-facing
* control surface, and the client wire.
*
* It lives in its own leaf because the package root and `./types` both reach
* `dsh-agent` through the owner and listener signatures, which a Client program
* cannot resolve even as a type. A browser-safe consumer imports the id here;
* `Branded<B>` itself comes from the zero-dependency `@deepseek-ai/dsh-brand`.
*
* @module @deepseek-ai/dsh-jobs/brand
*/
/**
* Brand a string as a {@link JobId}.
* @param id - the raw job-id string (the registry generates `<kind>-N`).
* @returns the same string, branded; no validation is performed.
*/
function JobId(id) {
	return id;
}
//#endregion
//#region lib/types/index.js
/**
* The background-job Service Definition (`ctx.jobs`). It owns the contract for
* job ids, session-scoped access, lifecycle state, completion listeners, and
* owner cleanup while producers retain their execution resources. The
* process-local registry lives in `@deepseek-ai/dsh-jobs-local`.
* @module @deepseek-ai/dsh-jobs
*/
/**
* Abstract background job registry. Subclass, implement the abstract methods,
* and load the subclass as a plugin — it registers as `ctx.jobs` (one
* implementation per context; loading a second throws, which is cordis'
* standard duplicate-service behavior).
*
* Implementations must honor these semantics:
* - Registrations outlive producer and controller fibers. Owner and
*   service disposal cancel live work and await compliant producers; a
*   throwing teardown cancel force-fails only the record. Teardown
*   cancellation also marks the record reported, because a record its owner
*   is being destroyed for has no reader left.
* - Owned-job access is fenced by the owner's session id. Ids are
*   predictable, so authorization — not secrecy — is the boundary.
* - Settlement is first-wins: one terminal record, released waiters, and one
*   round of contained listener notification, even against a late producer
*   outcome. Completion is announced last, after the record is committed and
*   every other observer of the settlement has seen it, because a reporter
*   may open a model turn synchronously.
* - {@link start} refuses work while no attached job controller serves the
*   spec's owner, so a producer cannot start work that owner cannot collect
*   or stop. One registry serves every composition in the process, so this
*   question — and completion-listener delivery — is owner-relative rather
*   than process-wide: registrations made from an unscoped context serve
*   every owner, and registrations made under an agent composition's scope
*   serve exactly the agents composed under it.
*/
var JobRegistry = class JobRegistry extends Service {
	constructor(ctx) {
		if (new.target === JobRegistry) throw new Error("@deepseek-ai/dsh-jobs is the abstract job registry seam; load an implementation such as @deepseek-ai/dsh-jobs-local instead");
		super(ctx, "jobs");
	}
};
//#endregion
export { JobId, JobRegistry, JobRegistry as default };
