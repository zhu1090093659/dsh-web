// @vitest-environment jsdom
/**
 * The live team of the newest whole-squad run, and the run history beside it.
 *
 * The roster is read through `src/client/team-source.ts` off the Host's own
 * `subagentCatalog` projection, which lists the direct children of the Lead
 * session. These cases prove the catalog surface, the join between a teammate and
 * the member definition it runs as, that a live catalog update lands without a
 * page reload, that a deployment with no session catalog says so once, and that a
 * plain M1 member run keeps working exactly as it did.
 */
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentsPage } from '../src/client/AgentsPage.tsx'
import { t } from '../src/client/locales.ts'
import { catalogTeamSource, createTeamSource } from '../src/client/team-source.ts'
import type { SquadTeamSnapshot } from '../src/client/team-source.ts'
import { buttonByText, click, flush, mount, unmountAll } from './render.tsx'
import { fakeTeamSource, fakeTransport, memberOf, runOf, sessionListOf, squadRunOf, stateOf, subagentCatalogOf, teamOf } from './agents-fixtures.ts'

afterEach(() => {
  unmountAll()
})

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

describe('agents live team', () => {
  it('operator sees the Lead and its teammates with their status, model and permission', async () => {
    // Given a squad run whose Lead has already started one teammate
    const transport = fakeTransport({
      state: async () => stateOf([teamOf({ members: [memberOf()] })], [squadRunOf({ sessionId: 'lead-1' })]),
    })
    const teamSource = fakeTeamSource({
      state: 'ready',
      leadSessionId: 'lead-1',
      rows: [{ id: 'teammate-session-1', label: 'Reviewer', mode: 'continuable', createdAt: 1, running: true }],
    })
    const opened: string[] = []
    const view = mount(<AgentsPage transport={transport} teamSource={teamSource} openSession={(sessionId: string) => { opened.push(sessionId) }} />)
    await flush()
    // When the operator opens that squad
    openSquad(view.container)
    // Then the page followed exactly the Lead session of the newest squad run
    expect(teamSource.watches).toEqual(['lead-1'])
    const rows = view.container.querySelectorAll('[data-dsh-part="squad-team-row"]')
    expect(rows).toHaveLength(2)
    // And the Lead row names the squad, badges the role, and opens the Lead session
    expect(must(rows[0], 'h5').textContent).toBe('Squad one')
    expect(rows[0].textContent).toContain(t('squad.lead'))
    // And the teammate row carries the member name the Lead was told to pass plus its pins
    expect(rows[1].textContent).toContain('Reviewer')
    expect(rows[1].textContent).toContain(t('squad.teammate'))
    expect(rows[1].textContent).toContain(t('permission.read-only'))
    expect(rows[1].textContent).toContain('deepseek/deepseek-v4')
    // And its status is the Host's own activity report
    expect(must(rows[1], '[role="status"]').textContent).toBe(t('squad.status.running'))
    // And its session entry point opens exactly that teammate session
    click(buttonByText(rows[1] as HTMLElement, t('member.openSession')))
    expect(opened).toEqual(['teammate-session-1'])
  })

  it('operator sees a teammate appear without leaving the page', async () => {
    // Given a squad run whose Lead has started nobody yet
    const transport = fakeTransport({
      state: async () => stateOf([teamOf({ members: [memberOf()] })], [squadRunOf({ sessionId: 'lead-1' })]),
    })
    const teamSource = fakeTeamSource({ state: 'pending' })
    const view = mount(<AgentsPage transport={transport} teamSource={teamSource} />)
    await flush()
    openSquad(view.container)
    expect(must(view.container, '[data-dsh-part="squad-team-state"]').textContent).toBe(t('squad.livePending'))
    // When the Lead starts its first teammate
    act(() => {
      teamSource.publish({
        state: 'ready',
        leadSessionId: 'lead-1',
        rows: [{ id: 'teammate-session-2', label: 'Reviewer', mode: 'one-shot', createdAt: 2 }],
      })
    })
    // Then the waiting line is replaced by the roster, and a session the store
    // says nothing about is stated by the mode it was started under
    expect(view.container.querySelector('[data-dsh-part="squad-team-state"]')).toBeNull()
    const rows = view.container.querySelectorAll('[data-dsh-part="squad-team-row"]')
    expect(rows).toHaveLength(2)
    expect(must(rows[1], '[role="status"]').textContent).toBe(t('squad.mode.oneShot'))
  })

  it('operator sees an external child without a session entry', async () => {
    // Given a squad run whose Lead started one child that runs outside this Host
    const transport = fakeTransport({
      state: async () => stateOf([teamOf({ members: [memberOf()] })], [squadRunOf({ sessionId: 'lead-1' })]),
    })
    const teamSource = fakeTeamSource({
      state: 'ready',
      leadSessionId: 'lead-1',
      rows: [{ id: 'external-1', label: 'Remote', mode: 'external', createdAt: 3 }],
    })
    const view = mount(<AgentsPage transport={transport} teamSource={teamSource} openSession={() => {}} />)
    await flush()
    // When the operator opens that squad
    openSquad(view.container)
    const rows = view.container.querySelectorAll('[data-dsh-part="squad-team-row"]')
    expect(rows).toHaveLength(2)
    // Then the external row states how it was started and offers no action at
    // all: there is no local session to open, so a disabled button would borrow
    // the wrong reason
    expect(must(rows[1], '[role="status"]').textContent).toBe(t('squad.mode.external'))
    expect(rows[1].querySelector('button')).toBeNull()
    // And the Lead row keeps its own entry
    must(rows[0], 'button')
  })

  it('operator sees a plain member run keep its M1 card and join the history unchanged', async () => {
    // Given a squad whose newest run is a single member session
    const transport = fakeTransport({
      state: async () => stateOf([teamOf({ members: [memberOf()] })], [runOf({ id: 'run-1', sessionId: 'session-1', createdAt: 500 })]),
    })
    const view = mount(<AgentsPage transport={transport} openSession={() => {}} />)
    await flush()
    // When the operator opens that squad
    openSquad(view.container)
    // Then the member card still reports its session in a live region
    const card = must(view.container, '[data-dsh-part="member-card"]')
    expect(card.textContent).toContain(t('member.status.running'))
    expect(must(card, '[data-dsh-part="member-run-status"]').getAttribute('role')).toBe('status')
    // And the history lists that member run with its state, instant and opener
    const row = must(view.container, '[data-dsh-variant="member-run"]')
    expect(row.textContent).toContain('Reviewer')
    expect(row.textContent).toContain(t('member.status.running'))
    expect(must(row, 'time').getAttribute('dateTime')).toBe('1970-01-01T00:00:00.500Z')
    // And no live roster is invented for a squad that never ran as a whole
    expect(must(view.container, '[data-dsh-part="squad-team"]').textContent).toContain(t('squad.liveNoRun'))
  })

  it('operator reads the live roster from the Host subagent catalog', () => {
    // Given a session catalog publishing the subagentCatalog projection of one Lead
    const published = { subagentCatalog: subagentCatalogOf([{ id: 'teammate-session-1', label: 'Reviewer' }]) }
    const list = sessionListOf({ 'lead-1': published }, { 'teammate-session-1': { running: true } })
    const source = catalogTeamSource(list)
    const seen: SquadTeamSnapshot[] = []
    // When the page follows that Lead session
    const stop = source.watch('lead-1', (snapshot: SquadTeamSnapshot) => { seen.push(snapshot) })
    // Then the roster arrives with no request at all, carrying the activity the store reports
    expect(source.kind).toBe('catalog')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ state: 'ready', leadSessionId: 'lead-1' })
    expect(seen[0]).toMatchObject({ rows: [{ id: 'teammate-session-1', label: 'Reviewer', running: true }] })
    // And the same published reference never re-renders it
    list.set('lead-1', published)
    expect(seen).toHaveLength(1)
    // And a new published catalog lands as one more snapshot
    list.set('lead-1', {
      subagentCatalog: subagentCatalogOf([
        { id: 'teammate-session-1', label: 'Reviewer' },
        { id: 'teammate-session-2', label: 'Builder' },
      ]),
    })
    expect(seen).toHaveLength(2)
    expect((seen[1] as { rows: readonly unknown[] }).rows).toHaveLength(2)
    // And nothing lands after the page stops following
    stop()
    list.set('lead-1', { subagentCatalog: [] })
    expect(seen).toHaveLength(2)
  })

  it('operator reads an empty catalog as the Lead before it starts anyone', () => {
    // Given a Lead whose published catalog is still empty
    const list = sessionListOf({ 'lead-1': { subagentCatalog: [] } })
    const seen: SquadTeamSnapshot[] = []
    // When the page follows it
    catalogTeamSource(list).watch('lead-1', (snapshot: SquadTeamSnapshot) => { seen.push(snapshot) })
    // Then the page waits instead of rendering an empty roster
    expect(seen).toEqual([{ state: 'pending' }])
  })

  it('operator sees a deployment with no session catalog say so once', async () => {
    // Given a deployment that serves no session catalog at all
    const seen: SquadTeamSnapshot[] = []
    // When the page follows a Lead session
    const stop = createTeamSource(undefined).watch('lead-1', (snapshot: SquadTeamSnapshot) => { seen.push(snapshot) })
    // Then live state reads as unavailable, once, with nothing left to poll
    expect(seen).toEqual([{ state: 'unavailable' }])
    stop()
  })
})
