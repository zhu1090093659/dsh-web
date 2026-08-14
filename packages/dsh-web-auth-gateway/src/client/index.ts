import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { GatewaySettingsCard } from './GatewaySettingsCard.tsx'
import { en, zh, type SettingsCardKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'web-auth-gateway': SettingsCardKey }
  interface SlotMap { 'web-ui.plugin.item': { kind: 'list'; scope: 'root'; owner: { children?: never } } }
}
export const inject = ['slots', 'locale']
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('web-auth-gateway', { zh, en }), 'web-auth-gateway: dictionaries')
  ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({ name: 'web-ui.plugin.item', id: 'web-auth-gateway', order: 105, locale: 'web-auth-gateway' }, GatewaySettingsCard))
}
