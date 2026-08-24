#!/usr/bin/env node
/**
 * verify-docs - documentation consistency gate for dsh-web.
 *
 * Enforces the rules in docs/AGENTS.md as one executable gate:
 *   1. README triplets - every package has README.md + README.zh.md + README.i18n.yaml.
 *   2. i18n pairing - recorded git blob hashes match current content; both sides carry
 *      their language switcher; heading/code/table/list signatures mirror each other.
 *   3. Markdown links - relative link targets exist and #anchors name real headings.
 *   4. Heading levels - the first line is H1; no bare H1 sub-sections follow it.
 *   5. No scaffold placeholders in package.json descriptions.
 *
 * Usage:
 *   node scripts/verify-docs.mjs                    # check everything (CI mode)
 *   node scripts/verify-docs.mjs --list             # report state, never fails
 *   node scripts/verify-docs.mjs --write <name...>  # re-record pairing hashes after
 *                                                    confirming both sides agree
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkFamilyPackages } from './lib/family-packages.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const listOnly = args.includes('--list')
const writeMode = args.includes('--write')
const namedPairs = args.filter((a) => !a.startsWith('--'))

const failures = []
const rows = []
function fail(msg) { failures.push(msg) }

/** Git blob hash of a working-tree file (content-addressed, no staging needed). */
function blobHash(file) {
  return execFileSync('git', ['hash-object', file], { cwd: root }).toString().trim()
}

