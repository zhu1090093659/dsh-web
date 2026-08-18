import { contextBridge, ipcRenderer } from 'electron'

import {
  DESKTOP_CHANNELS,
  type DesktopApi,
  type DesktopState,
  type MoveTarget,
  type PetBridgeState,
  type PetInteraction,
} from '../shared/desktop-api.ts'

const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getState),
  setDrawerOpen: (open: boolean) => ipcRenderer.invoke(DESKTOP_CHANNELS.setDrawerOpen, open),
  setLocked: (locked: boolean) => ipcRenderer.invoke(DESKTOP_CHANNELS.setLocked, locked),
  setAlwaysOnTop: (alwaysOnTop: boolean) => ipcRenderer.invoke(DESKTOP_CHANNELS.setAlwaysOnTop, alwaysOnTop),
  setScale: (scale: number) => ipcRenderer.invoke(DESKTOP_CHANNELS.setScale, scale),
  setQuality: quality => ipcRenderer.invoke(DESKTOP_CHANNELS.setQuality, quality),
  disablePlugin: () => ipcRenderer.invoke(DESKTOP_CHANNELS.disablePlugin),
  setWebDshUrl: (url: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.setWebDshUrl, url),
  beginDrag: () => ipcRenderer.invoke(DESKTOP_CHANNELS.beginDrag),
  endDrag: () => ipcRenderer.invoke(DESKTOP_CHANNELS.endDrag),
  moveTo: (target: MoveTarget) => ipcRenderer.invoke(DESKTOP_CHANNELS.moveTo, target),
  hide: () => ipcRenderer.invoke(DESKTOP_CHANNELS.hide),
  openReturnTarget: () => ipcRenderer.invoke(DESKTOP_CHANNELS.openReturnTarget),
  getPetState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getPetState),
  getModels: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getModels),
  selectModel: (modelId: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.selectModel, modelId),
  importModel: () => ipcRenderer.invoke(DESKTOP_CHANNELS.importModel),
  renameModel: (modelId: string, name: string) => ipcRenderer.invoke(DESKTOP_CHANNELS.renameModel, modelId, name),
  interact: (kind: PetInteraction) => ipcRenderer.invoke(DESKTOP_CHANNELS.interact, kind),
  onStateChanged(listener: (state: DesktopState) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopState): void => listener(state)
    ipcRenderer.on(DESKTOP_CHANNELS.stateChanged, handler)
    return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.stateChanged, handler)
  },
  onPetStateChanged(listener: (state: PetBridgeState) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, state: PetBridgeState): void => listener(state)
    ipcRenderer.on(DESKTOP_CHANNELS.petStateChanged, handler)
    return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.petStateChanged, handler)
  },
}

contextBridge.exposeInMainWorld('petDesktop', api)
