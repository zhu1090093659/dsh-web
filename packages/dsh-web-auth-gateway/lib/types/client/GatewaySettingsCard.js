import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { PluginSettingsCard, ValueField, BooleanField } from "./PluginSettingsCard.js";
import { CardForm, booleanField, numberField } from "./settings-form.js";
export class GatewaySettingsCardController {
    form;
    store;
    constructor(scope) {
        this.form = new CardForm(scope, [booleanField('enabled'), numberField('port', { integer: true, min: 1 }), numberField('sessionTtlHours', { integer: true, min: 1 })]);
        this.store = this.form.bind(() => ({ ...this.form.shell(), enabled: this.form.field('enabled'), port: this.form.field('port'), sessionTtlHours: this.form.field('sessionTtlHours') }));
    }
    inject() { return { hooks: { gatewaySettingsCard: this.store }, ...this.form.actions() }; }
}
export function GatewaySettingsCard(props) {
    const { t } = props;
    const state = props.useGatewaySettingsCard(value => value);
    const disabled = !state.writable;
    const common = { overriddenLabel: t('settings.overridden'), resetLabel: t('settings.reset'), invalidLabel: t('settings.invalidNumber'), disabled };
    return _jsxs(PluginSettingsCard, { t: t, titleKey: "settings.title", descriptionKey: "settings.description", state: state, onSave: props.save, onDiscard: props.discard, children: [_jsx(BooleanField, { id: "settings-gateway-enabled", label: t('settings.enabled'), hint: t('settings.enabledHint'), inheritLabel: t('settings.inherit'), onLabel: t('settings.on'), offLabel: t('settings.off'), ...common, ...state.enabled, onEdit: text => props.edit('enabled', text), onReset: () => props.resetField('enabled') }), _jsx(ValueField, { id: "settings-gateway-port", label: t('settings.port'), hint: t('settings.portHint'), numeric: true, ...common, ...state.port, onEdit: text => props.edit('port', text), onReset: () => props.resetField('port') }), _jsx(ValueField, { id: "settings-gateway-ttl", label: t('settings.ttl'), hint: t('settings.ttlHint'), numeric: true, ...common, ...state.sessionTtlHours, onEdit: text => props.edit('sessionTtlHours', text), onReset: () => props.resetField('sessionTtlHours') })] });
}
