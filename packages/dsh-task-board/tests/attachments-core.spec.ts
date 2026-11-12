/**
 * Card attachments: the durable metadata, its limits, the ledger generations
 * it survives, and the gates that keep an unverified claim off the ledger.
 */
import { mkdtempSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalAttachmentName,
  dedupeAttachments,
  TASK_ATTACHMENT_LIMIT,
  TASK_ATTACHMENT_MAX_BYTES,
  TASK_ATTACHMENT_TOTAL_MAX_BYTES,
  isTaskAttachment,
  isTaskAttachmentList,
  normalizeAttachments,
  type TaskAttachment,
} from '../src/core/attachment.ts'
import { parseLedger } from '../src/core/store.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { applyUpdateTask, canEditTaskContent, hasContentPatch } from '../src/core/use-cases/task-update.ts'
import { parseActionEnvelope, TASK_BOARD_SCHEMA_VERSION } from '../src/protocol.ts'
import { HostTaskLedger } from '../src/host-ledger.ts'

const NOW = new Date(2026, 7, 16, 10, 0, 30).getTime()
const roots: string[] = []

/** A fresh temporary ledger directory; its files are removed by name afterwards. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-task-board-attachments-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    for (const entry of readdirSync(root)) unlinkSync(join(root, entry))
    rmdirSync(root)
  }
})

/** One stored image attachment. */
function imageAttachment(overrides: Partial<TaskAttachment> = {}): TaskAttachment {
  return {
    kind: 'image',
    attachmentId: 'attachment-image-1',
    name: 'shot.png',
    bytes: 2048,
    mediaType: 'image/png',
    sha256: 'a1'.repeat(32),
    width: 800,
    height: 600,
    ...overrides,
  }
}

/** One stored file attachment. */
function fileAttachment(overrides: Partial<TaskAttachment> = {}): TaskAttachment {
  return {
    kind: 'file',
    attachmentId: 'attachment-file-1',
    name: 'notes.txt',
    bytes: 128,
    mediaType: 'text/plain',
    sha256: 'b2'.repeat(32),
    ...overrides,
  }
}

/** A persisted card row, as the ledger writes it. */
function cardRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-a',
    title: 'Legacy card',
    description: 'A description',
    prompt: 'do the work',
    status: 'todo',
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    executions: [],
    ...overrides,
  }
}

