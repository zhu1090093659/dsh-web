/**
 * Pure git-domain unit tests: parsing, validation, classification, and lane
 * computation. No git binary, no DOM.
 */
import { describe, expect, it } from 'vitest'
import {
  classifySwitchFailure, extractBlockedPaths, validateBranchName,
} from '../src/core/git-command.ts'
import {
  computeLanes, isBranchesView, isGitError, isGraphView, isRepoStatus,
  parseBranches, parseDecoration, parseGraph, parsePorcelain,
  parseWorktreeBranches,
} from '../src/core/types.ts'

describe('parseBranches', () => {
  it('parses for-each-ref rows with the current marker', () => {
    const rows = parseBranches('main\u0000*\u0000aaa\nfeature/x\u0000 \u0000bbb\n')
    expect(rows.map(row => [row.name, row.current])).toEqual([
      ['feature/x', false],
      ['main', true],
    ])
  })

  it('sorts by name', () => {
    const rows = parseBranches('zeta\u0000 \u0000a\nalpha\u0000*\u0000b\n')
    expect(rows.map(row => row.name)).toEqual(['alpha', 'zeta'])
  })
})

describe('parsePorcelain', () => {
  it('counts dirty, untracked, and conflict entries', () => {
    const counts = parsePorcelain(' M a.ts\n?? new.txt\nUU conflict.txt\nA  staged.ts\n')
    expect(counts).toEqual({ dirtyFiles: 2, untrackedFiles: 1, conflicts: 1 })
  })

  it('counts AA/DD unmerged entries as conflicts, not dirty files', () => {
    const counts = parsePorcelain('AA addadd.txt\nDD deldel.txt\n M plain.ts\n')
    expect(counts).toEqual({ dirtyFiles: 1, untrackedFiles: 0, conflicts: 2 })
  })
})

describe('parseWorktreeBranches', () => {
  it('extracts branch refs from the porcelain worktree listing', () => {
    const stdout = [
      'worktree /repo',
      'HEAD aaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo-wt2',
      'HEAD bbbb',
      'branch refs/heads/feature/x',
      '',
    ].join('\n')
    expect(parseWorktreeBranches(stdout)).toEqual(['main', 'feature/x'])
  })
})

describe('parseDecoration', () => {
  it('strips the HEAD handoff and tag prefixes', () => {
    expect(parseDecoration('HEAD -> main, tag: v1.0, origin/main')).toEqual(['main', 'v1.0', 'origin/main'])
  })

  it('returns nothing for an empty decoration', () => {
    expect(parseDecoration('')).toEqual([])
  })

  it('keeps ref names that start with HEAD and drops a bare detached HEAD', () => {
    expect(parseDecoration('HEAD -> HEADfoo, HEAD')).toEqual(['HEADfoo'])
  })
})

describe('parseGraph', () => {
  it('parses the log format rows with parents and refs', () => {
    const stdout = 'a1\u0000b1 b2\u0000Alice\u00001700000000\u0000HEAD -> main\u0000first commit\u001e'
    const commits = parseGraph(stdout)
    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({
      oid: 'a1',
      parents: ['b1', 'b2'],
      author: 'Alice',
      authorTime: 1700000000,
      subject: 'first commit',
      refs: ['main'],
    })
  })

  it('strips the trailing newline git appends after each record separator', () => {
    // `git log --format=...%x1e` (tformat) emits `<fields>\x1e\n` per commit:
    // every record after the first carries a leading newline, and the stream
    // ends with a bare `\n` entry. Both must not corrupt the oid or produce
    // a phantom commit.
    const stdout = [
      'aaaa\u0000bbbb\u0000Alice\u00001700000000\u0000main\u0000newest\u001e',
      'bbbb\u0000cccc\u0000Bob\u00001690000000\u0000\u0000middle\u001e',
      'cccc\u0000\u0000Carol\u00001680000000\u0000tag: v1\u0000oldest\u001e',
      '',
    ].join('\n')
    const commits = parseGraph(stdout)
    expect(commits).toHaveLength(3)
    expect(commits.map(commit => commit.oid)).toEqual(['aaaa', 'bbbb', 'cccc'])
    expect(commits[1].refs).toEqual([])
    expect(commits[2].refs).toEqual(['v1'])
  })
})

