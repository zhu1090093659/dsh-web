import { app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'

import { DESKTOP_CHANNELS } from '../shared/desktop-api.ts'
import {
  parseMoveTarget,
  parsePetInteraction,
  parsePetModelId,
  parsePetScale,
  parsePetName,
  parseRenderQuality,
  parseWebDshUrl,
  requireBoolean,
} from './ipc-validation.ts'
import type { PetClient } from './pet-client.ts'
import type { PetModelProtocol } from './model-protocol.ts'
import type { WindowManager } from './window-manager.ts'

function requirePetRenderer(event: IpcMainInvokeEvent, windows: WindowManager): void {
  if (!windows.ownsWebContents(event.sender.id)) throw new Error('untrusted renderer')
}

export function installDesktopIpc(windows: WindowManager, pet: PetClient, models: PetModelProtocol): () => void {
  ipcMain.handle(DESKTOP_CHANNELS.getState, event => {
    requirePetRenderer(event, windows)
    return windows.state()
  })
  ipcMain.handle(DESKTOP_CHANNELS.setDrawerOpen, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    return windows.setDrawerOpen(requireBoolean(value))
  })
  ipcMain.handle(DESKTOP_CHANNELS.setLocked, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    return windows.setLocked(requireBoolean(value))
  })
  ipcMain.handle(DESKTOP_CHANNELS.setAlwaysOnTop, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    return windows.setAlwaysOnTop(requireBoolean(value))
  })
  ipcMain.handle(DESKTOP_CHANNELS.setScale, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    return windows.setScale(parsePetScale(value))
  })
  ipcMain.handle(DESKTOP_CHANNELS.setQuality, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    return windows.setQuality(parseRenderQuality(value))
  })
  ipcMain.handle(DESKTOP_CHANNELS.disablePlugin, async event => {
    requirePetRenderer(event, windows)
    const companion = await pet.setCompanionSettings({ enabled: false })
    if (!companion.enabled) setTimeout(() => app.quit(), 50).unref?.()
  })
  ipcMain.handle(DESKTOP_CHANNELS.setWebDshUrl, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    const origin = parseWebDshUrl(value)
    pet.setOrigin(origin)
    return windows.setWebDshUrl(origin)
  })
  ipcMain.handle(DESKTOP_CHANNELS.beginDrag, event => {
    requirePetRenderer(event, windows)
    return windows.beginDrag()
  })
  ipcMain.handle(DESKTOP_CHANNELS.endDrag, event => {
    requirePetRenderer(event, windows)
    return windows.endDrag()
  })
  ipcMain.handle(DESKTOP_CHANNELS.moveTo, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    return windows.moveTo(parseMoveTarget(value))
  })
  ipcMain.handle(DESKTOP_CHANNELS.hide, event => {
    requirePetRenderer(event, windows)
    windows.hide()
  })
  ipcMain.handle(DESKTOP_CHANNELS.openReturnTarget, async event => {
    requirePetRenderer(event, windows)
    const target = windows.state().returnTarget
    if (target.kind === 'web') await shell.openExternal(`${target.url}/`)
  })
  ipcMain.handle(DESKTOP_CHANNELS.getPetState, event => {
    requirePetRenderer(event, windows)
    return pet.state()
  })
  ipcMain.handle(DESKTOP_CHANNELS.getModels, event => {
    requirePetRenderer(event, windows)
    return models.list()
  })
  ipcMain.handle(DESKTOP_CHANNELS.selectModel, async (event, value: unknown) => {
    requirePetRenderer(event, windows)
    const modelId = parsePetModelId(value)
    if (!await models.supports(windows.state().rendererId, modelId)) {
      throw new TypeError('unknown or incompatible pet model id')
    }
    return windows.setModel(modelId)
  })
  ipcMain.handle(DESKTOP_CHANNELS.importModel, async event => {
    requirePetRenderer(event, windows)
    const selection = await dialog.showOpenDialog({
      title: '导入 PetDex 模型文件夹',
      buttonLabel: '导入模型',
      properties: ['openDirectory'],
    })
    if (selection.canceled || selection.filePaths[0] === undefined) return { status: 'cancelled' }
    try {
      return { status: 'imported', model: await models.importDirectory(selection.filePaths[0]) }
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      const safePrefixes = [
        'pet-model.json',
        '模型文件夹',
        '模型 id',
        'rendererId',
        'format',
        'entry',
        'capabilities',
        'bindings',
        'fallback',
        'pet.json 中的',
        'pet.json 缺少',
        'displayName',
        'description',
        'spritesheetPath',
        'spriteVersionNumber',
        '模型纹理',
        '精灵图',
        '不支持该 WebP',
        '无法为',
      ]
      const message = safePrefixes.some(prefix => detail.startsWith(prefix))
        ? detail
        : '无法读取该模型，请确认文件夹中包含有效的 pet-model.json，或兼容的 PetDex pet.json 与纹理'
      return { status: 'error', message }
    }
  })
  ipcMain.handle(DESKTOP_CHANNELS.renameModel, (event, modelId: unknown, value: unknown) => {
    requirePetRenderer(event, windows)
    return windows.renameModel(parsePetModelId(modelId), parsePetName(value))
  })
  ipcMain.handle(DESKTOP_CHANNELS.interact, (event, value: unknown) => {
    requirePetRenderer(event, windows)
    return pet.interact(parsePetInteraction(value))
  })
  const unsubscribePet = pet.subscribe((state) => {
    if (state.snapshot?.companion !== undefined) {
      if (!state.snapshot.companion.enabled) app.quit()
      else windows.applyCompanionSettings({
        visible: state.snapshot.companion.visible,
        alwaysOnTop: state.snapshot.companion.alwaysOnTop,
        locked: state.snapshot.companion.locked,
        scale: state.snapshot.companion.scale,
      })
    }
    windows.sendPetState(state)
  })

  return () => {
    unsubscribePet()
    for (const channel of Object.values(DESKTOP_CHANNELS)) {
      if (channel !== DESKTOP_CHANNELS.stateChanged
        && channel !== DESKTOP_CHANNELS.petStateChanged) {
        ipcMain.removeHandler(channel)
      }
    }
  }
}
