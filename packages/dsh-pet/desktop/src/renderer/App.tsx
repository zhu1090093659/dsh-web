import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import { PetIntentScheduler } from '../../../src/core/intent-scheduler.ts'
import type { PetRendererDescriptor } from '../../../src/contracts/renderer.ts'
import type {
  DesktopState,
  PetBridgeState,
  PetIntent,
  PetInteraction,
  PetModelSummary,
} from '../shared/desktop-api.ts'
import { RendererMount } from './RendererMount.tsx'
import { pointerDragTarget } from './drag-target.ts'
import { animationForPetIntent, type SpriteAnimation } from './sprite-animation.ts'
import { desktopStatusBubbles } from './status-bubbles.ts'

interface DragState {
  pointerId: number
  begin: Promise<DesktopState>
  startScreen: { x: number; y: number }
  startBounds: DesktopState['bounds']
}

interface Feedback {
  text: string
  kind: PetInteraction | 'error'
}

const phaseLabels: Record<string, string> = {
  idle: '待机中',
  waiting: '等待中',
  waiting_input: '等待输入',
  thinking: '思考中',
  tool: '调用工具中',
  review: '整理回复中',
  done: '任务完成',
  failed: '任务异常',
  blocked: '任务受阻',
}

const modelSourceLabels: Record<PetModelSummary['source']['kind'], string> = {
  builtin: '内置',
  local: '本地',
  imported: '已导入',
  extension: '扩展',
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.55V20.3h-3v-.1a1.7 1.7 0 0 0-1.03-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.55-1.03h-.1v-3h.1A1.7 1.7 0 0 0 7 9.94a1.7 1.7 0 0 0-.34-1.87L6.6 8l2.12-2.12.06.06a1.7 1.7 0 0 0 1.87.34A1.7 1.7 0 0 0 11.68 4.7v-.1h3v.1a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06L19.76 8l-.06.06a1.7 1.7 0 0 0-.34 1.87A1.7 1.7 0 0 0 20.9 11h.1v3h-.1A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  )
}

