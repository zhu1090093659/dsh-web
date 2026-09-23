#!/usr/bin/env node
/**
 * Snapshot the official shell's custom-property surface (--dsw-* tokens) into
 * packages/skins/skin-center/contracts/official-tokens-v1.json
 * (and the generated TypeScript registry that the derivation reads).
 *
 * The skin center derives automatic fallback tints for tokens a skin does not
 * remap (issue #506 follow-up); the registry pins WHICH tokens exist so the
 * derivation table never invents names the official shell does not use.
 * The static palette (--dsw-static-*) is excluded.
 *
 * Source rule: the official surface is published by two packages, and since
 * 0.1.7-alpha.2 the shell bundle no longer inlines most declarations:
 *   - @deepseek-ai/dsh-client-ui-theme   -> lib/          (token table + themes)
 *   - @deepseek-ai/dsh-web-frontend      -> dist/assets/  (shell bundle)
 * Every .css/.js/.mjs file under those directories is scanned and unioned; the
 * regex matches a token wherever it appears (declaration or reference), which
 * is the same rule the previous single-bundle-CSS scan used.
 *
 * Both packages must be installed at the cohort the contract describes; run
 * `pnpm install` first. The `source` field records exactly what was scanned.
 *
 * Usage:
 *   node scripts/official-tokens-snapshot.mjs [path ...]   # write the contract
 *   node scripts/official-tokens-snapshot.mjs --check [path ...]
 *
 * With no path it resolves the two installed packages above. With paths it
 * scans exactly those files/directories (a maintainer pointing at an unpacked
 * release, for example). --check prints the pending diff and exits non-zero
 * instead of writing.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const CONTRACT_PATH = resolve(REPO_ROOT, 'packages/skins/skin-center/contracts/official-tokens-v1.json')
const GENERATED_PATH = resolve(
  REPO_ROOT,
  'packages/skins/skin-center/src/core/css-safety/official-tokens.generated.ts',
)

const SOURCE_PACKAGES = [
  {
    name: '@deepseek-ai/dsh-client-ui-theme',
    // Resolved from the contract owner: the theme is a development dependency
    // of the skin center, so this base always resolves inside the repo.
    from: resolve(REPO_ROOT, 'packages/skins/skin-center'),
    assets: ['lib'],
  },
  {
    name: '@deepseek-ai/dsh-web-frontend',
    from: REPO_ROOT,
    assets: ['dist/assets'],
  },
]

const SCAN_EXTENSIONS = new Set(['.css', '.js', '.mjs'])
const TOKEN_PATTERN = /--dsw-[a-z0-9-]+/g
const EXCLUDED_PREFIX = '--dsw-static-'

function fail(message, hint) {
  console.error(`official-tokens-snapshot: ${message}`)
  if (hint) console.error(hint)
  process.exit(1)
}

function resolvePackageRoot(name, from) {
  const require = createRequire(join(from, 'index.js'))
  return dirname(require.resolve(`${name}/package.json`))
}

function defaultTargets() {
  return SOURCE_PACKAGES.map(({ name, from, assets }) => {
    let root
    try {
      root = resolvePackageRoot(name, from)
    } catch (error) {
      fail(
        `cannot resolve ${name} from ${relative(REPO_ROOT, from) || '.'} (${error.code ?? error.message})`,
        'Install the official cohort first (pnpm install in the repository root), or pass the\n' +
          'files/directories to scan explicitly:\n' +
          '  node scripts/official-tokens-snapshot.mjs <css-file-or-dir> [...]',
      )
    }
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
    return {
      path: join(root, ...assets[0].split('/')),
      label: `${name}@${version} ${assets[0]}`,
    }
  })
}

function cliTargets(args) {
  return args.map((arg) => {
    const path = resolve(arg)
    if (!existsSync(path)) fail(`no such path: ${arg}`)
    const under = relative(REPO_ROOT, path)
    return { path, label: under.startsWith('..') ? path : under || '.' }
  })
}

function collectFiles(target) {
  const stat = statSync(target)
  if (stat.isFile()) return SCAN_EXTENSIONS.has(extname(target)) ? [target] : []
  if (!stat.isDirectory()) fail(`not a file or directory: ${target}`)
  const files = []
  for (const entry of readdirSync(target).sort()) {
    const child = join(target, entry)
    // Official packages are fully materialized; skipping symlinks keeps the
    // walk loop-free and deterministic.
    if (lstatSync(child).isSymbolicLink()) continue
    if (statSync(child).isDirectory()) files.push(...collectFiles(child))
    else if (SCAN_EXTENSIONS.has(extname(entry))) files.push(child)
  }
  return files
}

function tokensOf(files) {
  const tokens = new Set()
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(TOKEN_PATTERN)) {
      if (!match[0].startsWith(EXCLUDED_PREFIX)) tokens.add(match[0])
    }
  }
  return tokens
}

const args = process.argv.slice(2)
const check = args.includes('--check')
const paths = args.filter((arg) => arg !== '--check')
const targets = paths.length > 0 ? cliTargets(paths) : defaultTargets()

const scanned = []
const union = new Set()
for (const target of targets) {
  const files = collectFiles(target.path)
  if (files.length === 0) {
    fail(
      `no ${[...SCAN_EXTENSIONS].join('/')} files under ${target.label}`,
      'Point the script at the directory that holds the official token definitions\n' +
        '(the theme lib/ and the shell dist/assets/ trees).',
    )
  }
  const tokens = tokensOf(files)
  for (const token of tokens) union.add(token)
  scanned.push({ ...target, files: files.length, tokens: tokens.size })
  console.log(`official-tokens-snapshot: ${target.label} — ${files.length} files, ${tokens.size} tokens`)
}

const sorted = [...union].sort()
const out = {
  $schema: 'https://schemas.linxin666.org/dsh-skin/official-tokens-v1.json',
  contractVersion: 1,
  source: `official surfaces: ${scanned.map((entry) => entry.label).join(' + ')}`,
  excludedPrefix: EXCLUDED_PREFIX,
  count: sorted.length,
  tokens: sorted,
}
const json = `${JSON.stringify(out, null, 2)}\n`
const ts = [
  '/**',
  ' * GENERATED by scripts/official-tokens-snapshot.mjs — do not edit.',
  ' * Official shell custom-property surface (--dsw-*, static palette excluded).',
  ' */',
  'export const OFFICIAL_TOKENS: readonly string[] = [',
  ...sorted.map((name) => `  ${JSON.stringify(name)},`),
  ']',
  '',
].join('\n')

if (check) {
  const current = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'))
  const added = sorted.filter((token) => !current.tokens.includes(token))
  const removed = current.tokens.filter((token) => !union.has(token))
  if (added.length === 0 && removed.length === 0 && current.source === out.source) {
    console.log(`official-tokens-snapshot: contract is current (${sorted.length} tokens)`)
    process.exit(0)
  }
  console.error(
    `official-tokens-snapshot: contract is stale — ${added.length} added, ${removed.length} removed` +
      (current.source === out.source ? '' : `\n  source: ${current.source}\n       -> ${out.source}`),
  )
  for (const token of added) console.error(`  + ${token}`)
  for (const token of removed) console.error(`  - ${token}`)
  process.exit(1)
}

writeFileSync(CONTRACT_PATH, json)
writeFileSync(GENERATED_PATH, ts)
console.log(`official-tokens-snapshot: wrote ${sorted.length} tokens (json + generated ts)`)
