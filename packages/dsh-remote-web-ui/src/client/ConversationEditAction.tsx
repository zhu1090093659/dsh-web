import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConnectionHandle, ContentBlock, PromptContentPart } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ConversationSnapshot,
  ISessions,
  SessionId,
  SessionSummary,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconCheckOutline16,
  IconCopyOutline16,
  IconEditOutline16,
  IconSendOutline16,
  JsonBlock,
  MessageText,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './conversation-edit.module.css'

type UserNodeProps = PropsRuntime<'conversation.chat.node', 'user'>
type RemoteTranslate = TranslateNS<'remote'>

export interface EditableConversationMessage {
  readonly seq: number
  readonly text: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHumanSource(source: unknown): boolean {
  if (!isRecord(source)) return true
  const kind = source['kind']
  return kind === undefined || kind === 'user'
}

function textOnly(content: readonly ContentBlock[]): string | undefined {
  if (content.length !== 1) return undefined
  const block = content[0]
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : undefined
}

/**
 * Return the latest settled human text prompt. A failed model request may not
 * produce an assistant message or turn-end marker, but its user prompt must
 * remain editable once the session is idle. The exact user sequence is checked
 * so every older user bubble remains read-only.
 */
export function findEditableConversationMessage(
  snapshot: ConversationSnapshot,
  userSeq: number,
): EditableConversationMessage | undefined {
  if (snapshot.running || snapshot.removed || snapshot.openState !== 'open') return undefined
  const user = snapshot.nodes.find((node): node is UserMessageNode => node.kind === 'user' && node.seq === userSeq)
  if (user === undefined || !isHumanSource(user.source)) return undefined
  const text = textOnly(user.content)
  if (text === undefined) return undefined
  const latestUser = [...snapshot.nodes]
    .filter((node): node is UserMessageNode => node.kind === 'user')
    .reduce<UserMessageNode | undefined>((latest, node) => latest === undefined || node.seq > latest.seq ? node : latest, undefined)
  return latestUser?.seq === user.seq ? { seq: user.seq, text } : undefined
}

async function promptViaApi(connection: ConnectionHandle, sessionId: SessionId, text: string): Promise<void> {
  const response = await connection.api.sessions.prompt({
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text } satisfies PromptContentPart],
  })
  if (!response.result.ok) throw new Error(response.result.error.message)
}

async function createSessionViaApi(
  connection: ConnectionHandle,
  source: SessionSummary | undefined,
): Promise<SessionId> {
  const response = await connection.api.sessions.create({
    ...(source?.cwd === undefined ? {} : { cwd: source.cwd }),
  })
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value.sessionId
}

async function copyModelSelection(
  connection: ConnectionHandle,
  sourceSessionId: SessionId,
  childSessionId: SessionId,
): Promise<void> {
  const models = await connection.api.sessions.models({ sessionId: sourceSessionId })
  if (!models.result.ok) return
  const current = models.result.value.current
  const selected = await connection.api.sessions.selectModel({
    sessionId: childSessionId,
    provider: current.provider,
    model: current.model,
    ...(current.reasoningEffort === undefined ? {} : { reasoningEffort: current.reasoningEffort }),
  })
  if (!selected.result.ok) return
}

async function waitForSession(
  sessions: ISessions,
  sessionId: SessionId,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (sessions.binding(sessionId) !== undefined) return
    await new Promise<void>(resolve => { window.setTimeout(resolve, 50) })
  }
  throw new Error('新会话尚未连接')
}

function previousTurnBoundary(snapshot: ConversationSnapshot, userSeq: number): number | undefined {
  return [...snapshot.turnEnds.values()]
    .filter(seq => seq < userSeq)
    .sort((a, b) => b - a)[0]
}

interface ContentParts {
  readonly text: string
  readonly images: readonly unknown[]
  readonly rest: readonly unknown[]
}

function contentParts(content: readonly ContentBlock[]): ContentParts {
  const texts: string[] = []
  const images: unknown[] = []
  const rest: unknown[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text)
    } else if (isRecord(block) && block['type'] === 'image' && block['attachment'] !== undefined) {
      images.push(block['attachment'])
    } else {
      rest.push(block)
    }
  }
  return { text: texts.join(''), images, rest }
}

function messageClock(time: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(time)
}

function ImagePreview({
  attachment,
  loadImage,
  label,
}: {
  readonly attachment: unknown
  readonly loadImage: UserNodeProps['loadImage']
  readonly label: string
}): ReactNode {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let active = true
    setSrc(undefined)
    void loadImage(attachment as Parameters<UserNodeProps['loadImage']>[0]).then(value => {
      if (active) setSrc(value)
    }).catch(() => {})
    return () => { active = false }
  }, [attachment, loadImage])
  return src === undefined
    ? <div className={styles.imagePlaceholder}>{label}</div>
    : <img className={styles.image} src={src} alt={label} />
}

function CopyButton({ text, t }: { readonly text: string; readonly t: RemoteTranslate }): ReactNode {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(text).then(ok => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, text])
  return (
    <button type="button" className={styles.action} onClick={onCopy} aria-label={copied ? t('conversation.copied') : t('conversation.copy')}>
      {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
    </button>
  )
}

