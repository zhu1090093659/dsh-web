/**
 * Hosts tab: the host table with search (debounced through listHosts),
 * add/edit/delete/test actions, ~/.ssh/config import, and a connect action
 * that hands the alias to the terminal tab via onConnect.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SshApi } from '../api.ts'
import type { SshHostSummary, TestResult } from '../../protocol.ts'
import { errorMessage, tt } from './helpers.ts'
import { HostFormDialog } from './HostFormDialog.tsx'
import css from './panel.module.css'

/** Hosts tab props. */
export interface HostsTabProps {
  api: SshApi
  /** Connect the given alias in the terminal tab. */
  onConnect: (alias: string) => void
}

/** The host-form dialog invocation. */
type DialogState = { mode: 'create' } | { mode: 'edit'; host: SshHostSummary }

/** Host list grouping modes (#379). */
export type HostGroupBy = 'none' | 'environment' | 'tags'

/** One collapsible group section of the grouped host list. */
export interface HostGroup {
  /** Group key: the environment name, one tag, or '' for the ungrouped bucket. */
  key: string
  hosts: SshHostSummary[]
}

/**
 * Bucket hosts into collapsible groups (#379). Grouping by tags places a
 * multi-tag host in every one of its tag groups (folder view); hosts without
 * the grouping key land in the '' bucket, which always sorts last. Groups
 * sort alphabetically; host order inside a group follows the API listing.
 */
export function groupHosts(hosts: SshHostSummary[], groupBy: HostGroupBy): HostGroup[] {
  if (groupBy === 'none') return [{ key: '', hosts }]
  const buckets = new Map<string, SshHostSummary[]>()
  const push = (key: string, host: SshHostSummary): void => {
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [host])
    else bucket.push(host)
  }
  for (const host of hosts) {
    if (groupBy === 'environment') {
      push(host.environment ?? '', host)
    } else if (host.tags.length === 0) {
      push('', host)
    } else {
      for (const tag of host.tags) push(tag, host)
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([key, group]) => ({ key, hosts: group }))
}

