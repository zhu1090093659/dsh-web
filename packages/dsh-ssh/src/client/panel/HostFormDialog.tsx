/**
 * Host form dialog: create/edit one stored host entry. A fixed backdrop with
 * a centered card; Escape and backdrop clicks close it. Secrets (key path,
 * passphrase, password) are never pre-filled when editing (the API only
 * exposes the secret-free summary).
 */
import { useEffect, useState } from 'react'
import type { SshApi } from '../api.ts'
import type { HostPayload, SshAuthKind, SshHostSummary } from '../../protocol.ts'
import { errorMessage, tt } from './helpers.ts'
import css from './panel.module.css'

/** Host form dialog props. */
export interface HostFormDialogProps {
  api: SshApi
  /** The host being edited; null/undefined means create. */
  editing?: SshHostSummary | null
  onClose: () => void
  onSaved: (host: SshHostSummary) => void
}

/** The staged form values (all strings; parsed on save). */
interface FormState {
  alias: string
  host: string
  port: string
  user: string
  authKind: SshAuthKind
  keyPath: string
  passphrase: string
  password: string
  agentPath: string
  proxyJump: string
  description: string
  environment: string
  tags: string
  location: string
}

/** Split a comma-separated input into a trimmed, non-empty string list. */
function splitList(text: string): string[] {
  return text.split(',').map(part => part.trim()).filter(part => part !== '')
}

/** Initial form state: the summary's public fields plus empty secrets. */
function blankOf(editing: SshHostSummary | null | undefined): FormState {
  return {
    alias: editing?.alias ?? '',
    host: editing?.host ?? '',
    port: String(editing?.port ?? 22),
    user: editing?.user ?? '',
    authKind: editing?.auth ?? 'key',
    keyPath: '',
    passphrase: '',
    password: '',
    agentPath: '',
    proxyJump: (editing?.proxyJump ?? []).join(', '),
    description: editing?.description ?? '',
    environment: editing?.environment ?? '',
    tags: (editing?.tags ?? []).join(', '),
    location: editing?.location ?? '',
  }
}

