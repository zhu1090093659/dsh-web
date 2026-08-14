/**
 * Shared chrome for the plugin settings card: a disclosure header naming the
 * plugin and what its settings govern, the controls inside, and the save that
 * writes them. Renders nothing while the namespace is unavailable — a
 * deployment that does not compose the owning plugin should show no trace of
 * it. Mirrors the official ui-plugin-config PluginCard in a self-contained
 * slice (this package must not depend on a sibling UI package).
 */
import { type ReactNode } from 'react';
import type { CardShell } from './settings-form.ts';
import type { SettingsCardKey } from './locales.ts';
/** Card chrome shared by every plugin settings card. */
export interface PluginSettingsCardProps {
    /** Locale reader for this card's copy. */
    t: (key: SettingsCardKey) => string;
    /** Locale key of the plugin's name. */
    titleKey: SettingsCardKey;
    /** Locale key of the line describing what this plugin's settings govern. */
    descriptionKey: SettingsCardKey;
    /** The card's form state: availability, writability, and what a save would do. */
    state: CardShell;
    /** Write every staged edit. */
    onSave: () => void;
    /** Drop every staged edit. */
    onDiscard: () => void;
    /** The plugin's controls. */
    children: ReactNode;
}
/**
 * Render one plugin settings card.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card, or nothing while the namespace is still loading.
 */
export declare function PluginSettingsCard(props: PluginSettingsCardProps): import("react").JSX.Element | null;
/** Props every field control needs regardless of its value type. */
export interface FieldProps {
    /** Stable id associating the label with its control. */
    id: string;
    /** Visible label. */
    label: string;
    /** One-line explanation rendered under the control. */
    hint: string;
    /** Draft text this control renders. */
    text: string;
    /** True when saving would leave a user-layer entry for this field. */
    overridden: boolean;
    /** True when the draft is not a value this field accepts. */
    invalid: boolean;
    /** Copy for the overridden badge. */
    overriddenLabel: string;
    /** Copy for the reset control. */
    resetLabel: string;
    /** Copy shown in place of the hint while the draft is invalid. */
    invalidLabel: string;
    /** Disables every control (read-only document, or an unavailable namespace). */
    disabled: boolean;
    /** Stage draft text. */
    onEdit: (text: string) => void;
    /** Stage a clear so the field re-inherits the composition layer. */
    onReset: () => void;
}
/** A staged value field. `numeric` only hints the keypad: which drafts a field accepts is decided by its spec. */
export declare function ValueField(props: FieldProps & {
    /** Hints a numeric keypad without narrowing what the control accepts. */
    numeric?: boolean;
    /** Placeholder shown while the draft is empty. */
    placeholder?: string;
}): import("react").JSX.Element;
/** A staged boolean field: 继承 / 开 / 关. */
export declare function BooleanField(props: FieldProps & {
    /** Copy for the inherit option. */
    inheritLabel: string;
    /** Copy for the on option. */
    onLabel: string;
    /** Copy for the off option. */
    offLabel: string;
}): import("react").JSX.Element;
//# sourceMappingURL=PluginSettingsCard.d.ts.map