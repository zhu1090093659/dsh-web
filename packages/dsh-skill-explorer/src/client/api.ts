/**
 * Skill center API client (browser half). Talks to the host route family over
 * same-origin fetch; the host enforces the trust fence on its side.
 */

/** Route paths mirrored from the host (src/routes.ts ROUTES). */
const API = {
  list: '/api/dsh-skill-explorer/list',
  setEnabled: '/api/dsh-skill-explorer/set-enabled',
  create: '/api/dsh-skill-explorer/create',
  delete: '/api/dsh-skill-explorer/delete',
} as const

/** One skill entry as served by the host. */
export interface SkillEntry {
  name: string
  description: string
  whenToUse?: string
  provider?: string
  level: string
  path?: string
  /** True for skills discovered through a symlink entry (deletion not allowed). */
  linked?: boolean
  modelInvocable: boolean
  userInvocable: boolean
}

/** Group payload served by the host. */
export interface GroupPayload {
  key: string
  title: string
  hint: string
  skills: SkillEntry[]
}

/** List payload served by the host. */
export interface ListPayload {
  cwd: string
  projectRoots: string[]
  complete: boolean
  groups: GroupPayload[]
}

/** One thrown API error with the host-provided message. */
export class ApiError extends Error {}

/** Skill center API client. */
export class SkillApi {
  /** Fetch the grouped skill list. */
  async list(): Promise<ListPayload> {
    return this.request<ListPayload>(API.list)
  }

  /** Enable or disable a skill (rewrites disable-model-invocation). */
  async setEnabled(name: string, path: string, enabled: boolean): Promise<{ name: string; enabled: boolean; modelInvocable: boolean; path?: string }> {
    return this.request(API.setEnabled, { method: 'POST', body: { name, path, enabled } })
  }

  /** Create a skill file under the user or project root. */
  async create(payload: { root: 'user' | 'project'; name: string; description: string; whenToUse?: string; content: string; cwd: string }): Promise<{ ok: true; name: string; path: string }> {
    return this.request(API.create, { method: 'POST', body: payload })
  }

  /** Delete a skill (moves it into .trash). */
  async remove(name: string, path: string): Promise<{ ok: true; name: string; moved: string }> {
    return this.request(API.delete, { method: 'POST', body: { name, path } })
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    if (!response.ok) {
      const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${response.status}`
      throw new ApiError(message)
    }
    return body as T
  }
}
