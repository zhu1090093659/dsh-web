import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConnectionHandle, ContentBlock, MessageId, PromptContentPart } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AssistantMessageNode,
  ConversationSnapshot,
  ISessions,
  SessionId,
  SessionSummary,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import styles from './conversation-edit.module.css'

type SlotProps = PropsRuntime<'conversation.chat.assistant-actions'> & PropsLocale<'remote'>

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

function latestAssistant(snapshot: ConversationSnapshot): AssistantMessageNode | undefined {
  return snapshot.nodes
    .filter((node): node is AssistantMessageNode => node.kind === 'assistant' && node.messageId !== undefined)
    .reduce<AssistantMessageNode | undefined>((latest, node) => latest === undefined || node.seq > latest.seq ? node : latest, undefined)
}

/**
 * Return the latest editable human prompt only when the addressed assistant is
 * the final settled assistant in a closed turn. Attachments, plugin/system
 * injections, active turns, and interrupted partials are intentionally denied.
 */
export function findEditableConversationMessage(
  snapshot: ConversationSnapshot,
  messageId: MessageId,
): EditableConversationMessage | undefined {
  if (snapshot.running || snapshot.removed || snapshot.openState !== 'open') return undefined
  const assistant = latestAssistant(snapshot)
  if (assistant === undefined || assistant.messageId !== messageId || assistant.interrupted === true) return undefined
  const turnEnd = snapshot.turnEnds.get(assistant.turn)
  if (turnEnd === undefined || turnEnd < assistant.seq) return undefined

  const user = [...snapshot.nodes]
    .reverse()
    .find((node): node is UserMessageNode => node.kind === 'user' && node.seq < assistant.seq)
  if (user === undefined || !isHumanSource(user.source)) return undefined
  const text = textOnly(user.content)
  if (text === undefined) return undefined
  return { seq: user.seq, text }
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

interface ActionProps extends SlotProps {
  readonly sessions: ISessions
  readonly connection: ConnectionHandle
}

function ConversationEditAction({ sessions, connection, messageId, useSession, useSessions, t }: ActionProps): ReactNode {
  const snapshot = useSession(value => value)
  const sessionId = useSession(value => value.sessionId)
  const source = useSessions(value => value.byId[sessionId])
  const editable = findEditableConversationMessage(snapshot, messageId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  const beginEdit = useCallback(() => {
    if (editable === undefined) return
    setDraft(editable.text)
    setError(false)
    setEditing(true)
  }, [editable])

  const cancelEdit = useCallback(() => {
    if (busy) return
    setEditing(false)
    setDraft('')
    setError(false)
  }, [busy])

  const saveEdit = useCallback(() => {
    if (editable === undefined || draft.trim() === '' || busy) return
    setBusy(true)
    setError(false)
    void (async () => {
      const previousBoundary = previousTurnBoundary(snapshot, editable.seq)
      const childSessionId = previousBoundary === undefined
        ? await createSessionViaApi(connection, source)
        : await sessions.fork({ sessionId, atSeq: previousBoundary })
      if (previousBoundary === undefined) await copyModelSelection(connection, sessionId, childSessionId)
      await waitForSession(sessions, childSessionId)
      await promptViaApi(connection, childSessionId, draft)
      sessions.open(childSessionId)
      setEditing(false)
      setDraft('')
    })().catch(() => {
      setError(true)
    }).finally(() => {
      setBusy(false)
    })
  }, [busy, connection, draft, editable, sessionId, sessions, snapshot, source])

  if (editable === undefined) return null
  if (!editing) {
    return (
      <button type="button" className={styles.action} onClick={beginEdit} aria-label={t('conversation.edit')}>
        {t('conversation.edit')}
      </button>
    )
  }
  return (
    <div className={styles.editor}>
      <textarea
        className={styles.input}
        rows={3}
        value={draft}
        autoFocus
        disabled={busy}
        aria-label={t('conversation.edit.input')}
        onChange={event => { setDraft(event.target.value) }}
      />
      {error && <div className={styles.error} role="alert">{t('conversation.edit.error')}</div>}
      <div className={styles.buttons}>
        <button type="button" className={styles.cancel} disabled={busy} onClick={cancelEdit}>{t('conversation.edit.cancel')}</button>
        <button type="button" className={styles.save} disabled={busy || draft.trim() === ''} onClick={saveEdit}>
          {busy ? t('conversation.edit.saving') : t('conversation.edit.save')}
        </button>
      </div>
    </div>
  )
}

export function createConversationEditAction(
  sessions: ISessions,
  connection: ConnectionHandle,
): (props: SlotProps) => ReactNode {
  return props => <ConversationEditAction {...props} sessions={sessions} connection={connection} />
}
