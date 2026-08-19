/**
 * The wallpaper panel of the skin-center card: lists the user's local
 * Wallpaper Engine library (video / web / scene wallpapers) with live
 * try-on, one-click apply, local import, and render tuning. Rendering and
 * persistence ride the WallpaperController (wallpaper.ts); the library,
 * media, import and scene-frame bytes come from the host's /we routes.
 *
 * Compliance: wallpapers are the user's own local files (their Workshop
 * subscriptions or manual folders). The panel never downloads or shares
 * content; import only copies files within the user's machine.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WallpaperDescriptor, WallpaperHandle } from './wallpaper.ts'
import css from './skin-center.module.css'

/** Host base path of the wallpaper API (mirrors src/we-routes.ts). */
const WE_API = '/api/skin-center/we'

/** One wallpaper entry as served by the inventory route. */
interface WallpaperItem extends WallpaperDescriptor {
  source: 'workshop' | 'local' | 'imported'
  playable: boolean
  updateAvailable: boolean
}

/** Inventory payload shape. */
interface InventoryPayload {
  ok?: boolean
  installDir?: string | null
  total?: number
  portableCount?: number
  wallpapers?: WallpaperItem[]
  error?: string
}

/** Post one wallpaper action and return whether it succeeded. */
async function postWe(path: string, id: string): Promise<string | null> {
  try {
    const response = await fetch(WE_API + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
    if (!response.ok || payload?.ok !== true) return payload?.error ?? 'HTTP ' + String(response.status)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** The type badge copy key of one wallpaper. */
function typeKey(item: WallpaperItem): 'wallpaperTypeVideo' | 'wallpaperTypeWeb' | 'wallpaperTypeScene' | 'wallpaperTypeApp' {
  switch (item.type) {
    case 'video': return 'wallpaperTypeVideo'
    case 'web': return 'wallpaperTypeWeb'
    case 'scene': return 'wallpaperTypeScene'
    default: return 'wallpaperTypeApp'
  }
}

/** Render the Wallpaper Engine section of the skin-center card. */
export function WallpaperPanel({ t, wallpaper }: { t: PropsLocale<'skinCenter'>['t']; wallpaper: WallpaperHandle }): ReactNode {
  const enabled = useSyncExternalStore(wallpaper.subscribe, wallpaper.enabled)
  const selection = useSyncExternalStore(wallpaper.subscribe, wallpaper.selection)
  const mode = useSyncExternalStore(wallpaper.subscribe, wallpaper.mode)
  const dim = useSyncExternalStore(wallpaper.subscribe, wallpaper.dim)
  const blur = useSyncExternalStore(wallpaper.subscribe, wallpaper.wallpaperBlur)
  const pauseOnHidden = useSyncExternalStore(wallpaper.subscribe, wallpaper.pauseOnHidden)
  const sound = useSyncExternalStore(wallpaper.subscribe, wallpaper.sound)
  const volume = useSyncExternalStore(wallpaper.subscribe, wallpaper.volume)
  const activeId = useSyncExternalStore(wallpaper.subscribe, wallpaper.activeId)
  const trying = useSyncExternalStore(wallpaper.subscribe, wallpaper.trying)
  const dirs = useSyncExternalStore(wallpaper.subscribe, wallpaper.dirs)
  const [dirInput, setDirInput] = useState('')

  const [items, setItems] = useState<WallpaperItem[] | null>(null)
  const [installDir, setInstallDir] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  /** Fetch the inventory and reconcile the mounted layer with the selection. */
  const load = useCallback((): void => {
    void fetch(WE_API + '/inventory')
      .then(async response => {
        const payload = await response.json().catch(() => null) as InventoryPayload | null
        if (!mounted.current) return
        if (!response.ok || payload?.ok !== true || !Array.isArray(payload.wallpapers)) {
          setLoadError(payload?.error ?? 'HTTP ' + String(response.status))
          setItems([])
          return
        }
        setLoadError(null)
        setItems(payload.wallpapers)
        setInstallDir(typeof payload.installDir === 'string' ? payload.installDir : null)
        const selected = wallpaper.selection()
        wallpaper.sync(payload.wallpapers.find(w => w.id === selected) ?? null)
      })
      .catch((error: unknown) => {
        if (!mounted.current) return
        setLoadError(error instanceof Error ? error.message : String(error))
        setItems([])
      })
  }, [wallpaper])

  useEffect(load, [load])

  /** Run one import/remove action with the shared busy + error state. */
  const runAction = (id: string, path: string, after?: () => void): void => {
    setActionError(null)
    setWorkingId(id)
    void postWe(path, id).then(error => {
      if (!mounted.current) return
      setWorkingId(null)
      if (error !== null) {
        setActionError(error)
        return
      }
      after?.()
      load()
    })
  }

  const descriptorOf = (item: WallpaperItem): WallpaperDescriptor => ({
    id: item.id,
    title: item.title,
    type: item.type,
    videoUrl: item.videoUrl,
    webUrl: item.webUrl,
    frameUrl: item.frameUrl,
    previewUrl: item.previewUrl,
  })

  /** Whether one entry can be mounted at all in the current mode. */
  const renderable = (item: WallpaperItem): boolean =>
    item.playable || item.frameUrl !== null || item.previewUrl !== null

  const activeSelection = selection

  return (
    <div className={css.wallpaperSection}>
      <div className={css.enableRow}>
        <span className={css.enableLabel} title={t('wallpaperEnable')}>{t('wallpaperTitle')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('wallpaperEnable')}
          className={enabled ? css.switch + ' ' + css.switchOn : css.switch}
          onClick={() => { wallpaper.setEnabled(!enabled) }}
        >
          <span className={css.switchThumb} />
        </button>
        <p className={css.enableHint}>{t('wallpaperHint')}</p>
      </div>
      {enabled && (
        <>
          <div className={css.wallpaperStatus}>
            {loadError !== null
              ? <span className={css.wallpaperStatusError}>{t('wallpaperLoadError')}: {loadError}</span>
              : items === null
                ? <span>{t('loading')}</span>
                : installDir !== null
                  ? <span>{t('wallpaperLibraryFound')} · {items.length}</span>
                  : <span>{t('wallpaperLibraryManual')} · {items.length}</span>}
            <button type="button" className={css.button} onClick={load}>{t('wallpaperRefresh')}</button>
          </div>

          {activeSelection !== '' && (
            <div className={css.wallpaperControls}>
              <div className={css.themeRow}>
                <span className={css.themeLabel}>{t('wallpaperMode')}</span>
                <button
                  type="button"
                  className={css.themeButton + (mode === 'live' ? ' ' + css.themeButtonActive : '')}
                  onClick={() => { wallpaper.setMode('live') }}
                >
                  {t('wallpaperModeLive')}
                </button>
                <button
                  type="button"
                  className={css.themeButton + (mode === 'frame' ? ' ' + css.themeButtonActive : '')}
                  onClick={() => { wallpaper.setMode('frame') }}
                >
                  {t('wallpaperModeFrame')}
                </button>
                <button
                  type="button"
                  className={css.button + ' ' + css.buttonGhost}
                  onClick={() => { wallpaper.clearSelection() }}
                >
                  {t('wallpaperClear')}
                </button>
              </div>
              <div className={css.backgroundRow}>
                <div className={css.backgroundHead}>
                  <span className={css.backgroundLabel}>{t('wallpaperDim')}</span>
                  <span className={css.backgroundValue} aria-hidden="true">{dim}%</span>
                </div>
                <input
                  className={css.backgroundRange}
                  type="range"
                  min="0"
                  max="90"
                  step="5"
                  value={dim}
                  aria-label={t('wallpaperDim')}
                  onChange={(event) => { wallpaper.setDim(Number(event.target.value)) }}
                />
                <div className={css.backgroundHead}>
                  <span className={css.backgroundLabel}>{t('wallpaperBlur')}</span>
                  <span className={css.backgroundValue} aria-hidden="true">{blur}px</span>
                </div>
                <input
                  className={css.backgroundRange}
                  type="range"
                  min="0"
                  max="60"
                  step="1"
                  value={blur}
                  aria-label={t('wallpaperBlur')}
                  onChange={(event) => { wallpaper.setBlur(Number(event.target.value)) }}
                />
              </div>
              <div className={css.enableRow}>
                <span className={css.enableLabel}>{t('wallpaperPauseHidden')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={pauseOnHidden}
                  aria-label={t('wallpaperPauseHidden')}
                  className={pauseOnHidden ? css.switch + ' ' + css.switchOn : css.switch}
                  onClick={() => { wallpaper.setPauseOnHidden(!pauseOnHidden) }}
                >
                  <span className={css.switchThumb} />
                </button>
              </div>
              <div className={css.enableRow}>
                <span className={css.enableLabel} title={t('wallpaperSoundHint')}>{t('wallpaperSound')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sound}
                  aria-label={t('wallpaperSound')}
                  className={sound ? css.switch + ' ' + css.switchOn : css.switch}
                  onClick={() => { wallpaper.setSound(!sound) }}
                >
                  <span className={css.switchThumb} />
                </button>
              </div>
              {sound && (
                <div className={css.backgroundRow}>
                  <div className={css.backgroundHead}>
                    <span className={css.backgroundLabel}>{t('wallpaperVolume')}</span>
                    <span className={css.backgroundValue} aria-hidden="true">{volume}%</span>
                  </div>
                  <input
                    className={css.backgroundRange}
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={volume}
                    aria-label={t('wallpaperVolume')}
                    onChange={(event) => { wallpaper.setVolume(Number(event.target.value)) }}
                  />
                </div>
              )}
            </div>
          )}

          <div className={css.wallpaperDirs}>
            <span className={css.themeLabel}>{t('wallpaperDirs')}</span>
            {dirs.length === 0 && <span className={css.backgroundHintMuted}>{t('wallpaperDirsEmpty')}</span>}
            {dirs.map(dir => (
              <span className={css.wallpaperDir} key={dir}>
                <span className={css.wallpaperDirPath} title={dir}>{dir}</span>
                <button
                  type="button"
                  className={css.wallpaperDirRemove}
                  aria-label={t('wallpaperRemove')}
                  onClick={() => { wallpaper.removeDir(dir); load() }}
                >
                  ×
                </button>
              </span>
            ))}
            <span className={css.wallpaperDirAdd}>
              <input
                className={css.wallpaperDirInput}
                type="text"
                value={dirInput}
                placeholder={t('wallpaperDirPlaceholder')}
                onChange={(event) => { setDirInput(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && dirInput.trim() !== '') {
                    wallpaper.addDir(dirInput)
                    setDirInput('')
                    load()
                  }
                }}
              />
              <button
                type="button"
                className={css.button}
                disabled={dirInput.trim() === ''}
                onClick={() => { wallpaper.addDir(dirInput); setDirInput(''); load() }}
              >
                {t('wallpaperDirAdd')}
              </button>
            </span>
            <p className={css.backgroundHintMuted}>{t('wallpaperDirsHint')}</p>
          </div>

          {actionError !== null && <div className={css.error}>{actionError}</div>}

          {items !== null && items.length > 0 && (
            <div className={css.wallpaperGrid}>
              {items.map(item => {
                const isApplied = item.id === activeSelection
                const isMounted = item.id === activeId
                const busy = workingId === item.id
                return (
                  <div className={css.wallpaperCard} key={item.id}>
                    <div className={css.wallpaperThumbWrap}>
                      {item.previewUrl !== null
                        ? <img className={css.wallpaperThumb} src={item.previewUrl} alt="" loading="lazy" />
                        : item.videoUrl !== null
                          // No preview image (bare .mp4 without project.json):
                          // the video element's first frame is the cover.
                          ? <video className={css.wallpaperThumb} src={item.videoUrl} preload="metadata" muted playsInline aria-hidden="true" />
                          : <div className={css.wallpaperThumbEmpty} aria-hidden="true" />}
                      <span className={css.wallpaperType}>{t(typeKey(item))}</span>
                      {isMounted && (
                        <span className={css.badge + ' ' + (trying ? css.badgeTrying : css.badgeActive)}>
                          {trying ? t('tryingOn') : t('active')}
                        </span>
                      )}
                    </div>
                    <div className={css.wallpaperName} title={item.title}>{item.title}</div>
                    <div className={css.wallpaperActions}>
                      {isMounted && trying ? (
                        <button type="button" className={css.button + ' ' + css.buttonPrimary} onClick={() => { wallpaper.exitTryOn() }}>
                          {t('exitTryOn')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={css.button + ' ' + css.buttonPrimary}
                          disabled={!renderable(item) || (isMounted && isApplied) || busy}
                          onClick={() => { wallpaper.tryOn(descriptorOf(item)) }}
                        >
                          {t('tryOn')}
                        </button>
                      )}
                      <button
                        type="button"
                        className={css.button}
                        disabled={!renderable(item) || isApplied || busy}
                        onClick={() => { wallpaper.applySelection(descriptorOf(item)) }}
                      >
                        {isApplied ? t('active') : t('apply')}
                      </button>
                      {item.source === 'imported' ? (
                        <>
                          {item.updateAvailable && (
                            <button
                              type="button"
                              className={css.button}
                              disabled={busy}
                              title={t('wallpaperUpdateAvailable')}
                              onClick={() => { runAction(item.id, '/reimport') }}
                            >
                              {busy ? t('loading') : t('wallpaperReimport')}
                            </button>
                          )}
                          <button
                            type="button"
                            className={css.button + ' ' + css.buttonGhost}
                            disabled={busy}
                            onClick={() => {
                              runAction(item.id, '/remove', () => {
                                if (wallpaper.selection() === item.id) wallpaper.clearSelection()
                              })
                            }}
                          >
                            {t('wallpaperRemove')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={css.button}
                          disabled={busy}
                          title={t('wallpaperImportHint')}
                          onClick={() => { runAction(item.id, '/import') }}
                        >
                          {busy ? t('loading') : t('wallpaperImport')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {items !== null && items.length === 0 && loadError === null && (
            <p className={css.backgroundHintMuted}>{t('wallpaperEmpty')}</p>
          )}
          <p className={css.backgroundHintMuted}>{t('wallpaperLegal')}</p>
        </>
      )}
    </div>
  )
}
