// @vitest-environment jsdom
/** Session-id footer entry: icon-only trigger in both wide and rail modes. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SessionIdEntry } from '../src/client/SessionIdEntry.tsx'
import { zh, type SessionIdKey } from '../src/client/locales.ts'

/** Minimal translate over the zh dictionary. */
function makeTranslate() {
  return (key: string) => zh[key as SessionIdKey] ?? key
}

/** Minimal sessions-list read source (empty snapshot). */
function makeList() {
  return {
    getSnapshot: () => ({
      ids: [],
      byId: {},
      phase: 'ready',
      projectionsBySession: {},
    }),
    subscribe: () => () => {},
  } as never
}

afterEach(() => {
  cleanup()
})

describe('SessionIdEntry', () => {
  it.each([true, false])('renders an icon-only trigger when wide=%s', (wide) => {
    render(<SessionIdEntry wide={wide} list={makeList()} t={makeTranslate()} />)
    // The label survives only as the accessible name / tooltip, never as
    // visible text content beside the icon.
    const trigger = screen.getByRole('button', { name: zh['entry.label'] })
    expect(trigger.textContent).toBe('')
    expect(trigger.getAttribute('title')).toBe(zh['entry.label'])
    expect(trigger.querySelector('svg')).toBeTruthy()
    expect(trigger.getAttribute('data-dsh-plugin')).toBe('session-id')
    expect(trigger.getAttribute('data-dsh-part')).toBe('entry')
  })
})