describe('card attachment metadata', () => {
  it('operator loading a card keeps the well-formed attachments and drops the malformed ones', () => {
    // Given a persisted card whose attachment list mixes valid and broken rows
    const raw = JSON.stringify([cardRow({
      attachments: [
        imageAttachment(),
        { kind: 'image', attachmentId: 'broken', name: '', bytes: 10, mediaType: 'image/png', sha256: 'c3'.repeat(32) },
        fileAttachment(),
        { kind: 'file', attachmentId: 'broken', name: 'a.txt', bytes: 1, mediaType: 'text/plain', sha256: 'not-a-digest' },
      ],
    })])
    // When the ledger loads the document
    const tasks = parseLedger(raw)
    // Then only the two well-formed attachments survive the repair
    expect(tasks[0].attachments).toEqual([imageAttachment(), fileAttachment()])
  })

  it('operator loading a card keeps at most the allowed number of attachments', () => {
    // Given a card carrying more attachments than the board allows
    const many = Array.from({ length: TASK_ATTACHMENT_LIMIT + 3 }, (_, index) =>
      imageAttachment({ attachmentId: `attachment-${index}`, bytes: 1024 }))
    const tasks = parseLedger(JSON.stringify([cardRow({ attachments: many })]))
    // When the ledger loads the document
    // Then the list is capped at the card limit
    expect(tasks[0].attachments).toHaveLength(TASK_ATTACHMENT_LIMIT)
    expect(tasks[0].attachments?.map(attachment => attachment.attachmentId))
      .toEqual(many.slice(0, TASK_ATTACHMENT_LIMIT).map(attachment => attachment.attachmentId))
  })

  it('operator loading a card drops an attachment that exceeds the byte caps', () => {
    // Given a card carrying one normal attachment, one oversized attachment and
    // one attachment that alone exhausts the total budget
    const tasks = parseLedger(JSON.stringify([cardRow({
      attachments: [
        imageAttachment({ attachmentId: 'normal', bytes: 1024 }),
        imageAttachment({ attachmentId: 'oversized', bytes: TASK_ATTACHMENT_MAX_BYTES + 1 }),
        imageAttachment({ attachmentId: 'exhausting', bytes: TASK_ATTACHMENT_TOTAL_MAX_BYTES }),
      ],
    })]))
    // When the ledger loads the document
    // Then only the attachment inside both caps survives
    expect(tasks[0].attachments?.map(attachment => attachment.attachmentId)).toEqual(['normal'])
  })

  it('operator submitting attachments through the wire keeps only a well-formed list', () => {
    // Given a create action whose input carries an attachment with an extra field
    const malformed = parseActionEnvelope({
      requestId: 'request-a',
      action: {
        kind: 'create',
        id: 'task-a',
        input: { title: 'A', description: '', prompt: '', attachments: [{ ...imageAttachment(), unexpected: true }] },
      },
    })
    // When the wire gate reads the action
    // Then the action is refused
    expect(malformed).toBeUndefined()
    // And a well-formed attachment list is accepted
    const accepted = parseActionEnvelope({
      requestId: 'request-b',
      action: {
        kind: 'create',
        id: 'task-a',
        input: { title: 'A', description: '', prompt: '', attachments: [imageAttachment()] },
      },
    })
    expect(accepted?.action.kind).toBe('create')
  })

  it('operator creating a card stores the attachment metadata the Host verified', () => {
    // Given a create input carrying a verified image and a verified file
    const task = createTask(
      { title: 'A', description: '', prompt: '', attachments: [imageAttachment(), fileAttachment()] },
      NOW,
      'task-a',
    )
    // When the card is minted
    // Then the card keeps exactly that metadata
    expect(task.attachments).toEqual([imageAttachment(), fileAttachment()])
  })

  it('operator editing a card replaces the whole attachment set and clears it with an explicit null', () => {
    // Given a card carrying one attachment
    const task = createTask({ title: 'A', description: '', prompt: '', attachments: [imageAttachment()] }, NOW, 'task-a')
    // When the edit replaces the set
    const replaced = applyUpdateTask([task], 'task-a', { attachments: [fileAttachment()] }, NOW + 1)
    // Then the card carries only the new set
    expect(replaced[0].attachments).toEqual([fileAttachment()])
    // And when the edit clears the set explicitly
    const cleared = applyUpdateTask(replaced, 'task-a', { attachments: null }, NOW + 2)
    // Then the card carries none
    expect(cleared[0].attachments).toBeUndefined()
  })

  it('operator cannot change the attachments of a card that already executed', () => {
    // Given a card whose first execution already settled
    const executed: TaskRecord = {
      ...createTask({ title: 'A', description: '', prompt: '', attachments: [imageAttachment()] }, NOW, 'task-a'),
      executions: [{ id: 'exec-1', sessionId: undefined, startedAt: NOW, endedAt: NOW + 1, result: 'succeeded', error: undefined }],
    }
    // When the edit touches the attachments
    // Then the card content is frozen and the patch counts as a content change
    expect(canEditTaskContent(executed)).toBe(false)
    expect(hasContentPatch({ attachments: [fileAttachment()] })).toBe(true)
  })

  it('operator importing a legacy board cannot smuggle attachments into the ledger', () => {
    // Given an import whose task carries attachments
    const parsed = parseActionEnvelope({
      requestId: 'request-a',
      action: { kind: 'import', sourceId: 'legacy', tasks: [cardRow({ attachments: [imageAttachment()] })] },
    })
    // When the wire gate reads the action
    // Then the import is refused
    expect(parsed).toBeUndefined()
  })

  it('operator loading an older ledger document migrates it losslessly and leaves old cards without attachments', () => {
    for (const version of [2, 3, 4, 5, 6]) {
      // Given a ledger document of an older generation
      const root = tempRoot()
      writeFileSync(join(root, 'ledger-v2.json'), JSON.stringify({
        schemaVersion: version,
        revision: 3,
        tasks: [cardRow()],
        scheduler: { timeZone: 'UTC', ledgerId: 'ledger-legacy' },
        recentRequests: [],
      }), 'utf8')
      // When the Host loads it
      const ledger = new HostTaskLedger(root, () => NOW)
      // Then the card keeps every field it had and carries no attachments
      expect(ledger.state().tasks[0].title).toBe('Legacy card')
      expect(ledger.state().tasks[0].description).toBe('A description')
      expect(ledger.state().tasks[0].prompt).toBe('do the work')
      expect(ledger.state().tasks[0].attachments).toBeUndefined()
      expect(ledger.state().revision).toBe(3)
      // And the document is written back as the current generation
      const onDisk = JSON.parse(readFileSync(join(root, 'ledger-v2.json'), 'utf8'))
      expect(onDisk.schemaVersion).toBe(TASK_BOARD_SCHEMA_VERSION)
      ledger.dispose()
    }
  })

  it('operator editing an executed card is refused when the change touches its attachments', () => {
    // Given a card that already ran once
    const root = tempRoot()
    const ledger = new HostTaskLedger(root, () => NOW)
    ledger.applyRequest('request-a', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    ledger.applyRequest('request-b', { kind: 'run', taskId: 'task-a' })
    // When the operator tries to attach something to it
    // Then the ledger refuses the change
    expect(() => ledger.applyRequest('request-c', {
      kind: 'update',
      taskId: 'task-a',
      patch: { attachments: [imageAttachment()] },
    })).toThrow('task has already been executed')
    ledger.dispose()
  })
})

describe('the attachment shape itself', () => {
  it('operator reading one attachment sees only the fields the board stores', () => {
    // Given a stored image attachment
    const attachment = imageAttachment()
    // When the operator reads the stored record
    // Then it carries no bytes, no base64 and no upload instant
    expect(Object.keys(attachment).sort()).toEqual(
      ['attachmentId', 'bytes', 'height', 'kind', 'mediaType', 'name', 'sha256', 'width'].sort(),
    )
    expect(JSON.stringify(attachment)).not.toContain('base64')
    expect(JSON.stringify(attachment)).not.toContain('data:')
    expect(Object.keys(attachment)).not.toContain('addedAt')
  })

  it('operator reading a file attachment sees no pixel size', () => {
    // Given a stored file attachment
    const attachment = fileAttachment()
    // When the operator reads the stored record
    // Then it carries neither width nor height
    expect(isTaskAttachment(attachment)).toBe(true)
    expect(isTaskAttachment({ ...attachment, width: 10 })).toBe(false)
    expect(isTaskAttachment({ ...attachment, height: 10 })).toBe(false)
  })

  it('operator reading an attachment list sees the limits applied', () => {
    // Given a list inside the limits and a list that breaks them
    const inside = [imageAttachment(), fileAttachment()]
    const tooMany = Array.from({ length: TASK_ATTACHMENT_LIMIT + 1 }, (_, index) =>
      imageAttachment({ attachmentId: `attachment-${index}` }))
    const tooHeavy = [imageAttachment({ bytes: TASK_ATTACHMENT_MAX_BYTES + 1 })]
    // When the wire gate reads the lists
    // Then only the list inside the limits is accepted
    expect(isTaskAttachmentList(inside)).toBe(true)
    expect(isTaskAttachmentList(tooMany)).toBe(false)
    expect(isTaskAttachmentList(tooHeavy)).toBe(false)
    expect(isTaskAttachmentList([])).toBe(false)
  })

  it('operator repairing a persisted attachment list sees an empty list collapse to nothing', () => {
    // Given a persisted list whose entries are all unusable
    const repaired = normalizeAttachments([{ kind: 'image' }, null, 'nope'])
    // When the ledger repairs the list
    // Then the field is cleared instead of storing an empty list
    expect(repaired).toBeUndefined()
  })
})

describe('the attachment name', () => {
  it('operator submitting an attachment whose name carries a newline is refused', () => {
    // Given a create action whose attachment name spans two lines
    const parsed = parseActionEnvelope({
      requestId: 'request-a',
      action: {
        kind: 'create',
        id: 'task-a',
        input: { title: 'A', description: '', prompt: '', attachments: [{ ...imageAttachment(), name: 'notes\nsecond line' }] },
      },
    })
    // When the wire gate reads the action
    // Then the action is refused: a name may never break out of its prompt line
    expect(parsed).toBeUndefined()
  })

  it('operator submitting an attachment whose name carries a path is refused', () => {
    // Given a create action whose attachment name names a directory
    const parsed = parseActionEnvelope({
      requestId: 'request-a',
      action: {
        kind: 'create',
        id: 'task-a',
        input: { title: 'A', description: '', prompt: '', attachments: [{ ...fileAttachment(), name: '../../etc/passwd' }] },
      },
    })
    // When the wire gate reads the action
    // Then the action is refused: a name may never point at a path
    expect(parsed).toBeUndefined()
  })

  it('operator loading a card with a forged name keeps a canonical one', () => {
    // Given a persisted card whose attachment name names a directory
    const tasks = parseLedger(JSON.stringify([cardRow({
      attachments: [{ ...imageAttachment(), name: 'shots/shot.png' }],
    })]))
    // When the ledger repairs the list
    // Then the name is the canonical leaf, never the path
    expect(tasks[0].attachments?.[0].name).toBe('shot.png')
  })

  it('operator reading the canonical name of an offered text sees one safe line', () => {
    // Given offered names that carry a path, a newline and control characters
    // When they are canonicalized
    // Then each becomes one line without a path part
    expect(canonicalAttachmentName('dir\\shot.png')).toBe('shot.png')
    expect(canonicalAttachmentName('a\nb')).toBe('a b')
    expect(canonicalAttachmentName('a\u0000b')).toBe('a b')
    expect(canonicalAttachmentName('   ')).toBe('attachment')
  })
})

describe('the attachment identity', () => {
  it('operator submitting the same attachment twice is refused', () => {
    // Given a create action that claims one stored object twice
    const parsed = parseActionEnvelope({
      requestId: 'request-a',
      action: {
        kind: 'create',
        id: 'task-a',
        input: { title: 'A', description: '', prompt: '', attachments: [imageAttachment(), imageAttachment()] },
      },
    })
    // When the wire gate reads the action
    // Then the action is refused: one object cannot be claimed twice
    expect(parsed).toBeUndefined()
  })

  it('operator loading a card with a repeated attachment keeps one of them', () => {
    // Given a persisted card that lists the same object twice
    const tasks = parseLedger(JSON.stringify([cardRow({
      attachments: [imageAttachment(), imageAttachment()],
    })]))
    // When the ledger repairs the list
    // Then the first entry wins and the repeat is dropped
    expect(tasks[0].attachments).toHaveLength(1)
    expect(tasks[0].attachments?.[0].attachmentId).toBe('attachment-image-1')
  })

  it('operator merging two lists of attachments sees the repeated identifier dropped', () => {
    // Given two lists that share one stored object
    const merged = dedupeAttachments([imageAttachment(), fileAttachment(), imageAttachment()])
    // When they are merged
    // Then the first entry of the repeated identifier wins
    expect(merged.map(attachment => attachment.attachmentId)).toEqual(['attachment-image-1', 'attachment-file-1'])
  })
})

describe('the image dimensions', () => {
  it('operator submitting an image without its pixel size is refused', () => {
    // Given a create action whose image carries no pixel size
    const { width: _width, height: _height, ...withoutSize } = imageAttachment()
    const parsed = parseActionEnvelope({
      requestId: 'request-a',
      action: {
        kind: 'create',
        id: 'task-a',
        input: { title: 'A', description: '', prompt: '', attachments: [withoutSize] },
      },
    })
    // When the wire gate reads the action
    // Then the action is refused: a record without its size cannot address the object
    expect(parsed).toBeUndefined()
  })

  it('operator submitting an image with a zero pixel size is refused', () => {
    // Given a create action whose image claims a zero pixel size
    const parsed = parseActionEnvelope({
      requestId: 'request-a',
      action: {
        kind: 'create',
        id: 'task-a',
        input: {
          title: 'A', description: '', prompt: '',
          attachments: [imageAttachment({ width: 0, height: 0 })],
        },
      },
    })
    // When the wire gate reads the action
    // Then the action is refused
    expect(parsed).toBeUndefined()
  })

  it('operator loading an image record without its pixel size drops that record', () => {
    // Given a persisted card whose image record carries no pixel size
    const tasks = parseLedger(JSON.stringify([cardRow({
      attachments: [{ ...imageAttachment(), width: undefined, height: undefined }],
    })]))
    // When the ledger repairs the list
    // Then the unusable record is dropped instead of being completed with a 0x0
    expect(tasks[0].attachments).toBeUndefined()
  })
})
