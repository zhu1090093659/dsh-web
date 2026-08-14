/**
 * 16x16 file/folder icons for the tree. Folders keep the outline style; files
 * use per-language colored badges (rounded square + short label in the
 * language's brand color, the way VSCode file-icon themes do it) with the old
 * kind icons as the fallback for unmapped types — still no icon package.
 * @module dsh-aionui-panel/client/components/FileIcon
 */

import type { JSX } from 'react'
import { detectContentType } from '../fileType.ts'
import {
  FileCodeIcon, FileIcon, FileImageIcon, FileTextIcon, FolderIcon, FolderOpenIcon,
} from './icons.tsx'

/** One colored-badge icon: brand color + a ≤3-letter label. */
interface BadgeSpec {
  color: string
  label: string
}

/** Extension → badge, covering the everyday dev tree (lowercased extension, no dot). */
const EXT_BADGES: Record<string, BadgeSpec> = {
  ts: { color: '#3178c6', label: 'TS' },
  tsx: { color: '#3178c6', label: 'TS' },
  mts: { color: '#3178c6', label: 'TS' },
  cts: { color: '#3178c6', label: 'TS' },
  js: { color: '#d4b106', label: 'JS' },
  jsx: { color: '#d4b106', label: 'JS' },
  mjs: { color: '#d4b106', label: 'JS' },
  cjs: { color: '#d4b106', label: 'JS' },
  json: { color: '#a074c4', label: '{}' },
  md: { color: '#519aba', label: 'MD' },
  mdx: { color: '#519aba', label: 'MD' },
  py: { color: '#3572a5', label: 'Py' },
  rs: { color: '#c07a4a', label: 'Rs' },
  go: { color: '#00add8', label: 'Go' },
  java: { color: '#b07219', label: 'Ja' },
  kt: { color: '#7f52ff', label: 'Kt' },
  c: { color: '#6d8086', label: 'C' },
  h: { color: '#6d8086', label: 'H' },
  cpp: { color: '#f34b7d', label: 'C+' },
  cs: { color: '#953dac', label: 'C#' },
  php: { color: '#4f5d95', label: 'PHP' },
  rb: { color: '#cc342d', label: 'Rb' },
  swift: { color: '#f05138', label: 'Sw' },
  sh: { color: '#4eaa25', label: 'SH' },
  bash: { color: '#4eaa25', label: 'SH' },
  ps1: { color: '#012456', label: 'PS' },
  yaml: { color: '#cb171e', label: 'Y' },
  yml: { color: '#cb171e', label: 'Y' },
  toml: { color: '#9c4221', label: 'T' },
  xml: { color: '#8fbc8f', label: 'XML' },
  html: { color: '#e34c26', label: '<>' },
  css: { color: '#563d7c', label: '#' },
  scss: { color: '#c6538c', label: 'S' },
  less: { color: '#2b4c80', label: 'L' },
  vue: { color: '#41b883', label: 'V' },
  sql: { color: '#e38c00', label: 'SQ' },
  csv: { color: '#237346', label: 'CSV' },
  pdf: { color: '#b30b00', label: 'PDF' },
  lock: { color: '#6d8086', label: 'LK' },
}

/** Well-known exact filenames that beat their extension mapping. */
const NAME_BADGES: Record<string, BadgeSpec> = {
  'package.json': { color: '#cb3837', label: 'N' },
  'dockerfile': { color: '#2496ed', label: 'D' },
  '.gitignore': { color: '#f05033', label: 'G' },
}

/** Rounded-square badge with a short label, filled in the language color. */
function FileBadgeIcon({
  size = 16,
  color,
  label,
  className,
}: {
  size?: number
  color: string
  label: string
  className?: string
}): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className={className}>
      <rect x="1" y="1.5" width="14" height="13" rx="2.5" fill={color} />
      <text
        x="8"
        y="11.4"
        textAnchor="middle"
        fontSize={label.length > 2 ? 5.5 : 7.5}
        fontWeight={700}
        fill="#ffffff"
        fontFamily="system-ui, sans-serif"
      >
        {label}
      </text>
    </svg>
  )
}

/** The badge for a filename, or undefined when neither table knows it. */
function badgeOf(name: string): BadgeSpec | undefined {
  const lower = name.toLowerCase()
  const named = NAME_BADGES[lower]
  if (named !== undefined) return named
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return undefined
  return EXT_BADGES[lower.slice(dot + 1)]
}

/** The icon for one tree entry (16x16; folders outline, files colored badges with kind fallbacks). */
export function FileTypeIcon({
  name,
  isDir,
  expanded,
  className,
}: {
  name: string
  isDir: boolean
  expanded: boolean
  className?: string
}): JSX.Element {
  if (isDir) {
    return expanded
      ? <FolderOpenIcon size={16} className={className} />
      : <FolderIcon size={16} className={className} />
  }
  const badge = badgeOf(name)
  if (badge !== undefined) {
    return <FileBadgeIcon size={16} color={badge.color} label={badge.label} className={className} />
  }
  const type = detectContentType(name)
  switch (type) {
    case 'image':
      return <FileImageIcon size={16} className={className} />
    case 'markdown':
    case 'text':
      return <FileTextIcon size={16} className={className} />
    case 'code':
    case 'diff':
    case 'csv':
    case 'html':
      return <FileCodeIcon size={16} className={className} />
    default:
      return <FileIcon size={16} className={className} />
  }
}
