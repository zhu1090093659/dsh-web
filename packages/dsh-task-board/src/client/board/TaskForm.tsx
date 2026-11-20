/**
 * Shared task-modal pieces: the overlay shell (backdrop, form, title, error,
 * footer) and the title/description/prompt field trio used by both the
 * NewTaskModal and the EditTaskModal. State stays in the owning modal; these
 * are controlled components.
 */
import { useId, useState, type ReactNode } from 'react'
import { TAG_NAME_MAX_LENGTH, TAG_PROMPT_MAX_LENGTH, TASK_TAG_LIMIT, normalizeTags, type TaskTag } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { IconClose, IconPlus } from './icons.tsx'
import { useDialog, usePresence, type OverlayPhase } from './overlay.tsx'

/** DOM id shared by the tag-name inputs and their datalist (one board at a time). */
const TAG_NAME_LIST_ID = 'dsh-task-board-tag-names'

/** Modal overlay: closes on backdrop press, submits through the form. */
export function ModalShell({
  ariaLabel,
  title,
  error,
  pending,
  submitLabel,
  onSubmit,
  onClose,
  secondaryAction,
  phase = 'open',
  children,
}: {
  ariaLabel: string
  title: string
  error: string | undefined
  pending: boolean
  submitLabel: string
  onSubmit: () => void
  onClose: () => void
  /** Optional second action beside the primary submit (e.g. create and run). */
  secondaryAction?: { label: string; onSubmit: () => void }
  /** Which leg of the enter/exit motion pair the surface is on. */
  phase?: OverlayPhase
  children: ReactNode
}) {
  const dialog = useDialog<HTMLFormElement>(onClose, phase)
  return (
    <div className={css.modalBackdrop} data-state={phase} onMouseDown={dialog.onMouseDown}>
      <form
        ref={dialog.attach}
        className={css.modal}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onSubmit={event => { event.preventDefault(); onSubmit() }}
      >
        <h2 className={css.modalTitle}>{title}</h2>

        <div className={css.modalBody}>{children}</div>

        {error !== undefined && <p className={css.formError}>{error}</p>}

        <footer className={css.modalFooter}>
          <button type="button" className={css.ghostButton} onClick={onClose}>
            {t('new.cancel')}
          </button>
          {secondaryAction !== undefined && (
            <button
              type="button"
              className={css.ghostButton}
              disabled={pending}
              onClick={secondaryAction.onSubmit}
            >
              {secondaryAction.label}
            </button>
          )}
          <button type="submit" className={css.primaryButton} disabled={pending}>
            {submitLabel}
          </button>
        </footer>
      </form>
    </div>
  )
}

/**
 * One collapsible region of a task form (create/edit dialog UX): the form
 * groups its configuration into a few regions instead of stacking every field
 * in one long column, so a normal-sized dialog needs no scrollbar. A collapsed
 * region keeps a one-line summary of the values it holds, so nothing is hidden
 * without a trace; a region holding a blocking error is forced open by its
 * owner (forceOpen) rather than reporting the error out of sight.
 *
 * The body is the panel fold's body under another name: it enters and leaves on
 * the same animation pair, and `usePresence` keeps it mounted through the exit
 * leg so collapsing never snaps.
 */
export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  forceOpen = false,
  keepMounted = false,
  children,
}: {
  title: string
  /** One-line value preview rendered only while the region is collapsed. */
  summary?: string | undefined
  /** Whether the region starts expanded (the owner's default layout). */
  defaultOpen?: boolean
  /** Open regardless of the stored state: an error inside must stay visible. */
  forceOpen?: boolean
  /** Keep children mounted while collapsed so provider seats keep their local state. */
  keepMounted?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [openedOnce, setOpenedOnce] = useState(defaultOpen || forceOpen)
  const panelId = useId()
  const expanded = forceOpen || open
  if (expanded && !openedOnce) setOpenedOnce(true)
  const presence = usePresence(expanded)
  const rendered = presence.mounted || (keepMounted && openedOnce)
  // The one-line preview is also the row's title, so the line that ellipsizes
  // in the header stays readable in full (same rule as the panel's folds).
  const fullLine = summary ?? ''
  return (
    <section className={css.formSection} data-dsh-part="form-section" data-open={expanded ? 'true' : undefined}>
      <button
        type="button"
        className={css.formSectionHeader}
        aria-expanded={expanded}
        aria-controls={panelId}
        title={fullLine === '' ? undefined : fullLine}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.formSectionChevron} aria-hidden="true" />
        <span className={css.formSectionTitle}>{title}</span>
        {!expanded && summary !== undefined && summary !== '' && (
          <span className={css.formSectionSummary}>{summary}</span>
        )}
      </button>
      {rendered && (
        <div
          className={css.formSectionBody}
          id={panelId}
          data-state={presence.mounted ? presence.phase : 'closed'}
          hidden={!presence.mounted}
        >
          {children}
        </div>
      )}
    </section>
  )
}

