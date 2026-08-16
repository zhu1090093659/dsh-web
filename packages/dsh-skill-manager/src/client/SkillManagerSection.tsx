/**
 * The Settings "Skills" section: workspace selector, the skill catalog with
 * per-skill master switches, the install form (local directory / git URL,
 * workspace or user level), and ledger-guarded uninstall with confirmation.
 * Pure presentation — every mutation goes through the injected controller
 * face; the section holds no business state of its own.
 * @module @linxin666/dsh-skill-manager/client/SkillManagerSection
 */

import { useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillManagerSectionInjected, SkillManagerState } from './controller.ts'
import type { SkillManagerKey } from './locales.ts'
import type { SkillRow } from '../core/protocol.ts'
import css from './skill-manager.module.css'

/** Full component props. */
export type SkillManagerSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'skill-manager'>
  & InjectFace<SkillManagerSectionInjected>

/** The status text of one row under the master-switch semantics. */
function statusKey(skill: SkillRow): SkillManagerKey {
  if (skill.modelInvocable && skill.userInvocable) return 'enabled'
  if (!skill.modelInvocable && !skill.userInvocable) return 'disabled'
  return 'userOnly'
}

/** One skill row. */
function SkillRowView(props: {
  skill: SkillRow
  t: (key: SkillManagerKey, params?: Record<string, string | number>) => string
  toggling: boolean
  onToggle: (enabled: boolean) => void
  onUninstall: () => void
}) {
  const { skill, t, toggling } = props
  const enabled = skill.modelInvocable && skill.userInvocable
  const pending = toggling
  return (
    <li className={css.row}>
      <div className={css.rowMain}>
        <span className={css.name} title={skill.path}>{skill.name}</span>
        <span className={css.description} title={skill.whenToUse ?? skill.description}>{skill.description}</span>
        <span className={css.badges}>
          <span className={css.badge}>{skill.source}</span>
          <span className={css.badge}>{skill.provider}</span>
          {skill.installed ? <span className={css.badge}>{t('installed')}</span> : null}
        </span>
      </div>
      <div className={css.rowActions}>
        <span className={css.status}>{t(statusKey(skill))}</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t(enabled ? 'toggleDisable' : 'toggleEnable', { name: skill.name })}
          className={enabled ? `${css.switch} ${css.switchOn}` : css.switch}
          disabled={!skill.toggleable || pending}
          onClick={() => { props.onToggle(!enabled) }}
        >
          <span className={css.knob} />
        </button>
        {skill.installed
          ? (
            <button
              type="button"
              className={css.uninstall}
              disabled={pending}
              onClick={props.onUninstall}
            >
              {t('uninstall')}
            </button>
          )
          : null}
        {!skill.toggleable
          ? <span className={css.hint} title={t('notToggleable')}>*</span>
          : null}
      </div>
    </li>
  )
}

/**
 * Render the skill manager section.
 * @param props - locale copy, the section snapshot, and its actions.
 * @returns the section.
 */
