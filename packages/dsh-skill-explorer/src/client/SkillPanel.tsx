/**
 * Skill center panel (browser half): an overlay modal with two tabs — the
 * grouped skill list (enable/disable switch, delete) and a create form.
 * Talks to the host route family through SkillApi.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SkillApi, type ListPayload, type SkillEntry } from './api.ts'
import { zh, type SkillExplorerKey } from './locales.ts'
import { tt } from './panel-helpers.ts'
import css from './skill-panel.module.css'

/** Panel props: the API client and the close callback. */
export interface SkillPanelProps {
  api: SkillApi
  onClose: () => void
}

type Tab = 'list' | 'create'

/** Marks shown next to a skill (model/user invocable). */
function invokableMarks(skill: SkillEntry): string {
  const marks: string[] = []
  if (skill.modelInvocable) marks.push(tt('list.mark.model'))
  if (skill.userInvocable) marks.push(tt('list.mark.user'))
  return marks.join(' / ')
}

/** Localized provider label with fallback. */
function providerLabel(provider: string): string {
  const key = `provider.${provider}` as SkillExplorerKey
  const translated = tt(key)
  return translated === key ? provider : translated
}

/** One skill card: name, badges, toggle switch, delete button. */
function SkillCard({ skill, api, onChanged }: { skill: SkillEntry; api: SkillApi; onChanged: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  // Sync ref guard: React state updates are async, so a double click before
  // the re-render would fire the same request twice with the stale target.
  const busyRef = useRef(false)

  const toggle = async (): Promise<void> => {
    if (busyRef.current) return
    const path = skill.path
    if (path === undefined) return
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      await api.setEnabled(skill.name, path, !skill.modelInvocable)
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

  return (
    <article className={css.skill} data-dsh-part="skill-row">
      <header className={css.skillHeader}>
        <span className={css.skillName}>{skill.name}</span>
        {skill.provider !== undefined && (
          <span
            className={css.badge}
            title={tt('provider.tooltip', { provider: providerLabel(skill.provider) })}
          >
            {providerLabel(skill.provider)}
          </span>
        )}
        {skill.linked === true && <span className={css.badge}>{tt('list.linked')}</span>}
        {(skill.modelInvocable || skill.userInvocable) && (
          <span
            className={`${css.badge} ${css.badgeInvokable}`}
            title={tt('list.invokableTooltip')}
          >
            {tt('list.invokable', { marks: invokableMarks(skill) })}
          </span>
        )}
        {skill.path !== undefined && (
          <button
            type="button"
            className={css.switch}
            role="switch"
            aria-checked={skill.modelInvocable}
            title={skill.modelInvocable ? tt('list.enabled') : tt('list.disabled')}
            disabled={busy}
            onClick={() => { void toggle() }}
          >
            <span className={css.switchTrack}><span className={css.switchThumb} /></span>
          </button>
        )}
        {skill.path !== undefined && skill.linked !== true && (
          <button type="button" className={css.deleteButton} disabled={busy} onClick={() => { void remove() }}>
            {tt('list.delete')}
          </button>
        )}
      </header>
      <p className={css.skillDesc}>{skill.description}</p>
      {skill.whenToUse !== undefined && skill.whenToUse !== '' && (
        <p className={css.skillWhen}>{tt('list.when', { when: skill.whenToUse })}</p>
      )}
      {skill.path !== undefined && <div className={css.skillPath}>{skill.path}</div>}
      {error !== undefined && <p className={css.feedback}>{error}</p>}
    </article>
  )
}

/** The grouped skill list tab. */
function ListTab({ api, refreshTick, onCwd }: { api: SkillApi; refreshTick: number; onCwd: (cwd: string) => void }): React.JSX.Element {
  const [payload, setPayload] = useState<ListPayload | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  // Sequence guard: a slow earlier load must not overwrite a newer one.
  const loadSeq = useRef(0)

  const load = async (): Promise<void> => {
    const seq = ++loadSeq.current
    try {
      const next = await api.list()
      if (seq !== loadSeq.current) return
      setPayload(next)
      onCwd(next.cwd)
      setError(undefined)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setError(tt('list.loadFailed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }

  useEffect(() => { void load() }, [api, refreshTick])

  // Last-good policy: a failed refresh keeps the previous payload visible and
  // reports the error inline; the error state replaces the list only when
  // there is nothing to fall back to.
  if (error !== undefined && payload === undefined) return <div className={css.status}>{error}</div>
  if (payload === undefined) return <div className={css.status}>{tt('list.loading')}</div>
  if (payload.groups.length === 0) return <div className={css.status}>{tt('list.empty')}</div>

  return (
    <div>
      {error !== undefined && <p className={css.feedback}>{error}</p>}
      {payload.groups.map((group) => {
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
            {group.skills.map((skill) => (
              <SkillCard key={skill.name} skill={skill} api={api} onChanged={() => { void load() }} />
            ))}
          </section>
        )
      })}
    </div>
  )
}

/** The create form tab. */
function CreateTab({ api, cwd }: { api: SkillApi; cwd: string | undefined }): React.JSX.Element {
  const [root, setRoot] = useState<'user' | 'project'>('user')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | undefined>(undefined)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (name.trim() === '' || description.trim() === '' || content.trim() === '') {
      setFeedback({ text: tt('create.empty'), ok: false })
      return
    }
    setBusy(true)
    try {
      const result = await api.create({ root, name: name.trim(), description: description.trim(), whenToUse: whenToUse.trim() || undefined, content, cwd: cwd ?? '' })
      setFeedback({ text: tt('create.created', { path: result.path }), ok: true })
      setName('')
      setDescription('')
      setWhenToUse('')
      setContent('')
    } catch (err) {
      setFeedback({ text: tt('create.failed', { error: err instanceof Error ? err.message : String(err) }), ok: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={css.form} onSubmit={(event) => { void submit(event) }}>
      <label className={css.formLabel}>
        {tt('create.root')}
        <select className={css.formInput} value={root} onChange={(event) => { setRoot(event.target.value as 'user' | 'project') }}>
          <option value="user">{tt('create.root.user')}</option>
          <option value="project">{tt('create.root.project')}</option>
        </select>
      </label>
      <label className={css.formLabel}>
        {tt('create.name')}
        <input className={css.formInput} value={name} placeholder={tt('create.namePlaceholder')} onChange={(event) => { setName(event.target.value) }} />
      </label>
      <label className={css.formLabel}>
        {tt('create.description')}
        <input className={css.formInput} value={description} onChange={(event) => { setDescription(event.target.value) }} />
      </label>
      <label className={css.formLabel}>
        {tt('create.whenToUse')}
        <input className={css.formInput} value={whenToUse} onChange={(event) => { setWhenToUse(event.target.value) }} />
      </label>
      <label className={css.formLabel}>
        {tt('create.content')}
        <textarea className={`${css.formInput} ${css.formTextarea}`} value={content} onChange={(event) => { setContent(event.target.value) }} />
      </label>
      <button type="submit" className={css.formButton} disabled={busy}>{tt('create.submit')}</button>
      {feedback !== undefined && (
        <p className={feedback.ok ? `${css.feedback} ${css.feedbackOk}` : css.feedback}>{feedback.text}</p>
      )}
      <p className={css.note}>{tt('create.note')}</p>
    </form>
  )
}

/** The skill center overlay modal. */
export function SkillPanel({ api, onClose }: SkillPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('list')
  const [cwd, setCwd] = useState<string | undefined>(undefined)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Typing in the create form must not close the panel: Escape there is
      // an editing gesture, not a dismiss gesture.
      const target = event.target as HTMLElement | null
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={css.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={css.card} data-dsh-part="card">
        <header className={css.head} data-dsh-part="head">
          <h2 className={css.headTitle}>{tt('panel.title')}</h2>
          <button type="button" className={css.headButton} onClick={() => { setRefreshTick((tick) => tick + 1) }}>
            {tt('refresh')}
          </button>
          <button type="button" className={css.headButton} onClick={onClose}>{tt('close')}</button>
        </header>
        <div className={css.tabs} data-dsh-part="tab-bar" role="tablist">
          <button type="button" role="tab" className={`${css.tab} ${tab === 'list' ? css.tabActive : ''}`} data-dsh-part="tab" aria-selected={tab === 'list'} data-active={tab === 'list' ? '' : undefined} onClick={() => { setTab('list') }}>
            {tt('tab.list')}
          </button>
          <button type="button" role="tab" className={`${css.tab} ${tab === 'create' ? css.tabActive : ''}`} data-dsh-part="tab" aria-selected={tab === 'create'} data-active={tab === 'create' ? '' : undefined} onClick={() => { setTab('create') }}>
            {tt('tab.create')}
          </button>
        </div>
        <div className={css.body}>
          {tab === 'list' ? <ListTab api={api} refreshTick={refreshTick} onCwd={setCwd} /> : <CreateTab api={api} cwd={cwd} />}
        </div>
      </div>
    </div>
  )
}
