/**
 * Edit-task modal: title + description + the prompt the next execution will
 * send, pre-filled from the task. Shown only for tasks that have never
 * started executing (the detail view gates on canEditTaskContent); the Host
 * still re-checks at submit, so a task that started running while the modal
 * was open fails closed and the error surfaces here.
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { collectKnownTags, type TaskRecord, type TaskTag } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import { ModalShell, TaskContentFields, TaskTagFields, cleanTags } from './TaskForm.tsx'
import { AttachmentField, type AttachmentSelection } from './AttachmentField.tsx'
import { dedupeAttachments, type TaskAttachment } from '../../core/attachment.ts'
import type { OverlayPhase } from './overlay.tsx'
import css from '../board.module.css'

/** Edit-task form overlay. */
export function EditTaskModal({ controller, task, onClose, phase }: { controller: BoardController; task: TaskRecord; onClose: () => void; phase?: OverlayPhase }) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [prompt, setPrompt] = useState(task.prompt)
  const [tags, setTags] = useState<TaskTag[]>(task.tags ?? [])
  // The card's attachments: the stored ones the user kept, plus the files
  // staged locally. A staged file is uploaded when the card is SAVED.
  const [attachments, setAttachments] = useState<AttachmentSelection>({
    persisted: task.attachments ?? [],
    staged: [],
  })
  const [attachmentError, setAttachmentError] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState(false)

  const submit = async (): Promise<void> => {
    if (title.trim() === '') {
      setError(t('new.required'))
      return
    }
    setPending(true)
    // The Host confirms the mutation (and its fail-closed checks); only a
    // confirmed save closes the modal.
    // Labels ride the same patch as the content fields. A task that never
    // carried one is not sent a clearing null: the wire stays minimal, and the
    // no-tags path keeps producing exactly the patch it produced before.
    const tagList = cleanTags(tags)
    // The staged files are uploaded when the card is saved, never when they
    // are picked: an abandoned edit leaves no stored object behind.
    const uploaded: TaskAttachment[] = []
    for (const staged of attachments.staged) {
      setAttachments(current => markStaged(current, staged.id, { pending: true, error: undefined }))
      try {
        const attachment = await controller.uploadAttachment(staged.file, staged.kind)
        if (attachment === undefined) throw new Error(t('new.attachments.unavailable'))
        uploaded.push(attachment)
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : String(uploadError)
        setAttachments(current => markStaged(current, staged.id, { pending: false, error: message }))
        setPending(false)
        setError(message)
        return
      }
    }
    const carried = dedupeAttachments([...attachments.persisted, ...uploaded])
    // The attachments ride the patch ONLY when the resulting ordered set
    // differs from the card's current one: a title-only edit must not make
    // the Host re-read and re-verify the stored objects, and it must still
    // work in a deployment whose attachment storage is unavailable.
    const current = task.attachments ?? []
    const unchanged = current.length === carried.length
      && current.every((attachment, index) => attachment.attachmentId === carried[index]?.attachmentId)
    const patch = {
      title,
      description,
      prompt,
      ...(tagList.length > 0 ? { tags: tagList } : (task.tags === undefined ? {} : { tags: null })),
      // An array REPLACES the stored set; an explicit null clears it. A card
      // whose set did not change sends nothing at all.
      ...(unchanged
        ? {}
        : (carried.length > 0 ? { attachments: carried } : { attachments: null })),
    }
    if (await controller.updateTask(task.id, patch)) {
      onClose()
      return
    }
    setPending(false)
    setError(controller.getSnapshot().transportError ?? t('new.required'))
  }

  return (
    <ModalShell
      ariaLabel={t('edit.title')}
      title={t('edit.title')}
      error={error}
      pending={pending}
      submitLabel={t('edit.save')}
      onSubmit={() => { void submit() }}
      onClose={onClose}
      phase={phase}
    >
      <TaskContentFields
        title={title}
        description={description}
        prompt={prompt}
        onTitleChange={value => { setTitle(value); setError(undefined) }}
        onDescriptionChange={setDescription}
        onPromptChange={setPrompt}
      />

      <TaskTagFields tags={tags} knownTags={collectKnownTags(controller.getSnapshot().tasks)} onChange={setTags} />

      <AttachmentField
        selection={attachments}
        onChange={setAttachments}
        limits={controller.getSnapshot().host?.attachmentLimits}
        // Attachments freeze at the first run (they are not snapshotted on
        // the execution record); an executed card edits its content only.
        disabled={pending || task.executions.length > 0}
        lockedHint={task.executions.length > 0 ? t('edit.attachmentsLocked') : undefined}
        onError={message => { setAttachmentError(message) }}
      />
      {attachmentError !== undefined && <p className={css.formError}>{attachmentError}</p>}
    </ModalShell>
  )
}

/**
 * Mark one staged attachment row: the upload state and the failure reason.
 */
function markStaged(
  selection: AttachmentSelection,
  id: string,
  patch: { pending?: boolean; error?: string },
): AttachmentSelection {
  return {
    ...selection,
    staged: selection.staged.map(staged => staged.id === id ? { ...staged, ...patch } : staged),
  }
}

/** Edit-tags modal: edit labels only, shown for tasks after first execution. */
export function EditTagsModal({ controller, task, onClose, phase }: { controller: BoardController; task: TaskRecord; onClose: () => void; phase?: OverlayPhase }) {
  const [tags, setTags] = useState<TaskTag[]>(task.tags ?? [])
  const [error, setError] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState(false)

  const submit = async (): Promise<void> => {
    setPending(true)
    const tagList = cleanTags(tags)
    const patch = {
      tags: tagList.length > 0 ? tagList : null,
    }
    if (await controller.updateTask(task.id, patch)) {
      onClose()
      return
    }
    setPending(false)
    setError(controller.getSnapshot().transportError ?? t('new.required'))
  }

  return (
    <ModalShell
      ariaLabel={t('detail.editTags')}
      title={t('detail.editTags')}
      error={error}
      pending={pending}
      submitLabel={t('edit.save')}
      onSubmit={() => { void submit() }}
      onClose={onClose}
      phase={phase}
    >
      <TaskTagFields tags={tags} knownTags={collectKnownTags(controller.getSnapshot().tasks)} onChange={setTags} />
    </ModalShell>
  )
}

