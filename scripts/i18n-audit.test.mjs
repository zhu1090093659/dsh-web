/**
 * i18n-audit gate core, unit-tested: the comment-stripping CJK scanner (it
 * must flag leaked copy in strings/templates/regex/JSX text and never flag
 * comments), the key-set and placeholder diffs, and namespace derivation
 * from a client entry. The end-to-end gate itself is `pnpm i18n:check`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  diffKeySets,
  diffPlaceholders,
  deriveNamespace,
  placeholdersOf,
  scanCjk,
  stripComments,
} from './i18n-audit.mjs'

test('stripComments blanks comments but keeps strings and code', () => {
  const { code } = stripComments([
    '// 中文行注释',
    'const a = 1 // 追注 中文',
    'const s = "值" /* 块注释 中文 */',
    'const t = `模板 中文`',
  ].join('\n'))
  assert.ok(!code.includes('中文行注释'))
  assert.ok(!code.includes('追注'))
  assert.ok(!code.includes('块注释'))
  assert.ok(code.includes('"值"'))
  assert.ok(code.includes('模板 中文'))
})

test('stripComments ignores comment markers inside strings', () => {
  const { code } = stripComments(`const url = 'http://x/a'; const zh = '中文';`)
  assert.ok(code.includes("'中文'"), 'string copy must survive a // inside an earlier string')
})

test('scanCjk flags string, template, regex and JSX text, spares comments', () => {
  const source = [
    '/** 中文 JSDoc */',
    'const ok = 1',
    "const s = '会话 ' + n",
    'const t = `阈值 ${n} 个`',
    'const re = /模型|Model/',
    'const el = <p onClick={fn}>打开侧边栏</p>',
    'const fine = "English only"',
  ].join('\n')
  const { hits, fileExempt } = scanCjk(source)
  assert.equal(fileExempt, false)
  assert.deepEqual(hits.map((h) => h.line), [3, 4, 5, 6])
})

test('scanCjk honors line and file i18n-allow exemptions', () => {
  const lineExempt = "const re = /模型|Model/ // i18n-allow: matches official zh cell text"
  assert.deepEqual(scanCjk(lineExempt).hits, [])
  const fileExempt = ['// i18n-allow: generated fixture', "const s = '中文'"].join('\n')
  const { hits, fileExempt: exempt } = scanCjk(fileExempt)
  assert.equal(exempt, true)
  assert.deepEqual(hits, [])
})

test('placeholdersOf collects unique sorted placeholder names', () => {
  assert.deepEqual(placeholdersOf('{b} 中 {a} 与 {a}'), ['a', 'b'])
  assert.deepEqual(placeholdersOf('no placeholders'), [])
})

test('diffKeySets reports both directions sorted', () => {
  const diff = diffKeySets({ b: '2', a: '1', c: '3' }, { b: '2', d: '4' })
  assert.deepEqual(diff.missingInB, ['a', 'c'])
  assert.deepEqual(diff.missingInA, ['d'])
})

test('diffPlaceholders compares placeholder sets per shared key', () => {
  const issues = diffPlaceholders(
    { k: '{count} 个 ≥ {max}', ok: '静态' },
    { k: '{count} items', ok: 'static' },
  )
  assert.equal(issues.length, 1)
  assert.deepEqual(issues[0].onlyA, ['max'])
  assert.deepEqual(issues[0].onlyB, [])
})

test('deriveNamespace resolves identifier via const table or entry declaration', () => {
  assert.equal(deriveNamespace("ctx.locale.register(NS, { zh, en })", { NS: 'pet' }), 'pet')
  assert.equal(deriveNamespace("const NS = 'dsh-perf'\nctx.locale.register(NS, merged)", {}), 'dsh-perf')
  assert.equal(deriveNamespace("ctx.locale.register('web-ui-plugins', { zh, en })", {}), 'web-ui-plugins')
  assert.equal(deriveNamespace('ctx.slots.inject("x", () => {})', {}), undefined)
})
