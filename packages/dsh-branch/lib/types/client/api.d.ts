/**
 * Browser client for the host /branch/* routes (typed JSON envelopes).
 */
import type { ApplyResponse, BranchEnvelope, PreviewEntry, WriteTarget } from '../core/types.ts';
export type ApiResult<T> = BranchEnvelope<T>;
export declare class BranchApi {
    preview(cwd: string, writes: readonly WriteTarget[], deletes: readonly string[]): Promise<ApiResult<readonly PreviewEntry[]>>;
    apply(cwd: string, writes: readonly WriteTarget[], deletes: readonly string[]): Promise<ApiResult<ApplyResponse>>;
}
//# sourceMappingURL=api.d.ts.map