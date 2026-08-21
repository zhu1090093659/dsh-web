/**
 * Inline SVG icons for the session-id plugin (16px stroke style matching the
 * shell's nav icons; sized via className where a smaller variant is needed).
 */
import type { SVGProps } from 'react'

/** Shared svg attrs for the 16px stroke icon family. */
function iconProps(props: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> {
  return {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props,
  }
}

/** An ID-card / identifier glyph for the seat trigger and panel title. */
export function SessionIdIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <path d="M4 6.5h2M4 9h2M7.5 6.5h4.5M7.5 9h4.5" />
    </svg>
  )
}

/** Copy glyph. */
export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
      <path d="M2.5 10.5v-7A1.5 1.5 0 0 1 4 2h5.5" />
    </svg>
  )
}

/** Check glyph for the transient copied state. */
export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path d="M3 8.5 6.5 12l6.5-8" />
    </svg>
  )
}

/** Close glyph for the panel header. */
export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}