export function SkillManagerSection(props: SkillManagerSectionProps) {
  const { t } = props
  const state = props.useSkillManagerSection((snapshot: SkillManagerState) => snapshot)
  useEffect(() => {
    void props.load()
  }, [])

  if (state.phase === 'loading' && state.workspaces.length === 0) {
    return <p className={css.message} role="status">{t('loading')}</p>
  }
  if (state.phase === 'error') {
    return (
      <div className={css.section}>
        <p className={css.error} role="status">{t('loadFailed')}: {state.error}</p>
        <button type="button" className={css.button} onClick={() => { void props.refresh() }}>{t('retry')}</button>
      </div>
    )
  }
  const noSession = state.selectedSessionId === undefined
  return (
    <div className={css.section}>
      <p className={css.lead}>{t('description')}</p>
      <div className={css.toolbar}>
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('workspace')}</span>
          <select
            className={css.select}
            value={state.selectedWorkspaceId ?? ''}
            onChange={(event) => { props.selectWorkspace(event.target.value) }}
          >
            {state.workspaces.map(workspace => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={css.button}
          disabled={noSession}
          onClick={() => { void props.refresh() }}
        >
          {t('refresh')}
        </button>
      </div>
      {state.cwd !== undefined
        ? (
          <p className={css.viewInfo}>
            {t('viewInfo', { cwd: state.cwd })}
            <span className={state.live ? css.live : css.cold}>{t(state.live ? 'live' : 'cold')}</span>
          </p>
        )
        : null}
      {noSession
        ? <p className={css.message} role="status">{t('noSessions')}</p>
        : (
          <>
            {state.toggleError !== undefined
              ? <p className={css.error} role="status">{t('toggleFailed')}: {state.toggleError}</p>
              : null}
            {state.installError !== undefined
              ? <p className={css.error} role="status">{t('installFailed')}: {state.installError}</p>
              : null}
            {state.notice !== undefined
              ? (
                <p className={css.notice} role="status">
                  {state.notice.kind === 'installed'
                    ? t('installOk', { count: state.notice.count })
                    : t('uninstallOk', { name: state.notice.name })}
                </p>
              )
              : null}
            {state.skills.length === 0
              ? <p className={css.message} role="status">{t('empty')}</p>
              : (
                <ul className={css.list}>
                  {state.skills.map(skill => (
                    <SkillRowView
                      key={skill.name}
                      skill={skill}
                      t={t}
                      toggling={state.toggling[skill.name] === true}
                      onToggle={(enabled) => { void props.toggle(skill.name, enabled) }}
                      onUninstall={() => { props.confirmUninstall(skill.name) }}
                    />
                  ))}
                </ul>
              )}
            <form
              className={css.install}
              onSubmit={(event) => { event.preventDefault(); void props.install() }}
            >
              <h3 className={css.installTitle}>{t('installTitle')}</h3>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('installSource')}</span>
                <select
                  className={css.select}
                  value={state.sourceKind}
                  onChange={(event) => { props.setSourceKind(event.target.value as 'dir' | 'git') }}
                >
                  <option value="dir">{t('sourceDir')}</option>
                  <option value="git">{t('sourceGit')}</option>
                </select>
              </label>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('sourceValue')}</span>
                <input
                  className={css.input}
                  type="text"
                  value={state.sourceValue}
                  placeholder={state.sourceKind === 'dir' ? t('sourceDirPlaceholder') : t('sourceGitPlaceholder')}
                  onChange={(event) => { props.setSourceValue(event.target.value) }}
                />
              </label>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('installDestination')}</span>
                <select
                  className={css.select}
                  value={state.destination}
                  onChange={(event) => { props.setDestination(event.target.value as 'workspace' | 'user') }}
                >
                  <option value="workspace">{t('destWorkspace')}</option>
                  <option value="user">{t('destUser')}</option>
                </select>
              </label>
              <button
                type="submit"
                className={css.button}
                disabled={state.installing || state.sourceValue.trim() === ''}
              >
                {t(state.installing ? 'installing' : 'install')}
              </button>
            </form>
            {state.uninstallTarget !== undefined
              ? <UninstallConfirm state={state} t={t} props={props} />
              : null}
          </>
        )}
    </div>
  )
}

/** Inline uninstall confirmation. */
function UninstallConfirm(props: {
  state: SkillManagerState
  t: (key: SkillManagerKey, params?: Record<string, string | number>) => string
  props: SkillManagerSectionProps
}) {
  const { state, t } = props
  const name = state.uninstallTarget
  return (
    <div className={css.confirm} role="alertdialog" aria-label={t('uninstallTitle')}>
      <p>{t('uninstallText', { name: name ?? '' })}</p>
      <div className={css.confirmActions}>
        <button
          type="button"
          className={css.button}
          disabled={state.uninstalling}
          onClick={() => { props.props.confirmUninstall(null) }}
        >
          {t('uninstallCancel')}
        </button>
        <button
          type="button"
          className={css.buttonDanger}
          disabled={state.uninstalling}
          onClick={() => { void props.props.uninstall() }}
        >
          {t(state.uninstalling ? 'uninstalling' : 'uninstallConfirm')}
        </button>
      </div>
    </div>
  )
}