/**
 * Inline 16px icon set for the panel surfaces (outline style, currentColor).
 * No icon package is introduced; the set covers the explorer tree, SCM rows,
 * and the preview toolbar/tabs with plain geometric shapes.
 * @module dsh-aionui-panel/client/components/icons
 */

import type { JSX, SVGProps } from 'react'

interface IconProps {
  size?: number
  className?: string
}

const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
})

export function FolderIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2 3.5h4l1.5 2H14a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
    </svg>
  )
}

export function FolderOpenIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2 3.5h4l1.5 2H14a1 1 0 0 1 1 1v1H3.5a1 1 0 0 0-.96.72L1 13.5V4.5a1 1 0 0 1 1-1Z" />
      <path d="M2.8 11.5 4 7.5h11l-1.4 4a1 1 0 0 1-.96.72H3.76a1 1 0 0 1-.96-.72Z" />
    </svg>
  )
}

export function FileIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 2h5l3 3v9H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M9 2v3h3" />
    </svg>
  )
}

export function FileCodeIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 2h5l3 3v9H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M9 2v3h3" />
      <path d="m6.2 8.6-1.4 1.4 1.4 1.4M9.8 8.6l1.4 1.4-1.4 1.4" />
    </svg>
  )
}

export function FileImageIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 2h5l3 3v9H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M9 2v3h3" />
      <circle cx="6.2" cy="6.8" r="1" />
      <path d="m5 11 1.8-1.8 1.4 1.4 1.3-1.3L12 12" />
    </svg>
  )
}

export function FileTextIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 2h5l3 3v9H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M9 2v3h3" />
      <path d="M6 9h4M6 11.2h4" />
    </svg>
  )
}

export function ChevronRightIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  )
}

export function ChevronDownIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="m3.5 6 4.5 4.5L12.5 6" />
    </svg>
  )
}

export function CloseIcon({ size = 12, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
    </svg>
  )
}

export function PlusIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

export function MinusIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 8h10" />
    </svg>
  )
}

export function UndoIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 3.5 2.5 6 5 8.5" />
      <path d="M2.5 6h8a3.5 3.5 0 0 1 0 7h-3" />
    </svg>
  )
}

export function RefreshIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M13 8a5 5 0 1 1-1.6-3.65" />
      <path d="M13.5 2v2.8h-2.8" />
    </svg>
  )
}

export function SplitIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M8 2.5v11" />
    </svg>
  )
}

export function CodeIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="m5.5 4.5-4 3.5 4 3.5M10.5 4.5l4 3.5-4 3.5" />
    </svg>
  )
}

export function EyeIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}

export function SaveIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 2.5h8l2.5 2.5v8.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
      <path d="M5 2.5v3.5h4.5V2.5M5 13.5V9.5h6v4" />
    </svg>
  )
}

export function DownloadIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 2v7.5M4.5 6.5 8 10l3.5-3.5" />
      <path d="M2.5 13h11" />
    </svg>
  )
}

export function ExternalIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 2.5h4.5V7" />
      <path d="M13.5 2.5 7.5 8.5" />
      <path d="M11.5 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1H7" />
    </svg>
  )
}

export function SearchIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  )
}

export function BranchIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="4" cy="12.5" r="1.5" />
      <circle cx="12" cy="6.5" r="1.5" />
      <path d="M4 5v5M4 10.5c0-2 2-2.5 4-2.5s4-.5 4-1.5" />
    </svg>
  )
}

export function ListIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    </svg>
  )
}

export function TreeIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 3.5h6M8.5 8h5M2.5 8h2" />
      <path d="M6 3.5v7" />
      <path d="M11 8v4.5h-2.5" />
    </svg>
  )
}

export function ShrinkIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M14 14 10 10M10 14v-4h4" />
      <path d="M2 2l4 4M6 2v4H2" />
    </svg>
  )
}

export function ExpandRightIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 3.5 11.5 8 6 12.5" />
    </svg>
  )
}

export function EmptyFolderIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2 3.5h4l1.5 2H14a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" opacity="0.55" />
    </svg>
  )
}

export function MaximizeIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="3" width="10" height="10" rx="1" />
    </svg>
  )
}

export function RestoreIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="5" width="8" height="8" rx="1" />
      <path d="M6.5 3.5h5a1 1 0 0 1 1 1V10" />
    </svg>
  )
}
