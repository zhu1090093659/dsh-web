import type { PetReturnTarget } from '../../../src/contracts/desktop-host.ts'
import type { PetModelDescriptor } from '../../../src/contracts/model.ts'
import type { PetRenderQuality } from '../../../src/contracts/renderer.ts'
import type { PetIntent } from '../../../src/core/intent.ts'

export type {
  PetExpression,
  PetIntent,
  PetIntentSource,
  PetIntentSpeech,
  PetMotion,
  PetMotionPlayback,
} from '../../../src/core/intent.ts'

export const DESKTOP_CHANNELS = {
  getState: 'pet-desktop:get-state',
  stateChanged: 'pet-desktop:state-changed',
  setDrawerOpen: 'pet-desktop:set-drawer-open',
  setLocked: 'pet-desktop:set-locked',
  setAlwaysOnTop: 'pet-desktop:set-always-on-top',
  setScale: 'pet-desktop:set-scale',
  setQuality: 'pet-desktop:set-quality',
  disablePlugin: 'pet-desktop:disable-plugin',
  setWebDshUrl: 'pet-desktop:set-web-dsh-url',
  beginDrag: 'pet-desktop:begin-drag',
  endDrag: 'pet-desktop:end-drag',
  moveTo: 'pet-desktop:move-to',
  hide: 'pet-desktop:hide',
  openReturnTarget: 'pet-desktop:open-return-target',
  getPetState: 'pet-desktop:get-pet-state',
  petStateChanged: 'pet-desktop:pet-state-changed',
  getModels: 'pet-desktop:get-models',
  selectModel: 'pet-desktop:select-model',
  importModel: 'pet-desktop:import-model',
  renameModel: 'pet-desktop:rename-model',
  interact: 'pet-desktop:interact',
} as const

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface MoveTarget {
  x: number
  y: number
}

export type InteractionPanelPlacement = 'above' | 'below'

export interface DesktopState {
  bounds: WindowBounds
  drawerOpen: boolean
  panelPlacement: InteractionPanelPlacement
  locked: boolean
  visible: boolean
  alwaysOnTop: boolean
  scale: number
  webDshUrl: string
  returnTarget: DesktopReturnTarget
  rendererId: string
  modelId: string
  quality: PetRenderQuality
  modelAliases: Record<string, string>
}

export type DesktopReturnTarget = PetReturnTarget

export interface DesktopWindowSettings {
  visible: boolean
  alwaysOnTop: boolean
  locked: boolean
  scale: number
}

export interface DesktopCompanionSettings extends DesktopWindowSettings {
  enabled: boolean
}

export interface PetModelSummary extends PetModelDescriptor {
  assetUrl?: string
}

export type PetModelImportResult =
  | { status: 'cancelled' }
  | { status: 'imported', model: PetModelSummary }
  | { status: 'error', message: string }

export type PetAnimation =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

export type PetInteraction = 'pet' | 'feed'

export interface PetSessionStatus {
  sessionId: string
  animation: PetAnimation
  bubble: string
  phase: string
}

export interface PetSnapshot {
  animation: PetAnimation
  bubble?: string
  whisper?: string
  phase: string
  sessionActive: boolean
  sessions?: PetSessionStatus[]
  companion?: DesktopCompanionSettings
  intent?: PetIntent
  affinity: {
    points: number
    rank: string
    pets: number
    feeds: number
    turns: number
    petCooldown: boolean
    feedCooldown: boolean
  }
  treats: {
    stocked: number
    max: number
  }
}

export interface PetBridgeState {
  connection: 'connecting' | 'ready' | 'unavailable'
  snapshot: PetSnapshot | null
}

export interface PetInteractionResult {
  reaction: string
  accepted: boolean
  intent: PetIntent
}

export interface DragResult {
  state: DesktopState
  moved: boolean
}

export interface DesktopApi {
  getState(): Promise<DesktopState>
  setDrawerOpen(open: boolean): Promise<DesktopState>
  setLocked(locked: boolean): Promise<DesktopState>
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<DesktopState>
  setScale(scale: number): Promise<DesktopState>
  setQuality(quality: PetRenderQuality): Promise<DesktopState>
  disablePlugin(): Promise<void>
  setWebDshUrl(url: string): Promise<DesktopState>
  beginDrag(): Promise<DesktopState>
  endDrag(): Promise<DragResult>
  moveTo(target: MoveTarget): Promise<DesktopState>
  hide(): Promise<void>
  openReturnTarget(): Promise<void>
  getPetState(): Promise<PetBridgeState>
  getModels(): Promise<PetModelSummary[]>
  selectModel(modelId: string): Promise<DesktopState>
  importModel(): Promise<PetModelImportResult>
  renameModel(modelId: string, name: string): Promise<DesktopState>
  interact(kind: PetInteraction): Promise<PetInteractionResult>
  onStateChanged(listener: (state: DesktopState) => void): () => void
  onPetStateChanged(listener: (state: PetBridgeState) => void): () => void
}
