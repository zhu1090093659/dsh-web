import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Shared chrome for the plugin settings card: a disclosure header naming the
 * plugin and what its settings govern, the controls inside, and the save that
 * writes them. Renders nothing while the namespace is unavailable — a
 * deployment that does not compose the owning plugin should show no trace of
 * it. Mirrors the official ui-plugin-config PluginCard in a self-contained
 * slice (this package must not depend on a sibling UI package).
 */
import { useState } from 'react';
import css from './settings-card.module.css';
/**
 * Render one plugin settings card.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card, or nothing while the namespace is still loading.
 */
export function PluginSettingsCard(props) {
    const [open, setOpen] = useState(false);
    const { state } = props;
    if (!state.available)
        return null;
    const title = props.t(props.titleKey);
    const blocked = !state.dirty || state.invalid || state.saving;
    const cardClass = open ? `${css.cardOpen} ${css.card}` : css.card;
    const description = props.t(props.descriptionKey);
    // The namespace exists but the Host does not serve it to this client (the
    // official settings allowlist omits third-party namespaces): show a card
    // that explains the gap instead of vanishing, so a missing card never
    // reads as a missing plugin.
    if (!state.exposed) {
        return (_jsxs("li", { className: cardClass, children: [_jsxs("button", { type: "button", className: css.header, "aria-expanded": open, "aria-label": `${props.t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`, title: description, onClick: () => { setOpen(!open); }, children: [_jsxs("span", { className: css.headText, children: [_jsx("span", { className: css.name, title: title, children: title }), _jsx("span", { className: css.description, children: description })] }), _jsx("span", { className: open ? css.chevronOpen : css.chevron, children: "\u25BE" })] }), open
                    ? (_jsx("div", { className: css.body, children: _jsx("p", { className: css.notExposed, role: "status", children: props.t('settings.notExposed') }) }))
                    : null] }));
    }
    return (_jsxs("li", { className: cardClass, children: [_jsxs("button", { type: "button", className: css.header, "aria-expanded": open, "aria-label": `${props.t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`, title: description, onClick: () => { setOpen(!open); }, children: [_jsxs("span", { className: css.headText, children: [_jsx("span", { className: css.name, title: title, children: title }), _jsx("span", { className: css.description, children: description })] }), state.dirty ? _jsx("span", { className: css.pending, title: props.t('settings.unsaved'), children: props.t('settings.unsaved') }) : null, _jsx("span", { className: open ? css.chevronOpen : css.chevron, children: "\u25BE" })] }), open
                ? (_jsxs("div", { className: css.body, children: [!state.writable ? _jsx("p", { className: css.readOnly, role: "status", children: props.t('settings.readOnly') }) : null, props.children, _jsxs("div", { className: css.footer, children: [state.failed ? _jsx("p", { className: css.failed, role: "status", children: props.t('settings.saveFailed') }) : null, _jsx("button", { type: "button", className: css.discard, disabled: !state.dirty || state.saving, onClick: props.onDiscard, children: props.t('settings.discard') }), _jsx("button", { type: "button", className: css.save, disabled: blocked, onClick: props.onSave, children: props.t(!state.saving ? 'settings.save' : 'settings.saving') })] })] }))
                : null] }));
}
/** A staged value field. `numeric` only hints the keypad: which drafts a field accepts is decided by its spec. */
export function ValueField(props) {
    return (_jsxs("div", { className: css.field, children: [_jsxs("div", { className: css.head, children: [_jsx("label", { className: css.label, htmlFor: props.id, children: props.label }), props.overridden
                        ? (_jsxs("span", { className: css.badges, children: [_jsx("span", { className: css.badge, children: props.overriddenLabel }), _jsx("button", { type: "button", className: css.reset, disabled: props.disabled, onClick: props.onReset, children: props.resetLabel })] }))
                        : null] }), _jsx("input", { id: props.id, className: props.invalid ? css.inputInvalid : css.input, type: "text", ...props.numeric === true ? { inputMode: 'numeric' } : {}, ...props.invalid ? { 'aria-invalid': true } : {}, value: props.text, placeholder: props.placeholder ?? '', disabled: props.disabled, onChange: (event) => { props.onEdit(event.target.value); } }), _jsx("p", { className: props.invalid ? css.invalid : css.hint, children: props.invalid ? props.invalidLabel : props.hint })] }));
}
/** A staged boolean field: 继承 / 开 / 关. */
export function BooleanField(props) {
    return (_jsxs("div", { className: css.field, children: [_jsxs("div", { className: css.head, children: [_jsx("label", { className: css.label, htmlFor: props.id, children: props.label }), props.overridden
                        ? (_jsxs("span", { className: css.badges, children: [_jsx("span", { className: css.badge, children: props.overriddenLabel }), _jsx("button", { type: "button", className: css.reset, disabled: props.disabled, onClick: props.onReset, children: props.resetLabel })] }))
                        : null] }), _jsxs("select", { id: props.id, className: css.select, value: props.text, disabled: props.disabled, onChange: (event) => { props.onEdit(event.target.value); }, children: [_jsx("option", { value: "", children: props.inheritLabel }), _jsx("option", { value: "true", children: props.onLabel }), _jsx("option", { value: "false", children: props.offLabel })] }), _jsx("p", { className: css.hint, children: props.hint })] }));
}
