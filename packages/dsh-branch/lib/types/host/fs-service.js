/**
 * Host branch file service: workspace-gated preview/apply of node file states.
 * Every target path is resolved against the workspace root and containment is
 * enforced before any disk access (an escaping path rejects the whole request).
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
const INTERNAL = { code: 'internal', message: 'branch file service failure' };
function resolveInside(cwd, relative) {
    if (relative === '')
        return { code: 'malformed', message: 'empty path' };
    const root = resolve(cwd);
    const target = isAbsolute(relative) ? resolve(relative) : resolve(root, relative);
    if (target !== root && !target.startsWith(root + sep)) {
        return { code: 'path-escape', message: `path escapes the workspace: ${relative}` };
    }
    return target;
}
async function readTextOrNull(path) {
    try {
        return await readFile(path, 'utf8');
    }
    catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
async function isRegularFile(path) {
    try {
        const info = await stat(path);
        return info.isFile();
    }
    catch {
        return false;
    }
}
function resolveTargets(root, request) {
    const targets = {};
    for (const write of request.writes) {
        const target = resolveInside(root, write.path);
        if (typeof target !== 'string')
            return { ok: false, error: target };
        targets[write.path] = target;
    }
    for (const path of request.deletes) {
        const target = resolveInside(root, path);
        if (typeof target !== 'string')
            return { ok: false, error: target };
        targets[path] = target;
    }
    return { ok: true, targets };
}
export class BranchFsService {
    gate;
    constructor(gate) {
        this.gate = gate;
    }
    async preview(request) {
        const verdict = await this.gate(request.cwd);
        if (!verdict.ok)
            return { ok: false, error: verdict.error };
        const resolved = resolveTargets(verdict.canonical, request);
        if (!resolved.ok)
            return { ok: false, error: resolved.error };
        const entries = [];
        for (const write of request.writes) {
            const current = await readTextOrNull(resolved.targets[write.path]);
            entries.push({
                path: write.path,
                action: current === null ? 'create' : 'write',
                changed: current !== write.content,
                current,
                target: write.content,
            });
        }
        for (const path of request.deletes) {
            const current = await readTextOrNull(resolved.targets[path]);
            entries.push({ path, action: 'delete', changed: current !== null, current, target: null });
        }
        return { ok: true, value: entries };
    }
    async apply(request) {
        const verdict = await this.gate(request.cwd);
        if (!verdict.ok)
            return { ok: false, error: verdict.error };
        const resolved = resolveTargets(verdict.canonical, request);
        if (!resolved.ok)
            return { ok: false, error: resolved.error };
        const entries = [];
        let written = 0;
        let deleted = 0;
        let failed = 0;
        for (const write of request.writes) {
            const target = resolved.targets[write.path];
            try {
                await mkdir(resolve(target, '..'), { recursive: true });
                await writeFile(target, write.content, 'utf8');
                entries.push({ path: write.path, action: 'write', ok: true });
                written++;
            }
            catch (error) {
                entries.push({ path: write.path, action: 'write', ok: false, error: String(error) });
                failed++;
            }
        }
        for (const path of request.deletes) {
            const target = resolved.targets[path];
            try {
                if (await isRegularFile(target)) {
                    await rm(target, { force: true });
                    deleted++;
                    entries.push({ path, action: 'delete', ok: true });
                }
                else {
                    entries.push({ path, action: 'delete', ok: true });
                }
            }
            catch (error) {
                entries.push({ path, action: 'delete', ok: false, error: String(error) });
                failed++;
            }
        }
        return { ok: true, value: { entries, written, deleted, failed } };
    }
}
export function isWriteTarget(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    return typeof record.path === 'string' && record.path !== '' && typeof record.content === 'string';
}
export function isApplyRequest(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    if (typeof record.cwd !== 'string' || record.cwd === '')
        return false;
    if (!Array.isArray(record.writes) || !record.writes.every(isWriteTarget))
        return false;
    if (!Array.isArray(record.deletes) || !record.deletes.every(item => typeof item === 'string' && item !== ''))
        return false;
    return true;
}
export const INTERNAL_FAILURE = { ok: false, error: INTERNAL };
