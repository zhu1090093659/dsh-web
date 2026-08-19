import { app, powerMonitor, session } from 'electron'
import { dirname, join, resolve } from 'node:path'

import { ConfigStore } from './config-store.ts'
import { PetModelCatalog } from '../../../src/models/catalog.ts'
import { petModelRoot } from '../../../src/models/store.ts'
import { codexPetsDir } from '../../../src/registry.ts'
import { installDesktopIpc } from './ipc.ts'
import { disableManagedDesktopPets } from './managed-disable.ts'
import {
  managedParentAction,
  managedParentActionFromData,
  managedParentFromData,
  managedParentNativeToken,
  managedParentNativeTokenFromData,
  managedParentOrigin,
  managedParentOriginFromData,
  managedParentPid,
  managedParentRegistrationKey,
  managedParentSourceId,
  managedParentSourceIdFromData,
  processIsAlive,
  shouldShowForSecondaryInstance,
  type ManagedParentAction,
} from './managed-parent.ts'
import { createManagedQuitGate, quitSingleInstance } from './managed-quit.ts'
import { PetClient } from './pet-client.ts'
import { installDesktopRecoveryEvents } from './lifecycle-recovery.ts'
import { PetModelProtocol, registerPetModelScheme } from './model-protocol.ts'
import {
  startReadyAcknowledgementRetry,
  type ReadyAcknowledgementRetry,
  verifyAndAcknowledgeManagedConnection,
} from './ready-ack-retry.ts'
import { TrayController } from './tray.ts'
import { WindowManager } from './window-manager.ts'

let windows: WindowManager | undefined
let tray: TrayController | undefined
let pet: PetClient | undefined
let removeIpc: (() => void) | undefined
let models: PetModelProtocol | undefined
let parentTimer: NodeJS.Timeout | undefined
let removeRecoveryEvents: (() => void) | undefined
interface ManagedConnection {
  pid: number
  sourceId?: string
  origin?: string
  nativeToken?: string
}
const managedParents = new Map<string, ManagedConnection>()
let activeManagedOrigin: string | undefined
let activeManagedNativeToken: string | undefined
let desktopInitialized = false
const readyAcknowledgements = new Map<string, ReadyAcknowledgementRetry>()
const quitDesktop = (): void => { quitSingleInstance(app) }
const managedQuit = createManagedQuitGate(
  quitDesktop,
  250,
  () => managedParents.size === 0,
)

registerPetModelScheme()

function applyManagedConnection(connection: ManagedConnection): void {
  const { origin, nativeToken } = connection
  if (origin === activeManagedOrigin && nativeToken === activeManagedNativeToken) return
  activeManagedOrigin = origin
  activeManagedNativeToken = nativeToken
  if (origin !== undefined) {
    pet?.setConnection(origin, nativeToken)
    windows?.setWebDshUrl(origin)
  } else {
    pet?.setNativeToken(nativeToken)
  }
}

function acknowledgeManagedConnection(connection: ManagedConnection): void {
  if (!desktopInitialized
    || pet === undefined
    || connection.sourceId === undefined
    || connection.origin === undefined
    || connection.nativeToken === undefined) return
  const key = managedParentRegistrationKey(connection.pid, connection.sourceId)
  if (readyAcknowledgements.has(key)) return
  const client = pet
  const isCurrent = (): boolean => desktopInitialized
    && pet === client
    && managedParents.get(key) === connection
  let retry!: ReadyAcknowledgementRetry
  retry = startReadyAcknowledgementRetry(
    () => verifyAndAcknowledgeManagedConnection(
      client,
      {
        sourceId: connection.sourceId!,
        origin: connection.origin!,
        nativeToken: connection.nativeToken!,
      },
      process.pid,
      isCurrent,
    ),
    isCurrent,
    () => {
      if (readyAcknowledgements.get(key) === retry) readyAcknowledgements.delete(key)
    },
  )
  readyAcknowledgements.set(key, retry)
}

function clearReadyAcknowledgement(key: string): void {
  readyAcknowledgements.get(key)?.dispose()
  readyAcknowledgements.delete(key)
}

