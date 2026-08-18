import { app, dialog, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'

import type { WindowManager } from './window-manager.ts'
import { disableDesktopPetAndQuit } from './tray-exit.ts'

// PNG/JPEG are the only formats Electron guarantees for NativeImage on every
// platform. The previous inline SVG produced an empty Windows tray image.
export const TRAY_ICON_PATH = join(__dirname, '..', '..', 'resources', 'tray-icon.png')

const FALLBACK_TRAY_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACTSURBVHgBpZKBCYAgEEV/TeAIjuIIbdQIuUGt0CS1gW1iZ2jIVaTnhw+Cvs8/OYDJA4Y8kR3ZR2/kmazxJbpUEfQ/Dm/UG7wVwHkjlQdMFfDdJMFaACebnjJGyDWgcnZu1/lrCrl6NCoEHJBrDwEr5NrT6ko/UV8xdLAC2N49mlc5CylpYh8wCwqrvbBGLoKGvz8Bfq0QPWEUo/EAAAAASUVORK5CYII='

function trayIcon() {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH)
  return icon.isEmpty() ? nativeImage.createFromDataURL(FALLBACK_TRAY_ICON) : icon
}

export class TrayController {
  private readonly tray = new Tray(trayIcon())
  private readonly unsubscribe: () => void
  private exiting = false

  constructor(
    private readonly windows: WindowManager,
    private readonly disableDesktopPet: () => Promise<unknown>,
  ) {
    this.tray.setToolTip('DSH Pet Desktop')
    this.tray.on('click', () => windows.toggleVisibility())
    this.unsubscribe = windows.subscribe(() => this.rebuildMenu())
    this.rebuildMenu()
  }

  destroy(): void {
    this.unsubscribe()
    this.tray.destroy()
  }

  private rebuildMenu(): void {
    const state = this.windows.state()
    this.tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: state.visible ? '隐藏桌宠' : '显示桌宠',
        click: () => this.windows.toggleVisibility(),
      },
      {
        label: '锁定位置',
        type: 'checkbox',
        checked: state.locked,
        click: item => this.windows.setLocked(item.checked),
      },
      { type: 'separator' },
      {
        label: this.exiting ? '正在退出' : '退出桌宠',
        enabled: !this.exiting,
        click: () => { void this.exit() },
      },
    ]))
  }

  private async exit(): Promise<void> {
    if (this.exiting) return
    this.exiting = true
    this.rebuildMenu()
    const disabled = await disableDesktopPetAndQuit(this.disableDesktopPet, () => app.quit())
    if (disabled) return
    this.exiting = false
    this.rebuildMenu()
    dialog.showErrorBox('无法退出桌宠', '未能更新 DSH 的桌面宠物开关，请确认 DSH 正在运行后重试。')
  }
}
