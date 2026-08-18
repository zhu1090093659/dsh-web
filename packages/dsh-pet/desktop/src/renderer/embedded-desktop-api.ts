import type {
  PetNativeSurfaceApi,
  PetNativeSurfaceState,
} from '../../../src/contracts/desktop-host.ts'
import { BUILTIN_SPRITE_MODEL_FORMATS, BUILTIN_WHALE_MODEL } from '../../../src/models/builtin-whale.ts'
import { parsePetModelDescriptor } from '../../../src/models/descriptor.ts'
import { PetEventDecoder, parseInteractionResult, parsePetSnapshot } from '../main/pet-client.ts'
import type {
  DesktopApi,
  DesktopCompanionSettings,
  DesktopState,
  PetBridgeState,
  PetInteraction,
  PetInteractionResult,
  PetModelImportResult,
  PetModelSummary,
} from '../shared/desktop-api.ts'

const NATIVE_PREFIX = '/api/pet/native'
const COLLAPSED_WIDTH = 228
const EXPANDED_WIDTH = 528
const SURFACE_HEIGHT = 304
const STREAM_RETRY_MS = 5_000
const BUILTIN_MODEL: PetModelSummary = structuredClone(BUILTIN_WHALE_MODEL)

interface EmbeddedDesktopApiDependencies {
  origin?: string
  fetch?: typeof fetch
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
}

function companionSettings(value: unknown): DesktopCompanionSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.enabled !== 'boolean' || typeof candidate.visible !== 'boolean'
    || typeof candidate.alwaysOnTop !== 'boolean' || typeof candidate.locked !== 'boolean'
    || typeof candidate.scale !== 'number' || !Number.isFinite(candidate.scale)) return undefined
  return {
    enabled: candidate.enabled,
    visible: candidate.visible,
    alwaysOnTop: candidate.alwaysOnTop,
    locked: candidate.locked,
    scale: candidate.scale,
  }
}

function safeStoredNames(storage: EmbeddedDesktopApiDependencies['storage']): Record<string, string> {
  if (storage === undefined) return {}
  try {
    const value: unknown = JSON.parse(storage.getItem('dsh-pet:model-names') ?? '{}')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).slice(0, 128).filter((entry): entry is [string, string] => (
      /^(?:builtin|local|imported|extension):[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry[0])
      && typeof entry[1] === 'string' && entry[1].trim().length > 0 && entry[1].trim().length <= 20
    )).map(([id, name]) => [id, name.trim()]))
  } catch {
    return {}
  }
}

