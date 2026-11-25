'use strict'

/**
 * Official DSH Plugin Market Index Format 1 generator
 * (`@deepseek-ai/dsh-plugin-market-index` contract).
 *
 * Emits `market/dist/manifest/plugin-market-index.json` so DSH 0.2.3-alpha.2+
 * users can subscribe to `https://dsh-market.com/manifest/plugin-market-index.json`
 * directly from the official Plugins -> Discover page.
 *
 * Rules enforced here:
 * - Only packages with an exact SemVer version are emitted (never fabricate a
 *   placeholder version such as 0.0.0 that would fail `pnpm add name@version`).
 * - Every declared category / label / sortKey id is closed against `metadata`.
 * - `publishTimestamp` derives deterministically from the build date so
 *   `market:check` stays reproducible.
 */

const fs = require('node:fs')
const path = require('node:path')

const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const NUMERIC = '(?:0|[1-9]\\d*)'
const PRERELEASE_PART = `(?:${NUMERIC}|\\d*[a-zA-Z-][0-9a-zA-Z-]*)`
const SEMVER_RE = new RegExp(
  `^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-${PRERELEASE_PART}(?:\\.${PRERELEASE_PART})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
  'u',
)

const DEFAULT_REPO_URL = 'https://github.com/zhu1090093659/dsh-web'

/** Largest decoded payload of an inline `data:` icon the format accepts, in bytes. */
const MAX_INLINE_ICON_BYTES = 32 * 1024

/**
 * Read a package's own `icon.svg` as an inline `data:` URL.
 *
 * The format resolves a relative icon against the index URL and caps an inline
 * payload at 32 KiB; every family package ships a 1-4 KiB SVG, so inlining keeps
 * the artwork offline and independent of the market site's asset layout.
 * @param pkgDir - directory holding the package.json that was just read.
 * @returns the data URL, or undefined when the package has no usable icon.
 */
function readInlineIcon(pkgDir) {
  const filePath = path.join(pkgDir, 'icon.svg')
  if (!fs.existsSync(filePath)) return undefined
  const svg = fs.readFileSync(filePath)
  if (svg.length === 0 || svg.length > MAX_INLINE_ICON_BYTES) return undefined
  return 'data:image/svg+xml;base64,' + svg.toString('base64')
}

const CATEGORY_DECLARATIONS = {
  bundle: { title: { en: 'Bundles', zh: '全家桶与整合包' } },
  ui: { title: { en: 'UI & Interface', zh: '界面与交互' } },
  tools: { title: { en: 'Tools & Productivity', zh: '工具与效率' } },
  knowledge: { title: { en: 'Knowledge & Skills', zh: '知识与技能' } },
  security: { title: { en: 'Security & Remote', zh: '安全与远程' } },
  other: { title: { en: 'Other', zh: '其他' } },
}

const LABEL_DECLARATIONS = {
  family: { title: { en: 'dsh-web Family', zh: 'dsh-web 家族' } },
  community: { title: { en: 'Community', zh: '社区插件' } },
}

const SORT_KEY_DECLARATIONS = {
  rank: { title: { en: 'Featured', zh: '推荐排序' }, order: 'asc' },
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return undefined
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return undefined
  }
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function cleanHttpUrl(value) {
  const text = cleanText(value)
  if (!text) return undefined
  const stripped = text.replace(/^git\+/i, '').replace(/\.git$/i, '')
  try {
    const url = new URL(stripped)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (url.username !== '' || url.password !== '') return undefined
    if (url.href.includes('?') || url.href.includes('#')) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function normalizeCategory(raw) {
  return typeof raw === 'string' && Object.hasOwn(CATEGORY_DECLARATIONS, raw) ? raw : 'other'
}

function inferFamilyCategory(dirName) {
  if (dirName === 'dsh-web-all') return 'bundle'
  if (dirName === 'dsh-remote-bridge') return 'security'
  if (dirName === 'dsh-skill-explorer' || dirName === 'dsh-liangshen' || dirName === 'dsh-agents') return 'knowledge'
  if (
    dirName === 'dsh-ssh'
    || dirName === 'dsh-win-bash'
    || dirName === 'dsh-browser-view'
    || dirName === 'dsh-task-board'
    || dirName.startsWith('dsh-task-board-')
    || dirName === 'dsh-plugin-manager'
    || dirName === 'dsh-session-archive'
  ) {
    return 'tools'
  }
  return 'ui'
}

function parseTimestampSeconds(dateStr) {
  const ms = Date.parse(`${dateStr}T00:00:00Z`)
  if (!Number.isFinite(ms) || ms < 0) return 0
  return Math.floor(ms / 1000)
}

function readLocalizedMeta(pkgDir, pkg) {
  const enLocale = readJsonIfExists(path.join(pkgDir, 'locale', 'en.json'))
  const zhLocale = readJsonIfExists(path.join(pkgDir, 'locale', 'zh.json'))
  const enTitle = cleanText(enLocale?.meta?.title) ?? cleanText(pkg.name)
  const zhTitle = cleanText(zhLocale?.meta?.title)
  const enDesc = cleanText(enLocale?.meta?.description) ?? cleanText(pkg.description)
  const zhDesc = cleanText(zhLocale?.meta?.description)
  const title = zhTitle && zhTitle !== enTitle ? { en: enTitle, zh: zhTitle } : { en: enTitle }
  const description = enDesc
    ? (zhDesc && zhDesc !== enDesc ? { en: enDesc, zh: zhDesc } : { en: enDesc })
    : undefined
  return { title, description }
}

function scanFamilyMarketPackages(rootDir) {
  const packagesDir = path.join(rootDir, 'packages')
  if (!fs.existsSync(packagesDir)) return []
  const dirs = fs.readdirSync(packagesDir).sort()
  const found = []
  for (const dirName of dirs) {
    const pkgDir = path.join(packagesDir, dirName)
    const pkgPath = path.join(pkgDir, 'package.json')
    const pkg = readJsonIfExists(pkgPath)
    if (!pkg || pkg.private === true) continue
    if (!pkg.dsh?.bundle?.patch) continue
    const name = cleanText(pkg.name)
    const version = cleanText(pkg.version)
    if (!name || !PACKAGE_NAME_RE.test(name) || !version || !SEMVER_RE.test(version)) continue
    const dshRange = cleanText(pkg.dsh?.engines?.dsh)
    const { title, description } = readLocalizedMeta(pkgDir, pkg)
    const repoUrl = cleanHttpUrl(typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) ?? DEFAULT_REPO_URL
    found.push({
      dirName,
      name,
      version,
      dshRange: dshRange && !dshRange.startsWith('workspace:') ? dshRange : undefined,
      title,
      description,
      icon: readInlineIcon(pkgDir),
      repository: { url: repoUrl, directory: `packages/${dirName}` },
      category: inferFamilyCategory(dirName),
    })
  }
  // Place the aggregate bundle first so official Discover surfaces it prominently.
  found.sort((a, b) => {
    if (a.dirName === 'dsh-web-all') return -1
    if (b.dirName === 'dsh-web-all') return 1
    return a.name.localeCompare(b.name)
  })
  return found
}

/**
 * Build an official DSH Plugin Market Index Format 1 document.
 * @param {{ rootDir: string, communityPlugins?: readonly Record<string, unknown>[], generatedDate: string }} options
 */
function buildPluginMarketIndex({ rootDir, communityPlugins = [], generatedDate }) {
  const publishTimestamp = parseTimestampSeconds(generatedDate)
  const communityByNpm = new Map()
  for (const entry of communityPlugins) {
    const npmName = cleanText(entry?.npm)
    if (npmName) communityByNpm.set(npmName, entry)
  }

  const plugins = []
  const seenNames = new Set()
  let rank = 1

  for (const pkg of scanFamilyMarketPackages(rootDir)) {
    if (seenNames.has(pkg.name)) continue
    seenNames.add(pkg.name)
    const communityMatch = communityByNpm.get(pkg.name)
    const category = communityMatch?.category ? normalizeCategory(communityMatch.category) : pkg.category
    const entry = {
      name: pkg.name,
      title: pkg.title,
      ...(pkg.description ? { description: pkg.description } : {}),
      ...(pkg.icon ? { icon: pkg.icon } : {}),
      author: 'zhu1090093659',
      repository: pkg.repository,
      metadata: {
        category,
        keywords: [pkg.dirName, 'dsh-web'],
        labels: ['family'],
        sortKeys: { rank: rank++ },
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp,
          source: { type: 'npm' },
          ...(pkg.dshRange ? { engines: { dsh: pkg.dshRange } } : {}),
        },
      ],
    }
    plugins.push(entry)
  }

  // Include community.json plugins that declare an explicit, valid exact SemVer version.
  for (const item of communityPlugins) {
    const name = cleanText(item?.npm)
    const version = cleanText(item?.version)
    if (!name || !PACKAGE_NAME_RE.test(name) || seenNames.has(name)) continue
    if (!version || !SEMVER_RE.test(version)) continue
    seenNames.add(name)
    const enTitle = cleanText(item.nameEn) ?? cleanText(item.name) ?? name
    const zhTitle = cleanText(item.name)
    const title = zhTitle && zhTitle !== enTitle ? { en: enTitle, zh: zhTitle } : { en: enTitle }
    const enDesc = cleanText(item.descriptionEn) ?? cleanText(item.description)
    const zhDesc = cleanText(item.description)
    const description = enDesc
      ? (zhDesc && zhDesc !== enDesc ? { en: enDesc, zh: zhDesc } : { en: enDesc })
      : undefined
    const author = cleanText(item.author)
    const repoUrl = cleanHttpUrl(item.repo)
    const dshRange = cleanText(item.enginesDsh ?? item.dshRange)
    const itemTs = typeof item.publishTimestamp === 'number' && Number.isInteger(item.publishTimestamp) && item.publishTimestamp >= 0
      ? item.publishTimestamp
      : publishTimestamp
    plugins.push({
      name,
      title,
      ...(description ? { description } : {}),
      ...(author ? { author } : {}),
      ...(repoUrl ? { repository: { url: repoUrl } } : {}),
      metadata: {
        category: normalizeCategory(item.category),
        keywords: item.subcategory ? [String(item.subcategory)] : [],
        labels: ['community'],
        sortKeys: { rank: rank++ },
      },
      versions: [
        {
          version,
          publishTimestamp: itemTs,
          source: { type: 'npm' },
          ...(dshRange && !dshRange.startsWith('workspace:') ? { engines: { dsh: dshRange } } : {}),
        },
      ],
    })
  }

  return {
    format: 1,
    title: {
      en: 'DSH Community Workshop',
      zh: 'DSH 社区创意工坊',
    },
    description: {
      en: 'DeepSeek Harness Web GUI family plugins and versioned community packages from dsh-market.com.',
      zh: '来自 dsh-market.com 的 DeepSeek Harness Web GUI 家族插件与带版本社区插件索引。',
    },
    metadata: {
      categories: CATEGORY_DECLARATIONS,
      labels: LABEL_DECLARATIONS,
      sortKeys: SORT_KEY_DECLARATIONS,
    },
    plugins,
  }
}

module.exports = {
  buildPluginMarketIndex,
  scanFamilyMarketPackages,
}
