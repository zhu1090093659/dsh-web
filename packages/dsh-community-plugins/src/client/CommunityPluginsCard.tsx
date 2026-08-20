/**
 * The community plugin index card: a first-level settings section that is
 * always open. Its own enable switch (backed by the community-plugins
 * settings namespace) gates the list, which is presented marketplace-style:
 * a search box, category filter pills with counts, and a two-column card grid
 * whose entries link to contributors' own repositories — this package only
 * indexes them, it never vendors their code.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import { COMMUNITY_PLUGINS, type CommunityPluginCategory, type CommunityPluginEntry } from './generated/community.ts'
import { isCommunityPluginEntry } from './community-guard.ts'
import {
  getPluginManagerSnapshot,
  subscribePluginManager,
  type InstalledPluginItem,
  type InstallProgressItem,
  type PluginManagerService,
} from './plugin-manager-bridge.ts'
import { entryInstalled, installSpec } from './install-source.ts'
import css from './community.module.css'

/** The settings fields this card edits (the namespace's full schema). */
export interface CommunityPluginsSettings {
  /** Master switch for the index card. */
  enabled?: boolean
}

/** What the community plugin card renders. */
export interface CommunityPluginsCardState extends CardShell {
  /** Master switch. */
  enabled: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface CommunityPluginsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useCommunityPluginsCard. */
    communityPluginsCard: SnapshotStore<CommunityPluginsCardState>
  }
}

/** Bridges the community-plugins scope onto the card's staged form. */
export class CommunityPluginsCardController {
  private readonly form: CardForm<CommunityPluginsSettings>
  private readonly store: SnapshotStore<CommunityPluginsCardState>

  /** @param scope - the bound settings scope for the community-plugins namespace. */
  constructor(scope: SettingsScope<CommunityPluginsSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): CommunityPluginsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): CommunityPluginsCardFace {
    return { hooks: { communityPluginsCard: this.store }, ...this.form.actions() }
  }

  /**
   * Release the card's scope subscription and bound stores; the slot
   * disposer calls this on teardown.
   */
  dispose(): void {
    this.form.dispose()
  }
}

/** The one-line install command for an entry: npm package when published, else the contributor repository URL. */
function installCommand(entry: CommunityPluginEntry): string {
  return `dsh plugin --profile web add ${entry.npm ?? entry.repo}`
}

/** Progress polling cadence while an install is in flight. */
const PROGRESS_POLL_MS = 500

/** Extract a displayable reason from an install/uninstall rejection. */
function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/** One in-flight mutation, keyed by the community entry id (drives per-card state). */
interface PendingMutation {
  readonly kind: 'install' | 'uninstall'
  readonly id: string
}

/**
 * Localized entry copy read through the card's `t`. Falls back to the raw
 * entry field when the key is missing — the dictionary only carries the
 * generated registry, so injected test entries land on the fallback.
 */
function entryCopy(t: (key: string) => string, key: string, fallback: string): string {
  const value = t(key)
  return value === key ? fallback : value
}

/** Maps a category id onto its locale dictionary key (kept in the generated union). */
const CATEGORY_KEY: Record<CommunityPluginCategory, `category.${CommunityPluginCategory}`> = {
  ui: 'category.ui',
  agent: 'category.agent',
  tools: 'category.tools',
  knowledge: 'category.knowledge',
  integration: 'category.integration',
  security: 'category.security',
  utility: 'category.utility',
}

/** Props the renderer binds for the community plugin card. */
export type CommunityPluginsCardProps =
  PropsLocale<'community-plugins'>
  & InjectFace<CommunityPluginsCardFace>
  & {
    /** Index entries; defaults to the generated registry (injected for tests). */
    plugins?: readonly CommunityPluginEntry[]
    /**
     * Plugin-manager face override; undefined reads the bridged cordis
     * service (the default), null forces the degraded copy-command UI
     * (injected for tests).
     */
    pluginManager?: PluginManagerService | null
  }

/**
 * Render the community plugin index card.
 * @param props - locale copy, the card snapshot, its form actions, and the
 *   (default-generated) entry list.
 * @returns the card.
 */
