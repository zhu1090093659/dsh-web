import type { ReactNode } from 'react';
/** Selectable row (optionally with a nested submenu). */
export interface MenuItem {
    id: string;
    label: ReactNode;
    disabled?: boolean;
    /** Leading icon (figma .Menu_cell gap 8). */
    icon?: ReactNode;
    /** Destructive row: error-colored text/icon and danger hover fill. */
    danger?: boolean;
    /** Nested card opened to the right on hover/focus. */
    submenu?: readonly MenuItem[];
}
/** Hairline between item groups (not selectable). */
export interface MenuSeparator {
    type: 'separator';
    id: string;
}
/** Non-interactive heading row above a group of items. */
export interface MenuLabel {
    type: 'label';
    id: string;
    text: string;
}
/** One primary-menu entry: a row, a separator, or a heading label. */
export type MenuEntry = MenuItem | MenuSeparator | MenuLabel;
/**
 * Render an anchored dropdown menu.
 * @param props.open - whether the list is showing (owner-controlled).
 * @param props.anchor - the trigger element (rendered in place).
 * @param props.items - selectable rows and optional separators.
 * @param props.selectedId - row shown as selected.
 * @param props.selectedIds - rows shown as selected when a menu contains independent option groups.
 * @param props.onSelect - row click callback (not called for disabled rows or submenu parents that only open children).
 * @param props.onClose - invoked on outside click or Escape.
 * @param props.align - list alignment against the anchor (default 'start').
 * @param props.side - open below (`bottom`, default) or above (`top`) the anchor.
 * @param props.portal - render the list into document.body, fixed-positioned
 * from the anchor rect (repositions on scroll/resize while open). Use when an
 * ancestor's overflow clipping would crop the in-place list; default false
 * keeps the pure-CSS in-place behavior.
 * @param props.closeOnPointerLeave - close the list once the pointer has left
 * both trigger and list for the pointer grace (default false keeps it open
 * until outside click/Escape/selection). The grace makes the 4px trigger->list
 * gap and a brief overshoot survivable; coming back cancels the close.
 * @param props.dense - reduce vertical row spacing without changing the standard typography or card width.
 * @param props.compact - use reduced menu typography and spacing.
 * @param props.getAnchorRect - portal mode only: supply the anchor rect
 * directly (e.g. from a host-owned trigger button) instead of measuring the
 * Menu's own wrapper span. Required when the wrapper isn't itself laid out at
 * the trigger (render-prop anchors, effect-positioned proxies — measuring the
 * wrapper there races the host's layout effects). Called on open and on every
 * scroll/resize; return null to skip placement for that frame.
 * @param props.footer - rows pinned below the scrolling items area, separated
 * by a hairline; they stay visible while the items above scroll.
 * @returns anchor wrapper with the conditional list.
 */
export declare function Menu({ open, anchor, items, selectedId, selectedIds, onSelect, onClose, align, side, portal, closeOnPointerLeave, dense, compact, getAnchorRect, footer, className }: {
    open: boolean;
    anchor: ReactNode;
    items: readonly MenuEntry[];
    footer?: readonly MenuEntry[];
    selectedId?: string | undefined;
    selectedIds?: readonly string[] | undefined;
    onSelect: (id: string) => void;
    onClose: () => void;
    align?: 'start' | 'end';
    side?: 'bottom' | 'top' | 'right';
    portal?: boolean;
    closeOnPointerLeave?: boolean;
    dense?: boolean;
    compact?: boolean;
    getAnchorRect?: () => DOMRect | null;
    className?: string;
}): import("react").JSX.Element;
//# sourceMappingURL=Menu.d.ts.map