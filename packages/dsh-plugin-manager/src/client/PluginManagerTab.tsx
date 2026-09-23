/**
 * The plugin-manager tab keeps only what the official plugin manager page does
 * not do. Installing, uninstalling and enabling or disabling a bundle or a row
 * — with live switching and a build-script approval dialog — belong to the
 * official page since 0.1.6-alpha.2, so this tab renders a read-only inventory
 * and points there. Its own surface is the differentiating half: registry
 * update checks with DSH-runtime compatibility gating, the install-conflict
 * ledger the host records around an install or update (with undo and a repair
 * handoff), the boot-failure ring with its repair conversation, and the
 * safe-mode banner. Changes that need a restart say so.
 *
 * This tab registers into the official Plugins settings section
 * (`settings.plugins.tab` slot) next to the official inventory tab.
 */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { classifyChange, diffControls, type ControlChange } from '../core/conflict.ts'
import type {
  InstallProgressItem,
  InstalledPluginItem,
  PluginControlItem,
  PluginFailureItem,
  PluginFailuresSnapshot,
  PluginUpdateItem,
} from '../core/protocol.ts'
import { conflictRepairMessage, failureRepairMessage, type RepairCopy } from '../core/repair.ts'
import { displayMinimumVersion } from '../core/version.ts'
import css from './plugin-manager.module.css'

/** Registration-side wire face used by the tab. */
export interface PluginManagerTabInjected {
  /** Whether this browser has loopback authority to use the host routes. */
  isLoopback: boolean
  /** Read the installed snapshot (the tab renders it read-only). */
  list: () => Promise<InstalledPluginItem[]>
  /** Re-install one plugin from its recorded source. */
  update: (id: string) => Promise<InstalledPluginItem>
  /** Compare installed versions against their sources. */
  checkUpdates: () => Promise<PluginUpdateItem[]>
  /** Read the current install/update progress. */
  status: () => Promise<InstallProgressItem>
  /** Read the recorded boot failures, plugin root, and safe-mode state. */
  failures: () => Promise<PluginFailuresSnapshot>
  /** Persist the safe-mode marker (web: applied at the next manual restart). */
  setSafeMode: (enabled: boolean) => Promise<void>
  /** Start a repair conversation over the plugin install root. */
  repairPlugin: (pluginRoot: string, message: string) => Promise<void>
  /** Read the deployment-configured built-in product switches. */
  controlsList: () => Promise<PluginControlItem[]>
  /** Persist one product's next-start enablement. */
  controlsSetEnabled: (pluginId: string, enabled: boolean) => Promise<PluginControlItem[]>
  /** Conflicts the gateway host computed around the last install (gateway mode only). */
  lastInstallConflicts?: () => readonly ControlChange[]
}

/** Full component props assembled by the Settings slot renderer. */
export type PluginManagerTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginManager'>
  & InjectFace<PluginManagerTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
    readonly status: 'ready'
    readonly plugins: readonly InstalledPluginItem[]
    readonly controls: readonly PluginControlItem[]
    readonly failures: PluginFailuresSnapshot
  }

/** One row operation in flight. */
type BusyAction = { readonly kind: 'update' | 'check'; readonly id?: string }

/** One switch write in flight (only the conflict ledger's undo writes one). */
type ToggleBusy = { readonly kind: 'product'; readonly id: string }

/** Error text for a caught request or lifecycle failure. */
function messageOf(error: unknown): string {
  if (error instanceof AggregateError) {
    const details = error.errors.map(messageOf).join('; ')
    return details === '' ? error.message : `${error.message}: ${details}`
  }
  return error instanceof Error ? error.message : String(error)
}

/** Localized fragments for the repair seed builders, read from the tab's dictionaries. */
function repairCopy(t: PluginManagerTabProps['t']): RepairCopy {
  return {
    failureTitle: t('repairFailureTitle'),
    failurePluginLabel: t('repairFailurePluginLabel'),
    failureKindLabel: t('repairFailureKindLabel'),
    failureAtLabel: t('repairFailureAtLabel'),
    failureMessageLabel: t('repairFailureMessageLabel'),
    failureStackLabel: t('repairFailureStackLabel'),
    failurePathLabel: t('repairFailurePathLabel'),
    failureAsk: t('repairFailureAsk'),
    kindNames: {
      'load-failure': t('repairKindLoad'),
      hang: t('repairKindHang'),
      'late-rejection': t('repairKindLate'),
    },
    conflictTitle: t('repairConflictTitle'),
    conflictPluginLabel: t('repairConflictPluginLabel'),
    conflictChangeLabel: t('repairConflictChangeLabel'),
    conflictAsk: t('repairConflictAsk'),
    stateNames: {
      enabled: t('repairStateEnabled'),
      disabled: t('repairStateDisabled'),
      uninstalled: t('repairStateUninstalled'),
    },
  }
}

