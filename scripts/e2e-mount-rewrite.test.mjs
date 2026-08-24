/**
 * e2e-mount-rewrite contract: auto mode keeps npm-published family
 * dependencies on the registry and rewrites only unpublished ones to local
 * file: tarballs (the push-to-publish window fix); the manual family-dir
 * override still rewrites everything; a dependency that is unpublished and
 * missing from the workspace fails loudly.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { rewriteDependencies, findWorkspacePackage, packWorkspace } from './e2e-mount-rewrite'

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-rewrite-test-'))
}

function writePkg(dir, body) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'package.json')
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n')
  return file
}

function makeWorkspace(root) {
  writePkg(path.join(root, 'packages', 'dsh-a'), { name: '@linxin666/dsh-a', version: '0.1.0' })
  writePkg(path.join(root, 'packages', 'dsh-b'), { name: '@linxin666/dsh-b', version: '0.2.0' })
  writePkg(path.join(root, 'packages', 'skins', 'skin-x'), { name: '@linxin666/dsh-skin-x', version: '0.1.0' })
}

function makeTarballPkg(dir) {
  return writePkg(dir, {
    name: '@linxin666/dsh-web-all',
    version: '9.9.9',
    dependencies: {
      '@linxin666/dsh-a': '0.1.0',
      '@linxin666/dsh-b': '0.2.0',
      'dsh-better-sidebar': '0.13.0',
      react: '^18.3.1',
    },
  })
}

function makeTgz(dir, pkgBody) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tgz-stage-'))
  writePkg(path.join(staging, 'package'), pkgBody)
  const tgz = path.join(dir, pkgBody.name.split('/').pop() + '.tgz')
  execFileSync('tar', ['-czf', tgz, '-C', staging, 'package'])
  fs.rmSync(staging, { recursive: true, force: true })
  return tgz
}

/** A pack fake: pack the workspace package.json as a real tarball. */
function packFake(packed) {
  return (dir, outDir) => {
    packed.push(dir)
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return makeTgz(outDir, pkg)
  }
}

/** Read the package.json embedded in a tarball. */
function readTgzPkg(tgz) {
  const raw = execFileSync('tar', ['-xzf', tgz, '-O', 'package/package.json'], { stdio: 'pipe' }).toString()
  return JSON.parse(raw)
}

test('auto mode: published deps stay on npm, unpublished deps rewrite to file:', async () => {
  const tmp = makeTmp()
  const root = path.join(tmp, 'repo')
  makeWorkspace(root)
  const pkgPath = makeTarballPkg(path.join(tmp, 'tarball'))
  const published = new Set(['@linxin666/dsh-a@0.1.0'])
  const packed = []
  const report = await rewriteDependencies({
    pkgPath,
    root,
    checkPublished: async (name, version) => published.has(name + '@' + version),
    pack: packFake(packed),
  })
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  assert.equal(pkg.dependencies['@linxin666/dsh-a'], '0.1.0')
  assert.match(pkg.dependencies['@linxin666/dsh-b'], /^file:.*dsh-b\.tgz$/)
  assert.equal(pkg.dependencies['react'], '^18.3.1')
  assert.equal(pkg.dependencies['dsh-better-sidebar'], '0.13.0')
  assert.equal(packed.length, 1)
  assert.match(packed[0], /dsh-b$/)
  assert.ok(report.some(line => line.includes('npm 已发布')))
  assert.ok(report.some(line => line.includes('npm 未发布')))
})

test('auto mode: two unpublished deps rewrite to distinct tarballs', async () => {
  const tmp = makeTmp()
  const root = path.join(tmp, 'repo')
  makeWorkspace(root)
  const pkgPath = makeTarballPkg(path.join(tmp, 'tarball'))
  const packed = []
  const report = await rewriteDependencies({
    pkgPath,
    root,
    checkPublished: async () => false,
    pack: packFake(packed),
  })
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const tgzA = pkg.dependencies['@linxin666/dsh-a']
  const tgzB = pkg.dependencies['@linxin666/dsh-b']
  assert.match(tgzA, /^file:.*dsh-a\.tgz$/)
  assert.match(tgzB, /^file:.*dsh-b\.tgz$/)
  assert.notEqual(tgzA, tgzB)
  assert.equal(packed.length, 2)
  assert.ok(report.every(line => line.includes('npm 未发布')))
})

