import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { hostSdkCandidates } from './host-sdk-link.mjs'

test('Windows npm-global host SDK candidate is discovered from APPDATA', {
  skip: process.platform !== 'win32',
}, () => {
  const previous = process.env.APPDATA
  const previousOverride = process.env.DSH_HOST_SDK_DIR
  process.env.APPDATA = 'C:/Users/example/AppData/Roaming'
  delete process.env.DSH_HOST_SDK_DIR
  try {
    const expected = resolve(
      'C:/Users/example/AppData/Roaming',
      'npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
    )
    assert.ok(hostSdkCandidates().includes(expected))
  } finally {
    if (previous === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previous
    if (previousOverride === undefined) delete process.env.DSH_HOST_SDK_DIR
    else process.env.DSH_HOST_SDK_DIR = previousOverride
  }
})
