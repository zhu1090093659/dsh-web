/**
 * Perception — how the agent sees beyond its workspace.
 *
 * Two read-only sources, both marked untrusted by the caller:
 *  - recent files under whitelisted roots (desktop / documents / downloads /
 *    configured extras), bounded depth, heavy and hidden subtrees skipped;
 *  - an active-process snapshot (ps on POSIX, tasklist fallback on Windows).
 *
 * Everything here is best-effort: a missing root or a failing `ps` degrades
 * to a warning instead of an error, so the agent always gets a report and
 * can reason about what is missing.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PerceptionReport, ProcessEntry, RecentFileEntry } from './protocol.ts'

/** Run a command, collect stdout/stderr, reject on non-zero exit or timeout. */
function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${cmd} timed out`))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 200)}`))
      } else {
        resolvePromise({ stdout, stderr })
      }
    })
  })
}

/** Directory names never entered during the walk. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', '__pycache__', '.cache', '.Trash',
  'AppData', 'Library', '.pnpm-store', 'target', '.next', '.turbo', 'dist', 'build',
])

/** Entries whose name starts with '.' are skipped (hidden). */
function isHidden(name: string): boolean {
  return name.startsWith('.')
}

/** Scan one root up to `depth` levels; collect files and (shallow) directories. */
async function walkRoot(
  root: string,
  depth: number,
  out: RecentFileEntry[],
): Promise<void> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return // missing or unreadable root: caller records the warning
  }
  for (const entry of entries) {
    if (isHidden(entry.name)) continue
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      const full = join(root, entry.name)
      try {
        const info = await stat(full)
        const isProject = existsSync(join(full, '.git'))
        out.push({
          path: full,
          name: entry.name,
          kind: isProject ? 'project' : 'dir',
          // stat.mtimeMs is a float; the tool output schema declares integer.
          mtime: Math.trunc(info.mtimeMs),
        })
      } catch {
        continue
      }
      if (depth > 0) await walkRoot(full, depth - 1, out)
    } else if (entry.isFile()) {
      const full = join(root, entry.name)
      try {
        const info = await stat(full)
        out.push({ path: full, name: entry.name, kind: 'file', mtime: Math.trunc(info.mtimeMs), size: info.size })
      } catch {
        continue
      }
    }
  }
}

/**
 * Collect the most recently modified files/dirs under `roots`, bounded by
 * `max` entries. Missing roots are reported through `warnings`.
 */
export async function listRecentFiles(
  roots: readonly string[],
  max: number,
  options: { depth?: number } = {},
): Promise<{ entries: RecentFileEntry[]; warnings: string[]; scannedRoots: string[] }> {
  const depth = options.depth ?? 3
  const warnings: string[] = []
  const scannedRoots: string[] = []
  const collected: RecentFileEntry[] = []
  for (const raw of roots) {
    const root = resolve(raw)
    if (!existsSync(root)) {
      warnings.push(`root 不存在，已跳过：${root}`)
      continue
    }
    try {
      const info = await stat(root)
      if (!info.isDirectory()) {
        warnings.push(`root 不是目录，已跳过：${root}`)
        continue
      }
    } catch {
      warnings.push(`root 不可读，已跳过：${root}`)
      continue
    }
    scannedRoots.push(root)
    await walkRoot(root, depth, collected)
  }
  collected.sort((a, b) => b.mtime - a.mtime)
  return { entries: collected.slice(0, max), warnings, scannedRoots }
}

/** One parsed process row with its resident memory (KiB, for ranking). */
export interface ParsedProcess {
  pid: number
  name: string
  args: string
  /** Resident set size in KiB on POSIX; tasklist Mem Usage in KiB on Windows. */
  rss: number
}

/**
 * Parse `ps -eo pid=,ppid=,comm=,args=,rss=` output (POSIX).
 *
 * `rss` exists on both procps (Linux) and BSD ps (macOS/FreeBSD), so the
 * memory ranking is portable. Kernel threads are the bracket entries: Linux
 * prints `[kworker/0:0H]` as the args column (comm is truncated to 15 chars),
 * macOS prints `[kernel_task]` in both — the bracket check covers both.
 */
export function parsePsOutput(stdout: string): ParsedProcess[] {
  const out: ParsedProcess[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    // rss is the trailing whitespace-separated number; args may contain
    // spaces and even end in digits, so the reluctant match grows until the
    // anchored final number (the rss column) matches.
    const match = /^(\d+)\s+(\d+)\s+(\S+)\s+(.*?)\s+(\d+)$/.exec(trimmed)
    if (match === null) continue
    out.push({ pid: Number(match[1]), name: match[3], args: match[4], rss: Number(match[5]) })
  }
  return out
}

