/**
 * Pure branch-tree registry: the git-like master/main tree model backing
 * trajectory rollback/restore.
 *
 * - `main` is the implicit main tree: the workspace state at the trajectory
 *   head (all file ops applied). Its stateIndex is always the live op count,
 *   so it is not stored in `trees`.
 * - Rolling back to a node creates a numbered master tree (master1, master2,
 *   ...) holding that node's file state; a later rollback to the same state
 *   reuses the existing tree instead of creating a duplicate.
 * - Restoring returns the workspace to the main tree.
 *
 * The registry itself is pure data; persistence (localStorage per workspace)
 * and file application live in the client/host halves.
 */
export declare const MAIN_TREE = "main";
export interface BranchTreeRef {
    readonly name: string;
    /** Human label captured at branch time (record title or tree kind). */
    readonly label: string;
    readonly kind: 'main' | 'master';
    /** Trajectory record index the tree was branched from; -1 for main. */
    readonly nodeIndex: number;
    /** File-op count applied at the branch point (applySetAt index). */
    readonly stateIndex: number;
    readonly createdAt: number;
}
export interface BranchTreeRegistry {
    /** Stored trees: main is implicit and never listed here. */
    readonly trees: readonly BranchTreeRef[];
    /** Current tree name: MAIN_TREE or a master tree name. */
    readonly current: string;
    /** Next master number to mint (1-based; master1 is the first). */
    readonly masterCounter: number;
}
export declare const EMPTY_TREE_REGISTRY: BranchTreeRegistry;
export declare function treeByName(registry: BranchTreeRegistry, name: string): BranchTreeRef | undefined;
export declare function nextMasterName(registry: BranchTreeRegistry): string;
/**
 * Resolve the master tree for one target state, creating it (masterN) when
 * no stored tree already points at that exact state.
 * @returns the (possibly new) tree and whether it was created.
 */
export declare function branchTreeAt(registry: BranchTreeRegistry, stateIndex: number, nodeIndex: number, label: string, now: number): {
    registry: BranchTreeRegistry;
    tree: BranchTreeRef;
    created: boolean;
};
/** Mark the named tree as current; unknown names leave the registry untouched. */
export declare function withCurrent(registry: BranchTreeRegistry, name: string): BranchTreeRegistry;
export declare function isMainTree(registry: BranchTreeRegistry): boolean;
/** Highest master number already minted (0 when none). */
export declare function masterNumber(registry: BranchTreeRegistry): number;
/** Repair unknown/corrupt persisted payloads into a valid registry. */
export declare function parseTreeRegistry(value: unknown): BranchTreeRegistry;
//# sourceMappingURL=trees.d.ts.map