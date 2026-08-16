/**
 * The community plugin index card: a first-level settings section that is
 * always open (a static header with the index list directly visible). Its own
 * enable switch (backed by the community-plugins settings namespace) gates
 * the entry list; the list itself points at contributors' own repositories —
 * this package only indexes them, it never vendors their code.
 */

import { useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings-surface SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import type { CommunityPluginKey } from './locales.ts'
import { COMMUNITY_PLUGINS, type CommunityPluginEntry } from './generated/community.ts'
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
  const plugins = (props.plugins ?? COMMUNITY_PLUGINS).filter(isCommunityPluginEntry)
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
          <ul className={css.entries}>
            {plugins.length === 0
              ? <li className={css.empty} role="status">{t('empty')}</li>
              : plugins.map((plugin) => (
                <li key={plugin.id} className={css.entry}>
                  <span className={css.entryHead}>
                    <span className={css.entryName} title={plugin.name}>{plugin.name}</span>
                    <span className={css.entryAuthor} title={plugin.author}>{t('author')}: {plugin.author}</span>
                  </span>
                  {plugin.description ? <p className={css.entryDescription}>{plugin.description}</p> : null}
                  {plugin.descriptionEn ? <p className={css.entryDescriptionEn}>{plugin.descriptionEn}</p> : null}
                  <span className={css.entryLinks}>
                    <a className={css.entryLink} href={plugin.repo} target="_blank" rel="noreferrer">{t('repository')}</a>
                    {plugin.npm ? <code className={css.entryNpm}>{plugin.npm}</code> : null}
                  </span>
                  <span className={css.entryInstall}>
                    <code className={css.entryCommand}>{installCommand(plugin)}</code>
                    <button
                      type="button"
                      className={css.copyButton}
                      onClick={() => { copyCommand(plugin.id, installCommand(plugin)) }}
                    >
                      {copiedId === plugin.id ? t('copied') : t('copy')}
                    </button>
                  </span>
                </li>
              ))}
          </ul>
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
