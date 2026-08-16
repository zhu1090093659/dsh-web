#!/usr/bin/env node

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY = 'ZASENJC/dsh-plugins-store'
const REF = 'main'
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGET_RELATIVE = path.join('packages', 'dsh-community-plugins', 'skills', 'search-dsh-store')
const UPSTREAM_FILES = [
  {
    source: 'packages/dsh-plugins-store/skills/search-dsh-store/SKILL.md',
    target: 'SKILL.md',
  },
  {
    source: 'packages/dsh-plugins-store/skills/search-dsh-store/agents/openai.yaml',
    target: path.join('agents', 'openai.yaml'),
  },
  {
    source: 'LICENSE',
    target: 'LICENSE.upstream',
  },
]

function contentsUrl(source) {
  const encoded = source.split('/').map(encodeURIComponent).join('/')
  return `https://api.github.com/repos/${REPOSITORY}/contents/${encoded}?ref=${REF}`
}

async function fetchUpstreamFile(entry, fetcher) {
  const token = process.env.GITHUB_TOKEN
  const response = await fetcher(contentsUrl(entry.source), {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-web-ui-community-skill-sync',
      ...(token === undefined || token.length === 0 ? {} : { Authorization: `Bearer ${token}` }),
    },
  })
  if (!response.ok) throw new Error(`Upstream Skill request failed for ${entry.source} (${response.status})`)
  const value = await response.json()
  if (typeof value !== 'object' || value === null
    || value.encoding !== 'base64'
    || typeof value.content !== 'string'
    || typeof value.sha !== 'string') {
    throw new Error(`Upstream Skill response is invalid for ${entry.source}`)
  }
  return {
    ...entry,
    sha: value.sha,
    content: Buffer.from(value.content.replace(/\s+/g, ''), 'base64').toString('utf8'),
  }
}

async function currentText(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function syncCommunityStoreSkill(options = {}) {
  const root = options.root ?? DEFAULT_ROOT
  const fetcher = options.fetcher ?? globalThis.fetch
  const check = options.check === true
  if (typeof fetcher !== 'function') throw new Error('A fetch implementation is required')

  const targetDir = path.join(root, TARGET_RELATIVE)
  const files = await Promise.all(UPSTREAM_FILES.map(entry => fetchUpstreamFile(entry, fetcher)))
  const metadata = `${JSON.stringify({
    repository: `https://github.com/${REPOSITORY}`,
    ref: REF,
    files: Object.fromEntries(files.map(file => [file.target.replaceAll(path.sep, '/'), {
      source: file.source,
      blobSha: file.sha,
    }])),
  }, null, 2)}\n`
  const expected = [
    ...files.map(file => ({ target: file.target, content: file.content })),
    { target: '.upstream.json', content: metadata },
  ]

  if (check) {
    const drift = []
    for (const file of expected) {
      if (await currentText(path.join(targetDir, file.target)) !== file.content) drift.push(file.target)
    }
    if (drift.length > 0) {
      throw new Error(`Community Store skill is out of sync: ${drift.join(', ')}. Run pnpm community-skill:sync.`)
    }
    return { changed: [], metadata: JSON.parse(metadata) }
  }

  const changed = []
  for (const file of expected) {
    const destination = path.join(targetDir, file.target)
    if (await currentText(destination) === file.content) continue
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, file.content)
    changed.push(file.target)
  }
  return { changed, metadata: JSON.parse(metadata) }
}

const invokedPath = process.argv[1] === undefined ? '' : path.resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  const check = process.argv.slice(2).includes('--check')
  syncCommunityStoreSkill({ check })
    .then(result => {
      if (check) console.log('community-store-skill: upstream files are in sync')
      else console.log(`community-store-skill: synchronized ${result.changed.length} file(s)`)
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
