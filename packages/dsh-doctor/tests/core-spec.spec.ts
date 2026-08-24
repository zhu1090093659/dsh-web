/**
 * Dependency spec classification and pinning.
 */
import { describe, expect, it } from 'vitest'
import { canonicalSpec, classifySpec, isCommitPinnedGit, isPinned, isLocalSpec, splitPackageSpec } from '../src/core/spec.ts'

describe('splitPackageSpec', () => {
  it('handles scoped and unscoped names', () => {
    expect(splitPackageSpec('dsh-better-sidebar')).toEqual({ name: 'dsh-better-sidebar' })
    expect(splitPackageSpec('dsh-better-sidebar@0.14.0')).toEqual({ name: 'dsh-better-sidebar', sub: '0.14.0' })
    expect(splitPackageSpec('@linxin666/dsh-web-all')).toEqual({ name: '@linxin666/dsh-web-all' })
    expect(splitPackageSpec('@linxin666/dsh-web-all@0.2.7')).toEqual({ name: '@linxin666/dsh-web-all', sub: '0.2.7' })
  })
})

describe('classifySpec', () => {
  it('classifies exact versions', () => {
    expect(classifySpec('dsh-better-sidebar@0.14.0').kind).toBe('exact')
    expect(classifySpec('pkg@0.1.1-rc.2').kind).toBe('exact')
  })

  it('classifies ranges', () => {
    expect(classifySpec('x@^0.1.19').kind).toBe('range')
    expect(classifySpec('x@~1.2.3').kind).toBe('range')
    expect(classifySpec('x@latest').kind).toBe('range')
    expect(classifySpec('x@1.x').kind).toBe('range')
  })

  it('classifies link and file specs', () => {
    const link = classifySpec('link:../packages/dsh-web-all')
    expect(link.kind).toBe('link')
    expect(link.target).toBe('../packages/dsh-web-all')
    const file = classifySpec('file:./x.tgz')
    expect(file.kind).toBe('file')
  })

  it('classifies github and git specs', () => {
    const gh = classifySpec('github:omdsh-dev/dsh-annotation#cd356724')
    expect(gh.kind).toBe('github')
    expect(gh.ref).toBe('cd356724')
    const branch = classifySpec('github:omdsh-dev/dsh-annotation')
    expect(branch.kind).toBe('github')
    expect(branch.ref).toBeUndefined()
    const git = classifySpec('git+https://github.com/x/y.git#main')
    expect(git.kind).toBe('git')
    expect(git.ref).toBe('main')
  })

  it('classifies tarballs and workspace specs', () => {
    expect(classifySpec('https://example.com/a/b.tgz').kind).toBe('tarball')
    expect(classifySpec('workspace:*').kind).toBe('workspace')
  })
})

describe('pinning', () => {
  it('recognizes exact pins and commit-pinned git', () => {
    expect(isPinned(classifySpec('pkg@1.2.3'))).toBe(true)
    expect(isPinned(classifySpec('pkg@^1.2.3'))).toBe(false)
    expect(isPinned(classifySpec('github:o/r#0123abc'))).toBe(true)
    expect(isPinned(classifySpec('github:o/r#main'))).toBe(false)
    expect(isCommitPinnedGit(classifySpec('github:o/r#0123abc'))).toBe(true)
  })

  it('recognizes local specs', () => {
    expect(isLocalSpec(classifySpec('link:./x'))).toBe(true)
    expect(isLocalSpec(classifySpec('file:./x.tgz'))).toBe(true)
    expect(isLocalSpec(classifySpec('npm:x'))).toBe(false)
  })

  it('canonicalSpec round-trips the meaningful parts', () => {
    expect(canonicalSpec(classifySpec('@a/b@1.2.3'))).toBe('@a/b@1.2.3')
    expect(canonicalSpec(classifySpec('github:o/r#abc'))).toBe('github:o/r#abc')
    expect(canonicalSpec(classifySpec('link:./x'))).toBe('link:./x')
  })
})
