import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { syncCommunityStoreSkill } from './community-store-skill.mjs'

const UPSTREAM = {
  'SKILL.md': '---\nname: search-dsh-store\ndescription: Upstream Store skill.\n---\n\nUse Store tools.\n',
  'agents/openai.yaml': 'interface:\n  display_name: "Use DSH Store"\n',
  'LICENSE.upstream': 'MIT License\n',
}

function upstreamFetch(input) {
  const url = String(input)
  const entry = Object.entries(UPSTREAM).find(([name]) => {
    const source = name === 'LICENSE.upstream' ? 'LICENSE' : `packages/dsh-plugins-store/skills/search-dsh-store/${name}`
    return url.includes(encodeURIComponent(source)) || url.includes(source)
  })
  if (entry === undefined) return Promise.resolve(new Response('missing', { status: 404 }))
  const [name, content] = entry
  return Promise.resolve(new Response(JSON.stringify({
    encoding: 'base64',
    sha: `blob-${name}`,
    content: Buffer.from(content).toString('base64'),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
}

test('syncCommunityStoreSkill mirrors upstream files and preserves the local integration overlay', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'community-store-skill-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const skillDir = path.join(root, 'packages', 'dsh-community-plugins', 'skills', 'search-dsh-store')
  const overlay = path.join(skillDir, 'references', 'dsh-web-ui.md')
  await mkdir(path.dirname(overlay), { recursive: true })
  await writeFile(overlay, 'Local install-mode contract.\n')

  await syncCommunityStoreSkill({ root, fetcher: upstreamFetch })

  assert.equal(await readFile(path.join(skillDir, 'SKILL.md'), 'utf8'), UPSTREAM['SKILL.md'])
  assert.equal(await readFile(path.join(skillDir, 'agents', 'openai.yaml'), 'utf8'), UPSTREAM['agents/openai.yaml'])
  assert.equal(await readFile(path.join(skillDir, 'LICENSE.upstream'), 'utf8'), UPSTREAM['LICENSE.upstream'])
  assert.equal(await readFile(overlay, 'utf8'), 'Local install-mode contract.\n')
  assert.match(await readFile(path.join(skillDir, '.upstream.json'), 'utf8'), /blob-SKILL\.md/)

  await syncCommunityStoreSkill({ root, fetcher: upstreamFetch, check: true })
  await writeFile(path.join(skillDir, 'SKILL.md'), 'stale\n')
  await assert.rejects(
    syncCommunityStoreSkill({ root, fetcher: upstreamFetch, check: true }),
    /out of sync/i,
  )
})
