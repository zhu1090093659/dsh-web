/**
 * Chat level: one session. Loads the history tail page on open, appends
 * pages upward (loadOlder), folds live mux frames in as they arrive, and
 * sends prompts through session.prompt.
 *
 * Rendering mirrors the desktop web UI's fold discipline on a small screen:
 * - reasoning text hides behind a collapsed "深度思考" disclosure,
 * - tool calls behind a collapsed tool disclosure (name + arguments),
 * - very long assistant text collapses with an explicit expand toggle,
 * - a toolbar above the composer carries the model (+ thinking effort) and
 *   permission pickers, both as bottom sheets.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'
import type { SessionModels } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import { loadHistory, prompt, type SessionView } from './App.tsx'
import { errorText, formatTime, staleHostHint } from './App.tsx'
import { models, selectModel, sendCommand } from '../api.ts'
import { foldEvents, type RenderMessage, type ToolCallInfo, type WireEvent } from '../messages.ts'
import { MuxClient } from '../mux.ts'
import { ThemeToggle } from '../theme-toggle.tsx'

/** Props for the chat view. */
export interface ChatViewProps {
  session: SessionView
  /** The page-lifetime mux client (undefined before the first effect tick). */
  mux?: MuxClient | undefined
  onBack(): void
}

/** Extract the raw event from one history entry (the fold consumes events only). */
function eventOf(entry: { event: WireEvent }): WireEvent {
  return entry.event
}

/** Defensive runtime guard for projection payloads. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One switchable permission preset (the `permissions` projection shape). */
export interface PermissionOption {
  value: string
  name: string
  description?: string
}

/** The `permissions` projection value: options + the effective current value. */
export interface PermissionSelectValue {
  options: PermissionOption[]
  currentValue: string
}

/** Parse the wire `permissions` projection defensively; undefined when absent. */
function parsePermissionSelect(value: unknown): PermissionSelectValue | undefined {
  if (!isRecord(value)) return undefined
  const rawOptions = Array.isArray(value['options']) ? value['options'] : []
  const options: PermissionOption[] = []
  for (const raw of rawOptions) {
    if (!isRecord(raw)) continue
    const optionValue = typeof raw['value'] === 'string' ? raw['value'] : undefined
    const name = typeof raw['name'] === 'string' ? raw['name'] : undefined
    if (optionValue === undefined || name === undefined) continue
    options.push({
      value: optionValue,
      name,
      ...(typeof raw['description'] === 'string' ? { description: raw['description'] } : {}),
    })
  }
  const currentValue = typeof value['currentValue'] === 'string' ? value['currentValue'] : undefined
  if (currentValue === undefined || options.length === 0) return undefined
  return { options, currentValue }
}

/** One display-name transform for kebab-case machine names (web-UI parity). */
function displayName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/** First non-empty line of reasoning text (the collapsed summary). */
function firstMeaningfulLine(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const newline = trimmed.indexOf('\n')
  return newline === -1 ? trimmed : trimmed.slice(0, newline)
}

/**
 * Render one session's chat.
 * @param props - the session, the mux client, and the back action.
 * @returns the chat surface.
 */
