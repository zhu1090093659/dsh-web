//#region lib/types/invariant.js
/** Package-owned background-job snapshot invariants. @module @deepseek-ai/dsh-jobs/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-jobs";
const TERMINAL_STATUSES = new Set([
	"completed",
	"killed",
	"failed"
]);
/** Cordis companion plugin name. */
const name = "jobs-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** Validate the cross-field relationships in one registry snapshot. */
function validateSnapshot(snapshot, owner, fail) {
	const id = String(snapshot.id);
	const prefix = `${snapshot.kind}-`;
	const ordinal = Number(id.slice(prefix.length));
	if (snapshot.kind.length === 0 || !id.startsWith(prefix) || !Number.isSafeInteger(ordinal) || ordinal < 1) fail(`job snapshot id ${JSON.stringify(id)} must be ${JSON.stringify(prefix)} followed by a positive ordinal`);
	if (snapshot.label.length === 0) fail(`job ${JSON.stringify(id)} label must be non-empty`);
	if (!Number.isSafeInteger(snapshot.startedAt) || snapshot.startedAt < 0) fail(`job ${JSON.stringify(id)} startedAt must be a non-negative epoch integer`);
	if (TERMINAL_STATUSES.has(snapshot.status) !== (snapshot.finishedAt !== void 0)) fail(`job ${JSON.stringify(id)} finishedAt must be present exactly for a terminal status`);
	if (snapshot.finishedAt !== void 0 && (!Number.isSafeInteger(snapshot.finishedAt) || snapshot.finishedAt < snapshot.startedAt)) fail(`job ${JSON.stringify(id)} finishedAt must be an epoch integer no earlier than startedAt`);
	const expectedOwner = owner?.id;
	if (snapshot.ownerSession !== expectedOwner) fail(`job ${JSON.stringify(id)} ownerSession does not match its completion owner`);
}
/** Install checks over current unowned records and every terminal snapshot. */
const install = Object.assign((ctx, fail) => {
	for (const snapshot of ctx.jobs.list()) validateSnapshot(snapshot, void 0, fail);
	ctx.jobs.onJobDone((snapshot, owner) => {
		validateSnapshot(snapshot, owner, fail);
	});
}, { inject: ["jobs"] });
/**
* Register the job-registry invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
