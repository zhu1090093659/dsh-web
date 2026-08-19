/**
 * The page-annotate panel: a URL bar plus an embedded (sandboxed) iframe for
 * browsing, a Screenshot action that captures the current page through the
 * host capture engine, and an annotation stage (rectangle / arrow / text /
 * number) that composites the image and sends it to the conversation draft
 * for model OCR. Rendered inside the dsh-better-sidebar right panel as the
 * registered 'page-annotate' tab.
 * @module @linxin666/dsh-page-annotate/client/panel
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { clampUnitRect, createAnnotationStore, normalizeRect, type PendingAnnotation, type ShapeKind } from '../annotate-model.ts'
import { captureInteractiveBrowser, captureScreenshot, insertNoteIntoDraft, openInteractiveBrowser, uploadAnnotatedImage, type CaptureValue } from '../api.ts'
import { isHttpUrl, type SessionScopeLike, type SidebarTabLike } from '../better-sidebar.ts'
import { iframeSandboxForUrl } from '../browse.ts'
import { drawComposite } from '../canvas.ts'
import { normalizeUrl } from '../../core/url.ts'
import { format, t, type PageAnnotateKey } from '../locales.ts'
import css from './panel.module.css'

/** Export scale of the composited PNG (2x for OCR quality). */
const EXPORT_SCALE = 2

/** The panel's own face of the tab component props. */
export interface AnnotatePanelProps {
  ctx: unknown
  scope: SessionScopeLike
  tab: SidebarTabLike
  visible: boolean
}

/** Tool colors (stable order for the swatches). */
const COLORS = ['#e11d48', '#ea580c', '#2563eb', '#16a34a', '#111827']

/** Stroke widths offered by the toolbar. */
const STROKE_WIDTHS = [2, 4, 6]

interface CapturedImage extends CaptureValue {
  dataUrl: string
}

type PanelStatus = 'idle' | 'capturing' | 'sending' | 'inserted' | 'captured' | 'error'

/** Fit a screenshot into the stage box, preserving aspect ratio. */
function fitImage(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number): { width: number; height: number } {
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight)
  return { width: Math.max(1, Math.round(imageWidth * scale)), height: Math.max(1, Math.round(imageHeight * scale)) }
}

/** Insert the Markdown reference into the active session's composer draft. */
function insertIntoDraft(ctx: unknown, scope: SessionScopeLike, markdown: string): boolean {
  const record = ctx as { get?: (name: string) => unknown } | null
  if (record === null || typeof record.get !== 'function') return false
  const conversation = record.get('conversation') as {
    input?: { for?(actx: unknown): { state: { getSnapshot(): { draft: string } }; setDraft(text: string): void } }
    send?: (text: string) => Promise<void>
  } | undefined
  const sessions = record.get('sessions') as { scope?(id: string): unknown } | undefined
  if (conversation === undefined || sessions === undefined || typeof sessions.scope !== 'function') return false
  const actx = sessions.scope(scope.sessionId)
  if (actx === undefined) return false
  if (conversation.input !== undefined && typeof conversation.input.for === 'function') {
    const input = conversation.input.for(actx)
    const draft = input.state.getSnapshot().draft
    input.setDraft(insertNoteIntoDraft(draft, markdown))
    return true
  }
  if (typeof conversation.send === 'function') {
    void conversation.send(markdown)
    return true
  }
  return false
}

