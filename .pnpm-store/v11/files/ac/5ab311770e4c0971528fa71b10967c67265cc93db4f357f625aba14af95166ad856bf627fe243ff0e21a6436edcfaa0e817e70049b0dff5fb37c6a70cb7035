/**
 * Lossless storage packing for `assistant/chunk` delta runs. Providers stream
 * token-sized deltas, so a log stores hundreds of near-identical event lines
 * whose JSON envelopes dwarf their payloads (~56× measured on a real DeepSeek
 * session). This module packs each run of consecutive same-block delta chunks
 * into ONE storage row — `text-chunks`, `reasoning-chunks`, or
 * `tool-call-chunks` — and expands rows back to the exact original events.
 *
 * Storage rows are a durable-encoding vocabulary, NOT session events: they
 * never enter `Session.events`, have no `SessionEventMap` entry, and use bare
 * (slash-less) type tags so a reader cannot confuse them with the event
 * taxonomy (precedent: the JSONL header line's `session` tag). The encoder
 * whitelists exact shapes — anything it does not fully recognize is stored
 * verbatim, so unknown fields or future chunk variants lose compression, never
 * data. The decoder validates before expanding and fails loud on a malformed
 * row-tagged value instead of silently dropping a whole run.
 *
 * @module @deepseek-ai/dsh-session/chunk-rows
 */
import { CallId, assertNever } from '@deepseek-ai/dsh-llm';
/**
 * Minimum members before a run packs. Below it a row's envelope rivals the
 * event lines it replaces. A format constant, not a tunable: both layouts
 * decode identically, so changing it never invalidates stored logs.
 */
