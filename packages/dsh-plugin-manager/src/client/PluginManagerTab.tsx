/**
 * The plugin-manager tab: an install box, one row per installed user plugin
 * (next-start enablement switch, source badge, update availability, update and
 * uninstall actions, per-plugin boot-failure block), the built-in product
 * switches, an install-conflict notice (the diff of the plugin-control
 * snapshot around each install, reversible through the product switch), and
 * the failure-repair affordances. Enablement switches and installs persist
 * through the official host channels and apply at the next restart; the web
 * build shows a restart hint instead of an in-place restart.
 *
 * This tab registers into the official Plugins settings section
 * (`settings.plugins.tab` slot) next to the official installer tab; its added
 * value over that tab is the conflict ledger, the bilingual repair seeds, and
 * the family card vocabulary.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
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
import { conflictRepairMessage, failureRepairMessage, installRepairMessage, type RepairCopy } from '../core/repair.ts'
import { displayMinimumVersion } from '../core/version.ts'
import css from './plugin-manager.module.css'

/** Registration-side wire face used by the tab. */
export interface PluginManagerTabInjected {
  /** Whether this browser has loopback authority to use the host routes. */
  isLoopback: boolean
  /** Read the installed snapshot. */
  list: () => Promise<InstalledPluginItem[]>
  /** Install one plugin from an npm spec or git URL. */
  install: (spec: string) => Promise<InstalledPluginItem>
  /** Re-install one plugin from its recorded source. */
  update: (id: string) => Promise<InstalledPluginItem>
  /** Remove one plugin. */
  uninstall: (id: string) => Promise<InstalledPluginItem[]>
  /** Persist one user plugin's next-start enablement. */
  setEnabled: (id: string, enabled: boolean) => Promise<InstalledPluginItem>
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
type BusyAction = { readonly kind: 'install' | 'update' | 'uninstall' | 'check'; readonly id?: string }

/** One enablement switch in flight: a user plugin or a built-in product. */
type ToggleBusy = { readonly kind: 'user' | 'product'; readonly id: string }

/** One uninstall target awaiting confirmation. */
interface UninstallTarget {
  readonly id: string
  readonly name: string
}

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
    installTitle: t('repairInstallTitle'),
    installSpecLabel: t('repairInstallSpecLabel'),
    installErrorLabel: t('repairInstallErrorLabel'),
    installAsk: t('repairInstallAsk'),
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
    install,
    update,
    uninstall,
    setEnabled,
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
  const [failedSpec, setFailedSpec] = useState<string | undefined>(undefined)
  const [installError, setInstallError] = useState<string | undefined>(undefined)
  const [spec, setSpec] = useState('')
  const [dirty, setDirty] = useState(false)
  const [repairing, setRepairing] = useState<string | undefined>(undefined)
  const [copied, setCopied] = useState<string | undefined>(undefined)
  const [updates, setUpdates] = useState<ReadonlyMap<string, PluginUpdateItem>>(new Map())
  const [uninstallTarget, setUninstallTarget] = useState<UninstallTarget | undefined>(undefined)
  const [conflicts, setConflicts] = useState<readonly ControlChange[]>([])
  const [progress, setProgress] = useState<InstallProgressItem>({ kind: 'idle', stage: 'fetch' })
  /** Synchronous in-flight mirror of `busy`: the render-time guard alone lets a
   * click and an Enter land in the same frame and double-fire. */
  const busyRef = useRef(false)

