/**
 * The check-for-updates patch contributed to the official Plugins page.
 *
 * This package used to own a "Plugin manager" tab inside the Plugins settings
 * section (`settings.plugins.tab`). Installing, uninstalling, enabling and
 * disabling moved to the official plugin manager page long ago, and the tab's
 * remaining half (read-only inventory, install-conflict ledger, boot-failure
 * repair conversation, safe-mode banner) is UI no official page renders. It is
 * gone; the one capability the official page still lacks is comparing an
 * installed plugin against its registry source.
 *
 * So this package now contributes exactly that, into the seat the official
 * Plugins page declares for contributed sections (`plugins.detail.section`,
 * a root-scope list rendered on every bundle / row / official-plugin page with
 * the page's `subject`). The official page owns the page chrome; this entry
 * renders one compact block, only on an installed bundle's page, drawing only
 * a plain button and its own section so it carries no dependency on the
 * official primitives bundle.
 * @module @linxin666/dsh-client-ui-plugin-manager/client
 */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InstallProgressItem, PluginUpdateItem } from '../core/protocol.ts'
import { displayMinimumVersion } from '../core/version.ts'
import css from './plugin-manager.module.css'

/** One loader row of a bundle, as the official page's subject carries it. */
export interface PluginPageRowRef {
  rowId: string
  moduleName: string
  enabled: boolean
}

/** One bundle, as the official page's subject carries it. */
export interface PluginPageBundleRef {
  name: string
  version?: string
  installed: boolean
  enabled: boolean
  rows: readonly PluginPageRowRef[]
}

/**
 * The subject the official Plugins page renders a contributed section with:
 * its bundle page, its row page, or an official plugin's page. This package
 * only speaks to the bundle case.
 */
export type PluginPageSubject =
  | { kind: 'bundle'; pkg: PluginPageBundleRef }
  | { kind: 'row'; pkg: PluginPageBundleRef; row: PluginPageRowRef }
  | { kind: 'item'; id: string }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One section contributed under a Plugins page's own content. Declared at
     * runtime by the official plugin-manager page's `main` registration; the
     * type is re-declared here, identically, so this package can register into
     * it without importing the page (the same way family plugins re-declare
     * `plugins.bundle.config`).
     */
    'plugins.detail.section': {
      kind: 'list'
      scope: 'root'
      owner: { subject: PluginPageSubject }
    }
  }
}

/** Registration-side wire face the patch consumes. */
export interface PluginUpdatePatchInjected {
  /** Whether this browser has loopback authority to use the host routes. */
  isLoopback: boolean
  /** Compare every installed plugin against the version its source serves. */
  checkUpdates: () => Promise<PluginUpdateItem[]>
  /** Re-install one plugin from its recorded source. */
  update: (id: string) => Promise<unknown>
  /** Read the current install/update progress. */
  status: () => Promise<InstallProgressItem>
}

/** Full component props assembled by the Plugins page's section renderer. */
export type PluginUpdatePatchProps =
  PropsRuntime<'plugins.detail.section'>
  & PropsLocale<'settings.pluginManager'>
  & InjectFace<PluginUpdatePatchInjected>

/** Error text for a caught request or lifecycle failure. */
function messageOf(error: unknown): string {
  if (error instanceof AggregateError) {
    const details = error.errors.map(messageOf).join('; ')
    return details === '' ? error.message : `${error.message}: ${details}`
  }
  return error instanceof Error ? error.message : String(error)
}

/** Localized label for one install phase, with percent when the download has one. */
function progressLabel(progress: InstallProgressItem, t: PluginUpdatePatchProps['t']): string {
  if (progress.stage === 'write') return t('writing')
  return progress.percent === undefined ? t('downloading') : t('downloadingPercent', { percent: String(progress.percent) })
}

/**
 * What the host's compatibility verdict amounts to for one update row.
 *
 * `compatible === false` on its own does not mean "this DSH is too old": the
 * host leaves `hostVersion` off a blocked row whenever it could not read its
 * own runtime version (issue #1819) and whenever it could not evaluate the
 * declared range at all — an empty declaration, a range node-semver rejects, a
 * host string that is not one version (issue #1899). Only a row that carries a
 * host version was actually compared against that version, so only that row
 * may send the user to upgrade DSH.
 *
 * The verdict is derived here once and shared by both surfaces that render it
 * (this section and the list-level toolbar) so the two cannot drift apart:
 * that drift is what left the "cannot verify" case telling users to upgrade a
 * DSH the host never checked.
 */
export type DshGate = 'open' | 'below-minimum' | 'unverified'

/**
 * Read the gate state out of one wire row.
 * @param item - the update row, or undefined when no check has answered yet.
 * @returns `open` when nothing blocks the update, otherwise the reason it is
 * held back: `below-minimum` only when the host compared a version it read,
 * `unverified` when it could not make that comparison.
 */
export function dshGateOf(item: Pick<PluginUpdateItem, 'compatible' | 'hostVersion'> | undefined): DshGate {
  if (item?.compatible !== false) return 'open'
  return item.hostVersion === undefined ? 'unverified' : 'below-minimum'
}

