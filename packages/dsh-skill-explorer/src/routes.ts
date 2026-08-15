/**
 * The /api/dsh-skill-explorer route family: list (grouped by source), set
 * enabled (rewrites SKILL.md frontmatter), create, delete (move to .trash)
 * and health. Every route carries a loopback-only trust fence plus browser
 * same-origin markers — the write routes touch real skill files, so
 * LAN-exposed dsh web deployments must not serve them.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { buildPayload, collectSkills, findProjectRoot, projectSkillRoot, trashSkillFile, userSkillRoot, writeSkillFile, type CollectOptions, type SkillEntry } from './collect.ts'
import { setFrontmatterField } from './frontmatter.ts'

/** Cap on JSON request bodies (create payloads are small). */
const MAX_JSON_BODY_BYTES = 128 * 1024

/** Route paths (client bundle mirrors these literals; tests assert both sides). */
export const ROUTES = {
  list: '/api/dsh-skill-explorer/list',
  setEnabled: '/api/dsh-skill-explorer/set-enabled',
  create: '/api/dsh-skill-explorer/create',
  delete: '/api/dsh-skill-explorer/delete',
  health: '/api/dsh-skill-explorer/health',
} as const

/** Loopback literal check plus browser same-origin markers (mirrors dsh-ssh's fence). */
export function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** URL query helper (first value, decoded). */
function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Skill name pattern shared by the routes (kebab-case). */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Route family dependencies (tests inject fakes). */
export interface SkillRoutesDeps {
  /** User dsh config root (~/.dsh). */
  dshHome: string
  /** User agents config root (~/.agents). */
  agentsHome: string
  /** Extra custom skill roots from plugin config. */
  customSkillDirs: string[]
  /** ctx.skills registry (snapshot). */
  registry: CollectOptions['registry']
  /** Active session cwd list (project root base). */
  activeSessionCwds(): string[]
  /** Logger. */
  logger: { warn(error: unknown): void }
}

/** Default process cwd fallback (overridable in tests). */
export const DEFAULT_CWD = (): string => process.cwd()

/**
 * Build every /api/dsh-skill-explorer route (exact paths).
 * @param deps - dshHome/agentsHome/registry/sessions.
 * @returns the route list for ctx.webServer.register.
 */
export function makeRoutes(deps: SkillRoutesDeps): WebRoute[] {
  const { dshHome, agentsHome, customSkillDirs, registry, activeSessionCwds, logger } = deps

  /** Guard helper: fence + method check. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  /** Active session project roots (degraded to [] when sessions throw). */
  const sessionProjectRoots = (): string[] => {
    try {
      return activeSessionCwds().map((sessionCwd) => findProjectRoot(sessionCwd))
    } catch {
      return []
    }
  }

  /** Collect options shared by list/set-enabled/delete/health handlers. */
  const collectOptions = (cwd: string): CollectOptions => ({
    cwd,
    projectRoots: sessionProjectRoots(),
    customSkillDirs,
    dshHome,
    agentsHome,
    registry,
  })

  /** Find a skill by name from a fresh collection pass (trusts scanned paths only). */
  const findSkill = async (name: string, cwd: string): Promise<SkillEntry | undefined> => {
    const { skills } = await collectSkills(collectOptions(cwd))
    return skills.find((candidate) => candidate.name === name)
  }

  const routes: WebRoute[] = [
    {
      kind: 'exact',
      path: ROUTES.list,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          // Project root base: explicit ?cwd= first, then active session
          // workspaces, process.cwd() last.
          const cwd = queryParam(url, 'cwd') ?? DEFAULT_CWD()
          const projectRoots = sessionProjectRoots()
          const { skills, complete } = await collectSkills(collectOptions(cwd))
          writeJson(res, 200, buildPayload(skills, complete, cwd, [...new Set(projectRoots)]))
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.setEnabled,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const { name, enabled } = body
          if (typeof name !== 'string' || !NAME_PATTERN.test(name) || typeof enabled !== 'boolean') {
            writeJson(res, 400, { error: 'expected { name, enabled }' })
            return
          }
          // Only trust paths from a fresh scan (no arbitrary path writes).
          const skill = await findSkill(name, DEFAULT_CWD())
          if (skill === undefined || skill.path === undefined) {
            writeJson(res, 404, { error: `skill ${name} has no editable file (bundled/runtime skills cannot be toggled)` })
            return
          }
          // Disabled = disable-model-invocation: true; enabled = false.
          const frontmatter = setFrontmatterField(skill.path, 'disable-model-invocation', enabled ? false : true)
          writeJson(res, 200, {
            name,
            enabled: frontmatter.disableModelInvocation !== true,
            modelInvocable: frontmatter.disableModelInvocation !== true,
            path: skill.path,
          })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.create,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const { root, name, description, whenToUse, content } = body
          if (root !== 'user' && root !== 'project') {
            writeJson(res, 400, { error: 'root must be user (~/.dsh/skills) or project (project .dsh/skills)' })
            return
          }
          if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
            writeJson(res, 400, { error: 'name must be kebab-case (lowercase letters/digits first)' })
            return
          }
          if (typeof description !== 'string' || description.trim() === '') {
            writeJson(res, 400, { error: 'description is required' })
            return
          }
          if (typeof content !== 'string' || content.trim() === '') {
            writeJson(res, 400, { error: 'content is required' })
            return
          }
          if (Buffer.byteLength(content, 'utf8') > 64 * 1024) {
            writeJson(res, 400, { error: 'content exceeds 64KB limit' })
            return
          }
          const baseDir = root === 'user'
            ? userSkillRoot(dshHome)
            : projectSkillRoot(findProjectRoot(activeSessionCwds()[0] ?? DEFAULT_CWD()))
          const target = await writeSkillFile(baseDir, name, description, typeof whenToUse === 'string' ? whenToUse : undefined, content)
          writeJson(res, 200, { ok: true, name, path: target })
        } catch (error) {
          if (error instanceof Error && /already exists/.test(error.message)) {
            writeJson(res, 409, { error: error.message })
            return
          }
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.delete,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          const { name } = body
          if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
            writeJson(res, 400, { error: 'expected { name }' })
            return
          }
          const skill = await findSkill(name, DEFAULT_CWD())
          if (skill === undefined || skill.path === undefined) {
            writeJson(res, 404, { error: `skill ${name} has no deletable file (bundled/runtime skills cannot be deleted)` })
            return
          }
          const moved = await trashSkillFile(skill.path)
          writeJson(res, 200, { ok: true, name, moved })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.health,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          const { skills } = await collectSkills(collectOptions(DEFAULT_CWD()))
          writeJson(res, 200, { ok: true, plugin: 'skill-explorer', skills: skills.length })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
  return routes
}
