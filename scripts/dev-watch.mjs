#!/usr/bin/env node
// Watch-rebuild every browser bundle the Web GUI reads from a source edit.
// The dsh web host stat-polls the lib/client.js files it serves and broadcasts
// reload frames itself, so keeping these bundles rebuilt is the whole dev loop:
// edit -> this script rewrites the bundle -> the GUI reloads on its own.
// Type safety is NOT this script's job (tsdown strips types); run
// `pnpm typecheck` / `pnpm build` before committing.
//
// Usage: pnpm dev:watch   (Ctrl-C stops every child watcher)

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(root, 'packages')

/** Packages with both a browser entry and a shared-preset tsdown config. */
const targets = readdirSync(packagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) =>
    existsSync(join(packagesDir, name, 'src/client/index.ts'))
    && existsSync(join(packagesDir, name, 'tsdown.config.ts')),
  )
  .sort()

if (targets.length === 0) {
  console.error('[dev-watch] no watchable packages found under packages/')
  process.exit(1)
}

console.log('[dev-watch] watching ' + String(targets.length) + ' packages: ' + targets.join(', '))

const children = targets.map((name) => {
  const child = spawn('pnpm', ['exec', 'tsdown', '--watch'], {
    cwd: join(packagesDir, name),
    env: process.env,
  })
  const tag = '[' + name + '] '
  const pipe = (stream, out) => {
    let rest = ''
    stream.on('data', (chunk) => {
      const lines = (rest + chunk.toString()).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) if (line.trim() !== '') out(tag + line)
    })
  }
  pipe(child.stdout, (l) => console.log(l))
  pipe(child.stderr, (l) => console.error(l))
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.error('[dev-watch] ' + name + ' exited (code=' + String(code) + ' signal=' + String(signal) + '); stopping all watchers')
    shutdown(code ?? 1)
  })
  return child
})

let shuttingDown = false
function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGINT')
  setTimeout(() => process.exit(code), 1500).unref()
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
