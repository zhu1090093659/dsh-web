import { resolve } from 'node:path'

export type PathMapping = {
  pattern: RegExp
  paths: string[]
}

export function resolvePathMappings(
  paths: Record<string, string[]>,
  base: string
) {
  // If a module name can be matched with multiple patterns then pattern
  // with the longest prefix will be picked.
  const sortedPatterns = Object.keys(paths).sort(
    (a: string, b: string) => getPrefixLength(b) - getPrefixLength(a)
  )
  const resolved: PathMapping[] = []
  for (let pattern of sortedPatterns) {
    const relativePaths = paths[pattern]
    pattern = escapeStringRegexp(pattern).replace(/\*/g, '(.+)')
    resolved.push({
      pattern: new RegExp('^' + pattern + '$'),
      paths: relativePaths.map((relativePath) => resolve(base, relativePath)),
    })
  }
  return resolved
}

function getPrefixLength(pattern: string): number {
  const prefixLength = pattern.indexOf('*')
  return pattern.substr(0, prefixLength).length
}

// Adapted from:
// https://github.com/sindresorhus/escape-string-regexp/blob/ba9a4473850cb367936417e97f1f2191b7cc67dd/index.js
//
// MIT License
//
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://
// sindresorhus.com)
//
function escapeStringRegexp(string: string) {
  // Escape characters with special meaning either inside or outside
  // character sets. Use a simple backslash escape when it’s always
  // valid, and a `\xnn` escape when the simpler form would be
  // disallowed by Unicode patterns’ stricter grammar.
  return string.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/-/g, '\\x2d')
}
