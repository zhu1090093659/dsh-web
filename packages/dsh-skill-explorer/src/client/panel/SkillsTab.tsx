/**
 * Skills tab: the grouped skill list with the search / workspace toolbar and
 * the per-row enable switch, edit and delete actions.
 *
 * The host route family is the only data source; a failed refresh keeps the
 * previous payload visible with an inline error.
 */
import { useEffect, useRef, useState } from 'react'
import { SkillApi, type ListPayload, type SkillEntry } from '../api.ts'
import { zh } from '../locales.ts'
import { tt } from '../panel-helpers.ts'
import { selectGroups } from '../skill-filter.ts'
import css from './panel.module.css'

/** Localized provider label with fallback to the raw provider id. */
function providerLabel(provider: string): string {
  const key = `provider.${provider}` as keyof typeof zh
  return key in zh ? tt(key) : provider
}

/**
 * Whether this row carries an enable switch.
 *
 * A row with a writable path switches by rewriting its own SKILL.md
 * frontmatter. A plugin-provided file (issue #1854) has no such path, so its
 * switch is recorded in the panel's own store; a truly fileless registration
 * has nothing to switch and still shows none.
 * @param skill - the row's entry.
 * @returns whether the row offers the switch.
 */
function canToggle(skill: SkillEntry): boolean {
  return skill.path !== undefined || skill.fileState === 'provider-file'
}

/**
 * The local-file badge for a row that the write routes cannot serve.
 *
 * A skill with a plugin-supplied file and a skill with no file at all are
 * different facts (issue #1842): the first is "Provided by plugin", only the
 * second is "No local file". Both are pathless, so neither offers file
 * controls.
 * @param skill - the row's entry.
 * @returns the badge copy and its tooltip.
 */
function localFileBadge(skill: SkillEntry): { label: string; tooltip: string } {
  return skill.fileState === 'provider-file'
    ? { label: tt('list.providerFile'), tooltip: tt('list.providerFileTooltip') }
    : { label: tt('list.noFile'), tooltip: tt('list.noFileTooltip') }
}

/** The explanation shown under a row the write routes cannot serve. */
function localFileHint(skill: SkillEntry): string {
  return skill.fileState === 'provider-file' ? tt('list.providerFileHint') : tt('list.noFileHint')
}

/** Marks shown next to a skill (model/user invocable). */
function invokableMarks(skill: SkillEntry): string {
  const marks: string[] = []
  if (skill.modelInvocable) marks.push(tt('list.mark.model'))
  if (skill.userInvocable) marks.push(tt('list.mark.user'))
  return marks.join(' / ')
}

