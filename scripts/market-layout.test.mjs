/**
 * market 产物结构回归：验证 market-build 生成的三类清单可解析、字段契约完整、
 * 所有被引用的资产路径都真实存在于 dist（避免预览图/精灵表 404）。
 * 纯结构断言（不渲染页面），任何环境可跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../market/dist', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(DIST, rel), 'utf8'))
}
const exists = (rel) => fs.existsSync(path.join(DIST, rel))

test('market/dist 核心文件齐全', () => {
  for (const f of ['index.html', 'app.js', 'preview.html', 'styles.js', 'manifest.js', '_headers', 'official-facade.js']) {
    assert.ok(exists(f), f + ' missing')
  }
  for (const f of ['skins.json', 'pets.json', 'plugins.json', 'presets.json', 'editor-picks.json']) {
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
    const skinJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', 'skins', 'skin-center', 'skins', item.id, 'skin.json'), 'utf8'))
    if (skinJson.sourceUrl) {
      assert.equal(item.repo, skinJson.sourceUrl, 'skin repo must mirror sourceUrl: ' + item.id)
    } else {
      assert.equal(item.repo, `https://github.com/zhu1090093659/dsh-web/tree/dev/packages/skins/skin-center/skins/${item.id}`, 'skin repo must point to catalog source: ' + item.id)
    }
    assert.ok(/^https:\/\//.test(item.repo), 'skin repo must be https: ' + item.id)
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
    // frames2d pets (directory frame sequences, e.g. miku) ship no
    // spritesheet: the card rides the previews and the installer downloads
    // the whole files list.
    if (item.renderer === 'frames2d') {
      assert.ok(Array.isArray(item.files) && item.files.length > 0, 'frames2d pet files: ' + item.id)
      assert.ok(Array.isArray(item.previews) && item.previews.length > 0, 'frames2d pet previews: ' + item.id)
    } else {
      assert.ok(exists(item.spritesheet), 'spritesheet missing: ' + item.spritesheet)
    }
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
    // Second-level classification: every categorized plugin carries a
    // subcategory; the 'other' bucket (uncategorized) keeps none.
    if (item.category === 'other') {
      assert.equal(item.subcategory, undefined, 'other plugins have no subcategory: ' + item.id)
    } else {
      assert.ok(typeof item.subcategory === 'string' && item.subcategory, 'plugin subcategory: ' + item.id)
    }
    if (item.repo) assert.ok(/^https:\/\//.test(item.repo), 'plugin repo must be https: ' + item.id)
  }
})

test('presets.json 契约', () => {
  const m = readJson('manifest/presets.json')
  assert.ok(Array.isArray(m.items), 'presets items array')
  const ids = new Set()
  for (const item of m.items) {
    assert.ok(item.id && /^[a-z0-9][a-z0-9-]*$/.test(item.id), 'preset id rule: ' + item.id)
    assert.ok(item.name, 'preset name from preset.yml: ' + item.id)
    assert.equal(typeof item.rank, 'number', 'preset rank: ' + item.id)
    assert.ok(Array.isArray(item.files) && item.files.length > 0, 'preset files: ' + item.id)
    assert.ok(item.files.includes('agent.cordis.yml'), 'preset composition must ship: ' + item.id)
    // Category drives the workshop/site filter pills; omitted entries land in 'other'.
    assert.ok(typeof item.category === 'string' && item.category, 'preset category: ' + item.id)
    assert.ok(!ids.has(item.id), 'duplicate preset id: ' + item.id)
    ids.add(item.id)
    if (item.repo) assert.ok(/^https:\/\//.test(item.repo), 'preset repo must be https: ' + item.id)
    for (const rel of item.files) assert.ok(exists('assets/presets/' + item.id + '/' + rel), 'preset asset missing: ' + item.id + '/' + rel)
  }
})

test('预设分区由市场站渲染', () => {
  const app = fs.readFileSync(path.join(DIST, 'app.js'), 'utf8')
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
  assert.ok(html.includes('data-kind="preset"'), 'preset tab missing from the site markup')
  assert.ok(app.includes("preset: '预设'"), 'preset kind label missing')
  assert.ok(app.includes("fetchJson('manifest/presets.json')"), 'preset manifest fetch missing')
  assert.ok(app.includes("roleplay: '角色扮演'"), 'preset category label missing')
})

test('编辑推荐分区由市场站渲染固定清单', () => {
  const app = fs.readFileSync(path.join(DIST, 'app.js'), 'utf8')
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
  assert.ok(html.includes('data-kind="picks"'), 'editor-picks tab missing from the site markup')
  assert.ok(app.includes("picks: '编辑推荐'"), 'editor-picks kind label missing')
  assert.ok(app.includes("fetchJson('manifest/editor-picks.json')"), 'editor-picks manifest fetch missing')
  assert.ok(app.includes('function pickEntries()'), 'editor-picks resolver missing')
})

test('皮肤与插件卡片名称以源码仓库链接渲染', () => {
  const app = fs.readFileSync(path.join(DIST, 'app.js'), 'utf8')
  assert.ok(app.includes("el('a', 'mk-card-name'"), 'card name must be an anchor for repo-backed items')
  assert.ok(app.includes('name.href = item.repo'), 'card name anchor must point at item.repo')
})

test('宠物卡片预览完整居中且不裁切', () => {
  const app = fs.readFileSync(path.join(DIST, 'app.js'), 'utf8')
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
  assert.ok(app.includes("media.classList.add('mk-card-media-pet')"), 'pet media class missing')
  assert.ok(html.includes('max-height: calc(100% - 16px);'), 'pet contain rule missing')
})

test('editor-picks.json 固定清单只引用真实存在的皮肤 / 宠物 / 插件', () => {
  const picks = readJson('manifest/editor-picks.json')
  assert.ok(Array.isArray(picks.items) && picks.items.length > 0, 'editor picks empty')
  const catalogs = {
    skin: new Set(readJson('manifest/skins.json').items.map((i) => i.id)),
    pet: new Set(readJson('manifest/pets.json').items.map((i) => i.id)),
    plugin: new Set(readJson('manifest/plugins.json').items.map((i) => i.id)),
  }
  const seen = new Set()
  for (const pick of picks.items) {
    assert.ok(catalogs[pick.kind], 'editor pick kind must be skin / pet / plugin: ' + pick.kind)
    assert.ok(catalogs[pick.kind].has(pick.id), 'editor pick target missing: ' + pick.kind + ':' + pick.id)
    const key = pick.kind + ':' + pick.id
    assert.ok(!seen.has(key), 'duplicate editor pick: ' + key)
    seen.add(key)
  }
})

test('editor-picks.json 与手写清单顺序一致', () => {
  const source = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'market', 'editor-picks.json'), 'utf8'))
  const emitted = readJson('manifest/editor-picks.json')
  assert.deepEqual(emitted.items, source.items.map(({ kind, id }) => ({ kind, id })))
})

test('styles.js 为全部皮肤生成 SKIN_STYLES', () => {
  const skins = readJson('manifest/skins.json').items
  const text = fs.readFileSync(path.join(DIST, 'styles.js'), 'utf8')
  for (const s of skins) {
    assert.ok(text.includes('"' + s.id + '"'), 'styles.js missing skin: ' + s.id)
  }
})
