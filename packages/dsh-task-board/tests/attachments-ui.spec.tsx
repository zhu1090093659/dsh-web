// @vitest-environment jsdom
/**
 * The attachment field of the card forms: the three ways a file enters the
 * form, the local preview it gets, the upload that happens when the card is
 * saved, and the failure a refused upload shows.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewTaskModal } from '../src/client/board/NewTaskModal.tsx'
import { EditTaskModal } from '../src/client/board/EditTaskModal.tsx'
import { t } from '../src/client/locales.ts'
import { openFormSection } from './form-sections.ts'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import type { TaskAttachment } from '../src/core/attachment.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

beforeEach(() => {
  let counter = 0
  ;(URL as { createObjectURL?: unknown }).createObjectURL = () => `blob:staged-${counter += 1}`
  ;(URL as { revokeObjectURL?: unknown }).revokeObjectURL = () => undefined
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  ;(URL as { createObjectURL?: unknown }).createObjectURL = originalCreate
  ;(URL as { revokeObjectURL?: unknown }).revokeObjectURL = originalRevoke
})

/** The metadata the Host computed for the uploaded file. */
const stored: TaskAttachment = {
  kind: 'file',
  attachmentId: 'file-1',
  name: 'notes.txt',
  bytes: 5,
  mediaType: 'text/plain',
  sha256: 'a1'.repeat(32),
}

/** The controller the forms read; the upload is the only attachment call. */
/** The attachment limits a deployment publishes for the board. */
interface PublishedLimits {
  maxAttachments: number
  maxBytes: number
  maxTotalBytes: number
  maxImages: number
  maxImageBytes: number
  maxMessageImageBytes: number
}

function fakeController(options: { upload?: (file: File) => Promise<TaskAttachment | undefined>; attachmentLimits?: PublishedLimits } = {}) {
  const snapshot: ControllerSnapshot = {
    tasks: [],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: undefined,
    executionOptions: { workspaces: [], presets: [], models: [] },
    pendingTaskIds: [],
    host: {
      revision: 1,
      scheduler: { timeZone: 'UTC' },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
      ...(options.attachmentLimits === undefined ? {} : { attachmentLimits: options.attachmentLimits }),
    },
  }
  const createTaskConfirmed = vi.fn(async (_input: { attachments?: TaskAttachment[] }) => ({ id: 'task-new' }) as TaskRecord)
  const updateTask = vi.fn(async (_id: string, _patch: { attachments?: TaskAttachment[] | null }) => true)
  // The upload fake answers per FILE, so a case can give two different
  // files two different storage identifiers — or the same one, as a
  // content-addressed storage would for the same bytes.
  const uploadAttachment = vi.fn(async (file: File) => options.upload === undefined
    ? stored
    : await options.upload(file))
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    createTaskConfirmed,
    updateTask,
    uploadAttachment,
  } as unknown as BoardController
  return { controller, createTaskConfirmed, updateTask, uploadAttachment }
}

/** A file the browser handed to the form. */
function pickedFile(name: string, type: string, content = 'hello', lastModified = 1): File {
  return new File([content], name, { type, lastModified })
}

/** The attachments region of the rendered form. */
function attachmentsArea(container: HTMLElement): HTMLElement {
  const area = filePicker(container).parentElement
  if (area === null) throw new Error('no attachment area in the form')
  return area
}

/** The hidden file picker of the attachment area. */
function filePicker(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (input === null) throw new Error('no file picker in the attachment area')
  return input
}

/** Hand the form a file through its file picker. */
function pickThroughPicker(container: HTMLElement, file: File): void {
  const input = filePicker(container)
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
}

/** Hand the form a file through a drop. */
function dropFile(container: HTMLElement, file: File): void {
  const area = attachmentsArea(container)
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file] }, configurable: true })
  act(() => { area.dispatchEvent(event) })
}

/** Hand the form a file through a paste. */
function pasteFile(container: HTMLElement, file: File): void {
  const area = attachmentsArea(container)
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files: [file] }, configurable: true })
  act(() => { area.dispatchEvent(event) })
}

/** The form element of the rendered modal. */
function formOf(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector('form')
  if (form === null) throw new Error('no form in the modal')
  return form
}

