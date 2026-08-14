import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type { ThemePreference } from '../theme-settings.ts';
import type { createAppearanceRowStore } from './settings-store.ts';
/** Injected business face: the preference write (t rides the standard locale seat). */
export interface AppearanceRowInjected {
    /** Switch the theme preference. */
    setTheme: (id: ThemePreference) => void;
}
/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps = PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>> & PropsLocale<'settings.theme'> & AppearanceRowInjected;
/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export declare function AppearanceRow({ t, setTheme, useStore }: AppearanceRowComponentProps): import("react").JSX.Element;
//# sourceMappingURL=AppearanceRow.d.ts.map