/**
 * The "Built-in plugins" group at the bottom of the official Plugins page.
 *
 * By default it lists every global Loader entry no installed bundle contributes —
 * the rows a profile patch inserts itself (the Computer Use pair among them) and
 * the rows the host ships globally — each with the official manager's own switch,
 * so a row is enabled or disabled by exactly the call the official page makes.
 * One control widens that list to every Loader entry and names, on each row a
 * bundle adds, the bundle that adds it: those rows are the ones a reader also
 * meets on that bundle's own page, and the answer to "why is this here twice" is
 * that sentence. Below it, the agent preset compositions the same inventory
 * reports are rendered read-only: a preset's rows are composed per session and
 * only a Loader context can decide a `!!js` condition, so nothing here offers
 * them a switch.
 *
 * Every state shown is the Loader's own: after an accepted write the group
 * re-reads instead of trusting the answer, a refusal is named by the code the
 * manager returned, and a locked row says which lock it is.
 * @module @linxin666/dsh-client-ui-plugin-manager/client
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  readChangeResult,
  readRemoteAnswer,
  selectBuiltinEntries,
  type AgentPreset,
  type AgentPresetRow,
  type BuiltinRow,
  type BundleFacts,
  type DisplayText,
  type PluginFacts,
  type PluginInventory,
  type WriteState,
} from '../core/builtin.ts'
import type { ManagerFace, RemoteSnapshot } from './native-faces.ts'
import css from './plugin-manager.module.css'

/** The operations the group drives, all of them the official manager's own. */
export interface BuiltinPluginsInjected {
  /** The official faces, sampled on every render; its `version` moves on change. */
  remote: RemoteSnapshot
  /**
   * Resolve package metadata text through the language the GUI is showing. The
   * inventory hands back translations, not strings, and the mount owns no
   * language of its own.
   */
  resolveText: (text: DisplayText) => string
}

/** Full component props. */
export type BuiltinPluginsProps =
  & PropsLocale<'settings.pluginManager'>
  & BuiltinPluginsInjected

/** What the group knows about the deployment right now. */
type GroupState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed'; readonly code: string }
  | {
    readonly kind: 'ready'
    /** The default scope: the rows no installed bundle contributes. */
    readonly rows: readonly BuiltinRow[]
    /** Every Loader entry, with `ownedBy` on the rows a bundle contributes. */
    readonly allRows: readonly BuiltinRow[]
    readonly presets: readonly AgentPreset[]
    readonly bundles: 'confirmed' | 'unconfirmed'
  }

/** One line of feedback under the heading. */
interface Notice {
  /** A refusal, or the passing note a resolved-but-not-live write deserves. */
  readonly tone: 'error' | 'note'
  readonly text: string
}

/** Which refusal code reads as which sentence. */
const REFUSAL_KEYS = {
  'management-required': 'builtinReasonManagementRequired',
  'unaddressable': 'builtinReasonUnaddressable',
} as const

/** Which restart reason reads as which sentence. */
const RESTART_KEYS = {
  'no-hmr': 'builtinRestartNoHmr',
  'package-moved': 'builtinRestartPackageMoved',
  'host-module': 'builtinRestartHostModule',
  'unmanaged-plugin': 'builtinRestartUnmanagedPlugin',
  'module-comparison': 'builtinRestartModuleComparison',
} as const

/** Translate in this package's namespace. */
type Translate = BuiltinPluginsProps['t']

/**
 * The one reason a failure this component could not name may show: the manager's
 * own generic code. A caught exception keeps its message out of the interface —
 * a host diagnostic can carry an absolute path — and is logged instead.
 */
const FALLBACK_CODE = 'operation-error'

/** Log one caught failure where a developer can read it, naming what failed. */
function warnFailure(what: string, error: unknown): void {
  console.warn(`plugin-manager: ${what}`, error)
}

/**
 * What one refusal code reads as. A code this package has no sentence for is
 * shown as the code itself: the manager named it, and a guessed sentence would
 * be worse than the name it gave.
 */
function refusalText(code: string, t: Translate): string {
  const key = REFUSAL_KEYS[code as keyof typeof REFUSAL_KEYS]
  return key === undefined ? code : t(key)
}

/** Why a row's switch is locked, in the reader's language. */
function writeReason(write: WriteState, t: Translate): string {
  if (write === 'writable') return ''
  if (write === 'unknown') return t('builtinReasonUnknown')
  return refusalText(write, t)
}