const MIN_RUN = 3;
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
/** Exact-key check: `value` has every key in `keys` and nothing else. */
function hasExactKeys(value, keys) {
    return Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
/**
 * Classify an event for packing: its delta kind when the ENTIRE shape
 * (envelope, data, chunk — exact keys, primitive types, integer seq/time) is
 * whitelisted, else `undefined` (store verbatim). Inputs come from live typed
 * appends AND parsed fixture files, so the checks are structural, not
 * type-trusted. Integer times keep gap encoding exact: a fractional time would
 * reconstruct through float subtraction/addition, which need not round-trip.
 */
function classify(event) {
    if (event.type !== 'assistant/chunk')
        return undefined;
    if (!hasExactKeys(event, ['type', 'seq', 'time', 'data']))
        return undefined;
    if (!Number.isSafeInteger(event.seq) || event.seq < 0 || !Number.isSafeInteger(event.time))
        return undefined;
    const data = event.data;
    if (!isRecord(data) || !hasExactKeys(data, ['turn', 'step', 'chunk']))
        return undefined;
    if (typeof data.turn !== 'number' || typeof data.step !== 'number')
        return undefined;
    const chunk = data.chunk;
    if (!isRecord(chunk) || typeof chunk.index !== 'number')
        return undefined;
    switch (chunk.type) {
        case 'text-delta':
        case 'reasoning-delta':
            return hasExactKeys(chunk, ['type', 'index', 'text']) && typeof chunk.text === 'string'
                ? chunk.type
                : undefined;
        case 'tool-call-delta': {
            const shapeOk = hasExactKeys(chunk, ['type', 'index', 'id', 'argumentsDelta'])
                || (hasExactKeys(chunk, ['type', 'index', 'id', 'name', 'argumentsDelta']) && typeof chunk.name === 'string');
            return shapeOk && typeof chunk.id === 'string' && typeof chunk.argumentsDelta === 'string'
                ? chunk.type
                : undefined;
        }
        // Whitelist fall-through over parsed data: block-start/end, usage, finish,
        // and any future chunk variant stay one event per line.
        default:
            return undefined;
    }
}
/** The tool-call fields of a whitelisted delta chunk (only after {@link classify} returned `'tool-call-delta'`). */
function toolCallOf(event) {
    return event.data.chunk;
}
/** The block index of a whitelisted delta chunk (not every {@link StreamChunk} variant carries one). */
function indexOf(event) {
    return event.data.chunk.index;
}
/** Whether `next` extends a run ending in `prev` (same kind already checked by the caller). */
function continues(prev, next, kind) {
    if (next.seq !== prev.seq + 1)
        return false;
    // Two safe-integer times can sit further apart than a double subtracts
    // exactly (2^53-1 and its negation differ by ~2^54); a rounded gap would
    // decode to a different timestamp. The check is exact in both directions: a
    // true gap within safe range subtracts without rounding and passes, while a
    // true gap beyond it rounds to a value that is itself beyond and fails.
    if (!Number.isSafeInteger(next.time - prev.time))
        return false;
    if (next.data.turn !== prev.data.turn || next.data.step !== prev.data.step)
        return false;
    if (indexOf(next) !== indexOf(prev))
        return false;
    if (kind !== 'tool-call-delta')
        return true;
    const a = toolCallOf(prev);
    const b = toolCallOf(next);
    // `name` must match in presence AND value — a mixed run is not representable.
    return a.id === b.id && Object.hasOwn(a, 'name') === Object.hasOwn(b, 'name') && a.name === b.name;
}
/** Build the row for a completed run (`run.length >= MIN_RUN`, uniform per {@link continues}). */
function buildRow(kind, run) {
    const first = run[0];
    const base = {
        turn: first.data.turn,
        step: first.data.step,
        index: indexOf(first),
        dt: run.slice(1).map((event, i) => event.time - run[i].time),
    };
    const envelope = { seq0: first.seq, time0: first.time };
    if (kind === 'tool-call-delta') {
        const call = toolCallOf(first);
        return {
            type: 'tool-call-chunks',
            ...envelope,
            data: {
                ...base,
                id: CallId(call.id),
                ...Object.hasOwn(call, 'name') ? { name: call.name } : {},
                args: run.map(event => event.data.chunk.argumentsDelta),
            },
        };
    }
    const data = { ...base, texts: run.map(event => event.data.chunk.text) };
    return kind === 'text-delta'
        ? { type: 'text-chunks', ...envelope, data }
        : { type: 'reasoning-chunks', ...envelope, data };
}
/**
 * Pack an event batch for storage: each run of at least {@link MIN_RUN}
 * consecutive whitelisted same-kind, same-block delta chunk events becomes one
 * {@link ChunkRow}; every other event passes through verbatim, in order.
 * Pure and stateless — safe over any array, including a batch whose runs were
 * split by flush boundaries (the split runs simply pack per batch).
 *
 * @param events - the batch to encode, in log order.
 * @returns the storage records to write, one JSONL line each.
 */
export function packChunkRuns(events) {
    const out = [];
    let kind;
    let run = [];
    const flush = () => {
        if (kind !== undefined && run.length >= MIN_RUN)
            out.push(buildRow(kind, run));
        else
            out.push(...run);
        kind = undefined;
        run = [];
    };
    for (const event of events) {
        const k = classify(event);
        if (k === undefined) {
            flush();
            out.push(event);
            continue;
        }
        const delta = event;
        const last = run[run.length - 1];
        if (k === kind && last !== undefined && continues(last, delta, k)) {
            run.push(delta);
            continue;
        }
        flush();
        kind = k;
        run = [delta];
    }
    flush();
    return out;
}
/** Throw the uniform malformed-row diagnostic. */
function malformed(tag, why) {
    throw new Error(`malformed ${tag} storage row: ${why}`);
}
/** Validate the shared run-data fields and the payload/dt arity; returns the member payload. */
function validateRunData(tag, data, payloadKey) {
    if (typeof data.turn !== 'number' || typeof data.step !== 'number' || typeof data.index !== 'number') {
        malformed(tag, 'turn/step/index must be numbers');
    }
    const payload = data[payloadKey];
    if (!Array.isArray(payload) || payload.length === 0 || payload.some(entry => typeof entry !== 'string')) {
        malformed(tag, `${payloadKey} must be a non-empty string array`);
    }
    const dt = data.dt;
    if (!Array.isArray(dt) || dt.some(gap => !Number.isSafeInteger(gap))) {
        malformed(tag, 'dt must be an array of safe integers');
    }
    if (dt.length !== payload.length - 1) {
        malformed(tag, `dt length ${dt.length} does not match ${payload.length} members`);
    }
    return payload;
}
/** Validate a row-tagged parsed value's envelope and data, throwing on any malformation. */
function validateRow(value, tag) {
    if (!hasExactKeys(value, ['type', 'seq0', 'time0', 'data'])) {
        malformed(tag, 'envelope must be exactly {type, seq0, time0, data}');
    }
    if (!Number.isSafeInteger(value.seq0) || value.seq0 < 0) {
        malformed(tag, 'seq0 must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(value.time0)) {
        malformed(tag, 'time0 must be a safe integer');
    }
    const data = value.data;
    if (!isRecord(data))
        malformed(tag, 'data must be an object');
    let payload;
    if (tag === 'tool-call-chunks') {
        const withName = hasExactKeys(data, ['turn', 'step', 'index', 'id', 'name', 'dt', 'args']);
        if (!withName && !hasExactKeys(data, ['turn', 'step', 'index', 'id', 'dt', 'args'])) {
            malformed(tag, 'data must be exactly {turn, step, index, id, name?, dt, args}');
        }
        if (typeof data.id !== 'string' || (withName && typeof data.name !== 'string')) {
            malformed(tag, 'id (and name when present) must be strings');
        }
        payload = validateRunData(tag, data, 'args');
    }
    else {
        if (!hasExactKeys(data, ['turn', 'step', 'index', 'dt', 'texts'])) {
            malformed(tag, 'data must be exactly {turn, step, index, dt, texts}');
        }
        payload = validateRunData(tag, data, 'texts');
    }
    // Reconstruction bounds. The encoder only packs runs whose member seqs and
    // times are all safe integers, so a running value that leaves safe range is
    // outside any encoder's image: float arithmetic would round it to a
    // different number than exact arithmetic, a silent corruption. Within safe
    // range every step is exact, so the first departure is always caught.
    if (!Number.isSafeInteger(value.seq0 + payload.length - 1)) {
        malformed(tag, 'member seqs must stay safe integers');
    }
    let time = value.time0;
    for (const gap of data.dt) {
        time += gap;
        if (!Number.isSafeInteger(time))
            malformed(tag, 'member times must stay safe integers');
    }
    return value;
}
/** Expand a validated row back into its exact original events, in order. */
function expandRow(row) {
    const members = row.type === 'tool-call-chunks' ? row.data.args : row.data.texts;
    const events = [];
    let time = row.time0;
    for (let k = 0; k < members.length; k++) {
        if (k > 0)
            time += row.data.dt[k - 1];
        let chunk;
        switch (row.type) {
            case 'text-chunks':
                chunk = { type: 'text-delta', index: row.data.index, text: members[k] };
                break;
            case 'reasoning-chunks':
                chunk = { type: 'reasoning-delta', index: row.data.index, text: members[k] };
                break;
            case 'tool-call-chunks':
                chunk = {
                    type: 'tool-call-delta',
                    index: row.data.index,
                    id: row.data.id,
                    ...Object.hasOwn(row.data, 'name') ? { name: row.data.name } : {},
                    argumentsDelta: members[k],
                };
                break;
            /* v8 ignore next 2 -- validateRow only returns the three row tags */
            default:
                return assertNever(row, 'chunk-rows expandRow');
        }
        events.push({
            type: 'assistant/chunk',
            seq: row.seq0 + k,
            time,
            data: { turn: row.data.turn, step: row.data.step, chunk },
        });
    }
    return events;
}
/**
 * Decode one parsed JSONL line value into the session event(s) it stores.
 * Chunk-row-tagged values validate and expand (a malformed row throws — it is
 * corrupt storage, and treating it as an event would silently drop a whole
 * run); every other value passes through as a single event, unvalidated.
 *
 * @param value - one line's `JSON.parse` result.
 * @returns the stored events, in log order.
 */
export function decodeStorageRecord(value) {
    if (!isRecord(value))
        return [value];
    const tag = value.type;
    if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks') {
        return [value];
    }
    return expandRow(validateRow(value, tag));
}
//# sourceMappingURL=chunk-rows.js.map