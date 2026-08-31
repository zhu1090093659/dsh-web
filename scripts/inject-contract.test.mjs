import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Pinned union of dsh.client.inject module ids across every workspace
 * package. Approved for the 0.1.2-alpha.2 cohort: each name is a browser
 * roster row of the shell composition (dsh-web-app cordis.patch.yml
 * dsh.client rows) or a frozen static module (dsh-client-ui-slots;
 * dsh-client-store needs no injection because its value imports ride the
 * platform table). The 0.1.1-rc.2 set's dsh-client-runtime row is gone
 * with its package; the api controller and api-remotes rows are the
 * Typert Remote replacement faces. A rename, removal, or new inject name
 * must update this list together with its runtime-module-table evidence.
 */
const APPROVED_INJECT_MODULES = [
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-api-workspace-controller',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-theme',
]

function collectInjects() {
  const files = []
  for (const base of [join(ROOT, 'packages'), join(ROOT, 'packages/skins')]) {
    for (const entry of readdirSync(base)) {
      const pkg = join(base, entry, 'package.json')
      if (existsSync(pkg)) files.push(pkg)
    }
  }
  const names = new Set()
  for (const file of files) {
    const json = JSON.parse(readFileSync(file, 'utf8'))
    for (const name of json?.dsh?.client?.inject ?? []) names.add(name)
  }
  return [...names].sort()
}

test('every dsh.client.inject name is an approved 0.1.2-alpha.2 client module', () => {
  for (const name of collectInjects()) {
    assert.ok(
      APPROVED_INJECT_MODULES.includes(name),
      `inject name outside the approved 0.1.2-alpha.2 module set: ${name}`,
    )
  }
})

test('the approved inject module set matches actual usage exactly', () => {
  assert.deepEqual(collectInjects(), [...APPROVED_INJECT_MODULES].sort())
})
