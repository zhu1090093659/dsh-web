import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { snapshotJsonValue } from "@deepseek-ai/dsh-session";
import { z as z$1 } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
//#region lib/types/spec.js
/**
* The session-projcache domain declaration: one `sessions` table keyed by
* {@link SessionId}, each record the full projection checkpoint for one
* session (`key → {ver, seq, val}` rows). The spec object
* is the single source of the domain's identity, version, and record schema;
* the storage-domain routing decides the medium (the shipped composition's
* json backend lands it at `<root>/session_projcache.json`, beside
* `workspace.json`).
* @module @deepseek-ai/dsh-session-projection-cache/src/spec
*/
/**
* One persisted checkpoint row (the RFC's `(sessionId, key, ver, seq, val)`
* minus the two record keys). `val` is the unit's internal state — plain
* JSON by the unit contract; `z.json()` enforces that at the durable
* boundary. A row is never wrong, only possibly stale: `seq` says exactly
* how stale, and a `ver` mismatch against the live unit's `stateVersion`
* discards it at read time (never a migration).
*/
const checkpointRow = z$1.object({
	ver: z$1.number().int().nonnegative(),
	seq: z$1.number().int().gte(-1),
	val: z$1.json()
});
/**
* The stored-log identity a record is bound to: the immutable header fields
* that distinguish one session lifecycle from another under the same id. A
* session id names a slot, not a lifecycle — a deleted-then-recreated id, or
* a persistence root swapped under a surviving cache, would otherwise let an
* old row pass every watermark check and seed state folded from an unrelated
* log. Reads validate this against the live header (listing) or the stored
* header (cold read) before accepting any row.
*/
const checkpointIdentity = z$1.object({
	createdAt: z$1.number().int().nonnegative(),
	cwd: z$1.string().optional()
});
/**
* One session's stored record: the log identity it was folded from plus its
* checkpoint rows keyed by projection key. The whole record is replaced on
* every write (whole-value discipline — the registry checkpoint is always
* the complete per-session cut).
*/
const checkpointRecord = z$1.object({
	identity: checkpointIdentity,
	rows: z$1.record(z$1.string(), checkpointRow)
});
/**
* The session-projcache domain spec. Version bumps discard the whole medium
* (cache semantics: a stale or unreadable cache costs a longer tail replay,
* never a wrong value).
*/
const projectionCacheDomainSpec = defineDomain({
	name: "session_projcache",
	version: 3,
	tables: { sessions: domainTable(checkpointRecord) }
});
//#endregion
//#region lib/types/index.js
/**
* Persisted projection cache (`ctx.sessionProjectionCache`): durable
* checkpoints of every registered projection unit's state, one record per
* session on the domain data form (`session_projcache` domain — the shipped
* json backend lands it beside `workspace.json`). The cache is a fold
* shortcut, never an authority: a row is possibly stale (its `seq`
* says how stale) but never wrong, so every write path is fail-soft (a lost
* write costs a longer tail replay on the next cold read) and a
* `ver` mismatch discards the row instead of migrating it. Design
* authority: the session-projection RFC
* (.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md).
* @module @deepseek-ai/dsh-session-projection-cache
*/
const Config = z.object({
	writeEveryEvents: z.natural().min(1).required(),
	writeIntervalMs: z.natural().min(1).required()
});
/**
* The persisted projection cache service. Opens the `session_projcache`
* domain at init, checkpoints live sessions on a throttled write-behind
* (count/interval triggers from {@link Config}) plus two mandatory points —
* `turn/end` and session disposal (the live-to-cold moment) — and serves the
* cold-read ladder: cached row, persistence `readFrom` tail, registry
* `restore`, durable write-back. Every durable write is fail-soft: failures
* log a warning and the cache self-heals on the next write or cold read.
*/
var SessionProjectionCache = class extends Service {
	config;
	static inject = [
		"storageDomain",
		"sessionProjections",
		"sessionPersistence",
		"sessions"
	];
	static Config = Config;
	table;
	dirty = /* @__PURE__ */ new Map();
	constructor(ctx, config) {
		super(ctx, "sessionProjectionCache");
		this.config = config;
	}
	/** Open the domain and install the write-behind listeners. */
	async [Service.init]() {
		const domain = await this.ctx.storageDomain.open(projectionCacheDomainSpec);
		this.ctx.effect(() => () => domain.close(), "sessionProjectionCache.domainClose");
		this.table = domain.table("sessions");
		this.installWritePath();
	}
	/**
	* The stored record for one session, accepted only when its bound log
	* identity matches `expected`. A session id names a slot, not a lifecycle:
	* a recreated id or a persistence store swapped under a surviving cache
	* must not let an old record seed state folded from an unrelated log.
	* Synchronous from the domain's in-memory state.
	* @param id - the session whose record is read.
	* @param expected - the log identity the caller holds (live or stored header).
	* @returns the identity-matching record, or `undefined` (absent or unrelated).
	*/
	recordFor(id, expected) {
		const record = this.requireTable().get(id);
		if (record === void 0) return void 0;
		return identityMatches(record.identity, expected) ? record : void 0;
	}
	/**
	* The zero-I/O listing read: whole values viewed straight from the stored
	* rows (version-matching keys only), each cut carried with its watermark
	* so a client value store can seed under its higher-seq-wins rule — as
	* stale as the last durable checkpoint but never wrong, and never from an
	* unrelated log (the caller's header is the identity witness). Fresher
	* paths (the history tail baseline, {@link coldSnapshot}) supersede these
	* values whenever a session is actually opened.
	* @param meta - the listed session's header (identity witness; no log read).
	* @returns the cut (`asOfSeq` = lowest served-row watermark), or
	*   `undefined` when no usable row exists for this lifecycle.
	*/
	cachedSnapshot(meta) {
		const record = this.recordFor(meta.id, identityOf(meta));
		if (record === void 0) return void 0;
		const values = this.ctx.sessionProjections.viewCheckpoint(record.rows);
		const keys = Object.keys(values);
		if (keys.length === 0) return void 0;
		return {
			asOfSeq: Math.min(...keys.map((key) => record.rows[key].seq)),
			values
		};
	}
	/**
	* Durably checkpoint one live session NOW (both mandatory points call
	* this; tests and carriers may too). The registry cut is snapshotted at
	* this boundary (states are live references), then the whole record is
	* replaced. NOT fail-soft — callers on the fail-soft paths contain it.
	* @param session - the live session to checkpoint.
	* @returns resolution after durability and event emission.
	*/
	async write(session) {
		const rows = this.ctx.sessionProjections.checkpoint(session);
		this.markClean(session);
		if (this.ctx.sessions.get(session.id) === session) await this.ctx.sessions.flush(session);
		await this.put(session.id, identityOf(session.header), rows);
	}
	/**
	* Cold-read one persisted session's projections with zero full-log load:
	* cached rows + a persistence `readFrom` tail from the registry's restore
	* floor, refolded by the registry and written back (fail-soft) so the next
	* cold read starts closer. A cache row invalidated by a shrunk log
	* (crash-repair truncation) triggers one full re-read from seq 0 — the
	* ladder's slow rung, still no crash. Rejects when the session has no
	* persisted log (`not found` from the persistence seam).
	* @param id - the persisted session to read.
	* @param signal - optional cancellation for the persistence reads.
	* @returns the snapshot cut at the stored log end.
	*/
	async coldSnapshot(id, signal) {
		const record = this.requireTable().get(id);
		const cached = record?.rows ?? {};
		const floor = this.ctx.sessionProjections.restoreFloor(cached);
		const persistence = this.ctx.sessionPersistence;
		if (floor === void 0) return {
			asOfSeq: (await persistence.readFrom(id, 0, signal)).events.at(-1)?.seq ?? -1,
			values: {}
		};
		let restored;
		const tail = await persistence.readFrom(id, floor, signal);
		const related = record === void 0 || identityMatches(record.identity, identityOf(tail.meta));
		try {
			if (!related) throw new Error("unrelated log identity");
			restored = this.ctx.sessionProjections.restore(cached, tail.events, floor);
		} catch {
			const whole = await persistence.readFrom(id, 0, signal);
			restored = this.ctx.sessionProjections.restore({}, whole.events, 0);
		}
		await this.putSoft(id, identityOf(tail.meta), restored.checkpoint, "cold-read write-back");
		return restored.snapshot;
	}
	installWritePath() {
		this.ctx.on("session/event", (session, event) => {
			if (event.type === "turn/end") {
				this.flushSoft(session, "turn/end");
				return;
			}
			const state = this.dirty.get(session) ?? {
				pending: 0,
				timer: void 0
			};
			this.dirty.set(session, state);
			state.pending += 1;
			if (state.pending >= this.config.writeEveryEvents) {
				this.flushSoft(session, "count threshold");
				return;
			}
			state.timer ??= setTimeout(() => {
				this.flushSoft(session, "interval");
			}, this.config.writeIntervalMs);
		});
		this.ctx.on("session/disposed", (session) => {
			this.flushSoft(session, "detach");
			this.markClean(session);
			this.dirty.delete(session);
		});
		this.ctx.effect(() => () => {
			for (const state of this.dirty.values()) if (state.timer !== void 0) clearTimeout(state.timer);
			this.dirty.clear();
		}, "sessionProjectionCache.timers");
	}
	/**
	* One fail-soft durable checkpoint. Every caller has work by construction:
	* the throttle triggers only fire dirty (markClean clears the timer with
	* the counter) and the two mandatory points write unconditionally.
	*/
	async flushSoft(session, trigger) {
		try {
			await this.write(session);
		} catch (error) {
			this.ctx.logger.warn(`session projection cache: ${trigger} write for "${session.id}" failed (cache stays stale): ${String(error)}`);
		}
	}
	/** Reset one session's dirty bookkeeping (its checkpoint is being written). */
	markClean(session) {
		const state = this.dirty.get(session);
		if (state === void 0) return;
		state.pending = 0;
		if (state.timer !== void 0) {
			clearTimeout(state.timer);
			state.timer = void 0;
		}
	}
	/** Replace one session's stored record with its log identity and a detached snapshot of `rows`. */
	async put(id, identity, rows) {
		const detached = snapshotJsonValue(rows);
		if (detached === void 0) throw new TypeError("projection checkpoint is not losslessly JSON-serializable (a unit state violates the plain-JSON contract)");
		await this.requireTable().put(id, {
			identity,
			rows: detached
		});
	}
	/** Fail-soft {@link put}: cache writes must never fail their caller's read or event path. */
	async putSoft(id, identity, rows, what) {
		try {
			await this.put(id, identity, rows);
		} catch (error) {
			this.ctx.logger.warn(`session projection cache: ${what} for "${id}" failed (cache stays stale): ${String(error)}`);
		}
	}
	requireTable() {
		/* v8 ignore next -- Service.init assigns the table before the service becomes injectable */
		if (this.table === void 0) throw new Error("session projection cache is not initialized");
		return this.table;
	}
};
/** Project a header onto the identity fields a record is bound to. */
function identityOf(header) {
	return {
		createdAt: header.createdAt,
		...header.cwd === void 0 ? {} : { cwd: header.cwd }
	};
}
/** Whether a stored record's bound identity names the caller's lifecycle. */
function identityMatches(stored, expected) {
	return stored.createdAt === expected.createdAt && stored.cwd === expected.cwd;
}
//#endregion
export { Config, SessionProjectionCache, SessionProjectionCache as default, checkpointIdentity, checkpointRecord, checkpointRow, projectionCacheDomainSpec };