/** One skill row: name, badges, enable switch, edit and delete actions. */
function SkillRow({ skill, api, onChanged, onEdit }: { skill: SkillEntry; api: SkillApi; onChanged: () => void; onEdit: (skill: SkillEntry) => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  // Sync ref guard: React state updates are async, so a double click before
  // the re-render would fire the same request twice with the stale target.
  const busyRef = useRef(false)

  const toggle = async (): Promise<void> => {
    if (busyRef.current || !canToggle(skill)) return
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      // Two identities, one switch: a row with a file certifies the path the
      // write routes re-scan, a plugin-provided row certifies the
      // (provider, name) pair the host records in the panel's own store.
      if (skill.path !== undefined) await api.setEnabled(skill.name, skill.path, !skill.modelInvocable)
      else await api.setProviderEnabled(skill.name, skill.provider, !skill.modelInvocable)
      onChanged()
    } catch (err) {
      setError(tt('list.toggleFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    const path = skill.path
    if (path === undefined) return
    if (!window.confirm(tt('list.deleteConfirm', { name: skill.name }))) return
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      await api.remove(skill.name, path)
      onChanged()
    } catch (err) {
      setError(tt('list.deleteFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const isIsolated = skill.isActiveWorkspace === false
  // Computed once per render: a row with a writable path needs neither.
  const fileBadge = skill.path === undefined ? localFileBadge(skill) : undefined

  return (
    <article className={`${css.skillRow}${isIsolated ? ` ${css.skillIsolated}` : ''}`} data-dsh-part="skill-row">
      <header className={css.skillHeader}>
        <span className={css.skillName}>{skill.name}</span>
        {skill.workspaceName !== undefined && (
          <span className={`${css.badge} ${css.badgeWorkspace}`}>{skill.workspaceName}</span>
        )}
        {isIsolated && (
          <span className={`${css.badge} ${css.badgeIsolated}`} title={tt('workspace.isolatedHint', { workspace: skill.workspaceName ?? '' })}>
            {tt('workspace.isolated')}
          </span>
        )}
        {skill.provider !== undefined && (
          <span className={css.badge} title={tt('provider.tooltip', { provider: providerLabel(skill.provider) })}>
            {providerLabel(skill.provider)}
          </span>
        )}
        {skill.linked === true && <span className={css.badge}>{tt('list.linked')}</span>}
        {fileBadge !== undefined && (
          <span className={css.badge} title={fileBadge.tooltip}>{fileBadge.label}</span>
        )}
        {(skill.modelInvocable || skill.userInvocable) && (
          <span className={`${css.badge} ${css.badgeInvokable}`} title={tt('list.invokableTooltip')}>
            {tt('list.invokable', { marks: invokableMarks(skill) })}
          </span>
        )}
        {canToggle(skill) && (
          <button
            type="button"
            className={css.switch}
            role="switch"
            aria-checked={skill.modelInvocable}
            aria-label={skill.modelInvocable ? tt('list.enabled') : tt('list.disabled')}
            title={skill.modelInvocable ? tt('list.enabled') : tt('list.disabled')}
            disabled={busy}
            onClick={() => { void toggle() }}
          >
            <span className={css.switchTrack}><span className={css.switchThumb} /></span>
          </button>
        )}
        {skill.path !== undefined && skill.linked !== true && (
          <button type="button" className={css.linkButton} disabled={busy} onClick={() => { onEdit(skill) }}>
            {tt('list.edit')}
          </button>
        )}
        {skill.path !== undefined && skill.linked !== true && (
          <button type="button" className={`${css.linkButton} ${css.deleteButton}`} data-danger="" disabled={busy} onClick={() => { void remove() }}>
            {tt('list.delete')}
          </button>
        )}
      </header>
      <p className={css.skillDesc}>{skill.description}</p>
      {skill.whenToUse !== undefined && skill.whenToUse !== '' && (
        <p className={css.skillWhen}>{tt('list.when', { when: skill.whenToUse })}</p>
      )}
      {skill.path !== undefined && <div className={css.skillPath}>{skill.path}</div>}
      {skill.path === undefined && <p className={css.skillWhen}>{localFileHint(skill)}</p>}
      {error !== undefined && <p className={css.banner} data-kind="error">{error}</p>}
    </article>
  )
}

/** The skills tab body. */
export function SkillsTab({ api, onEdit }: { api: SkillApi; onEdit: (skill: SkillEntry) => void }): React.JSX.Element {
  const [payload, setPayload] = useState<ListPayload | undefined>(undefined)
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  // Sequence guard: a slow earlier load must not overwrite a newer one.
  const loadSeq = useRef(0)

  const load = async (): Promise<void> => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const next = await api.list()
      if (seq !== loadSeq.current) return
      setPayload(next)
      setError(undefined)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setError(tt('list.loadFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      // A newer load owns the flag while it runs.
      if (seq === loadSeq.current) setLoading(false)
    }
  }

  useEffect(() => { void load() }, [api])

  // The refresh control is hidden while a load runs: a second request cannot
  // shorten the first, and the loading state already covers the wait.
  const refreshButton = loading
    ? undefined
    : (
      <button type="button" className={css.ghostButton} onClick={() => { void load() }}>
        {tt('refresh')}
      </button>
    )

  // Last-good policy: a failed refresh keeps the previous payload visible and
  // reports the error inline; the error state replaces the list only when
  // there is nothing to fall back to.
  if (payload === undefined) {
    return (
      <div className={css.fillBody}>
        {loading
          ? <p className={css.empty}>{tt('list.loading')}</p>
          : (
            <>
              <p className={css.empty}>{error}</p>
              <div className={css.toolbar}>{refreshButton}</div>
            </>
          )}
      </div>
    )
  }

  const visibleGroups = selectGroups(payload.groups, { workspace: selectedWorkspace, query })
  const visibleCount = visibleGroups.reduce((total, group) => total + group.skills.length, 0)

  return (
    <div className={css.fillBody}>
      <div className={css.toolbar} data-dsh-part="filter-bar">
        <input
          className={css.search}
          type="search"
          value={query}
          spellCheck={false}
          aria-label={tt('filter.searchLabel')}
          placeholder={tt('filter.searchPlaceholder')}
          onChange={(event) => { setQuery(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Escape' && query !== '') setQuery('') }}
        />
        {payload.workspaces !== undefined && payload.workspaces.length > 1 && (
          <select
            className={css.select}
            value={selectedWorkspace}
            aria-label={tt('filter.workspaceLabel')}
            onChange={(event) => { setSelectedWorkspace(event.target.value) }}
          >
            <option value="all">{tt('filter.workspaceAll')}</option>
            {payload.workspaces.map(ws => (
              <option key={ws.root} value={ws.root}>
                {ws.active ? tt('filter.workspaceCurrent', { name: ws.name }) : ws.name}
              </option>
            ))}
          </select>
        )}
        <div className={css.toolbarSpacer} />
        {refreshButton}
      </div>
      {error !== undefined && <p className={css.banner} data-kind="error">{error}</p>}
      {visibleCount === 0
        ? <p className={css.empty}>{query.trim() === '' ? tt('filter.emptyWorkspace') : tt('filter.empty', { query: query.trim() })}</p>
        : (
          <div className={css.list}>
            {visibleGroups.map((group) => {
              const groupKey = `group.${group.key}` as keyof typeof zh
              const hintKey = `groupHint.${group.key}` as keyof typeof zh
              const title = groupKey in zh ? tt(groupKey) : group.title
              const hint = hintKey in zh ? tt(hintKey) : group.hint
              return (
                <section key={group.key} className={css.group}>
                  <h3 className={css.groupTitle}>
                    {title}
                    <span className={css.count}>{tt('list.count', { count: String(group.skills.length) })}</span>
                  </h3>
                  {hint !== '' && <p className={css.groupHint}>{hint}</p>}
                  {group.skills.map(skill => (
                    <SkillRow key={skill.name} skill={skill} api={api} onChanged={() => { void load() }} onEdit={onEdit} />
                  ))}
                </section>
              )
            })}
          </div>
        )}
    </div>
  )
}
