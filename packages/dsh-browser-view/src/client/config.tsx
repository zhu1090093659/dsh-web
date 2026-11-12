import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { BROWSER_VIEW_PLUGIN } from './semantic.ts'
import css from './config.module.css'

/** Configuration-seat keys for standalone and aggregate bundle rows. */
export const BROWSER_VIEW_CONFIG_KEYS = [
  '@linxin666/dsh-client-ui-browser-view#ui-browser-view',
  '@linxin666/dsh-client-ui-browser-view#web-ui-browser-view',
] as const

interface BrowserConfigValues {
  realBrowserEnabled?: unknown
  cdpEndpoint?: unknown
  idleCloseDays?: unknown
}

/** The row configuration form backed by the Host's volatile settings namespace. */
export function BrowserViewConfig({ t, view, form }: PropsLocale<'browser-view'> & PluginConfigViewProps) {
  const values = form?.state.value as BrowserConfigValues | undefined
  const enabled = values?.realBrowserEnabled === true
  const endpoint = typeof values?.cdpEndpoint === 'string' && values.cdpEndpoint.length > 0
    ? values.cdpEndpoint
    : 'http://127.0.0.1:9222'
  const idleDays = typeof values?.idleCloseDays === 'number' ? values.idleCloseDays : 3
  const [draft, setDraft] = useState(endpoint)
  const [idleDraft, setIdleDraft] = useState(String(idleDays))
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setDraft(endpoint) }, [endpoint])
  useEffect(() => { setIdleDraft(String(idleDays)) }, [idleDays])
  if (view === 'summary') return t('config.summary')
  if (form === undefined || form.state.status !== 'ready') {
    return <p className={css.hint}>{t('config.unavailable')}</p>
  }
  const disabled = pending || !form.state.writable
  const mutate = async (ops: Parameters<typeof form.mutate>[0]): Promise<void> => {
    setPending(true)
    setFailed(false)
    try {
      const accepted = await form.mutate(ops, form.state.revision)
      if (!accepted) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }
  const commitEndpoint = async (): Promise<void> => {
    const next = draft.trim()
    if (next === endpoint || next === '') return
    await mutate([{ op: 'set', path: ['cdpEndpoint'], value: next }])
  }
  const commitIdleDays = async (): Promise<void> => {
    const next = Number(idleDraft.trim())
    if (!Number.isInteger(next) || next < 0 || next === idleDays) return
    await mutate([{ op: 'set', path: ['idleCloseDays'], value: next }])
  }
  return (
    <section className={css.root} data-dsh-plugin={BROWSER_VIEW_PLUGIN} aria-busy={pending}>
      <label className={css.switchRow}>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => {
            void mutate([{ op: 'set', path: ['realBrowserEnabled'], value: event.currentTarget.checked }])
          }}
        />
        <span>{t('config.realBrowserEnabled')}</span>
      </label>
      <p className={css.hint}>{t('config.realBrowserEnabled.hint')}</p>
      <label className={css.field}>
        <span>{t('config.cdpEndpoint')}</span>
        <input
          type="text"
          value={draft}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => { setDraft(event.currentTarget.value) }}
          onBlur={() => { void commitEndpoint() }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
        />
      </label>
      <p className={css.hint}>{t('config.cdpEndpoint.hint')}</p>
      <label className={css.field}>
        <span>{t('config.idleCloseDays')}</span>
        <input
          type="text"
          inputMode="numeric"
          value={idleDraft}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => { setIdleDraft(event.currentTarget.value) }}
          onBlur={() => { void commitIdleDays() }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
        />
      </label>
      <p className={css.hint}>{t('config.idleCloseDays.hint')}</p>
      {failed && <p className={css.error} role="alert">{t('config.failed')}</p>}
    </section>
  )
}
