/**
 * Unit tests for the pure link-state decision logic in link-profile.mjs.
 *
 * Importing link-profile.mjs must not execute main() (it is guarded by the
 * entry-script check), so these tests never touch the real ~/.dsh profile.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideLinkAction, bundlePatchChildNames } from './link-profile.mjs'

const TARGET = '../../dsh-web-ui/packages/dsh-web-ui'

test('missing -> create', () => {
  assert.equal(decideLinkAction('missing', TARGET, null), 'create')
})

test('symlink to target -> keep', () => {
  assert.equal(decideLinkAction('symlink', TARGET, TARGET), 'keep')
})

test('symlink to other -> replace', () => {
  assert.equal(decideLinkAction('symlink', TARGET, '../something-else'), 'replace')
})

test('broken symlink -> replace', () => {
  assert.equal(decideLinkAction('symlink', TARGET, null), 'replace')
})

test('real file -> skip', () => {
  assert.equal(decideLinkAction('file', TARGET, null), 'skip-report')
})

test('real dir -> skip', () => {
  assert.equal(decideLinkAction('dir', TARGET, null), 'skip-report')
})

test('bundle patch child names include scoped and plain plugin rows', () => {
  const patch = `- id: session-persistence-jsonl
  disabled: true

- insert:
    - id: session-rdb
      name: '@morlay/session-rdb'
    - id: ui-conversation-message-actions
      name: '@morlay/ui-conversation-message-actions'
    - id: better-sidebar
      name: 'dsh-better-sidebar'
`
  assert.deepEqual(bundlePatchChildNames(patch), [
    '@morlay/session-rdb',
    '@morlay/ui-conversation-message-actions',
    'dsh-better-sidebar',
  ])
})
