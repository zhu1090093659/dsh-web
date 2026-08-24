import test from 'node:test'
import assert from 'node:assert/strict'
import { checkRuntimeImports } from './runtime-deps-check.mjs'

test('flags a runtime import of a devDependencies-only package (issue #70)', () => {
  const violations = checkRuntimeImports(
    { dependencies: {}, devDependencies: { schemastery: '^3.18.0' } },
    { 'packages/skins/skin-center/lib/index.js': "import z from 'schemastery'" },
  )
  assert.equal(violations.length, 1)
  assert.equal(violations[0].specifier, 'schemastery')
})

test('accepts specifiers declared in dependencies', () => {
  const violations = checkRuntimeImports(
    { dependencies: { schemastery: '^3.18.0' } },
    { 'lib/index.js': "import z from 'schemastery'" },
  )
  assert.equal(violations.length, 0)
})

test('accepts runtime-provided @deepseek-ai/* specifiers', () => {
  const violations = checkRuntimeImports(
    { dependencies: {} },
    { 'lib/index.js': "import { Context } from '@deepseek-ai/cordis'" },
  )
  assert.equal(violations.length, 0)
})

test('accepts node: builtins and relative imports', () => {
  const violations = checkRuntimeImports(
    { dependencies: {} },
    { 'lib/index.js': "import { join } from 'node:path'\nimport x from './local.js'" },
  )
  assert.equal(violations.length, 0)
})

test('accepts package subpath imports when the parent package is a dependency', () => {
  const violations = checkRuntimeImports(
    { dependencies: { ssh2: '^1.17.0' } },
    { 'lib/index.js': "import { Client } from 'ssh2/lib/client'" },
  )
  assert.equal(violations.length, 0)
})

test('flags dynamic import() of a devDependencies-only package', () => {
  const violations = checkRuntimeImports(
    { dependencies: {} },
    { 'lib/index.js': "await import('some-optional-runtime-dep')" },
  )
  assert.equal(violations.length, 1)
  assert.equal(violations[0].specifier, 'some-optional-runtime-dep')
})

test('ignores prose that looks like an import inside comments', () => {
  const source = '/**\n * mtime; a root that appears later flips from \'missing\' to an mtime);\n */\nexport const x = 1\n'
  const violations = checkRuntimeImports({ dependencies: {} }, { 'lib/index.js': source })
  assert.equal(violations.length, 0)
})

test('ignores prose that looks like an import inside string and template literals', () => {
  const source = "export const a = \"flips from 'missing' to an mtime\"\nexport const b = `flips from 'missing' to an mtime`\nexport const c = 'flips from \"missing\" to an mtime'\n"
  const violations = checkRuntimeImports({ dependencies: {} }, { 'lib/index.js': source })
  assert.equal(violations.length, 0)
})

test('ignores property lookups named from or import', () => {
  const source = "const a = x.from('pkg-from')\nconst b = y.import('pkg-import')\n"
  const violations = checkRuntimeImports({ dependencies: {} }, { 'lib/index.js': source })
  assert.equal(violations.length, 0)
})

test('keeps flagging real imports next to comment prose', () => {
  const source = "// flips from 'missing' to an mtime\nimport { join } from 'node:path'\nimport x from 'missing-dep'\n"
  const violations = checkRuntimeImports({ dependencies: {} }, { 'lib/index.js': source })
  assert.equal(violations.length, 1)
  assert.equal(violations[0].specifier, 'missing-dep')
})