describe('validateBranchName', () => {
  it('accepts ordinary branch names', () => {
    expect(validateBranchName('main')).toBeNull()
    expect(validateBranchName('feature/git-branch-switcher')).toBeNull()
  })

  it('rejects git-forbidden names', () => {
    expect(validateBranchName('')).not.toBeNull()
    expect(validateBranchName('-lead')).not.toBeNull()
    expect(validateBranchName('a..b')).not.toBeNull()
    expect(validateBranchName('a b')).not.toBeNull()
    expect(validateBranchName('a~b')).not.toBeNull()
    expect(validateBranchName('a^b')).not.toBeNull()
    expect(validateBranchName('a:b')).not.toBeNull()
    expect(validateBranchName('a?b')).not.toBeNull()
    expect(validateBranchName('a*b')).not.toBeNull()
    expect(validateBranchName('a[b')).not.toBeNull()
    expect(validateBranchName('a\\b')).not.toBeNull()
    expect(validateBranchName('a@{b')).not.toBeNull()
    expect(validateBranchName('@')).not.toBeNull()
    expect(validateBranchName('a.')).not.toBeNull()
    expect(validateBranchName('a.lock')).not.toBeNull()
    expect(validateBranchName('a//b')).not.toBeNull()
    expect(validateBranchName('/a')).not.toBeNull()
    expect(validateBranchName('a/')).not.toBeNull()
    expect(validateBranchName('a/./b')).not.toBeNull()
  })
})

describe('classifySwitchFailure', () => {
  it('classifies tracked-overwrite failures with the blocked files', () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by checkout:',
      '\ta.ts',
      '\tb.ts',
      'Please commit your changes or stash them before you switch branches.',
    ].join('\n')
    const error = classifySwitchFailure(stderr)
    expect(error.code).toBe('tracked-changes-would-be-overwritten')
    expect(error.paths).toEqual(['a.ts', 'b.ts'])
    expect(error.moreFiles).toBe(0)
  })

  it('classifies untracked-overwrite failures and caps the shown paths', () => {
    const lines = ['error: The following untracked working tree files would be overwritten by checkout:']
    for (let i = 0; i < 5; i += 1) lines.push(`\tfile-${i}.txt`)
    const error = classifySwitchFailure(lines.join('\n'))
    expect(error.code).toBe('untracked-changes-would-be-overwritten')
    expect(error.paths).toEqual(['file-0.txt', 'file-1.txt'])
    expect(error.moreFiles).toBe(3)
  })

  it('classifies a missing target branch', () => {
    const error = classifySwitchFailure("fatal: invalid reference: nope")
    expect(error.code).toBe('target-branch-not-found')
  })

  it('falls back to internal for unknown output', () => {
    const error = classifySwitchFailure('fatal: something unexpected')
    expect(error.code).toBe('internal')
  })
})

describe('extractBlockedPaths', () => {
  it('extracts tab-indented paths, unquoting the quoted ones', () => {
    const stderr = 'header\n\tplain.txt\n\t"the \\"quoted\\" file.txt"\n\nPlease stash first.\n'
    const { paths, moreFiles } = extractBlockedPaths(stderr, /header/)
    expect(paths).toEqual(['plain.txt', 'the "quoted" file.txt'])
    expect(moreFiles).toBe(0)
  })

  it('stops at the trailing hint line', () => {
    const stderr = 'header\n\ta.ts\n\tb.ts\n\tc.ts\nPlease commit your changes first.\n'
    const { paths, moreFiles } = extractBlockedPaths(stderr, /header/)
    expect(paths).toEqual(['a.ts', 'b.ts'])
    expect(moreFiles).toBe(1)
  })
})