/**
 * The update block on one official Plugins page: one check action, the verdict
 * for this page's bundle, and the update action it unlocks. The check is
 * explicit rather than automatic because one check reads every installed
 * plugin's registry manifest; a page visit must not fan that out.
 */
export function PluginUpdatePatch(props: PluginUpdatePatchProps) {
  const { t, subject, isLoopback, checkUpdates, update, status } = props

  const [checked, setChecked] = useState(false)
  const [found, setFound] = useState<PluginUpdateItem | undefined>(undefined)
  const [busy, setBusy] = useState<'check' | 'update' | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [progress, setProgress] = useState<InstallProgressItem>({ kind: 'idle', stage: 'fetch' })
  const [dirty, setDirty] = useState(false)
  /** Synchronous in-flight mirror of `busy`: the render guard alone lets a click and an Enter land in the same frame and double-fire. */
  const busyRef = useRef(false)

  const name = subject.kind === 'bundle' ? subject.pkg.name : undefined
  const installed = subject.kind === 'bundle' && subject.pkg.installed

  /** Poll update progress while an update is in flight. */
  useEffect(() => {
    if (busy !== 'update') {
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
        }).catch(() => { /* polling fails silently; the update itself owns the error row */ })
      }, delay)
    }
    tick(100)
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [busy, status])

  if (name === undefined || !installed) return null

  const onCheck = (): void => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy('check')
    setError(undefined)
    void checkUpdates().then(items => {
      setFound(items.find(item => item.id === name))
      setChecked(true)
    }).catch(reason => {
      setError(t('failed', { reason: messageOf(reason) }))
    }).finally(() => {
      busyRef.current = false
      setBusy(undefined)
    })
  }

  const onUpdate = (): void => {
    if (busyRef.current || found === undefined) return
    busyRef.current = true
    setBusy('update')
    setError(undefined)
    void update(found.id).then(() => {
      setFound(undefined)
      setChecked(false)
      setDirty(true)
    }).catch(reason => {
      setError(t('failed', { reason: messageOf(reason) }))
    }).finally(() => {
      busyRef.current = false
      setBusy(undefined)
    })
  }

  if (!isLoopback) {
    return (
      <section className={css.notice} data-update-patch data-state="local-only">
        <strong>{t('localOnlyTitle')}</strong>
        <p>{t('localOnlyBody')}</p>
      </section>
    )
  }

  const requiresDsh = found?.requiresDsh
  const gate = dshGateOf(found)
  const blocked = gate !== 'open'
  // A requirement the host could not verify has two causes — the running DSH
  // version could not be read, or the declared range could not be evaluated —
  // and neither is "your DSH is too old". The copy therefore names no cause and
  // sends nobody to upgrade DSH; see `dshGateOf`.

  return (
    <section className={css.section} data-update-patch aria-busy={busy !== undefined}>
      <h3 className={css.title}>{t('updateSection')}</h3>
      <div className={css.actionRow}>
        <button
          type="button"
          className={css.button}
          disabled={busy !== undefined}
          onClick={onCheck}
        >
          {busy === 'check' ? t('checking') : t('checkUpdates')}
        </button>
        {checked && found === undefined && busy === undefined && (
          <p className={css.ok}>{t('noUpdates')}</p>
        )}
        {found !== undefined && (
          <span className={css.latest} data-update-latest={found.latest}>{t('latest', { version: found.latest })}</span>
        )}
        {found !== undefined && (requiresDsh !== undefined || blocked) && (
          <span
            className={blocked ? css.compatBlocked : css.compatHint}
            data-update-compat={blocked ? 'blocked' : 'ok'}
            data-update-compat-reason={blocked ? gate : undefined}
          >
            {requiresDsh !== undefined
              ? t(gate === 'open' ? 'updateRequiresDsh' : gate === 'unverified' ? 'updateUnverifiedDsh' : 'updateBlockedDsh', {
                min: displayMinimumVersion(requiresDsh),
              })
              : t('updateUnverifiedDshUnknownRange')}
          </span>
        )}
        {found !== undefined && (
          <button
            type="button"
            className={`${css.button} ${css.primary}`}
            disabled={busy !== undefined || blocked}
            onClick={onUpdate}
          >
            {busy === 'update' ? t('updating') : t('update')}
          </button>
        )}
      </div>

      {busy === 'update' && (
        <div className={css.progressRow} role="status">
          <div className={css.progressTrack}>
            <div
              className={css.progressBar}
              style={progress.percent === undefined ? undefined : { width: `${String(progress.percent)}%` }}
              data-indeterminate={progress.percent === undefined ? 'true' : undefined}
            />
          </div>
          <p className={css.hint}>{progressLabel(progress, t)}</p>
        </div>
      )}

      {error !== undefined && (
        <p className={css.error} role="alert" data-update-error>{error}</p>
      )}

      {dirty && (
        <div className={css.restartRow}>
          <p>{t('restartHint')}</p>
        </div>
      )}
    </section>
  )
}
