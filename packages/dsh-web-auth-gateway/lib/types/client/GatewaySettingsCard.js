import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import styles from './gateway-settings.module.css';
const defaults = { enabled: true, port: 3090, sessionTtlHours: 12 };
export function GatewaySettingsCard({ t }) {
    const [value, setValue] = useState(defaults);
    const [saved, setSaved] = useState(defaults);
    const [writable, setWritable] = useState(false);
    const [state, setState] = useState('loading');
    const [error, setError] = useState('');
    useEffect(() => {
        void fetch('/api/web-auth-gateway/config', { credentials: 'same-origin' })
            .then(async (response) => await response.json())
            .then(result => {
            if (!result.ok || result.value === undefined)
                throw new Error(result.error ?? 'load-failed');
            const next = { ...defaults, ...result.value };
            setValue(next);
            setSaved(next);
            setWritable(result.writable === true);
            setState('ready');
        })
            .catch(reason => { setError(reason instanceof Error ? reason.message : 'load-failed'); setState('error'); });
    }, []);
    const dirty = JSON.stringify(value) !== JSON.stringify(saved);
    const save = async () => {
        setState('saving');
        setError('');
        try {
            const response = await fetch('/api/web-auth-gateway/config', {
                method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
            });
            const result = await response.json();
            if (!response.ok || !result.ok)
                throw new Error(result.error ?? 'save-failed');
            const next = { ...defaults, ...result.value };
            setValue(next);
            setSaved(next);
            setState('ready');
        }
        catch (reason) {
            setError(reason instanceof Error ? reason.message : 'save-failed');
            setState('error');
        }
    };
    return _jsxs("section", { className: styles.card, children: [_jsxs("div", { className: styles.row, children: [_jsxs("div", { children: [_jsx("strong", { children: t('settings.enabled') }), _jsx("p", { children: t('settings.enabledHint') })] }), _jsx("input", { "aria-label": t('settings.enabled'), type: "checkbox", checked: value.enabled, disabled: !writable || state === 'loading', onChange: event => setValue(current => ({ ...current, enabled: event.target.checked })) })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: t('settings.port') }), _jsx("small", { children: t('settings.portHint') }), _jsx("input", { type: "number", min: "1", max: "65535", value: value.port, disabled: !writable || state === 'loading', onChange: event => setValue(current => ({ ...current, port: Number(event.target.value) })) })] }), _jsxs("label", { className: styles.field, children: [_jsx("span", { children: t('settings.ttl') }), _jsx("small", { children: t('settings.ttlHint') }), _jsx("input", { type: "number", min: "1", max: "720", value: value.sessionTtlHours, disabled: !writable || state === 'loading', onChange: event => setValue(current => ({ ...current, sessionTtlHours: Number(event.target.value) })) })] }), state === 'error' && _jsxs("p", { className: styles.error, children: [t('settings.saveFailed'), ": ", error] }), _jsxs("div", { className: styles.actions, children: [_jsx("button", { disabled: !dirty || state === 'saving', onClick: () => setValue(saved), children: t('settings.discard') }), _jsx("button", { className: styles.primary, disabled: !writable || !dirty || state === 'saving', onClick: () => void save(), children: state === 'saving' ? t('settings.saving') : t('settings.save') })] })] });
}
