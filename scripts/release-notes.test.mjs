/**
 * Tests for release-notes.mjs: the conventional-commit parsing, section
 * grouping, issue linking, and the end-to-end tag-range collection against a
 * real temporary git repository.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bulletOf, collectNotes, linkIssues, parseSubject, renderNotes, sectionOf } from './release-notes.mjs'

test('parseSubject: parses conventional subjects and skips noise', () => {
  assert.deepEqual(parseSubject('feat(skin): add QQ2006 classic theme (#11)'), {
    type: 'feat', scope: 'skin', subject: 'add QQ2006 classic theme (#11)',
  })
  assert.deepEqual(parseSubject('fix: repair branch switch'), {
    type: 'fix', scope: '', subject: 'repair branch switch',
  })
  assert.deepEqual(parseSubject('fix(task-board,ssh): hide composer (#76 #87)'), {
    type: 'fix', scope: 'task-board,ssh', subject: 'hide composer (#76 #87)',
  })
  assert.equal(parseSubject('chore(release): bump to 0.1.14'), undefined)
  assert.equal(parseSubject('Merge main into fix/branch'), undefined)
  assert.equal(parseSubject('Merge pull request #1 from somewhere'), undefined)
  assert.equal(parseSubject('not a conventional subject'), undefined)
  assert.equal(parseSubject(''), undefined)
  assert.equal(parseSubject('feat: '), undefined)
})

test('sectionOf: groups feat / fix / everything else', () => {
  assert.equal(sectionOf({ type: 'feat', scope: '', subject: 'x' }), 'feat')
  assert.equal(sectionOf({ type: 'fix', scope: '', subject: 'x' }), 'fix')
  assert.equal(sectionOf({ type: 'docs', scope: '', subject: 'x' }), 'other')
  assert.equal(sectionOf({ type: 'perf', scope: '', subject: 'x' }), 'other')
})

test('linkIssues: links (#123) and (#12 #34) references, leaves the rest alone', () => {
  assert.equal(
    linkIssues('fixes (#184) and (#12)', 'zhu1090093659/dsh-web'),
    'fixes ([#184](https://github.com/zhu1090093659/dsh-web/issues/184)) and ([#12](https://github.com/zhu1090093659/dsh-web/issues/12))',
  )
  assert.equal(
    linkIssues('hide composer (#76 #87)', 'o/r'),
    'hide composer ([#76](https://github.com/o/r/issues/76) [#87](https://github.com/o/r/issues/87))',
  )
  assert.equal(linkIssues('plain #123 without parens', 'o/r'), 'plain #123 without parens')
})

test('renderNotes: Chinese default view with English behind a details toggle; empty notes stay honest', () => {
  const rows = [
    { type: 'fix', scope: 'git-graph', subject: 'single-spawn markers (#184)' },
    { type: 'feat', scope: 'skin', subject: 'add theme (#11)' },
    { type: 'docs', scope: 'readme', subject: 'trim sections' },
  ]
  const notes = renderNotes('0.1.14', rows, 'zhu1090093659/dsh-web')
  // The default view is Chinese; the English version sits behind the toggle.
  assert.ok(notes.startsWith('本次发布包含 1 项新功能、1 项修复、1 项其他改动。'))
  assert.ok(notes.includes('### 新功能'))
  assert.ok(notes.includes('### 修复'))
  assert.ok(notes.includes('### 其他改动'))
  assert.ok(notes.includes('<details>'))
  assert.ok(notes.includes('<summary>English</summary>'))
  assert.ok(notes.includes('This release contains 1 new feature, 1 bug fix, 1 other change.'))
  assert.ok(notes.includes('### New Features'))
  assert.ok(notes.includes('### Bug Fixes'))
  assert.ok(notes.includes('### Other Changes'))
  // Each bullet keeps its authored subject in both views (the translations
  // are the maintainer's job in the committed notes file).
  assert.ok(notes.includes('- [git-graph] single-spawn markers ([#184](https://github.com/zhu1090093659/dsh-web/issues/184))'))
  // Chinese sections precede the toggle; English sections live inside it.
  assert.ok(notes.indexOf('### 新功能') < notes.indexOf('<summary>English</summary>'))
  assert.ok(notes.indexOf('<summary>English</summary>') < notes.indexOf('### New Features'))
  assert.ok(notes.indexOf('### New Features') < notes.indexOf('### Bug Fixes'))
  assert.ok(notes.indexOf('### Bug Fixes') < notes.indexOf('### Other Changes'))
  // The footer splits too: English inside the details, Chinese outside.
  assert.ok(notes.indexOf('Generated automatically by the release pipeline') < notes.indexOf('</details>'))
  assert.ok(notes.indexOf('由发布管线自动生成') > notes.indexOf('</details>'))
  const empty = renderNotes('0.1.14', [], 'o/r')
  assert.ok(empty.includes('本次发布没有需要说明的功能性变更。'))
  assert.ok(empty.includes('No user-facing changes in this release.'))
})

test('bulletOf: no scope badge when the scope is empty', () => {
  assert.equal(bulletOf({ type: 'fix', scope: '', subject: 'x (#1)' }, 'o/r'), '- x ([#1](https://github.com/o/r/issues/1))')
})

test('collectNotes: renders the commits between two tags of a real temp repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-release-notes-'))
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@dsh.local')
    git('config', 'user.name', 'Test')
    const commit = (message) => {
      execFileSync('git', ['commit', '--allow-empty', '-q', '-m', message], { cwd: dir })
    }
    commit('feat(skin): add QQ2006 classic theme (#11)')
    commit('fix(git-graph): single-spawn markers (#184)')
    commit('chore(release): bump to 0.1.0')
    git('tag', 'v0.1.0')
    commit('fix(aionui-panel): scope z-index to tab bars (#169)')
    commit('docs(readme): trim skin promo sections')
    commit('Merge main into fix/branch')
    git('tag', 'v0.1.1')

    const notes = collectNotes(dir, 'v0.1.1', 'zhu1090093659/dsh-web')
    // Only commits after v0.1.0 appear; the bump and the merge are skipped.
    assert.ok(notes.includes('1 项修复、1 项其他改动'))
    assert.ok(notes.includes('- [aionui-panel] scope z-index to tab bars'))
    assert.ok(notes.includes('- [readme] trim skin promo sections'))
    assert.ok(!notes.includes('QQ2006'))
    assert.ok(!notes.includes('bump to 0.1.0'))
    assert.ok(!notes.includes('Merge main'))
    assert.ok(notes.includes('issues/169'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('collectNotes: includes commits merged in on a side branch (v0.1.15 regression)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-release-notes-merge-'))
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@dsh.local')
    git('config', 'user.name', 'Test')
    const commit = (message) => {
      execFileSync('git', ['commit', '--allow-empty', '-q', '-m', message], { cwd: dir })
    }
    commit('chore(release): bump to 0.1.0')
    git('tag', 'v0.1.0')
    commit('feat(ci): add release notes generator')
    git('checkout', '-q', '-b', 'feature')
    commit('perf(skins): one ticker for trading')
    commit('fix(ssh): split 801-line engine into modules')
    git('checkout', '-q', 'main')
    git('merge', '--no-ff', '-q', '-m', 'merge: plugin suite performance refactor', 'feature')
    git('tag', 'v0.1.1')

    const notes = collectNotes(dir, 'v0.1.1', 'zhu1090093659/dsh-web')
    // The side-branch work rides the merge commit's second parent; a
    // first-parent walk would lose it entirely.
    assert.ok(notes.includes('perf(skins)') === false, 'subjects render without the type prefix')
    assert.ok(notes.includes('- [skins] one ticker for trading'))
    assert.ok(notes.includes('- [ssh] split 801-line engine into modules'))
    assert.ok(notes.includes('- [ci] add release notes generator'))
    assert.ok(!notes.includes('merge: plugin suite'))
    assert.ok(!notes.includes('bump to 0.1.0'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
