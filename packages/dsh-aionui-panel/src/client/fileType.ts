/**
 * Preview content-type detection from a file name — the router's single
 * source of truth for what a file becomes when opened (mirrors AionUi's
 * getFileTypeInfo table, re-derived for the panel's format set).
 * @module dsh-aionui-panel/client/fileType
 */

import type { PreviewContentType } from '../core/types.ts'

/** Markdown extensions. */
const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdx'])
/** HTML extensions. */
const HTML_EXT = new Set(['html', 'htm', 'xhtml'])
/** Diff extensions. */
const DIFF_EXT = new Set(['diff', 'patch'])
/** CSV. */
const CSV_EXT = new Set(['csv'])
/** PDF. */
const PDF_EXT = new Set(['pdf'])
/** Office documents. */
const WORD_EXT = new Set(['doc', 'docx', 'odt', 'rtf'])
const EXCEL_EXT = new Set(['xls', 'xlsx', 'ods'])
const PPT_EXT = new Set(['ppt', 'pptx', 'odp'])
/** Images. */
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'])
/** Extensions treated as editable code/text. */
const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'css', 'scss', 'less',
  'yml', 'yaml', 'toml', 'xml', 'sh', 'bash', 'zsh', 'fish', 'rs', 'py', 'go',
  'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'sql', 'php', 'rb', 'swift', 'kt',
  'vue', 'svelte', 'astro', 'txt', 'log', 'ini', 'env', 'conf', 'cfg', 'gitignore',
  'dockerfile', 'makefile', 'graphql', 'proto', 'prisma', 'zig', 'lua', 'r', 'dart',
  'ex', 'exs', 'erl', 'hs', 'clj', 'scala', 'groovy', 'vb', 'ps1', 'bat', 'cmd',
  'pl', 'pm', 'tcl', 'asm', 's', 'f', 'f90', 'jl', 'nim', 'ml', 'elm', 'purs',
  'solidity', 'sol', 'tf', 'hcl', 'dockerignore', 'editorconfig', 'prettierrc',
  'eslintrc', 'babelrc', 'npmrc', 'nix', 'lock', 'map',
])
/** No-extension names that are plain text. */
const TEXT_NAMES = new Set([
  'license', 'licence', 'readme', 'changelog', 'contributing', 'authors', 'notice',
  'makefile', 'dockerfile', 'justfile', 'gemfile', 'rakefile', 'procfile',
])
/**
 * Leading-dot config dotfiles whose full (dotted) basename is plain text. The
 * de-dot rule below maps most single-dot files (`.gitignore` -> ext `gitignore`)
 * into CODE_EXT; these multi-suffix / uncommon ones have no useful extension
 * (`.env.local` -> `local`), so we match them by their whole dotted name.
 */
const DOTFILE_TEXT_NAMES = new Set([
  '.gitignore', '.gitattributes', '.gitmodules', '.env', '.env.local',
  '.env.production', '.env.development', '.env.test', '.npmrc', '.npmrc.template',
  '.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.babelrc', '.babelrc.json',
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.editorconfig', '.dockerignore',
  '.eslintignore', '.prettierignore', '.gitignore.local', '.hgignore',
])

/** Detect the preview content type of a file by name (lowercased). */
export function detectContentType(name: string): PreviewContentType {
  const base = name.split('/').pop() ?? name
  const lower = base.toLowerCase()
  const dot = lower.lastIndexOf('.')
  // Leading-dot files: the first dot is the hidden-file marker, not a
  // separator — take the text after it (`.gitignore` -> `gitignore`).
  const ext = lower[0] === '.'
    ? (dot > 0 ? lower.slice(dot + 1) : lower.slice(1))
    : (dot > 0 ? lower.slice(dot + 1) : '')
  const stem = dot > 0 ? lower.slice(0, dot) : lower
  if (lower[0] === '.' && DOTFILE_TEXT_NAMES.has(lower)) return 'text'
  if (ext === '' && TEXT_NAMES.has(stem)) return 'text'
  if (ext === '') return 'unsupported'
  if (MARKDOWN_EXT.has(ext)) return 'markdown'
  if (HTML_EXT.has(ext)) return 'html'
  if (DIFF_EXT.has(ext)) return 'diff'
  if (CSV_EXT.has(ext)) return 'csv'
  if (PDF_EXT.has(ext)) return 'pdf'
  if (WORD_EXT.has(ext)) return 'word'
  if (EXCEL_EXT.has(ext)) return 'excel'
  if (PPT_EXT.has(ext)) return 'ppt'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (CODE_EXT.has(ext)) return 'code'
  return 'unsupported'
}

/** Whether the type can be edited and saved back. */
export function isEditableType(type: PreviewContentType): boolean {
  return type === 'markdown' || type === 'html' || type === 'code' || type === 'csv' || type === 'text'
}

/** Whether the type reads its content as text (vs image data URL). */
export function isTextType(type: PreviewContentType): boolean {
  return type !== 'image' && type !== 'pdf' && type !== 'word' && type !== 'excel'
    && type !== 'ppt' && type !== 'unsupported' && type !== 'url'
}

/** A stable tab id from the file identity (root + path + type). */
export function tabIdOf(root: string, path: string, type: PreviewContentType): string {
  return `${root}\u0000${path}\u0000${type}`
}

/** The language hint for code tabs (extension without the dot). */
export function languageOf(name: string): string {
  const base = name.split('/').pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1) : ''
}

/** The title for a tab: the basename. */
export function basenameOf(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

/** The parent relative path of a path ('' for a root-level item). */
export function parentRel(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx > 0 ? path.slice(0, idx) : ''
}

/**
 * The streaming URL a pdf tab renders: the host raw route serves the bytes
 * with mime application/pdf, so the preview iframe loads them directly — no
 * base64 round-trip and no read-size cap. The nonce defeats browser caching
 * when the tab is refreshed after the file changed on disk.
 *
 * Contributed by EricWang1358 (#239).
 */
export function pdfPreviewUrl(root: string, path: string, nonce: number): string {
  return `/aionui-panel/raw?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}&v=${nonce}`
}
