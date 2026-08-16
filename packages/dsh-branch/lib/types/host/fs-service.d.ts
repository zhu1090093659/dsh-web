import type { ApplyRequest, ApplyResponse, BranchEnvelope, BranchError, PreviewEntry, WriteTarget } from '../core/types.ts';
export type WorkspaceVerdict = {
    ok: true;
    canonical: string;
} | {
    ok: false;
    error: BranchError;
};
export type WorkspaceGate = (path: string) => Promise<WorkspaceVerdict>;
export declare class BranchFsService {
    private readonly gate;
    constructor(gate: WorkspaceGate);
    preview(request: ApplyRequest): Promise<BranchEnvelope<readonly PreviewEntry[]>>;
    apply(request: ApplyRequest): Promise<BranchEnvelope<ApplyResponse>>;
}
export declare function isWriteTarget(value: unknown): value is WriteTarget;
export declare function isApplyRequest(value: unknown): value is ApplyRequest;
export declare const INTERNAL_FAILURE: BranchEnvelope<never>;
//# sourceMappingURL=fs-service.d.ts.map