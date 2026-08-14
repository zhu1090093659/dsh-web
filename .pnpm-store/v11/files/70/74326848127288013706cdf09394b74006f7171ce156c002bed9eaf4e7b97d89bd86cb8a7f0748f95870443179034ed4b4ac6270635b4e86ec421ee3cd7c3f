import type { ReactNode, RefObject } from 'react';
import type { ConversationSlotProps } from '../contract/slots.ts';
/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationSlotProps['t'];
/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export declare function workspaceLabel(cwd: string): string;
/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose workspace" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export declare function WorkspaceChip({ buttonRef, label, menuOpen, onClick, t }: {
    buttonRef?: RefObject<HTMLButtonElement>;
    label?: string | undefined;
    menuOpen?: boolean;
    onClick?: () => void;
    t: HeroTranslate;
}): import("react").JSX.Element;
/**
 * The soft blue backdrop ellipse (figma 313:14109). Rendered by the hero
 * owner (ConversationRoot), not HeroShell, so it can center on the input
 * card; the owner's className supplies all positioning.
 * @param props.className - positioning class from the owner.
 * @returns the blurred-ellipse svg element.
 */
export declare function HeroGlow({ className }: {
    className?: string | undefined;
}): import("react").JSX.Element;
/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
    /** The owner's locale seat, passed down as a plain prop. */
    t: HeroTranslate;
    /** Overlay content after the stack (modals). */
    children?: ReactNode;
}
/**
 * Render the hero chrome (headline only; no glow, no composer, no workspace
 * row — the glow is the owner's {@link HeroGlow}).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export declare function HeroShell({ t, children }: HeroShellProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=EmptyHero.d.ts.map