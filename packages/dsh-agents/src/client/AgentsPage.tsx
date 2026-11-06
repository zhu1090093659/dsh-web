/**
 * The agents page: one load state, one poll loop, and the squad/member actions
 * that write through the transport.
 *
 * M1 refreshes by polling GET state every {@link AGENTS_POLL_INTERVAL_MS} while
 * the page is mounted, plus the manual refresh control in the header; the loop
 * stops and its in-flight read is aborted on unmount. A poll that fails after a
 * good read keeps the last snapshot on screen and reports the failure as a
 * banner, so a flaky phone link never blanks the list.
 *
 * M2 adds the whole-squad action and the live team of its Lead. The live team is
 * read through `team-source.ts`, which prefers the shared session store's
 * `agentTeam` projection and only falls back to a bounded poll when that
 * surface is out of reach from this context.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { failureOf } from './host-api.ts'
import type { AgentsFailure, AgentsTransport } from './host-api.ts'
import { t } from './locales.ts'
import { effortsOf, modelsOf } from './model-options.ts'
import { newestSquadRun } from './runs.ts'
import { teamDraftOf, TeamForm, MemberForm } from './Forms.tsx'
import { SquadList } from './SquadList.tsx'
import { SquadDetail } from './SquadDetail.tsx'
import type { MemberNotice } from './MemberCard.tsx'
import type { SquadNotice, SquadRunRequest } from './SquadRunPanel.tsx'
import type { SquadTeamSnapshot, SquadTeamSource } from './team-source.ts'
import type { AgentsStateView, AgentsWorkspaceOption, MemberDefinition, MemberDraft, TeamDefinition, TeamDraft } from '../protocol.ts'
import css from './agents.module.css'

/** Refresh cadence while the page is mounted. M1 polls; there is no stream. */
export const AGENTS_POLL_INTERVAL_MS = 5000

/** What the page has read so far. */
type Load =
  | { phase: 'loading' }
  | { phase: 'error'; failure: AgentsFailure; message: string }
  | { phase: 'ready'; state: AgentsStateView; stale?: { failure: AgentsFailure; message: string } }

/** The open edit form, if any. */
type Form =
  | { kind: 'team'; team: TeamDefinition | undefined }
  | { kind: 'member'; teamId: string; member: MemberDefinition | undefined }

export interface AgentsPageProps {
  transport: AgentsTransport
  /** Switch the GUI to an existing member session; absent when the deployment has none. */
  openSession?: (sessionId: string) => void
  /** Where the live team of a squad run is read from; absent when this context serves none. */
  teamSource?: SquadTeamSource
}

/** The preset list a Host reports, or none: a Host that reports nothing offers no list. */
function presetsOf(state: AgentsStateView): readonly string[] {
  return Array.isArray(state.presets) ? state.presets : []
}

/** The workspaces a Host offers as a squad pin; none leaves only the bind-none row, since binding none runs in the Host default session directory. */
function workspacesOf(state: AgentsStateView): readonly AgentsWorkspaceOption[] {
  return Array.isArray(state.workspaces) ? state.workspaces : []
}

/**
 * Render the whole agents page.
 * @param props - the transport, the optional session opener and the live-team source.
 */
