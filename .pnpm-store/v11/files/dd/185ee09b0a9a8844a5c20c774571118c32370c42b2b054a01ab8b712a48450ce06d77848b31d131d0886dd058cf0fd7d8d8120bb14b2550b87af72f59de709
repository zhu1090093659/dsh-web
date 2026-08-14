import { Service } from "@deepseek-ai/cordis";
//#region lib/types/index.js
/**
* Service Definition and drive registry for the session-projection capability seam: the merge-extensible `SessionProjectionMap` type
* table, the `ProjectionDefinition` state-driven computation unit contract,
* and the `ctx.sessionProjections` registry that DRIVES every registered unit
* forward eagerly over committed session events. Domain host plugins
* contribute pure mathematics (init/apply/view); the framework owns the
* subscription, the per-session watermark cache, and change notification;
* carriers consume the snapshot read face and the change feed. Neither side
* knows the other
* (capability-seam three-way split). Design authority: the session-projection
* RFC (.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md).
*
* Whole-value event rule (load-bearing): a state-carrying log event MUST
* carry the complete post-change state, never a bare delta — it keeps every
* unit's transition trivially cheap and every served value self-describing.
*
* @module @deepseek-ai/dsh-session-projection
*/
/**
* `ctx.sessionProjections`: the projection unit table and its drive. The
* service subscribes to `session/event` once; every committed event passes
* every registered unit's `apply` (eager drive), and a changed state
* reference notifies the change feed with the schema-validated view.
* Cells build lazily — a unit registered after events flowed, or a session
* older than the registry, folds `init` over the in-memory log on first
* touch (event or read). Registration is an effect (disposer rides the
* calling fiber): an unloaded domain plugin's key disappears from snapshots
* and clients read it as capability absence. Domain
* plugins register under `ctx.inject(['sessionProjections'], …)` so headless
* assemblies without the registry stay unaffected. Registrants sharing a key
* share one unit and are counted: the same tool package mounted in N agent
* presets registers N times, and the key survives until the last one
* unloads.
*/
var SessionProjectionRegistry = class extends Service {
	registrations = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	/**
	* Create and install the registry as `ctx.sessionProjections`.
	* @param ctx - Cordis context that owns the service.
	*/
	constructor(ctx) {
		super(ctx, "sessionProjections");
		ctx.on("session/event", (session, event) => {
			this.drive(session, event);
		});
	}
	/**
	* Register one domain's unit. The registration is an effect on the calling
	* context's fiber: disposing the fiber (or calling the returned disposer)
	* removes the key — and the unit's cached cells — from subsequent drives
	* and snapshots.
	* @param definition - key, state schema, pure unit functions, and stateVersion.
	* @returns the exact disposer that unregisters this unit.
	*/
	register(definition) {
		if (!Number.isSafeInteger(definition.stateVersion) || definition.stateVersion < 0) throw new Error(`session projection ${JSON.stringify(definition.key)} stateVersion must be a non-negative integer, got ${String(definition.stateVersion)}`);
		const dispose = this.ctx.effect(function* () {
			const key = definition.key;
			const existing = this.registrations.get(key);
			if (existing === void 0) this.registrations.set(key, {
				def: definition,
				cells: /* @__PURE__ */ new WeakMap(),
				refs: 1
			});
			else {
				if (existing.def.stateVersion !== definition.stateVersion) throw new Error(`session projection key ${JSON.stringify(key)} is already registered at stateVersion ${String(existing.def.stateVersion)}; refusing to share it with stateVersion ${String(definition.stateVersion)}`);
				existing.refs += 1;
			}
			yield () => {
				const live = this.registrations.get(key);
				/* v8 ignore next -- the disposer runs once per successful registration, so the entry it counted is still here */
				if (live === void 0) return;
				live.refs -= 1;
				if (live.refs === 0) this.registrations.delete(key);
			};
		}.bind(this), "sessionProjections.register()");
		return () => void dispose();
	}
	/**
	* Subscribe to the change feed. The registration is an effect on the
	* calling context's fiber.
	* @param listener - called once per unit whose state reference changed, per committed event.
	* @returns the exact disposer that unsubscribes.
	*/
	onChanged(listener) {
		const dispose = this.ctx.effect(() => {
			this.listeners.add(listener);
			return () => {
				this.listeners.delete(listener);
			};
		}, "sessionProjections.onChanged()");
		return () => void dispose();
	}
	/**
	* One consistent cut over every registered unit for one session, read from
	* the watermark cache (missing cells fold lazily over the in-memory log).
	* Fully synchronous — every value and `asOfSeq` reflect the same log
	* position. Each value passes its unit's schema before leaving.
	* @param session - the session whose projection values are read.
	* @returns the snapshot; `values` is empty when no unit is registered.
	*/
	snapshot(session) {
		const values = {};
		for (const registration of this.registrations.values()) {
			const cell = this.cellFor(registration, session);
			values[registration.def.key] = registration.def.schema.parse(registration.def.view(cell.state));
		}
		return {
			asOfSeq: session.seq - 1,
			values
		};
	}
	/**
	* State-level checkpoint of every registered unit for one session, read
	* from the watermark cache (missing cells fold lazily over the in-memory
	* log). This is the write side of the persisted projection cache: the
	* returned rows are the `(key → {ver, seq, val})` part of the durable
	* `(sessionId, key, ver, seq, val)`
	* rows. Every `val` is a DETACHED structured clone — never the live
	* cell reference: the watermark cache is this registry's authoritative
	* mutable state, and a caller reaching the live reference could corrupt
	* every subsequent snapshot and frame through it (plain JSON by the unit
	* contract, so the clone is total).
	* @param session - the session whose unit states are checkpointed.
	* @returns one row per registered key; empty when no unit is registered.
	*/
	checkpoint(session) {
		const rows = {};
		for (const registration of this.registrations.values()) {
			const cell = this.cellFor(registration, session);
			rows[registration.def.key] = {
				ver: registration.def.stateVersion,
				seq: cell.observedSeq,
				val: structuredClone(cell.state)
			};
		}
		return rows;
	}
	/**
	* The stored seq a {@link restore} tail read over `checkpoint` must start
	* at: one event BELOW the lowest usable watermark (a row is usable when
	* its `ver` matches the live unit's `stateVersion`; an absent or mismatched row
	* pulls the floor to `0` — that key must refold the full log). The
	* one-below anchor is load-bearing: the tail then proves how far the
	* stored log still extends, so {@link restore} can detect a log that
	* shrank below a row's watermark (crash-repair truncation) instead of
	* serving the stale row as current — an empty tail read from the anchor
	* yields an end below every watermark and the restore rejects for a full
	* re-read.
	* @param checkpoint - persisted rows for one session (possibly stale or empty).
	* @returns the seq to hand the persistence `readFrom`, or `undefined`
	*   when no unit is registered (no read needed — {@link restore} would
	*   serve empty values regardless).
	*/
	restoreFloor(checkpoint) {
		let floor;
		for (const registration of this.registrations.values()) {
			const row = checkpoint[registration.def.key];
			const need = row !== void 0 && row.ver === registration.def.stateVersion ? Math.max(row.seq + 1, 0) : 0;
			floor = floor === void 0 ? need : Math.min(floor, need);
		}
		return floor === void 0 ? void 0 : Math.max(floor - 1, 0);
	}
	/**
	* View a checkpoint's rows without any log read: for every registered
	* unit whose row's `ver` matches, serve the schema-validated
	* `view` of the stored state; mismatched or absent rows leave their key
	* absent (a cold or listing consumer treats it as not-yet-available and a
	* fuller read path refolds it). The zero-I/O rung of the read ladder —
	* values are as stale as their rows, never wrong.
	* @param checkpoint - persisted rows for one session (possibly stale or empty).
	* @returns whole values per key with a usable row; empty when none.
	*/
	viewCheckpoint(checkpoint) {
		const values = {};
		for (const registration of this.registrations.values()) {
			const def = registration.def;
			const row = checkpoint[def.key];
			if (row === void 0 || row.ver !== def.stateVersion) continue;
			values[def.key] = def.schema.parse(def.view(row.val));
		}
		return values;
	}
	/**
	* Cold read: fold every registered unit over a stored log suffix, seeding
	* each from its checkpoint row when usable — the one read recipe (cached
	* state + forward tail replay + `view`) applied without a live `Session`.
	* Call with the events returned by a persistence
	* `readFrom(id, restoreFloor(checkpoint))` and that same floor as
	* `baseSeq`; the floor's one-below anchor makes the supplied end honest,
	* so a shrunk log is detected here. A row is usable iff its
	* `ver` matches the live unit's `stateVersion`, it does not predate `baseSeq`
	* (`seq >= baseSeq - 1`), and it does not claim events past the
	* supplied end (`seq <= endSeq`); an unusable row is discarded
	* and its key refolds from `init` — which is only sound over the full
	* log, so a discarded row with `baseSeq > 0` throws (the caller re-reads
	* from seq 0, e.g. after a crash-repair truncation shrank the log below
	* a row's watermark).
	* @param checkpoint - persisted rows for one session (possibly stale or empty).
	* @param events - the stored events with `seq >= baseSeq`, in seq order.
	* @param baseSeq - the seq `events` starts at (its first event's seq when non-empty).
	* @returns the snapshot cut at the supplied log end (`asOfSeq` is the last
	*   supplied event's seq, `baseSeq - 1` for an empty tail) plus the
	*   refreshed checkpoint rows at that cut, ready for a durable write-back.
	*/
	restore(checkpoint, events, baseSeq) {
		const endSeq = events.at(-1)?.seq ?? baseSeq - 1;
		const values = {};
		const refreshed = {};
		for (const registration of this.registrations.values()) {
			const def = registration.def;
			const row = checkpoint[def.key];
			const usable = row !== void 0 && row.ver === def.stateVersion && row.seq >= baseSeq - 1 && row.seq <= endSeq;
			if (!usable && baseSeq > 0) throw new Error(`session projection ${JSON.stringify(def.key)} cannot restore from seq ${baseSeq}: its checkpoint row is missing, version-mismatched, or beyond the supplied log end; re-read from seq 0`);
			let state = usable ? row.val : def.init();
			const from = usable ? row.seq : baseSeq - 1;
			for (const event of events) if (event.seq > from) state = def.apply(state, event);
			values[def.key] = def.schema.parse(def.view(state));
			refreshed[def.key] = {
				ver: def.stateVersion,
				seq: endSeq,
				val: state
			};
		}
		return {
			snapshot: {
				asOfSeq: endSeq,
				values
			},
			checkpoint: refreshed
		};
	}
	/** Fold one unit from init over `events`, producing a cell watermarked at the last folded event. */
	buildCell(def, events) {
		let state = def.init();
		for (const event of events) state = def.apply(state, event);
		return {
			state,
			observedSeq: events.at(-1)?.seq ?? -1
		};
	}
	/** Read (or lazily build, folding the full in-memory log) one unit's cell. */
	cellFor(registration, session) {
		let cell = registration.cells.get(session);
		if (cell === void 0) {
			cell = this.buildCell(registration.def, session.events);
			registration.cells.set(session, cell);
		}
		return cell;
	}
	/** Eager drive: pass one committed event through every registered unit; notify on changed references. */
	drive(session, event) {
		for (const registration of this.registrations.values()) {
			let cell = registration.cells.get(session);
			if (cell === void 0) {
				cell = this.buildCell(registration.def, session.events.slice(0, event.seq));
				registration.cells.set(session, cell);
			}
			const next = registration.def.apply(cell.state, event);
			const changed = !Object.is(next, cell.state);
			cell.state = next;
			cell.observedSeq = event.seq;
			if (changed && this.listeners.size > 0) {
				const value = registration.def.schema.parse(registration.def.view(next));
				for (const listener of this.listeners) listener(session, registration.def.key, value, event.seq);
			}
		}
	}
};
//#endregion
export { SessionProjectionRegistry, SessionProjectionRegistry as default };