export function ChatView({ session, mux, onBack }: ChatViewProps) {
  const [messages, setMessages] = useState<RenderMessage[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement | undefined>(undefined)
  const pendingRef = useRef(false)

  /** The session's permission select (absent = capability not composed). */
  const [permissions, setPermissions] = useState<PermissionSelectValue | undefined>(undefined)
  /** The current model selection for the toolbar chip (best-effort label). */
  const [currentModel, setCurrentModel] = useState<{ provider: string; model: string; reasoningEffort?: string } | undefined>(undefined)
  /** Which bottom sheet is open. */
  const [sheet, setSheet] = useState<'model' | 'permission' | null>(null)

  // Tail page on open (content loads only when the session is opened).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    setMessages([])
    void loadHistory(session.sessionId).then(
      (page) => {
        if (cancelled) return
        setMessages(foldEvents(page.events.map(eventOf)))
        setHasOlder(page.hasMore)
        setLoading(false)
        // The history-tail projection baseline seeds the permission picker.
        // The `permissions` key is declared by the deployment's permission
        // plugin (augmentation), so the base SDK map is indexed loosely.
        const projections = page.projections?.values as Record<string, unknown> | undefined
        setPermissions(parsePermissionSelect(projections?.['permissions']))
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(errorText(reason))
        setLoading(false)
      },
    )
    // Best-effort current-model label for the toolbar chip; the sheet
    // always re-reads a fresh directory on open.
    void models(session.sessionId).then(
      (directory) => {
        if (!cancelled) setCurrentModel(directory.current)
      },
      () => { /* chip falls back to a plain label */ },
    )
    return () => { cancelled = true }
  }, [session.sessionId])

  // Live frames: fold session events for this session in as they arrive.
  useEffect(() => {
    if (mux === undefined) return
    return mux.onFrame((frame: MuxFrame) => {
      if (frame.type === 'session/event') {
        if (frame.sessionId !== session.sessionId) return
        setMessages(previous => foldEvents([frame.event as WireEvent], previous))
        return
      }
      // Live projection pushes keep the permission picker current.
      if (frame.type === 'session/projection'
        && frame.sessionId === session.sessionId
        && frame.key === 'permissions') {
        setPermissions(parsePermissionSelect(frame.value))
      }
    })
  }, [mux, session.sessionId])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el === undefined) return
    el.scrollTop = el.scrollHeight
  }, [])

  // Track the last message's fold key so scrolling only fires when the
  // newest message actually changes (seq bump and/or pending flip). Runs
  // after React has committed the render, so scrollHeight reflects the
  // freshly appended content.
  const lastMessageKeyRef = useRef<string | undefined>(undefined)

  // Keep the newest content visible. This covers the initial tail page (the
  // effect runs after commit, fixing the stale scrollHeight from the old
  // open-time scrollToBottom), live streaming chunks on the pending message,
  // and finalized/appended messages. Prepending older pages via loadOlder
  // leaves the last message untouched, so it never disturbs the scroll position.
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last === undefined) return
    const key = last.seq + ':' + (last.pending === true ? 'p' : 'f')
    if (key === lastMessageKeyRef.current) return
    lastMessageKeyRef.current = key
    scrollToBottom()
  }, [messages, scrollToBottom])

  /** Load one older page and prepend it. The fold is directional (incremental
   *  tails only), so the older page folds standalone and concatenates ahead —
   *  host page boundaries never cut a message, so the seam is exact. */
  const loadOlder = useCallback(() => {
    if (pendingRef.current) return
    pendingRef.current = true
    setLoading(true)
    const first = messages[0]
    if (first === undefined) {
      pendingRef.current = false
      setLoading(false)
      return
    }
    void loadHistory(session.sessionId, first.seq).then(
      (page) => {
        pendingRef.current = false
        setLoading(false)
        const older = foldEvents(page.events.map(eventOf))
        setMessages(previous => [...older, ...previous])
        setHasOlder(page.hasMore)
      },
      (reason: unknown) => {
        pendingRef.current = false
        setLoading(false)
        setError(errorText(reason))
      },
    )
  }, [session.sessionId, messages])

  /** Send the drafted prompt (the echoed user/message arrives over mux). */
  const send = useCallback(() => {
    const text = input.trim()
    if (text === '' || sending) return
    setSending(true)
    void prompt(session.sessionId, text).then(
      () => {
        setSending(false)
        setInput('')
      },
      (reason: unknown) => {
        setSending(false)
        setError(errorText(reason))
      },
    )
  }, [input, sending, session.sessionId])

  const modelLabel = currentModel?.model ?? '模型'
  const permissionLabel = permissions === undefined
    ? undefined
    : permissions.options.find(option => option.value === permissions.currentValue)?.name
      ?? displayName(permissions.currentValue)

  return (
    <div className="chat">
      <header className="mobile-header">
        <button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</button>
        <h1 className="mobile-title mobile-titleInline">{session.title}</h1>
        <ThemeToggle />
      </header>
      {error !== undefined && <p className="mobile-error mobile-pad">{error}</p>}
      <div className="chat-scroll" ref={ref => { scrollRef.current = ref ?? undefined }}>
        {hasOlder && (
          <button type="button" className="chat-load-older" disabled={loading} onClick={() => { void loadOlder() }}>
            {loading ? '加载中…' : '加载更早的消息'}
          </button>
        )}
        {messages.map(message => <MessageRow key={message.id} message={message} />)}
        {loading && messages.length === 0 && <p className="chat-typing">加载中…</p>}
        {!loading && messages.length === 0 && <p className="chat-typing">还没有消息，发一句话开始吧</p>}
      </div>
      <div className="chat-tools">
        <button type="button" className="chat-chip" onClick={() => { setSheet('model') }} aria-haspopup="dialog">
          <span className="chat-chip-label">模型</span>
          <span className="chat-chip-value">{modelLabel}</span>
          <span className="chat-chip-chevron" aria-hidden>›</span>
        </button>
        {permissionLabel !== undefined && (
          <button type="button" className="chat-chip" onClick={() => { setSheet('permission') }} aria-haspopup="dialog">
            <span className="chat-chip-label">权限</span>
            <span className="chat-chip-value">{permissionLabel}</span>
            <span className="chat-chip-chevron" aria-hidden>›</span>
          </button>
        )}
      </div>
      <div className="chat-inputbar">
        <textarea
          className="chat-input"
          rows={1}
          value={input}
          placeholder="输入消息，Enter 发送…"
          enterKeyHint="send"
          onChange={(event) => { setInput(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
        />
        <button type="button" className="chat-send" disabled={sending || input.trim() === ''} onClick={() => { void send() }}>
          {sending ? '发送中…' : '发送'}
        </button>
      </div>
      {sheet === 'model' && (
        <ModelSheet
          sessionId={session.sessionId}
          current={currentModel}
          onCurrent={(selection) => { setCurrentModel(selection) }}
          onClose={() => { setSheet(null) }}
        />
      )}
      {sheet === 'permission' && permissions !== undefined && (
        <PermissionSheet
          sessionId={session.sessionId}
          value={permissions}
          onChanged={(value) => {
            setPermissions(previous => previous === undefined ? previous : { ...previous, currentValue: value })
          }}
          onClose={() => { setSheet(null) }}
        />
      )}
    </div>
  )
}

/* ── message rows ─────────────────────────────────────────────────────── */

/** One rendered message row (user bubble or assistant bubble with folds). */
function MessageRow({ message }: { message: RenderMessage }) {
  return (
    <div className={`chat-msg chat-msg-${message.kind}${message.pending === true ? ' chat-msg-pending' : ''}${message.failed === true ? ' chat-msg-failed' : ''}`}>
      {message.kind === 'assistant' && message.reasoning !== undefined && message.reasoning !== '' && (
        <ReasoningDisclosure text={message.reasoning} pending={message.pending === true} />
      )}
      {message.kind === 'assistant' && message.tools !== undefined && message.tools.length > 0 && (
        <ToolDisclosure tools={message.tools} />
      )}
      <CollapsibleText text={message.text} />
      {message.failed === true && <span className="chat-msg-failtag">本次回复失败</span>}
      <span className="chat-msg-time">{formatTime(message.time)}</span>
    </div>
  )
}

/** Collapsed-by-default reasoning disclosure (web-UI Think-row parity). */
function ReasoningDisclosure({ text, pending }: { text: string; pending: boolean }) {
  const [open, setOpen] = useState(false)
  const summary = pending ? lastLine(text) : firstMeaningfulLine(text)
  return (
    <div className={`chat-disclosure chat-reasoning${open ? ' chat-disclosure-open' : ''}`} data-pending={pending || undefined}>
      <button
        type="button"
        className="chat-disclosure-head"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="chat-disclosure-caret" aria-hidden>›</span>
        <span className="chat-disclosure-label">{pending ? '思考中…' : '深度思考'}</span>
        {!open && <span className="chat-disclosure-summary">{summary}</span>}
      </button>
      {open && <div className="chat-disclosure-body">{text}</div>}
    </div>
  )
}

/** Collapsed-by-default tool-call disclosure: summary row + expandable details. */
function ToolDisclosure({ tools }: { tools: ToolCallInfo[] }) {
  const [open, setOpen] = useState(false)
  const names = [...new Set(tools.map(tool => tool.name))].join(' / ')
  return (
    <div className={`chat-disclosure chat-tools${open ? ' chat-disclosure-open' : ''}`}>
      <button
        type="button"
        className="chat-disclosure-head"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="chat-disclosure-caret" aria-hidden>›</span>
        <span className="chat-disclosure-label">工具</span>
        {!open && <span className="chat-disclosure-summary">{names}</span>}
        <span className="chat-disclosure-count">{tools.length} 次</span>
      </button>
      {open && (
        <div className="chat-disclosure-body chat-tools-body">
          {tools.map((tool, index) => (
            <div className="chat-tool-item" key={`${tool.callId}-${index}`}>
              <span className="chat-tool-name">{tool.name}</span>
              {tool.arguments !== undefined && <pre className="chat-tool-args">{tool.arguments}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Long assistant text collapses behind an explicit expand toggle. */
function CollapsibleText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (text.length <= LONG_TEXT_LIMIT) {
    return <span className="chat-msg-text">{text}</span>
  }
  const shown = open ? text : text.slice(0, LONG_TEXT_PREVIEW)
  return (
    <span className="chat-msg-text">
      {shown}{!open ? '…' : ''}
      <button type="button" className="chat-msg-toggle" onClick={() => { setOpen(value => !value) }}>
        {open ? '收起' : `展开全文（${text.length} 字）`}
      </button>
    </span>
  )
}

const LONG_TEXT_LIMIT = 1600
const LONG_TEXT_PREVIEW = 800

/** Latest non-empty line of a streaming reasoning buffer. */
function lastLine(text: string): string {
  const trimmed = text.trimEnd()
  if (trimmed === '') return ''
  const newline = trimmed.lastIndexOf('\n')
  const line = newline === -1 ? trimmed : trimmed.slice(newline + 1)
  return line.trim() === '' ? '' : line
}

/* ── bottom sheets ───────────────────────────────────────────────────── */

/** Shared bottom-sheet chrome (backdrop + slide-up panel). */
function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-title">{title}</div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

/** The model + thinking-effort picker (fresh advisory directory per open). */
function ModelSheet({ sessionId, current, onCurrent, onClose }: {
  sessionId: string
  current: { provider: string; model: string; reasoningEffort?: string } | undefined
  onCurrent(selection: { provider: string; model: string; reasoningEffort?: string }): void
  onClose(): void
}) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: SessionModels }>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const load = useCallback(() => {
    setState({ status: 'loading' })
    void models(sessionId).then(
      data => { setState({ status: 'ready', data }) },
      (reason: unknown) => { setState({ status: 'error', message: errorText(reason) }) },
    )
  }, [sessionId])

  useEffect(() => { load() }, [load])

  /** Select model/effort and close on success (one-shot action per sheet). */
  const apply = useCallback((selection: { provider: string; model: string; reasoningEffort?: string }) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    void selectModel(sessionId, selection).then(
      (result) => {
        setBusy(false)
        onCurrent(result.selected)
        onClose()
      },
      (reason: unknown) => {
        setBusy(false)
        setError(errorText(reason))
      },
    )
  }, [busy, sessionId, onCurrent, onClose])

  if (state.status === 'loading') {
    return (
      <Sheet title="模型与思考强度" onClose={onClose}>
        <div className="sheet-status">正在加载模型目录…</div>
      </Sheet>
    )
  }
  if (state.status === 'error') {
    return (
      <Sheet title="模型与思考强度" onClose={onClose}>
        <div className="sheet-status sheet-status-error">
          <span>{state.message}</span>
          {staleHostHint(state.message) !== undefined && <span className="sheet-hint">{staleHostHint(state.message)}</span>}
          <button type="button" className="chat-load-older" onClick={load}>重试</button>
        </div>
      </Sheet>
    )
  }

  const { data } = state
  const selected = current ?? data.current
  const choices = data.groups.flatMap(group => group.models.map(model => ({ group, model })))
  const currentChoice = choices.find(choice => choice.group.id === selected.provider && choice.model.id === selected.model)
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = selected.reasoningEffort ?? reasoning?.defaultEffort
  const effortChoices = reasoning === undefined
    ? []
    : [
      ...(reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined as string | undefined, label: '跟随模型默认' }]
        : []),
      ...reasoning.efforts.map(effort => ({
        key: `effort:${effort.id}`,
        effort: effort.id as string | undefined,
        label: effort.name,
        description: effort.description,
      })),
    ]

  return (
    <Sheet title="模型与思考强度" onClose={onClose}>
      {error !== undefined && <p className="sheet-error">{error}</p>}
      {error !== undefined && staleHostHint(error) !== undefined && <p className="sheet-hint">{staleHostHint(error)}</p>}
      {data.failures.map(failure => (
        <p className="sheet-error" key={failure.id}>{failure.name}: {failure.message}</p>
      ))}
      {data.groups.length === 0 && choices.length === 0 && (
        <div className="sheet-status">没有可用的模型</div>
      )}
      {data.groups.map(group => (
        <div className="sheet-section" key={group.id}>
          <div className="sheet-section-title">{group.name}</div>
          {group.models.map(model => {
            const isSelected = selected.provider === group.id && selected.model === model.id
            return (
              <button
                type="button"
                key={model.id}
                className={`sheet-option${isSelected ? ' sheet-option-selected' : ''}`}
                disabled={busy}
                onClick={() => {
                  apply({
                    provider: group.id,
                    model: model.id,
                    ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
                  })
                }}
              >
                <span className="sheet-option-copy">
                  <span className="sheet-option-title">{model.name}</span>
                  {model.description !== undefined && <span className="sheet-option-desc">{model.description}</span>}
                </span>
                {isSelected && <span className="sheet-option-check" aria-hidden>√</span>}
              </button>
            )
          })}
        </div>
      ))}
      {effortChoices.length > 0 && (
        <div className="sheet-section">
          <div className="sheet-section-title">思考强度</div>
          {effortChoices.map(choice => {
            const isSelected = effectiveEffort === choice.effort
            return (
              <button
                type="button"
                key={choice.key}
                className={`sheet-option${isSelected ? ' sheet-option-selected' : ''}`}
                disabled={busy}
                onClick={() => { apply({ provider: selected.provider, model: selected.model, ...(choice.effort !== undefined ? { reasoningEffort: choice.effort } : {}) }) }}
              >
                <span className="sheet-option-copy">
                  <span className="sheet-option-title">{choice.label}</span>
                </span>
                {isSelected && <span className="sheet-option-check" aria-hidden>√</span>}
              </button>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}

/** The permission-preset picker; full access needs an explicit confirm. */
function PermissionSheet({ sessionId, value, onChanged, onClose }: {
  sessionId: string
  value: PermissionSelectValue
  onChanged(currentValue: string): void
  onClose(): void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  /** Submit `/permission <value>` as a slash command (mode-agnostic). */
  const submit = useCallback((next: string) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    void sendCommand(sessionId, `/permission ${next}`).then(
      () => {
        setBusy(false)
        setConfirming(null)
        onChanged(next)
        onClose()
      },
      (reason: unknown) => {
        setBusy(false)
        setConfirming(null)
        setError(errorText(reason))
      },
    )
  }, [busy, sessionId, onChanged, onClose])

  const choose = (next: string): void => {
    if (next === value.currentValue) {
      onClose()
      return
    }
    if (next === 'danger-full-access') {
      setConfirming(next)
      return
    }
    submit(next)
  }

  if (confirming !== null) {
    return (
      <Sheet title="确认完全权限" onClose={() => { setConfirming(null) }}>
        <p className="sheet-confirm-desc">
          开启完全权限后，远程会话可以在工作区内执行任意操作（包括运行命令、修改所有文件与访问凭证）。
          仅在您信任当前设备和网络时开启。
        </p>
        {error !== undefined && <p className="sheet-error">{error}</p>}
        <div className="sheet-confirm-actions">
          <button type="button" className="mobile-button" disabled={busy} onClick={() => { setConfirming(null) }}>取消</button>
          <button type="button" className="sheet-confirm-danger" disabled={busy} onClick={() => { submit(confirming) }}>
            {busy ? '提交中…' : '确认开启'}
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title="权限" onClose={onClose}>
      {error !== undefined && <p className="sheet-error">{error}</p>}
      {value.options.map(option => {
        const isSelected = option.value === value.currentValue
        return (
          <button
            type="button"
            key={option.value}
            className={`sheet-option${isSelected ? ' sheet-option-selected' : ''}`}
            disabled={busy}
            onClick={() => { choose(option.value) }}
          >
            <span className="sheet-option-copy">
              <span className="sheet-option-title">{option.name}</span>
              {option.description !== undefined && <span className="sheet-option-desc">{option.description}</span>}
            </span>
            {isSelected && <span className="sheet-option-check" aria-hidden>√</span>}
          </button>
        )
      })}
    </Sheet>
  )
}
