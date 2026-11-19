/**
 * The run log: increments in, a bounded window of rows out.
 *
 * Three properties matter to a reader and are pinned here: a running log grows
 * as increments arrive, a duplicate increment changes nothing, and a hundred
 * thousand lines still mount a few dozen rows. The last one is measured rather
 * than asserted by impression — the numbers are printed by the run so the
 * report can quote them.
 */
import { describe, expect, it } from 'vitest'
import { SshLogBuffer, visibleLogWindow, type LogViewport } from '../src/client/ssh/log-buffer.ts'

/** A viewport showing twelve rows of eighteen pixels. */
const VIEWPORT: LogViewport = { scrollTop: 0, height: 216, rowHeight: 18, overscan: 8 }

describe('log increments', () => {
  it('a growing run appends only what it has not seen', () => {
    // Given a buffer that has read the first increment of a run
    const buffer = new SshLogBuffer()
    expect(buffer.append({ runId: 'r1', baseOffset: 0, endOffset: 11, text: 'line one\nli' })).toBe(true)

    // When the provider publishes the continuation
    expect(buffer.append({ runId: 'r1', baseOffset: 11, endOffset: 21, text: 'ne two\nli' })).toBe(true)

    // Then the partial line was continued rather than split
    expect(buffer.toLines()).toEqual(['line one', 'line two', 'li'])
    expect(buffer.snapshot()).toMatchObject({ runId: 'r1', start: 0, end: 21, truncated: false })
  })

  it('a replayed increment changes nothing', () => {
    // Given a buffer holding one increment
    const buffer = new SshLogBuffer()
    buffer.append({ runId: 'r1', baseOffset: 0, endOffset: 9, text: 'only line' })

    // When the same window arrives again, as a mirror frame re-sends it
    const changed = buffer.append({ runId: 'r1', baseOffset: 0, endOffset: 9, text: 'only line' })

    // Then nothing was re-rendered and nothing was duplicated
    expect(changed).toBe(false)
    expect(buffer.toLines()).toEqual(['only line'])
  })

  it('a jump past the consumed offset keeps what it has and flags the gap', () => {
    // Given a buffer that has read a prefix
    const buffer = new SshLogBuffer()
    buffer.append({ runId: 'r1', baseOffset: 0, endOffset: 6, text: 'start\n' })

    // When the provider restarts its read further down the file
    buffer.append({ runId: 'r1', baseOffset: 4096, endOffset: 4100, text: 'late' })

    // Then the earlier line is still there and the gap is reported
    expect(buffer.toLines()).toEqual(['start', 'late'])
    expect(buffer.snapshot().truncated).toBe(true)
  })

  it('a different run starts a different log', () => {
    // Given a buffer holding a finished run
    const buffer = new SshLogBuffer()
    buffer.append({ runId: 'r1', baseOffset: 0, endOffset: 5, text: 'first' })

    // When a re-run publishes its own first increment
    buffer.append({ runId: 'r2', baseOffset: 0, endOffset: 6, text: 'second' })

    // Then the previous run's lines are gone and offsets restarted at zero
    expect(buffer.toLines()).toEqual(['second'])
    expect(buffer.snapshot()).toMatchObject({ runId: 'r2', start: 0, end: 6 })
  })

  it('a reset drops everything, which is what reopening the panel does', () => {
    // Given a buffer with content
    const buffer = new SshLogBuffer()
    buffer.append({ runId: 'r1', baseOffset: 0, endOffset: 3, text: 'abc' })

    // When the panel is reopened and the replay starts from the first byte
    buffer.reset('r1')
    buffer.append({ runId: 'r1', baseOffset: 0, endOffset: 3, text: 'abc' })

    // Then the log is exactly one copy of what was replayed
    expect(buffer.toLines()).toEqual(['abc'])
    expect(buffer.snapshot().start).toBe(0)
  })
})

describe('the mounted window', () => {
  it('mounts a bounded band around the scroll offset', () => {
    // Given a hundred thousand rows
    const total = 100_000

    // When the reader is at the top, and when they are deep in the log
    const top = visibleLogWindow(total, VIEWPORT)
    const deep = visibleLogWindow(total, { ...VIEWPORT, scrollTop: 18 * 50_000 })

    // Then both windows are bounded, and the surface still reports every row
    expect(top).toMatchObject({ start: 0, end: 20, offsetY: 0 })
    expect(deep.start).toBe(50_000 - 8)
    expect(deep.end - deep.start).toBeLessThanOrEqual(12 + 8 + 8)
    expect(deep.totalHeight).toBe(total * 18)
  })

  it('an empty log mounts nothing and a scroll past the end clamps', () => {
    // Given no rows, then a huge scroll offset
    const empty = visibleLogWindow(0, VIEWPORT)
    const clamped = visibleLogWindow(10, { ...VIEWPORT, scrollTop: 10_000 })

    // When the windows are computed
    // Then nothing hangs off either end
    expect(empty).toMatchObject({ start: 0, end: 0, offsetY: 0 })
    // Ten rows are shorter than the viewport, so there is nothing to scroll and
    // the whole log is mounted at the top.
    expect(clamped).toMatchObject({ start: 0, end: 10, offsetY: 0 })
  })
})

describe('a hundred thousand lines', () => {
  it('stays a bounded mount and a bounded scroll cost', () => {
    // Given a run whose log is a hundred thousand lines delivered in increments
    const lines = Array.from({ length: 100_000 }, (_unused, index) => `${String(index).padStart(6, '0')} step finished in 12ms`)
    const buffer = new SshLogBuffer()
    const startedAt = performance.now()
    let offset = 0
    for (let chunk = 0; chunk < lines.length; chunk += 500) {
      const text = lines.slice(chunk, chunk + 500).join('\n') + '\n'
      buffer.append({ runId: 'big', baseOffset: offset, endOffset: offset + text.length, text })
      offset += text.length
    }
    const appendMs = performance.now() - startedAt

    // When the reader scrolls through it
    const scrollStartedAt = performance.now()
    let mounted = 0
    for (let step = 0; step < 200; step++) {
      const window = visibleLogWindow(buffer.count, { ...VIEWPORT, scrollTop: (buffer.count * 18 / 200) * step })
      mounted = Math.max(mounted, window.end - window.start)
    }
    const scrollMs = performance.now() - scrollStartedAt

    // Then the buffer holds every line, the window never exceeds the band, and
    // both the append and two hundred scroll computations stay in single-digit
    // milliseconds per operation
    expect(buffer.count).toBe(100_000)
    expect(mounted).toBeLessThanOrEqual(30)
    expect(appendMs).toBeLessThan(2_000)
    expect(scrollMs).toBeLessThan(200)
    console.log(`[log] 100k lines: append ${appendMs.toFixed(1)}ms for 200 increments, ` +
      `200 scroll windows ${scrollMs.toFixed(1)}ms, mounted rows ${mounted} of ${buffer.count}`)
  })
})
