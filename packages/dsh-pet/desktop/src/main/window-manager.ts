import { BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'node:path'

import {
  DESKTOP_CHANNELS,
  type DesktopWindowSettings,
  type DesktopReturnTarget,
  type DesktopState,
  type DragResult,
  type InteractionPanelPlacement,
  type MoveTarget,
  type PetBridgeState,
} from '../shared/desktop-api.ts'
import { type ConfigStore, type DesktopConfig } from './config-store.ts'
import { createDragSession, cursorChanged, dragTargetAt, type DragSession } from './drag-session.ts'
import { clampWindowPosition, resizedContentBounds } from './window-bounds.ts'
import { interactionPanelPlacement, petWindowContentSize } from './window-layout.ts'
import { showPetWindow } from './window-visibility.ts'
import { RecoveryBudget } from './recovery-budget.ts'
const EDGE_MARGIN = 24
const DRAG_POLL_MS = 16

type StateListener = (state: DesktopState) => void

export class WindowManager {
  private window: BrowserWindow | undefined
  private drawerOpen = false
  private panelPlacement: InteractionPanelPlacement = 'above'
  private quitting = false
  private saveTimer: NodeJS.Timeout | undefined
  private dragTimer: NodeJS.Timeout | undefined
  private dragSession: DragSession | undefined
  private rendererReloadTimer: NodeJS.Timeout | undefined
  private readonly rendererRecoveryBudget = new RecoveryBudget(1, 60_000)
  private readonly listeners = new Set<StateListener>()
  private returnTarget: DesktopReturnTarget

  constructor(
    private config: DesktopConfig,
    private readonly configStore: ConfigStore,
    private readonly onCompanionSettingsChange: (patch: Partial<DesktopWindowSettings>) => void = () => undefined,
    returnTarget?: DesktopReturnTarget,
  ) {
    this.returnTarget = returnTarget ?? {
      kind: 'web',
      id: 'dsh-web',
      label: '打开 DSH Web',
      url: config.standalone.lastWebOrigin,
    }
  }

  create(): BrowserWindow {
    const initialPosition = this.initialPosition()
    const initialSize = petWindowContentSize(this.config.surface.scale, false)
    const initialBounds = { ...initialPosition, ...initialSize }
    this.panelPlacement = interactionPanelPlacement(
      initialBounds,
      screen.getDisplayMatching(initialBounds).workArea,
    )
    const window = new BrowserWindow({
      x: initialPosition.x,
      y: initialPosition.y,
      width: initialSize.width,
      height: initialSize.height,
      useContentSize: true,
      transparent: true,
      frame: false,
      thickFrame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: this.config.surface.alwaysOnTop,
      skipTaskbar: true,
      show: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      },
    })
    this.window = window
    window.setMovable(!this.config.surface.locked)
    window.setMenuBarVisibility(false)

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.on('render-process-gone', (_event, details) => {
      if (!this.quitting && details.reason !== 'clean-exit') this.recoverRenderer()
    })
    window.on('ready-to-show', () => {
      if (this.config.surface.visible) showPetWindow(window)
    })
    window.on('show', () => this.emitState())
    window.on('hide', () => this.emitState())
    window.on('moved', () => {
      if (this.dragSession === undefined) this.schedulePositionSave()
      if (this.refreshPanelPlacement()) this.emitState()
    })
    window.on('close', event => {
      if (this.quitting) return
      event.preventDefault()
      this.hide()
    })
    window.on('closed', () => {
      this.window = undefined
      this.emitState()
    })

    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl === undefined) {
      void window.loadFile(join(__dirname, '../renderer/index.html'))
    } else {
      void window.loadURL(rendererUrl)
    }

    screen.on('display-removed', this.ensureVisible)
    screen.on('display-added', this.ensureVisible)
    screen.on('display-metrics-changed', this.ensureVisible)
    return window
  }

  ownsWebContents(id: number): boolean {
    return this.window?.webContents.id === id
  }

  state(): DesktopState {
    const fallbackSize = petWindowContentSize(this.config.surface.scale, this.drawerOpen)
    const bounds = this.window?.getBounds() ?? {
      x: 0,
      y: 0,
      width: fallbackSize.width,
      height: fallbackSize.height,
    }
    return {
      bounds,
      drawerOpen: this.drawerOpen,
      panelPlacement: this.panelPlacement,
      locked: this.config.surface.locked,
      visible: this.window?.isVisible() === true,
      alwaysOnTop: this.config.surface.alwaysOnTop,
      scale: this.config.surface.scale,
      webDshUrl: this.config.standalone.lastWebOrigin,
      returnTarget: structuredClone(this.returnTarget),
      rendererId: this.config.renderer.rendererId,
      modelId: this.config.renderer.modelId,
      quality: this.config.renderer.quality,
      modelAliases: { ...this.config.renderer.modelAliases },
    }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setDrawerOpen(open: boolean): DesktopState {
    const window = this.requiredWindow()
    if (this.drawerOpen === open) return this.state()
    this.cancelDrag()
    const currentOuter = window.getBounds()
    const currentContent = window.getContentBounds()
    const contentSize = petWindowContentSize(this.config.surface.scale, open)
    const nextContent = resizedContentBounds(
      currentOuter,
      currentContent,
      contentSize.width,
      contentSize.height,
      this.workAreas(),
    )
    this.drawerOpen = open
    window.setContentBounds(nextContent)
    this.refreshPanelPlacement()
    this.emitState()
    return this.state()
  }

  setLocked(locked: boolean): DesktopState {
    if (this.config.surface.locked === locked) return this.state()
    if (locked) this.cancelDrag()
    this.config = { ...this.config, surface: { ...this.config.surface, locked } }
    this.window?.setMovable(!locked)
    this.persistConfig()
    this.onCompanionSettingsChange({ locked })
    this.emitState()
    return this.state()
  }

  setAlwaysOnTop(alwaysOnTop: boolean): DesktopState {
    if (this.config.surface.alwaysOnTop === alwaysOnTop) return this.state()
    this.config = { ...this.config, surface: { ...this.config.surface, alwaysOnTop } }
    this.window?.setAlwaysOnTop(alwaysOnTop)
    this.persistConfig()
    this.onCompanionSettingsChange({ alwaysOnTop })
    this.emitState()
    return this.state()
  }

  setScale(scale: number): DesktopState {
    if (this.config.surface.scale === scale) return this.state()
    this.cancelDrag()
    this.config = { ...this.config, surface: { ...this.config.surface, scale } }
    this.resizeForCurrentLayout()
    this.persistConfig()
    this.onCompanionSettingsChange({ scale })
    this.emitState()
    return this.state()
  }

  setQuality(quality: DesktopConfig['renderer']['quality']): DesktopState {
    if (this.config.renderer.quality === quality) return this.state()
    this.config = { ...this.config, renderer: { ...this.config.renderer, quality } }
    this.persistConfig()
    this.emitState()
    return this.state()
  }

  /** Apply Host settings without echoing them back over HTTP. */
  applyCompanionSettings(settings: DesktopWindowSettings): DesktopState {
    const changed = this.config.surface.visible !== settings.visible
      || this.config.surface.alwaysOnTop !== settings.alwaysOnTop
      || this.config.surface.locked !== settings.locked
      || this.config.surface.scale !== settings.scale
    if (!changed) return this.state()
    if (settings.locked) this.cancelDrag()
    this.config = { ...this.config, surface: { ...this.config.surface, ...settings } }
    this.window?.setMovable(!settings.locked)
    this.window?.setAlwaysOnTop(settings.alwaysOnTop)
    this.resizeForCurrentLayout()
    if (settings.visible && this.window !== undefined) showPetWindow(this.window)
    else this.window?.hide()
    this.persistConfig()
    this.emitState()
    return this.state()
  }

  setWebDshUrl(webDshUrl: string): DesktopState {
    if (this.config.standalone.lastWebOrigin === webDshUrl) return this.state()
    this.config = { ...this.config, standalone: { lastWebOrigin: webDshUrl } }
    this.returnTarget = {
      kind: 'web',
      id: 'dsh-web',
      label: '打开 DSH Web',
      url: webDshUrl,
    }
    this.persistConfig()
    this.emitState()
    return this.state()
  }

  setModel(modelId: string): DesktopState {
    if (this.config.renderer.modelId === modelId) return this.state()
    this.config = { ...this.config, renderer: { ...this.config.renderer, modelId } }
    this.persistConfig()
    this.emitState()
    return this.state()
  }

  renameModel(modelId: string, name: string): DesktopState {
    if (this.config.renderer.modelAliases[modelId] === name) return this.state()
    this.config = {
      ...this.config,
      renderer: {
        ...this.config.renderer,
        modelAliases: {
          ...this.config.renderer.modelAliases,
          [modelId]: name,
        },
      },
    }
    this.persistConfig()
    this.emitState()
    return this.state()
  }

  moveTo(target: MoveTarget): DesktopState {
    if (this.config.surface.locked) return this.state()
    const window = this.requiredWindow()
    const bounds = window.getBounds()
    const position = clampWindowPosition(target, bounds, this.workAreas())
    window.setPosition(position.x, position.y)
    this.refreshPanelPlacement()
    this.emitState()
    return this.state()
  }

  beginDrag(): DesktopState {
    if (this.config.surface.locked) {
      this.cancelDrag()
      return this.state()
    }
    this.cancelDrag()
    const window = this.requiredWindow()
    this.dragSession = createDragSession(screen.getCursorScreenPoint(), window.getBounds())
    this.dragTimer = setInterval(() => this.updateDrag(), DRAG_POLL_MS)
    this.dragTimer.unref?.()
    return this.state()
  }

  private updateDrag(): void {
    const session = this.dragSession
    if (session === undefined || this.config.surface.locked) return
    const window = this.requiredWindow()
    const cursor = screen.getCursorScreenPoint()
    if (!cursorChanged(session.lastCursor, cursor)) return
    session.lastCursor = { ...cursor }
    const update = dragTargetAt(session, cursor)
    if (!update.moved) return
    session.moved = true
    const bounds = window.getBounds()
    const position = clampWindowPosition(update.target, bounds, this.workAreas())
    if (position.x !== bounds.x || position.y !== bounds.y) {
      window.setPosition(position.x, position.y)
    }
  }

  endDrag(): DragResult {
    this.updateDrag()
    const moved = this.dragSession?.moved === true
    this.cancelDrag()
    if (moved) this.schedulePositionSave()
    this.refreshPanelPlacement()
    this.emitState()
    return { state: this.state(), moved }
  }

  sendPetState(state: PetBridgeState): void {
    const webContents = this.window?.webContents
    if (webContents !== undefined && !webContents.isDestroyed()) {
      webContents.send(DESKTOP_CHANNELS.petStateChanged, state)
    }
  }

  show(): void {
    const window = this.requiredWindow()
    const changed = !this.config.surface.visible
    this.config = { ...this.config, surface: { ...this.config.surface, visible: true } }
    showPetWindow(window)
    this.ensureVisible()
    if (changed) {
      this.persistConfig()
      this.onCompanionSettingsChange({ visible: true })
    }
  }

  hide(): void {
    this.cancelDrag()
    const changed = this.config.surface.visible
    this.config = { ...this.config, surface: { ...this.config.surface, visible: false } }
    this.window?.hide()
    if (changed) {
      this.persistConfig()
      this.onCompanionSettingsChange({ visible: false })
    }
  }

  toggleVisibility(): void {
    if (this.window?.isVisible() === true) this.hide()
    else this.show()
  }

  /** Reload one crashed renderer per minute; repeated crashes must not loop forever. */
  recoverRenderer(): boolean {
    const window = this.window
    if (this.quitting || window === undefined || window.webContents.isDestroyed()
      || this.rendererReloadTimer !== undefined || !this.rendererRecoveryBudget.allow()) return false
    this.rendererReloadTimer = setTimeout(() => {
      this.rendererReloadTimer = undefined
      if (!this.quitting && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.reloadIgnoringCache()
      }
    }, 50)
    this.rendererReloadTimer.unref?.()
    return true
  }

  recoverAfterResume(): void {
    this.ensureVisible()
    this.emitState()
  }

  setQuitting(): void {
    this.quitting = true
  }

  destroy(): void {
    screen.off('display-removed', this.ensureVisible)
    screen.off('display-added', this.ensureVisible)
    screen.off('display-metrics-changed', this.ensureVisible)
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer)
    if (this.rendererReloadTimer !== undefined) clearTimeout(this.rendererReloadTimer)
    this.cancelDrag()
    this.listeners.clear()
  }

  private requiredWindow(): BrowserWindow {
    if (this.window === undefined) throw new Error('desktop pet window is not ready')
    return this.window
  }

  private cancelDrag(): void {
    if (this.dragTimer !== undefined) clearInterval(this.dragTimer)
    this.dragTimer = undefined
    this.dragSession = undefined
  }

  private initialPosition(): MoveTarget {
    const display = screen.getPrimaryDisplay().workArea
    const size = petWindowContentSize(this.config.surface.scale, false)
    const requested = this.config.surface.position ?? {
      x: display.x + display.width - size.width - EDGE_MARGIN,
      y: display.y + display.height - size.height - EDGE_MARGIN,
    }
    return clampWindowPosition(requested, size, this.workAreas())
  }

  private workAreas(): Rectangle[] {
    return screen.getAllDisplays().map(display => display.workArea)
  }

  private readonly ensureVisible = (): void => {
    const window = this.window
    if (window === undefined) return
    const bounds = window.getBounds()
    const position = clampWindowPosition(bounds, bounds, this.workAreas())
    const placementChanged = this.refreshPanelPlacement({ ...bounds, ...position })
    if (position.x !== bounds.x || position.y !== bounds.y) {
      window.setPosition(position.x, position.y)
      this.emitState()
    } else if (placementChanged) {
      this.emitState()
    }
  }

  private schedulePositionSave(): void {
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      const window = this.window
      if (window === undefined) return
      const bounds = window.getBounds()
      const contentBounds = window.getContentBounds()
      const collapsedWidth = petWindowContentSize(this.config.surface.scale, false).width
      const collapsedOuterWidth = collapsedWidth + bounds.width - contentBounds.width
      this.config = {
        ...this.config,
        surface: {
          ...this.config.surface,
          position: {
            x: bounds.x + bounds.width - collapsedOuterWidth,
            y: bounds.y,
          },
        },
      }
      this.persistConfig()
      this.emitState()
    }, 180)
  }

  setReturnTarget(returnTarget: DesktopReturnTarget): DesktopState {
    this.returnTarget = structuredClone(returnTarget)
    this.emitState()
    return this.state()
  }

  private resizeForCurrentLayout(): void {
    const window = this.window
    if (window === undefined) return
    const contentSize = petWindowContentSize(this.config.surface.scale, this.drawerOpen)
    const next = resizedContentBounds(
      window.getBounds(),
      window.getContentBounds(),
      contentSize.width,
      contentSize.height,
      this.workAreas(),
    )
    window.setContentBounds(next)
    this.refreshPanelPlacement()
  }

  private refreshPanelPlacement(bounds = this.window?.getBounds()): boolean {
    if (bounds === undefined) return false
    const next = interactionPanelPlacement(bounds, screen.getDisplayMatching(bounds).workArea)
    if (next === this.panelPlacement) return false
    this.panelPlacement = next
    return true
  }

  private persistConfig(): void {
    void this.configStore.save(this.config).catch(error => {
      console.error('failed to persist desktop pet settings', error)
    })
  }

  private emitState(): void {
    const state = this.state()
    const webContents = this.window?.webContents
    if (webContents !== undefined && !webContents.isDestroyed()) {
      webContents.send(DESKTOP_CHANNELS.stateChanged, state)
    }
    for (const listener of this.listeners) listener(state)
  }
}
