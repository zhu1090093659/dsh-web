/**
 * The preview tab strip: 36px bar, tabs capped at 180px (padding 0 10, gap 6,
 * 12px title), dirty dot (6px, primary), close glyph (16px box, 12px icon),
 * middle-click close, right-click menu (close left/right/others/all), the
 * 32px left/right overflow fade indicators (ResizeObserver + scroll), the
 * new-URL-tab plus, and the panel collapse button.
 * @module dsh-aionui-panel/client/preview/PreviewTabs
 */

import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { PreviewTabState } from '../store.ts'
import { t } from '../locales.ts'
import { CloseIcon, PlusIcon, ShrinkIcon } from '../components/icons.tsx'
import { activateOnKey } from '../components/a11y.ts'
import previewCss from '../styles/preview.module.css'

/** Tab width cap (AionUi measured). */
export const MAX_TAB_WIDTH_PX = 180
/** Fade indicator width. */
const FADE_WIDTH = 32

/** Left/right overflow state. */
export interface TabFadeState {
  left: boolean
  right: boolean
}

/** The tab strip. */
export function PreviewTabs({
  tabs,
  activeTabId,
  onSwitch,
  onClose,
  onContextMenu,
  onNewUrlTab,
  onClosePanel,
}: {
  tabs: PreviewTabState[]
  activeTabId: string | null
  onSwitch: (id: string) => void
  onClose: (id: string) => void
  onContextMenu: (event: React.MouseEvent, tab: PreviewTabState) => void
  onNewUrlTab: () => void
  onClosePanel: () => void
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<TabFadeState>({ left: false, right: false })

  // Overflow fades: ResizeObserver + scroll listener, setState only on change.
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const update = (): void => {
      const next = {
        left: el.scrollLeft > 1,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      }
      setFade((prev) => (prev.left === next.left && prev.right === next.right ? prev : next))
    }
    const observer = new ResizeObserver(update)
    observer.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [tabs.length])

  return (
    <div className={previewCss.tabBar}>
      <div ref={scrollRef} className={previewCss.tabScroll}>
        {tabs.length === 0 && <div className={previewCss.noTabs}>{t('preview.noTabs')}</div>}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`${previewCss.tab}${tab.id === activeTabId ? ` ${previewCss.tabActive}` : ` ${previewCss.tabInactive}`}`}
            style={{ maxWidth: MAX_TAB_WIDTH_PX }}
            role="button"
            tabIndex={0}
            title={tab.path}
            aria-label={tab.title}
            onClick={() => onSwitch(tab.id)}
            onKeyDown={activateOnKey(() => { onSwitch(tab.id) })}
            onContextMenu={(event) => onContextMenu(event, tab)}
            onAuxClick={(event) => {
              if (event.button !== 1) return
              event.preventDefault()
              event.stopPropagation()
              onClose(tab.id)
            }}
          >
            <span className={previewCss.tabTitle} title={tab.path}>{tab.title}</span>
            {tab.dirty && <span className={previewCss.tabDotDirty} title={t('preview.dirty')} />}
            <span
              className={previewCss.tabClose}
              role="button"
              tabIndex={0}
              title={t('common.close')}
              aria-label={t('common.close')}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.id)
              }}
              onKeyDown={activateOnKey(() => { onClose(tab.id) })}
            >
              <CloseIcon size={12} />
            </span>
          </div>
        ))}
        <div
          className={previewCss.tabPlus}
          role="button"
          tabIndex={0}
          onClick={onNewUrlTab}
          onKeyDown={activateOnKey(onNewUrlTab)}
          title={t('preview.newUrlTab')}
        >
          <PlusIcon size={14} />
        </div>
      </div>
      <div className={previewCss.tabBarRight}>
        <div
          className={previewCss.panelCollapse}
          role="button"
          tabIndex={0}
          onClick={onClosePanel}
          onKeyDown={activateOnKey(onClosePanel)}
          title={t('preview.collapsePanel')}
          aria-label={t('preview.collapsePanel')}
        >
          <ShrinkIcon size={14} />
        </div>
      </div>
      {fade.left && <div className={previewCss.tabFadeLeft} style={{ width: FADE_WIDTH }} />}
      {fade.right && <div className={previewCss.tabFadeRight} style={{ width: FADE_WIDTH }} />}
    </div>
  )
}
