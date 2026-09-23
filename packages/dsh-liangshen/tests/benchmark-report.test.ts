/**
 * Report aggregation: the statistics a default decision would rest on.
 *
 * These tests pin what a reader cannot check by eye: that a task timeout counts
 * as a failure while a request-free run does not, that a single paired task does
 * not manufacture an interval, that a reused results directory cannot mix runs
 * from different baselines, and that the Markdown carries the treatment notes.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  aggregateGroups,
  buildReport,
  isInfrastructureFailure,
  meanConfidenceInterval,
  pairedComparison,
  renderMarkdown,
  runFileNames,
  wilsonInterval,
} from '../tools/benchmark-report.mjs'

const scratch: string[] = []

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liangshen-report-test-'))
  scratch.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function run(overrides: Record<string, unknown> = {}) {
  return {
    variant: 'B',
    taskId: 'task-1',
    passed: true,
    timedOut: false,
    requests: [{ seq: 1 }],
    usage: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 0, totalTokens: 120 },
    durationMs: 1000,
    toolCalls: 2,
    toolErrors: 0,
    humanInterventions: 0,
    approvalsAsked: 0,
    costUsd: null,
    ...overrides,
  }
}

function baseline(overrides: Record<string, unknown> = {}) {
  return {
    repository: { commit: 'abc' },
    presetSourceHash: 'hash',
    dshVersion: 'dsh 1',
    route: { provider: 'p', model: 'm', reasoningEffort: 'max' },
    taskRevision: { id: 'seed', version: 1, tasks: 2, hash: 'a'.repeat(64) },
    ...overrides,
  }
}

function writeRun(dir: string, name: string, record: Record<string, unknown>) {
  writeFileSync(join(dir, name), JSON.stringify(record), 'utf8')
}

describe('benchmark report statistics', () => {
  it('bounds a Wilson interval inside the unit range', () => {
    const interval = wilsonInterval(3, 3)!
    expect(interval.low).toBeGreaterThan(0)
    expect(interval.high).toBeLessThanOrEqual(1)
    expect(wilsonInterval(0, 0)).toBeNull()
  })

  it('reports a mean and interval for a small sample', () => {
    const interval = meanConfidenceInterval([0, 1, 1])!
    expect(interval.mean).toBeCloseTo(2 / 3, 6)
    expect(interval.low).toBeLessThan(interval.mean)
    expect(interval.high).toBeGreaterThan(interval.mean)
    expect(meanConfidenceInterval([])).toBeNull()
  })

  it('leaves the interval unestimable for a single observation', () => {
    expect(meanConfidenceInterval([0.5])).toEqual({ mean: 0.5, low: null, high: null, n: 1, sd: null })
  })

  it('classifies only request-free or ungraded runs as infrastructure failures', () => {
    expect(isInfrastructureFailure(run({ requests: [] }))).toBe(true)
    expect(isInfrastructureFailure(run({ passed: null }))).toBe(true)
    expect(isInfrastructureFailure(run({ timedOut: true, passed: false }))).toBe(false)
    expect(isInfrastructureFailure(run())).toBe(false)
  })

  it('keeps infrastructure failures out of the denominator but counts timeouts as failures', () => {
    const groups = aggregateGroups([
      run({ variant: 'B', passed: true }),
      run({ variant: 'B', passed: false, timedOut: true }),
      run({ variant: 'B', timedOut: true, passed: false, requests: [] }),
    ])
    expect(groups.B.sessions).toBe(3)
    expect(groups.B.graded).toBe(2)
    expect(groups.B.infrastructureFailures).toBe(1)
    expect(groups.B.timeouts).toBe(2)
    expect(groups.B.successRate).toBe(0.5)
  })

  it('pairs a comparison by task and reports the mean delta with its interval', () => {
    const runs = [
      run({ variant: 'B', taskId: 'a', passed: true }),
      run({ variant: 'B', taskId: 'a', passed: true }),
      run({ variant: 'P', taskId: 'a', passed: true }),
      run({ variant: 'P', taskId: 'a', passed: true }),
      run({ variant: 'B', taskId: 'b', passed: false }),
      run({ variant: 'B', taskId: 'b', passed: false }),
      run({ variant: 'P', taskId: 'b', passed: true }),
      run({ variant: 'P', taskId: 'b', passed: true }),
    ]
    const comparison = pairedComparison(runs, 'B', 'P')
    expect(comparison.tasks).toBe(2)
    expect(comparison.pairedMeanDelta).toBeCloseTo(0.5, 6)
    expect(comparison.insufficientEvidence).toBe(false)
    expect(comparison.low).toBeLessThan(comparison.high)
    expect(comparison.perTask.find((entry: { taskId: string }) => entry.taskId === 'b')?.delta).toBe(1)
  })

  it('reports no interval and flags insufficient evidence for one paired task', () => {
    const comparison = pairedComparison([
      run({ variant: 'B', taskId: 'a', passed: false }),
      run({ variant: 'P', taskId: 'a', passed: true }),
    ], 'B', 'P')
    expect(comparison.tasks).toBe(1)
    expect(comparison.pairedMeanDelta).toBe(1)
    expect(comparison.insufficientEvidence).toBe(true)
    expect(comparison.low).toBeNull()
    expect(comparison.high).toBeNull()
  })

  it('reduces a suite manifest path to its file name on either separator', () => {
    const names = runFileNames(scratchDir(), {
      runs: [{ file: 'C:\\tmp\\out\\live-B-t1-r1.json' }, { file: 'out/live-P-t1-r1.json' }],
    })
    expect(names).toEqual(['live-B-t1-r1.json', 'live-P-t1-r1.json'])
  })

  it('reads only the suite index records, so a reused directory cannot mix runs', () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'suite.json'), JSON.stringify({ baseline: baseline(), runs: [{ file: 'live-B-t1-r1.json' }] }), 'utf8')
    writeRun(dir, 'live-B-t1-r1.json', { variant: 'B', taskId: 't1', passed: true, requests: [{}], baseline: baseline() })
    // A leftover record from an earlier run in the same directory.
    writeRun(dir, 'live-P-t1-r1.json', { variant: 'P', taskId: 't1', passed: true, requests: [{}], baseline: baseline() })
    const report = buildReport(dir, 'B')
    expect(report.runs).toBe(1)
    expect(Object.keys(report.groups)).toEqual(['B'])
  })

  it('rejects a directory whose run records disagree on the baseline', () => {
    const dir = scratchDir()
    writeRun(dir, 'live-B-t1-r1.json', { variant: 'B', taskId: 't1', passed: true, requests: [{}], baseline: baseline() })
    writeRun(dir, 'live-P-t1-r1.json', {
      variant: 'P', taskId: 't1', passed: true, requests: [{}], baseline: baseline({ presetSourceHash: 'other' }),
    })
    expect(() => buildReport(dir, 'B')).toThrow(/mixes runs from different baselines/)
  })

  it('renders the timeouts column and the treatment notes a reader needs', () => {
    const markdown = renderMarkdown({
      generatedAt: '2026-09-13T00:00:00.000Z',
      baselineGroup: 'B',
      baseline: baseline(),
      suite: { stopReason: 'completed', sessions: 4 },
      groups: aggregateGroups([run()]),
      comparisons: [{ baseline: 'B', candidate: 'P', tasks: 1, pairedMeanDelta: 1, low: null, high: null, insufficientEvidence: true, perTask: [] }],
      runs: 1,
    })
    expect(markdown).toContain('# LiangShen V4.1 Flash comparison report')
    expect(markdown).toContain('Timeouts')
    expect(markdown).toContain('interval not estimable')
    expect(markdown).toContain('A task timeout counts as a task failure')
    expect(markdown).toContain('rejects a directory whose runs disagree')
    expect(markdown).toContain('Group N is the full native roster, not Minimal')
  })
})
