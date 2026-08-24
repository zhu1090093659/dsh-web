/**
 * The Web UI plugins first-level settings section. Renders a static heading
 * plus the family plugin cards directly (the nav entry already selects the
 * section, so there is no disclosure fold).
 */

import type { ReactNode } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './web-ui-settings.module.css'

/** Props the settings section binds for the family plugin cards page. */
export type WebUIPluginsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'web-ui-plugins'>
  & PropsRenderSlots<'web-ui.plugin.item'>

/** Render the family plugin cards directly under a static heading. */
export function WebUIPluginsSection(props: WebUIPluginsSectionProps): ReactNode {
  const { t, renderSlot } = props
  return (
    <div className={css.section}>
      <h2 className={css.heading} title={t('title')}>{t('title')}</h2>
      <p className={css.lede} title={t('description')}>{t('description')}</p>
      <ul className={css.subcards}>
        {renderSlot('web-ui.plugin.item', {})}
      </ul>
    </div>
  )
}
