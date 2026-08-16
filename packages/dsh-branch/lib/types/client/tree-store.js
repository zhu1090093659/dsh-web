/**
 * Browser persistence for the branch-tree registry, keyed per workspace path
 * (localStorage, same pattern as dsh-task-board). Content is never stored —
 * tree file states are re-derived from the trajectory ops at apply time.
 */
import { EMPTY_TREE_REGISTRY, MAIN_TREE, parseTreeRegistry, } from "../core/trees.js";
const PREFIX = 'dsh-branch.trees.';
export function treeStoreKey(cwd) {
    return PREFIX + encodeURIComponent(cwd);
}
export function loadTreeRegistry(cwd) {
    if (cwd === '' || typeof localStorage === 'undefined')
        return EMPTY_TREE_REGISTRY;
    try {
        const raw = localStorage.getItem(treeStoreKey(cwd));
        if (raw === null)
            return EMPTY_TREE_REGISTRY;
        return parseTreeRegistry(JSON.parse(raw));
    }
    catch {
        return EMPTY_TREE_REGISTRY;
    }
}
export function saveTreeRegistry(cwd, registry) {
    if (cwd === '' || typeof localStorage === 'undefined')
        return;
    try {
        localStorage.setItem(treeStoreKey(cwd), JSON.stringify({
            trees: registry.trees,
            current: registry.current,
            masterCounter: registry.masterCounter,
        }));
    }
    catch {
        // storage unavailable; registry stays in memory
    }
}
export { MAIN_TREE };
