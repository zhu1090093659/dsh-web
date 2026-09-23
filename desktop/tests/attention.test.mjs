import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseAttentionConfig, parseAttentionSignal, ATTENTION_KINDS, ATTENTION_DEFAULTS } = require('../src/runtime.cjs');
const {
  PENDING_SELECTOR,
  SETTLED_SELECTOR,
  ERROR_SELECTOR,
  STOPPED_SELECTOR,
  decideAttention,
  readAttentionState,
} = require('../src/attention-observer.js');

test('attention config: defaults stay on for anything unusable', () => {
  assert.deepEqual(parseAttentionConfig(undefined), { flash: true, sound: true });
  assert.deepEqual(parseAttentionConfig(''), { flash: true, sound: true });
  assert.deepEqual(parseAttentionConfig('   '), { flash: true, sound: true });
  assert.deepEqual(parseAttentionConfig('{ not json'), { flash: true, sound: true });
  assert.deepEqual(parseAttentionConfig('[true]'), { flash: true, sound: true });
  assert.deepEqual(parseAttentionConfig('"on"'), { flash: true, sound: true });
  assert.deepEqual(parseAttentionConfig('null'), { flash: true, sound: true });
});

test('attention config: only a literal false turns a channel off', () => {
  assert.deepEqual(parseAttentionConfig('{"flash":false}'), { flash: false, sound: true });
  assert.deepEqual(parseAttentionConfig('{"sound":false}'), { flash: true, sound: false });
  assert.deepEqual(parseAttentionConfig('{"flash":false,"sound":false}'), { flash: false, sound: false });
  // A typo must never silently disable the reminder the user asked for.
  assert.deepEqual(parseAttentionConfig('{"flash":"no"}'), { flash: true, sound: true });
  assert.deepEqual(parseAttentionConfig('{"flash":0}'), { flash: true, sound: true });
});

test('attention signal: only the closed kind set is accepted', () => {
  for (const kind of ATTENTION_KINDS) assert.equal(parseAttentionSignal({ kind }), kind);
  assert.equal(parseAttentionSignal({ kind: 'anything-else' }), undefined);
  assert.equal(parseAttentionSignal({ kind: 1 }), undefined);
  assert.equal(parseAttentionSignal({}), undefined);
  assert.equal(parseAttentionSignal(null), undefined);
  assert.equal(parseAttentionSignal('approval'), undefined);
  assert.equal(parseAttentionSignal(['approval']), undefined);
  assert.deepEqual(Object.keys(ATTENTION_DEFAULTS).sort(), ['flash', 'sound']);
});

/** Minimal root shaped like the four DOM reads the observer performs. */
function fakeRoot({ pending = 0, settled = 0, errors = 0, stopped = 0 } = {}) {
  return {
    querySelectorAll(selector) {
      const counts = { [PENDING_SELECTOR]: pending, [SETTLED_SELECTOR]: settled, [ERROR_SELECTOR]: errors, [STOPPED_SELECTOR]: stopped };
      const count = counts[selector];
      if (count === undefined) throw new Error('unexpected selector: ' + selector);
      return new Array(count).fill({});
    },
  };
}

const IDLE = { pending: 0, settled: 0, errors: 0, stopped: 0 };

test('observer snapshot reads the four cumulative counts', () => {
  assert.deepEqual(readAttentionState(fakeRoot()), IDLE);
  assert.deepEqual(
    readAttentionState(fakeRoot({ pending: 1, settled: 4, errors: 2, stopped: 1 })),
    { pending: 1, settled: 4, errors: 2, stopped: 1 },
  );
});

test('observer decision: the first snapshot only primes the state', () => {
  assert.deepEqual(decideAttention(undefined, { pending: 1, settled: 3, errors: 0, stopped: 0 }), []);
});

test('observer decision: a pending interaction raises on its rising edge only', () => {
  const waiting = { ...IDLE, pending: 1 };
  assert.deepEqual(decideAttention(IDLE, waiting), ['approval']);
  assert.deepEqual(decideAttention(waiting, waiting), []);
  // Answering it, and the turn then ending, is the turn's own signal.
  const settled = { ...IDLE, settled: 1 };
  assert.deepEqual(decideAttention(waiting, settled), ['completed']);
});

test('observer decision: each settled turn is one signal', () => {
  const one = { ...IDLE, settled: 1 };
  const two = { ...IDLE, settled: 2 };
  assert.deepEqual(decideAttention(IDLE, one), ['completed']);
  assert.deepEqual(decideAttention(one, two), ['completed']);
  assert.deepEqual(decideAttention(two, two), []);
});

test('observer decision: an error or an interrupted tool call at settle time reports an interruption', () => {
  const before = { ...IDLE, settled: 1 };
  assert.deepEqual(decideAttention(before, { ...IDLE, settled: 2, errors: 1 }), ['interrupted']);
  assert.deepEqual(decideAttention(before, { ...IDLE, settled: 2, stopped: 1 }), ['interrupted']);
  // An error node appearing without a turn settling is not a settle signal.
  assert.deepEqual(decideAttention(before, { ...IDLE, settled: 1, errors: 1 }), []);
});

test('observer decision: history that shrinks (switching sessions) says nothing', () => {
  assert.deepEqual(decideAttention({ ...IDLE, settled: 5, pending: 1 }, { ...IDLE, settled: 1 }), []);
  assert.deepEqual(decideAttention({ ...IDLE, settled: 5, pending: 2 }, { ...IDLE, settled: 1, pending: 1 }), []);
});

test('observer decision: a burst can carry both signals, approval first', () => {
  assert.deepEqual(decideAttention(IDLE, { pending: 1, settled: 1, errors: 0, stopped: 0 }), ['approval', 'completed']);
});
