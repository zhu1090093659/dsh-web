// @vitest-environment jsdom
/**
 * The task-board settings card as an operator meets it: the card's own topics
 * are nested disclosure cards (the board and its runtime behavior, the
 * new-card defaults) beside the provider seat an external integration
 * contributes into, and every one of them starts collapsed.
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import {
  PROVIDER_CARD_LABEL,
  cardProps,
  header,
  headers,
  render,
  setupCardEnvironment,
  teardownCardEnvironment,
  titles,
} from './settings-card-harness.tsx'

beforeEach(setupCardEnvironment)
afterEach(teardownCardEnvironment)

describe('task-board settings card disclosure', () => {
  it('operator opening the settings page sees one collapsed board card and no controls before expanding', () => {
    // Given the settings card rendered from the family plugin seat
    const container = render(cardProps())

    // When the operator has not opened anything
    // Then the card itself is a single collapsed disclosure that renders no
    // controls, so the settings page opens as a list of topics
    const all = headers(container)
    expect(all).toHaveLength(1)
    expect(all[0]?.textContent).toContain(zh['settings.title'])
    expect(all[0]?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('#settings-task-board-enabled')).toBeNull()
  })

  it('operator tells the board card apart from its topics by the glyph leading its header', () => {
    // Given the expanded settings card with its board topic
    const container = render(cardProps())
    act(() => { header(container, zh['settings.title']).click() })

    // When the operator scans the disclosure headers
    const board = header(container, zh['settings.title'])
    const topic = header(container, zh['settings.enabledTopic'])

    // Then the plugin card leads with a decorative glyph before its title,
    // while a nested topic keeps the plain header shape without one
    const mark = board.firstElementChild
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
    expect(mark?.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    expect(mark?.nextElementSibling?.textContent).toContain(zh['settings.title'])
    expect(topic.firstElementChild?.getAttribute('aria-hidden')).toBeNull()
    expect(topic.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0)
  })

  it('operator expanding the board card finds every topic collapsed in its documented order', () => {
    // Given the collapsed settings card of a deployment whose provider seat
    // contributes one card
    const container = render(cardProps(true))

    // When the operator opens it
    act(() => { header(container, zh['settings.title']).click() })

    // Then the topics stand collapsed under it in the order board,
    // new-card defaults, provider card, and nothing is expanded yet
    const topics = headers(container)
    expect(topics).toHaveLength(4)
    expect(topics[1]?.textContent).toContain(zh['settings.enabledTopic'])
    expect(topics[2]?.textContent).toContain(zh['settings.cardDefaultsTitle'])
    expect(topics[3]?.textContent).toContain(PROVIDER_CARD_LABEL)
    expect(topics[0]?.getAttribute('aria-expanded')).toBe('true')
    for (const topic of topics.slice(1)) expect(topic.getAttribute('aria-expanded')).toBe('false')
  })

  it('operator expanding the board topic reaches the master switch without opening the other topics', () => {
    // Given the expanded settings card
    const container = render(cardProps())
    act(() => { header(container, zh['settings.title']).click() })

    // When the operator opens the board topic
    act(() => { header(container, zh['settings.enabledTopic']).click() })

    // Then its own controls are editable and show the stored board values, the
    // runtime-behavior fields sit with them, and the sibling topics stayed closed
    expect(header(container, zh['settings.enabledTopic']).getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('#settings-task-board-enabled [aria-pressed="true"]')?.textContent).toBe(zh['settings.on'])
    expect(container.querySelector('#settings-task-board-announce [aria-pressed="true"]')?.textContent).toBe(zh['settings.inherit'])
    expect(container.querySelector('#settings-task-board-prevent-idle-sleep [aria-pressed="true"]')?.textContent).toBe(zh['settings.inherit'])
    expect(container.querySelector('#settings-task-board-subtask-depth')?.textContent).toBe(zh['settings.inherit'])
    expect(header(container, zh['settings.cardDefaultsTitle']).getAttribute('aria-expanded')).toBe('false')
  })

  it('operator expanding the board topic reaches the run-launch width with its batch hint', () => {
    // Given the expanded settings card with a stored admission width
    const container = render(cardProps(false, '8'))
    act(() => { header(container, zh['settings.title']).click() })
    expect(container.querySelector('#settings-task-board-run-launch-width')).toBeNull()

    // When the operator opens the board topic
    act(() => { header(container, zh['settings.enabledTopic']).click() })

    // Then the width is editable beside the depth limit, shows the stored value,
    // and explains in one line that waiting members still start (they only
    // start in batches), with the batch reasoning kept on its hover title
    const width = container.querySelector<HTMLInputElement>('#settings-task-board-run-launch-width')
    expect(width?.type).toBe('text')
    expect(width?.value).toBe('8')
    expect(container.textContent).toContain(zh['settings.runLaunchWidth'])
    expect(container.textContent).toContain(zh['settings.runLaunchWidthHintBrief'])
    expect(titles(container)).toContain(zh['settings.runLaunchWidthHint'])
    // ...and it sits with the runtime-behavior field beside it, whose own
    // rendered copy is what the operator reads there
    const pollLabel = container.querySelector<HTMLLabelElement>('label[for="settings-task-board-session-poll"]')
    expect(pollLabel?.textContent).toBe(zh['settings.sessionPollSeconds'])
  })

  it('operator expanding the new-card-defaults topic reaches the four prefill fields', () => {
    // Given the expanded settings card with the defaults topic still closed
    const container = render(cardProps())
    act(() => { header(container, zh['settings.title']).click() })
    expect(container.querySelector('#settings-task-board-card-default-mode')).toBeNull()

    // When the operator opens the new-card-defaults topic
    act(() => { header(container, zh['settings.cardDefaultsTitle']).click() })

    // Then the four prefills are there, each resting on the choice that applies
    // no default at all, and the sibling topics stayed closed
    const mode = container.querySelector<HTMLSelectElement>('#settings-task-board-card-default-mode')
    expect(mode?.tagName).toBe('SELECT')
    expect([...(mode?.options ?? [])].map(option => option.value)).toEqual([''])
    expect(mode?.options[0]?.textContent).toBe(zh['exec.mode.inherit'])
    expect(container.querySelector('#settings-task-board-card-default-permission')?.textContent).toBe(zh['exec.permission.default'])
    expect(container.querySelector('#settings-task-board-card-default-model')?.textContent).toBe(zh['exec.model.default'])
    expect(container.querySelector('#settings-task-board-card-default-effort')?.textContent).toBe(zh['exec.reasoning.inherit'])
    expect(header(container, zh['settings.enabledTopic']).getAttribute('aria-expanded')).toBe('false')
  })

  it('operator sees the provider seat rendered inside the same topic list as the board topics', () => {    // Given a settings card whose provider seat contributes one entry
    // When the operator expands the settings card
    const container = render(cardProps(true))
    act(() => { header(container, zh['settings.title']).click() })

    // Then the contributed card is a sibling of the board's own topics
    const seats = container.querySelectorAll('[data-testid="provider-seat"]')
    expect(seats).toHaveLength(1)
    expect(seats[0]?.parentElement?.tagName).toBe('UL')
    expect(seats[0]?.parentElement?.children).toHaveLength(3)
  })
})