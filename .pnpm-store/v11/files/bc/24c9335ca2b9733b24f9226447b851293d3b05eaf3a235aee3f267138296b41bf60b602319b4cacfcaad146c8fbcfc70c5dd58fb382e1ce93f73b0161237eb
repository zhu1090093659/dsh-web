/**
 * Browser-side locale registry. Bound translation functions retain stable
 * identity for injected consumers. The plugin also registers the Language
 * preference row into the settings General section — the locale feature owns
 * its own settings surface.
 */
import type { Context } from '@deepseek-ai/cordis';
import { type LocaleDictOf, type LocaleNamespaceMap, type Translate, type TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client';
import { type LocaleId, type LocaleSettings } from '../locale-settings.ts';
import { type CommonKey } from '../locales/index.ts';
import { type SettingsLocaleKey } from '../locales/settings.ts';
export type { LanguageRowComponentProps, LanguageRowInjected } from './LanguageRow.tsx';
export type { LanguageOptionRow, LanguageRowState } from './settings-store.ts';
export type { CommonKey } from '../locales/index.ts';
export type { LocaleId, LocaleSettings } from '../locale-settings.ts';
export type { Translate, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Shared cross-feature vocabulary, consulted by the lookup chain after the entry's own namespace misses. */
        common: CommonKey;
        /** This feature's own settings-row copy (the Language row). */
        'settings.locale': SettingsLocaleKey;
    }
}
/** Locale dictionary: flat key to template string ({name} placeholders). */
export type LocaleDict = Record<string, string>;
/** One selectable locale: id plus its self-described display name. */
export interface LocaleDefinition {
    /** Locale id (persisted; the setLocale argument). */
    id: LocaleId;
    /** Display name in its own language (中文 / English). */
    label: string;
}
/** Immutable locale state published on every change. */
export interface LocaleSnapshot {
    /** Active locale id. */
    active: LocaleId;
    /** Selectable locales in display order. */
    locales: readonly LocaleDefinition[];
    /** Monotonic change counter (registry or active changes). */
    revision: number;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        locale: LocaleRuntime;
    }
    interface Events {
        /**
         * The active locale switched. Dictionary registrations do NOT emit this
         * event (listeners may re-register slots in response, and boot registers
         * one namespace per package); continuous render refresh rides the
         * LocaleFace revision instead.
         * @param snapshot - Current immutable locale snapshot.
         * @mode emit
         */
        'locale/change'(snapshot: LocaleSnapshot): void;
    }
}
/** Fallback locale consulted after the active locale misses (also the last-resort initial locale). */
export declare const FALLBACK_LOCALE: LocaleId;
/** Shared namespace for shell-level texts. */
export declare const COMMON_NS = "common";
/** Namespace owning this feature's settings-row copy. */
export declare const SETTINGS_NS = "settings.locale";
/**
 * Dictionary registry plus locale preference. Lookup chain per key: the
 * entry's namespace in the active locale -> that namespace's zh fallback ->
 * the shared common namespace (active, then zh) -> the key itself (missing
 * text stays visible, fail loud in the UI rather than blank). Reads go
 * through {@link getLocale}; writes only through {@link setLocale};
 * continuous sync through the `locale/change` event, or through the
 * LocaleFace getSnapshot/subscribe pair the render machinery consumes
 * (installed via `ctx.slots.installLocale`).
 */
export declare class LocaleRuntime {
    private dicts;
    private bound;
    private snapshot;
    private listeners;
    private readonly ctx;
    private readonly host;
    /** Browser-derived locale standing wherever no explicit Host selection does. */
    private readonly provisional;
    /**
     * @param ctx - owning context (change events are emitted on it; the scope
     * listener is released through ctx.effect on dispose).
     * @param host - durable preference scope owned by the providing plugin;
     * absent compositions (standalone dictionary registries) stay process-local.
     */
    constructor(ctx: Context, host?: SettingsScope<LocaleSettings>);
    /**
     * Read the current immutable locale snapshot.
     * @returns the current snapshot (stable reference until the next change).
     */
    getLocale(): LocaleSnapshot;
    /**
     * LocaleFace getSnapshot: the current snapshot (carries `revision`; stable
     * reference between changes, uSES-safe).
     * @returns the current snapshot.
     */
    getSnapshot(): LocaleSnapshot;
    /**
     * LocaleFace subscribe: notified on every snapshot change (locale switch
     * or dictionary registration — registrations bump the revision so already
     * rendered outlets pick up late-arriving dictionaries).
     * @param fn - change callback.
     * @returns unsubscribe.
     */
    subscribe(fn: () => void): () => void;
    /**
     * Switch the active locale — the only user preference write entry.
     * @param id - a registered locale id; unknown ids throw.
     */
    setLocale(id: string): void;
    /**
     * Adopt the scope's accepted durable selection without writing it back; an
     * absent selection returns to the browser-derived locale.
     * @param host - the constructor-narrowed scope driving this adoption.
     */
    private adopt;
    /**
     * Register a declared namespace's dictionaries, all locales in one call —
     * the typed form: each dictionary is checked against the namespace's
     * {@link LocaleNamespaceMap} key union (a missing or extra key is a
     * compile error), and every shipped locale is required (bilingual balance
     * enforced at registration). Duplicate (ns, locale) throws (single occupant; a
     * namespace's texts have one owner). Registration bumps the revision so
     * mounted outlets pick up late-arriving dictionaries.
     * @param ns - a namespace merged into LocaleNamespaceMap.
     * @param dicts - complete dictionaries keyed by locale id.
     * @returns disposer removing every locale registered by this call (idempotent).
     */
    register<N extends keyof LocaleNamespaceMap & string>(ns: N, dicts: Record<LocaleId, LocaleDictOf<N>>): () => void;
    /**
     * Single-locale untyped form for namespaces outside the merge table
     * (dynamic composition, tests).
     * @param ns - namespace.
     * @param locale - locale tag.
     * @param dict - dictionary.
     * @returns disposer (idempotent).
     */
    register(ns: string, locale: string, dict: LocaleDict): () => void;
    /**
     * Bind a declared namespace to a translate function typed to its
     * dictionary key union (plus the shared common vocabulary) — the same key
     * domain the framework-injected `t` seat carries. The returned reference
     * is stable per namespace (repeat binds return the same function), so it
     * can ride inject surfaces without breaking memoization.
     * @param ns - a namespace merged into LocaleNamespaceMap.
     * @returns the typed translate function (reads the active locale at call time).
     */
    bind<N extends keyof LocaleNamespaceMap & string>(ns: N): TranslateNS<N>;
    /**
     * Untyped form for namespaces outside the merge table (dynamic
     * composition, tests).
     * @param ns - namespace.
     * @returns the translate function.
     */
    bind(ns: string): Translate;
    private translate;
    private lookup;
    /**
     * Advance the snapshot revision and notify LocaleFace subscribers (render
     * refresh). Only an active-locale switch additionally emits
     * `locale/change` — dictionary registrations stay off the event so
     * registration-heavy boot cannot storm event listeners (which may
     * re-register slots in response).
     */
    private publish;
}
/** Required services: slot registration plus the settings transport. */
export declare const inject: string[];
/**
 * Client plugin body: provide the locale service with base dictionaries and
 * register the feature-owned Language preference row into the General
 * section's item slot (a feature owns its settings surface).
 * @param ctx - client cordis context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map