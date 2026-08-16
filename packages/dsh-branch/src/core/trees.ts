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

export const MAIN_TREE = 'main'

export interface BranchTreeRef {
  readonly name: string
  /** Human label captured at branch time (record title or tree kind). */
  readonly label: string
  readonly kind: 'main' | 'master'
  /** Trajectory record index the tree was branched from; -1 for main. */
  readonly nodeIndex: number
  /** File-op count applied at the branch point (applySetAt index). */
  readonly stateIndex: number
  readonly createdAt: number
}

export interface BranchTreeRegistry {
  /** Stored trees: main is implicit and never listed here. */
  readonly trees: readonly BranchTreeRef[]
  /** Current tree name: MAIN_TREE or a master tree name. */
  readonly current: string
  /** Next master number to mint (1-based; master1 is the first). */
  readonly masterCounter: number
}

export const EMPTY_TREE_REGISTRY: BranchTreeRegistry = {
  trees: [],
  current: MAIN_TREE,
  masterCounter: 0,
}

export function treeByName(registry: BranchTreeRegistry, name: string): BranchTreeRef | undefined {
  return registry.trees.find(tree => tree.name === name)
}

export function nextMasterName(registry: BranchTreeRegistry): string {
  return 'master' + (registry.masterCounter + 1)
}

/**
 * Resolve the master tree for one target state, creating it (masterN) when
 * no stored tree already points at that exact state.
 * @returns the (possibly new) tree and whether it was created.
 */
export function branchTreeAt(
  registry: BranchTreeRegistry,
  stateIndex: number,
  nodeIndex: number,
  label: string,
  now: number,
): { registry: BranchTreeRegistry; tree: BranchTreeRef; created: boolean } {
  const existing = registry.trees.find(tree => tree.stateIndex === stateIndex)
  if (existing !== undefined) return { registry, tree: existing, created: false }
  const name = nextMasterName(registry)
  const tree: BranchTreeRef = {
    name,
    label: label !== '' ? label : name,
    kind: 'master',
    nodeIndex,
    stateIndex,
    createdAt: now,
  }
  return {
    registry: {
      trees: [...registry.trees, tree],
      current: registry.current,
      masterCounter: registry.masterCounter + 1,
    },
    tree,
    created: true,
  }
}

/** Mark the named tree as current; unknown names leave the registry untouched. */
export function withCurrent(registry: BranchTreeRegistry, name: string): BranchTreeRegistry {
  if (name !== MAIN_TREE && treeByName(registry, name) === undefined) return registry
  if (registry.current === name) return registry
  return { ...registry, current: name }
}

export function isMainTree(registry: BranchTreeRegistry): boolean {
  return registry.current === MAIN_TREE
}

/** Highest master number already minted (0 when none). */
export function masterNumber(registry: BranchTreeRegistry): number {
  let max = 0
  for (const tree of registry.trees) {
    const match = /^master(\d+)$/.exec(tree.name)
    if (match !== null) max = Math.max(max, Number(match[1]))
  }
  return max
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseTreeRef(value: unknown): BranchTreeRef | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string' || record.name === '') return null
  if (record.kind !== 'main' && record.kind !== 'master') return null
  if (!isFiniteNumber(record.nodeIndex) || !isFiniteNumber(record.stateIndex)) return null
  return {
    name: record.name,
    label: typeof record.label === 'string' && record.label !== '' ? record.label : record.name,
    kind: record.kind,
    nodeIndex: record.nodeIndex,
    stateIndex: record.stateIndex,
    createdAt: isFiniteNumber(record.createdAt) ? record.createdAt : 0,
  }
}

/** Repair unknown/corrupt persisted payloads into a valid registry. */
export function parseTreeRegistry(value: unknown): BranchTreeRegistry {
  if (typeof value !== 'object' || value === null) return EMPTY_TREE_REGISTRY
  const record = value as Record<string, unknown>
  const trees: BranchTreeRef[] = []
  if (Array.isArray(record.trees)) {
    for (const entry of record.trees) {
      const tree = parseTreeRef(entry)
      if (tree !== null && tree.name !== MAIN_TREE) trees.push(tree)
    }
  }
  const deduped = [...new Map(trees.map(tree => [tree.name, tree])).values()]
  const counter = Math.max(
    isFiniteNumber(record.masterCounter) ? Math.max(0, Math.floor(record.masterCounter)) : 0,
    masterNumber({ trees: deduped, current: MAIN_TREE, masterCounter: 0 }),
  )
  const current = typeof record.current === 'string'
    && (record.current === MAIN_TREE || deduped.some(tree => tree.name === record.current))
    ? record.current
    : MAIN_TREE
  return { trees: deduped, current, masterCounter: counter }
}
