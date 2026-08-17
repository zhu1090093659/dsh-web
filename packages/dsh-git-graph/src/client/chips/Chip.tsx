/**
 * The shared chip button: one pill in the context row above the input.
 * @module dsh-git-graph/client/chips/Chip
 */

import type { ReactNode } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './context.module.css'

/** Join conditional class names (the dependency-free clsx stand-in). */
export function cx(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ')
}

/** Props of one context chip. */
export interface ChipProps {
  icon: ReactNode
  label: string
  ariaLabel: string
  open: boolean
  onClick: () => void
  /** The official hero-row seat style (transparent 28px pill beside the preset chip). */
  hero?: boolean
}

/** The pill button shared by the project and branch chips. */
export function Chip({ icon, label, ariaLabel, open, onClick, hero = false }: ChipProps) {
  return (
    <button
      type="button"
      data-gitgraph-chip
      className={cx(css.chip, open && css.chipOpen, hero && css.chipHero)}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={open}
    >
      {icon}
      <span className={css.chipLabel} title={label}>{label}</span>
      <IconChevronDownOutline14 className={css.chipChevron} size={12} />
    </button>
  )
}

/** Full-screen transparent backdrop closing the open popover/dialog on click. */
export function Backdrop({ onClose }: { onClose: () => void }) {
  return <div className={css.backdrop} onClick={onClose} />
}