export function CommunityPluginsCard(props: CommunityPluginsCardProps): ReactNode {
  const { t } = props
  const state = props.useCommunityPluginsCard(snapshot => snapshot)
  // Memoized so the categoryCounts/visiblePlugins caches below only
  // recompute when the registry actually changes, not on every keystroke.
  const plugins = useMemo(() => (props.plugins ?? COMMUNITY_PLUGINS).filter(isCommunityPluginEntry), [props.plugins])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CommunityPluginCategory | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // The optional pluginManager service: undefined prop reads the bridge store
  // (populated by ctx.inject in the client apply), an explicit prop wins.
  const bridge = useSyncExternalStore(subscribePluginManager, getPluginManagerSnapshot)
  const face = props.pluginManager !== undefined ? props.pluginManager : bridge.face
  const faceLoopback = face !== null && face.isLoopback
  // A bridge version can change while cordis re-provides the same face
  // reference. Give every committed provision its own lifetime so async
  // completions from the previous one cannot mutate the replacement UI.
  const faceRevision = props.pluginManager !== undefined ? face : bridge.version
  const faceLifetime = useMemo(() => ({ active: true }), [face, faceRevision])
  useLayoutEffect(() => {
    faceLifetime.active = true
    return () => { faceLifetime.active = false }
  }, [faceLifetime])

  // Installed snapshot served by the face (null = not loaded / no face).
  const [installed, setInstalled] = useState<readonly InstalledPluginItem[] | null>(null)
  // The one in-flight mutation; while set, every card's mutation buttons disable.
  const [pending, setPending] = useState<PendingMutation | null>(null)
  // Latest polled install progress (only meaningful while an install runs).
  const [progress, setProgress] = useState<InstallProgressItem | null>(null)
  // Per-card inline error lines, keyed by entry id.
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  // The entry awaiting uninstall confirmation.
  const [uninstallTarget, setUninstallTarget] = useState<CommunityPluginEntry | null>(null)
  // Latest-issued list request wins. An earlier request may complete after a
  // mutation refresh even when the service face itself did not change.
  const listRequestRef = useRef(0)

  // Keep the installed snapshot in sync with the face: initial load, plus
  // onChange so edits made in the Plugin manager tab reflect here. Only
  // loopback faces are queried — remote browsers render the read-only index.
  useEffect(() => {
    // An operation belongs to the face that started it. Once that face is
    // replaced, release its local UI lock and discard its dialog/error state;
    // the new face's list request below becomes authoritative.
    setPending(null)
    setProgress(null)
    setErrors({})
    setUninstallTarget(null)
    listRequestRef.current += 1
    if (face === null || !face.isLoopback) {
      setInstalled(null)
      return
    }
    let alive = true
    const refresh = (): void => {
      const request = ++listRequestRef.current
      void face.list().then(
        (list) => {
          if (alive && faceLifetime.active && request === listRequestRef.current) setInstalled(list)
        },
        () => { /* keep the last known snapshot on transient failures */ },
      )
    }
    refresh()
    const unsubscribe = face.onChange(refresh)
    return () => { alive = false; unsubscribe() }
  }, [face, faceLoopback, faceLifetime])

  // Poll the host's install progress while an install is in flight; the
  // first poll runs immediately so the stage line appears without delay.
  useEffect(() => {
    if (face === null || pending?.kind !== 'install') {
      setProgress(null)
      return
    }
    let alive = true
    const poll = (): void => {
      void face.status().then(
        (item) => { if (alive && faceLifetime.active) setProgress(item) },
        () => { /* transient poll failure: keep the last known stage */ },
      )
    }
    poll()
    const timer = setInterval(poll, PROGRESS_POLL_MS)
    return () => { alive = false; clearInterval(timer) }
    // Keyed on the boolean, not the entry: restarting the poll per entry is unnecessary.
  }, [face, faceLifetime, pending?.kind === 'install'])

  const clearError = (id: string): void => {
    setErrors((previous) => {
      if (!(id in previous)) return previous
      const next = { ...previous }
      delete next[id]
      return next
    })
  }

  const onInstall = (entry: CommunityPluginEntry): void => {
    if (face === null || !face.isLoopback || pending !== null) return
    const lifetime = faceLifetime
    clearError(entry.id)
    setPending({ kind: 'install', id: entry.id })
    void (async () => {
      try {
        await face.install(installSpec(entry))
        if (!lifetime.active) return
        const request = ++listRequestRef.current
        const list = await face.list().catch(() => undefined)
        if (lifetime.active && list !== undefined && request === listRequestRef.current) setInstalled(list)
      } catch (reason) {
        if (!lifetime.active) return
        setErrors((previous) => ({ ...previous, [entry.id]: t('installFailed', { reason: messageOf(reason) }) }))
      } finally {
        if (lifetime.active) setPending(null)
      }
    })()
  }

  const onUninstallConfirm = (): void => {
    const target = uninstallTarget
    if (face === null || target === null || pending !== null) return
    const item = entryInstalled(target, installed ?? [])
    clearError(target.id)
    if (item === null) {
      // Already gone (e.g. uninstalled from the Plugin manager tab): close quietly.
      setUninstallTarget(null)
      return
    }
    const lifetime = faceLifetime
    setPending({ kind: 'uninstall', id: target.id })
    face.uninstall(item.id).then(
      (list) => {
        if (!lifetime.active) return
        listRequestRef.current += 1
        setInstalled(list)
        setUninstallTarget(null)
      },
      (reason: unknown) => {
        if (!lifetime.active) return
        setErrors((previous) => ({ ...previous, [target.id]: t('uninstallFailed', { reason: messageOf(reason) }) }))
        setUninstallTarget(null)
      },
    ).finally(() => { if (lifetime.active) setPending(null) })
  }

  const copyCommand = (id: string, command: string): void => {
    const mark = (): void => { setCopiedId(id) }
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
    if (clipboard?.writeText !== undefined) {
      void clipboard.writeText(command).then(mark, mark)
      return
    }
    // Fallback for browsers without the async clipboard API (or tests).
    try {
      const area = document.createElement('textarea')
      area.value = command
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.append(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    } catch { /* the command stays visible to select by hand */ }
    mark()
  }
  const disabled = !state.writable
  // One in-flight install/uninstall locks every card's mutation buttons.
  const mutationsDisabled = disabled || pending !== null
  // The draft text drives the list: '' (inherit) and 'true' keep it visible,
  // 'false' hides it until the switch is turned back on.
  const visible = state.enabled.text !== 'false'
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
  }

  // Category pills in descending count (stable tie-break by id).
  const categoryCounts = useMemo(() => {
    const counts = new Map<CommunityPluginCategory, number>()
    for (const plugin of plugins) {
      if (plugin.category) counts.set(plugin.category, (counts.get(plugin.category) ?? 0) + 1)
    }
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )
  }, [plugins])

  // Both the active pill and the search text narrow the list (AND).
  const visiblePlugins = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return plugins.filter((plugin) => {
      if (category !== null && plugin.category !== category) return false
      if (!needle) return true
      const categoryLabel = plugin.category ? t(CATEGORY_KEY[plugin.category]) : ''
      const haystack = [plugin.name, plugin.nameEn, plugin.author, plugin.description, plugin.descriptionEn, plugin.npm ?? '', categoryLabel]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [plugins, query, category, t])

  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      state={state}
      alwaysOpen
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-community-enabled"
        label={t('settings.enabled')}
        hint={t('settings.enabledHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.enabled}
        onEdit={(text) => { props.edit('enabled', text) }}
        onReset={() => { props.resetField('enabled') }}
      />
      {visible
        ? (
          <div className={css.market}>
            <div className={css.toolbar}>
              <input
                id="settings-community-search"
                className={css.search}
                type="search"
                placeholder={t('search.placeholder')}
                aria-label={t('search.label')}
                value={query}
                disabled={disabled}
                onChange={(event) => { setQuery(event.target.value) }}
              />
            </div>
            <div className={css.filters} role="group" aria-label={t('filter.all')}>
              <button
                type="button"
                className={category === null ? `${css.pill} ${css.pillActive}` : css.pill}
                aria-pressed={category === null}
                disabled={disabled}
                onClick={() => { setCategory(null) }}
              >
                {t('filter.all')} {plugins.length}
              </button>
              {categoryCounts.map(([id, count]) => (
                <button
                  key={id}
                  type="button"
                  className={category === id ? `${css.pill} ${css.pillActive}` : css.pill}
                  aria-pressed={category === id}
                  disabled={disabled}
                  onClick={() => { setCategory(category === id ? null : id) }}
                >
                  {t(CATEGORY_KEY[id])} {count}
                </button>
              ))}
            </div>
            <p className={css.resultCount} role="status">
              {t('result.count', { shown: visiblePlugins.length, total: plugins.length })}
            </p>
            {plugins.length === 0
              ? <p className={css.empty} role="status">{t('empty')}</p>
              : visiblePlugins.length === 0
                ? <p className={css.empty} role="status">{t('noMatch')}</p>
                : (
                  <ul className={css.grid}>
                    {visiblePlugins.map((plugin) => {
                      const command = installCommand(plugin)
                      const copied = copiedId === plugin.id
                      const name = entryCopy(t, `name.${plugin.id}`, plugin.nameEn || plugin.name)
                      const description = entryCopy(t, `desc.${plugin.id}`, plugin.descriptionEn ?? plugin.description ?? '')
                      const installedItem = faceLoopback ? entryInstalled(plugin, installed ?? []) : null
                      const isInstalling = pending?.kind === 'install' && pending.id === plugin.id
                      const isUninstalling = pending?.kind === 'uninstall' && pending.id === plugin.id
                      const error = errors[plugin.id]
                      return (
                        <li key={plugin.id} className={css.card}>
                          <span className={css.cardHead}>
                            <span className={css.cardName} title={name}>{name}</span>
                            <span className={css.cardBadges}>
                              {installedItem !== null
                                ? <span className={`${css.badge} ${css.badgeInstalled}`}>{t('badge.installed')}</span>
                                : null}
                              <span
                                className={plugin.npm ? `${css.badge} ${css.badgePublished}` : css.badge}
                                title={plugin.npm ?? plugin.repo}
                              >
                                {plugin.npm ? t('badge.published') : t('badge.source')}
                              </span>
                            </span>
                          </span>
                          <span className={css.cardMeta}>
                            {plugin.category ? <span className={css.cardCategory}>{t(CATEGORY_KEY[plugin.category])}</span> : null}
                            {plugin.category ? <span className={css.cardDot} aria-hidden="true">·</span> : null}
                            <span className={css.cardAuthor} title={plugin.author}>{plugin.author}</span>
                          </span>
                          {description ? <p className={css.cardDescription}>{description}</p> : null}
                          <span className={css.cardFooter}>
                            <span className={css.cardTop}>
                              <a className={css.cardLink} href={plugin.repo} target="_blank" rel="noreferrer">{t('repository')}</a>
                              <span className={css.cardActions}>
                                <button
                                  type="button"
                                  className={copied
                                    ? `${css.installButton} ${css.installButtonCopied}`
                                    : faceLoopback ? `${css.installButton} ${css.installButtonSecondary}` : css.installButton}
                                  title={command}
                                  onClick={() => { copyCommand(plugin.id, command) }}
                                >
                                  {copied ? t('copied') : t('install')}
                                </button>
                                {faceLoopback && installedItem === null
                                  ? (
                                    <button
                                      type="button"
                                      className={css.installButton}
                                      disabled={mutationsDisabled}
                                      onClick={() => { onInstall(plugin) }}
                                    >
                                      {isInstalling ? t('installing') : t('installNow')}
                                    </button>
                                  )
                                  : null}
                                {faceLoopback && installedItem !== null
                                  ? (
                                    <button
                                      type="button"
                                      className={`${css.installButton} ${css.installButtonSecondary}`}
                                      disabled={mutationsDisabled}
                                      onClick={() => { setUninstallTarget(plugin) }}
                                    >
                                      {isUninstalling ? t('uninstalling') : t('uninstall')}
                                    </button>
                                  )
                                  : null}
                              </span>
                            </span>
                            {isInstalling
                              ? (
                                <p className={css.progress} role="status">
                                  {progress !== null && progress.kind !== 'idle'
                                    ? t(`progress.${progress.stage}`)
                                    : t('installing')}
                                </p>
                              )
                              : null}
                            {error !== undefined ? <p className={css.error} role="alert">{error}</p> : null}
                            <code className={css.cardCommand} title={command}>{command}</code>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
          </div>
        )
        : <p className={css.off} role="status">{t('off')}</p>}
      {face === null
        ? <p className={css.installNote} role="note">{t('managerHint')}</p>
        : face.isLoopback
          ? null
          : <p className={css.installNote} role="note">{t('remoteHint')}</p>}
      <p className={css.installNote} role="note">{t('installHint')}</p>
      <p className={css.notice} role="note">{t('notice')}</p>
      <Modal
        open={uninstallTarget !== null}
        onClose={() => { if (pending === null) setUninstallTarget(null) }}
        title={t('uninstallConfirm.title')}
        closeLabel={t('cancel')}
      >
        <p className={css.confirmBody}>
          {t('uninstallConfirm.body', {
            name: uninstallTarget === null
              ? ''
              : entryCopy(t, `name.${uninstallTarget.id}`, uninstallTarget.nameEn || uninstallTarget.name),
          })}
        </p>
        <div className={css.modalActions}>
          <Button variant="outline" disabled={pending !== null} onClick={() => { setUninstallTarget(null) }}>
            {t('cancel')}
          </Button>
          <Button variant="primary" className={css.dangerButton} disabled={pending !== null} onClick={onUninstallConfirm}>
            {pending?.kind === 'uninstall' ? t('uninstalling') : t('uninstallConfirm.confirm')}
          </Button>
        </div>
      </Modal>
    </PluginSettingsCard>
  )
}

/** Props the settings section binds for the community plugin page. */
export type CommunityPluginsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'community-plugins'>
  & InjectFace<CommunityPluginsCardFace>
  & {
    /** Index entries; defaults to the generated registry (injected for tests). */
    plugins?: readonly CommunityPluginEntry[]
    /** Plugin-manager face override (injected for tests; undefined reads the bridge). */
    pluginManager?: PluginManagerService | null
  }

/** Render the community plugin index as a first-level settings page. */
export function CommunityPluginsSection(props: CommunityPluginsSectionProps): ReactNode {
  const { t, useCommunityPluginsCard, save, discard, edit, resetField, plugins, pluginManager } = props
  return (
    <ul className={css.sectionList}>
      <CommunityPluginsCard t={t} useCommunityPluginsCard={useCommunityPluginsCard} save={save} discard={discard} edit={edit} resetField={resetField} plugins={plugins} pluginManager={pluginManager} />
    </ul>
  )
}