/** The page-annotate panel root. */
export function AnnotatePanel(props: AnnotatePanelProps): ReactElement {
  const { ctx, scope, tab, visible } = props
  const storeRef = useRef(createAnnotationStore())
  const store = storeRef.current
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot)

  const [urlInput, setUrlInput] = useState(() => (isHttpUrl(tab.path) ? tab.path : ''))
  const [currentUrl, setCurrentUrl] = useState<string>(() => (isHttpUrl(tab.path) ? tab.path : ''))
  const [mode, setMode] = useState<'browse' | 'annotate'>('browse')
  const [captured, setCaptured] = useState<CapturedImage | null>(null)
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null)
  const [status, setStatus] = useState<PanelStatus>('idle')
  const [statusText, setStatusText] = useState('')
  const [tool, setTool] = useState<ShapeKind>('rect')
  const [color, setColor] = useState(COLORS[0])
  const [strokeWidth, setStrokeWidth] = useState(4)
  const [draft, setDraft] = useState<PendingAnnotation | null>(null)
  const [textPending, setTextPending] = useState<{ x: number; y: number } | null>(null)
  const [textValue, setTextValue] = useState('')
  const [regionPending, setRegionPending] = useState<{ id: string; x: number; y: number } | null>(null)
  const [regionComment, setRegionComment] = useState('')

  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [stageSize, setStageSize] = useState({ width: 640, height: 480 })

  // Keep the stage box measured so capture and canvas sizing share it.
  useEffect(() => {
    const node = stageRef.current
    if (node === null) return
    const measure = (): void => {
      const rect = node.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setStageSize({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // Follow tab.path when the sidebar opens the tab for an external link.
  useEffect(() => {
    if (isHttpUrl(tab.path)) {
      setUrlInput(tab.path)
      setCurrentUrl(tab.path)
    }
  }, [tab.path])

  // Load the captured image into an <img> for canvas compositing.
  useEffect(() => {
    if (captured === null) {
      setImageEl(null)
      return
    }
    const image = new Image()
    image.onload = () => setImageEl(image)
    image.src = captured.dataUrl
  }, [captured])

  const fit = captured === null ? { width: stageSize.width, height: stageSize.height } : fitImage(captured.width, captured.height, stageSize.width, stageSize.height)
  const canvasWidth = Math.round(fit.width * EXPORT_SCALE)
  const canvasHeight = Math.round(fit.height * EXPORT_SCALE)

  // Redraw the stage whenever inputs change.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || captured === null || imageEl === null) return
    const context = canvas.getContext('2d')
    if (context === null) return
    drawComposite(context, imageEl, canvas.width, canvas.height, items, draft ?? undefined, tool, color, strokeWidth, EXPORT_SCALE)
  }, [captured, imageEl, items, draft, tool, color, strokeWidth, canvasWidth, canvasHeight])

  const toNormalized = (event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (mode !== 'annotate' || captured === null) return
    const point = toNormalized(event)
    if (tool === 'text') {
      setTextPending(point)
      return
    }
    if (tool === 'number') {
      store.add({ kind: 'number', rect: { x: point.x, y: point.y, w: 0.05, h: 0.05 }, color, strokeWidth })
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraft({ x1: point.x, y1: point.y, x2: point.x, y2: point.y })
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (draft === null) return
    const point = toNormalized(event)
    setDraft({ ...draft, x2: point.x, y2: point.y })
  }

  const onPointerUp = (): void => {
    if (draft === null) return
    const rect = clampUnitRect(normalizeRect(draft.x1, draft.y1, draft.x2, draft.y2))
    setDraft(null)
    if (rect.w < 0.004 || rect.h < 0.004) return
    const kind = tool === 'arrow' ? 'arrow' : 'rect'
    const id = store.add({ kind, rect, color, strokeWidth })
    if (kind === 'rect') {
      setRegionPending({ id, x: rect.x, y: Math.min(0.96, rect.y + rect.h) })
      setRegionComment('')
    }
  }

  const commitRegionComment = (): void => {
    if (regionPending !== null) store.update(regionPending.id, { comment: regionComment.trim() })
    setRegionPending(null)
    setRegionComment('')
  }

  const commitText = (): void => {
    const text = textValue.trim()
    if (textPending !== null && text !== '') {
      store.add({ kind: 'text', rect: { x: textPending.x, y: textPending.y, w: 0.18, h: 0.04 }, color, strokeWidth, text })
    }
    setTextPending(null)
    setTextValue('')
  }

  const onNavigate = (): void => {
    const url = normalizeUrl(urlInput)
    if (url === null) {
      setStatus('error')
      setStatusText(t('error.noUrl'))
      return
    }
    setUrlInput(url)
    setCurrentUrl(url)
    setMode('browse')
    setStatus('idle')
    setStatusText('')
  }

  const onOpenInteractive = async (): Promise<void> => {
    const url = normalizeUrl(urlInput)
    if (url === null) {
      setStatus('error')
      setStatusText(t('error.noUrl'))
      return
    }
    setStatusText(t('status.openingBrowser'))
    const outcome = await openInteractiveBrowser(url)
    if (!outcome.ok) {
      setStatus('error')
      setStatusText(format(t('error.browser'), { message: outcome.message }))
      return
    }
    setUrlInput(outcome.url)
    setCurrentUrl(outcome.url)
    setStatus('idle')
    setStatusText(t('status.browserOpen'))
  }

  const onCaptureInteractive = async (): Promise<void> => {
    setStatus('capturing')
    setStatusText(t('status.capturingInteractive'))
    const outcome = await captureInteractiveBrowser(Math.max(320, Math.round(stageSize.width)), Math.max(240, Math.round(stageSize.height)))
    if (!outcome.ok) {
      setStatus('error')
      setStatusText(format(t('error.browser'), { message: outcome.message }))
      return
    }
    if (outcome.url !== undefined) {
      setUrlInput(outcome.url)
      setCurrentUrl(outcome.url)
    }
    setCaptured({ ...outcome.value, dataUrl: `data:${outcome.value.mediaType};base64,${outcome.value.data}` })
    setMode('annotate')
    setStatus('captured')
    setStatusText(format(t('status.captured'), { engine: outcome.value.engine }))
  }

  const onCapture = async (): Promise<void> => {
    const url = normalizeUrl(urlInput)
    if (url === null) {
      setStatus('error')
      setStatusText(t('error.noUrl'))
      return
    }
    setCurrentUrl(url)
    setStatus('capturing')
    setStatusText(t('status.capturing'))
    const width = Math.max(320, Math.round(stageSize.width))
    const height = Math.max(240, Math.round(stageSize.height))
    const outcome = await captureScreenshot({ url, width, height })
    if (!outcome.ok) {
      setStatus('error')
      setStatusText(outcome.code === 'no-engine' ? t('error.noEngine') : format(t('error.capture'), { message: outcome.message }))
      return
    }
    setCaptured({ ...outcome.value, dataUrl: `data:${outcome.value.mediaType};base64,${outcome.value.data}` })
    setMode('annotate')
    setStatus('captured')
    setStatusText(format(t('status.captured'), { engine: outcome.value.engine }))
  }

  const onUploadFile = (file: File): void => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      if (comma < 0) return
      const image = new Image()
      image.onload = () => {
        setCaptured({
          data: result.slice(comma + 1),
          mediaType: file.type || 'image/png',
          width: image.naturalWidth,
          height: image.naturalHeight,
          engine: 'upload',
          dataUrl: result,
        })
        setMode('annotate')
        setStatus('captured')
        setStatusText(format(t('status.captured'), { engine: 'upload' }))
      }
      image.src = result
    }
    reader.readAsDataURL(file)
  }

  const onSend = async (): Promise<void> => {
    if (captured === null || imageEl === null) return
    setStatus('sending')
    setStatusText(t('status.sending'))
    try {
      const canvas = document.createElement('canvas')
      canvas.width = canvasWidth
      canvas.height = canvasHeight
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('canvas-unavailable')
      drawComposite(context, imageEl, canvas.width, canvas.height, items, undefined, tool, color, strokeWidth, EXPORT_SCALE)
      const dataUrl = canvas.toDataURL('image/png')
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const upload = await uploadAnnotatedImage(base64, 'image/png', `page-annotate-${Date.now()}.png`)
      if (!upload.ok) {
        setStatus('error')
        setStatusText(format(t('error.upload'), { message: upload.message }))
        return
      }
      const inserted = insertIntoDraft(ctx, scope, upload.markdown)
      if (!inserted) {
        setStatus('error')
        setStatusText(t('error.send'))
        return
      }
      setStatus('inserted')
      setStatusText(t('status.inserted'))
    } catch {
      setStatus('error')
      setStatusText(t('error.send'))
    }
  }

  const toolbar = (
    <div className={css.toolbar} data-dsh-part="toolbar">
      <div className={css.toolGroup}>
        {(['rect', 'arrow', 'text', 'number'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className={tool === kind ? css.toolActive : css.tool}
            onClick={() => setTool(kind)}
            title={t(`tool.${kind}` as PageAnnotateKey)}
          >
            {t(`tool.${kind}` as PageAnnotateKey)}
          </button>
        ))}
      </div>
      <div className={css.toolGroup}>
        {COLORS.map((value) => (
          <button
            key={value}
            type="button"
            className={color === value ? css.swatchActive : css.swatch}
            style={{ background: value }}
            onClick={() => setColor(value)}
            aria-label={value}
          />
        ))}
      </div>
      <div className={css.toolGroup}>
        {STROKE_WIDTHS.map((value) => (
          <button
            key={value}
            type="button"
            className={strokeWidth === value ? css.widthActive : css.width}
            onClick={() => setStrokeWidth(value)}
            title={String(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className={css.toolGroup}>
        <button type="button" className={css.action} onClick={() => store.undo()} disabled={items.length === 0}>
          {t('action.undo')}
        </button>
        <button type="button" className={css.action} onClick={() => store.clear()} disabled={items.length === 0}>
          {t('action.clear')}
        </button>
      </div>
    </div>
  )

  return (
    <div className={css.panel} data-dsh-plugin="page-annotate">
      <div className={css.urlBar} data-dsh-part="url-bar">
        <input
          className={css.urlInput}
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onNavigate()
          }}
          placeholder={t('url.placeholder')}
          spellCheck={false}
        />
        <button type="button" className={css.action} onClick={onNavigate}>
          {t('url.go')}
        </button>
        <button type="button" className={css.action} onClick={() => void onOpenInteractive()}>
          {t('action.interactive')}
        </button>
        <button type="button" className={css.action} onClick={() => void onCaptureInteractive()} disabled={status === 'capturing'}>
          {t('action.captureInteractive')}
        </button>
        <button type="button" className={css.action} onClick={() => void onCapture()} disabled={status === 'capturing'}>
          {status === 'capturing' ? t('status.capturing') : t('action.capture')}
        </button>
        <button type="button" className={css.action} onClick={() => fileRef.current?.click()}>
          {t('action.upload')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className={css.hiddenFile}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) onUploadFile(file)
            event.target.value = ''
          }}
        />
      </div>

      <div className={css.modeTabs}>
        <button
          type="button"
          className={mode === 'browse' ? css.modeActive : css.mode}
          onClick={() => setMode('browse')}
        >
          {t('mode.browse')}
        </button>
        <button
          type="button"
          className={mode === 'annotate' ? css.modeActive : css.mode}
          onClick={() => setMode('annotate')}
          disabled={captured === null}
        >
          {t('mode.annotate')}
        </button>
      </div>

      <div className={css.stage} ref={stageRef} data-dsh-part="stage">
        {mode === 'browse' ? (
          currentUrl === '' ? (
            <div className={css.placeholder}>{t('status.idle')}</div>
          ) : (
            <iframe
              key={currentUrl}
              className={css.frame}
              src={currentUrl}
              sandbox={iframeSandboxForUrl(currentUrl, window.location.origin)}
              referrerPolicy="no-referrer"
              title={currentUrl}
            />
          )
        ) : captured === null ? (
          <div className={css.placeholder}>{t('status.idle')}</div>
        ) : (
          <div className={css.canvasWrap} style={{ width: fit.width, height: fit.height }}>
            <canvas
              ref={canvasRef}
              className={css.canvas}
              width={canvasWidth}
              height={canvasHeight}
              style={{ width: fit.width, height: fit.height }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDraft(null)}
            />
            {regionPending !== null && (
              <div className={css.textEditor} style={{ left: regionPending.x * fit.width, top: regionPending.y * fit.height }}>
                <input
                  autoFocus
                  value={regionComment}
                  onChange={(event) => setRegionComment(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRegionComment()
                    if (event.key === 'Escape') {
                      setRegionPending(null)
                      setRegionComment('')
                    }
                  }}
                  onBlur={commitRegionComment}
                  placeholder={t('region.placeholder')}
                />
              </div>
            )}
            {textPending !== null && (
              <div className={css.textEditor} style={{ left: textPending.x * fit.width, top: textPending.y * fit.height }}>
                <input
                  autoFocus
                  value={textValue}
                  onChange={(event) => setTextValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitText()
                    if (event.key === 'Escape') {
                      setTextPending(null)
                      setTextValue('')
                    }
                  }}
                  onBlur={commitText}
                  placeholder={t('text.placeholder')}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {mode === 'annotate' && captured !== null ? toolbar : null}

      {mode === 'annotate' && items.some((item) => item.kind === 'rect') ? (
        <div className={css.regionNotes} data-dsh-part="region-notes">
          {items.filter((item) => item.kind === 'rect').map((item, index) => (
            <label key={item.id} className={css.regionNote}>
              <span>{format(t('region.label'), { number: String(index + 1) })}</span>
              <input
                key={item.comment ?? ''}
                defaultValue={item.comment ?? ''}
                onBlur={(event) => store.update(item.id, { comment: event.target.value.trim() })}
                placeholder={t('region.placeholder')}
              />
            </label>
          ))}
        </div>
      ) : null}

      {(status === 'error' || status === 'captured' || status === 'inserted') && (
        <div className={status === 'error' ? css.statusError : css.status} data-dsh-part="status">
          {statusText}
        </div>
      )}

      {mode === 'annotate' && captured !== null && (
        <div className={css.sendBar}>
          <button
            type="button"
            className={css.send}
            onClick={() => void onSend()}
            disabled={status === 'sending'}
          >
            {status === 'sending' ? t('status.sending') : t('action.send')}
          </button>
        </div>
      )}
    </div>
  )
}
