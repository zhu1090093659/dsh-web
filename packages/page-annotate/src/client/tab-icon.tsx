/**
 * Inline tab icon for the page-annotate tab (a pen-over-rectangle glyph,
 * 16px nav-icon look). Exported as a React element: better-sidebar renders
 * the descriptor icon as JSX, so a raw SVG string would leak the source
 * text into the sidebar instead of drawing the glyph.
 * @module @linxin666/dsh-page-annotate/client/tab-icon
 */

import type { ReactElement } from 'react'

/** The tab icon element rendered in the sidebar tab list. */
export const TAB_ICON: ReactElement = (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.3}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2" y="3" width="9" height="9" rx="1.5" />
    <path d="M12.5 4.5l1.5 1.5-5.5 5.5H7v-1.5z" />
    <path d="M11 3.5l1.5 1.5" />
  </svg>
)
