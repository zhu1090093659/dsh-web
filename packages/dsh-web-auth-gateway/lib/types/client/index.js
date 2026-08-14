import { GatewaySettingsCard, GatewaySettingsCardController } from "./GatewaySettingsCard.js";
import { en, zh } from "./locales.js";
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote'];
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register('web-auth-gateway', { zh, en }), 'web-auth-gateway: dictionaries');
    const controller = new GatewaySettingsCardController(ctx.settingsScope.bind({ namespace: 'web-auth-gateway' }));
    ctx.slots.inject('web-ui.plugin.item', () => ctx.slots.register({ name: 'web-ui.plugin.item', id: 'web-auth-gateway', order: 105, locale: 'web-auth-gateway', inject: () => controller.inject() }, GatewaySettingsCard));
}
