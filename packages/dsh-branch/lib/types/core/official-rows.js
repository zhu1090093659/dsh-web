import { fileOpFromCall, textOf } from "./trajectory.js";
function requestOf(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const record = value;
    if (typeof record.purpose !== 'string' || typeof record.startSeq !== 'number')
        return undefined;
    const changeRaw = record.promptChange;
    let promptChange;
    if (typeof changeRaw === 'object' && changeRaw !== null) {
        const change = changeRaw;
        if (typeof change.seq === 'number' && typeof change.kind === 'string') {
            promptChange = { seq: change.seq, kind: change.kind };
        }
    }
    return {
        purpose: record.purpose,
        startSeq: record.startSeq,
        turn: typeof record.turn === 'number' ? record.turn : null,
        step: typeof record.step === 'number' ? record.step : 0,
        ...(promptChange === undefined ? {} : { promptChange }),
        prompt: record.prompt,
    };
}
function asBlock(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const record = value;
    if (typeof record.callId !== 'string' || record.callId === '')
        return undefined;
    const call = typeof record.call === 'object' && record.call !== null
        ? record.call
        : undefined;
    const callName = typeof call?.name === 'string' && call.name !== '' ? call.name : undefined;
    const callArgs = typeof call?.argsRaw === 'string' ? call.argsRaw : undefined;
    return {
        kind: typeof record.kind === 'string' ? record.kind : undefined,
        callId: record.callId,
        name: typeof record.name === 'string' && record.name !== '' ? record.name : (callName ?? record.callId),
        argsRaw: callArgs ?? (typeof record.argsRaw === 'string' ? record.argsRaw : undefined),
        subCalls: Array.isArray(record.subCalls) ? record.subCalls : undefined,
        content: Array.isArray(record.content) ? record.content : undefined,
        call: call === undefined
            ? null
            : { name: callName ?? null, argsRaw: callArgs },
    };
}
/**
 * Enumerate the official trajectory rows and attach per-row file state.
 * @returns rows sorted by cellIndex (the official display order).
 */
export function projectOfficialRows(input) {
    const { nodes, requests = [], partial = null, runningCalls = [] } = input;
    const resultByCall = new Map();
    const emittedFromBlocks = new Set();
    for (const node of nodes) {
        if (node.kind === 'tool-result') {
            const block = asBlock(node);
            if (block !== undefined)
                resultByCall.set(node.callId, block);
        }
        else if (node.kind === 'assistant') {
            for (const block of node.blocks) {
                if (block.kind === 'tool-call')
                    emittedFromBlocks.add(block.callId);
            }
        }
    }
    const callById = new Map(resultByCall);
    for (const call of runningCalls) {
        const block = asBlock(call);
        if (block !== undefined)
            callById.set(call.callId, block);
    }
    const represented = new Set();
    for (const node of nodes) {
        if (node.kind === 'assistant' && node.step > 0)
            represented.add(`${node.turn}\u0000${node.step}`);
    }
    if (partial !== null && partial.step > 0)
        represented.add(`${partial.turn}\u0000${partial.step}`);
    for (const call of runningCalls) {
        if (call.step > 0)
            represented.add(`${call.turn}\u0000${call.step}`);
    }
    const entries = [];
    for (const node of nodes)
        entries.push({ kind: 'node', seq: node.seq, initial: false, node });
    for (const raw of requests) {
        const request = requestOf(raw);
        if (request === undefined)
            continue;
        if (request.purpose === 'compaction') {
            entries.push({ kind: 'compaction', seq: request.startSeq, initial: false });
        }
        else if (request.purpose === 'assistant') {
            if (request.promptChange !== undefined && request.prompt !== undefined) {
                entries.push({
                    kind: 'system',
                    seq: request.promptChange.seq,
                    initial: request.promptChange.kind === 'initial',
                });
            }
            if (!represented.has(`${request.turn}\u0000${request.step}`)) {
                entries.push({ kind: 'request', seq: request.startSeq, initial: false });
            }
        }
    }
    entries.sort((left, right) => (left.initial ? Number.NEGATIVE_INFINITY : left.seq)
        - (right.initial ? Number.NEGATIVE_INFINITY : right.seq));
    const rows = [];
    let index = 0;
    let opCount = 0;
    const emittedRows = new Set();
    const push = (kind, callId, op, label) => {
        index += 1;
        if (op !== undefined)
            opCount += 1;
        if (callId !== undefined)
            emittedRows.add(callId);
        rows.push({
            cellIndex: index,
            kind,
            op,
            stateIndex: opCount,
            ...(callId === undefined ? {} : { callId }),
            label,
        });
    };
    const emitSubCalls = (subs) => {
        if (subs === undefined)
            return;
        for (const raw of subs) {
            const block = asBlock(raw);
            if (block === undefined)
                continue;
            const settled = block.kind === 'tool-result';
            if (settled) {
                const op = fileOpFromCall(0, 0, 0, 0, block.name, block.argsRaw, textOf(block.content));
                push('subtool', block.callId, op, block.name);
            }
            else {
                push('subtool', block.callId, undefined, block.name);
            }
            emitSubCalls(block.subCalls);
        }
    };
    const emitToolRow = (callId, name, argsRaw, result, subCalls) => {
        const op = result === undefined
            ? undefined
            : fileOpFromCall(0, 0, 0, 0, name, argsRaw, textOf(result.content));
        push('tool', callId, op, name);
        emitSubCalls(subCalls);
    };
    const emitAssistantBlocks = (blocks) => {
        push('message', undefined, undefined, 'assistant');
        for (const raw of blocks) {
            if (typeof raw !== 'object' || raw === null)
                continue;
            const record = raw;
            if (record.kind !== 'tool-call')
                continue;
            const callId = typeof record.callId === 'string' ? record.callId : '';
            const name = typeof record.name === 'string' ? record.name : callId;
            if (callId === '')
                continue;
            const argsRaw = typeof record.argsRaw === 'string' ? record.argsRaw : undefined;
            const call = callById.get(callId);
            emitToolRow(callId, name, argsRaw, resultByCall.get(callId), call?.subCalls);
        }
    };
    for (const entry of entries) {
        if (entry.kind === 'request') {
            push('request', undefined, undefined, 'request');
            continue;
        }
        if (entry.kind === 'system') {
            push('system', undefined, undefined, 'system');
            continue;
        }
        if (entry.kind === 'compaction') {
            push('compacted', undefined, undefined, 'compacted');
            continue;
        }
        const node = entry.node;
        if (node === undefined)
            continue;
        switch (node.kind) {
            case 'user':
            case 'steering':
                push('user', undefined, undefined, node.kind);
                break;
            case 'context':
                push('context', undefined, undefined, 'context');
                break;
            case 'assistant':
                emitAssistantBlocks(node.blocks);
                break;
            case 'tool-result': {
                if (emittedFromBlocks.has(node.callId))
                    break;
                const block = asBlock(node);
                if (block === undefined)
                    break;
                emitToolRow(node.callId, block.name, block.argsRaw, block, block.subCalls);
                break;
            }
            default:
                // compaction nodes, command/error/max-tokens/model-retry/unknown:
                // the official layout emits no row for these.
                break;
        }
    }
    if (partial !== null)
        emitAssistantBlocks(partial.blocks);
    for (const call of runningCalls) {
        if (emittedRows.has(call.callId))
            continue;
        const block = asBlock(call);
        emitToolRow(call.callId, call.name, call.argsRaw, undefined, block?.subCalls);
    }
    return rows;
}
