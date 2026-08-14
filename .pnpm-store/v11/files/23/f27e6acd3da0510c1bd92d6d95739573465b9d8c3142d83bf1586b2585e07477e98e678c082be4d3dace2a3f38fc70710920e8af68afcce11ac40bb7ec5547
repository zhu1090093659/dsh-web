/** Locale preference stored in the Host user-settings document. */
import z from '@deepseek-ai/schemastery';
/** Settings namespace owned by the locale plugin. */
export declare const LOCALE_SETTINGS_NAMESPACE = "locale";
/** Field carrying an explicit locale selection; absence delegates to the browser. */
export declare const LOCALE_PREFERENCE_FIELD = "preference";
/** Locale identifiers shipped by the browser client. */
export declare const LOCALE_IDS: readonly ["zh", "en"];
/** Shipped locale identifier. */
export type LocaleId = typeof LOCALE_IDS[number];
/** Durable locale section shared by the Host schema and the browser scope. */
export interface LocaleSettings {
    /** Explicit locale selection; absence delegates to the browser. */
    preference?: LocaleId;
}
/** Durable locale schema; also the wire envelope the browser scope validates against. */
export declare const LocaleSettingsSchema: z<LocaleSettings>;
//# sourceMappingURL=locale-settings.d.ts.map