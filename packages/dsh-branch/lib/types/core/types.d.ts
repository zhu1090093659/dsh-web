/** Shared branch-view domain types (browser and host halves). */
export type BranchErrorCode = 'workspace-unknown' | 'path-escape' | 'malformed' | 'internal' | 'write-failed' | 'delete-failed';
export interface BranchError {
    readonly code: BranchErrorCode;
    readonly message: string;
}
export type BranchEnvelope<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: BranchError;
};
export interface WriteTarget {
    readonly path: string;
    readonly content: string;
}
export interface ApplyRequest {
    readonly cwd: string;
    readonly writes: readonly WriteTarget[];
    readonly deletes: readonly string[];
}
export type FileAction = 'write' | 'create' | 'delete' | 'unchanged';
export interface PreviewEntry {
    readonly path: string;
    readonly action: FileAction;
    readonly changed: boolean;
    readonly current: string | null;
    readonly target: string | null;
}
export interface ApplyEntry {
    readonly path: string;
    readonly action: 'write' | 'delete';
    readonly ok: boolean;
    readonly error?: string;
}
export interface ApplyResponse {
    readonly entries: readonly ApplyEntry[];
    readonly written: number;
    readonly deleted: number;
    readonly failed: number;
}
//# sourceMappingURL=types.d.ts.map