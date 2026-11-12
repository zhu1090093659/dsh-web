/**
 * One module states the relay's limits, and every value in it is frozen.
 *
 * Both halves used to declare these numbers locally -- the registry's buckets in
 * relay.js, the bridge door's budgets and the per-stream window in
 * relay-bridge.js -- so a window and its retention could drift apart while every
 * spec stayed green. This file pins the consolidation from both sides: the table
 * below is the value each limit held before the move, written as a plain decimal
 * because a derived expression would move with the module it is meant to pin,
 * and neither source file may declare one of them again.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import * as limits from '../market/worker/src/relay-limits.js'
import {
  RATE_LIMIT_RETENTION_MS as RELAY_RATE_LIMIT_RETENTION_MS,
  REGISTER_MAX_PER_ID as RELAY_REGISTER_MAX_PER_ID,
  REGISTER_MAX_PER_IP as RELAY_REGISTER_MAX_PER_IP,
  REGISTER_WINDOW_MS as RELAY_REGISTER_WINDOW_MS,
} from '../market/worker/src/relay.js'

const LIMITS_SOURCE = fileURLToPath(new URL('../market/worker/src/relay-limits.js', import.meta.url))

/** The two halves that used to declare these numbers themselves. */
const SOURCES = {
  'relay.js': fileURLToPath(new URL('../market/worker/src/relay.js', import.meta.url)),
  'relay-bridge.js': fileURLToPath(new URL('../market/worker/src/relay-bridge.js', import.meta.url)),
}

/**
 * Every limit at the value it held before the consolidation. The trailing
 * comment is the declaration the value came from: `file:line` as that file stood
 * before the move.
 */
const FROZEN = {
  // The registry's rate limits, counted over one window, and its row lifetime.
  REGISTER_WINDOW_MS: 300_000, // relay.js:53
  REGISTER_MAX_PER_IP: 60, // relay.js:54
  REGISTER_MAX_PER_ID: 3, // relay.js:55
  RATE_LIMIT_RETENTION_MS: 900_000, // relay.js:62
  REGISTRATION_TTL_MS: 7_776_000_000, // relay.js:64
  // The bridge door's two timeouts, its own budgets, and the stream window.
  HEAD_TIMEOUT_MS: 60_000, // relay-bridge.js:59
  WS_OPEN_TIMEOUT_MS: 15_000, // relay-bridge.js:61
  BRIDGE_MAX_PER_ID: 6, // relay-bridge.js:69
  BRIDGE_MAX_PER_IP: 30, // relay-bridge.js:70
  BRIDGE_STREAM_HIGH: 1_048_576, // relay-bridge.js:77
  BRIDGE_STREAM_LOW: 262_144, // relay-bridge.js:78
  BRIDGE_STREAM_STALL_MS: 60_000, // relay-bridge.js:84
  BRIDGE_STREAM_PAUSED_CAP: 1_310_720, // relay-bridge.js:94
  BRIDGE_CLOSE_REPLACED: 4001, // relay-bridge.js:97
  BRIDGE_CLOSE_STALLED: 4002, // relay-bridge.js:98
}

/**
 * The expressions the two halves wrote these values with. None of them may
 * survive the move, because a copy of a value is the same defect as a copy of
 * the constant: the next retune edits one and misses the other.
 */
const RETIRED_EXPRESSIONS = ['5 * 60 * 1000', '90 * 24 * 60 * 60 * 1000', '1024 * 1024', '256 * 1024', '4001', '4002']

/** The limit names each half still serves to the importers that read them. */
const REEXPORTED = {
  'relay.js': ['REGISTER_WINDOW_MS', 'REGISTER_MAX_PER_IP', 'REGISTER_MAX_PER_ID', 'RATE_LIMIT_RETENTION_MS'],
  'relay-bridge.js': [
    'BRIDGE_MAX_PER_ID',
    'BRIDGE_MAX_PER_IP',
    'BRIDGE_STREAM_HIGH',
    'BRIDGE_STREAM_LOW',
    'BRIDGE_STREAM_STALL_MS',
    'BRIDGE_STREAM_PAUSED_CAP',
    'BRIDGE_CLOSE_REPLACED',
    'BRIDGE_CLOSE_STALLED',
  ],
}

/** Every name a file puts on its surface from a local `export { ... }` block. */
function reexportedNames(source) {
  const names = new Set()
  for (const block of source.matchAll(/export \{([^}]*)\}/g)) {
    for (const entry of block[1].split(',')) {
      const name = entry.trim()
      if (name !== '') names.add(name)
    }
  }
  return names
}

test('the limits module states every relay limit at its frozen value', () => {
  assert.deepEqual(
    Object.keys(limits).sort(),
    Object.keys(FROZEN).sort(),
    'the module states exactly the limits the two halves used to declare, and nothing else',
  )
  for (const [name, value] of Object.entries(limits)) {
    assert.equal(value, FROZEN[name], name + ' keeps the value it held before the consolidation')
  }
  assert.equal(
    limits.BRIDGE_STREAM_PAUSED_CAP,
    limits.BRIDGE_STREAM_HIGH + limits.BRIDGE_STREAM_LOW,
    'the paused cap is still HIGH + LOW rather than a third number that could fall out of step',
  )
  assert.equal(
    limits.RATE_LIMIT_RETENTION_MS,
    3 * limits.REGISTER_WINDOW_MS,
    'the retention is still three rate-limit windows',
  )
  assert.equal(
    /^import\s/m.test(readFileSync(LIMITS_SOURCE, 'utf8')),
    false,
    'the module imports nothing, so no import cycle can pass through it',
  )
})

test('relay.js still serves the registry limits to the modules that read them there', () => {
  assert.equal(RELAY_REGISTER_WINDOW_MS, limits.REGISTER_WINDOW_MS, 'the window relay-control.js reads is the module window')
  assert.equal(RELAY_REGISTER_MAX_PER_IP, limits.REGISTER_MAX_PER_IP, 'the per-IP budget relay-control.js reads is the module budget')
  assert.equal(RELAY_REGISTER_MAX_PER_ID, limits.REGISTER_MAX_PER_ID, 'the per-id budget relay-control.js reads is the module budget')
  assert.equal(RELAY_RATE_LIMIT_RETENTION_MS, limits.RATE_LIMIT_RETENTION_MS, 'the retention the cron GC applies is the module retention')
})

test('neither relay half declares a limit of its own again', () => {
  for (const [file, path] of Object.entries(SOURCES)) {
    const source = readFileSync(path, 'utf8')
    assert.match(source, /from '\.\/relay-limits\.js'/, file + ' takes its limits from the module')
    for (const name of Object.keys(FROZEN)) {
      assert.equal(
        new RegExp('\\bconst ' + name + ' =').test(source),
        false,
        file + ' must not declare ' + name + ' again',
      )
    }
    for (const expression of RETIRED_EXPRESSIONS) {
      assert.equal(
        source.includes(expression),
        false,
        file + ' must not carry ' + expression + ' as a second copy of a module value',
      )
    }
  }
})

test('both relay halves keep exporting the limits their importers read', () => {
  for (const [file, names] of Object.entries(REEXPORTED)) {
    const served = reexportedNames(readFileSync(SOURCES[file], 'utf8'))
    for (const name of names) {
      assert.equal(served.has(name), true, file + ' must still export ' + name + ' for its existing importers')
    }
  }
})
