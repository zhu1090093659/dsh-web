const TRANSPORT_ERROR = { code: 'internal', message: 'branch route unavailable' };
async function post(path, payload) {
    let response;
    try {
        response = await fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
    }
    catch {
        return { ok: false, error: TRANSPORT_ERROR };
    }
    try {
        const envelope = await response.json();
        if (typeof envelope !== 'object' || envelope === null)
            return { ok: false, error: TRANSPORT_ERROR };
        const record = envelope;
        if (record.ok === true)
            return { ok: true, value: record.value };
        return { ok: false, error: record.error ?? TRANSPORT_ERROR };
    }
    catch {
        return { ok: false, error: TRANSPORT_ERROR };
    }
}
export class BranchApi {
    preview(cwd, writes, deletes) {
        return post('/branch/preview', { cwd, writes, deletes });
    }
    apply(cwd, writes, deletes) {
        return post('/branch/apply', { cwd, writes, deletes });
    }
}