export function App() {
  const [desktop, setDesktop] = useState<DesktopState>()
  const [pet, setPet] = useState<PetBridgeState>({ connection: 'connecting', snapshot: null })
  const [feedback, setFeedback] = useState<Feedback>()
  const [reactionAnimation, setReactionAnimation] = useState<SpriteAnimation>()
  const [scheduledIntent, setScheduledIntent] = useState<PetIntent>()
  const [rendererDescriptor, setRendererDescriptor] = useState<PetRendererDescriptor>()
  const [models, setModels] = useState<PetModelSummary[]>([])
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [modelError, setModelError] = useState<string>()
  const [busy, setBusy] = useState<PetInteraction | 'rename' | 'connection' | 'model' | 'settings' | 'disable'>()
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [editingConnection, setEditingConnection] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  const [urlError, setUrlError] = useState<string>()
  const drag = useRef<DragState>()
  const feedbackTimer = useRef<number>()
  const animationTimer = useRef<number>()
  const intentScheduler = useRef(new PetIntentScheduler())

  useEffect(() => {
    void window.petDesktop.getState().then(setDesktop)
    return window.petDesktop.onStateChanged(setDesktop)
  }, [])

  useEffect(() => {
    const unsubscribe = window.petDesktop.onPetStateChanged(setPet)
    void window.petDesktop.getPetState().then(setPet)
    return unsubscribe
  }, [])

  useEffect(() => {
    const intent = pet.snapshot?.intent
    if (intent === undefined) {
      intentScheduler.current.reset()
      setScheduledIntent(undefined)
      return
    }
    const next = intentScheduler.current.submit(intent).current
    setScheduledIntent(current => current?.id === next?.id ? current : next)
  }, [pet.snapshot?.intent?.id])

  useEffect(() => {
    void window.petDesktop.getModels().then(setModels, () => setModelError('模型列表读取失败'))
  }, [])

  useEffect(() => () => {
    if (feedbackTimer.current !== undefined) window.clearTimeout(feedbackTimer.current)
    if (animationTimer.current !== undefined) window.clearTimeout(animationTimer.current)
    intentScheduler.current.reset()
  }, [])

  const showFeedback = (
    next: Feedback,
    animation?: SpriteAnimation,
    intent?: PetIntent,
  ): void => {
    setFeedback(next)
    setReactionAnimation(animation)
    if (feedbackTimer.current !== undefined) window.clearTimeout(feedbackTimer.current)
    if (animationTimer.current !== undefined) window.clearTimeout(animationTimer.current)
    feedbackTimer.current = window.setTimeout(() => setFeedback(undefined), 2600)
    if (intent !== undefined) {
      setScheduledIntent(intentScheduler.current.submit(intent).current)
      const delay = Math.max(0, (intent.expiresAt ?? intent.createdAt + 1_600) - Date.now())
      animationTimer.current = window.setTimeout(() => {
        setScheduledIntent(intentScheduler.current.complete(intent.id).current)
      }, delay + 1)
    } else {
      animationTimer.current = window.setTimeout(() => {
        setReactionAnimation(undefined)
        setScheduledIntent(intentScheduler.current.tick(Date.now()).current)
      }, 1600)
    }
  }

  const setDrawerOpen = (open: boolean): void => {
    void window.petDesktop.setDrawerOpen(open).then(setDesktop)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || desktop === undefined) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      begin: window.petDesktop.beginDrag(),
      startScreen: { x: event.screenX, y: event.screenY },
      startBounds: { ...desktop.bounds },
    }
  }

  const finishPointer = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean): void => {
    const current = drag.current
    if (current === undefined || current.pointerId !== event.pointerId) return
    drag.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const finalTarget = cancelled
      ? undefined
      : pointerDragTarget(current.startScreen, { x: event.screenX, y: event.screenY }, current.startBounds)
    void current.begin.then(() => window.petDesktop.endDrag()).then((result) => {
      if (finalTarget !== undefined) {
        return window.petDesktop.moveTo(finalTarget).then(setDesktop)
      }
      setDesktop(result.state)
      if (!cancelled && !result.moved) setDrawerOpen(!result.state.drawerOpen)
    })
  }

  const interact = (kind: PetInteraction): void => {
    if (pet.connection !== 'ready' || busy !== undefined) return
    setBusy(kind)
    void window.petDesktop.interact(kind).then((result) => {
      showFeedback(
        { text: result.reaction, kind },
        undefined,
        result.intent,
      )
    }, () => {
      showFeedback({ text: '暂时连接不上 DSH Pet', kind: 'error' }, 'failed')
    }).finally(() => setBusy(undefined))
  }

  const submitRename = (event?: FormEvent): void => {
    event?.preventDefault()
    const name = nameDraft.trim()
    if (name === '' || name.length > 20 || busy !== undefined || selectedModel === undefined) return
    setBusy('rename')
    void window.petDesktop.renameModel(selectedModel.id, name).then((state) => {
      setDesktop(state)
      setRenaming(false)
      showFeedback({ text: `以后就叫我${name}啦`, kind: 'pet' }, 'waving')
    }, () => {
      showFeedback({ text: '改名没有保存成功', kind: 'error' }, 'failed')
    }).finally(() => setBusy(undefined))
  }

  const submitConnection = (event: FormEvent): void => {
    event.preventDefault()
    if (busy !== undefined) return
    setBusy('connection')
    setUrlError(undefined)
    void window.petDesktop.setWebDshUrl(urlDraft).then((state) => {
      setDesktop(state)
      setUrlDraft(state.webDshUrl)
      setEditingConnection(false)
    }, () => {
      setUrlError('仅支持本机 Web DSH 的 http/https 根地址')
    }).finally(() => setBusy(undefined))
  }

  const selectModel = (model: PetModelSummary): void => {
    if (busy !== undefined || desktop?.modelId === model.id || !modelCompatible(model)) {
      setModelMenuOpen(false)
      return
    }
    setBusy('model')
    setModelError(undefined)
    void window.petDesktop.selectModel(model.id).then((state) => {
      setDesktop(state)
      setModelMenuOpen(false)
    }, () => setModelError('模型选择没有保存成功')).finally(() => setBusy(undefined))
  }

  const importModel = (): void => {
    if (busy !== undefined) return
    setBusy('model')
    setModelError(undefined)
    void window.petDesktop.importModel().then(async (result) => {
      if (result.status === 'cancelled') return
      if (result.status === 'error') {
        setModelError(result.message)
        return
      }
      const nextModels = await window.petDesktop.getModels()
      setModels(nextModels)
      setDesktop(await window.petDesktop.selectModel(result.model.id))
      setModelMenuOpen(false)
    }, () => setModelError('模型导入失败')).finally(() => setBusy(undefined))
  }

  const updateDesktopSetting = (request: () => Promise<DesktopState>): void => {
    if (busy !== undefined) return
    setBusy('settings')
    void request().then(setDesktop, () => {
      showFeedback({ text: '桌宠设置没有保存成功', kind: 'error' }, 'failed')
    }).finally(() => setBusy(undefined))
  }

  const disablePlugin = (): void => {
    if (!connected || busy !== undefined) return
    if (!window.confirm('关闭后桌面宠物会立即退出，需要在 DSH 的宠物设置中重新启用。确定关闭吗？')) return
    setBusy('disable')
    void window.petDesktop.disablePlugin().catch(() => {
      showFeedback({ text: '无法关闭桌面宠物，请稍后重试', kind: 'error' }, 'failed')
      setBusy(undefined)
    })
  }

  const snapshot = pet.snapshot
  const connected = pet.connection === 'ready'
  const statusText = feedback?.text
    ?? snapshot?.whisper
    ?? snapshot?.bubble
    ?? (connected ? phaseLabels[snapshot?.phase ?? 'idle'] ?? '状态同步中' : pet.connection === 'connecting' ? '正在连接 DSH Pet' : 'DSH Pet 未连接')
  const statusBubbles = desktopStatusBubbles(snapshot, feedback)
  const activeIntent = scheduledIntent ?? snapshot?.intent
  const animation = reactionAnimation
    ?? animationForPetIntent(activeIntent, snapshot?.animation ?? 'idle')
  const selectedModel = models.find(model => model.id === desktop?.modelId
    && model.rendererId === desktop?.rendererId)
    ?? models.find(model => model.id === 'builtin:whale')
  const modelCompatible = (model: PetModelSummary): boolean => {
    const rendererId = rendererDescriptor?.id ?? desktop?.rendererId ?? 'builtin:sprite2d'
    return model.rendererId === rendererId
      && (rendererDescriptor === undefined || rendererDescriptor.supportedModelFormats.includes(model.format))
  }
  const embeddedHost = desktop?.returnTarget.kind === 'desktop-host'
  const modelName = (model: PetModelSummary): string => desktop?.modelAliases[model.id] ?? model.displayName
  const currentModelName = selectedModel === undefined ? '鲸鱼娘' : modelName(selectedModel)
  const shellStyle = { '--pet-scale': String(desktop?.scale ?? 1) } as CSSProperties
  const rendererCapabilities = rendererDescriptor === undefined
    ? '正在初始化'
    : [
        rendererDescriptor.capabilities.motions ? '动作' : undefined,
        rendererDescriptor.capabilities.hitAreas ? '点击区域' : undefined,
        rendererDescriptor.capabilities.transparentBackground ? '透明背景' : undefined,
      ].filter(value => value !== undefined).join(' · ') || '基础显示'

  return (
    <main
      className={`desktop-shell ${desktop?.drawerOpen === true ? 'drawer-open' : ''} ${desktop?.panelPlacement === 'below' ? 'panel-below' : 'panel-above'}`}
      style={shellStyle}
    >
      <aside className="drawer" aria-hidden={desktop?.drawerOpen !== true}>
        <div className="drawer-header">
          <div>
            <p className="eyebrow">DSH PET DESKTOP</p>
            <h1>工作入口</h1>
          </div>
          <button className="icon-button" type="button" aria-label="关闭抽屉" onClick={() => setDrawerOpen(false)}>
            ×
          </button>
        </div>

        <button
          className="primary-action"
          type="button"
          disabled={desktop?.returnTarget.kind === 'none'}
          onClick={() => void window.petDesktop.openReturnTarget()}
        >
          {desktop?.returnTarget.kind === 'none' ? '暂无返回目标' : desktop?.returnTarget.label ?? '返回 DSH'}
          <span>{desktop?.returnTarget.kind === 'web'
            ? desktop.returnTarget.url.replace(/^https?:\/\//, '')
            : desktop?.returnTarget.kind === 'desktop-host' ? desktop.returnTarget.hostId : ''}</span>
        </button>

        <div className="status-card">
          <span className={`status-dot ${connected ? '' : 'offline'}`} />
          <div>
            <strong>{connected
              ? desktop?.returnTarget.kind === 'desktop-host'
                ? `已连接 ${desktop.returnTarget.label.replace(/^返回\s*/, '')}`
                : '已连接 Web DSH'
              : embeddedHost ? '等待桌面宿主' : '等待 Web DSH'}</strong>
            <p>{connected ? '状态与互动已同步' : '启动 Harness 后自动重连'}</p>
          </div>
          {!embeddedHost && (
            <button
              className="connection-settings"
              type="button"
              onClick={() => {
                setUrlDraft(desktop?.webDshUrl ?? 'http://127.0.0.1:3080')
                setUrlError(undefined)
                setEditingConnection(true)
              }}
            >
              地址
            </button>
          )}
        </div>

        {editingConnection ? (
          <form className="connection-form" onSubmit={submitConnection}>
            <input
              value={urlDraft}
              aria-label="Web DSH 地址"
              placeholder="http://127.0.0.1:3080"
              autoFocus
              onChange={event => setUrlDraft(event.target.value)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Escape') setEditingConnection(false)
              }}
            />
            <button type="submit" disabled={busy !== undefined}>保存</button>
            <button type="button" onClick={() => setEditingConnection(false)}>取消</button>
            {urlError !== undefined && <p className="connection-error">{urlError}</p>}
          </form>
        ) : (
          <div className="drawer-actions">
            <button type="button" onClick={() => void window.petDesktop.setLocked(desktop?.locked !== true)}>
              {desktop?.locked === true ? '解除位置锁定' : '锁定当前位置'}
            </button>
            <button type="button" onClick={() => void window.petDesktop.hide()}>
              隐藏到托盘
            </button>
          </div>
        )}
      </aside>

      <section className="pet-stage">
        <div className={`interaction-panel ${connected ? 'connected' : ''}`}>
          <div className="pet-summary">
            <span className={`connection-dot ${connected ? 'connected' : ''}`} />
            <strong>{currentModelName}</strong>
            <button
              className="model-menu-trigger"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={modelMenuOpen}
              onClick={() => {
                setModelError(undefined)
                setSettingsOpen(false)
                setModelMenuOpen(open => !open)
              }}
            >
              模型列表
            </button>
            <button
              className="settings-menu-trigger"
              type="button"
              aria-label="桌宠设置"
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              onClick={() => {
                setModelMenuOpen(false)
                setSettingsOpen(open => !open)
              }}
            >
              <SettingsIcon />
            </button>
          </div>
          {modelMenuOpen ? (
            <div className="model-menu">
              <div className="model-options" role="listbox" aria-label="桌宠模型">
                {models.map(model => (
                  <button
                    key={model.id}
                    className={model.id === selectedModel?.id ? 'selected' : ''}
                    type="button"
                    role="option"
                    aria-selected={model.id === selectedModel?.id}
                    disabled={busy !== undefined || !modelCompatible(model)}
                    title={model.description}
                    onClick={() => selectModel(model)}
                  >
                    <span>{modelName(model)}</span>
                    <small>{model.id === selectedModel?.id
                      ? '当前'
                      : modelCompatible(model) ? modelSourceLabels[model.source.kind] : '不兼容'}</small>
                  </button>
                ))}
              </div>
              <button className="model-import" type="button" disabled={busy !== undefined} onClick={importModel}>
                {busy === 'model' ? '正在处理' : '导入 PetDex 模型文件夹'}
              </button>
              {modelError !== undefined && <p className="model-error" role="alert">{modelError}</p>}
            </div>
          ) : settingsOpen ? (
            <div className="settings-menu" role="group" aria-label="桌宠设置">
              <div className="renderer-info" aria-label="当前渲染器能力">
                <span>渲染器</span>
                <div>
                  <strong>{rendererDescriptor?.displayName ?? '加载中'}</strong>
                  <small>{rendererCapabilities}</small>
                </div>
              </div>
              <label className="settings-row">
                <span>桌宠大小</span>
                <select
                  value={desktop?.scale ?? 1}
                  disabled={busy !== undefined}
                  onChange={event => updateDesktopSetting(() => window.petDesktop.setScale(Number(event.target.value)))}
                >
                  <option value={1}>100%</option>
                  <option value={1.25}>125%</option>
                  <option value={1.5}>150%</option>
                  <option value={2}>200%</option>
                </select>
              </label>
              <label className="settings-row">
                <span>渲染质量</span>
                <select
                  value={desktop?.quality ?? 'balanced'}
                  disabled={busy !== undefined}
                  onChange={event => updateDesktopSetting(() => window.petDesktop.setQuality(
                    event.target.value as DesktopState['quality'],
                  ))}
                >
                  <option value="low">节能</option>
                  <option value="balanced">均衡</option>
                  <option value="high">高质量</option>
                </select>
              </label>
              <label className="settings-row">
                <span>始终置顶</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={desktop?.alwaysOnTop !== false}
                  disabled={busy !== undefined}
                  onChange={event => updateDesktopSetting(() => window.petDesktop.setAlwaysOnTop(event.target.checked))}
                />
              </label>
              <label className="settings-row">
                <span>锁定位置</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={desktop?.locked === true}
                  disabled={busy !== undefined}
                  onChange={event => updateDesktopSetting(() => window.petDesktop.setLocked(event.target.checked))}
                />
              </label>
              <label className="settings-row plugin-switch-row">
                <span>桌面宠物</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={snapshot?.companion?.enabled !== false}
                  disabled={!connected || busy !== undefined}
                  onChange={event => {
                    if (!event.target.checked) disablePlugin()
                  }}
                />
              </label>
              <p className="settings-hint">关闭后需要在 DSH 的宠物设置中重新启用</p>
            </div>
          ) : (
            <>
              <p className={`pet-status ${feedback?.kind === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
                {statusText}
              </p>
              {renaming ? (
                <form className="rename-form" onSubmit={submitRename}>
                  <input
                    value={nameDraft}
                    maxLength={20}
                    aria-label="新的桌宠名字"
                    autoFocus
                    onChange={event => setNameDraft(event.target.value)}
                    onKeyDown={event => {
                      if (event.nativeEvent.isComposing) return
                      if (event.key === 'Escape') setRenaming(false)
                    }}
                  />
                  <button type="submit" disabled={busy !== undefined}>保存</button>
                  <button type="button" onClick={() => setRenaming(false)}>取消</button>
                </form>
              ) : (
                <div className="pet-actions">
                  <button type="button" disabled={!connected || busy !== undefined} onClick={() => interact('pet')}>
                    {busy === 'pet' ? '摸摸中' : '摸头'}
                  </button>
                  <button type="button" disabled={!connected || busy !== undefined} onClick={() => interact('feed')}>
                    {busy === 'feed' ? '喂食中' : '喂食'}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== undefined}
                    onClick={() => {
                      setNameDraft(currentModelName)
                      setRenaming(true)
                    }}
                  >
                    改名
                  </button>
                </div>
              )}
              <div className="pet-metrics">
                <span>{snapshot?.affinity.rank ?? '未同步'} · {snapshot?.affinity.points ?? 0} 亲密度</span>
                <span>小鱼干 {snapshot?.treats.stocked ?? 0}/{snapshot?.treats.max ?? 0}</span>
              </div>
            </>
          )}
        </div>

        {statusBubbles.length > 0 && (
          <div className="task-bubbles" role="status" aria-live="polite" aria-label="会话任务状态">
            {statusBubbles.map(bubble => (
              <div key={bubble.id} className={`task-bubble task-bubble-${bubble.kind}`} title={bubble.text}>
                {bubble.text}
              </div>
            ))}
          </div>
        )}

        <button
          className={`pet-button ${desktop?.locked === true ? 'locked' : ''}`}
          type="button"
          aria-label={desktop?.locked === true ? '打开桌宠抽屉，当前位置已锁定' : '打开桌宠抽屉或拖动桌宠'}
          onPointerDown={onPointerDown}
          onPointerUp={event => finishPointer(event, false)}
          onPointerCancel={event => finishPointer(event, true)}
        >
          <RendererMount
            model={selectedModel}
            models={models}
            quality={desktop?.quality ?? 'balanced'}
            visible={desktop?.visible !== false}
            intent={reactionAnimation === undefined ? activeIntent : undefined}
            compatibilityAnimation={animation}
            compatibilityKey={reactionAnimation === undefined ? activeIntent?.id : reactionAnimation}
            onDescriptorChange={setRendererDescriptor}
          />
        </button>
      </section>
    </main>
  )
}
