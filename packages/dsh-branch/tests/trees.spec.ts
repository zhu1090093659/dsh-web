/**
 * Branch-tree registry: master tree minting, switching, and persisted-payload repair.
 */
import { describe, expect, it } from 'vitest'
import {
  branchTreeAt, EMPTY_TREE_REGISTRY, isMainTree, MAIN_TREE, masterNumber,
  nextMasterName, parseTreeRegistry, treeByName, withCurrent,
} from '../src/core/trees.ts'

describe('branch tree registry', () => {
  it('starts on the main tree with no master trees', () => {
    expect(EMPTY_TREE_REGISTRY.current).toBe(MAIN_TREE)
    expect(EMPTY_TREE_REGISTRY.trees).toHaveLength(0)
    expect(EMPTY_TREE_REGISTRY.masterCounter).toBe(0)
    expect(isMainTree(EMPTY_TREE_REGISTRY)).toBe(true)
    expect(nextMasterName(EMPTY_TREE_REGISTRY)).toBe('master1')
  })

  it('creates numbered master trees on rollback targets', () => {
    const first = branchTreeAt(EMPTY_TREE_REGISTRY, 3, 7, 'write a.txt', 1000)
    expect(first.created).toBe(true)
    expect(first.tree.name).toBe('master1')
    expect(first.tree.stateIndex).toBe(3)
    expect(first.tree.nodeIndex).toBe(7)
    expect(first.tree.label).toBe('write a.txt')
    expect(first.tree.kind).toBe('master')
    expect(first.registry.masterCounter).toBe(1)
    expect(first.registry.current).toBe(MAIN_TREE)

    const second = branchTreeAt(first.registry, 9, 12, 'edit b.txt', 2000)
    expect(second.created).toBe(true)
    expect(second.tree.name).toBe('master2')
    expect(second.registry.masterCounter).toBe(2)
  })

  it('reuses an existing master tree for the same state', () => {
    const first = branchTreeAt(EMPTY_TREE_REGISTRY, 3, 7, 'write a.txt', 1000)
    const again = branchTreeAt(first.registry, 3, 99, 'different label', 2000)
    expect(again.created).toBe(false)
    expect(again.tree.name).toBe('master1')
    expect(again.registry.masterCounter).toBe(1)
    expect(again.registry.trees).toHaveLength(1)
  })

  it('falls back to a sensible label when the record title is empty', () => {
    const branched = branchTreeAt(EMPTY_TREE_REGISTRY, 1, 2, '', 1000)
    expect(branched.tree.label).toBe('master1')
  })

  it('switches the current tree with withCurrent', () => {
    const branched = branchTreeAt(EMPTY_TREE_REGISTRY, 3, 7, 'label', 1000)
    const switched = withCurrent(branched.registry, 'master1')
    expect(switched.current).toBe('master1')
    expect(isMainTree(switched)).toBe(false)
    const back = withCurrent(switched, MAIN_TREE)
    expect(back.current).toBe(MAIN_TREE)
  })

  it('ignores unknown current names', () => {
    const switched = withCurrent(EMPTY_TREE_REGISTRY, 'nope')
    expect(switched.current).toBe(MAIN_TREE)
  })

  it('tracks the highest minted master number', () => {
    const first = branchTreeAt(EMPTY_TREE_REGISTRY, 3, 7, 'a', 1000)
    const second = branchTreeAt(first.registry, 9, 12, 'b', 2000)
    expect(masterNumber(second.registry)).toBe(2)
  })
})

describe('parseTreeRegistry repair', () => {
  it('returns the empty registry for unknown payloads', () => {
    expect(parseTreeRegistry(null)).toEqual(EMPTY_TREE_REGISTRY)
    expect(parseTreeRegistry('garbage')).toEqual(EMPTY_TREE_REGISTRY)
    expect(parseTreeRegistry({})).toEqual(EMPTY_TREE_REGISTRY)
  })

  it('round-trips a valid persisted payload', () => {
    const branched = branchTreeAt(EMPTY_TREE_REGISTRY, 3, 7, 'label', 1000)
    const switched = withCurrent(branched.registry, 'master1')
    const payload = JSON.parse(JSON.stringify(switched)) as unknown
    const parsed = parseTreeRegistry(payload)
    expect(parsed.current).toBe('master1')
    expect(parsed.masterCounter).toBe(1)
    expect(parsed.trees).toEqual(branched.registry.trees)
    expect(treeByName(parsed, 'master1')?.stateIndex).toBe(3)
  })

  it('drops corrupt entries and repairs the counter from surviving names', () => {
    const payload = {
      current: 'master3',
      masterCounter: 1,
      trees: [
        { name: 'master3', kind: 'master', nodeIndex: 5, stateIndex: 11, label: 'ok', createdAt: 1 },
        { name: 'broken', kind: 'master', nodeIndex: 'x', stateIndex: 4, createdAt: 1 },
        { name: 'main', kind: 'main', nodeIndex: 0, stateIndex: 0, createdAt: 0 },
      ],
    }
    const parsed = parseTreeRegistry(payload)
    expect(parsed.trees).toHaveLength(1)
    expect(parsed.trees[0].name).toBe('master3')
    expect(parsed.current).toBe('master3')
    expect(parsed.masterCounter).toBe(3)
  })

  it('falls back to main when current points at an unknown tree', () => {
    const parsed = parseTreeRegistry({
      current: 'master9',
      masterCounter: 0,
      trees: [{ name: 'master1', kind: 'master', nodeIndex: 1, stateIndex: 2, label: 'a', createdAt: 1 }],
    })
    expect(parsed.current).toBe(MAIN_TREE)
    expect(parsed.masterCounter).toBe(1)
  })
})
