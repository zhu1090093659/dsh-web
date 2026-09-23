import { describe, expect, it } from 'vitest'
import { foldGuardSignal, renderGuardMessage, resolveThresholds, stepDownEffort, STALL_REASONING_CHARS_BY_EFFORT, DEFAULT_STALL_REASONING_CHARS, name } from '../presets/liangshen/guard.mjs'

/** Build a step's events: optional reasoning chars, optional output. */
function step(reasoningChars, { toolCall = false, visibleText = false } = {}) {
  const events = [{ type: 'step/start' }]
  if (reasoningChars > 0) {
    events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'x'.repeat(reasoningChars) }] } } })
  }
  if (visibleText) {
    events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } })
  }
  if (toolCall) {
    events.push({ type: 'tool/call', data: { name: 'read', callId: 'c1', arguments: '{}' } })
    events.push({ type: 'tool/result', data: { callId: 'c1', message: { content: [{ type: 'text', text: 'ok' }] } } })
  }
  return events
}

/** A failing tool call/result pair with a distinct callId. */
function failingCall(callId, tool = 'bash', args = '{"cmd":"pytest"}') {
  return [
    { type: 'tool/call', data: { name: tool, callId, arguments: args } },
    { type: 'tool/result', data: { callId, error: { name: 'ToolCallError', code: 'E_FAIL' } } },
  ]
}

describe('guard foldGuardSignal', () => {
  it('operator sees no signal on an empty or healthy stream', () => {
    // Given an empty stream and a healthy stream whose steps all produce output.
    const healthy = [
      ...step(3000, { toolCall: true }),
      ...step(2500, { visibleText: true }),
      ...step(2000, { toolCall: true }),
    ]
    // When the fold runs, Then neither reports a degeneration signal.
    expect(foldGuardSignal([]).signal).toBeUndefined()
    expect(foldGuardSignal(healthy).signal).toBeUndefined()
  })

  it('operator sees a stall on ONE runaway zero-output reasoning step (384K-scale)', () => {
    // Given a single step whose reasoning alone runs to the model's official
    // max-output scale (384K) with no tool call and no reply — the #5976 shape.
    const events = [...step(384000, {})]
    // When the fold runs, Then the per-step ladder fires immediately: waiting
    // for a second such step would burn another 384K-scale generation.
    const verdict = foldGuardSignal(events)
    expect(verdict.signal).toBe('stall')
  })

  it('operator sees a stall on one zero-output step above the max-effort floor', () => {
    // Given one step reasoning past max effort's 8000-char floor and producing nothing.
    const events = [...step(9000, {})]
    // When the fold runs at that floor, Then the per-step ladder fires. (The
    // floor is effort-adaptive: the same step stays under high/low's floor.)
    expect(foldGuardSignal(events, { stallReasoningChars: STALL_REASONING_CHARS_BY_EFFORT.max }).signal).toBe('stall')
  })

  it('operator sees no per-step stall on ordinary-brief zero-output steps', () => {
    // Given steps under the 8K floor that produce nothing but are individually
    // small — below the slow-burn cap, so neither ladder may fire.
    const events = [...step(3000, {}), ...step(3000, {}), ...step(3000, {})]
    // When the fold runs, Then no stall is reported.
    expect(foldGuardSignal(events).signal).toBeUndefined()
  })

  it('operator sees a slow-burn stall after four consecutive output-free reasoning steps', () => {
    // Given four steps that each really thought (>= 200 chars) but produced no
    // tool call and no reply — the closed loop of small plausible steps.
    const events = [...step(300, {}), ...step(500, {}), ...step(400, {}), ...step(600, {})]
    // When the fold runs, Then the global ladder fires even though no single
    // step was enormous.
    expect(foldGuardSignal(events).signal).toBe('stall')
  })

  it('operator sees the slow-burn streak reset by any output', () => {
    // Given three output-free reasoning steps, then a tool call, then three more.
    const events = [
      ...step(300, {}),
      ...step(300, {}),
      ...step(300, {}),
      ...step(2000, { toolCall: true }),
      ...step(300, {}),
      ...step(300, {}),
      ...step(300, {}),
    ]
    // When the fold runs, Then neither ladder reaches its cap.
    expect(foldGuardSignal(events).signal).toBeUndefined()
  })

  it('operator sees an echo after M identical-argument failures', () => {
    // Given the same call failing three times in a row.
    const events = [
      ...failingCall('a'),
      ...failingCall('b'),
      ...failingCall('c'),
    ]
    // When the fold runs, Then it reports an echo loop.
    const verdict = foldGuardSignal(events)
    expect(verdict.signal).toBe('echo')
  })

  it('operator sees the echo streak reset on success or a different call', () => {
    // Given two failures, a success, then two more failures.
    const recovered = [
      ...failingCall('a'),
      ...failingCall('b'),
      { type: 'tool/call', data: { name: 'bash', callId: 'ok1', arguments: '{"cmd":"pytest"}' } },
      { type: 'tool/result', data: { callId: 'ok1', message: { content: [{ type: 'text', text: 'passed' }] } } },
      ...failingCall('c'),
      ...failingCall('d'),
    ]
    // When the fold runs, Then the success reset the streak and no echo fires.
    expect(foldGuardSignal(recovered).signal).toBeUndefined()
    // Given calls where no three in a row share one signature.
    const different = [
      ...failingCall('a'),
      ...failingCall('b', 'bash', '{"cmd":"ls"}'),
      ...failingCall('c', 'bash', '{"cmd":"ls"}'),
    ]
    // When the fold runs, Then the echo streak never completes.
    expect(foldGuardSignal(different).signal).toBeUndefined()
  })

  it('operator can tune the thresholds', () => {
    // Given streams under the default floors and caps.
    const sub8k = [...step(3000, {})]
    const slow = [...step(300, {}), ...step(300, {}), ...step(300, {})]
    // When the fold runs with a lower character floor or a lower slow-burn cap,
    // Then each fires on the ladder it tunes.
    expect(foldGuardSignal(sub8k, { stallReasoningChars: 2000 }).signal).toBe('stall')
    expect(foldGuardSignal(slow, { globalStallCap: 3 }).signal).toBe('stall')
  })
})