function latestManagedConnection(): ManagedConnection {
  return [...managedParents.values()].at(-1) ?? { pid: process.pid }
}

function addManagedParent(
  pid: number | undefined,
  sourceId: string | undefined,
  origin: string | undefined,
  nativeToken: string | undefined,
): void {
  managedQuit.cancel()
  const connection: ManagedConnection = {
    pid: pid ?? process.pid,
    ...(sourceId === undefined ? {} : { sourceId }),
    ...(origin === undefined ? {} : { origin }),
    ...(nativeToken === undefined ? {} : { nativeToken }),
  }
  if (pid === undefined) {
    applyManagedConnection(connection)
    return
  }
  const key = managedParentRegistrationKey(pid, sourceId)
  clearReadyAcknowledgement(key)
  managedParents.delete(key)
  managedParents.set(key, connection)
  applyManagedConnection(connection)
  acknowledgeManagedConnection(connection)
  if (parentTimer !== undefined) return
  parentTimer = setInterval(() => {
    let changed = false
    for (const [key, candidate] of managedParents) {
      if (processIsAlive(candidate.pid)) continue
      managedParents.delete(key)
      clearReadyAcknowledgement(key)
      changed = true
    }
    if (managedParents.size === 0) managedQuit.schedule()
    else if (changed) applyManagedConnection(latestManagedConnection())
  }, 750)
  parentTimer.unref?.()
}

function updateManagedParent(
  pid: number | undefined,
  sourceId: string | undefined,
  action: ManagedParentAction,
  origin: string | undefined,
  nativeToken: string | undefined,
): void {
  if (pid === undefined) return
  if (action === 'add') {
    addManagedParent(pid, sourceId, origin, nativeToken)
    return
  }
  const key = managedParentRegistrationKey(pid, sourceId)
  managedParents.delete(key)
  clearReadyAcknowledgement(key)
  if (managedParents.size === 0) managedQuit.schedule()
  else applyManagedConnection(latestManagedConnection())
}

function parentFromArguments(arguments_: readonly string[]): number | undefined {
  return managedParentPid(arguments_)
}

const environmentParent = process.env.DSH_PET_PARENT_PID
const environmentSource = process.env.DSH_PET_SOURCE_ID
const environmentOrigin = process.env.DSH_PET_ORIGIN
const environmentNativeToken = managedParentNativeToken(process.env.DSH_PET_NATIVE_TOKEN)
const initialParentPid = parentFromArguments([
  ...process.argv,
  ...(environmentParent === undefined ? [] : [`--dsh-parent-pid=${environmentParent}`]),
])
const initialSourceId = managedParentSourceId([
  ...process.argv,
  ...(environmentSource === undefined ? [] : [`--dsh-source-id=${environmentSource}`]),
])
const initialOrigin = managedParentOrigin([
  ...process.argv,
  ...(environmentOrigin === undefined ? [] : [`--dsh-origin=${environmentOrigin}`]),
])
const initialParentAction = managedParentAction(process.argv)
activeManagedOrigin = initialOrigin
activeManagedNativeToken = environmentNativeToken

const userDataOverride = process.env.DSH_PET_USER_DATA_DIR?.trim()
if (userDataOverride !== undefined && userDataOverride !== '') {
  app.setPath('userData', resolve(userDataOverride))
}

const hasSingleInstanceLock = app.requestSingleInstanceLock(
  initialParentPid === undefined
    ? {}
    : {
        dshParentPid: initialParentPid,
        dshParentAction: initialParentAction,
        ...(initialSourceId === undefined ? {} : { dshSourceId: initialSourceId }),
        ...(initialOrigin === undefined ? {} : { dshOrigin: initialOrigin }),
        ...(environmentNativeToken === undefined ? {} : { dshNativeToken: environmentNativeToken }),
      },
)
const shouldStart = hasSingleInstanceLock && initialParentAction === 'add'
if (!shouldStart) {
  // A remove-only helper that became the primary must not hold the lock while
  // quitting; a rapid re-enable can immediately become the real first instance.
  if (hasSingleInstanceLock) quitDesktop()
  else app.quit()
}
else addManagedParent(initialParentPid, initialSourceId, initialOrigin, environmentNativeToken)

