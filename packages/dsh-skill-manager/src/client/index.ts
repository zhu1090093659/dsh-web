/**
 * Skill manager, browser half: registers the Settings page section "Skills"
 * (the `settings.section` seat, nav id `skills`, ordered after Agent
 * presets) with the full management UI: workspace selector, skill list with
 * master switches, install form, and uninstall confirmation. The section
 * talks to the host exclusively through the /api/dsh-skill-manager routes.
 * @module @linxin666/dsh-skill-manager/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the
// settings-surface SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SkillManagerApi } from './api.ts'
import { SkillManagerController } from './controller.ts'
import { SkillManagerSection } from './SkillManagerSection.tsx'
import { en, zh, type SkillManagerKey } from './locales.ts'
// Nav icon override for the Skills section (settings shell renders a gear
// for unknown section ids; see nav-icon.module.css).
import './nav-icon.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The skill manager section copy. */
    'skill-manager': SkillManagerKey
  }
}

/** Locale namespace of the browser half. */
export const NS = 'skill-manager'

/** Required services: slots for the section seat, sessions for the current selection, connection for the workspace RPC, locale for copy. */
export const inject = ['slots', 'locale', 'sessions', 'connection']

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-skill-manager: dictionaries')

  ctx.effect(() => {
    const connection = ctx.get('connection') as ConnectionHandle
    const controller = new SkillManagerController({
      api: new SkillManagerApi(),
      sessions: ctx.sessions,
      workspaces: () => connection.api.workspace.list({}),
    })
    const disposeSlots = ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'skills',
      order: 30,
      label: () => ctx.locale.bind(NS)('nav'),
      locale: NS,
      inject: () => controller.inject(),
    }, SkillManagerSection))
    return () => {
      disposeSlots()
      controller.dispose()
    }
  }, 'dsh-skill-manager: section')
}