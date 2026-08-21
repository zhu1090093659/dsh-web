/**
 * Sidebar footer entry for the session-id plugin: the trigger beside the
 * sidebar settings seat (wide row / rail icon) that opens the session-id
 * panel. Registered into the official `sidebar.footer.action` list slot
 * (declared by ui-sidebar, same seat dsh-remote-web-ui shares).
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionIdPanel, type SessionListReadSource } from './SessionIdPanel.tsx'
import { SESSION_ID_PART_ENTRY, SESSION_ID_PLUGIN_ATTR } from './semantic.ts'
import { SessionIdIcon } from './icons.tsx'
import css from './session-id.module.css'

/** Entry props: the footer seat's column state + injected list source + locale seat. */
export type SessionIdEntryProps = PropsLocale<'session-id'> & {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
  /** The sessions-list read face (ctx.sessions.list wrapped by the plugin). */
  list: SessionListReadSource
}

/**
 * Render the session-id seat trigger and panel.
 * @param props - composed slot props.
 * @returns the trigger and, when open, the panel portal.
 */
export function SessionIdEntry({ wide, list, t }: SessionIdEntryProps) {
  const [open, setOpen] = useState(false)

  const trigger = (
    <button
      type="button"
      className={css.trigger}
      data-dsh-plugin={SESSION_ID_PLUGIN_ATTR}
      data-dsh-part={SESSION_ID_PART_ENTRY}
      data-wide={wide ? 'wide' : 'rail'}
      aria-label={t('entry.label')}
      title={t('entry.label')}
      onClick={() => { setOpen(true) }}
    >
      <SessionIdIcon />
      <span className={css.triggerLabel}>{t('entry.label')}</span>
    </button>
  )

  return (
    <>
      {trigger}
      {open && createPortal(
        <SessionIdPanel list={list} onClose={() => { setOpen(false) }} t={t} />,
        document.body,
      )}
    </>
  )
}
