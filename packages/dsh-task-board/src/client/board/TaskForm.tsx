/**
 * Shared task-modal pieces: the overlay shell (backdrop, form, title, error,
 * footer) and the title/description/prompt field trio used by both the
 * NewTaskModal and the EditTaskModal. State stays in the owning modal; these
 * are controlled components.
 */
import type { ReactNode } from 'react'
import { TAG_NAME_MAX_LENGTH, TAG_PROMPT_MAX_LENGTH, TASK_TAG_LIMIT, normalizeTags, type TaskTag } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'

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
  children: ReactNode
}) {
  return (
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <form
        className={css.modal}
        role="dialog"
        aria-label={ariaLabel}
        onSubmit={event => { event.preventDefault(); onSubmit() }}
      >
        <h2 className={css.modalTitle}>{title}</h2>

        {children}

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
          rows={3}
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
            className={css.ghostButton}
            aria-label={t('new.tagRemove', { name: tag.name })}
            onClick={() => { onChange(tags.filter((_, position) => position !== index)) }}
          >
            ×
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
        + {t('new.tagAdd')}
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
