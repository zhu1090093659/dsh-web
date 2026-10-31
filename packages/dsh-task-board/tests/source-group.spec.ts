import { describe, expect, it } from 'vitest'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import {
  groupTasksBySource,
  isSourceGroupFolded,
  LOCAL_SOURCE_GROUP_ID,
  readSourceGroupFolds,
  SOURCE_GROUP_FOLDS_KEY,
  sourceGroupFoldKey,
  writeSourceGroupFolds,
} from '../src/client/board/source-group.ts'

function task(id: string, source?: string): TaskRecord {
  return createTask({ title: id, description: '', prompt: 'p', ...(source === undefined ? {} : { integrations: { fake: { source } } }) }, 1, id)
}

describe('board source groups', () => {
  it('operator sees full source labels sorted with local cards last and card order preserved', () => {
    // Given cards from two providers and one local card
    const tasks = [task('b-1', 'zeta/repo'), task('a-1', 'Alpha/Repo'), task('local'), task('a-2', 'Alpha/Repo')]
    const selector = (candidate: TaskRecord) => {
      const source = (candidate.integrations?.fake as { source?: string } | undefined)?.source
      return source === undefined ? undefined : { id: 'fake:' + source.toLowerCase(), label: source }
    }

    // When grouped through the generic selector
    const groups = groupTasksBySource(tasks, [selector])

    // Then full labels sort case-insensitively, local is last, and items keep ledger order
    expect(groups.map(group => group.label)).toEqual(['Alpha/Repo', 'zeta/repo', ''])
    expect(groups[0]?.items.map(item => item.id)).toEqual(['a-1', 'a-2'])
    expect(groups[2]?.id).toBe(LOCAL_SOURCE_GROUP_ID)
    expect(groups[2]?.local).toBe(true)
  })

  it('operator with a faulty or empty selector still gets a usable local group', () => {
    // Given selectors that throw, return blank fields, and claim no card
    // When every selector fails to provide a usable group
    const groups = groupTasksBySource([task('local')], [
      () => { throw new Error('provider failed') },
      () => ({ id: ' ', label: 'blank' }),
      () => undefined,
    ])

    // Then the board degrades to its local group instead of failing render
    expect(groups).toHaveLength(1)
    expect(groups[0]?.local).toBe(true)
    expect(groups[0]?.items[0]?.id).toBe('local')
  })

  it('operator fold choices stay scoped by view and source, with done folded and search expanded', () => {
    // Given explicit fold choices for one repository in two views
    const doneKey = sourceGroupFoldKey('done', 'fake:alpha/repo')
    const todoKey = sourceGroupFoldKey('todo', 'fake:alpha/repo')
    const folds = { [doneKey]: false, [todoKey]: true }

    // When each view and search state is evaluated
    // Then each key is independent, defaults hold elsewhere, and search reveals all
    expect(isSourceGroupFolded(folds, 'done', 'fake:alpha/repo', false)).toBe(false)
    expect(isSourceGroupFolded(folds, 'todo', 'fake:alpha/repo', false)).toBe(true)
    expect(isSourceGroupFolded(folds, 'done', 'fake:other/repo', false)).toBe(true)
    expect(isSourceGroupFolded(folds, 'archived', 'fake:alpha/repo', false)).toBe(false)
    expect(isSourceGroupFolded(folds, 'done', 'fake:alpha/repo', true)).toBe(false)
  })

  it('operator preferences survive storage round trips and malformed data falls back safely', () => {
    // Given a storage double and one explicit choice
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    // When a preference is written and read back
    writeSourceGroupFolds(storage, { 'done:fake:alpha/repo': false })

    // Then the same key and boolean survive the round trip
    expect(values.has(SOURCE_GROUP_FOLDS_KEY)).toBe(true)
    expect(readSourceGroupFolds(storage)).toEqual({ 'done:fake:alpha/repo': false })

    // And malformed shapes never become preferences
    values.set(SOURCE_GROUP_FOLDS_KEY, JSON.stringify(['done:local']))
    expect(readSourceGroupFolds(storage)).toEqual({})
    values.set(SOURCE_GROUP_FOLDS_KEY, '{broken')
    expect(readSourceGroupFolds(storage)).toEqual({})
  })
})
