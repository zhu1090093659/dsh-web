/**
 * Browser persistence for the branch-tree registry, keyed per workspace path
 * (localStorage, same pattern as dsh-task-board). Content is never stored —
 * tree file states are re-derived from the trajectory ops at apply time.
 */
import { MAIN_TREE, type BranchTreeRegistry } from '../core/trees.ts';
export declare function treeStoreKey(cwd: string): string;
export declare function loadTreeRegistry(cwd: string): BranchTreeRegistry;
export declare function saveTreeRegistry(cwd: string, registry: BranchTreeRegistry): void;
export { MAIN_TREE };
//# sourceMappingURL=tree-store.d.ts.map