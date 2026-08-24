#!/usr/bin/env node
/**
 * Regenerate the contributor sections in the root READMEs from the live GitHub
 * API contributor list.
 *
 * Run by .github/workflows/contributors.yml on every push to dev/main (and
 * daily, or on demand); it commits directly to dev only when the rendered list
 * actually changed, so the section always reflects the latest contributors.
 *
 * Usage:   node scripts/update-contributors.mjs
 * Env:     GITHUB_REPOSITORY (optional, defaults to this repo)
 *          GITHUB_TOKEN      (optional; used in CI to avoid rate limits)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = process.env.GITHUB_REPOSITORY || 'zhu1090093659/dsh-web'
const token = process.env.GITHUB_TOKEN || ''
const files = [
  { rel: 'README.md', viewAllLabel: '查看全部贡献者' },
  { rel: 'README.en.md', viewAllLabel: 'View all contributors' },
]
const START = '<!-- CONTRIBUTORS:START -->'
const END = '<!-- CONTRIBUTORS:END -->'

/**
 * Contributors whose only merged PRs were documentation-only. The GitHub
 * /contributors endpoint counts every commit on main regardless of type, so
 * doc-only PR authors would still show up there; the repository rejects
 * documentation-only PRs (see .github/workflows/reject-docs-pr.yml), so these
 * logins are excluded from the rendered list. Add a login here (with the
 * merged PR numbers) when another doc-only PR lands.
 */
const EXCLUDED_LOGINS = new Set([
  'xiehuan123', // docs-only merged PR #291
  'Amengclass', // docs-only merged PR #91
  'github-actions[bot]', // auto-commits README syncs; not a human contributor
])

/**
 * External contributors recognized for substantive work that did not become a
 * commit on main. Keep this explicit list so GitHub's /contributors endpoint
 * does not erase that acknowledgement.
 */
const ACKNOWLEDGED_CONTRIBUTORS = [
  { login: 'Twelveeee', html_url: 'https://github.com/Twelveeee' }, // PR #102
]

function buildContributors(githubContributors) {
  const byLogin = new Map()
  for (const contributor of githubContributors) {
    if (!EXCLUDED_LOGINS.has(contributor.login)) byLogin.set(contributor.login, contributor)
  }
  for (const contributor of ACKNOWLEDGED_CONTRIBUTORS) {
    if (!byLogin.has(contributor.login)) byLogin.set(contributor.login, contributor)
  }
  return [...byLogin.values()]
}

async function fetchContributors() {
  let page = 1
  const all = []
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-web-update-contributors' }
  if (token) headers.authorization = `token ${token}`
  for (;;) {
    const url = `https://api.github.com/repos/${repo}/contributors?per_page=100&anon=0&page=${page}`
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`)
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < 100) break
    page += 1
  }
  return all
}

function renderSection(contributors, viewAllLabel) {
  const grid = contributors
    .map(
      (c) =>
        `<a href="${c.html_url}"><img src="https://github.com/${c.login}.png?size=64" width="48" height="48" alt="${c.login}" title="${c.login}" /></a>`,
    )
    .join('\n  ')
  return [
    START,
    '<p align="center">',
    `  ${grid}`,
    '</p>',
    '<p align="center">',
    `  <sub><a href="https://github.com/${repo}/graphs/contributors">${viewAllLabel}</a></sub>`,
    '</p>',
    END,
  ].join('\n')
}

function replaceSection(text, section) {
  const i = text.indexOf(START)
  const j = text.indexOf(END)
  if (i < 0 || j < 0 || i >= j) return null
  return text.slice(0, i) + section + text.slice(j + END.length)
}

const contributors = buildContributors(await fetchContributors())
for (const { rel, viewAllLabel } of files) {
  const path = join(root, rel)
  const original = readFileSync(path, 'utf8')
  const section = renderSection(contributors, viewAllLabel)
  const updated = replaceSection(original, section)
  if (updated === null) throw new Error(rel + ': missing CONTRIBUTORS markers')
  if (updated !== original) {
    writeFileSync(path, updated)
    console.log(rel + ': updated (' + contributors.length + ' contributors)')
  } else {
    console.log(rel + ': unchanged')
  }
}
