/**
 * dsh-taskboard-agent — host half.
 *
 * 双向桥 + 文件持久化：
 *  - mutation 队列：工具入队 op 信封（create / update / delete），浏览器半区轮询
 *    GET /api/dsh-taskboard-agent/pending 取走并应用；
 *  - snapshot：浏览器 ledger 的镜像（浏览器 POST /api/dsh-taskboard-agent/sync 推来），
 *    供 task_board_list 等只读工具使用；
 *  - 文件持久化：默认 {DSH_HOME}/dsh-taskboard-agent/board.json（config.filePath 可覆盖），apply 时载入、每次 sync 写盘；读写失败降级为纯内存，不崩。
 *
 * schema 硬约束（已按宿主校验器验证）：
 *  1. 工具必须 defineTool() 包装后 tools.register(defineTool(tool))；
 *  2. 参数方言：属性级 required 只能缺省或为 true，禁止 required:false；
 *  3. output.schema 是值 schema DSL，禁止顶层 required 数组；
 *  4. output 必须含 { schema, render }。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const name = 'dsh-taskboard-agent'
export const inject = ['tools', 'systemPrompt', 'webServer']

const PENDING_PATH = '/api/dsh-taskboard-agent/pending'
const SYNC_PATH = '/api/dsh-taskboard-agent/sync'
const STORAGE_KEY = 'dsh.taskBoard.v1'

/** Normalize tool input into a task record matching the board's shape. */
function normalizeTask(a: any) {
  const title = typeof a?.title === 'string' ? a.title.trim() : ''
  if (title === '') return null
  const description = typeof a?.description === 'string' ? a.description.trim() : ''
  const prompt = typeof a?.prompt === 'string' ? a.prompt.trim() : ''
  const now = Date.now()
  return {
    id: `t-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    description,
    prompt,
    status: 'todo',
    createdAt: now,
    updatedAt: now,
    executions: [],
  }
}

/** 行结构校验（与浏览器半区 isTaskRow 对应，多查 status 字段）。 */
function isCardRow(v: any) {
  if (typeof v !== 'object' || v === null) return false
  return (
    typeof v.id === 'string' && v.id !== '' &&
    typeof v.title === 'string' &&
    typeof v.description === 'string' &&
    typeof v.prompt === 'string' &&
    typeof v.status === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.updatedAt === 'number' &&
    Array.isArray(v.executions)
  )
}

/** 默认持久化路径；DSH_HOME 缺失时返回 null（纯内存模式）。 */
function defaultFilePath() {
  const home = typeof process !== 'undefined' && process.env ? process.env.DSH_HOME : undefined
  if (typeof home !== 'string' || home === '') return null
  return join(home, 'dsh-taskboard-agent', 'board.json')
}

export function apply(ctx: any, config: any) {
  let mutations: any[] = [] // op 信封队列
  let snapshot: any[] = [] // 浏览器 ledger 镜像
  const filePath =
    config && typeof config.filePath === 'string' && config.filePath !== ''
      ? config.filePath
      : defaultFilePath()

  const persist = () => {
    if (!filePath) return
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8')
    } catch {
      /* 降级：仅内存，不崩 */
    }
  }
  const load = () => {
    if (!filePath) return
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
      if (Array.isArray(parsed)) snapshot = parsed.filter(isCardRow)
    } catch {
      /* 首次无文件或损坏：空快照 */
    }
  }
  load()

  const drain = (max: any) => {
    const n = Number.isFinite(max) && max > 0 ? max : mutations.length
    const out = mutations.slice(0, n)
    mutations = mutations.slice(n)
    return out
  }

  // Agent-visible tools.
  ctx.inject(['tools'], (toolsCtx: any) => {
    const render = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
      { type: 'text', text: JSON.stringify(value) },
    ]

    const createTool = {
      name: 'task_board_create',
      description:
        'Create kanban cards on the dsh task board (agent bridge). The browser half applies them into localStorage["dsh.taskBoard.v1"]; the board shows them after a page refresh. Call once per task.',
      parameters: {
        title: { type: 'string', required: true, description: 'Card title (one line)' },
        description: { type: 'string', description: 'Optional background / scope / acceptance' },
        prompt: { type: 'string', description: 'Full instruction; when blank the title drives the task' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            id: { type: 'string' },
            pending: { type: 'number' },
          },
        },
        render,
      },
      async execute(args: any) {
        const task = normalizeTask(args)
        if (task === null) return { ok: false, id: '', pending: mutations.length }
        mutations.push({ op: 'create', task })
        return { ok: true, id: task.id, pending: mutations.length }
      },
    } as const

    const listTool = {
      name: 'task_board_list',
      description:
        'List kanban cards on the dsh task board (agent bridge). Reads the host mirror of the browser ledger (synced every ~1.5s); optionally filter by status.',
      parameters: {
        status: { type: 'string', description: 'Optional status filter (todo / in_progress / done); blank = no filter' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            total: { type: 'number' },
            cards: { type: 'array' },
          },
        },
        render,
      },
      async execute(args: any) {
        const status =
          typeof args?.status === 'string' && args.status.trim() !== '' ? args.status.trim() : null
        const cards = [...snapshot]
          .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
          .filter((c) => status === null || c.status === status)
        return { ok: true, total: cards.length, cards }
      },
    } as const

    const updateTool = {
      name: 'task_board_update',
      description:
        'Update a kanban card (status / title / description / prompt) on the dsh task board (agent bridge). Queued as a mutation; the browser applies it on the next sync and the board reflects it after a refresh.',
      parameters: {
        id: { type: 'string', required: true, description: 'Card id to update' },
        status: { type: 'string', description: 'New status (todo / in_progress / done)' },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        prompt: { type: 'string', description: 'New prompt' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            id: { type: 'string' },
            queued: { type: 'boolean' },
            known: { type: 'boolean' },
          },
        },
        render,
      },
      async execute(args: any) {
        const id = typeof args?.id === 'string' ? args.id.trim() : ''
        if (id === '') return { ok: false, id: '', queued: false, known: false }
        const known = snapshot.some((c) => c.id === id)
        const patch: Record<string, string> = {}
        for (const k of ['status', 'title', 'description', 'prompt']) {
          const v = args?.[k]
          if (typeof v === 'string' && v.trim() !== '') patch[k] = v.trim()
        }
        if (Object.keys(patch).length === 0) return { ok: false, id, queued: false, known }
        mutations.push({ op: 'update', id, patch })
        return { ok: true, id, queued: true, known }
      },
    } as const

    const deleteTool = {
      name: 'task_board_delete',
      description:
        'Delete a kanban card by id on the dsh task board (agent bridge). Queued as a mutation; the browser applies it on the next sync.',
      parameters: {
        id: { type: 'string', required: true, description: 'Card id to delete' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            id: { type: 'string' },
            queued: { type: 'boolean' },
            known: { type: 'boolean' },
          },
        },
        render,
      },
      async execute(args: any) {
        const id = typeof args?.id === 'string' ? args.id.trim() : ''
        if (id === '') return { ok: false, id: '', queued: false, known: false }
        mutations.push({ op: 'delete', id })
        return { ok: true, id, queued: true, known: snapshot.some((c) => c.id === id) }
      },
    } as const

    toolsCtx.tools.register(defineTool(createTool))
    toolsCtx.tools.register(defineTool(listTool))
    toolsCtx.tools.register(defineTool(updateTool))
    toolsCtx.tools.register(defineTool(deleteTool))
  })

  // Host-client Web API: GET drains mutations (backward-compatible .tasks for old
  // bundles, plus full .ops); POST receives the browser ledger snapshot.
  if (ctx.webServer) {
    ctx.webServer.register({
      kind: 'exact',
      path: PENDING_PATH,
      handler(req: any, res: any) {
        if (req.method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }
        try {
          const url = new URL(req.url, 'http://localhost')
          const max = Number(url.searchParams.get('max') ?? 0)
          const ops = drain(max)
          const tasks = ops.filter((o) => o.op === 'create').map((o) => o.task)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ tasks, ops, storageKey: STORAGE_KEY }))
        } catch (e) {
          console.error('[dsh-taskboard-agent] GET /pending error:', e)
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'internal' }))
        }
      },
    })
    ctx.webServer.register({
      kind: 'exact',
      path: SYNC_PATH,
      async handler(req: any, res: any) {
        const write = (code: any, payload: any) => {
          res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(payload))
        }
        try {
          if (req.method !== 'POST') {
            write(405, { error: 'method not allowed' })
            return
          }
          const chunks = []
          for await (const c of req) chunks.push(c)
          // IncomingMessage 的 chunk 是 Buffer；mock/测试流可能是字符串，统一按文本拼接。
          const raw = chunks.map((c) => (typeof c === 'string' ? c : c.toString('utf8'))).join('')
          let body
          try {
            body = JSON.parse(raw)
          } catch {
            write(400, { error: 'bad body' })
            return
          }
          const arr = Array.isArray(body) ? body : Array.isArray(body?.tasks) ? body.tasks : null
          if (arr === null) {
            write(400, { error: 'bad body' })
            return
          }
          snapshot = arr.filter(isCardRow)
          persist()
          write(200, { ok: true, received: snapshot.length })
        } catch (e) {
          console.error('[dsh-taskboard-agent] POST /sync error:', e)
          write(500, { error: 'internal' })
        }
      },
    })
  }

  // Announce the bridge so agents use the tools.
  ctx.inject(['systemPrompt'], (promptCtx: any) => {
    promptCtx.systemPrompt.section({
      name: 'plugin:taskboard-agent',
      order: 210,
      text:
        '已安装 dsh-taskboard-agent（任务看板 agent 桥接，双向同步）：task_board_create 建卡；task_board_list 读看板（可按 status 过滤）；task_board_update 改卡（status/title/description/prompt）；task_board_delete 删卡（按 id）。改/删为异步队列，浏览器 1.5s 内应用，刷新（F5）看板可见；看板 UI 的手动改动也会回流到 task_board_list。数据持久化于 DSH_HOME，重启不丢。',
    })
  })

  return () => {
    mutations = []
    snapshot = []
  }
}
