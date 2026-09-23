/**
 * Models-page provider-card extension area: per-model capability declarations
 * and the provider disable/enable toggle for one pi-ai provider route.
 *
 * The slot owner passes the card's directory row (`provider.settingsNs` /
 * `provider.settingsPath` address the profile inside the settings document)
 * and the apply body injects the settings namespace face plus the refresh
 * bus; this panel reads the redacted entry views over the remote settings
 * wire, drafts reasoning-effort declarations per model, and saves them as one
 * whole-array path op with revision fencing — the same write granularity and
 * conflict posture the official card uses. Model input types belong to the
 * Models page's own editor since 0.1.6-alpha.2, so the draft preserves the
 * `input` claim instead of rewriting it.
 *
 * The toggle uses this plugin's own settings entry: disabling stashes the
 * user-layer profile and unsets `providers.<route>` (the official
 * Remove-provider seam), which takes the provider out of the model catalog
 * both pickers read; enabling restores it. A missing entry or a refused
 * read renders the failure inline, never a blank.
 * @module @linxin666/dsh-client-ui-model-capabilities/client/CapabilitiesPanel
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ProviderCardExtrasOwnerProps } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-settings/types'
import {
  buildModelsOp,
  declaredLevelsOf,
  effortsModeOf,
  modelsArrayOf,
  readAt,
  sanitizeEntry,
  THINKING_LEVELS,
  validateEntry,
  withEffortsMode,
  COMMON_EFFORTS_PRESET,
  type CapabilitiesIssue,
  type ModelEntryDraft,
  type ModelThinkingLevel,
} from '../core/capabilities.ts'
import { hasNonUserProfile, hasProfileAt, readDisabledStore, resolveArchiveEntry } from '../core/provider-toggle.ts'
import { disableProvider, enableProvider } from './provider-toggle.ts'
import type { SettingsNamespaceFace } from './settings-face.ts'
import { t } from './locales.ts'
import css from './capabilities.module.css'

export type { SettingsNamespaceFace } from './settings-face.ts'
import type { RefreshBus } from './settings-face.ts'

/** Component props: the slot's owner share plus the injected faces. */
export interface CapabilitiesPanelProps extends ProviderCardExtrasOwnerProps {
  /** The generated remote settings namespace (extracted by the apply body, which declares the dotted inject). */
  settings: SettingsNamespaceFace
  /** Cross-surface refresh bus plus the surface for disable/enable; absent keeps the capability editor only. */
  refresh?: RefreshBus
}

/** One view snapshot the panel renders from. */
interface Snapshot {
  /** Effective entries: the user layer's array when it owns one, else the resolved one. */
  entries: ModelEntryDraft[]
  /** True when the array came from a non-user layer (first save materializes the override). */
  inherited: boolean
  /** Namespace revision the snapshot was read at (the write's fence). */
  revision: number
  /** Whether the settings provider accepts writes. */
  writable: boolean
  /** Whether the pi-ai user layer holds this provider's profile (the unit a disable archives). */
  userProfile: boolean
  /** Whether another layer (the composition base) also holds the route, so a disable could not take it down. */
  baseProfile: boolean
  /** Whether the provider is currently disabled (archived and taken down). */
  disabledHere: boolean
  /** Whether the plugin's archive entry answered (disable needs it). */
  capsKnown: boolean
}

type Phase = { kind: 'loading' } | { kind: 'error', message: string } | { kind: 'ready' }

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'failed', message: string }

type ToggleBusy = 'disabling' | 'enabling' | undefined

/** Extract a display text from a remote failure (the host diagnostic, or its code). */
function failureText(error: RemoteFailure): string {
  return typeof error.message === 'string' && error.message.length > 0 ? error.message : error.code
}

/** Deep-clone one entry through JSON so draft edits never alias stored state. */
function cloneEntry(entry: ModelEntryDraft): ModelEntryDraft {
  return JSON.parse(JSON.stringify(sanitizeEntry(entry))) as ModelEntryDraft
}

/**
 * Render the capability editor for one provider card.
 * @param props - the card's directory row, its configured facts, and the injected faces.
 * @returns the extension area.
 */
