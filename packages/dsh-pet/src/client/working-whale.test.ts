// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mountWorkingWhale } from './working-whale.ts'

function status(text = 'Deep diving...'): HTMLElement {
  const flow = document.createElement('div')
  flow.dataset.chatFlow = ''
  const element = document.createElement('div')
  element.setAttribute('role', 'status')
  element.setAttribute('aria-live', 'polite')
  element.append(text)
  flow.appendChild(element)
  document.body.appendChild(flow)
  return element
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('working whale activity ornament', () => {
  it('mounts once before the native status text without changing its announcement', () => {
    const element = status()
    const dispose = mountWorkingWhale()
    const ornaments = element.querySelectorAll('[data-dsh-pet-working-whale]')

    expect(ornaments).toHaveLength(1)
    expect(ornaments[0]?.getAttribute('aria-hidden')).toBe('true')
    expect(ornaments[0]?.nextSibling?.textContent).toBe('Deep diving...')
    expect(element.getAttribute('role')).toBe('status')
    expect(element.getAttribute('aria-live')).toBe('polite')

    dispose()
    expect(element.querySelector('[data-dsh-pet-working-whale]')).toBeNull()
  })

  it('decorates late status rows and self-heals after a React-style child replacement', async () => {
    const dispose = mountWorkingWhale()
    const element = status()
    await Promise.resolve()
    expect(element.querySelectorAll('[data-dsh-pet-working-whale]')).toHaveLength(1)

    element.querySelector('[data-dsh-pet-working-whale]')?.remove()
    await Promise.resolve()
    expect(element.querySelectorAll('[data-dsh-pet-working-whale]')).toHaveLength(1)

    element.appendChild(document.createElement('span'))
    await Promise.resolve()
    expect(element.querySelectorAll('[data-dsh-pet-working-whale]')).toHaveLength(1)
    dispose()
  })

  it('ignores other live regions and stops observing after disposal', async () => {
    const other = status('Loading history...')
    const dispose = mountWorkingWhale()
    expect(other.querySelector('[data-dsh-pet-working-whale]')).toBeNull()

    dispose()
    const late = status()
    await Promise.resolve()
    expect(late.querySelector('[data-dsh-pet-working-whale]')).toBeNull()
  })
})
