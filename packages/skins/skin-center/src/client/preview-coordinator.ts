/**
 * Serializes skin and wallpaper actions into one preview session.
 * A transition in one dimension fully retires the other dimension's preview
 * before it starts, so async skin switches cannot race wallpaper publishes.
 */
export interface PreviewSkinController {
  getState(): { previewing: boolean }
  exitTryOn(): Promise<string | null>
}

export interface PreviewWallpaperController {
  trying(): boolean
  exitTryOn(): void
}

export interface PreviewCustomThemeController {
  getState(): { previewing: boolean }
  exitTryOn(): void
  suspend(): void
  resume(): void
}

export class PreviewCoordinator {
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly skin: PreviewSkinController,
    private readonly wallpaper: PreviewWallpaperController,
    private readonly customTheme?: PreviewCustomThemeController,
  ) {}

  runSkin<T>(action: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      if (this.wallpaper.trying()) this.wallpaper.exitTryOn()
      if (this.customTheme?.getState().previewing === true) this.customTheme.exitTryOn()
      this.customTheme?.suspend()
      try {
        return await action()
      } finally {
        if (!this.skin.getState().previewing) this.customTheme?.resume()
      }
    })
  }

  runWallpaper(action: () => void): Promise<void> {
    return this.enqueue(async () => {
      if (this.customTheme?.getState().previewing === true) this.customTheme.exitTryOn()
      if (this.skin.getState().previewing) await this.skin.exitTryOn()
      this.customTheme?.resume()
      action()
    })
  }

  runCustomTheme<T>(action: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      if (this.wallpaper.trying()) this.wallpaper.exitTryOn()
      const continuingCustomPreview = this.customTheme?.getState().previewing === true
      if (!continuingCustomPreview && this.skin.getState().previewing) await this.skin.exitTryOn()
      this.customTheme?.resume()
      return await action()
    })
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const run = this.tail.then(action, action)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }
}