describe('computeLanes', () => {
  it('renders a linear history on one lane', () => {
    const lanes = computeLanes([
      { oid: 'c', parents: ['b'], subject: '', author: '', authorTime: 0, refs: [] },
      { oid: 'b', parents: ['a'], subject: '', author: '', authorTime: 0, refs: [] },
      { oid: 'a', parents: [], subject: '', author: '', authorTime: 0, refs: [] },
    ])
    expect(lanes.map(row => row.columns)).toEqual([['node'], ['node'], ['node']])
    expect(lanes.map(row => row.nodeColumn)).toEqual([0, 0, 0])
  })

  it('opens a second lane for a branch and joins it on the merge', () => {
    const rows = [
      { oid: 'm', parents: ['c', 'b'], subject: '', author: '', authorTime: 0, refs: [] },
      { oid: 'c', parents: ['a'], subject: '', author: '', authorTime: 0, refs: [] },
      { oid: 'b', parents: ['a'], subject: '', author: '', authorTime: 0, refs: [] },
      { oid: 'a', parents: [], subject: '', author: '', authorTime: 0, refs: [] },
    ]
    const lanes = computeLanes(rows)
    expect(lanes[0]).toMatchObject({ merge: true, nodeColumn: 0 })
    // The side branch gets its own column; the parent's line passes it.
    expect(lanes[1].columns).toEqual(['node', 'pass'])
    expect(lanes[2].nodeColumn).toBe(1)
    // The join lane ends into the shared ancestor's node.
    expect(lanes[3].columns).toEqual(['node', 'gap'])
  })
})

describe('wire runtime guards', () => {
  it('narrows a valid RepoStatus and rejects malformed ones', () => {
    expect(isRepoStatus({
  root: '/w', branch: 'main', head: 'abc1234', dirtyFiles: 0,
  untrackedFiles: 1, conflicts: 0, operationInProgress: false,
    })).toBe(true)
    expect(isRepoStatus(null)).toBe(false)
    expect(isRepoStatus({ root: '/w', branch: 'main', head: 'abc1234', dirtyFiles: 0 })).toBe(false)
    expect(isRepoStatus({ root: '/w', branch: 'main', head: 'abc1234', dirtyFiles: 'x', untrackedFiles: 0, conflicts: 0, operationInProgress: false })).toBe(false)
    expect(isRepoStatus({ root: '/w', branch: 'main', head: 'abc1234', dirtyFiles: 0, untrackedFiles: 0, conflicts: 0, operationInProgress: 'yes' })).toBe(false)
  })

  it('narrows a valid BranchesView and rejects wrong row shapes', () => {
    const view = {
      root: '/w', branch: 'main', dirtyFiles: 0, untrackedFiles: 0, conflicts: 0, operationInProgress: false,
      branches: [{ name: 'main', current: true }, { name: 'feature/x', current: false }],
    }
    expect(isBranchesView(view)).toBe(true)
    expect(isBranchesView({ ...view, branches: [{ name: 'main', current: 'yes' }] })).toBe(false)
    expect(isBranchesView({ ...view, dirtyFiles: undefined })).toBe(false)
  })

  it('narrows a valid GraphView and rejects commit shape drift', () => {
    const view = {
      root: '/w', branch: 'main', hasMore: false,
      commits: [{ oid: 'a1', parents: ['b1'], subject: 's', author: 'A', authorTime: 0, refs: ['main'] }],
    }
    expect(isGraphView(view)).toBe(true)
    expect(isGraphView({ ...view, commits: [{ oid: 'a1', parents: ['b1'], subject: 's', author: 'A', authorTime: 'x', refs: [] }] })).toBe(false)
    expect(isGraphView({ ...view, hasMore: 'yes' })).toBe(false)
  })

  it('narrows a valid GitError and rejects unknown codes or type drift', () => {
    expect(isGitError({ code: 'conflicts-present', message: 'nope' })).toBe(true)
    expect(isGitError({ code: 'conflicts-present', message: 'nope', paths: ['a.ts'], moreFiles: 0 })).toBe(true)
    expect(isGitError({ code: 'conflicts-present', message: 'nope', paths: [1] })).toBe(false)
    expect(isGitError({ code: 'not-a-code', message: 'nope' })).toBe(false)
    expect(isGitError({ code: 'internal', message: 42 })).toBe(false)
  })
})
