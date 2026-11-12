/**
 * Plugin display metadata gate. The host's official plugin list renders each
 * plugin's title and grey description from <specifier>/locale/<lang>.json
 * (meta.title / meta.description) and its card icon from package.json "icon".
 * readPluginMeta resolves <specifier>/locale/en.json first, then enumerates
 * every *.json in that directory and resolves each one through the package's
 * own exports map, so the files on disk and the "./locale/<lang>.json" exports
 * keys have to correspond one to one. A file without its key, or a key without
 * its file, makes the whole metadata read fail and the entry silently falls
 * back to the npm package name with no description and no icon. That fallback
 * is invisible in review, which is why this gate exists: every package in
 * packages/ must carry the copy and the icon the plugin page needs, or this
 * test goes red instead of the product.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(SCRIPT_DIR, '..')
const PACKAGES_DIR = join(ROOT, 'packages')

/** Languages the plugin page requires; ru and friends are optional extras. */
const REQUIRED_LANGUAGES = ['en', 'zh']
const LOCALE_EXPORT_PREFIX = './locale/'
const ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])
const MAX_ICON_BYTES = 256 * 1024
const MAX_ZH_DESCRIPTION_HAN = 20
const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu

/** Every directory under packages/ that carries a package.json manifest. */
function packageDirs() {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PACKAGES_DIR, entry.name))
    .filter((dir) => existsSync(join(dir, 'package.json')))
    .sort()
}

function relOf(dir) {
  return relative(ROOT, dir).replaceAll('\\', '/')
}

