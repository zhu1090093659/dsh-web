/**
 * Themed dropdown select for the section toolbar: a trigger button plus an
 * absolutely positioned listbox popup, replacing the unstyleable native
 * <select>. Keyboard complete (arrows, Home/End, Enter, Esc), closes on
 * outside pointer down, optional group headers render non-selectable.
 * @module @linxin666/dsh-session-archive/client/Select
 */

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import styles from './archive.module.css'

export interface SelectOption {
  value: string
  label: string
  /** Non-selectable group header this option renders under. */
  group?: string
}

interface SelectProps {
  value: string
  options: SelectOption[]
  ariaLabel: string
  onChange: (value: string) => void
}

/** Grouped view of the option list preserving first-appearance group order. */
function groupOptions(options: SelectOption[]): { name: string; items: { option: SelectOption; index: number }[] }[] {
  const groups: { name: string; items: { option: SelectOption; index: number }[] }[] = []
  options.forEach((option, index) => {
    const name = option.group ?? ''
    let group = groups.find((candidate) => candidate.name === name)
    if (group === undefined) {
      group = { name, items: [] }
      groups.push(group)
    }
    group.items.push({ option, index })
  })
  return groups
}

export function Select(props: SelectProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const activeIndex = (open: boolean): number => {
    if (!open) return 0
    const index = props.options.findIndex((option) => option.value === props.value)
    return index === -1 ? 0 : index
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const select = (index: number): void => {
    setOpen(false)
    props.onChange(props.options[index].value)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setActive(activeIndex(true))
        setOpen(true)
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => Math.min(props.options.length - 1, current + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(0, current - 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(props.options.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      select(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  const selectedOption = props.options.find((option) => option.value === props.value)
  const groups = groupOptions(props.options)
  const grouped = groups.some((group) => group.name !== '')

  return (
    <div ref={rootRef} className={styles.selectWrap} onKeyDown={onKeyDown}>
      <button
        type="button"
        className={styles.select}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.ariaLabel}
        onClick={() => { setOpen(!open) }}
      >
        <span className={styles.selectValue}>{selectedOption?.label ?? props.options[0]?.label ?? ''}</span>
        <svg
          className={`${styles.selectChevron} ${open ? styles.selectChevronOpen : ''}`}
          viewBox="0 0 12 12"
          width="10"
          height="10"
          aria-hidden="true"
        >
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div ref={listRef} className={styles.popup} role="listbox" aria-label={props.ariaLabel} aria-activedescendant={`arch-select-opt-${active}`}>
          {groups.map((group) => (
            <div key={group.name}>
              {grouped && <div className={styles.groupLabel}>{group.name}</div>}
              {group.items.map(({ option, index }) => (
                <div
                  key={option.value}
                  id={`arch-select-opt-${index}`}
                  role="option"
                  aria-selected={option.value === props.value}
                  data-active={index === active || undefined}
                  className={`${styles.option} ${index === active ? styles.optionActive : ''}`}
                  onMouseDown={(event) => { event.preventDefault() }}
                  onClick={() => { select(index) }}
                  onMouseMove={() => { setActive(index) }}
                >
                  <span>{option.label}</span>
                  {option.value === props.value && (
                    <svg className={styles.optionCheck} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                      <path d="M2 6.5l2.6 2.6L10 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
