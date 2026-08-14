import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type { createLanguageRowStore } from './settings-store.ts';
/** Injected business face: the preference write (t rides the standard locale seat). */
export interface LanguageRowInjected {
    /** Switch the active locale (a registered locale id). */
    setLocale: (id: string) => void;
}
/** Full component props: runtime share + store share + locale seat + injected face. */
export type LanguageRowComponentProps = PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createLanguageRowStore>> & PropsLocale<'settings.locale'> & LanguageRowInjected;
/**
 * Render the Language row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export declare function LanguageRow({ t, setLocale, useStore }: LanguageRowComponentProps): import("react").JSX.Element;
//# sourceMappingURL=LanguageRow.d.ts.map