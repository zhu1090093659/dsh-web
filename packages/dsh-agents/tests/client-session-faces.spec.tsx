// @vitest-environment jsdom
/**
 * The two optional session faces of issue #2018: the workspace opener and the
 * shared session catalog.
 *
 * Both are provided by OTHER official client plugins, so their arrival is a
 * load-order question, not a wiring question. These cases mount the real bridge
 * on a real cordis tree - the deployment starts with no provider, a sibling
 * fiber publishes one later, and unloading that fiber withdraws it again - and
 * then drive the panel over the same store to prove the page follows those
 * changes without a remount. A one-shot probe in `apply` cannot pass either
 * case: it would read `undefined` once and keep it for the life of the process.
 */
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AgentsPanelPage } from '../src/client/panel.tsx'
import { bridgeSessionFaces, createSessionFaces, openerFrom } from '../src/client/session-faces.ts'
import type { SquadTeamSnapshot } from '../src/client/team-source.ts'
import { t } from '../src/client/locales.ts'
import { buttonByText, click, flush, mount, unmountAll } from './render.tsx'
import { agentTeamOf, fakeTransport, memberOf, runOf, sessionListOf, stateOf, teamOf } from './agents-fixtures.ts'

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

describe('session faces on a real cordis tree', () => {
  it('operator sees both faces off, then served by a provider that mounts later, then off again when it unloads', async () => {
    // Given a browser root whose deployment serves neither the workspace nor the
    // session catalog when this plugin applies
    const root = new Context()
    const store = createSessionFaces(fakeTransport({ state: async () => stateOf([]) }))
    const versions: number[] = []
    const stop = store.subscribe(() => { versions.push(store.getSnapshot().version) })
    bridgeSessionFaces(root, store)

    expect(store.getSnapshot().openSession).toBeUndefined()
    expect(store.getSnapshot().teamSource.kind).toBe('poll')

    // When the workspace plugin and the session controller mount afterwards
    const opened: string[] = []
    const list = sessionListOf({ 'lead-1': { agentTeam: agentTeamOf([], { leadSessionId: 'lead-1' }) } })
    const workspace = root.plugin({
      name: 'late-workspace',
      apply(provider: Context) {
        provider.provide('uiWorkspace', { openSession: (sessionId: string) => { opened.push(sessionId) } })
      },
    })
    const sessions = root.plugin({
      name: 'late-session-controller',
      apply(provider: Context) {
        provider.provide('sessions', { list })
      },
    })

    await vi.waitFor(() => {
      expect(store.getSnapshot().openSession).toBeTypeOf('function')
    })
    await vi.waitFor(() => {
      expect(store.getSnapshot().teamSource.kind).toBe('projection')
    })

    // Then the opener switches to the exact session id it is handed...
    store.getSnapshot().openSession?.('session-7')
    expect(opened).toEqual(['session-7'])
    // ...the live team is read from the published projection, with no request...
    const snapshots: SquadTeamSnapshot[] = []
    const stopWatch = store.getSnapshot().teamSource.watch('lead-1', snapshot => { snapshots.push(snapshot) })
    expect(snapshots.at(-1)).toMatchObject({ state: 'ready', rows: [{ id: 'lead-1', role: 'lead' }] })
    stopWatch()
    // ...and every change was announced exactly once
    expect(versions.length).toBe(2)
    expect(versions[1]).toBeGreaterThan(versions[0])

    // When the session controller unloads, the page falls back to the proposed
    // route instead of keeping a dead projection source
    await sessions.dispose()
    await vi.waitFor(() => {
      expect(store.getSnapshot().teamSource.kind).toBe('poll')
    })

    // When the workspace plugin unloads too, the opener is withdrawn
    await workspace.dispose()
    await vi.waitFor(() => {
      expect(store.getSnapshot().openSession).toBeUndefined()
    })
    expect(versions.length).toBe(4)
    stop()
  })
})

describe('session faces store', () => {
  it('operator sees one notification per real change and none for a repeated face', () => {
    // Given a store with its initial snapshot
    const store = createSessionFaces(fakeTransport({ state: async () => stateOf([]) }))
    const initial = store.getSnapshot()
    let notified = 0
    const stop = store.subscribe(() => { notified += 1 })

    // When the same opener is offered twice
    const opener = (): void => {}
    store.offerOpener(opener)
    const afterFirst = store.getSnapshot()
    store.offerOpener(opener)

    // Then the second offer is a no-op for both the version and the reference
    expect(notified).toBe(1)
    expect(afterFirst).not.toBe(initial)
    expect(store.getSnapshot()).toBe(afterFirst)

    // When the opener is withdrawn, the live-team surface is untouched
    store.offerOpener(undefined)
    expect(notified).toBe(2)
    expect(store.getSnapshot().teamSource).toBe(initial.teamSource)

    // And an unsubscribed listener hears nothing
    stop()
    store.offerTeamSource(undefined)
    expect(notified).toBe(2)
  })

  it('operator sees a face this build cannot read reported as absent instead of as a broken opener', () => {
    // Given whatever a deployment published under the workspace name
    // When it carries no callable openSession
    // Then no opener is offered at all
    expect(openerFrom(undefined)).toBeUndefined()
    expect(openerFrom({})).toBeUndefined()
    expect(openerFrom({ openSession: 'nope' })).toBeUndefined()
    // And a readable one is wrapped, so the page holds a plain function
    const opened: string[] = []
    const opener = openerFrom({ openSession: (sessionId: string) => { opened.push(sessionId) } })
    expect(opener).toBeTypeOf('function')
    opener?.('session-9')
    expect(opened).toEqual(['session-9'])
  })
})

describe('panel over a live capability store', () => {
  it('operator sees the session action enable itself when the opener arrives, without a reload', async () => {
    // Given a page whose deployment serves no opener while the card renders
    const transport = fakeTransport({
      state: async () => stateOf([teamOf({ members: [memberOf()] })], [runOf({ sessionId: 'session-7' })]),
    })
    const store = createSessionFaces(transport)
    const opened: string[] = []
    const view = mount(<AgentsPanelPage transport={transport} faces={store} />)
    await flush()
    openSquad(view.container)

    // Then the session it names is visible with a disabled action and the reason
    const disabled = buttonByText(view.container, t('member.openSession'))
    expect(disabled.disabled).toBe(true)
    expect(disabled.getAttribute('title')).toBe(t('member.openSessionUnavailable'))

    // When the workspace plugin appears behind the page
    act(() => { store.offerOpener((sessionId: string) => { opened.push(sessionId) }) })

    // Then the SAME mounted action is enabled and opens exactly that session
    const enabled = buttonByText(view.container, t('member.openSession'))
    expect(enabled.disabled).toBe(false)
    expect(enabled.getAttribute('title')).toBeNull()
    click(enabled)
    expect(opened).toEqual(['session-7'])

    // And withdrawing the face disables it again instead of leaving a dead button
    act(() => { store.offerOpener(undefined) })
    expect(buttonByText(view.container, t('member.openSession')).disabled).toBe(true)
  })
})
