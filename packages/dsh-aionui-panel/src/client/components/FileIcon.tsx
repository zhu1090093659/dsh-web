/**
 * File icons for the tree: real per-language logos vendored from the
 * vscode-icons extension (see fileLogos.ts). Directories keep the classic
 * folder glyph for the SCM tree; the explorer file tree renders only the
 * chevron for folders.
 * @module dsh-aionui-panel/client/components/FileIcon
 */

import type { JSX } from 'react'
import { detectContentType } from '../fileType.ts'
import { FILE_ICON_SVGS } from '../fileLogos.ts'
import { FolderIcon, FolderOpenIcon } from './icons.tsx'

/** Extension -> vscode-icons logo id. */
const EXT_ICONS: Record<string, string> = {
  ts: 'typescript', tsx: 'reactts', mts: 'typescript', cts: 'typescript',
  js: 'js', jsx: 'reactjs', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json',
  html: 'html', htm: 'html', xhtml: 'html',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  yml: 'yaml', yaml: 'yaml',
  py: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  rs: 'rust', go: 'go', java: 'java',
  c: 'c', h: 'cppheader', hpp: 'cppheader',
  cpp: 'cpp', cc: 'cpp', hh: 'cppheader', cxx: 'cpp',
  cs: 'csharp', php: 'php', rb: 'ruby', swift: 'swift',
  kt: 'kotlin', kotlin: 'kotlin', sql: 'sql',
  vue: 'vue', svelte: 'svelte', pdf: 'pdf2',
  toml: 'toml', graphql: 'graphql', gql: 'graphql',
  lua: 'lua', dart: 'dartlang', zig: 'zig',
  ps1: 'powershell', bat: 'bat', cmd: 'bat',
  env: 'dotenv', lock: 'default',
}

/** Full-basename specials (dockerfile, makefile, ...). */
const NAME_ICONS: Record<string, string> = {
  dockerfile: 'docker', makefile: 'default', license: 'license', licence: 'license',
}

/** Lower-cased extension of a basename (dotfiles follow fileType.ts). */
function extOf(name: string): string {
  const base = name.split('/').pop() ?? name
  const lower = base.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (lower[0] === '.') return dot > 0 ? lower.slice(dot + 1) : ''
  return dot > 0 ? lower.slice(dot + 1) : ''
}

/** The vscode-icons logo id for a file name. */
function logoIdOf(name: string): string {
  const base = (name.split('/').pop() ?? name).toLowerCase()
  const nameIcon = NAME_ICONS[base]
  if (nameIcon !== undefined) return nameIcon
  const ext = extOf(name)
  const extIcon = EXT_ICONS[ext]
  if (extIcon !== undefined) return extIcon
  const type = detectContentType(name)
  if (type === 'image') return 'image'
  if (type === 'text') return 'text'
  return 'default'
}

/** The icon for one tree entry (16x16, real vscode-icons logos). */
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
  const id = logoIdOf(name)
  const svg = FILE_ICON_SVGS[id] ?? FILE_ICON_SVGS.default
  return (
    <span
      className={`aionui-file-logo${className === undefined ? '' : ` ${className}`}`}
      data-file-logo={id}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
