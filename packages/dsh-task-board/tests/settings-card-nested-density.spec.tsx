// @vitest-environment jsdom
/**
 * The task-board settings card as one first-level card whose two topics are
 * nested cards: every topic root carries the shared shell's nested chrome class
 * and the card hosting them carries the first-level chrome instead, so the two
 * densities stay distinguishable in the rendered tree.
 */
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PluginSettingsCard } from '../src/client/PluginSettingsCard.tsx'
import cardCss from '../src/client/settings-card.module.css'
import { zh } from '../src/client/locales.ts'
import {
  cardProps,
  header,
  mount,
  render,
  setupCardEnvironment,
  shellProps,
  teardownCardEnvironment,
} from './settings-card-harness.tsx'

beforeEach(setupCardEnvironment)
afterEach(teardownCardEnvironment)

/** The card root (its `li`) that carries one disclosure header. */
function cardRoot(container: HTMLElement, label: string): HTMLLIElement {
  const root = header(container, label).closest('li')
  if (!(root instanceof HTMLLIElement)) throw new Error(`the "${label}" header sits in no card root`)
  return root
}

/** The two topics the card nests, in their documented order. */
function topicLabels(): string[] {
  return [
    zh['settings.enabledTopic'],
    zh['settings.cardDefaultsTitle'],
  ]
}

describe('task-board settings card nested topic density', () => {
  it('operator expanding the card sees its two topics nested in one hosting card at first level', () => {
    // Given the settings card rendered from its slot
    const container = render(cardProps())

    // When the operator expands the card to reach the topic list
    act(() => { header(container, zh['settings.title']).click() })

    // Then each of the two topics carries the nested chrome class of the
    // shared shell, and the card hosting them carries none of it, so the
    // topics read as the hosting card's children and not as its siblings
    for (const topic of topicLabels()) {
      expect(cardRoot(container, topic).classList.contains(cardCss.cardNested)).toBe(true)
    }
    const hosting = cardRoot(container, zh['settings.title'])
    expect(hosting.classList.contains(cardCss.cardNested)).toBe(false)

    // ...and the two are siblings in one list that the hosting card contains
    const list = cardRoot(container, topicLabels()[0] ?? '').parentElement
    expect(list?.tagName).toBe('UL')
    expect(list?.children).toHaveLength(topicLabels().length)
    expect(hosting.contains(list)).toBe(true)
  })

  it('operator reading a first-level card sees no nested chrome until the nested variant is asked for', () => {
    // Given two mounts of the same shared shell, one first level and one nested
    const firstLevel = mount(<PluginSettingsCard {...shellProps()} />)
    const nested = mount(<PluginSettingsCard {...shellProps({ density: 'nested' })} />)

    // When the operator looks at each card root
    const hostRoot = firstLevel.querySelector('li')
    const nestedRoot = nested.querySelector('li')

    // Then only the card asked for the nested variant carries that chrome,
    // while both keep the card chrome every settings card shares
    expect(hostRoot?.classList.contains(cardCss.cardNested)).toBe(false)
    expect(nestedRoot?.classList.contains(cardCss.cardNested)).toBe(true)
    expect(hostRoot?.classList.contains(cardCss.card)).toBe(true)
    expect(nestedRoot?.classList.contains(cardCss.card)).toBe(true)
  })
})
