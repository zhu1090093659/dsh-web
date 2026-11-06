// @vitest-environment jsdom
/**
 * The member actions: 点播 (start the member's own session), 打开会话, and the
 * member form that writes through the same frozen contract.
 *
 * Every failure the run flow can meet is driven here through the injected
 * transport, so the card's honesty about a refused run (unknown preset, no
 * workspace, missing route) is a rendered sentence, not a promise.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { AgentsPage } from '../src/client/AgentsPage.tsx'
import { AgentsApiError } from '../src/client/host-api.ts'
import { t } from '../src/client/locales.ts'
import { buttonByText, click, flush, mount, typeInto, unmountAll } from './render.tsx'
import { fakeTransport, memberOf, runOf, stateOf, teamOf } from './agents-fixtures.ts'
import type { MemberDraft } from '../src/protocol.ts'

afterEach(() => { unmountAll() })

/** The one element matching a selector, failing loudly when it is absent. */
function must(container: ParentNode, selector: string): Element {
  const found = container.querySelector(selector)
  if (found === null) throw new Error('no element matching ' + selector)
  return found
}

/** Open the single squad of a one-squad page. */
function openSquad(container: HTMLElement): void {
  click(must(container, '[aria-label="' + t('list.open', { name: 'Squad one' }) + '"]'))
}

describe('agents member actions', () => {
  it('operator sees a run start one member session and its id reported on the card', async () => {
    // Given a squad with one member and a Host that starts a session for it
    const transport = fakeTransport({
      state: async () => stateOf([teamOf({ members: [memberOf()] })]),
      run: async () => runOf({ sessionId: 'session-42' }),
    })
    const view = mount(<AgentsPage transport={transport} />)
    await flush()
    openSquad(view.container)
    // When the member is started
    click(buttonByText(view.container, t('member.run')))
    await flush()
    // Then the card reports the session it opened and the Host was asked once
    const card = must(view.container, '[data-dsh-part="member-card"]')
    expect(card.textContent).toContain(t('member.runStarted', { session: 'session-42' }))
    expect(transport.runs).toBe(1)
  })

  it('operator sees a refused run explained in the card, not as a status code', async () => {
    // Given a Host that refuses the run because the pinned preset is unknown
    const transport = fakeTransport({
      state: async () => stateOf([teamOf({ members: [memberOf({ preset: 'missing-preset' })] })]),
      run: async () => { throw new AgentsApiError('unknown-preset', t('error.unknownPreset')) },
    })
    const view = mount(<AgentsPage transport={transport} />)
    await flush()
    openSquad(view.container)
    // When the member is started
    click(buttonByText(view.container, t('member.run')))
    await flush()
    // Then the card carries the refusal copy and still offers the action
    const alert = must(view.container, '[data-dsh-part="member-card"] [role="alert"]')
    expect(alert.textContent).toBe(t('error.unknownPreset'))
    expect(buttonByText(view.container, t('member.run')).tagName).toBe('BUTTON')
  })

  it('operator sees the open-session action only once the member has a session', async () => {
    // Given a member with one recorded run, and a deployment that can open it
    const opened: string[] = []
    const transport = fakeTransport({
      state: async () => stateOf([teamOf({ members: [memberOf()] })], [runOf({ sessionId: 'session-7' })]),
    })
    const view = mount(<AgentsPage transport={transport} openSession={(sessionId: string) => { opened.push(sessionId) }} />)
    await flush()
    openSquad(view.container)
    // When the action is used
    click(buttonByText(view.container, t('member.openSession')))
    // Then the GUI is asked to switch to that exact session
    expect(opened).toEqual(['session-7'])
  })

  it('operator sees the action present but disabled, with the reason, when the deployment serves no opener', async () => {
    // Given a member with a run, and a deployment that wires no session opener
    const transport = fakeTransport({
      state: async () => stateOf([teamOf({ members: [memberOf()] })], [runOf({ sessionId: 'session-7' })]),
    })
    // When the card renders
    const view = mount(<AgentsPage transport={transport} />)
    await flush()
    openSquad(view.container)
    // Then the card still shows the run and the action, so the session it names
    // is visible...
    expect(must(view.container, '[data-dsh-part="member-card"]').textContent).toContain(t('member.status.running'))
    const action = buttonByText(view.container, t('member.openSession'))
    // ...and the action is disabled and says WHY it cannot open anything
    expect(action.disabled).toBe(true)
    expect(action.getAttribute('title')).toBe(t('member.openSessionUnavailable'))
  })

  it('operator sees the action stay absent on a member that never ran', async () => {
    // Given a member with no recorded run and an opener the page could use
    const transport = fakeTransport({ state: async () => stateOf([teamOf({ members: [memberOf()] })]) })
    // When the card renders
    const view = mount(<AgentsPage transport={transport} openSession={() => {}} />)
    await flush()
    openSquad(view.container)
    // Then there is no session to open, so no action is offered at all
    expect(view.container.textContent).not.toContain(t('member.openSession'))
  })

  it('operator sees the member form save a draft through the contract', async () => {
    // Given a squad and a Host that accepts a member upsert
    const saved: MemberDraft[] = []
    const transport = fakeTransport({
      state: async () => stateOf([teamOf({ members: [] })]),
      saveMember: async (_teamId: string, draft: MemberDraft) => {
        saved.push(draft)
        return teamOf({ members: [memberOf({ name: draft.name })] })
      },
    })
    const view = mount(<AgentsPage transport={transport} />)
    await flush()
    openSquad(view.container)
    // When the add-member form is opened and filled with only a name
    click(buttonByText(view.container, t('detail.addMember')))
    const form = must(view.container, '[data-dsh-part="member-form"]')
    typeInto(must(form, 'input') as HTMLInputElement, 'Newcomer')
    click(buttonByText(view.container, t('form.create')))
    await flush()
    // Then the draft carries the typed name and leaves every optional field
    // empty for the Host to inherit
    expect(saved.length).toBe(1)
    expect(saved[0].name).toBe('Newcomer')
    expect(saved[0].preset).toBe('')
    expect(saved[0].permission).toBeUndefined()
    expect(view.container.querySelector('[data-dsh-part="member-form"]')).toBeNull()
  })
})
