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

/** Edit-task form overlay. */
export function EditTaskModal({ controller, task, onClose }: { controller: BoardController; task: TaskRecord; onClose: () => void }) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [prompt, setPrompt] = useState(task.prompt)
  const [tags, setTags] = useState<TaskTag[]>(task.tags ?? [])
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
    const patch = {
      title,
      description,
      prompt,
      ...(tagList.length > 0 ? { tags: tagList } : (task.tags === undefined ? {} : { tags: null })),
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
    </ModalShell>
  )
}

/** Edit-tags modal: edit labels only, shown for tasks after first execution. */
export function EditTagsModal({ controller, task, onClose }: { controller: BoardController; task: TaskRecord; onClose: () => void }) {
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
    >
      <TaskTagFields tags={tags} knownTags={collectKnownTags(controller.getSnapshot().tasks)} onChange={setTags} />
    </ModalShell>
  )
}