/**
 * Parse `tasklist /FO CSV /NH` output (Windows fallback). The CSV shape is
 * `"Image Name","PID","Session Name","Session#","Mem Usage"`; Mem Usage is a
 * KiB number with thousand separators and a ` K` suffix. It maps onto
 * `rss` so the shared ranker sees one shape on every platform.
 */
export function parseTasklistOutput(stdout: string): ParsedProcess[] {
  const out: ParsedProcess[] = []
  for (const line of stdout.split('\n')) {
    const match = /^"([^"]+)","(\d+)","[^"]*","[^"]*","([^"]+)"$/.exec(line.trim())
    if (match === null) continue
    const memText = match[3]?.replace(/[^\d]/g, '')
    if (memText === undefined || memText === '') continue
    const name = match[1] ?? ''
    out.push({ pid: Number(match[2]), name, args: name, rss: Number(memText) })
  }
  return out
}

/** Kernel-thread / pseudo-process marker: bracket names on POSIX ps output. */
export function isKernelThread(entry: Pick<ParsedProcess, 'name' | 'args'>): boolean {
  return entry.name.startsWith('[') || entry.args.startsWith('[')
}

/** Windows tasklist pseudo-processes that are not real user processes. */
export const TASKLIST_NOISE = new Set(['System Idle Process', 'System', 'Registry'])

/** Platform noise predicate: bracket threads on POSIX, pseudo-processes on Windows. */
export function isNoise(entry: ParsedProcess): boolean {
  return isKernelThread(entry) || TASKLIST_NOISE.has(entry.name)
}

/**
 * Filter noise and rank by resident memory (descending) — the "top active
 * processes" the design intends, portable across ps variants. The caller
 * dedupes and applies the cap so dedup cannot shrink the result below max.
 */
export function rankProcesses(entries: ParsedProcess[]): ParsedProcess[] {
  return entries.filter(entry => !isNoise(entry)).sort((a, b) => b.rss - a.rss)
}

/**
 * Snapshot active processes. Never throws: on failure it returns an empty
 * list plus a warning (the report must degrade, not die).
 */
export async function listProcesses(max: number): Promise<{ entries: ProcessEntry[]; warnings: string[] }> {
  const warnings: string[] = []
  const ownPid = String(process.pid)
  try {
    const { stdout } = await runCommand('ps', ['-eo', 'pid=,ppid=,comm=,args=,rss='], 5000)
    const seen = new Set<string>()
    const entries: ProcessEntry[] = []
    for (const entry of rankProcesses(parsePsOutput(stdout))) {
      if (String(entry.pid) === ownPid) continue
      // Dedupe identical command lines (threads / repeated invocations).
      const key = `${entry.name}\u0000${entry.args}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({ pid: entry.pid, name: entry.name, args: entry.args })
      if (entries.length >= max) break
    }
    return { entries, warnings }
  } catch {
    // POSIX ps unavailable — try the Windows fallback, then degrade.
    try {
      const { stdout } = await runCommand('tasklist', ['/FO', 'CSV', '/NH'], 5000)
      const entries = rankProcesses(parseTasklistOutput(stdout))
        .filter(entry => String(entry.pid) !== ownPid)
        .slice(0, max)
        .map(entry => ({ pid: entry.pid, name: entry.name, args: entry.args }))
      return { entries, warnings }
    } catch {
      warnings.push('进程快照不可用（ps/tasklist 均失败），进程列表为空')
      return { entries: [], warnings }
    }
  }
}

/**
 * Full perception pass. `roots` are the configured whitelist; `maxRecentFiles`
 * and `maxProcesses` bound the report size.
 */
export async function perceive(
  roots: readonly string[],
  maxRecentFiles: number,
  maxProcesses: number,
): Promise<PerceptionReport> {
  const [files, processes] = await Promise.all([
    listRecentFiles(roots, maxRecentFiles),
    listProcesses(maxProcesses),
  ])
  return {
    sourceTrust: 'untrusted',
    scannedAt: new Date().toISOString(),
    roots: files.scannedRoots,
    recentFiles: files.entries,
    processes: processes.entries,
    warnings: [...files.warnings, ...processes.warnings],
  }
}