export function CapabilitiesPanel(props: CapabilitiesPanelProps) {
  const { provider, settings, refresh } = props
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(undefined)
  const [draft, setDraft] = useState<ModelEntryDraft[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [toggleBusy, setToggleBusy] = useState<ToggleBusy>(undefined)
  const [toggleFailure, setToggleFailure] = useState<string | undefined>(undefined)
  const [toggleConflict, setToggleConflict] = useState(false)
  const [staleDraft, setStaleDraft] = useState(false)
  /** Revision the open draft was read from (the write's fence while it is open). */
  const draftBasis = useRef<number | undefined>(undefined)

  const settingsPath = useMemo(() => [...provider.settingsPath], [provider.settingsPath])
  /** The models array lives one level below the profile the settings path addresses. */
  const modelsPath = useMemo(() => [...settingsPath, 'models'], [settingsPath])
  const entries = draft ?? snapshot?.entries ?? []

  const load = useCallback(async (face: SettingsNamespaceFace) => {
    setPhase({ kind: 'loading' })
    try {
      const described = await face.describe()
      if (!described.ok) throw new Error(failureText(described.error))
      const namespaces = described.value.namespaces
      const view = namespaces.find(candidate => candidate.ns === provider.settingsNs)
      if (view === undefined) {
        throw new Error(`settings entry "${provider.settingsNs}" is not served on this host`)
      }
      const archive = resolveArchiveEntry(namespaces)
      const stash = readDisabledStore(archive?.view.value)
      const userProfile = hasProfileAt(view.user, provider.provider)
      const userModels = modelsArrayOf(readAt(view.user, modelsPath))
      const effective = userModels ?? modelsArrayOf(readAt(view.value, modelsPath)) ?? []
      // An open draft keeps its own basis revision: a background refresh must
      // neither drop unsaved edits nor let them ride a newer revision (the save
      // stays fenced where the draft was read, so a moved document conflicts).
      const basis = draftBasis.current
      setSnapshot({
        entries: effective,
        inherited: userModels === undefined,
        revision: basis ?? view.revision,
        writable: described.value.writable,
        userProfile,
        baseProfile: hasNonUserProfile(view, provider.provider),
        disabledHere: stash[provider.provider] !== undefined && !userProfile,
        capsKnown: archive !== undefined,
      })
      if (basis === undefined) setDraft(null)
      setStaleDraft(basis !== undefined && basis !== view.revision)
      setPhase({ kind: 'ready' })
    } catch (error) {
      setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [modelsPath, provider.provider, provider.settingsNs])

  useEffect(() => {
    void load(settings)
  }, [load, settings])

  useEffect(() => {
    return refresh?.subscribe(() => { void load(settings) })
  }, [load, refresh, settings])

  const editing = phase.kind === 'ready' && snapshot !== undefined
  const readOnly = editing && !snapshot.writable
  const dirty = draft !== null
  const disabledHere = editing && snapshot.disabledHere
  const toggleUnavailable = !editing || !snapshot.capsKnown || readOnly || toggleBusy !== undefined

  const updateEntry = (index: number, next: ModelEntryDraft) => {
    if (!editing || readOnly) return
    if (draft === null) draftBasis.current = snapshot.revision
    setDraft(current => {
      const base = current ?? snapshot.entries.map(cloneEntry)
      const clone = base.map(entry => ({ ...entry }))
      clone[index] = next
      return clone
    })
    setSave({ kind: 'idle' })
  }

  const discard = () => {
    draftBasis.current = undefined
    setStaleDraft(false)
    setDraft(null)
    setSave({ kind: 'idle' })
  }

  const firstIssue = useMemo<CapabilitiesIssue | undefined>(() => {
    for (const entry of draft ?? []) {
      const issue = validateEntry(entry)
      if (issue !== undefined) return issue
    }
    return undefined
  }, [draft])

  const doSave = async () => {
    if (!editing || readOnly || draft === null || snapshot === undefined) return
    if (firstIssue !== undefined) return
    const op = buildModelsOp(settingsPath, draft)
    setSave({ kind: 'saving' })
    try {
      const written = await settings.mutate(provider.settingsNs, [op], snapshot.revision)
      if (written.ok) {
        const userModels = modelsArrayOf(readAt(written.value.user, modelsPath)) ?? []
        setSnapshot(current => current === undefined ? current : {
          ...current,
          entries: userModels,
          inherited: false,
          revision: written.value.revision,
          userProfile: true,
        })
        draftBasis.current = undefined
        setStaleDraft(false)
        setDraft(null)
        setSave({ kind: 'saved' })
        return
      }
      if (written.error.code === 'settings/conflict') {
        // The document moved under the draft: reload to the stored state and let
        // the user re-apply, exactly the posture the official card takes.
        draftBasis.current = undefined
        setStaleDraft(false)
        setSave({ kind: 'conflict' })
        await load(settings)
        return
      }
      setSave({ kind: 'failed', message: failureText(written.error) })
    } catch (error) {
      setSave({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const applyToggleOutcome = async (outcome: Awaited<ReturnType<typeof disableProvider>>) => {
    if (outcome.kind === 'ok') {
      setToggleFailure(undefined)
      setToggleConflict(false)
      refresh?.notify()
      await load(settings)
      return
    }
    if (outcome.kind === 'conflict') {
      setToggleFailure(undefined)
      setToggleConflict(true)
      await load(settings)
      return
    }
    if (outcome.kind === 'route-exists') setToggleFailure(t('caps.error.routeExists'))
    else if (outcome.kind === 'base-profile') setToggleFailure(t('caps.error.baseProfile'))
    else if (outcome.kind === 'unavailable') setToggleFailure(t('caps.error.unavailable'))
    else if (outcome.kind === 'partial') setToggleFailure(t('caps.error.partialEnable', { error: outcome.message }))
    else setToggleFailure(t('caps.failed', { error: outcome.kind }))
    // A failed toggle can still have moved a namespace (a partial enable put the
    // route back), so re-read instead of leaving a stale disabled view.
    await load(settings)
  }

  const doDisable = async () => {
    if (toggleUnavailable || snapshot === undefined || !snapshot.userProfile || snapshot.baseProfile) return
    setToggleBusy('disabling')
    setToggleFailure(undefined)
    setToggleConflict(false)
    try {
      await applyToggleOutcome(await disableProvider(settings, provider.settingsNs, provider.provider, provider.displayName))
    } finally {
      setToggleBusy(undefined)
    }
  }

  const doEnable = async () => {
    if (toggleUnavailable) return
    setToggleBusy('enabling')
    setToggleFailure(undefined)
    setToggleConflict(false)
    try {
      await applyToggleOutcome(await enableProvider(settings, provider.settingsNs, provider.provider))
    } finally {
      setToggleBusy(undefined)
    }
  }

  return (
    <section className={css.panel} data-dsh-plugin="model-capabilities" data-dsh-part="panel">
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        data-dsh-part="toggle"
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.title}>{t('caps.title')}</span>
        {disabledHere ? <span className={css.offBadge}>{t('caps.state.badge')}</span> : null}
        {dirty ? <span className={css.pending}>{t('caps.dirty')}</span> : null}
        <svg
          width="12"
          height="12"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
          className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron}
        >
          <path d="M2.5 5l4.5 4.5L11.5 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open
        ? (
            <div className={css.body}>
              <p className={css.hint}>{t('caps.hint')}</p>
              {phase.kind === 'loading' ? <p className={css.status} role="status">{t('caps.loading')}</p> : null}
              {phase.kind === 'error'
                ? (
                    <div className={css.statusRow}>
                      <p className={css.failed} role="alert">{t('caps.loadFailed', { error: phase.message })}</p>
                      <button type="button" className={css.ghost} data-dsh-part="reload" onClick={() => { void load(settings) }}>
                        {t('caps.reload')}
                      </button>
                    </div>
                  )
                : null}
              {phase.kind === 'ready' && snapshot !== undefined
                ? (
                    <>
                      {disabledHere
                        ? (
                            <div className={css.disabledBox} data-dsh-part="disabled-state">
                              <p className={css.status} role="status">{t('caps.state.disabled')}</p>
                              <button
                                type="button"
                                className={css.ghost}
                                data-dsh-part="enable"
                                disabled={toggleUnavailable}
                                onClick={() => { void doEnable() }}
                              >
                                {toggleBusy === 'enabling' ? t('caps.busy.enabling') : t('caps.action.enable')}
                              </button>
                            </div>
                          )
                          : (
                              <>
                                {readOnly ? <p className={css.readOnly} role="status">{t('caps.readOnly')}</p> : null}
                                {snapshot.entries.length === 0
                                  ? <p className={css.status} role="status">{t('caps.empty')}</p>
                                  : (
                                      <ul className={css.rows}>
                                        {entries.map((entry, index) => (
                                          <ModelRow
                                            key={typeof entry.id === 'string' ? entry.id : index}
                                            entry={entry}
                                            expanded={expandedId === entry.id}
                                            disabled={readOnly}
                                            onToggle={() => { setExpandedId(expandedId === entry.id ? null : entry.id) }}
                                            onChange={next => { updateEntry(index, next) }}
                                          />
                                        ))}
                                      </ul>
                                    )}
                              </>
                            )}
                      <div className={css.footer}>
                        {staleDraft ? <p className={css.notice} role="status">{t('caps.staleDraft')}</p> : null}
                        {save.kind === 'saved' ? <p className={css.status} role="status">{t('caps.saved')}</p> : null}
                        {save.kind === 'conflict' || toggleConflict ? <p className={css.failed} role="alert">{t('caps.conflict')}</p> : null}
                        {save.kind === 'failed' ? <p className={css.failed} role="alert">{t('caps.failed', { error: save.message })}</p> : null}
                        {toggleFailure !== undefined ? <p className={css.failed} role="alert">{toggleFailure}</p> : null}
                        {firstIssue?.kind === 'effortsWireMissing'
                          ? <p className={css.failed} role="alert">{t('caps.invalid.wire', { level: firstIssue.level })}</p>
                          : null}
                        {firstIssue?.kind === 'effortsOffOnly'
                          ? <p className={css.failed} role="alert">{t('caps.invalid.offOnly')}</p>
                          : null}
                        <span className={css.spacer} />
                        {!disabledHere && snapshot.userProfile && !snapshot.baseProfile && snapshot.capsKnown
                          ? (
                              <button
                                type="button"
                                className={css.danger}
                                data-dsh-part="disable"
                                title={t('caps.disable.hint')}
                                disabled={toggleUnavailable || dirty}
                                onClick={() => { void doDisable() }}
                              >
                                {toggleBusy === 'disabling' ? t('caps.busy.disabling') : t('caps.action.disable')}
                              </button>
                            )
                          : null}
                        {!disabledHere
                          ? (
                              <button
                                type="button"
                                className={css.ghost}
                                data-dsh-part="reset"
                                disabled={!dirty || save.kind === 'saving'}
                                onClick={discard}
                              >
                                {t('caps.discard')}
                              </button>
                            )
                          : null}
                        {!disabledHere
                          ? (
                              <button
                                type="button"
                                className={css.primary}
                                data-dsh-part="save"
                                disabled={!dirty || readOnly || save.kind === 'saving' || firstIssue !== undefined}
                                onClick={() => { void doSave() }}
                              >
                                {save.kind === 'saving' ? t('caps.saving') : t('caps.save')}
                              </button>
                            )
                          : null}
                      </div>
                    </>
                  )
                : null}
            </div>
          )
        : null}
    </section>
  )
}

/** Props of one model's capability row. */
interface ModelRowProps {
  /** The draft entry this row edits. */
  entry: ModelEntryDraft
  /** Whether the editor body is expanded. */
  expanded: boolean
  /** Disables every control (read-only document). */
  disabled: boolean
  /** Expand/collapse toggle. */
  onToggle: () => void
  /** Stage the next entry draft. */
  onChange: (next: ModelEntryDraft) => void
}

/**
 * One model row: a collapsed summary header (reasoning levels) and the
 * expanded tri-state editor with per-level wire spellings.
 */
function ModelRow(props: ModelRowProps) {
  const { entry, expanded, disabled, onToggle, onChange } = props
  const radioName = useId()
  const mode = effortsModeOf(entry)
  const levels = declaredLevelsOf(entry)

  /** Stored wire map (editors toggle against it). */
  const storedLevels = () => new Map(levels.map(({ level, wire }) => [level, wire] as const))

  const setEffortsMode = (next: 'inherit' | 'none' | 'levels') => {
    if (next === 'levels') {
      const stored = storedLevels()
      if (stored.size === 0) {
        // A fresh declaration materializes the common preset instead of an
        // empty dict, which the adapter would refuse.
        for (const [level, wire] of COMMON_EFFORTS_PRESET) stored.set(level, wire)
      }
      onChange(withEffortsMode(entry, 'levels', stored))
      return
    }
    onChange(withEffortsMode(entry, next))
  }

  const toggleLevel = (level: ModelThinkingLevel) => {
    const stored = storedLevels()
    if (stored.has(level)) stored.delete(level)
    else stored.set(level, level === 'off' ? '' : level)
    onChange(withEffortsMode(entry, 'levels', stored))
  }

  const setWire = (level: ModelThinkingLevel, wire: string) => {
    const stored = storedLevels()
    stored.set(level, wire)
    onChange(withEffortsMode(entry, 'levels', stored))
  }

  const applyCommonPreset = () => {
    onChange(withEffortsMode(entry, 'levels', new Map(COMMON_EFFORTS_PRESET.map(([level, wire]) => [level, wire] as const))))
  }

  const summaryChips: string[] = []
  if (mode === 'none') summaryChips.push(t('caps.summary.noReasoning'))
  else if (mode === 'levels') {
    const named = levels.filter(({ level }) => level !== 'off').map(({ level }) => level)
    if (named.length > 0) summaryChips.push(t('caps.summary.efforts', { levels: named.join('/') }))
  }

  return (
    <li className={css.row} data-dsh-part="model-row">
      <button
        type="button"
        className={css.rowHeader}
        aria-expanded={expanded}
        aria-label={`${t(expanded ? 'caps.model.collapse' : 'caps.model.expand')}: ${entry.id}`}
        data-dsh-part="model-toggle"
        onClick={onToggle}
      >
        <span className={css.modelId}>{entry.id}</span>
        {typeof entry.name === 'string' && entry.name.length > 0 ? <span className={css.modelName}>{entry.name}</span> : null}
        <span className={css.chips}>
          {summaryChips.map(chip => <span key={chip} className={css.chip}>{chip}</span>)}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
          className={expanded ? `${css.chevron} ${css.chevronOpen}` : css.chevron}
        >
          <path d="M2.5 5l4.5 4.5L11.5 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {expanded
        ? (
            <div className={css.rowBody}>
              <div className={css.field} data-dsh-part="efforts-mode">
                <span className={css.fieldLabel}>{t('caps.model.efforts')}</span>
                <div className={css.modeGroup} role="radiogroup" aria-label={t('caps.model.efforts')}>
                  {(
                    [
                      ['inherit', t('caps.efforts.inherit'), t('caps.efforts.inheritHint')],
                      ['none', t('caps.efforts.none'), t('caps.efforts.noneHint')],
                      ['levels', t('caps.efforts.levels'), t('caps.efforts.levelsHint')],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <label key={value} className={mode === value ? `${css.modeOption} ${css.modeOptionActive}` : css.modeOption} title={hint}>
                      <input
                        type="radio"
                        name={`${radioName}-efforts`}
                        value={value}
                        checked={mode === value}
                        disabled={disabled}
                        onChange={() => { setEffortsMode(value) }}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <p className={css.hint}>
                  {mode === 'inherit' ? t('caps.efforts.inheritHint') : mode === 'none' ? t('caps.efforts.noneHint') : t('caps.efforts.levelsHint')}
                </p>
              </div>
              {mode === 'levels'
                ? (
                    <div className={css.levels}>
                      <button type="button" className={css.ghost} disabled={disabled} onClick={applyCommonPreset}>
                        {t('caps.preset.common')}
                      </button>
                      <div className={css.levelChips}>
                        {THINKING_LEVELS.map(level => {
                          const active = levels.some(({ level: declared }) => declared === level)
                          return (
                            <button
                              key={level}
                              type="button"
                              className={active ? `${css.levelChip} ${css.levelChipActive}` : css.levelChip}
                              aria-pressed={active}
                              disabled={disabled}
                              onClick={() => { toggleLevel(level) }}
                            >
                              {level}
                            </button>
                          )
                        })}
                      </div>
                      {levels.map(({ level, wire }) => (
                        <div key={level} className={css.wireRow} data-dsh-part="wire-input">
                          <label className={css.wireLabel} htmlFor={`${radioName}-wire-${level}`}>
                            <code>{level}</code>
                            <span>{t('caps.wire.label')}</span>
                          </label>
                          <input
                            id={`${radioName}-wire-${level}`}
                            className={css.wireInput}
                            type="text"
                            value={wire}
                            placeholder={level}
                            disabled={disabled}
                            onChange={event => { setWire(level, event.target.value) }}
                          />
                        </div>
                      ))}
                      {levels.some(({ level }) => level === 'off') ? <p className={css.hint}>{t('caps.wire.offHint')}</p> : null}
                    </div>
                  )
                : null}
            </div>
          )
        : null}
    </li>
  )
}
