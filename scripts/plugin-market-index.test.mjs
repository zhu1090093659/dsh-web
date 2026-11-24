import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const require = createRequire(import.meta.url)
const { buildPluginMarketIndex } = require('./lib/plugin-market-index.cjs')
const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('official plugin-market-index generator emits a format-1 document accepted by @deepseek-ai/dsh-plugin-market-index', () => {
  // Given the workspace packages plus a mix of versioned and unversioned community entries
  const doc = buildPluginMarketIndex({
    rootDir: ROOT,
    generatedDate: '2026-11-24',
    communityPlugins: [
      {
        id: 'sample-versioned',
        name: '示例社区插件',
        nameEn: 'Sample Community Plugin',
        author: 'alice',
        description: '带有明确版本的社区插件',
        descriptionEn: 'A community plugin with an explicit SemVer version.',
        repo: 'https://github.com/example/sample-versioned',
        npm: 'sample-versioned-dsh',
        version: '1.2.3',
        enginesDsh: '>=0.2.3-alpha.2',
        category: 'tools',
        subcategory: 'dev',
      },
      {
        id: 'sample-unversioned',
        name: '无版本插件',
        nameEn: 'Unversioned Plugin',
        npm: 'sample-unversioned-dsh',
        category: 'other',
      },
    ],
  })

  // When validated by the official DSH format-1 parser
  const parsed = parseMarketIndex(doc, 'https://dsh-market.com/manifest/plugin-market-index.json')

  // Then validation passes, dsh-web-all leads the list, versioned community items are included, and unversioned ones are never fabricated
  assert.equal(parsed.format, 1)
  assert.ok(parsed.plugins.length >= 20)
  assert.equal(parsed.plugins[0].name, '@linxin666/dsh-web-all')
  assert.ok(parsed.plugins.some(entry => entry.name === 'sample-versioned-dsh' && entry.versions[0]?.version === '1.2.3'))
  assert.equal(parsed.plugins.some(entry => entry.name === 'sample-unversioned-dsh'), false)
})
