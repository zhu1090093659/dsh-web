/**
 * dsh-taskboard-agent — browser half.
 *
 * Runs inside the web GUI (same origin as the task-board plugin), so it can
 * read/write localStorage['dsh.taskBoard.v1'] directly. Every poll cycle
 * (POLL_MS):
 *   1. POST /api/dsh-taskboard-agent/sync — push the current ledger to the host
 *      so the agent can read it back via task_board_list;
 *   2. GET  /api/dsh-taskboard-agent/pending — drain mutation ops and apply them
 *      (create = append dedup by id, update = merge patch, delete = remove).
 * Because the task-board plugin only loads the ledger when its board mounts, a
 * page refresh (F5) shows the new cards.
 *
 * The bundle registers itself through the dsh client module loader
 * (window.__ModuleLoader__.load), mirroring the official client bundles.
 */

declare global {
  interface Window {
    __ModuleLoader__: {
      load(m: { id: string; factory: (r?: unknown) => unknown }): void | unknown
    }
  }
}

const PENDING_PATH = '/api/dsh-taskboard-agent/pending'
const SYNC_PATH = '/api/dsh-taskboard-agent/sync'
const STORAGE_KEY = 'dsh.taskBoard.v1'
const POLL_MS = 1500

/** Structural validation matching the task-board ledger shape. */
function isTaskRow(value: any) {
  const v = value
  if (typeof v !== 'object' || v === null) return false
  return (
    typeof v.id === 'string' && v.id !== '' &&
    typeof v.title === 'string' &&
    typeof v.description === 'string' &&
    typeof v.prompt === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.updatedAt === 'number' &&
    Array.isArray(v.executions)
  )
}

/** Structural validation for mutation ops returned by the host. */
function isOp(value: any) {
  const v = value
  if (typeof v !== 'object' || v === null) return false
  if (typeof v.op !== 'string') return false
  if (v.op === 'create') return isTaskRow(v.task)
  if (v.op === 'update') return typeof v.id === 'string' && v.id !== '' && typeof v.patch === 'object' && v.patch !== null
  if (v.op === 'delete') return typeof v.id === 'string' && v.id !== ''
  return false
}

function readLedger(storageKey: any) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey || STORAGE_KEY) : null
    if (raw === null) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((row) => (isTaskRow(row) ? [row] : []))
  } catch {
    return []
  }
}

function writeLedger(storageKey: any, tasks: any) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey || STORAGE_KEY, JSON.stringify(tasks, null, 2))
    }
  } catch {}
}

/** Push the current ledger to the host (mirror update); fire-and-forget. */
async function pushSync() {
  // 空 ledger 也照常推送，保证宿主镜像始终准确（删光卡后列表不会读到陈旧数据）。
  const ledger = readLedger(STORAGE_KEY)
  try {
    await fetch(SYNC_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ledger),
    })
  } catch {
    /* 推送失败不影响轮询，下次再试 */
  }
}

/** Apply mutation ops in place; returns true if the ledger changed. */
function applyOps(ledger: any, ops: any) {
  let changed = false
  for (const op of ops) {
    if (op.op === 'create') {
      const task = op.task
      if (!ledger.some((t: any) => t.id === task.id)) {
        ledger.push(task)
        changed = true
      }
    } else if (op.op === 'update') {
      const card = ledger.find((t: any) => t.id === op.id)
      if (card) {
        let dirty = false
        for (const k of ['status', 'title', 'description', 'prompt']) {
          if (typeof op.patch[k] === 'string' && op.patch[k] !== card[k]) {
            card[k] = op.patch[k]
            dirty = true
          }
        }
        if (dirty) {
          card.updatedAt = Date.now()
          changed = true
        }
      }
    } else if (op.op === 'delete') {
      const i = ledger.findIndex((t: any) => t.id === op.id)
      if (i >= 0) {
        ledger.splice(i, 1)
        changed = true
      }
    }
  }
  return changed
}

/** One poll cycle: push mirror, drain ops, apply, persist. */
async function syncAll() {
  pushSync() // fire-and-forget
  let res
  try {
    res = await fetch(`${PENDING_PATH}?max=50`, { cache: 'no-store' })
  } catch {
    return 0
  }
  if (!res.ok) return 0
  let data
  try {
    data = await res.json()
  } catch {
    return 0
  }
  const key = typeof data.storageKey === 'string' ? data.storageKey : STORAGE_KEY
  const ledger = readLedger(key)
  let changed = false
  const ops = Array.isArray(data.ops) ? data.ops.filter(isOp) : []
  if (ops.length > 0) {
    changed = applyOps(ledger, ops)
  } else {
    // 兼容旧宿主：仅 tasks（create）
    const incoming = Array.isArray(data.tasks) ? data.tasks.filter(isTaskRow) : []
    for (const t of incoming) {
      if (!ledger.some((x) => x.id === t.id)) {
        ledger.push(t)
        changed = true
      }
    }
  }
  if (changed) writeLedger(key, ledger)
  return changed ? 1 : 0
}

const apply = (ctx?: unknown) => {
  const timerId = setInterval(() => {
    syncAll().catch(() => {})
  }, POLL_MS)
  syncAll().catch(() => {})
  return () => {
    clearInterval(timerId)
  }
}

// dsh client-module registration contract: id must equal the package name;
// factory is CJS-style, exporting { apply, inject }.
// Keep the id in sync with the package name on any rename (the loader indexes
// client modules by package name).
window.__ModuleLoader__.load({
  id: '@linxin666/dsh-taskboard-agent',
  factory: (require?: unknown) => {
    const module: { exports: Record<string, unknown> } = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})

export {}