/** Title + description + prompt fields shared by the new and edit task forms. */
export function TaskContentFields({
  title,
  description,
  prompt,
  onTitleChange,
  onDescriptionChange,
  onPromptChange,
}: {
  title: string
  description: string
  prompt: string
  /** Receives the new title; the owner also clears its error state. */
  onTitleChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onPromptChange: (value: string) => void
}) {
  return (
    <>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('new.title')}</span>
        <input
          className={css.input}
          value={title}
          autoFocus
          placeholder={t('new.titlePlaceholder')}
          onChange={event => onTitleChange(event.target.value)}
        />
      </label>

      <label className={css.field}>
        <span className={css.fieldLabel}>{t('new.description')}</span>
        <textarea
          className={css.input}
          rows={2}
          value={description}
          placeholder={t('new.descriptionPlaceholder')}
          onChange={event => onDescriptionChange(event.target.value)}
        />
      </label>

      <label className={css.field}>
        <span className={css.fieldLabel}>{t('new.prompt')}</span>
        <textarea
          className={css.input}
          rows={4}
          value={prompt}
          placeholder={t('new.promptPlaceholder')}
          onChange={event => onPromptChange(event.target.value)}
        />
      </label>
    </>
  )
}

/**
 * Task labels (issue #1521): one row per label holding the badge name and an
 * optional execution hint. The name inputs offer the labels already used on the
 * board through a datalist, and picking one adopts its hint when the row has
 * none — so a business line is defined once and reused by every later task.
 */
export function TaskTagFields({
  tags,
  knownTags,
  onChange,
}: {
  tags: TaskTag[]
  /** Labels already carried elsewhere on the board. */
  knownTags: TaskTag[]
  onChange: (tags: TaskTag[]) => void
}) {
  const update = (index: number, patch: Partial<TaskTag>): void => {
    onChange(tags.map((tag, position) => (position === index ? { ...tag, ...patch } : tag)))
  }

  return (
    <div className={css.field}>
      <span className={css.fieldLabel}>{t('new.tags')}</span>
      <span className={css.fieldHint}>{t('new.tagsHint')}</span>
      {tags.map((tag, index) => (
        <div className={css.tagRow} key={index}>
          <input
            className={css.input}
            list={TAG_NAME_LIST_ID}
            value={tag.name}
            maxLength={TAG_NAME_MAX_LENGTH}
            placeholder={t('new.tagNamePlaceholder')}
            aria-label={t('new.tagName')}
            onChange={(event) => {
              const name = event.target.value
              const known = knownTags.find(candidate => candidate.name === name)
              const adoptsHint = known?.promptPrefix !== undefined && (tag.promptPrefix ?? '').trim() === ''
              update(index, adoptsHint ? { name, promptPrefix: known.promptPrefix } : { name })
            }}
          />
          <input
            className={css.input}
            value={tag.promptPrefix ?? ''}
            maxLength={TAG_PROMPT_MAX_LENGTH}
            placeholder={t('new.tagPromptPlaceholder')}
            aria-label={t('new.tagPrompt')}
            onChange={event => { update(index, { promptPrefix: event.target.value }) }}
          />
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('new.tagRemove', { name: tag.name })}
            onClick={() => { onChange(tags.filter((_, position) => position !== index)) }}
          >
            <IconClose size={14} />
          </button>
        </div>
      ))}
      <datalist id={TAG_NAME_LIST_ID}>
        {knownTags.map(tag => <option key={tag.name} value={tag.name} />)}
      </datalist>
      <button
        type="button"
        className={css.ghostButton + ' ' + css.tagAddButton}
        disabled={tags.length >= TASK_TAG_LIMIT}
        onClick={() => { onChange([...tags, { name: '' }]) }}
      >
        <IconPlus size={14} />
        {t('new.tagAdd')}
      </button>
    </div>
  )
}

/**
 * Clean a tag list via normalizeTags: trim, drop blanks and duplicates, cap
 * lengths and count, so the wire always carries a valid tag list.
 */
export function cleanTags(tags: readonly TaskTag[]): TaskTag[] {
  return normalizeTags(tags) ?? []
}