/** The hosts table plus its toolbar and dialogs. */
export function HostsTab({ api, onConnect }: HostsTabProps) {
  const [hosts, setHosts] = useState<SshHostSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [testingAlias, setTestingAlias] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [groupBy, setGroupBy] = useState<HostGroupBy>('none')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [testingGroup, setTestingGroup] = useState<string | null>(null)
  const seqRef = useRef(0)
  // Unmount guard for the async load below: the seq check only orders
  // overlapping loads, it does not stop a late resolution/rejection landing
  // after the tab unmounted — a setState there races the test-environment
  // teardown (window is not defined; observed as a main-CI flake). The
  // sibling tabs (terminal / transfer / tunnels) already guard with a
  // disposed flag.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const load = useCallback(async (query?: string): Promise<void> => {
    const seq = ++seqRef.current
    try {
      const list = await api.listHosts(query)
      if (!mountedRef.current || seq !== seqRef.current) return
      setHosts(list)
      setError(null)
    } catch (cause) {
      if (!mountedRef.current || seq !== seqRef.current) return
      setError(errorMessage(cause))
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  // Debounced search: every keystroke re-filters through the API.
  useEffect(() => {
    const timer = setTimeout(() => {
      const query = search.trim()
      void load(query === '' ? undefined : query)
    }, 300)
    return () => { clearTimeout(timer) }
  }, [search, load])

  // Every async setState path guards with mountedRef, not just load(): a
  // promise settling after unmount would setState against the torn-down
  // environment (window is not defined, main-CI flake).
  const runTest = async (alias: string): Promise<void> => {
    if (!mountedRef.current) return
    setTestingAlias(alias)
    try {
      const result = await api.testHost(alias)
      if (!mountedRef.current) return
      setTestResults(prev => ({ ...prev, [alias]: result }))
    } catch (cause) {
      if (!mountedRef.current) return
      setTestResults(prev => ({ ...prev, [alias]: { ok: false, error: errorMessage(cause) } }))
    } finally {
      if (mountedRef.current) setTestingAlias(null)
    }
  }

  const deleteHost = async (alias: string): Promise<void> => {
    if (!window.confirm(tt('hosts.deleteConfirm', { alias }))) return
    try {
      await api.deleteHost(alias)
      if (!mountedRef.current) return
      void load()
    } catch (cause) {
      if (!mountedRef.current) return
      setError(errorMessage(cause))
    }
  }

  // Group-header batch action (#379): test every host in the group.
  const testGroup = async (group: HostGroup): Promise<void> => {
    if (!mountedRef.current) return
    setTestingGroup(group.key)
    try {
      await Promise.all(group.hosts.map(host => runTest(host.alias)))
    } finally {
      if (mountedRef.current) setTestingGroup(null)
    }
  }

  const importConfig = async (): Promise<void> => {
    if (!mountedRef.current) return
    setImporting(true)
    try {
      const result = await api.importSshConfig()
      if (!mountedRef.current) return
      setNotice(tt('hosts.imported', { parsed: result.parsed, added: result.added, skipped: result.skipped }))
      void load()
    } catch (cause) {
      if (!mountedRef.current) return
      setError(errorMessage(cause))
    } finally {
      if (mountedRef.current) setImporting(false)
    }
  }

  const renderHostRow = (host: SshHostSummary): ReactNode => {
    const test = testResults[host.alias]
    return (
      <tr key={host.alias}>
        <td className={css.mono}>{host.alias}</td>
        <td className={css.mono}>{host.host}:{host.port}</td>
        <td>{host.user}</td>
        <td><span className={css.badge} data-kind={host.auth}>{host.auth === 'key' ? tt('form.auth.key') : host.auth === 'password' ? tt('form.auth.password') : tt('form.auth.agent')}</span></td>
        <td className={css.cellMuted}>{host.environment ?? ''}</td>
        <td className={css.cellMuted}>{host.tags.join(', ')}</td>
        <td className={css.cellMuted}>{host.description ?? ''}</td>
        <td>
          <div className={css.actions}>
            <button type="button" className={css.linkButton} disabled={testingAlias === host.alias} onClick={() => { void runTest(host.alias) }}>
              {testingAlias === host.alias ? tt('hosts.testing') : tt('hosts.test')}
            </button>
            {testingAlias === host.alias && <span className={css.spinner} aria-hidden="true" />}
            {test !== undefined && (
              <span className={css.inlineTest} data-status={test.ok ? 'ok' : 'fail'}>
                {test.ok ? tt('hosts.testOk', { latency: test.latencyMs ?? 0 }) : tt('hosts.testFail', { error: test.error ?? '' })}
              </span>
            )}
            <button type="button" className={css.linkButton} onClick={() => { setDialog({ mode: 'edit', host }) }}>{tt('hosts.edit')}</button>
            <button type="button" className={css.linkButton} data-danger onClick={() => { void deleteHost(host.alias) }}>{tt('hosts.delete')}</button>
            <button type="button" className={css.ghostButton} onClick={() => { onConnect(host.alias) }}>{tt('hosts.connected')}</button>
          </div>
        </td>
      </tr>
    )
  }

  const renderHostTable = (rows: SshHostSummary[]): ReactNode => (
    <table className={css.table}>
      <thead>
        <tr>
          <th>{tt('hosts.col.alias')}</th>
          <th>{tt('hosts.col.host')}</th>
          <th>{tt('hosts.col.user')}</th>
          <th>{tt('hosts.col.auth')}</th>
          <th>{tt('hosts.col.environment')}</th>
          <th>{tt('hosts.col.tags')}</th>
          <th>{tt('hosts.col.description')}</th>
          <th>{tt('hosts.col.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(renderHostRow)}
      </tbody>
    </table>
  )

  const groups = hosts === null ? [] : groupHosts(hosts, groupBy)

  return (
    <div className={css.fillBody}>
      <div className={css.toolbar}>
        <input className={css.search} type="search" placeholder={tt('hosts.search')} value={search} onChange={event => { setSearch(event.target.value) }} />
        <select
          className={css.groupBySelect}
          aria-label={tt('hosts.groupBy.label')}
          value={groupBy}
          onChange={event => { setGroupBy(event.target.value as HostGroupBy) }}
        >
          <option value="none">{tt('hosts.groupBy.none')}</option>
          <option value="environment">{tt('hosts.groupBy.environment')}</option>
          <option value="tags">{tt('hosts.groupBy.tags')}</option>
        </select>
        <div className={css.toolbarSpacer} />
        <button type="button" className={css.primaryButton} onClick={() => { setDialog({ mode: 'create' }) }}>{tt('hosts.add')}</button>
        <button type="button" className={css.ghostButton} disabled={importing} onClick={() => { void importConfig() }}>{importing ? tt('common.loading') : tt('hosts.import')}</button>
      </div>
      {notice !== null && <div className={css.banner} data-kind="ok">{notice}</div>}
      {error !== null && <div className={css.banner} data-kind="error">{tt('common.error', { error })}</div>}
      {hosts === null && error === null && <div className={css.loading}>{tt('common.loading')}</div>}
      {hosts !== null && hosts.length === 0 && <div className={css.empty}>{tt('hosts.empty')}</div>}
      {hosts !== null && hosts.length > 0 && groupBy === 'none' && (
        <div className={css.tableWrap}>
          {renderHostTable(hosts)}
        </div>
      )}
      {hosts !== null && hosts.length > 0 && groupBy !== 'none' && (
        <div className={css.tableWrap}>
          {groups.map(group => {
            const isCollapsed = collapsed[group.key] === true
            const label = group.key === ''
              ? (groupBy === 'tags' ? tt('hosts.group.noTags') : tt('hosts.group.ungrouped'))
              : group.key
            return (
              <section key={group.key} className={css.groupSection}>
                <div className={css.groupHeader}>
                  <button
                    type="button"
                    className={css.groupToggle}
                    aria-expanded={!isCollapsed}
                    onClick={() => { setCollapsed(prev => ({ ...prev, [group.key]: !isCollapsed })) }}
                  >
                    <span className={css.groupChevron} data-collapsed={isCollapsed || undefined} aria-hidden="true" />
                    <span className={css.groupName}>{label}</span>
                    <span className={css.groupCount}>{tt('hosts.group.count', { count: group.hosts.length })}</span>
                  </button>
                  <button
                    type="button"
                    className={css.linkButton}
                    disabled={testingGroup === group.key}
                    onClick={() => { void testGroup(group) }}
                  >
                    {testingGroup === group.key ? tt('hosts.testing') : tt('hosts.group.testAll')}
                  </button>
                </div>
                {!isCollapsed && renderHostTable(group.hosts)}
              </section>
            )
          })}
        </div>
      )}
      {dialog !== null && (
        <HostFormDialog
          api={api}
          editing={dialog.mode === 'edit' ? dialog.host : null}
          onClose={() => { setDialog(null) }}
          onSaved={() => { setDialog(null); void load() }}
        />
      )}
    </div>
  )
}