  /** Reload every snapshot into the ready view. */
  const reload = async (): Promise<void> => {
    const [plugins, controls, failureSnapshot] = await Promise.all([list(), controlsList(), failures()])
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

  /** Install one spec, then diff the product snapshot into a conflict notice. */
  const onInstall = (): void => {
    const target = spec.trim()
    if (target === '' || busy !== undefined || busyRef.current) return
    void (async () => {
      busyRef.current = true
      const before = view.status === 'ready' ? view.controls : await controlsList().catch(() => [])
      setBusy({ kind: 'install' })
      setError(undefined)
      setFailedSpec(undefined)
      setInstallError(undefined)
      try {
        await install(target)
        setSpec('')
        setDirty(true)
        const after = await controlsList().catch(() => [] as readonly PluginControlItem[])
        setConflicts(lastInstallConflicts !== undefined ? lastInstallConflicts() : diffControls(before, after))
        await reload()
      } catch (reason) {
        const reasonText = messageOf(reason)
        setFailedSpec(target)
        setInstallError(reasonText)
        setError(t('failed', { reason: reasonText }))
      } finally {
        busyRef.current = false
        setBusy(undefined)
      }
    })()
  }

  /** Poll install/update progress while such an operation is in flight. */
  useEffect(() => {
    if (busy === undefined || (busy.kind !== 'install' && busy.kind !== 'update')) {
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

  const onUserToggle = (id: string, enabled: boolean): void => {
    setToggleBusy({ kind: 'user', id })
    setError(undefined)
    void setEnabled(id, enabled).then(plugin => {
      setView(current => current.status === 'ready'
        ? { ...current, plugins: current.plugins.map(item => item.id === id ? plugin : item) }
        : current)
      setDirty(true)
      setToggleBusy(undefined)
    }).catch(reason => {
      setError(t('failed', { reason: messageOf(reason) }))
      setToggleBusy(undefined)
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
      await update(id)
      setUpdates(previous => {
        const next = new Map(previous)
        next.delete(id)
        return next
      })
      await reload()
    })
  }

  const onUninstall = (): void => {
    const target = uninstallTarget
    if (target === undefined) return
    void run({ kind: 'uninstall', id: target.id }, async () => {
      await uninstall(target.id)
      setUninstallTarget(undefined)
      await reload()
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

  /** Hand the latest failed install off to a repair conversation over the
   * install root. The seed carries the install's own error (installError), not
   * whatever error the row currently shows. */
  const onRepairInstall = (): void => {
    if (view.status !== 'ready' || repairing !== undefined) return
    setError(undefined)
    setRepairing('install')
    void repairPlugin(view.failures.pluginRoot, installRepairMessage(failedSpec ?? '', installError ?? '', repairCopy(t))).then(() => {
      setError(undefined)
      setFailedSpec(undefined)
      setInstallError(undefined)
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

      <div className={css.installRow}>
        <input
          className={css.spec}
          type="text"
          value={spec}
          placeholder={t('installPlaceholder')}
          disabled={busy !== undefined}
          onChange={event => { setSpec(event.target.value) }}
          onKeyDown={event => {
            if (event.key === 'Enter' && spec.trim() !== '' && busy === undefined) onInstall()
          }}
        />
        <Button
          variant="primary"
          disabled={spec.trim() === '' || busy !== undefined}
          onClick={onInstall}
        >
          {busy !== undefined && busy.kind === 'install' ? t('installing') : t('install')}
        </Button>
      </div>
      <p className={css.hint}>{t('installHint')}</p>

      {(busy?.kind === 'install' || busy?.kind === 'update') && (
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
          {failedSpec !== undefined && (
            <Button variant="outline" disabled={repairing !== undefined} onClick={onRepairInstall}>
              {repairing === 'install' ? t('repairing') : t('repair')}
            </Button>
          )}
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
                return (
                  <li key={plugin.id} className={css.row} data-plugin-id={plugin.id}>
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
                      <span className={css.stateLabel} data-state={plugin.enabled ? 'enabled' : 'disabled'}>
                        {plugin.enabled ? t('enabled') : t('disabled')}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={plugin.enabled}
                        aria-label={plugin.enabled ? t('disableSwitch', { name: plugin.name }) : t('enableSwitch', { name: plugin.name })}
                        className={css.switch}
                        disabled={toggleDisabled}
                        onClick={() => { onUserToggle(plugin.id, !plugin.enabled) }}
                      />
                      {latest !== undefined && (
                        <Button
                          variant="outline"
                          disabled={busy !== undefined || updateItem?.compatible === false}
                          onClick={() => { onUpdate(plugin.id) }}
                        >
                          {busy?.kind === 'update' && busy.id === plugin.id ? t('updating') : t('update')}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        disabled={busy !== undefined}
                        onClick={() => { setUninstallTarget({ id: plugin.id, name: plugin.name }) }}
                      >
                        {t('uninstall')}
                      </Button>
                    </div>
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
                  {control.state === 'enabled' || control.state === 'disabled'
                    ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={control.state === 'enabled'}
                        aria-label={control.state === 'enabled'
                          ? t('disableSwitch', { name: control.name })
                          : t('enableSwitch', { name: control.name })}
                        className={css.switch}
                        disabled={toggleDisabled}
                        onClick={() => { onProductToggle(control.id, control.state !== 'enabled') }}
                      />
                    )
                    : null}
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

      <Modal
        title={t('uninstallConfirmTitle')}
        open={uninstallTarget !== undefined}
        onClose={() => { setUninstallTarget(undefined) }}
        closeLabel={t('cancel')}
      >
        <p className={css.confirmBody}>{t('uninstallConfirmBody', { name: uninstallTarget?.name ?? '' })}</p>
        <div className={css.modalActions}>
          <Button variant="outline" disabled={busy !== undefined} onClick={() => { setUninstallTarget(undefined) }}>
            {t('cancel')}
          </Button>
          <Button variant="primary" className={css.dangerButton} disabled={busy !== undefined} onClick={onUninstall}>
            {t('confirm')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