function readJson(abs, label) {
  let raw
  try {
    raw = readFileSync(abs, 'utf8')
  } catch (error) {
    assert.fail(`${label} must be readable: ${error.message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (error) {
    assert.fail(`${label} must be valid JSON: ${error.message}`)
  }
}

/** Package-relative form of an exports value or a files entry. */
function normalizeEntry(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

/** The *.json files actually present in one package's locale directory. */
function localeFilesOnDisk(dir) {
  const localeDir = join(dir, 'locale')
  if (!existsSync(localeDir)) return []
  return readdirSync(localeDir).filter((name) => name.endsWith('.json')).sort()
}

test('each package locale directory and exports map agree on one file per language', () => {
  const dirs = packageDirs()
  assert.ok(dirs.length >= 20, `expected to scan the plugin packages under packages/, found ${dirs.length}`)
  for (const dir of dirs) {
    const rel = relOf(dir)
    const manifest = readJson(join(dir, 'package.json'), `${rel}/package.json`)
    for (const lang of REQUIRED_LANGUAGES) {
      assert.ok(
        existsSync(join(dir, 'locale', `${lang}.json`)),
        `${rel} must ship locale/${lang}.json: the host resolves locale/en.json first and the plugin page falls back to the npm package name without it`,
      )
    }
    const onDisk = new Set(localeFilesOnDisk(dir))
    const exported = new Set(
      Object.keys(manifest.exports ?? {})
        .filter((key) => key.startsWith(LOCALE_EXPORT_PREFIX))
        .map((key) => normalizeEntry(key.slice(LOCALE_EXPORT_PREFIX.length))),
    )
    for (const file of onDisk) {
      assert.ok(
        exported.has(file),
        `${rel} ships locale/${file} but package.json exports has no "${LOCALE_EXPORT_PREFIX}${file}" key, so readPluginMeta fails and the plugin page falls back to the npm package name`,
      )
    }
    for (const file of exported) {
      assert.ok(
        onDisk.has(file),
        `${rel} exports "${LOCALE_EXPORT_PREFIX}${file}" but locale/${file} is missing on disk, so readPluginMeta fails and the plugin page falls back to the npm package name`,
      )
    }
  }
})

test('every locale file carries only a non-empty meta title and description', () => {
  for (const dir of packageDirs()) {
    const rel = relOf(dir)
    for (const file of localeFilesOnDisk(dir)) {
      const label = `${rel}/locale/${file}`
      const doc = readJson(join(dir, 'locale', file), label)
      const extraKeys = Object.keys(doc).filter((key) => key !== 'meta')
      assert.deepEqual(extraKeys, [], `${label} must carry no top-level key besides "meta", found: ${extraKeys.join(', ')}`)
      const meta = doc.meta
      assert.ok(
        meta !== null && typeof meta === 'object' && !Array.isArray(meta),
        `${label} must declare a "meta" object holding title and description`,
      )
      for (const field of ['title', 'description']) {
        const value = meta[field]
        assert.equal(typeof value, 'string', `${label} meta.${field} must be a string, got ${typeof value}`)
        assert.ok(value.trim().length > 0, `${label} meta.${field} must not be empty`)
      }
    }
  }
})

test('zh copy differs from en copy and keeps its description short and Chinese', () => {
  for (const dir of packageDirs()) {
    const rel = relOf(dir)
    const metaOf = (lang) => readJson(join(dir, 'locale', `${lang}.json`), `${rel}/locale/${lang}.json`).meta
    const en = metaOf('en')
    const zh = metaOf('zh')
    assert.notEqual(zh.title, en.title, `${rel} locale/zh.json meta.title must differ from en title "${en.title}", it is rendered for Chinese users`)
    assert.notEqual(zh.description, en.description, `${rel} locale/zh.json meta.description must differ from the English description`)
    const han = zh.description.match(HAN_RE) ?? []
    assert.ok(han.length > 0, `${rel} locale/zh.json meta.description must contain Chinese characters, got "${zh.description}"`)
    assert.ok(
      han.length <= MAX_ZH_DESCRIPTION_HAN,
      `${rel} locale/zh.json meta.description carries ${han.length} Chinese characters, above the ${MAX_ZH_DESCRIPTION_HAN} the plugin card renders: "${zh.description}"`,
    )
  }
})

test('every package declares an in-package icon and ships it with locale in files', () => {
  for (const dir of packageDirs()) {
    const rel = relOf(dir)
    const manifest = readJson(join(dir, 'package.json'), `${rel}/package.json`)
    const icon = manifest.icon
    assert.equal(typeof icon, 'string', `${rel} package.json must declare a top-level "icon" path for the plugin card`)
    assert.ok(icon.trim().length > 0, `${rel} package.json "icon" must not be empty`)
    assert.ok(!isAbsolute(icon), `${rel} package.json "icon" must be a manifest-relative path, got the absolute path "${icon}"`)
    const iconPath = normalizeEntry(icon)
    const abs = resolve(dir, iconPath)
    const inside = relative(dir, abs)
    assert.ok(
      inside.length > 0 && !inside.startsWith('..') && !isAbsolute(inside),
      `${rel} package.json "icon" "${icon}" resolves outside the package directory`,
    )
    assert.ok(existsSync(abs), `${rel} declares icon "${icon}" but ${iconPath} does not exist in the package`)
    const stat = statSync(abs)
    assert.ok(stat.isFile(), `${rel} icon "${icon}" must be a regular file`)
    assert.ok(
      stat.size <= MAX_ICON_BYTES,
      `${rel} icon "${icon}" is ${stat.size} bytes, above the ${MAX_ICON_BYTES}-byte limit the host reads`,
    )
    assert.ok(
      ICON_EXTENSIONS.has(extname(iconPath).toLowerCase()),
      `${rel} icon "${icon}" must be one of svg, png, jpg, jpeg or webp`,
    )
    assert.ok(Array.isArray(manifest.files), `${rel} package.json must carry a "files" whitelist`)
    const files = new Set(manifest.files.map(normalizeEntry))
    assert.ok(
      files.has(iconPath),
      `${rel} package.json "files" must list the icon "${iconPath}" or npm drops it from the published tarball`,
    )
    assert.ok(
      files.has('locale'),
      `${rel} package.json "files" must list "locale" or npm drops the metadata the plugin page reads`,
    )
  }
})