describe('the attachment field of the new-task dialog', () => {
  it('user picking a file stages it locally and uploads it only when the card is saved', async () => {
    // Given a new-task dialog with an attachment area
    const { controller, createTaskConfirmed, uploadAttachment } = fakeController()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    // When the user picks a file
    pickThroughPicker(container, pickedFile('notes.txt', 'text/plain'))
    // Then the file is staged with its name and size, and nothing was uploaded
    expect(container.textContent).toContain('notes.txt')
    expect(uploadAttachment).not.toHaveBeenCalled()
    // And when the card is saved
    await act(async () => { formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    // Then the file was uploaded and the card carries the stored metadata
    expect(uploadAttachment).toHaveBeenCalledOnce()
    expect(createTaskConfirmed).toHaveBeenCalledOnce()
    const input = createTaskConfirmed.mock.calls[0][0]
    expect(input.attachments).toEqual([stored])
  })

  it('user dropping a file on the attachments area stages it', async () => {
    // Given a new-task dialog with an attachment area
    const { controller } = fakeController()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    // When the user drops a file on the area
    dropFile(container, pickedFile('dropped.txt', 'text/plain'))
    // Then the file is staged with its name
    expect(container.textContent).toContain('dropped.txt')
  })

  it('user pasting a file into the attachments area stages it', async () => {
    // Given a new-task dialog with an attachment area
    const { controller } = fakeController()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    // When the user pastes a file into the area
    pasteFile(container, pickedFile('pasted.png', 'image/png'))
    // Then the file is staged and previewed as an image
    expect(container.textContent).toContain('pasted.png')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:staged-1')
  })

  it('user removing a staged file drops it before the card is saved', async () => {
    // Given a new-task dialog with one staged file
    const { controller, uploadAttachment, createTaskConfirmed } = fakeController()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    pickThroughPicker(container, pickedFile('notes.txt', 'text/plain'))
    // When the user removes the staged row
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label^="' + t('new.attachments.remove').split('{')[0] + '"]')
    if (remove === null) throw new Error('no remove button on the staged row')
    act(() => { remove.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // Then the row is gone and the card carries no attachment
    expect(container.textContent).not.toContain('notes.txt')
    await act(async () => { formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(uploadAttachment).not.toHaveBeenCalled()
    const input = createTaskConfirmed.mock.calls[0][0]
    expect(input.attachments).toBeUndefined()
  })

  it('user sees the refusal of a refused upload and no card is created', async () => {
    // Given a new-task dialog whose upload is refused
    const { controller, createTaskConfirmed } = fakeController({
      upload: async () => { throw new Error('the attachment storage is unavailable') },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    pickThroughPicker(container, pickedFile('notes.txt', 'text/plain'))
    // When the user saves the card
    await act(async () => { formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    // Then the failure is shown and no card was created
    expect(container.textContent).toContain('the attachment storage is unavailable')
    expect(createTaskConfirmed).not.toHaveBeenCalled()
  })

  it('user picking the same file twice stages it once', async () => {
    // Given a new-task dialog with an attachment area
    const { controller } = fakeController()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    // When the user picks the same file twice
    const file = pickedFile('notes.txt', 'text/plain')
    pickThroughPicker(container, file)
    pickThroughPicker(container, file)
    // Then the form shows one row for it
    const rows = container.querySelectorAll('li')
    expect(rows.length).toBe(1)
  })

  it('user staging two files that share their metadata keeps both', async () => {
    // Given a new-task dialog whose upload answers one identifier per file
    // The storage answers one identifier per uploaded object, in upload order
    let uploads = 0
    const { controller, createTaskConfirmed, uploadAttachment } = fakeController({
      upload: async (file: File) => {
        uploads += 1
        return {
          kind: 'file',
          attachmentId: uploads === 1 ? 'file-first' : 'file-second',
          name: file.name,
          bytes: file.size,
          mediaType: file.type,
          sha256: 'a1'.repeat(32),
        }
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    // When the user stages two DIFFERENT files that share every metadata
    // field the browser offers (name, size, type, modification time)
    const first = pickedFile('notes.txt', 'text/plain', 'first content', 1_700_000_000_000)
    const second = pickedFile('notes.txt', 'text/plain', 'other content', 1_700_000_000_000)
    expect(first.size).toBe(second.size)
    expect(first.lastModified).toBe(second.lastModified)
    pickThroughPicker(container, first)
    pickThroughPicker(container, second)
    // Then both are staged: metadata is not a content identity
    expect(container.querySelectorAll('li').length).toBe(2)
    // And when the card is saved, both are uploaded
    await act(async () => { formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(uploadAttachment).toHaveBeenCalledTimes(2)
    // And the card carries both, because the Host answered two identifiers
    const input = createTaskConfirmed.mock.calls[0][0]
    expect(input.attachments?.map(attachment => attachment.attachmentId)).toEqual(['file-first', 'file-second'])
  })

  it('user staging two files the Host stores as one object keeps the first', async () => {
    // Given a new-task dialog whose upload answers the SAME identifier twice
    const { controller, createTaskConfirmed, uploadAttachment } = fakeController({
      upload: async (file: File) => ({
        kind: 'file',
        attachmentId: 'file-same',
        name: file.name,
        bytes: file.size,
        mediaType: file.type,
        sha256: 'a1'.repeat(32),
      }),
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    // When the user stages two files the storage turns into one object
    pickThroughPicker(container, pickedFile('notes.txt', 'text/plain', 'first content', 1_700_000_000_000))
    pickThroughPicker(container, pickedFile('notes.txt', 'text/plain', 'second content', 1_700_000_000_000))
    await act(async () => { formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    // Then both were uploaded, but the card claims the object once
    expect(uploadAttachment).toHaveBeenCalledTimes(2)
    const input = createTaskConfirmed.mock.calls[0][0]
    expect(input.attachments?.map(attachment => attachment.attachmentId)).toEqual(['file-same'])
  })

  it('user releasing the object URL of a removed file and of a closed form', async () => {
    // Given a new-task dialog with one staged image
    const revoked: string[] = []
    ;(URL as { revokeObjectURL?: unknown }).revokeObjectURL = (url: string) => { revoked.push(url) }
    const { controller } = fakeController()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    pasteFile(container, pickedFile('pasted.png', 'image/png'))
    // When the user removes the staged row
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label^="' + t('new.attachments.remove').split('{')[0] + '"]')
    if (remove === null) throw new Error('no remove button on the staged row')
    act(() => { remove.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // Then its object URL is released
    expect(revoked).toEqual(['blob:staged-1'])
    // And when the form closes, every remaining object URL is released too
    pasteFile(container, pickedFile('second.png', 'image/png'))
    act(() => { root.unmount() })
    roots.splice(roots.indexOf(root), 1)
    expect(revoked).toContain('blob:staged-2')
  })

  it('user reaching the attachments area with the keyboard opens the picker', async () => {
    // Given a new-task dialog with an attachment area
    const { controller } = fakeController()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    const area = attachmentsArea(container)
    // Then the area is focusable
    expect(area.getAttribute('tabindex')).toBe('0')
    // And when the user presses Enter on it, the picker opens exactly once
    const input = filePicker(container)
    let opened = 0
    input.addEventListener('click', () => { opened += 1 })
    act(() => {
      area.focus()
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(opened).toBe(1)
    // And a key press on the button inside the region does not open it twice
    const button = area.querySelector('button')
    if (button === null) throw new Error('no button in the attachments area')
    opened = 0
    act(() => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(opened).toBe(0)
  })

  it('user unable to stage more images than the deployment admits per message', async () => {
    // Given a new-task dialog in a deployment that admits one image per message
    const { controller } = fakeController({
      attachmentLimits: {
        maxAttachments: 8,
        maxBytes: 10 * 1024 * 1024,
        maxTotalBytes: 32 * 1024 * 1024,
        maxImages: 1,
        maxImageBytes: 10 * 1024 * 1024,
        maxMessageImageBytes: 32 * 1024 * 1024,
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    // When the user stages a second image
    pasteFile(container, pickedFile('first.png', 'image/png'))
    pasteFile(container, pickedFile('second.png', 'image/png'))
    // Then the second one is refused and only the first is staged
    const rows = container.querySelectorAll('li')
    expect(rows.length).toBe(1)
    expect(container.textContent).toContain('first.png')
    expect(container.textContent).not.toContain('second.png')
  })

  it('user unable to open the picker or stage a file while the form is submitting', async () => {
    // Given a new-task dialog whose upload never finishes
    let release: (() => void) | undefined
    const { controller, uploadAttachment } = fakeController({
      upload: async () => await new Promise<TaskAttachment>((resolve) => {
        release = () => { resolve(stored) }
      }),
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    pickThroughPicker(container, pickedFile('notes.txt', 'text/plain'))
    // When the user saves the card
    act(() => { formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    const area = attachmentsArea(container)
    const input = filePicker(container)
    // Then the region says it is disabled and left the tab order
    expect(area.getAttribute('aria-disabled')).toBe('true')
    expect(area.getAttribute('tabindex')).toBe('-1')
    expect(input.disabled).toBe(true)
    // And the keyboard does not open the picker
    let opened = 0
    input.addEventListener('click', () => { opened += 1 })
    act(() => {
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      area.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    })
    expect(opened).toBe(0)
    // And a drag over the region does not style it as a drop target
    act(() => {
      area.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
    })
    expect(area.getAttribute('data-state')).toBeNull()
    // And a dropped or pasted file does not mutate the selection
    const rowsBefore = container.querySelectorAll('li').length
    dropFile(container, pickedFile('dropped.txt', 'text/plain'))
    pasteFile(container, pickedFile('pasted.txt', 'text/plain'))
    expect(container.querySelectorAll('li').length).toBe(rowsBefore)
    release?.()
    await act(async () => { await Promise.resolve() })
    expect(uploadAttachment).toHaveBeenCalledOnce()
  })

  it('user unable to remove an attachment while the form is submitting', async () => {
    // Given a new-task dialog whose upload never finishes
    let release: (() => void) | undefined
    const { controller } = fakeController({
      upload: async () => await new Promise<TaskAttachment>((resolve) => {
        release = () => { resolve(stored) }
      }),
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
    openFormSection(container, t('new.section.attachments'))
    pickThroughPicker(container, pickedFile('notes.txt', 'text/plain'))
    // When the user saves the card
    act(() => { formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    // Then the removal control is disabled, so the submitted set cannot race an edit
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label^="' + t('new.attachments.remove').split('{')[0] + '"]')
    if (remove === null) throw new Error('no remove button on the staged row')
    expect(remove.disabled).toBe(true)
    release?.()
  })
})

describe('the attachment field of the edit dialog', () => {
  it('user removing a stored attachment drops it from the card', async () => {
    // Given an edit dialog of a card that carries one attachment
    const task = { ...createTask({ title: 'A', description: '', prompt: 'p' }, 1, 'task-a'), attachments: [stored] }
    const { controller, updateTask } = fakeController()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<EditTaskModal controller={controller} task={task} onClose={() => {}} />) })
    // When the user removes the stored attachment and saves
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label^="' + t('new.attachments.remove').split('{')[0] + '"]')
    if (remove === null) throw new Error('no remove button on the stored attachment')
    act(() => { remove.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    // Then the card is saved without attachments
    const patch = updateTask.mock.calls[0][1]
    expect(patch.attachments).toBeNull()
  })

  it('user adding the content of a stored attachment keeps one entry for it', async () => {
    // Given an edit dialog of a card that carries one attachment
    const task = { ...createTask({ title: 'A', description: '', prompt: 'p' }, 1, 'task-a'), attachments: [stored] }
    const { controller, updateTask, uploadAttachment } = fakeController()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<EditTaskModal controller={controller} task={task} onClose={() => {}} />) })
    // When the user adds a file that the storage answers with the same identifier
    pickThroughPicker(container, pickedFile('notes.txt', 'text/plain'))
    await act(async () => { formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    // Then the file was uploaded, the repeated identifier was dropped, and
    // the unchanged set is not written back at all
    expect(uploadAttachment).toHaveBeenCalledOnce()
    const patch = updateTask.mock.calls[0][1]
    expect('attachments' in patch).toBe(false)
  })

  it('user editing only the title leaves the attachments untouched', async () => {
    // Given an edit dialog of a card that carries one attachment
    const task = { ...createTask({ title: 'A', description: '', prompt: 'p' }, 1, 'task-a'), attachments: [stored] }
    const { controller, updateTask, uploadAttachment } = fakeController()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<EditTaskModal controller={controller} task={task} onClose={() => {}} />) })
    // When the user changes the title and saves
    const title = container.querySelector('input')
    if (title === null) throw new Error('no title input in the edit dialog')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(title, 'B')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    // Then the patch carries no attachments at all: the Host must not re-read
    // and re-verify the stored objects for an unchanged set
    expect(uploadAttachment).not.toHaveBeenCalled()
    const patch = updateTask.mock.calls[0][1]
    expect('attachments' in patch).toBe(false)
  })

  it('user editing only the title still works without an attachment storage', async () => {
    // Given an edit dialog of a card that carries one attachment, in a
    // deployment whose attachment storage is unavailable
    const task = { ...createTask({ title: 'A', description: '', prompt: 'p' }, 1, 'task-a'), attachments: [stored] }
    const { controller, updateTask, uploadAttachment } = fakeController({
      upload: async () => { throw new Error('the attachment storage is unavailable') },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    act(() => { root.render(<EditTaskModal controller={controller} task={task} onClose={() => {}} />) })
    // When the user changes the title and saves
    const title = container.querySelector('input')
    if (title === null) throw new Error('no title input in the edit dialog')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(title, 'B')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    // Then the card is saved and the storage was never needed
    expect(uploadAttachment).not.toHaveBeenCalled()
    expect(updateTask).toHaveBeenCalledOnce()
    expect(container.textContent).not.toContain('the attachment storage is unavailable')
  })
})
