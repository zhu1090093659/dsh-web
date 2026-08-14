import type { ReactNode } from 'react';
/**
 * Transient top-center banner: slides in, holds at full opacity, fades out,
 * then reports done so the owner can unmount it. Re-showing the same text
 * restarts the cycle when the owner remounts the component (key it by a
 * per-show sequence). Rendered through a body portal so an owner inside a
 * transformed or filtered ancestor cannot trap the fixed banner in that
 * ancestor's box.
 *
 * @param props.text - resolved banner copy; the owner passes localized text.
 * @param props.icon - optional leading glyph (e.g. a warning icon).
 * @param props.anchor - optional element whose horizontal center the banner
 * follows (e.g. the composer card, so the banner centers over the chat column
 * rather than the whole window); omitted, it centers on the viewport.
 * @param props.onDone - called once the fade completes; unmount the toast here.
 * @returns the floating banner.
 */
export declare function Toast({ text, icon, anchor, onDone }: {
    text: string;
    icon?: ReactNode;
    anchor?: HTMLElement | null;
    onDone: () => void;
}): import("react").ReactPortal;
//# sourceMappingURL=Toast.d.ts.map