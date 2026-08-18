/**
 * The community plugin index card: a first-level settings section that is
 * always open. Its own enable switch (backed by the community-plugins
 * settings namespace) gates the list, which is presented marketplace-style:
 * a search box, category filter pills with counts, and a two-column card grid
 * whose entries link to contributors' own repositories — this package only
 * indexes them, it never vendors their code.
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import type { CommunityPluginKey } from './locales.ts'
import { COMMUNITY_PLUGINS, type CommunityPluginCategory, type CommunityPluginEntry } from './generated/community.ts'
import { isCommunityPluginEntry } from './community-guard.ts'
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
                      return (
                        <li key={plugin.id} className={css.card}>
                          <span className={css.cardHead}>
                            <span className={css.cardName} title={name}>{name}</span>
                            <span
                              className={plugin.npm ? `${css.badge} ${css.badgePublished}` : css.badge}
                              title={plugin.npm ?? plugin.repo}
                            >
                              {plugin.npm ? t('badge.published') : t('badge.source')}
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
                              <button
                                type="button"
                                className={copied ? `${css.installButton} ${css.installButtonCopied}` : css.installButton}
                                title={command}
                                onClick={() => { copyCommand(plugin.id, command) }}
                              >
                                {copied ? t('copied') : t('install')}
                              </button>
                            </span>
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
      <p className={css.installNote} role="note">{t('installHint')}</p>
      <p className={css.notice} role="note">{t('notice')}</p>
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
  }

/** Render the community plugin index as a first-level settings page. */
export function CommunityPluginsSection(props: CommunityPluginsSectionProps): ReactNode {
  const { t, useCommunityPluginsCard, save, discard, edit, resetField, plugins } = props
  return (
    <ul className={css.sectionList}>
      <CommunityPluginsCard t={t} useCommunityPluginsCard={useCommunityPluginsCard} save={save} discard={discard} edit={edit} resetField={resetField} plugins={plugins} />
    </ul>
  )
}
