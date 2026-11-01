/**
 * The settings section's rendering.
 *
 * The block lives in the board's own topic list, so what it renders is not free
 * form: it has to be one nested settings card, closed on arrival, whose rows are
 * the shared field grid. This file pins exactly that, because the shipped block
 * was a bare `<div>` straight into the board's `<ul>` — no card chrome, always
 * open, and flex rows in which the `width: 100%` input squeezed every label into
 * a character-per-line column.
 *
 * The card owns the disclosure, so the form is asserted through its own
 * component: a closed card renders no body at all.
 *
 * Static markup is enough for the question being asked (which elements the
 * section emits and how they are nested); the pixel-level result is checked in
 * the GUI, not here. React warns that `useLayoutEffect` does nothing on the
 * server — the card's disclosure effect is client-only, so that warning is
 * expected in this file.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import card from '../src/client/settings-card.module.css'
import styles from '../src/client/team/team.module.css'
import { TeamSettingsBody, TeamSettingsSection } from '../src/client/team/settings.tsx'
import { acceptPublishedSummaries, clearSummary } from '../src/client/team/summary.ts'
import { zh } from '../src/client/locales.ts'

/** Render the section the board's settings seat mounts. */
function renderSection(): string {
  return renderToStaticMarkup(<TeamSettingsSection dispatch={async () => true} />)
}

/** Render the card's body, which a reader sees after opening the card. */
function renderBody(): string {
  return renderToStaticMarkup(<TeamSettingsBody dispatch={async () => true} onSaved={() => {}} />)
}

/** Every id an input declares, and every id a label points at. */
function idPairs(html: string): { inputs: string[]; labels: string[] } {
  const inputs = [...html.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map(match => match[1] ?? '')
  const labels = [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map(match => match[1] ?? '')
  return { inputs, labels }
}

afterEach(() => {
  clearSummary()
})

describe('settings section', () => {
  it('member sees the block render as one card of the board topic list', () => {
    // Given the board's settings seat
    // When the section renders
    const html = renderSection()

    // Then the family card chrome owns the root, so the list keeps its card
    // rhythm instead of receiving a bare block
    expect(html.startsWith('<li')).toBe(true)
    expect(html).toContain(card.cardNested)
  })

  it('member sees the card closed on arrival', () => {
    // Given the board's settings seat
    // When the section renders
    const html = renderSection()

    // Then the topic list opens collapsed, and the form is not mounted until a
    // reader opens this topic
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('task-board-team-hub')
  })

  it('member sees every row of the opened card laid out by the shared field grid', () => {
    // Given the card body a reader opens
    // When it renders
    const html = renderBody()

    // Then each row is a shared field, not the hand-rolled flex row whose
    // trailing input took the whole line
    const fields = html.split('class="' + card.field + '"').length - 1
    expect(fields).toBeGreaterThanOrEqual(6)
    expect(html).not.toContain('class="' + styles.row + '"')
  })

  it('member sees each control bound to its own label', () => {
    // Given the card body a reader opens
    // When it renders
    const { inputs, labels } = idPairs(renderBody())

    // Then the five inputs are reachable by name, and none of them is wrapped
    // inside a label (which is what left the label no room to render)
    expect(inputs).toHaveLength(5)
    for (const id of inputs) expect(labels).toContain(id)
  })

  it('member sees an unavailable capability explained under its name', () => {
    // Given a deployment that serves no preset pinning
    acceptPublishedSummaries({
      'task-board-team': {
        connection: { state: 'idle', reconnects: 0 },
        capabilities: { followUp: true, rework: true, run: true },
      },
    })

    // When the card body renders
    const html = renderBody()

    // Then the row reports the gap and carries the reason as its hint, instead
    // of running the sentence into the label beside it
    expect(html).toContain(zh['section.capability.presetPinMissing'])
    expect(html).toContain('class="' + card.hint + '"')
  })
})