test('auto mode: pack returning the same tarball twice fails loudly', async () => {
  const tmp = makeTmp()
  const root = path.join(tmp, 'repo')
  makeWorkspace(root)
  const pkgPath = makeTarballPkg(path.join(tmp, 'tarball'))
  let first = null
  await assert.rejects(
    rewriteDependencies({
      pkgPath,
      root,
      checkPublished: async () => false,
      pack: (dir, outDir) => {
        if (first !== null) return first
        first = makeTgz(outDir, { name: '@linxin666/dsh-a', version: '0.1.0' })
        return first
      },
    }),
    /已占用的 tarball/,
  )
})

test('packWorkspace: two packs into the same parent dir stay distinct', () => {
  const tmp = makeTmp()
  const a = path.join(tmp, 'dsh-a')
  const b = path.join(tmp, 'dsh-b')
  writePkg(a, { name: '@linxin666/dsh-a', version: '0.0.0-test' })
  writePkg(b, { name: '@linxin666/dsh-b', version: '0.0.0-test' })
  const outDir = path.join(tmp, 'out')
  fs.mkdirSync(outDir)
  const tgzA = packWorkspace(a, outDir)
  const tgzB = packWorkspace(b, outDir)
  assert.notEqual(tgzA, tgzB)
  assert.match(tgzA, /dsh-a/)
  assert.match(tgzB, /dsh-b/)
  assert.equal(fs.readdirSync(path.dirname(tgzA)).filter(name => name.endsWith('.tgz')).length, 1)
  assert.equal(fs.readdirSync(path.dirname(tgzB)).filter(name => name.endsWith('.tgz')).length, 1)
})

test('auto mode: default packWorkspace packs and patches unpublished deps', async () => {
  const tmp = makeTmp()
  const root = path.join(tmp, 'repo')
  makeWorkspace(root)
  const pkgPath = makeTarballPkg(path.join(tmp, 'tarball'))
  await rewriteDependencies({
    pkgPath,
    root,
    checkPublished: async () => false,
  })
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  assert.match(pkg.dependencies['@linxin666/dsh-b'], /^file:.*dsh-b.*\.tgz$/)
  // The packed tarball is a real tar and survives the in-place patch.
  assert.equal(JSON.parse(execFileSync('tar', ['-xzf', pkg.dependencies['@linxin666/dsh-b'].slice(5), '-O', 'package/package.json'], { stdio: 'pipe' }).toString()).name, '@linxin666/dsh-b')
})

test('auto mode: unpublished dep missing from the workspace fails loudly', async () => {
  const tmp = makeTmp()
  const root = path.join(tmp, 'repo')
  fs.mkdirSync(path.join(root, 'packages'), { recursive: true })
  const pkgPath = makeTarballPkg(path.join(tmp, 'tarball'))
  await assert.rejects(
    rewriteDependencies({ pkgPath, root, checkPublished: async () => false }),
    /找不到 workspace 包/,
  )
})

test('auto mode: unpublished private workspace dep fails loudly (never publishable)', async () => {
  const tmp = makeTmp()
  const root = path.join(tmp, 'repo')
  makeWorkspace(root)
  writePkg(path.join(root, 'packages', 'dsh-private'), {
    name: '@linxin666/dsh-private',
    version: '0.1.0',
    private: true,
  })
  const pkgPath = writePkg(path.join(tmp, 'tarball'), {
    name: '@linxin666/dsh-web-all',
    version: '9.9.9',
    dependencies: { '@linxin666/dsh-private': '0.1.0' },
  })
  await assert.rejects(
    rewriteDependencies({ pkgPath, root, checkPublished: async () => false }),
    /private（永远不会发布）/,
  )
})

test('family-dir mode: every family dep rewrites to a patched same-named copy', async () => {
  const tmp = makeTmp()
  const familyDir = path.join(tmp, 'family')
  fs.mkdirSync(familyDir, { recursive: true })
  const tgzA = makeTgz(familyDir, { name: '@linxin666/dsh-a', version: '0.1.0' })
  const tgzB = makeTgz(familyDir, { name: '@linxin666/dsh-b', version: '0.2.0' })
  const pkgPath = makeTarballPkg(path.join(tmp, 'tarball'))
  await rewriteDependencies({ pkgPath, root: tmp, familyDir })
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const fileA = pkg.dependencies['@linxin666/dsh-a']
  const fileB = pkg.dependencies['@linxin666/dsh-b']
  assert.match(fileA, /^file:.*dsh-a\.tgz$/)
  assert.match(fileB, /^file:.*dsh-b\.tgz$/)
  assert.notEqual(fileA, 'file:' + tgzA)
  assert.notEqual(fileB, 'file:' + tgzB)
  assert.equal(fs.existsSync(fileA.slice(5)), true)
  assert.equal(fs.existsSync(fileB.slice(5)), true)
  assert.equal(pkg.dependencies['react'], '^18.3.1')
})

