/**
 * Create tab: the new-skill form (user, shared agents or project root).
 *
 * The host's create route needs the workspace the panel is showing, which the
 * list payload carries. The inactive tab unmounts, so a user who opens this
 * tab first has no cwd: the first submit resolves it with one list call and
 * reuses it afterwards.
 *
 * A row's "duplicate as template" action leaves a draft in the controller and
 * opens this tab; the draft is read once at mount (the tab remounts on every
 * visit, so a later duplicate hands the next visit a fresh one) and dropped
 * from the controller once the skill is created or the draft is dismissed.
 */
import { useState, type FormEvent } from 'react'
import { SkillApi } from '../api.ts'
import { tt } from '../panel-helpers.ts'
import type { PanelController, SkillDraft } from './controller.ts'
import css from './panel.module.css'

/** Create-form feedback line. */
type Feedback = { text: string; kind: 'ok' | 'error' }

/** The create tab body. */
export function CreateTab({ api, controller }: { api: SkillApi; controller: PanelController }): React.JSX.Element {
  const [template, setTemplate] = useState<SkillDraft | undefined>(() => controller.getSnapshot().template)
  const [root, setRoot] = useState<'user' | 'agents' | 'project'>('user')
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [whenToUse, setWhenToUse] = useState(template?.whenToUse ?? '')
  const [content, setContent] = useState(template?.content ?? '')
  const [cwd, setCwd] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined)

  /** Blank the form and drop the pending draft, so the next visit starts fresh. */
  const reset = (): void => {
    setName('')
    setDescription('')
    setWhenToUse('')
    setContent('')
    setTemplate(undefined)
    controller.clearTemplate()
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (name.trim() === '' || description.trim() === '' || content.trim() === '') {
      setFeedback({ text: tt('create.empty'), kind: 'error' })
      return
    }
    setBusy(true)
    try {
      const workspace = cwd ?? (await api.list()).cwd
      setCwd(workspace)
      const result = await api.create({
        root,
        name: name.trim(),
        description: description.trim(),
        whenToUse: whenToUse.trim() || undefined,
        content,
        cwd: workspace,
      })
      setFeedback({ text: tt('create.created', { path: result.path }), kind: 'ok' })
      reset()
    } catch (err) {
      setFeedback({ text: tt('create.failed', { error: err instanceof Error ? err.message : String(err) }), kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.tabBody}>
      <form className={css.form} onSubmit={(event) => { void submit(event) }}>
        {template !== undefined && (
          <div className={css.banner} data-dsh-part="template-banner">
            {tt('create.template', { name: template.from })}
            <button type="button" className={`${css.linkButton} ${css.bannerAction}`} onClick={reset}>{tt('create.templateClear')}</button>
          </div>
        )}
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.root')}</span>
          <select className={css.select} value={root} onChange={(event) => { setRoot(event.target.value as 'user' | 'agents' | 'project') }}>
            <option value="user">{tt('create.root.user')}</option>
            <option value="agents">{tt('create.root.agents')}</option>
            <option value="project">{tt('create.root.project')}</option>
          </select>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.name')}</span>
          <input className={css.input} value={name} placeholder={tt('create.namePlaceholder')} onChange={(event) => { setName(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.description')}</span>
          <input className={css.input} value={description} onChange={(event) => { setDescription(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.whenToUse')}</span>
          <input className={css.input} value={whenToUse} onChange={(event) => { setWhenToUse(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('create.content')}</span>
          <textarea className={`${css.input} ${css.textarea}`} value={content} onChange={(event) => { setContent(event.target.value) }} />
        </label>
        <button type="submit" className={css.primaryButton} disabled={busy}>{tt('create.submit')}</button>
        {feedback !== undefined && <p className={css.banner} data-kind={feedback.kind}>{feedback.text}</p>}
        <p className={css.note}>{tt('create.note')}</p>
      </form>
    </div>
  )
}