/** Parse a pairing record into { README.md: hash, README.zh.md: hash }. */
function readPairing(yamlPath) {
  const out = {}
  for (const line of readFileSync(yamlPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(README(?:\.zh)?\.md):\s*([0-9a-f]{40})\s*$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function writePairing(yamlPath, record) {
  const header = [
    '# Bilingual-pair consistency record (docs/i18n.md): the git blob hash of each'
    , '# side as of the last confirmed-consistent state. Both languages carry equal authority;'
    , '# after editing either side, bring the other along and re-record with:'
    , '#   node scripts/verify-docs.mjs --write <dir>'
  ].join('\n')
  const body = ['README.md: ' + (record['README.md'] || ''), 'README.zh.md: ' + (record['README.zh.md'] || '')].join('\n')
  writeFileSync(yamlPath, header + '\n' + body + '\n')
}

/**
 * Structural signature: heading levels, fence language markers, table widths,
 * list kinds. Headings compare by level only (text is translated); fenced
 * block CONTENT is not compared — translating comments inside code samples is
 * legitimate localization, the mirror rule guards against a missing section,
 * not against translated sample text.
 */
function signature(text) {
  const sig = { headings: [], fences: [], tables: [], lists: [] }
  let inFence = null
  for (const line of text.split(/\r?\n/)) {
    const fm = line.match(/^(```+|~~~+)(\S*)\s*$/)
    if (fm) {
      if (!inFence) { inFence = fm[2] || 'plain'; sig.fences.push('open:' + inFence) }
      else { sig.fences.push('close:' + inFence); inFence = null }
      continue
    }
    if (inFence) continue
    const hm = line.match(/^(#{1,6})\s+(.*)$/)
    if (hm) { sig.headings.push(hm[1].length); continue }
    if (/^\|.*\|\s*$/.test(line)) { sig.tables.push(line.split('|').length - 2); continue }
    const lm = line.match(/^\s*(?:([-*+])\s+|(\d+)[.)]\s+)/)
    if (lm) sig.lists.push(lm[1] ? 'u' : 'o')
  }
  return sig
}

function sigEqual(a, b) {
  return JSON.stringify(a.headings) === JSON.stringify(b.headings)
    && JSON.stringify(a.fences) === JSON.stringify(b.fences)
    && JSON.stringify(a.tables) === JSON.stringify(b.tables)
    && JSON.stringify(a.lists) === JSON.stringify(b.lists)
}

/** GitHub-ish heading slug for #anchor checks. */
function slugify(heading) {
  return heading.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-')
}

function headingSlugs(file) {
  const slugs = new Set()
  if (!existsSync(file)) return slugs
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^#{1,6}\s+(.*)$/)
    if (m) slugs.add(slugify(m[1]))
  }
  return slugs
}

/** All package directories (packages/* and packages/skins/* with a package.json). */
function packageDirs() {
  return walkFamilyPackages(root).map(({ dir }) => dir)
}

function isExternal(url) {
  return url.startsWith('//') || url.startsWith('/') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)
}

export { signature, sigEqual, slugify, isExternal }
if (import.meta.main) {
  /* ---------- 1 + 2 + 4. README triplets, pairing, heading levels ---------- */
  const pairs = []
  for (const dir of packageDirs()) {
    const rel = relative(root, dir)
    const en = resolve(dir, 'README.md')
    const zh = resolve(dir, 'README.zh.md')
    const yaml = resolve(dir, 'README.i18n.yaml')
    if (!existsSync(en)) { fail(rel + ': missing README.md (every package needs the bilingual triplet)'); continue }
    if (!existsSync(zh)) { fail(rel + ': missing README.zh.md'); continue }
    if (!existsSync(yaml)) { fail(rel + ': missing README.i18n.yaml'); continue }
    pairs.push({ rel, en, zh, yaml })
  }
  
  for (const p of pairs) {
    const record = readPairing(p.yaml)
    const hEn = blobHash(p.en)
    const hZh = blobHash(p.zh)
    if (writeMode && (!namedPairs.length || namedPairs.some((n) => p.rel.replace(/\\/g, '/').includes(n.replace(/\\/g, '/'))))) {
      writePairing(p.yaml, { 'README.md': hEn, 'README.zh.md': hZh })
      rows.push('re-record ' + p.rel)
      continue
    }
    if (listOnly) {
      const synced = record['README.md'] === hEn && record['README.zh.md'] === hZh
      rows.push((synced ? 'ok   ' : 'sync?') + ' ' + p.rel)
      continue
    }
    const enText = readFileSync(p.en, 'utf8')
    const zhText = readFileSync(p.zh, 'utf8')
    if (record['README.md'] !== hEn) fail(p.rel + ': README.md changed since the pairing record - update the other side, then run `node scripts/verify-docs.mjs --write ' + p.rel + '`')
    if (record['README.zh.md'] !== hZh) fail(p.rel + ': README.zh.md changed since the pairing record - update the other side, then re-record')
    if (!/^English \| \[中文\]\(README\.zh\.md\)/m.test(enText)) fail(p.rel + ': README.md missing `English | [中文](README.zh.md)` switcher after H1')
    if (!/^\[English\]\(README\.md\) \| 中文/m.test(zhText)) fail(p.rel + ': README.zh.md missing `[English](README.md) | 中文` switcher after H1')
    if (!sigEqual(signature(enText), signature(zhText))) fail(p.rel + ': structural signature mismatch between README.md and README.zh.md')
    const enLines = enText.split(/\r?\n/)
    const zhLines = zhText.split(/\r?\n/)
    if (!/^# /.test(enLines[0])) fail(p.rel + ': README.md must start with an H1 (package name)')
    if (!/^# /.test(zhLines[0])) fail(p.rel + ': README.zh.md must start with an H1 (package name)')
    for (const { lines: ls, rel2, label } of [{ lines: enLines, rel2: p.rel, label: 'README.md' }, { lines: zhLines, rel2: p.rel, label: 'README.zh.md' }]) {
      let inFence = false
      for (let i = 1; i < ls.length; i++) {
        if (/^```|^~~~/.test(ls[i])) { inFence = !inFence; continue }
        if (inFence) continue
        if (/^# /.test(ls[i])) { fail(rel2 + ': ' + label + ' line ' + (i + 1) + ' uses H1 under a section - use H3 for install options'); break }
      }
    }
    rows.push('ok    ' + p.rel)
  }
  
  /* ---------- 3. Markdown links ---------- */
  const docFiles = ['AGENTS.md', 'packages/AGENTS.md', 'docs/AGENTS.md', 'CONTRIBUTING.md']
  for (const p of pairs) docFiles.push(relative(root, p.en), relative(root, p.zh))
  for (const name of readdirSync(resolve(root, 'docs'))) {
    if (name.endsWith('.md')) docFiles.push('docs/' + name)
  }
  for (const relPath of docFiles) {
    const file = resolve(root, relPath)
    if (!existsSync(file)) { fail(relPath + ': checked file missing'); continue }
    const rawLines = readFileSync(file, 'utf8').split(/\r?\n/)
    const lines = []
    // Strip fenced code blocks and inline code so example links inside them are
    // not treated as real references (e.g. the switcher samples in docs/i18n.md).
    let inFence = false
    for (const line of rawLines) {
      if (/^```|^~~~/.test(line)) { inFence = !inFence; lines.push(''); continue }
      lines.push(inFence ? '' : line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)))
    }
    for (let i = 0; i < lines.length; i++) {
      const re = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g
      let m
      while ((m = re.exec(lines[i]))) {
        const raw = m[1]
        if (isExternal(raw)) continue
        const idx = raw.indexOf('#')
        const pathPart = idx >= 0 ? raw.slice(0, idx) : raw
        const frag = idx >= 0 ? raw.slice(idx + 1) : ''
        let target = file
        if (pathPart) {
          target = resolve(dirname(file), decodeURIComponent(pathPart))
          if (!existsSync(target)) { fail(relPath + ':' + (i + 1) + ': broken link `' + raw + '`'); continue }
        }
        if (frag) {
          const slugs = headingSlugs(target)
          if (!slugs.has(slugify(decodeURIComponent(frag)))) fail(relPath + ':' + (i + 1) + ': unknown anchor `#' + frag + '` in ' + relative(root, target))
        }
      }
    }
  }
  
  /* ---------- 5. No scaffold placeholders ---------- */
  for (const dir of packageDirs()) {
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
    if (pkg.description && /<edit me/i.test(pkg.description)) fail(relative(root, dir) + ': package.json description still contains a scaffold placeholder')
  }
  
  if (listOnly || writeMode) {
    console.log(rows.join('\n') || '(no rows)')
    process.exit(0)
  }
  if (failures.length) {
    console.error('verify-docs failed:')
    for (const f of failures) console.error('  - ' + f)
    process.exit(1)
  }
  console.log('verify-docs: all documentation gates passed')
}