test('family-dir mode: missing tarball fails loudly', async () => {
  const tmp = makeTmp()
  const familyDir = path.join(tmp, 'family')
  fs.mkdirSync(familyDir, { recursive: true })
  makeTgz(familyDir, { name: '@linxin666/dsh-a', version: '0.1.0' })
  const pkgPath = makeTarballPkg(path.join(tmp, 'tarball'))
  await assert.rejects(
    rewriteDependencies({ pkgPath, root: tmp, familyDir }),
    /缺少本地 tarball/,
  )
})

test('better-sidebar manual override rewrites only that dep', async () => {
  const tmp = makeTmp()
  const pkgPath = makeTarballPkg(path.join(tmp, 'tarball'))
  const published = new Set(['@linxin666/dsh-a@0.1.0', '@linxin666/dsh-b@0.2.0'])
  await rewriteDependencies({
    pkgPath,
    root: tmp,
    betterSidebarTgz: '/tmp/bs.tgz',
    checkPublished: async (name, version) => published.has(name + '@' + version),
  })
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  assert.equal(pkg.dependencies['dsh-better-sidebar'], 'file:/tmp/bs.tgz')
  assert.equal(pkg.dependencies['@linxin666/dsh-a'], '0.1.0')
})

test('auto mode: nested unpublished family deps rewrite inside the packed tarball', async () => {
  const tmp = makeTmp()
  const root = path.join(tmp, 'repo')
  makeWorkspace(root)
  // dsh-b depends on the unpublished skin-x: the nested edge must be
  // rewritten inside the packed dsh-b tarball (dsh-skins -> skin-center).
  writePkg(path.join(root, 'packages', 'dsh-b'), {
    name: '@linxin666/dsh-b',
    version: '0.2.0',
    dependencies: { '@linxin666/dsh-skin-x': '0.1.0' },
  })
  const pkgPath = writePkg(path.join(tmp, 'tarball'), {
    name: '@linxin666/dsh-web-all',
    version: '9.9.9',
    dependencies: {
      '@linxin666/dsh-a': '0.1.0',
      '@linxin666/dsh-b': '0.2.0',
      '@linxin666/dsh-skin-x': '0.1.0',
    },
  })
  const packed = []
  await rewriteDependencies({
    pkgPath,
    root,
    checkPublished: async () => false,
    pack: packFake(packed),
  })
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const fileB = pkg.dependencies['@linxin666/dsh-b'].slice(5)
  const fileX = pkg.dependencies['@linxin666/dsh-skin-x'].slice(5)
  // The nested dep resolves to the same patched skin-x tarball the aggregate uses.
  assert.equal(readTgzPkg(fileB).dependencies['@linxin666/dsh-skin-x'], 'file:' + fileX)
  // skin-x is packed exactly once and shared by both edges.
  assert.equal(packed.length, 3)
})

test('family-dir mode: nested family deps rewrite inside the patched copies', async () => {
  const tmp = makeTmp()
  const familyDir = path.join(tmp, 'family')
  fs.mkdirSync(familyDir, { recursive: true })
  makeTgz(familyDir, { name: '@linxin666/dsh-a', version: '0.1.0' })
  makeTgz(familyDir, {
    name: '@linxin666/dsh-b',
    version: '0.2.0',
    dependencies: { '@linxin666/dsh-a': '0.1.0' },
  })
  const pkgPath = makeTarballPkg(path.join(tmp, 'tarball'))
  await rewriteDependencies({ pkgPath, root: tmp, familyDir })
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const fileB = pkg.dependencies['@linxin666/dsh-b'].slice(5)
  const fileA = pkg.dependencies['@linxin666/dsh-a'].slice(5)
  assert.equal(readTgzPkg(fileB).dependencies['@linxin666/dsh-a'], 'file:' + fileA)
})

test('findWorkspacePackage scans packages/ and packages/skins/', () => {
  const tmp = makeTmp()
  makeWorkspace(tmp)
  assert.match(findWorkspacePackage(tmp, '@linxin666/dsh-a'), /packages[/\\]dsh-a$/)
  assert.match(findWorkspacePackage(tmp, '@linxin666/dsh-skin-x'), /packages[/\\]skins[/\\]skin-x$/)
  assert.equal(findWorkspacePackage(tmp, '@linxin666/nope'), null)
})

