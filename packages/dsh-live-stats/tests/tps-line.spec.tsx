/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import { ensureMergeCss, MERGE_CSS } from '../src/client/merge-css.ts'
import { TpsLine, formatTokensPerSecond } from '../src/client/TpsLine.tsx'

afterEach(cleanup)

const live = ((key: string): unknown => key === 'liveTokenUsage'
  ? {
    estimated: true,
    uncachedInputTokens: 10,
    outputTokens: 8,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    tokensPerSecond: 42.64,
  }
  : undefined) as UseProjection

describe('TPS composer line', () => {
  it('formats stable compact rates', () => {
    expect(formatTokensPerSecond(42.64)).toBe('42.6')
    expect(formatTokensPerSecond(142.64)).toBe('143')
  })

  it('keeps the merge slot mounted, empty until a rate sample exists', () => {
    const absent = ((key: string): unknown => key === 'liveTokenUsage'
      ? { estimated: true, uncachedInputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }
      : undefined) as UseProjection
    const view = render(<TpsLine useProjection={absent} />)
    // The slot stays mounted while idle: the merge layout keys on its
    // presence, so an unmount would flip the official stats row between
    // content width and full width on every stream start/end.
    const slot = view.container.querySelector('[data-dsh-live-tps]')
    expect(slot).not.toBeNull()
    expect(slot?.textContent).toBe('')

    view.rerender(<TpsLine useProjection={live} />)
    expect(view.container.querySelector('[data-dsh-live-tps]')?.textContent).toBe('TPS 42.6 tok/s')
  })

  it('anchors the row with the data-dsh-live-tps merge hook', () => {
    const view = render(<TpsLine useProjection={live} />)
    const row = view.container.querySelector('[data-dsh-live-tps]')
    expect(row).not.toBeNull()
    expect(row?.textContent).toBe('TPS 42.6 tok/s')
  })
})

describe('TPS merge stylesheet', () => {
  it('anchors on the dock wrapper with flat, parse-safe selectors', () => {
    // The slot renderer wraps dock entries in div[data-slot="conversation.composer.dock"];
    // nested :has() fails to parse (rules silently dropped), so the merge uses
    // the plain sibling combinator for the TPS and a flat :has for the row.
    expect(MERGE_CSS).not.toContain(':has(> *:has(')
    // The wrapper merge is scoped to the moment the TPS slot is mounted, so
    // the stylesheet never restyles the dock while the plugin is inactive.
    expect(MERGE_CSS).toContain('div[data-slot="conversation.composer.dock"]:has(> [data-dsh-live-tps])')
    expect(MERGE_CSS).toContain('div[data-slot="conversation.composer.dock"] > *:not([role="tooltip"]):has(+ [data-dsh-live-tps]')
    // also matches when the official Tooltip bubble is inserted between the
    // stats row and the TPS (hover/focus) — otherwise the row reverts to its
    // official full-width styles and pushes the TPS away.
    expect(MERGE_CSS).toContain('+ [role="tooltip"] + [data-dsh-live-tps]')
    expect(MERGE_CSS).toContain('div[data-slot="conversation.composer.dock"] > * + [data-dsh-live-tps]')
    // The wrapper becomes a horizontal flex row (overriding the renderer's
    // inline display: contents), so the pair is one centered line.
    expect(MERGE_CSS).toContain('display: flex !important')
    expect(MERGE_CSS).toContain('flex-direction: row')
    expect(MERGE_CSS).toContain('flex-wrap: nowrap')
    expect(MERGE_CSS).toContain('justify-content: center')
  })

  it('never wraps: nowrap + capped official row that ellipsizes', () => {
    expect(MERGE_CSS).not.toContain('flex-wrap: wrap')
    // The 620px cap keeps the merged unit compact on wide docks; narrow
    // containers rely on flex shrink (0 1 auto + min-width: 0), so no
    // container-relative calc that could go negative is involved.
    expect(MERGE_CSS).toContain('max-width: 620px')
    expect(MERGE_CSS).not.toContain('calc(100% - 150px)')
    expect(MERGE_CSS).toContain('min-width: 0')
  })

  it('hides the separator while the slot is empty (idle layout stays stable)', () => {
    expect(MERGE_CSS).toContain('[data-dsh-live-tps]:empty::before')
    expect(MERGE_CSS).toContain('content: none')
  })

  it('injects the stylesheet once under a stable tag', () => {
    ensureMergeCss()
    ensureMergeCss()
    const tags = document.querySelectorAll('style[data-dsh-live-stats-merge]')
    expect(tags.length).toBe(1)
    expect(tags[0]?.textContent).toContain('display: flex !important')
  })
})