export function AgentsPage({ transport, openSession, teamSource }: AgentsPageProps): ReactNode {
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(undefined)
  const [form, setForm] = useState<Form | undefined>(undefined)
  const [notice, setNotice] = useState<MemberNotice | undefined>(undefined)
  const [squadNotice, setSquadNotice] = useState<SquadNotice | undefined>(undefined)
  const [teamView, setTeamView] = useState<SquadTeamSnapshot | undefined>(undefined)
  const [pageError, setPageError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const state = await transport.state(signal)
      if (!mounted.current) return
      setLoad({ phase: 'ready', state })
    } catch (error) {
      if (!mounted.current) return
      // A read this page cancelled (unmount) says nothing about the Host.
      if (signal !== undefined && signal.aborted) return
      const described = failureOf(error)
      setLoad(previous => previous.phase === 'ready'
        ? { phase: 'ready', state: previous.state, stale: described }
        : { phase: 'error', failure: described.failure, message: described.message })
    }
  }, [transport])

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void refresh(controller.signal)
    const timer = globalThis.setInterval(() => { void refresh(controller.signal) }, AGENTS_POLL_INTERVAL_MS)
    return () => {
      mounted.current = false
      globalThis.clearInterval(timer)
      controller.abort()
    }
  }, [refresh])

  const selectedTeam = load.phase === 'ready' ? load.state.teams.find(team => team.id === selectedTeamId) : undefined
  const leadRun = selectedTeam === undefined || load.phase !== 'ready' ? undefined : newestSquadRun(load.state.runs, selectedTeam.id)
  const leadSessionId = leadRun?.sessionId

  useEffect(() => {
    if (leadSessionId === undefined) {
      setTeamView(undefined)
      return
    }
    if (teamSource === undefined) {
      setTeamView({ state: 'unavailable' })
      return
    }
    return teamSource.watch(leadSessionId, (snapshot) => {
      if (mounted.current) setTeamView(snapshot)
    })
  }, [teamSource, leadSessionId])

  /** Run one write, report its failure at page level, and re-read on success. */
  const perform = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setPageError(undefined)
    try {
      await action()
    } catch (error) {
      if (mounted.current) setPageError(failureOf(error).message)
      if (mounted.current) setBusy(false)
      return
    }
    if (mounted.current) setBusy(false)
    await refresh()
  }

  const runMember = (teamId: string, memberId: string): void => {
    void (async () => {
      setBusy(true)
      setNotice(undefined)
      setPageError(undefined)
      try {
        const run = await transport.run(teamId, memberId)
        if (!mounted.current) return
        setNotice({ memberId, kind: 'ok', message: t('member.runStarted', { session: run.sessionId }) })
        await refresh()
      } catch (error) {
        if (!mounted.current) return
        setNotice({ memberId, kind: 'failed', message: failureOf(error).message })
      } finally {
        if (mounted.current) setBusy(false)
      }
    })()
  }

  /**
   * Launch the whole squad. The Lead preset is a property of the squad on the
   * wire, so a changed choice is saved onto the definition first: the run the
   * user sees is the run they configured. A failed save stops the launch, and
   * every failure class the Host can answer with lands in the panel's own live
   * region as copy.
   */
  const runSquad = (team: TeamDefinition, request: SquadRunRequest): void => {
    void (async () => {
      setBusy(true)
      setSquadNotice(undefined)
      setPageError(undefined)
      try {
        if (request.leadPreset !== team.leadPreset) {
          await transport.createTeam(teamDraftOf(team, { leadPreset: request.leadPreset }))
        }
        const run = await transport.runSquad({
          teamId: team.id,
          ...(request.goal === undefined ? {} : { goal: request.goal }),
        })
        if (!mounted.current) return
        setSquadNotice({ kind: 'ok', message: t('squad.runStarted', { session: run.sessionId }) })
        await refresh()
      } catch (error) {
        if (!mounted.current) return
        setSquadNotice({ kind: 'failed', message: failureOf(error).message })
      } finally {
        if (mounted.current) setBusy(false)
      }
    })()
  }

  const submitTeam = (draft: TeamDraft): void => {
    void perform(async () => {
      const team = await transport.createTeam(draft)
      setForm(undefined)
      setSelectedTeamId(team.id)
    })
  }

  const submitMember = (teamId: string, draft: MemberDraft): void => {
    void perform(async () => {
      await transport.saveMember(teamId, draft)
      setForm(undefined)
    })
  }

  const body = ((): ReactNode => {
    if (form !== undefined && form.kind === 'team') {
      // The squad form's pickers and its description button read the last good
      // read, exactly like the member form's catalog: a failed poll keeps the
      // previous snapshot, so nothing turns into a text box mid-typing.
      const catalog = load.phase === 'ready' ? load.state : undefined
      return (
        <TeamForm
          team={form.team}
          busy={busy}
          presets={catalog === undefined ? [] : presetsOf(catalog)}
          workspaces={catalog === undefined ? [] : workspacesOf(catalog)}
          onDescribe={async (draft) => await transport.describe(draft)}
          onSubmit={submitTeam}
          onCancel={() => { setForm(undefined) }}
        />
      )
    }
    if (form !== undefined && form.kind === 'member') {
      // The pickers read the catalog of the last good read: a failed poll keeps
      // the previous snapshot on screen, so the form keeps offering exactly what
      // this Host last published.
      const catalog = load.phase === 'ready' ? load.state : undefined
      return (
        <MemberForm
          teamId={form.teamId}
          member={form.member}
          busy={busy}
          models={catalog === undefined ? undefined : modelsOf(catalog)}
          efforts={catalog === undefined ? undefined : effortsOf(catalog)}
          onSubmit={submitMember}
          onCancel={() => { setForm(undefined) }}
        />
      )
    }
    if (load.phase === 'loading') {
      return <p className={css.state} role="status" data-dsh-part="agents-loading">{t('agents.loading')}</p>
    }
    if (load.phase === 'error') {
      return (
        <div className={css.state} role="alert" data-dsh-part="agents-error">
          <p className={css.emptyTitle}>{t('error.title')}</p>
          <p className={css.emptyHint}>{load.message}</p>
          <button type="button" className={css.primary} onClick={() => { void refresh() }}>{t('agents.retry')}</button>
        </div>
      )
    }
    if (selectedTeam !== undefined) {
      return (
        <SquadDetail
          team={selectedTeam}
          runs={load.state.runs}
          busy={busy}
          notice={notice}
          squadNotice={squadNotice}
          presets={presetsOf(load.state)}
          teamView={teamView}
          actions={{
            back: () => { setSelectedTeamId(undefined); setNotice(undefined); setSquadNotice(undefined) },
            editTeam: () => { setForm({ kind: 'team', team: selectedTeam }) },
            deleteTeam: () => {
              void perform(async () => {
                await transport.deleteTeam(selectedTeam.id)
                setForm(undefined)
                setSelectedTeamId(undefined)
              })
            },
            addMember: () => { setForm({ kind: 'member', teamId: selectedTeam.id, member: undefined }) },
            editMember: (memberId: string) => {
              const member = selectedTeam.members.find(candidate => candidate.id === memberId)
              setForm({ kind: 'member', teamId: selectedTeam.id, member })
            },
            deleteMember: (memberId: string) => {
              void perform(async () => { await transport.deleteMember(selectedTeam.id, memberId) })
            },
            run: (memberId: string) => { runMember(selectedTeam.id, memberId) },
            runSquad: (request: SquadRunRequest) => { runSquad(selectedTeam, request) },
            openSession,
          }}
        />
      )
    }
    return (
      <SquadList
        teams={load.state.teams}
        onOpen={(teamId: string) => { setSelectedTeamId(teamId); setNotice(undefined); setSquadNotice(undefined) }}
        onNew={() => { setForm({ kind: 'team', team: undefined }) }}
      />
    )
  })()

  return (
    <div className={css.page} data-dsh-plugin="agents" data-dsh-agents-view="">
      <header className={css.header}>
        <div className={css.headerTitle}>
          <h2 className={css.title}>{t('agents.title')}</h2>
          <p className={css.subtitle}>{t('agents.subtitle')}</p>
        </div>
        <button type="button" className={css.secondary} aria-label={t('agents.refresh')} title={t('agents.refresh')} onClick={() => { void refresh() }}>
          {t('agents.refresh')}
        </button>
      </header>
      {load.phase === 'ready' && load.stale !== undefined ? (
        <p className={css.noticeError + ' ' + css.banner} role="status" data-dsh-part="agents-stale">{load.stale.message}</p>
      ) : null}
      {pageError === undefined ? null : <p className={css.noticeError + ' ' + css.banner} role="alert" data-dsh-part="agents-page-error">{pageError}</p>}
      <div className={css.body}>{body}</div>
    </div>
  )
}