/** Why a write needs a restart, in the reader's language. */
function restartReason(reason: string | undefined, t: Translate): string {
  if (reason === undefined) return t('builtinRestartUnnamed')
  const key = RESTART_KEYS[reason as keyof typeof RESTART_KEYS]
  return key === undefined ? t('builtinRestartUnnamed') : t(key)
}

/** One row's display title, falling back to the module it names. */
function rowTitle(
  row: { readonly meta?: { readonly title?: DisplayText }; readonly moduleName: string },
  resolveText: BuiltinPluginsInjected['resolveText'],
): string {
  const title = row.meta?.title
  if (title === undefined) return row.moduleName
  const resolved = resolveText(title)
  return resolved === '' ? row.moduleName : resolved
}

/** One preset row's state, as the composition reports it. */
function presetRowState(row: AgentPresetRow): 'on' | 'off' | 'conditional' {
  if (row.enabled === 'conditional') return 'conditional'
  return row.enabled ? 'on' : 'off'
}

/** One preset row's state text; a conditional row names its own expression. */
function presetRowText(row: AgentPresetRow, t: Translate): string {
  if (row.enabled === 'conditional') {
    return row.condition === undefined
      ? t('presetRowConditionalUnnamed')
      : t('presetRowConditional', { condition: row.condition })
  }
  return row.enabled ? t('presetRowOn') : t('presetRowOff')
}

/**
 * Read one manager list, treating a refused or failed read as unknown. A row
 * whose writability could not be read is shown locked, never writable.
 */
async function readList<T>(read: () => Promise<unknown>): Promise<T | undefined> {
  try {
    const answer = readRemoteAnswer<T>(await read())
    if (!answer.ok) return undefined
    return Array.isArray(answer.value) ? answer.value as T : undefined
  } catch (error) {
    warnFailure('built-in group list read failed', error)
    return undefined
  }
}

/**
 * Whether an inventory answer is really a snapshot. The namespace hands back
 * `entries`; anything else — a bare null, an envelope with no value, a value
 * whose entries is not a list — is a failure this group reports rather than one
 * it walks into.
 */
function isInventory(value: unknown): value is PluginInventory {
  return typeof value === 'object'
    && value !== null
    && Array.isArray((value as { entries?: unknown }).entries)
}

/**
 * Read the whole group: the Loader snapshot, then the two manager lists that
 * decide which entries are built-in and which of them can be written.
 * @param remote - the sampled official faces.
 * @returns the group's state; a read this deployment cannot serve stays a state,
 *   never an exception.
 */
async function readGroup(remote: RemoteSnapshot): Promise<GroupState> {
  const inventoryFace = remote.inventory
  if (inventoryFace === null) return { kind: 'unavailable' }
  try {
    const answer = readRemoteAnswer<PluginInventory>(await inventoryFace.list())
    // A refusal keeps the code the host named; anything else that is not a
    // snapshot at all is reported as this component's own generic failure.
    if (!answer.ok) return { kind: 'failed', code: answer.code ?? FALLBACK_CODE }
    if (!isInventory(answer.value)) return { kind: 'failed', code: FALLBACK_CODE }
    const inventory = answer.value
    const manager: ManagerFace | null = remote.manager
    const [plugins, bundles] = await Promise.all([
      manager === null ? Promise.resolve(undefined) : readList<readonly PluginFacts[]>(() => manager.listPlugins()),
      manager === null ? Promise.resolve(undefined) : readList<readonly BundleFacts[]>(() => manager.listBundles()),
    ])
    const selection = selectBuiltinEntries(inventory, bundles, plugins)
    return {
      kind: 'ready',
      rows: selection.rows,
      allRows: selection.allRows,
      bundles: selection.bundles,
      presets: Array.isArray(inventory.agentPresets) ? inventory.agentPresets : [],
    }
  } catch (error) {
    // The whole read is guarded, not just the call: a malformed snapshot would
    // otherwise reject out of the effect below and leave the group reading for
    // ever, which reads as a hang rather than as the failure it is.
    warnFailure('built-in group read failed', error)
    return { kind: 'failed', code: FALLBACK_CODE }
  }
}

/**
 * The group itself. All state is local: the page around it owns the plugin list,
 * and the Loader is the only truth this component reports.
 */
