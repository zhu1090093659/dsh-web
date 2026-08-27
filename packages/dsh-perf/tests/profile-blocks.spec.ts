// @vitest-environment node
import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { applyManagedBlock, deriveMountState, OVERRIDE_TARGET_IDS } from '../src/bsm/profile-blocks.ts'

const base = '# existing row\n- id: web-ui-remote-web-ui\n  config:\n    autoTunnel: true\n'

const inactiveRepo = [
  '- id: session-persistence-jsonl',
  '  disabled: true',
  '- id: web-ui-session-branch',
  '  disabled: true',
  '- id: web-ui-session-rdb',
  '  disabled: true',
  '- id: web-ui-conversation-message-actions',
  '  disabled: true',
].join('\n')

describe('managed opt-in block', () => {
  it('inserts a marker-delimited block that replace-updates and removes cleanly', () => {
    const enabled = applyManagedBlock(base, 'insert')
    assert.match(enabled, /# >>> better-session opt-in/)
    assert.match(enabled, /\n- id: web-ui-session-rdb\n  disabled: false\n/)
    assert.match(enabled, /\n- id: session-persistence-jsonl\n  disabled: true\n/, 'the jsonl patch stays disabled inside the enable block')
    assert.ok(enabled.endsWith('\n'))
    assert.equal(applyManagedBlock(enabled, 'insert').split('# >>> better-session opt-in').length - 1, 1, 're-insert replaces instead of duplicating')
    assert.equal(applyManagedBlock(enabled, 'remove'), base, 'remove strips the whole managed block')
    assert.equal(applyManagedBlock(base, 'remove'), base, 'remove without a block is a no-op')
    // Every artifact the aggregate ships must be covered by the enable block.
    for (const id of OVERRIDE_TARGET_IDS) assert.match(applyManagedBlock('', 'insert'), new RegExp(`- id: ${id}`))
  })
})

describe('mount posture derivation', () => {
  it('classifies repo + profile layering', () => {
    assert.equal(deriveMountState(inactiveRepo, '').state, 'inactive-by-default')
    assert.equal(deriveMountState(inactiveRepo, `${inactiveRepo}\n${applyManagedBlock('', 'insert')}`).state, 'enabled-via-profile')
    assert.equal(deriveMountState(undefined, applyManagedBlock('', 'insert')).state, 'enabled-via-profile')
    assert.equal(deriveMountState('', '').state, 'not-installed')
  })
})