/** Localized label for one install phase, with percent when the download has one. */
function progressLabel(progress: InstallProgressItem, t: PluginManagerTabProps['t']): string {
  if (progress.stage === 'fetch') return t('fetching')
  if (progress.stage === 'extract') return t('extracting')
  if (progress.stage === 'write') return t('writing')
  return progress.percent === undefined ? t('downloading') : t('downloadingPercent', { percent: String(progress.percent) })
}

/** The plugin-manager settings tab. */
export function PluginManagerTab(props: PluginManagerTabProps) {
  const {
    t,
    isLoopback,
    list,
    update,
    checkUpdates,
    status,
    failures,
    setSafeMode,
    repairPlugin,
    controlsList,
    controlsSetEnabled,
    lastInstallConflicts,
  } = props

  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [busy, setBusy] = useState<BusyAction | undefined>(undefined)
  const [toggleBusy, setToggleBusy] = useState<ToggleBusy | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [dirty, setDirty] = useState(false)
  const [repairing, setRepairing] = useState<string | undefined>(undefined)
  const [copied, setCopied] = useState<string | undefined>(undefined)
  const [updates, setUpdates] = useState<ReadonlyMap<string, PluginUpdateItem>>(new Map())
  const [conflicts, setConflicts] = useState<readonly ControlChange[]>([])
  const [progress, setProgress] = useState<InstallProgressItem>({ kind: 'idle', stage: 'fetch' })
  /** Parent rows whose aggregate child list is expanded; collapsed by default. */
  const [expandedChildren, setExpandedChildren] = useState<ReadonlySet<string>>(() => new Set())
  /** Synchronous in-flight mirror of `busy`: the render-time guard alone lets a
   * click and an Enter land in the same frame and double-fire. */
  const busyRef = useRef(false)

  /**
   * Reload every snapshot into the ready view. The conflict ledger is the
   * host's record of the last install or update that ran through this
   * package's gateway channel — including a Workshop install driven through
   * the shared service — so it is read here rather than diffed around an
   * install this tab no longer performs.
   */
  const reload = async (): Promise<void> => {
    const [plugins, controls, failureSnapshot] = await Promise.all([list(), controlsList(), failures()])
    if (lastInstallConflicts !== undefined) setConflicts(lastInstallConflicts())
    setView({ status: 'ready', plugins, controls, failures: failureSnapshot })
  }

  useEffect(() => {
    let cancelled = false
    void reload().catch(() => {
      if (!cancelled) setView({ status: 'error' })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** One row/form operation: busy state, error row, dirty flag on success. */
  const run = async (action: BusyAction, body: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(action)
    setError(undefined)
    try {
      await body()
      setDirty(true)
    } catch (reason) {
      setError(t('failed', { reason: messageOf(reason) }))
    } finally {
      busyRef.current = false
      setBusy(undefined)
    }
  }

  /** Poll update progress while such an operation is in flight. */
  useEffect(() => {
    if (busy === undefined || busy.kind !== 'update') {
      setProgress({ kind: 'idle', stage: 'fetch' })
      return
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (delay: number): void => {
      timer = setTimeout(() => {
        void status().then(next => {
          if (!stopped && next !== undefined) {
            setProgress(next)
            tick(400)
          }
        }).catch(() => { /* status polling fails silently; the operation itself owns the error row */ })
      }, delay)
    }
    tick(100)
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [busy, status])

  const toggleDisabled = busy !== undefined || toggleBusy !== undefined
    || (view.status === 'ready' && view.failures.safeMode)

  /** Expand or collapse one aggregate row's child list (pure view state). */
  const toggleChildren = (id: string): void => {
    setExpandedChildren(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onProductToggle = (id: string, enabled: boolean): void => {
    setToggleBusy({ kind: 'product', id })
    setError(undefined)
    void controlsSetEnabled(id, enabled).then(controls => {
      setView(current => current.status === 'ready' ? { ...current, controls } : current)
      setConflicts(previous => previous.filter(change => change.id !== id))
      setDirty(true)
      setToggleBusy(undefined)
    }).catch(reason => {
      setError(t('failed', { reason: messageOf(reason) }))
      setToggleBusy(undefined)
    })
  }

  const onCheck = (): void => {
    void run({ kind: 'check' }, async () => {
      const found = await checkUpdates()
      setUpdates(new Map(found.map(item => [item.id, item])))
    })
  }

  const onUpdate = (id: string): void => {
    void run({ kind: 'update', id }, async () => {
      // The gateway host records the conflicts its own CLI run produced; the
      // official channel records none, so that mode diffs the product snapshot
      // around this update instead — the only install-shaped action this tab
      // still performs.
      const before = view.status === 'ready' ? view.controls : await controlsList().catch(() => [] as readonly PluginControlItem[])
      await update(id)
      setUpdates(previous => {
        const next = new Map(previous)
        next.delete(id)
        return next
      })
      await reload()
      if ((lastInstallConflicts?.() ?? []).length > 0) return
      const after = await controlsList().catch(() => [] as readonly PluginControlItem[])
      setConflicts(diffControls(before, after))
    })
  }

  /** Open a repair conversation seeded with one boot-failure record. `token`
   * identifies the row for the in-flight label (plugin id, or a row key for
   * unattributable failures). */
  const onRepair = (failure: PluginFailureItem, token: string): void => {
    if (view.status !== 'ready' || busy !== undefined || repairing !== undefined) return
    setError(undefined)
    setRepairing(token)
    void repairPlugin(view.failures.pluginRoot, failureRepairMessage(failure, repairCopy(t))).then(() => {
      setRepairing(undefined)
    }).catch(reason => {
      setError(t('failed', { reason: messageOf(reason) }))
      setRepairing(undefined)
    })
  }

  /** Copy a boot failure's message and stack for a manual repair conversation. */
  const onCopy = (failure: PluginFailureItem, token: string): void => {
    void navigator.clipboard.writeText(`${failure.message}\n\n${failure.stack}`).then(() => {
      setCopied(token)
    }).catch(() => {
      setError(t('failed', { reason: 'clipboard unavailable' }))
    })
  }

  const onExitSafeMode = (): void => {
    if (busy !== undefined) return
    setError(undefined)
    void setSafeMode(false).then(() => {
      setDirty(true)
      void reload().catch(reason => {
        setError(t('failed', { reason: messageOf(reason) }))
      })
    }).catch(reason => {
      setError(t('failed', { reason: messageOf(reason) }))
    })
  }

  /** Undo one conflict action by flipping the product switch back. */
  const onUndoConflict = (change: ControlChange): void => {
    if (change.to !== 'disabled') return
    onProductToggle(change.id, true)
  }

  /** Hand one conflict notice off to a repair conversation over the plugin root. */
  const onRepairConflict = (change: ControlChange): void => {
    if (view.status !== 'ready' || busy !== undefined || repairing !== undefined) return
    setError(undefined)
    const token = `conflict:${change.id}`
    setRepairing(token)
    void repairPlugin(view.failures.pluginRoot, conflictRepairMessage({
      id: change.id,
      name: change.name,
      from: change.from === 'enabled' || change.from === 'disabled' ? change.from : 'uninstalled',
      to: change.to === 'enabled' || change.to === 'disabled' ? change.to : 'uninstalled',
    }, repairCopy(t))).then(() => {
      setRepairing(undefined)
    }).catch(reason => {
      setError(t('failed', { reason: messageOf(reason) }))
      setRepairing(undefined)
    })
  }

  if (!isLoopback) {
    return (
      <div className={css.notice}>
        <strong>{t('localOnlyTitle')}</strong>
        <p>{t('localOnlyBody')}</p>
      </div>
    )
  }
  if (view.status === 'loading') return <div className={css.state}>{t('loading')}</div>
  if (view.status === 'error') return <div className={css.state}>{t('failed', { reason: 'load' })}</div>

  const attributable = new Map(view.failures.items.filter(item => item.pluginId !== '').map(item => [item.pluginId, item]))
  const unattributable = view.failures.items.filter(item => item.pluginId === '')

  return (
    <div className={css.section} aria-busy={busy !== undefined || toggleBusy !== undefined}>
      {view.failures.safeMode && (
        <div className={css.safeModeBanner} data-safe-mode>
          <p>{t('safeModeBanner')}</p>
          <Button variant="primary" disabled={busy !== undefined} onClick={onExitSafeMode}>
            {t('exitSafeMode')}
          </Button>
        </div>
      )}

      <p className={css.hint} data-manage-elsewhere>{t('manageElsewhere')}</p>

      {busy?.kind === 'update' && (
        <div className={css.progressRow} role="status">
          <div className={css.progressTrack}>
            <div
              className={css.progressBar}
              style={progress.percent === undefined ? undefined : { width: `${progress.percent}%` }}
              data-indeterminate={progress.percent === undefined ? 'true' : undefined}
            />
          </div>
          <p className={css.progressLabel}>{progressLabel(progress, t)}</p>
        </div>
      )}

      {error !== undefined && (
        <div className={css.errorRow}>
          <span className={css.error}>{error}</span>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className={css.conflicts}>
          <h3 className={css.sectionTitle}>{t('conflictTitle')}</h3>
          <ul className={css.list}>
            {conflicts.map(change => (
              <li key={change.id} className={css.row} data-conflict={change.id}>
                <div className={css.meta}>
                  <span className={css.name}>{change.name}</span>
                  <span className={css.sub}>
                    {classifyChange(change) === 'rule-disabled'
                      ? t('conflictDisabled', { name: change.name })
                      : classifyChange(change) === 'rule-enabled'
                        ? t('conflictEnabled', { name: change.name })
                        : t('conflictChanged', { name: change.name })}
                  </span>
                </div>
                <div className={css.actions}>
                  {change.to === 'disabled' && (
                    <Button
                      variant="outline"
                      disabled={toggleDisabled}
                      onClick={() => { onUndoConflict(change) }}
                    >
                      {t('undoConflict')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy !== undefined || repairing !== undefined}
                    onClick={() => { onRepairConflict(change) }}
                  >
                    {repairing === `conflict:${change.id}` ? t('repairing') : t('repair')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className={css.hint}>{t('conflictHint')}</p>
        </div>
      )}

      <div className={css.group}>
        <h3 className={css.sectionTitle}>{t('userPlugins')}</h3>
        {view.plugins.length === 0
          ? <p className={css.empty}>{t('empty')}</p>
          : (
            <ul className={css.list}>
              {view.plugins.map(plugin => {
                const updateItem = updates.get(plugin.id)
                const latest = updateItem?.latest
                const dshRequirement = updateItem?.requiresDsh
                const failure = attributable.get(plugin.id)
                const children = plugin.children
                const mixed = children !== undefined && !plugin.enabled && children.some(child => child.enabled)
                return (
                  <li key={plugin.id} data-plugin-id={plugin.id}>
                  <div className={css.row}>
                    <div className={css.meta}>
                      <span className={css.name}>{plugin.name}</span>
                      <span className={css.sub}>
                        <span className={css.version}>{t('version', { version: plugin.version })}</span>
                        <span className={css.sourceBadge} data-source={plugin.source.kind}>
                          {plugin.source.kind === 'npm' ? t('npmSource') : t('gitSource')}
                        </span>
                        <span className={css.specText} title={plugin.source.spec}>{plugin.source.spec}</span>
                      </span>
                      {latest !== undefined && <span className={css.latest}>{t('latest', { version: latest })}</span>}
                      {updateItem !== undefined && dshRequirement !== undefined && (
                        <span className={updateItem.compatible === false ? css.compatBlocked : css.compatHint}>
                          {updateItem.compatible === false
                            ? t('updateBlockedDsh', { min: displayMinimumVersion(dshRequirement) })
                            : t('updateRequiresDsh', { min: displayMinimumVersion(dshRequirement) })}
                        </span>
                      )}
                      {failure !== undefined && (
                        <div className={css.failure} data-plugin-failure={plugin.id}>
                          <span className={css.badge}>{t('failureBadge')}</span>
                          <span className={css.failureMessage} title={failure.message}>{failure.message}</span>
                          <div className={css.failureActions}>
                            <Button
                              variant="primary"
                              disabled={busy !== undefined || repairing !== undefined}
                              onClick={() => { onRepair(failure, plugin.id) }}
                            >
                              {repairing === plugin.id ? t('repairing') : t('repair')}
                            </Button>
                            <Button variant="outline" disabled={busy !== undefined} onClick={() => { onCopy(failure, plugin.id) }}>
                              {copied === plugin.id ? t('copied') : t('copyError')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className={css.actions}>
                      <span className={css.stateLabel} data-state={plugin.enabled ? 'enabled' : mixed ? 'mixed' : 'disabled'}>
                        {plugin.enabled ? t('enabled') : mixed ? t('mixed') : t('disabled')}
                      </span>
                      {latest !== undefined && (
                        <Button
                          variant="outline"
                          disabled={busy !== undefined || updateItem?.compatible === false}
                          onClick={() => { onUpdate(plugin.id) }}
                        >
                          {busy?.kind === 'update' && busy.id === plugin.id ? t('updating') : t('update')}
                        </Button>
                      )}
                    </div>
                  </div>
                  {children !== undefined && children.length > 0 && (() => {
                    // Default-collapsed child list: an aggregate such as
                    // @linxin666/dsh-web-all expands to 20+ rows that would
                    // otherwise push the whole settings page down.
                    const listId = 'pm-children-' + plugin.id.replace(/[^a-zA-Z0-9_-]/g, '-')
                    const expanded = expandedChildren.has(plugin.id)
                    const enabledCount = children.filter(child => child.enabled).length
                    return (
                      <>
                        <button
                          type="button"
                          className={css.childrenToggle}
                          aria-expanded={expanded}
                          aria-controls={listId}
                          aria-label={expanded
                            ? t('childrenHide', { name: plugin.name })
                            : t('childrenShow', { name: plugin.name })}
                          onClick={() => { toggleChildren(plugin.id) }}
                        >
                          <span className={css.chevron} data-expanded={expanded} aria-hidden="true" />
                          <span className={css.childrenSummary}>
                            {t('childrenSummary', { enabled: enabledCount, total: children.length })}
                          </span>
                        </button>
                        {expanded && (
                          <>
                            <ul id={listId} className={css.childList}>
                              {children.map(child => (
                                <li key={child.id} className={css.childRow} data-plugin-row={child.id}>
                                  <span className={css.childName} title={child.id}>{child.name}</span>
                                  <div className={css.actions}>
                                    <span className={css.stateLabel} data-state={child.enabled ? 'enabled' : 'disabled'}>
                                      {child.enabled ? t('enabled') : t('disabled')}
                                    </span>
                                    {child.locked === true
                                      ? <span className={css.lockedHint}>{t('lockedRowHint')}</span>
                                      : null}
                                  </div>
                                </li>
                              ))}
                            </ul>
                            <p className={css.hint}>{t('childrenHint')}</p>
                          </>
                        )}
                      </>
                    )
                  })()}
                  </li>
                )
              })}
            </ul>
          )}
      </div>

      {view.controls.length > 0 && (
        <div className={css.group}>
          <h3 className={css.sectionTitle}>{t('products')}</h3>
          <ul className={css.list}>
            {view.controls.map(control => (
              <li key={control.id} className={css.row} data-product-id={control.id}>
                <div className={css.meta}>
                  <span className={css.name}>{control.name}</span>
                  <span className={css.sub}>
                    <a className={css.link} href={control.repository} target="_blank" rel="noreferrer">{t('source')}</a>
                  </span>
                </div>
                <div className={css.actions}>
                  <span className={css.stateLabel} data-state={control.state}>
                    {t(control.state)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unattributable.length > 0 && (
        <div className={css.group}>
          <h3 className={css.sectionTitle}>{t('failureGroupTitle')}</h3>
          <ul className={css.list}>
            {unattributable.map((failure, index) => {
              const token = `other:${index}`
              return (
                <li key={`${failure.at}-${index}`} className={css.row} data-plugin-failure="other">
                  <div className={css.meta}>
                    <span className={css.badge}>{t('failureBadge')}</span>
                    <span className={css.failureMessage} title={failure.message}>{failure.message}</span>
                    <div className={css.failureActions}>
                      <Button
                        variant="primary"
                        disabled={busy !== undefined || repairing !== undefined}
                        onClick={() => { onRepair(failure, token) }}
                      >
                        {repairing === token ? t('repairing') : t('repair')}
                      </Button>
                      <Button variant="outline" disabled={busy !== undefined} onClick={() => { onCopy(failure, token) }}>
                        {copied === token ? t('copied') : t('copyError')}
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className={css.actionsRow}>
        <Button variant="outline" disabled={busy !== undefined} onClick={onCheck}>
          {busy?.kind === 'check' ? t('checking') : t('checkUpdates')}
        </Button>
        {updates.size === 0 && busy === undefined && view.plugins.length > 0 && (
          <p className={css.ok}>{t('noUpdates')}</p>
        )}
      </div>

      {toggleBusy !== undefined && <p className={css.applying} aria-live="polite">{t('applying')}</p>}

      {dirty && (
        <div className={css.restartRow}>
          <p>{t('restartHint')}</p>
        </div>
      )}

    </div>
  )
}
