import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './gateway-settings.module.css'

interface GatewaySettings { enabled: boolean; port: number; sessionTtlHours: number }
interface ConfigResponse { ok: boolean; value?: Partial<GatewaySettings>; writable?: boolean; error?: string }
type Props = PropsRuntime<'web-ui.plugin.item'> & PropsLocale<'web-auth-gateway'>
const defaults: GatewaySettings = { enabled: true, port: 3090, sessionTtlHours: 12 }

export function GatewaySettingsCard({ t }: Props) {
  const [value, setValue] = useState(defaults)
  const [saved, setSaved] = useState(defaults)
  const [writable, setWritable] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [error, setError] = useState('')
  useEffect(() => {
    void fetch('/api/web-auth-gateway/config', { credentials: 'same-origin' })
      .then(async response => await response.json() as ConfigResponse)
      .then(result => {
        if (!result.ok || result.value === undefined) throw new Error(result.error ?? 'load-failed')
        const next = { ...defaults, ...result.value }
        setValue(next); setSaved(next); setWritable(result.writable === true); setState('ready')
      })
      .catch(reason => { setError(reason instanceof Error ? reason.message : 'load-failed'); setState('error') })
  }, [])
  const dirty = JSON.stringify(value) !== JSON.stringify(saved)
  const save = async () => {
    setState('saving'); setError('')
    try {
      const response = await fetch('/api/web-auth-gateway/config', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
      })
      const result = await response.json() as ConfigResponse
      if (!response.ok || !result.ok) throw new Error(result.error ?? 'save-failed')
      const next = { ...defaults, ...result.value }; setValue(next); setSaved(next); setState('ready')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'save-failed'); setState('error') }
  }
  return <section className={styles.card}>
    <div className={styles.row}><div><strong>{t('settings.enabled')}</strong><p>{t('settings.enabledHint')}</p></div><input aria-label={t('settings.enabled')} type="checkbox" checked={value.enabled} disabled={!writable || state === 'loading'} onChange={event => setValue(current => ({ ...current, enabled: event.target.checked }))} /></div>
    <label className={styles.field}><span>{t('settings.port')}</span><small>{t('settings.portHint')}</small><input type="number" min="1" max="65535" value={value.port} disabled={!writable || state === 'loading'} onChange={event => setValue(current => ({ ...current, port: Number(event.target.value) }))} /></label>
    <label className={styles.field}><span>{t('settings.ttl')}</span><small>{t('settings.ttlHint')}</small><input type="number" min="1" max="720" value={value.sessionTtlHours} disabled={!writable || state === 'loading'} onChange={event => setValue(current => ({ ...current, sessionTtlHours: Number(event.target.value) }))} /></label>
    {state === 'error' && <p className={styles.error}>{t('settings.saveFailed')}: {error}</p>}
    <div className={styles.actions}><button disabled={!dirty || state === 'saving'} onClick={() => setValue(saved)}>{t('settings.discard')}</button><button className={styles.primary} disabled={!writable || !dirty || state === 'saving'} onClick={() => void save()}>{state === 'saving' ? t('settings.saving') : t('settings.save')}</button></div>
  </section>
}