/** The create/edit host modal. */
export function HostFormDialog({ api, editing, onClose, onSaved }: HostFormDialogProps) {
  const [form, setForm] = useState<FormState>(() => blankOf(editing))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Escape closes the dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const save = async (): Promise<void> => {
    const alias = form.alias.trim()
    const host = form.host.trim()
    const user = form.user.trim()
    if (alias === '' || host === '' || user === '') {
      setError(tt('form.required'))
      return
    }
    const port = Number(form.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(tt('form.portInvalid'))
      return
    }
    // A password-auth host needs a password on create; when editing, a blank
    // secret field preserves the stored credential instead.
    if (editing == null && form.authKind === 'password' && form.password === '') {
      setError(tt('form.passwordRequired'))
      return
    }
    // Secrets are never echoed back by the API: when editing and the secret
    // fields are left empty, the auth block is omitted so the stored
    // authentication is preserved.
    const secretEmpty = form.authKind === 'password'
      ? form.password === ''
      : form.authKind === 'key'
        ? form.keyPath.trim() === ''
        : form.agentPath.trim() === ''
    const auth: HostPayload['auth'] = editing != null && secretEmpty
      ? undefined
      : form.authKind === 'password'
        ? { kind: 'password', password: form.password }
        : form.authKind === 'key'
          ? { kind: 'key', keyPath: form.keyPath.trim(), passphrase: form.passphrase === '' ? undefined : form.passphrase }
          : { kind: 'agent', agentPath: form.agentPath.trim() === '' ? undefined : form.agentPath.trim() }
    const payload: HostPayload = {
      host,
      port,
      user,
      auth,
      proxyJump: splitList(form.proxyJump),
      description: form.description.trim() === '' ? undefined : form.description.trim(),
      environment: form.environment.trim() === '' ? undefined : form.environment.trim(),
      tags: splitList(form.tags),
      location: form.location.trim() === '' ? undefined : form.location.trim(),
    }
    setSaving(true)
    setError(null)
    try {
      const saved = editing != null
        ? await api.updateHost(editing.alias, payload)
        : await api.createHost({ ...payload, alias })
      onSaved(saved)
    } catch (cause) {
      setError(errorMessage(cause))
      setSaving(false)
    }
  }

  return (
    <div className={css.modalBackdrop} onClick={onClose}>
      <div className={css.modal} role="dialog" aria-modal="true" onClick={event => { event.stopPropagation() }}>
        <h3 className={css.modalTitle}>{editing != null ? tt('form.title.edit', { alias: editing.alias }) : tt('form.title.create')}</h3>
        <div className={css.formRow}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('form.alias')}</span>
            <input className={css.input} value={form.alias} disabled={editing != null} onChange={event => { set('alias', event.target.value) }} />
            <span className={css.hint}>{tt('form.aliasHint')}</span>
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('form.host')}</span>
            <input className={css.input} value={form.host} onChange={event => { set('host', event.target.value) }} />
          </label>
        </div>
        <div className={css.formRow}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('form.port')}</span>
            <input className={css.input} type="number" min={1} max={65535} value={form.port} onChange={event => { set('port', event.target.value) }} />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('form.user')}</span>
            <input className={css.input} value={form.user} onChange={event => { set('user', event.target.value) }} />
          </label>
        </div>
        <div className={css.field}>
          <span className={css.fieldLabel}>{tt('form.auth')}</span>
          <div className={css.radioRow}>
            <label className={css.radioLabel}>
              <input type="radio" name="dsh-ssh-auth" checked={form.authKind === 'key'} onChange={() => { set('authKind', 'key') }} />
              {tt('form.auth.key')}
            </label>
            <label className={css.radioLabel}>
              <input type="radio" name="dsh-ssh-auth" checked={form.authKind === 'password'} onChange={() => { set('authKind', 'password') }} />
              {tt('form.auth.password')}
            </label>
            <label className={css.radioLabel}>
              <input type="radio" name="dsh-ssh-auth" checked={form.authKind === 'agent'} onChange={() => { set('authKind', 'agent') }} />
              {tt('form.auth.agent')}
            </label>
          </div>
          {editing != null && <span className={css.hint}>{tt('form.authKeepHint')}</span>}
        </div>
        {form.authKind === 'key' ? (
          <div className={css.formRow}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('form.keyPath')}</span>
              <input className={css.input} value={form.keyPath} onChange={event => { set('keyPath', event.target.value) }} />
              <span className={css.hint}>{tt('form.keyPathHint')}</span>
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('form.passphrase')}</span>
              <input className={css.input} type="password" value={form.passphrase} onChange={event => { set('passphrase', event.target.value) }} />
            </label>
          </div>
        ) : form.authKind === 'agent' ? (
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('form.agentPath')}</span>
            <input className={css.input} value={form.agentPath} onChange={event => { set('agentPath', event.target.value) }} />
            <span className={css.hint}>{tt('form.agentPathHint')}</span>
          </label>
        ) : (
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('form.password')}</span>
            <input className={css.input} type="password" value={form.password} onChange={event => { set('password', event.target.value) }} />
            <span className={css.hint}>{tt('form.passwordHint')}</span>
          </label>
        )}
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('form.proxyJump')}</span>
          <input className={css.input} value={form.proxyJump} onChange={event => { set('proxyJump', event.target.value) }} />
          <span className={css.hint}>{tt('form.proxyJumpHint')}</span>
        </label>
        <div className={css.formRow}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('form.environment')}</span>
            <input className={css.input} value={form.environment} onChange={event => { set('environment', event.target.value) }} />
            <span className={css.hint}>{tt('form.environmentHint')}</span>
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('form.location')}</span>
            <input className={css.input} value={form.location} onChange={event => { set('location', event.target.value) }} />
          </label>
        </div>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('form.description')}</span>
          <input className={css.input} value={form.description} onChange={event => { set('description', event.target.value) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('form.tags')}</span>
          <input className={css.input} value={form.tags} onChange={event => { set('tags', event.target.value) }} />
          <span className={css.hint}>{tt('form.tagsHint')}</span>
        </label>
        {error !== null && <p className={css.formError}>{tt('common.error', { error })}</p>}
        <div className={css.modalFooter}>
          <button type="button" className={css.ghostButton} disabled={saving} onClick={onClose}>{tt('form.cancel')}</button>
          <button type="button" className={css.primaryButton} disabled={saving} onClick={() => { void save() }}>{tt('form.save')}</button>
        </div>
      </div>
    </div>
  )
}
