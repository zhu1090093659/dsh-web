/** Managed local private-key references: CRUD without reading key contents. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SshApi } from '../api.ts'
import type { SshKeyPayload, SshKeySummary } from '../../protocol.ts'
import { errorMessage, tt } from './helpers.ts'
import css from './panel.module.css'

interface KeysTabProps {
  api: SshApi
  /** Confirmation seam for host-reference warnings; defaults to window.confirm. */
  confirmAction?: (message: string) => boolean
}

type KeyDialog = { mode: 'create' } | { mode: 'edit'; key: SshKeySummary }

function KeyFormDialog(props: {
  api: SshApi
  editing?: SshKeySummary
  onClose: () => void
  onSaved: () => void
  confirmAction: (message: string) => boolean
}) {
  const { api, editing, onClose, onSaved, confirmAction } = props
  const [name, setName] = useState(editing?.name ?? '')
  const [path, setPath] = useState(editing?.path ?? '')
  const [passphrase, setPassphrase] = useState('')
  const [clearPassphrase, setClearPassphrase] = useState(false)
  const [note, setNote] = useState(editing?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const save = async (): Promise<void> => {
    if (name.trim() === '' || path.trim() === '') {
      setError(tt('keys.required'))
      return
    }
    if (editing !== undefined && editing.usedBy.length > 0) {
      const confirmed = confirmAction(tt('keys.editConfirm', {
        count: editing.usedBy.length,
        hosts: editing.usedBy.join(', '),
      }))
      if (!confirmed) return
    }
    const payload: SshKeyPayload = {
      name: name.trim(),
      path: path.trim(),
      note,
      ...(passphrase !== '' ? { passphrase }
        : editing !== undefined && clearPassphrase ? { passphrase: null }
          : {}),
    }
    setSaving(true)
    setError(null)
    try {
      if (editing === undefined) await api.createKey(payload)
      else await api.updateKey(editing.id, payload)
      onSaved()
    } catch (cause) {
      setError(errorMessage(cause))
      setSaving(false)
    }
  }

  return (
    <div className={css.modalBackdrop} onClick={onClose}>
      <div className={css.modal} role="dialog" aria-modal="true" aria-label={editing === undefined ? tt('keys.form.create') : tt('keys.form.edit', { name: editing.name })} onClick={event => { event.stopPropagation() }}>
        <h3 className={css.modalTitle}>{editing === undefined ? tt('keys.form.create') : tt('keys.form.edit', { name: editing.name })}</h3>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('keys.name')}</span>
          <input className={css.input} value={name} onChange={event => { setName(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('form.keyPath')}</span>
          <input className={css.input} value={path} onChange={event => { setPath(event.target.value) }} />
          <span className={css.hint}>{tt('keys.pathHint')}</span>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('form.passphrase')}</span>
          <input className={css.input} type="password" value={passphrase} disabled={clearPassphrase} onChange={event => { setPassphrase(event.target.value) }} />
          <span className={css.hint}>{tt('keys.passphraseHint')}</span>
        </label>
        {editing?.hasPassphrase === true && (
          <label className={css.radioLabel}>
            <input type="checkbox" checked={clearPassphrase} onChange={event => {
              const checked = event.target.checked
              setClearPassphrase(checked)
              if (checked) setPassphrase('')
            }} />
            {tt('keys.clearPassphrase')}
          </label>
        )}
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('form.description')}</span>
          <input className={css.input} value={note} onChange={event => { setNote(event.target.value) }} />
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

export function KeysTab({ api, confirmAction }: KeysTabProps) {
  const ask = confirmAction ?? ((message: string): boolean => window.confirm(message))
  const [keys, setKeys] = useState<SshKeySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<KeyDialog | null>(null)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const load = useCallback(async (): Promise<void> => {
    try {
      const list = await api.listKeys()
      if (!mounted.current) return
      setKeys(list)
      setError(null)
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause))
    }
  }, [api])
  useEffect(() => { void load() }, [load])

  const remove = async (key: SshKeySummary): Promise<void> => {
    const message = key.usedBy.length === 0
      ? tt('keys.deleteConfirmUnused', { name: key.name })
      : tt('keys.deleteConfirm', { name: key.name, count: key.usedBy.length, hosts: key.usedBy.join(', ') })
    if (!ask(message)) return
    try {
      await api.deleteKey(key.id)
      await load()
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause))
    }
  }

  return (
    <div className={css.fillBody}>
      <div className={css.toolbar}>
        <div className={css.toolbarSpacer} />
        <button type="button" className={css.primaryButton} onClick={() => { setDialog({ mode: 'create' }) }}>{tt('keys.add')}</button>
      </div>
      {error !== null && <div className={css.banner} data-kind="error">{tt('common.error', { error })}</div>}
      {keys === null && error === null && <div className={css.loading}>{tt('common.loading')}</div>}
      {keys !== null && keys.length === 0 && <div className={css.empty}>{tt('keys.empty')}</div>}
      {keys !== null && keys.length > 0 && (
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead><tr>
              <th>{tt('keys.col.name')}</th>
              <th>{tt('form.keyPath')}</th>
              <th>{tt('keys.col.status')}</th>
              <th>{tt('keys.col.usedBy')}</th>
              <th>{tt('hosts.col.description')}</th>
              <th>{tt('hosts.col.actions')}</th>
            </tr></thead>
            <tbody>{keys.map(key => (
              <tr key={key.id}>
                <td>{key.name}</td>
                <td className={css.mono}>{key.path}</td>
                <td><span className={css.badge} data-status={key.exists ? 'ok' : 'fail'}>{key.exists ? tt('keys.exists') : tt('keys.missing')}</span></td>
                <td>{key.usedBy.length === 0 ? tt('keys.unused') : tt('keys.usedBy', { count: key.usedBy.length, hosts: key.usedBy.join(', ') })}</td>
                <td className={css.cellMuted}>{key.note ?? ''}</td>
                <td><div className={css.actions}>
                  <button type="button" className={css.linkButton} onClick={() => { setDialog({ mode: 'edit', key }) }}>{tt('hosts.edit')}</button>
                  <button type="button" className={css.linkButton} data-danger onClick={() => { void remove(key) }}>{tt('hosts.delete')}</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {dialog !== null && (
        <KeyFormDialog
          api={api}
          editing={dialog.mode === 'edit' ? dialog.key : undefined}
          onClose={() => { setDialog(null) }}
          onSaved={() => { setDialog(null); void load() }}
          confirmAction={ask}
        />
      )}
    </div>
  )
}