interface EditProps {
  readonly sessions: ISessions
  readonly connection: ConnectionHandle
  readonly snapshot: ConversationSnapshot
  readonly sessionId: SessionId
  readonly source: SessionSummary | undefined
  readonly editable: EditableConversationMessage
  readonly time: number
  readonly t: RemoteTranslate
}

function EditableMessage({ sessions, connection, snapshot, sessionId, source, editable, time, t }: EditProps): ReactNode {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const submitting = useRef(false)
  const childSession = useRef<SessionId | undefined>(undefined)

  const beginEdit = useCallback(() => {
    childSession.current = undefined
    setDraft(editable.text)
    setError(false)
    setEditing(true)
  }, [editable.text])

  const cancelEdit = useCallback(() => {
    if (busy) return
    setEditing(false)
    setDraft('')
    setError(false)
  }, [busy])

  const saveEdit = useCallback(() => {
    if (draft.trim() === '' || submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(false)
    void (async () => {
      const previousBoundary = previousTurnBoundary(snapshot, editable.seq)
      let childSessionId = childSession.current
      if (childSessionId === undefined) {
        childSessionId = previousBoundary === undefined
          ? await createSessionViaApi(connection, source)
          : await sessions.fork({ sessionId, atSeq: previousBoundary })
        childSession.current = childSessionId
        if (previousBoundary === undefined) await copyModelSelection(connection, sessionId, childSessionId)
      }
      await waitForSession(sessions, childSessionId)
      await promptViaApi(connection, childSessionId, draft)
      sessions.open(childSessionId)
      try {
        await connection.api.workspace.archiveSession({ sessionId })
      } catch {
        // The replacement was already accepted. Do not offer a retry that
        // would enqueue the edited prompt twice merely because cleanup failed.
      }
      setEditing(false)
      setDraft('')
    })().catch(() => {
      setError(true)
    }).finally(() => {
      submitting.current = false
      setBusy(false)
    })
  }, [connection, draft, editable.seq, sessionId, sessions, snapshot, source])

  if (!editing) {
    return (
      <>
        <div className={styles.bubble}>
          <MessageText text={editable.text} />
        </div>
        <div className={styles.actions}>
          <span className={styles.time}>{messageClock(time)}</span>
          <CopyButton text={editable.text} t={t} />
          <button type="button" className={styles.action} onClick={beginEdit} aria-label={t('conversation.edit')}>
            <IconEditOutline16 />
          </button>
        </div>
      </>
    )
  }

  return (
    <div className={styles.editorBubble}>
      <textarea
        className={styles.input}
        rows={3}
        value={draft}
        autoFocus
        disabled={busy}
        aria-label={t('conversation.edit.input')}
        onChange={event => { setDraft(event.target.value) }}
        onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            saveEdit()
          }
        }}
      />
      {error && <div className={styles.error} role="alert">{t('conversation.edit.error')}</div>}
      <div className={styles.buttons}>
        <button type="button" className={styles.cancel} disabled={busy} onClick={cancelEdit}>{t('conversation.edit.cancel')}</button>
        <button
          type="button"
          className={styles.save}
          disabled={busy || draft.trim() === ''}
          aria-label={busy ? t('conversation.edit.saving') : t('conversation.edit.save')}
          onClick={saveEdit}
        >
          <IconSendOutline16 />
        </button>
      </div>
    </div>
  )
}

function UserMessageNode({ node, loadImage, useSession, useSessions, sessions, connection, t }: UserNodeProps & {
  readonly sessions: ISessions
  readonly connection: ConnectionHandle
  readonly t: RemoteTranslate
}): ReactNode {
  const snapshot = useSession(value => value)
  const sessionId = useSession(value => value.sessionId)
  const source = useSessions(value => value.byId[sessionId])
  const data = node.data
  const { text, images, rest } = contentParts(data.content)
  const editable = findEditableConversationMessage(snapshot, data.seq)

  if (editable !== undefined) {
    return (
      <div className={styles.userRow} data-time-hover-root>
        <div className={styles.userStack}>
          <EditableMessage
            sessions={sessions}
            connection={connection}
            snapshot={snapshot}
            sessionId={sessionId}
            source={source}
            editable={editable}
            time={data.time}
            t={t}
          />
        </div>
      </div>
    )
  }

  const showBubble = text !== '' || rest.length > 0
  return (
    <div className={styles.userRow} data-time-hover-root>
      <div className={styles.userStack}>
        {images.map((attachment, index) => (
          <ImagePreview key={index} attachment={attachment} loadImage={loadImage} label={t('conversation.image')} />
        ))}
        {showBubble && (
          <div className={styles.bubble}>
            <MessageText text={text} />
            {rest.map((block, index) => (
              <JsonBlock key={index} label={t('conversation.extraBlock')} payload={block} truncatedLabel={total => t('conversation.jsonTruncated', { total })} />
            ))}
          </div>
        )}
      </div>
      <div className={styles.actions}>
        <span className={styles.time}>{messageClock(data.time)}</span>
        <CopyButton text={text} t={t} />
      </div>
    </div>
  )
}

export function createEditableUserMessageNode(
  sessions: ISessions,
  connection: ConnectionHandle,
  t: RemoteTranslate,
): (props: UserNodeProps) => ReactNode {
  return props => <UserMessageNode {...props} sessions={sessions} connection={connection} t={t} />
}