export function BuiltinPlugins(props: BuiltinPluginsProps) {
  const { t, remote, resolveText } = props
  const [state, setState] = useState<GroupState>({ kind: 'loading' })
  /** Bumped after an accepted write, so the group reads the Loader again. */
  const [reload, setReload] = useState(0)
  /** The one write in flight, mirrored into the switches before the re-read. */
  const [pending, setPending] = useState<{ entryId: string; enabled: boolean } | undefined>(undefined)
  /** Synchronous in-flight mirror: two clicks can land in one frame. */
  const writingRef = useRef(false)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)

  // A re-read keeps the rows it already shows until the new answer lands, so a
  // toggle never collapses the list under the pointer.
  useEffect(() => {
    let live = true
    void readGroup(remote).then(state => {
      if (live) setState(state)
    })
    return () => { live = false }
  }, [remote, reload])

  /**
   * Which scope the list shows. Switching it only picks between the two sets the
   * last read already answered with: it never reads again and never touches a
   * row's enablement, so a reader can widen the list without the Loader moving.
   */
  const [scope, setScope] = useState<'default' | 'all'>('default')
  const listId = useId()

  const ready = state.kind === 'ready' ? state : undefined
  const rows = ready === undefined ? [] : scope === 'all' ? ready.allRows : ready.rows
  /** Rows the default scope leaves out: what the scope control would add. */
  const ownedCount = ready === undefined ? 0 : ready.allRows.length - ready.rows.length
  const presets = ready === undefined ? [] : ready.presets

  /**
   * The visible label of each row: its name, and the line under it — the module, or
   * the entry id when the name already is that module. Two rows carrying the same
   * pair read identically, which is the only case where the row has to say which
   * entry it is; a title two rows share is exactly that case, and so is a module
   * several rows name. Counted over the list on screen, so each scope answers for
   * itself and switching scope neither reads nor writes anything.
   */
  const labels = new Map<string, string>()
  const labelCounts = new Map<string, number>()
  for (const row of rows) {
    const title = rowTitle(row, resolveText)
    const label = `${title}\u0000${title === row.moduleName ? row.entryId : row.moduleName}`
    labels.set(row.entryId, label)
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
  }
  /** Whether this row's visible labels are shared with another row on screen. */
  const collides = (entryId: string): boolean => (labelCounts.get(labels.get(entryId) ?? '') ?? 0) > 1

  /**
   * Ask the official manager to enable or disable one row, then re-read. The
   * switch moves first and comes back on a refusal, so what it shows afterwards
   * is the answer this deployment gave rather than the click that produced it.
   */
  const toggle = (row: BuiltinRow, next: boolean): void => {
    const manager = remote.manager
    if (manager === null || row.write !== 'writable' || writingRef.current) return
    writingRef.current = true
    setPending({ entryId: row.entryId, enabled: next })
    setNotice(undefined)
    void (async () => {
      let outcome
      try {
        outcome = readChangeResult(await manager.setPluginEnabled(row.entryId, next))
      } catch (error) {
        warnFailure('built-in group write failed', error)
        outcome = { ok: false as const, code: FALLBACK_CODE }
      }
      writingRef.current = false
      setPending(undefined)
      if (!outcome.ok) {
        setNotice({
          tone: 'error',
          text: t(next ? 'builtinFailedEnable' : 'builtinFailedDisable', { reason: refusalText(outcome.code, t) }),
        })
        return
      }
      // A resolved write is not always a state the page will keep: the next start
      // loads a restart-required change, and a higher profile layer wins over an
      // overridden one. The re-read below is what makes the switch show the Loader
      // either way; this line is what tells the reader which of the two happened.
      // A restart-required write is not a success: the change is on disk and the
      // running process still serves the old state, so it is said in the same
      // passing tone as an overridden one.
      setNotice(outcome.application === 'restart-required'
        ? { tone: 'note', text: t('builtinRestartRequired', { reason: restartReason(outcome.restartReason, t) }) }
        : outcome.application === 'overridden'
          ? { tone: 'note', text: t('builtinOverridden', { name: rowTitle(row, resolveText) }) }
          : undefined)
      setReload(token => token + 1)
    })()
  }

  return (
    <section
      className={css.builtinGroup}
      data-dsh-plugin="plugin-manager"
      data-dsh-part="builtin-group"
      data-builtin-state={state.kind}
      data-builtin-bundles={state.kind === 'ready' ? state.bundles : undefined}
      data-builtin-scope={scope}
      aria-busy={state.kind === 'loading'}
    >
      <div className={css.builtinHead}>
        <h3 className={css.builtinTitle}>{t('builtinGroup')}</h3>
        {ready !== undefined && ready.bundles === 'confirmed' && (
          <span className={css.builtinCount} data-builtin-count={rows.length}>{rows.length}</span>
        )}
        {ownedCount > 0 && (
          <button
            type="button"
            className={css.builtinScope}
            data-dsh-part="builtin-scope"
            aria-expanded={scope === 'all'}
            aria-controls={listId}
            onClick={() => { setScope(scope === 'all' ? 'default' : 'all') }}
          >
            {t(scope === 'all' ? 'builtinScopeCollapse' : 'builtinScopeExpand', { count: String(ownedCount) })}
          </button>
        )}
      </div>

      {state.kind === 'loading' && <p className={css.hint} role="status">{t('builtinReading')}</p>}
      {state.kind === 'unavailable' && <p className={css.hint}>{t('builtinUnavailable')}</p>}
      {state.kind === 'failed' && (
        <p className={css.error} role="alert">{t('builtinFailed', { reason: state.code })}</p>
      )}
      {state.kind === 'ready' && state.bundles === 'unconfirmed' && (
        <p className={css.hint} data-builtin-unconfirmed>{t('builtinUnconfirmed')}</p>
      )}
      {notice !== undefined && (
        <p
          className={notice.tone === 'error' ? css.error : css.hint}
          role={notice.tone === 'error' ? 'alert' : 'status'}
          data-dsh-part="builtin-notice"
          data-notice-tone={notice.tone}
        >
          {notice.text}
        </p>
      )}
      {ready !== undefined && rows.length === 0 && <p className={css.hint}>{t('builtinEmpty')}</p>}

      {rows.length > 0 && (
        <ul className={css.builtinList} id={listId}>
          {rows.map(row => {
            const title = rowTitle(row, resolveText)
            const reason = writeReason(row.write, t)
            const locked = row.write !== 'writable'
            const checked = pending?.entryId === row.entryId ? pending.enabled : row.enabled
            return (
              <li
                key={row.entryId}
                className={css.builtinRow}
                data-dsh-part="builtin-row"
                data-entry-id={row.entryId}
                data-write={row.write}
                data-owned-by={row.ownedBy}
              >
                <span className={css.builtinMain}>
                  <span className={css.builtinName}>{title}</span>
                  <span className={css.builtinModule}>
                    {title === row.moduleName ? row.entryId : row.moduleName}
                  </span>
                  {collides(row.entryId) && (
                    <span className={css.builtinModule} data-entry-revealed={row.entryId}>{row.entryId}</span>
                  )}
                  {row.ownedBy !== undefined && row.ownedBy !== '' && (
                    <span className={css.builtinOwner} data-dsh-part="builtin-owner">
                      {t('builtinOwnedBy', { name: row.ownedBy })}
                    </span>
                  )}
                  {locked && <span className={css.builtinReason}>{reason}</span>}
                </span>
                <Switch
                  checked={checked}
                  label={t('builtinToggle', { name: title })}
                  disabled={locked || pending !== undefined || remote.manager === null}
                  {...locked ? { title: reason } : {}}
                  onChange={next => { toggle(row, next) }}
                />
              </li>
            )
          })}
        </ul>
      )}

      {presets.length > 0 && (
        <section className={css.presetGroup} data-dsh-part="preset-group">
          <h4 className={css.presetTitle}>{t('presetGroup')}</h4>
          <ul className={css.presetList}>
            {presets.map(preset => (
              <li
                key={preset.id}
                className={css.presetCard}
                data-dsh-part="preset"
                data-preset-id={preset.id}
                data-default={preset.isDefault ? 'yes' : 'no'}
              >
                <span className={css.presetHead}>
                  <span className={css.presetName}>{preset.name ?? preset.id}</span>
                  {preset.isDefault && <span className={css.presetTag}>{t('presetDefault')}</span>}
                </span>
                {preset.broken === undefined ? (
                  <ul className={css.presetRows}>
                    {preset.rows.map((row, index) => (
                      <li
                        key={row.entryId ?? `${preset.id}:${String(index)}`}
                        className={css.presetRow}
                        data-dsh-part="preset-row"
                        data-preset-state={presetRowState(row)}
                      >
                        <span className={css.presetRowName}>{row.moduleName}</span>
                        <span className={css.presetRowState}>{presetRowText(row, t)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={css.hint}>{t('presetBroken', { reason: preset.broken })}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