function safeStoredValue(
  storage: EmbeddedDesktopApiDependencies['storage'],
  key: string,
  fallback: string,
): string {
  try {
    return storage?.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

/** Build the existing desktop UI API over a Host-owned native Surface. */
export function createEmbeddedDesktopApi(
  surface: PetNativeSurfaceApi,
  dependencies: EmbeddedDesktopApiDependencies = {},
): DesktopApi {
  const origin = dependencies.origin ?? globalThis.location.origin
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  const schedule = dependencies.setTimeout ?? globalThis.setTimeout
  const cancelSchedule = dependencies.clearTimeout ?? globalThis.clearTimeout
  const storage = dependencies.storage ?? globalThis.localStorage
  const stateListeners = new Set<(state: DesktopState) => void>()
  const petListeners = new Set<(state: PetBridgeState) => void>()
  const modelAliases = safeStoredNames(storage)
  const storedModelId = safeStoredValue(storage, 'dsh-pet:selected-model', BUILTIN_MODEL.id)
  let selectedModelId = /^(?:builtin|local|imported|extension):[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(storedModelId)
    ? storedModelId
    : BUILTIN_MODEL.id
  let quality: DesktopState['quality'] = (() => {
    const value = safeStoredValue(storage, 'dsh-pet:render-quality', 'balanced')
    return value === 'low' || value === 'high' ? value : 'balanced'
  })()
  let models: PetModelSummary[] = [structuredClone(BUILTIN_MODEL)]
  let native: PetNativeSurfaceState | undefined
  let drawerOpen = false
  let locked = false
  let scale = 1
  let petState: PetBridgeState = { connection: 'connecting', snapshot: null }
  let streamAbort: AbortController | undefined
  let retryTimer: ReturnType<typeof globalThis.setTimeout> | undefined

  const desktopState = (): DesktopState => {
    if (native === undefined) throw new Error('native pet surface state is unavailable')
    return {
      bounds: { ...native.bounds },
      drawerOpen,
      panelPlacement: 'above',
      locked,
      visible: native.visible,
      alwaysOnTop: native.alwaysOnTop,
      scale,
      webDshUrl: origin,
      returnTarget: structuredClone(native.returnTarget),
      rendererId: 'builtin:sprite2d',
      modelId: selectedModelId,
      quality,
      modelAliases: { ...modelAliases },
    }
  }

  const publishDesktop = (): DesktopState => {
    const state = desktopState()
    for (const listener of stateListeners) {
      try { listener(state) } catch { /* one renderer listener cannot starve the rest */ }
    }
    return state
  }

  const publishPet = (state: PetBridgeState): PetBridgeState => {
    petState = state
    for (const listener of petListeners) {
      try { listener(state) } catch { /* one renderer listener cannot starve the rest */ }
    }
    return state
  }

  const updateNative = (state: PetNativeSurfaceState): DesktopState => {
    native = structuredClone(state)
    return publishDesktop()
  }

  const requestJson = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetchImpl(`${origin}${path}`, init)
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      throw new Error(`embedded pet request failed: ${String(response.status)}`)
    }
    return response.json()
  }

  const postJson = (path: string, body: unknown): Promise<unknown> => requestJson(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const applyCompanion = async (settings: DesktopCompanionSettings): Promise<void> => {
    locked = settings.locked
    scale = settings.scale
    const current = native ?? await surface.getState()
    native = current
    const width = Math.round((drawerOpen ? EXPANDED_WIDTH : COLLAPSED_WIDTH) * scale)
    const height = Math.round(SURFACE_HEIGHT * scale)
    const resized = current.bounds.width === width && current.bounds.height === height
      ? current
      : await surface.setBounds({
          ...current.bounds,
          x: current.bounds.x + current.bounds.width - width,
          width,
          height,
        })
    native = resized.alwaysOnTop === settings.alwaysOnTop
      ? resized
      : await surface.setAlwaysOnTop(settings.alwaysOnTop)
    if (settings.visible && !native.visible) native = await surface.show()
    else if (!settings.visible && native.visible) native = await surface.hide()
    publishDesktop()
  }

  const readPetState = async (): Promise<PetBridgeState> => {
    try {
      const snapshot = parsePetSnapshot(await requestJson(`${NATIVE_PREFIX}/state`))
      if (snapshot.companion !== undefined) await applyCompanion(snapshot.companion)
      return publishPet({ connection: 'ready', snapshot })
    } catch {
      return publishPet({ connection: 'unavailable', snapshot: petState.snapshot })
    }
  }

  const stopStream = (): void => {
    streamAbort?.abort()
    streamAbort = undefined
    if (retryTimer !== undefined) cancelSchedule(retryTimer)
    retryTimer = undefined
  }

  const connectStream = async (): Promise<void> => {
    if (petListeners.size === 0 || streamAbort !== undefined) return
    const abort = new AbortController()
    streamAbort = abort
    try {
      const response = await fetchImpl(`${origin}${NATIVE_PREFIX}/events`, {
        headers: { accept: 'text/event-stream' },
        signal: abort.signal,
      })
      if (!response.ok || response.body === null
        || !response.headers.get('content-type')?.includes('text/event-stream')) {
        throw new Error('embedded pet event stream unavailable')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const events = new PetEventDecoder()
      while (!abort.signal.aborted) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('embedded pet event stream closed')
        for (const data of events.push(decoder.decode(chunk.value, { stream: true }))) {
          const snapshot = parsePetSnapshot(JSON.parse(data))
          if (snapshot.companion !== undefined) await applyCompanion(snapshot.companion)
          publishPet({ connection: 'ready', snapshot })
        }
      }
    } catch {
      if (!abort.signal.aborted) {
        publishPet({ connection: 'unavailable', snapshot: petState.snapshot })
        retryTimer = schedule(() => {
          retryTimer = undefined
          void connectStream()
        }, STREAM_RETRY_MS)
      }
    } finally {
      if (streamAbort === abort) streamAbort = undefined
    }
  }

  const resize = async (): Promise<DesktopState> => {
    const current = native ?? await surface.getState()
    const width = Math.round((drawerOpen ? EXPANDED_WIDTH : COLLAPSED_WIDTH) * scale)
    const height = Math.round(SURFACE_HEIGHT * scale)
    return updateNative(await surface.setBounds({
      ...current.bounds,
      x: current.bounds.x + current.bounds.width - width,
      width,
      height,
    }))
  }

  const setCompanion = async (
    patch: Partial<DesktopCompanionSettings>,
  ): Promise<DesktopCompanionSettings> => {
    const value = await postJson(`${NATIVE_PREFIX}/surface-settings`, patch)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('embedded pet settings response is invalid')
    }
    const settings = companionSettings((value as Record<string, unknown>).companion)
    if (settings === undefined) throw new Error('embedded pet settings response is invalid')
    return settings
  }

  const readModels = async (): Promise<PetModelSummary[]> => {
    try {
      const value = await requestJson(`${NATIVE_PREFIX}/models`)
      if (!Array.isArray(value)) throw new TypeError('model catalog response must be an array')
      models = value.map((candidate) => {
        const model = parsePetModelDescriptor(candidate)
        return {
          ...model,
          ...(model.source.kind === 'builtin'
            ? {}
            : { assetUrl: `${origin}${NATIVE_PREFIX}/assets/${encodeURIComponent(model.id)}/${encodeURIComponent(model.entry)}` }),
        }
      })
      if (!models.some(model => model.id === BUILTIN_MODEL.id)) models.unshift(structuredClone(BUILTIN_MODEL))
    } catch {
      models = [structuredClone(BUILTIN_MODEL)]
    }
    return models.map(model => structuredClone(model))
  }

  void surface.getState().then(updateNative)
  const surfaceState = surface.onStateChanged(updateNative)
  globalThis.addEventListener?.('pagehide', () => {
    stopStream()
    void surfaceState.dispose()
  }, { once: true })

  return {
    async getState() {
      native ??= await surface.getState()
      await readPetState()
      return desktopState()
    },
    async setDrawerOpen(open) {
      drawerOpen = open
      return resize()
    },
    async setLocked(value) {
      const settings = await setCompanion({ locked: value })
      locked = settings.locked
      return publishDesktop()
    },
    async setAlwaysOnTop(value) {
      const settings = await setCompanion({ alwaysOnTop: value })
      native = await surface.setAlwaysOnTop(settings.alwaysOnTop)
      return publishDesktop()
    },
    async setScale(value) {
      const settings = await setCompanion({ scale: value })
      scale = settings.scale
      return resize()
    },
    async setQuality(value) {
      quality = value
      try { storage?.setItem('dsh-pet:render-quality', value) } catch { /* storage is optional */ }
      return publishDesktop()
    },
    async disablePlugin() {
      await setCompanion({ enabled: false })
    },
    async setWebDshUrl() {
      throw new Error('embedded presentation owns its DSH origin')
    },
    async beginDrag() {
      native = await surface.beginDrag()
      return desktopState()
    },
    async endDrag() {
      const result = await surface.endDrag()
      native = result.state
      return { state: publishDesktop(), moved: result.moved }
    },
    async moveTo(target) {
      const current = native ?? await surface.getState()
      return updateNative(await surface.setBounds({ ...current.bounds, ...target }))
    },
    async hide() {
      await setCompanion({ visible: false })
      updateNative(await surface.hide())
    },
    openReturnTarget: () => surface.openReturnTarget(),
    async getPetState() {
      return readPetState()
    },
    async getModels() {
      return readModels()
    },
    async selectModel(modelId) {
      if (models.length === 1 && models[0]?.id === BUILTIN_MODEL.id) await readModels()
      const model = models.find(candidate => candidate.id === modelId)
      if (model === undefined || model.rendererId !== 'builtin:sprite2d'
        || !BUILTIN_SPRITE_MODEL_FORMATS.includes(model.format as (typeof BUILTIN_SPRITE_MODEL_FORMATS)[number])) {
        throw new Error('model is unavailable or incompatible with the embedded renderer')
      }
      selectedModelId = modelId
      try { storage?.setItem('dsh-pet:selected-model', modelId) } catch { /* storage is optional */ }
      return publishDesktop()
    },
    async importModel(): Promise<PetModelImportResult> {
      return { status: 'error', message: '请先在独立桌宠中导入模型，网页宿主会自动读取统一模型目录' }
    },
    async renameModel(modelId, name) {
      if (!models.some(model => model.id === modelId)) throw new Error('unknown embedded pet model')
      modelAliases[modelId] = name
      try { storage?.setItem('dsh-pet:model-names', JSON.stringify(modelAliases)) } catch { /* storage is optional */ }
      return publishDesktop()
    },
    async interact(kind: PetInteraction): Promise<PetInteractionResult> {
      return parseInteractionResult(await postJson(`${NATIVE_PREFIX}/interact`, { kind }), kind)
    },
    onStateChanged(listener) {
      stateListeners.add(listener)
      if (native !== undefined) listener(desktopState())
      return () => { stateListeners.delete(listener) }
    },
    onPetStateChanged(listener) {
      petListeners.add(listener)
      listener(petState)
      void connectStream()
      return () => {
        petListeners.delete(listener)
        if (petListeners.size === 0) stopStream()
      }
    },
  }
}
