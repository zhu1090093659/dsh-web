/**
 * Import tab: batch-create skills from a local directory or a .zip archive.
 *
 * Both forms end at the same host route. The directory form names a path on
 * the host, which is meaningful because the route is loopback-only (browser and
 * host are the same machine by construction); the archive form carries the
 * bytes the browser read, so the user picks the file through the ordinary file
 * dialog. Nothing is overwritten: every outcome the host reports says either
 * that one SKILL.md was created or why that candidate was skipped.
 *
 * The tab unmounts whenever another tab or panel takes the center column, so
 * the workspace it needs is resolved with one list call on the first import
 * (the same lazy pattern the create tab uses) instead of being held here.
 */
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { SkillApi, type ImportOutcome, type ImportReport, type ImportSourceRequest } from '../api.ts'
import { bytesToBase64, MAX_IMPORT_ARCHIVE_BYTES } from '../import-source.ts'
import { tt } from '../panel-helpers.ts'
import css from './panel.module.css'

/** How the user supplies the skills to import. */
type ImportMode = 'directory' | 'archive'

/** Human-readable size, for the archive cap message. */
function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`
}

/** Localized skip reason with a fallback for an outcome that carries none. */
function reasonLabel(outcome: ImportOutcome): string {
  if (outcome.status === 'imported') return tt('import.imported')
  const reason = outcome.reason
  return reason === undefined ? tt('import.reason.unknown') : tt(`import.reason.${reason}`)
}

/** The import tab body. */
export function ImportTab({ api }: { api: SkillApi }): React.JSX.Element {
  const [root, setRoot] = useState<'user' | 'agents' | 'project'>('user')
  const [mode, setMode] = useState<ImportMode>('directory')
  const [dir, setDir] = useState('')
  const [archive, setArchive] = useState<{ name: string; data: string } | undefined>(undefined)
  const [cwd, setCwd] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ImportReport | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  // Sync guard: reading a large archive is async, so a double submit would
  // otherwise start two identical imports before the button re-renders.
  const busyRef = useRef(false)

  const chooseArchive = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    setReport(undefined)
    if (file === undefined) {
      setArchive(undefined)
      return
    }
    if (file.size > MAX_IMPORT_ARCHIVE_BYTES) {
      setArchive(undefined)
      setError(tt('import.archiveTooLarge', { size: megabytes(MAX_IMPORT_ARCHIVE_BYTES) }))
      return
    }
    setError(undefined)
    try {
      setArchive({ name: file.name, data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) })
    } catch (err) {
      setArchive(undefined)
      setError(tt('import.failed', { error: err instanceof Error ? err.message : String(err) }))
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busyRef.current) return
    let source: ImportSourceRequest
    if (mode === 'directory') {
      if (dir.trim() === '') {
        setError(tt('import.directoryRequired'))
        return
      }
      source = { kind: 'directory', path: dir.trim() }
    } else {
      if (archive === undefined) {
        setError(tt('import.archiveRequired'))
        return
      }
      source = { kind: 'archive', data: archive.data }
    }
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    setReport(undefined)
    try {
      const workspace = cwd ?? (await api.list()).cwd
      setCwd(workspace)
      setReport(await api.importSkills({ root, cwd: workspace, source }))
    } catch (err) {
      setError(tt('import.failed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className={css.tabBody}>
      <form className={css.form} onSubmit={(event) => { void submit(event) }}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{tt('import.root')}</span>
          <select className={css.select} value={root} onChange={(event) => { setRoot(event.target.value as 'user' | 'agents' | 'project') }}>
            <option value="user">{tt('create.root.user')}</option>
            <option value="agents">{tt('create.root.agents')}</option>
            <option value="project">{tt('create.root.project')}</option>
          </select>
        </label>
        <fieldset className={css.fieldGroup}>
          <legend className={css.fieldLabel}>{tt('import.source')}</legend>
          <div className={css.radioRow}>
            <label className={css.checkboxLabel}>
              <input type="radio" name="import-mode" checked={mode === 'directory'} onChange={() => { setMode('directory') }} />
              {tt('import.source.directory')}
            </label>
            <label className={css.checkboxLabel}>
              <input type="radio" name="import-mode" checked={mode === 'archive'} onChange={() => { setMode('archive') }} />
              {tt('import.source.archive')}
            </label>
          </div>
        </fieldset>
        {mode === 'directory'
          ? (
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('import.directoryLabel')}</span>
              <input
                className={css.input}
                value={dir}
                spellCheck={false}
                placeholder={tt('import.directoryPlaceholder')}
                onChange={(event) => { setDir(event.target.value) }}
              />
            </label>
          )
          : (
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('import.archiveLabel')}</span>
              <input
                type="file"
                accept=".zip,application/zip"
                aria-label={tt('import.archiveLabel')}
                onChange={(event) => { void chooseArchive(event) }}
              />
              {archive !== undefined && <span className={css.note}>{archive.name}</span>}
            </label>
          )}
        <button type="submit" className={css.primaryButton} disabled={busy}>{tt('import.submit')}</button>
        {error !== undefined && <p className={css.banner} data-kind="error">{error}</p>}
        {report !== undefined && (
          <div data-dsh-part="import-report">
            <p className={css.banner} data-kind={report.imported > 0 ? 'ok' : undefined}>
              {tt('import.summary', { imported: report.imported, skipped: report.skipped })}
            </p>
            {report.outcomes.length > 0 && (
              <ul className={css.outcomeList}>
                {report.outcomes.map(outcome => (
                  <li key={outcome.origin} className={css.outcomeItem} data-status={outcome.status}>
                    <span className={css.outcomeName}>{outcome.name}</span>
                    <span className={css.outcomeReason}>{reasonLabel(outcome)}</span>
                    <span className={css.skillPath}>{outcome.origin}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className={css.note}>{tt('import.note')}</p>
      </form>
    </div>
  )
}
