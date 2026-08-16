/**
 * Pure trajectory state math shared by the browser injector and tests:
 * write/edit calls project into per-position file states that rollback
 * (create a master tree) and restore (return to the main tree) apply.
 *
 * Rollback fidelity rules:
 * - A write whose result text says "Created" has a known baseline (absent),
 *   so rolling back to before it deletes the file.
 * - A write always yields an exact state from its own position onward.
 * - An edit is exact only when the file state before it is exact; otherwise
 *   the path is reported as skipped instead of guessed.
 */
import type { WriteTarget } from './types.ts';
export interface FileOp {
    readonly id: string;
    readonly seq: number;
    readonly time: number;
    readonly turn: number;
    readonly step: number;
    readonly kind: 'write' | 'edit';
    readonly path: string;
    readonly content?: string;
    readonly oldString?: string;
    readonly newString?: string;
    readonly replaceAll?: boolean;
    /** write only: result said Created (true), Updated (false), unknown (undefined). */
    readonly created?: boolean;
}
export interface ApplySet {
    readonly writes: readonly WriteTarget[];
    readonly deletes: readonly string[];
    readonly skipped: readonly string[];
}
export declare function parseArgs(argsRaw: string | undefined): unknown;
/** Derive one file op from a settled tool call (write/edit only). */
export declare function fileOpFromCall(seq: number, time: number, turn: number, step: number, name: string, argsRaw: string | undefined, resultText: string | undefined): FileOp | undefined;
export declare function textOf(blocks: readonly {
    type?: string;
    text?: string;
}[] | undefined): string;
/** File state at a given op count (clamped), for rollback/restore targets. */
export declare function applySetAt(ops: readonly FileOp[], count: number): ApplySet;
//# sourceMappingURL=trajectory.d.ts.map