describe('guard resolveThresholds (adaptive by effort and sensitivity)', () => {
  it('operator sees the floor follow the current reasoning effort', () => {
    // Given each named effort and an unknown one.
    // When thresholds resolve, Then the floor follows the budget the model was
    // asked to spend: lowest at max (where runaways happen), highest at low.
    expect(resolveThresholds({ effort: 'max' }).stallReasoningChars).toBe(STALL_REASONING_CHARS_BY_EFFORT.max)
    expect(resolveThresholds({ effort: 'high' }).stallReasoningChars).toBe(STALL_REASONING_CHARS_BY_EFFORT.high)
    expect(resolveThresholds({ effort: 'low' }).stallReasoningChars).toBe(STALL_REASONING_CHARS_BY_EFFORT.low)
    expect(resolveThresholds({ effort: 75 }).stallReasoningChars).toBe(DEFAULT_STALL_REASONING_CHARS)
    expect(resolveThresholds({}).stallReasoningChars).toBe(DEFAULT_STALL_REASONING_CHARS)
  })

  it('operator can scale every threshold with a sensitivity preset', () => {
    // Given the balanced default and the two other presets at max effort.
    // When thresholds resolve, Then conservative raises and aggressive lowers
    // both the floor and the slow-burn cap, never below their minimums.
    expect(resolveThresholds({ effort: 'max', sensitivity: 'conservative' }).stallReasoningChars).toBe(12000)
    expect(resolveThresholds({ effort: 'max', sensitivity: 'balanced' }).stallReasoningChars).toBe(8000)
    expect(resolveThresholds({ effort: 'max', sensitivity: 'aggressive' }).stallReasoningChars).toBe(4000)
    expect(resolveThresholds({ sensitivity: 'conservative' }).globalStallCap).toBe(6)
    expect(resolveThresholds({ sensitivity: 'balanced' }).globalStallCap).toBe(4)
    expect(resolveThresholds({ sensitivity: 'aggressive' }).globalStallCap).toBe(2)
  })

  it('operator fine-tuning overrides win over the adaptive table', () => {
    // Given an explicit override for each threshold.
    // When thresholds resolve, Then the override beats the effort table and the
    // sensitivity scale for that field only.
    expect(resolveThresholds({ effort: 'max', stallReasoningChars: 5000 }).stallReasoningChars).toBe(5000)
    expect(resolveThresholds({ globalStallCap: 7 }).globalStallCap).toBe(7)
    expect(resolveThresholds({ echoFailures: 9 }).echoFailures).toBe(9)
    // Untouched fields still follow the table.
    expect(resolveThresholds({ effort: 'low', stallReasoningChars: 5000 }).globalStallCap).toBe(4)
  })

  it('operator sees the fold honour the resolved floor per effort', () => {
    // Given one zero-output step of 9000 reasoning chars.
    const events = [...step(9000, {})]
    // When the fold runs at max effort's floor versus low effort's floor, Then
    // the same step trips the max-effort ladder but stays under the low one.
    expect(foldGuardSignal(events, resolveThresholds({ effort: 'max' })).signal).toBe('stall')
    expect(foldGuardSignal(events, resolveThresholds({ effort: 'low' })).signal).toBeUndefined()
  })
})

describe('guard stepDownEffort', () => {
  it('operator steps one notch down the ladder and leaves unknown levels alone', () => {
    // Given the known ladder and levels outside it.
    // When a step-down is computed, Then known levels move one notch and the rest stay untouched.
    expect(stepDownEffort('max')).toBe('high')
    expect(stepDownEffort('high')).toBe('low')
    expect(stepDownEffort('low')).toBeUndefined()
    expect(stepDownEffort('off')).toBeUndefined()
    expect(stepDownEffort(undefined)).toBeUndefined()
    expect(stepDownEffort(75)).toBeUndefined()
  })
})

describe('guard renderGuardMessage', () => {
  it('operator reads the interrupted pattern named for each signal', () => {
    // Given each verdict, When the message renders, Then it names the pattern and the breaker.
    expect(renderGuardMessage({ signal: 'stall' })).toContain('no tool call')
    expect(renderGuardMessage({ signal: 'echo' })).toContain('identical arguments')
    expect(renderGuardMessage({ signal: 'stall' })).toContain('[Circuit Breaker]')
  })
})

describe('guard plugin identity', () => {
  it('operator can rely on the stable cordis plugin name', () => {
    // Given the plugin module, When its name is read, Then it is the stable id.
    expect(name).toBe('liangshen-guard')
  })
})