app.on('second-instance', (_event, commandLine, _workingDirectory, additionalData) => {
  const action = managedParentActionFromData(additionalData) === 'remove'
    ? 'remove'
    : managedParentAction(commandLine)
  const origin = managedParentOriginFromData(additionalData) ?? managedParentOrigin(commandLine)
  const sourceId = managedParentSourceIdFromData(additionalData) ?? managedParentSourceId(commandLine)
  const nativeToken = managedParentNativeTokenFromData(additionalData)
  const parentPid = managedParentFromData(additionalData) ?? parentFromArguments(commandLine)
  updateManagedParent(
    parentPid,
    sourceId,
    action,
    origin,
    nativeToken,
  )
  if (shouldShowForSecondaryInstance(action, parentPid)) windows?.show()
})
app.on('activate', () => windows?.show())
app.on('window-all-closed', () => {
  // The tray owns application lifetime on every platform.
})
app.on('before-quit', () => windows?.setQuitting())
app.on('will-quit', () => {
  managedQuit.dispose()
  desktopInitialized = false
  for (const key of readyAcknowledgements.keys()) clearReadyAcknowledgement(key)
  if (parentTimer !== undefined) clearInterval(parentTimer)
  parentTimer = undefined
  removeIpc?.()
  removeRecoveryEvents?.()
  if (models !== undefined) models.uninstall(session.defaultSession)
  pet?.stop()
  tray?.destroy()
  windows?.destroy()
})

if (shouldStart) {
  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    const configStore = new ConfigStore(join(app.getPath('userData'), 'config.json'))
    let config = await configStore.load()
    if (activeManagedOrigin !== undefined && config.standalone.lastWebOrigin !== activeManagedOrigin) {
      config = { ...config, standalone: { lastWebOrigin: activeManagedOrigin } }
      await configStore.save(config)
    }
    const localModelRoot = app.isPackaged
      ? join(dirname(app.getPath('exe')), 'pixelmodel')
      : join(process.cwd(), 'pixelmodel')
    const modelCatalog = new PetModelCatalog({
      compatibilityLocalRoots: [localModelRoot],
      // One import location for both presentations. The Web registry scans it
      // at Host startup; the desktop catalog also reads it live.
      importedRoot: codexPetsDir(),
    })
    await modelCatalog.migrateLegacyImportedRoot(join(petModelRoot(), 'imported'))
    await modelCatalog.migrateLegacyImportedRoot(join(app.getPath('userData'), 'pixel-models'))
    models = new PetModelProtocol(modelCatalog)
    models.install(session.defaultSession)
    const petClient = new PetClient(
      fetch,
      activeManagedOrigin ?? config.standalone.lastWebOrigin,
      activeManagedNativeToken,
    )
    pet = petClient
    windows = new WindowManager(config, configStore, (patch) => {
      void petClient.setCompanionSettings(patch).catch(() => {
        // Keep the local preference while Harness is restarting; the next
        // successful Host snapshot will reconcile the shared settings.
      })
    }, undefined, () => { app.exit(1) })
    windows.create()
    const disableDesktopPet = () => disableManagedDesktopPets(petClient, managedParents.values())
    removeIpc = installDesktopIpc(windows, petClient, models, () => managedQuit.schedule(), disableDesktopPet)
    petClient.start()
    tray = new TrayController(
      windows,
      disableDesktopPet,
      () => managedQuit.schedule(),
    )
    removeRecoveryEvents = installDesktopRecoveryEvents(app, powerMonitor, {
      onResume: () => {
        petClient.reconnect()
        windows?.recoverAfterResume()
      },
      onGpuProcessGone: () => { windows?.recoverRenderer() },
    })
    await Promise.all([
      windows.whenRendererReady(),
      petClient.whenReady(),
    ])
    desktopInitialized = true
    for (const connection of managedParents.values()) acknowledgeManagedConnection(connection)
  }).catch(() => {
    // Never leave a spawned-but-uninitialized process looking healthy to the
    // Host. Without a ready acknowledgement the generation times out; this
    // explicit exit also gives a matching first-instance launcher an exit fact.
    app.exit(1)
  })
}
