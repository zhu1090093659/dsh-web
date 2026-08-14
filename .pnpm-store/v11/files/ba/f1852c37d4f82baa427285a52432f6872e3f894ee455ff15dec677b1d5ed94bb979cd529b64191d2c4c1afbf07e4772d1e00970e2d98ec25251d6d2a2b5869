import type { ReactNode } from 'react';
/**
 * Render a centered modal over a blurred page mask.
 * @param props.open - whether the dialog is showing.
 * @param props.onClose - Escape or mask click.
 * @param props.title - dialog heading (aria-label in every mode).
 * @param props.closeLabel - accessible close-button label.
 * @param props.description - optional supporting sentence under the title.
 * @param props.children - body (inputs, etc.).
 * @param props.footer - action row (Cancel / Create).
 * @param props.contentClassName - optional class for a scrollable content region.
 * @param props.headless - render children directly in the card (no default
 * header/close/body chrome) for dialogs whose figma frame owns its own
 * header structure; mask, card, Escape, and aria-label remain.
 * @param props.closeLabel - close-button aria label; the owner passes
 * localized copy (this package is cordis-free, so copy arrives via props).
 * @returns null when closed; otherwise the overlay tree.
 */
export declare function Modal({ open, onClose, title, closeLabel, description, children, footer, className, contentClassName, headless, }: {
    open: boolean;
    onClose: () => void;
    title: string;
    closeLabel?: string;
    description?: string;
    children?: ReactNode;
    footer?: ReactNode;
    className?: string;
    contentClassName?: string;
    headless?: boolean;
}): import("react").ReactPortal | null;
//# sourceMappingURL=Modal.d.ts.map