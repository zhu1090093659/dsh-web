export function parseArgs(argsRaw) {
    if (argsRaw === undefined || argsRaw === '')
        return undefined;
    try {
        return JSON.parse(argsRaw);
    }
    catch {
        return undefined;
    }
}
function createdFromResult(resultText) {
    if (resultText === undefined || resultText === '')
        return undefined;
    if (/created/i.test(resultText))
        return true;
    if (/updated/i.test(resultText))
        return false;
    return undefined;
}
/** Derive one file op from a settled tool call (write/edit only). */
export function fileOpFromCall(seq, time, turn, step, name, argsRaw, resultText) {
    if (name !== 'write' && name !== 'edit')
        return undefined;
    const args = parseArgs(argsRaw);
    if (typeof args !== 'object' || args === null)
        return undefined;
    const record = args;
    const path = typeof record.file_path === 'string' ? record.file_path : '';
    if (path === '')
        return undefined;
    const id = `${seq}:${step}:${name}:${path}`;
    if (name === 'write') {
        const content = typeof record.content === 'string' ? record.content : '';
        return {
            id, seq, time, turn, step,
            kind: 'write', path, content, created: createdFromResult(resultText),
        };
    }
    const oldString = typeof record.old_string === 'string' ? record.old_string : '';
    const newString = typeof record.new_string === 'string' ? record.new_string : '';
    if (oldString === '')
        return undefined;
    return {
        id, seq, time, turn, step,
        kind: 'edit', path, oldString, newString,
        replaceAll: record.replace_all === true,
    };
}
export function textOf(blocks) {
    if (blocks === undefined)
        return '';
    return blocks
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n');
}
/** File state at a given op count (clamped), for rollback/restore targets. */
export function applySetAt(ops, count) {
    const clamped = Math.max(0, Math.min(count, ops.length));
    const state = new Map();
    const createdBy = new Map();
    ops.forEach((op, index) => {
        if (op.kind === 'write' && op.created === true && !createdBy.has(op.path)) {
            createdBy.set(op.path, index);
        }
    });
    for (let index = 0; index < clamped; index++) {
        const op = ops[index];
        if (op === undefined)
            continue;
        if (op.kind === 'write') {
            state.set(op.path, { content: op.content ?? '', exact: true });
            continue;
        }
        const entry = state.get(op.path);
        if (entry !== undefined
            && entry.exact
            && entry.content !== undefined
            && op.oldString !== undefined
            && op.newString !== undefined) {
            const next = op.replaceAll === true
                ? entry.content.replaceAll(op.oldString, op.newString)
                : entry.content.replace(op.oldString, op.newString);
            state.set(op.path, next === entry.content ? { content: undefined, exact: false } : { content: next, exact: true });
        }
        else {
            state.set(op.path, { content: undefined, exact: false });
        }
    }
    const writes = [];
    const skipped = new Set();
    for (const [path, entry] of state) {
        if (entry.exact && entry.content !== undefined)
            writes.push({ path, content: entry.content });
        else
            skipped.add(path);
    }
    const deletes = [];
    for (const [path, createdIndex] of createdBy) {
        if (createdIndex >= clamped)
            deletes.push(path);
    }
    return { writes, deletes, skipped: [...skipped] };
}
