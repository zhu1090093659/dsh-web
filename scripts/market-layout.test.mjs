/**
 * market 产物结构回归：验证 market-build 生成的三类清单可解析、字段契约完整、
 * 所有被引用的资产路径都真实存在于 dist（避免预览图/精灵表 404）。
 * 与 gallery-layout（浏览器渲染断言）不同，这里做纯结构断言，任何环境可跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../market/dist', import.meta.url))

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(DIST, rel), 'utf8'))
}
const exists = (rel) => fs.existsSync(path.join(DIST, rel))

test('market/dist 核心文件齐全', () => {
  for (const f of ['index.html', 'app.js', 'preview.html', 'styles.js', 'manifest.js', '_headers', 'official-facade.js']) {
    assert.ok(exists(f), f + ' missing')
  }
  for (const f of ['skins.json', 'pets.json', 'plugins.json']) {
    assert.ok(exists('manifest/' + f), 'manifest/' + f + ' missing')
  }
})

test('skins.json 契约与资产存在性', () => {
  const m = readJson('manifest/skins.json')
  assert.ok(Array.isArray(m.items) && m.items.length > 0, 'skins empty')
  const ids = new Set()
  for (const item of m.items) {
    assert.ok(item.id && item.name && item.nameEn && item.author, 'skin fields: ' + item.id)
    assert.equal(typeof item.rank, 'number', 'skin rank: ' + item.id)
    assert.ok(!ids.has(item.id), 'duplicate skin id: ' + item.id)
    ids.add(item.id)
    assert.ok(exists(item.preview.light), 'preview.light missing: ' + item.preview.light)
    assert.ok(exists(item.preview.dark), 'preview.dark missing: ' + item.preview.dark)
    const bg = item.contributes && item.contributes.backgroundMedia
    for (const mode of ['light', 'dark']) {
      const v = bg && bg[mode]
      if (v && v.src) assert.ok(exists(v.src), 'backgroundMedia missing: ' + v.src)
    }
  }
})

test('pets.json 契约与资产存在性', () => {
  const m = readJson('manifest/pets.json')
  assert.ok(Array.isArray(m.items), 'pets items array')
  for (const item of m.items) {
    assert.ok(item.id && item.displayName, 'pet fields: ' + item.id)
    assert.equal(typeof item.rank, 'number', 'pet rank: ' + item.id)
    assert.ok(exists(item.spritesheet), 'spritesheet missing: ' + item.spritesheet)
    for (const pv of item.previews || []) {
      assert.ok(exists(pv), 'pet preview missing: ' + pv)
    }
  }
  assert.ok(m.items.length > 0, 'pets should not be empty')
})

test('plugins.json 契约', () => {
  const m = readJson('manifest/plugins.json')
  assert.ok(Array.isArray(m.items) && m.items.length > 0, 'plugins empty')
  for (const item of m.items) {
    assert.ok(item.id && item.name, 'plugin fields: ' + item.id)
    assert.equal(typeof item.rank, 'number', 'plugin rank: ' + item.id)
    assert.ok(typeof item.category === 'string' && item.category, 'plugin category: ' + item.id)
  }
})

test('宠物卡片预览完整居中且不裁切', () => {
  const app = fs.readFileSync(path.join(DIST, 'app.js'), 'utf8')
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
  assert.ok(app.includes("media.classList.add('mk-card-media-pet')"), 'pet media class missing')
  assert.ok(html.includes('max-height: calc(100% - 16px);'), 'pet contain rule missing')
})

test('styles.js 为全部皮肤生成 SKIN_STYLES', () => {
  const skins = readJson('manifest/skins.json').items
  const text = fs.readFileSync(path.join(DIST, 'styles.js'), 'utf8')
  for (const s of skins) {
    assert.ok(text.includes('"' + s.id + '"'), 'styles.js missing skin: ' + s.id)
  }
})
