/**
 * Minimal overlay primitives for the panel: a toast and a context menu,
 * rendered through plain DOM + portals so they can live outside the grid
 * columns (fixed positioning, high z-index).
 * @module dsh-aionui-panel/client/components/overlay
 */

import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { t } from '../locales.ts'
import type { AionUiPanelKey } from '../locales.ts'

/** One transient toast message. */
let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(message: string): void {
  const el = document.createElement('div')
  el.className = 'aionui-toast'
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transition = 'opacity 0.2s ease'
  }, 1800)
  setTimeout(() => el.remove(), 2100)
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  toastTimer = undefined
}

/** One context-menu entry. */
export interface MenuEntry {
  key: string
  label: string
  disabled?: boolean
  danger?: boolean
  onSelect: () => void
}

export interface MenuState {
  x: number
  y: number
  entries: MenuEntry[]
}

/** The shared context-menu portal host (one at a time). */
export function ContextMenu({ state, onClose }: { state: MenuState | null; onClose: () => void }): JSX.Element | null {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    if (state === null) {
      setPosition(null)
      return
    }
    // Keep the menu inside the viewport.
    const width = 180
    const height = state.entries.length * 28 + 12
    setPosition({
      x: Math.min(state.x, window.innerWidth - width - 8),
      y: Math.min(state.y, window.innerHeight - height - 8),
    })
  }, [state])

  useEffect(() => {
    if (state === null) return
    const close = (event: Event): void => {
      // A pointerdown inside the menu must not close it — the menu item's own
      // onClick still needs to run (and microtask-less onClose before onSelect
      // would unmount the item mid-click). Only close on outside clicks.
      if (event.target instanceof Element && event.target.closest('[data-menu-root]') !== null) return
      onClose()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', close, { capture: true })
    window.addEventListener('blur', onClose)
    window.addEventListener('keydown', key)
    window.addEventListener('contextmenu', onClose)
    return () => {
      window.removeEventListener('pointerdown', close, { capture: true })
      window.removeEventListener('blur', onClose)
      window.removeEventListener('keydown', key)
      window.removeEventListener('contextmenu', onClose)
    }
  }, [state, onClose])

  if (state === null || position === null) return null
  return createPortal(
    <div
      className="aionui-menu"
      data-menu-root=""
      style={{ left: position.x, top: position.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {state.entries.map((entry) => (
        <div key={entry.key}>
          {entry.label === '---' ? (
            <div className="aionui-menu-sep" />
          ) : (
            <div
              className={`aionui-menu-item${entry.disabled === true ? ' aionui-menu-item-disabled' : ''}`}
              onClick={() => {
                if (entry.disabled === true) return
                onClose()
                entry.onSelect()
              }}
              role="menuitem"
            >
              {entry.label}
            </div>
          )}
        </div>
      ))}
    </div>,
    document.body,
  )
}

/** A confirmation dialog (dirty-close confirm, discard confirm, format preview). */
export function ConfirmDialog({
  title,
  body,
  bodyPre,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  /** Optional preformatted monospace body (rendered instead of `body`). */
  bodyPre?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onCancel])
  return createPortal(
    <div className="aionui-overlay" onPointerDown={onCancel}>
      <div className="aionui-dialog aionui-dialog-wide" onPointerDown={(event) => event.stopPropagation()}>
        <div className="aionui-dialog-title">{title}</div>
        {body !== '' && <div className="aionui-dialog-body">{body}</div>}
        {bodyPre !== undefined && <pre className="aionui-dialog-pre">{bodyPre}</pre>}
        <div className="aionui-dialog-actions">
          <button type="button" className="aionui-btn" onClick={onCancel}>{t('common.cancel')}</button>
          <button
            type="button"
            className={`aionui-btn ${danger === true ? 'aionui-btn-danger' : 'aionui-btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
