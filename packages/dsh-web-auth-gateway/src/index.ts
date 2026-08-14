import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { createServer, request as upstreamRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import z from 'schemastery'

export const name = 'web-auth-gateway'
export const inject = ['webServer']
export const WEB_AUTH_GATEWAY_SETTINGS_NAMESPACE = settingsNamespace('web-auth-gateway')
export interface Config { enabled?: boolean; port?: number; sessionTtlHours?: number }
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  port: z.number().step(1).min(1).max(65535).default(3090),
  sessionTtlHours: z.number().step(1).min(1).max(720).default(12),
})

interface Credential { username: string; salt: string; passwordHash: string }
const dataDir = join(homedir(), '.dsh', 'web-auth-gateway')
const credentialPath = join(dataDir, 'credential.json')

function loadCredential(): Credential | undefined {
  try { return JSON.parse(readFileSync(credentialPath, 'utf8')) as Credential } catch { return undefined }
}
function saveCredential(username: string, password: string): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const salt = randomBytes(16).toString('hex')
  const value: Credential = { username, salt, passwordHash: scryptSync(password, salt, 32).toString('hex') }
  const temp = `${credentialPath}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, credentialPath)
}
function verifyPassword(value: Credential, username: string, password: string): boolean {
  if (username !== value.username) return false
  const actual = scryptSync(password, value.salt, 32)
  const expected = Buffer.from(value.passwordHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim()
  }
  return out
}
function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 16_384) req.destroy()
      else chunks.push(chunk)
    })
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))))
    req.on('error', reject)
  })
}
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 16_384) reject(new Error('body-too-large'))
      else chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new Error('invalid-json')) }
    })
    req.on('error', reject)
  })
}
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}
function loginPage(firstRun: boolean, error = ''): string {
  const title = firstRun ? '创建管理员账号' : '登录 DSH Web'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0;background:#f4f6f8;color:#182230;font:14px system-ui;display:grid;place-items:center;min-height:100vh}.card{width:min(360px,calc(100vw - 48px));background:#fff;padding:32px;border:1px solid #dce2e8;border-radius:12px;box-shadow:0 12px 36px #18223018}h1{font-size:22px;margin:0 0 8px}p{color:#667085;margin:0 0 24px}label{display:block;margin:14px 0 6px}input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #cbd3dc;border-radius:7px}button{width:100%;margin-top:22px;padding:11px;border:0;border-radius:7px;background:#2457d6;color:#fff;font-weight:600}.error{color:#b42318}</style></head><body><form class="card" method="post" action="/_dsh_auth/login"><h1>${title}</h1><p>${firstRun ? '首次使用，请设置至少 8 位密码。' : '验证身份后继续访问。'}</p>${error ? `<p class="error">${error}</p>` : ''}<label>用户名</label><input name="username" autocomplete="username" required value="admin"><label>密码</label><input type="password" name="password" autocomplete="current-password" minlength="8" required><button>${firstRun ? '创建并进入' : '登录'}</button></form></body></html>`
}

export function apply(ctx: Context, config: Config = {}): void {
  let source: () => Config = () => config
  let settingsScope: SettingsScope<Config> | undefined
  let dispose: (() => void) | undefined
  const sessions = new Map<string, number>()
  const valid = (req: IncomingMessage): boolean => {
    const token = cookies(req).dsh_gateway_session
    if (!token) return false
    const expires = sessions.get(createHash('sha256').update(token).digest('hex'))
    return expires !== undefined && expires > Date.now()
  }
  const restart = (): void => {
    dispose?.()
    dispose = undefined
    const value = source()
    if ((value.enabled ?? true) === false) return
    const port = value.port ?? 3090
    if (port === ctx.webServer.port) {
      ctx.logger('web-auth-gateway').error('gateway port must differ from DSH Web port')
      return
    }
    const server = createServer(async (req, res) => {
      const path = new URL(req.url ?? '/', 'http://gateway').pathname
      if (path === '/_dsh_auth/login') {
        const credential = loadCredential()
        if (req.method === 'GET') {
          res.setHeader('cache-control', 'no-store')
          res.end(loginPage(credential === undefined))
          return
        }
        if (req.method === 'POST') {
          const body = await readBody(req)
          const username = body.get('username') ?? ''
          const password = body.get('password') ?? ''
          let ok = false
          if (credential === undefined && username.length > 0 && password.length >= 8) {
            saveCredential(username, password)
            ok = true
          } else if (credential !== undefined) ok = verifyPassword(credential, username, password)
          if (ok) {
            const token = randomBytes(32).toString('base64url')
            const ttl = (value.sessionTtlHours ?? 12) * 3_600_000
            sessions.set(createHash('sha256').update(token).digest('hex'), Date.now() + ttl)
            res.statusCode = 303
            res.setHeader('set-cookie', `dsh_gateway_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${String(Math.floor(ttl / 1000))}`)
            res.setHeader('location', '/')
            res.end()
            return
          }
          res.statusCode = 401
          res.end(loginPage(credential === undefined, '用户名或密码无效'))
          return
        }
      }
      if (path === '/_dsh_auth/logout') {
        res.statusCode = 303
        res.setHeader('set-cookie', 'dsh_gateway_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
        res.setHeader('location', '/_dsh_auth/login')
        res.end()
        return
      }
      if (!valid(req)) {
        if (path.startsWith('/api/')) { res.statusCode = 401; res.end('Unauthorized') }
        else { res.statusCode = 302; res.setHeader('location', '/_dsh_auth/login'); res.end() }
        return
      }
      proxyHttp(req, res, ctx.webServer.host, ctx.webServer.port)
    })
    server.on('upgrade', (req, socket, head) => {
      if (!valid(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return }
      const upstream = connect(ctx.webServer.port, ctx.webServer.host, () => {
        const headers = { ...req.headers, host: `${ctx.webServer.host}:${String(ctx.webServer.port)}` }
        let raw = `${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/${req.httpVersion}\r\n`
        for (const [key, item] of Object.entries(headers)) {
          if (item !== undefined) raw += `${key}: ${Array.isArray(item) ? item.join(', ') : item}\r\n`
        }
        upstream.write(`${raw}\r\n`)
        if (head.length > 0) upstream.write(head)
        socket.pipe(upstream).pipe(socket)
      })
      upstream.on('error', () => socket.destroy())
    })
    server.on('error', error => ctx.logger('web-auth-gateway').error(error))
    server.listen(port, '127.0.0.1', () => ctx.logger('web-auth-gateway').info(`login gateway: http://127.0.0.1:${String(port)}`))
    dispose = () => server.close()
  }
  const configRoute: WebRoute = {
    kind: 'exact',
    path: '/api/web-auth-gateway/config',
    handler: async (req, res) => {
      if (req.method === 'GET') { json(res, 200, { ok: true, value: source(), writable: settingsScope !== undefined }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
      if (settingsScope === undefined) { json(res, 503, { ok: false, error: 'settings-unavailable' }); return }
      try {
        const body = await readJson(req)
        if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('invalid-body')
        const input = body as Record<string, unknown>
        const patch: Config = {}
        if ('enabled' in input) {
          if (typeof input.enabled !== 'boolean') throw new Error('invalid-enabled')
          patch.enabled = input.enabled
        }
        if ('port' in input) {
          if (!Number.isInteger(input.port) || (input.port as number) < 1 || (input.port as number) > 65535) throw new Error('invalid-port')
          patch.port = input.port as number
        }
        if ('sessionTtlHours' in input) {
          if (!Number.isInteger(input.sessionTtlHours) || (input.sessionTtlHours as number) < 1 || (input.sessionTtlHours as number) > 720) throw new Error('invalid-session-ttl')
          patch.sessionTtlHours = input.sessionTtlHours as number
        }
        await settingsScope.update(patch)
        json(res, 200, { ok: true, value: source() })
      } catch (error) {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : 'invalid-request' })
      }
    },
  }
  ctx.effect(() => ctx.webServer.register(configRoute), 'web-auth-gateway: config route')
  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(WEB_AUTH_GATEWAY_SETTINGS_NAMESPACE, Config, { base: config })
    settingsScope = scope
    source = () => scope.get()
    restart()
    const unwatch = scope.watch(restart)
    sctx.effect(() => () => {
      unwatch()
      settingsScope = undefined
      source = () => config
      restart()
    }, 'web-auth-gateway: settings')
  })
  restart()
  ctx.effect(() => () => dispose?.(), 'web-auth-gateway: server')
}

function proxyHttp(req: IncomingMessage, res: ServerResponse, host: string, port: number): void {
  const headers = { ...req.headers, host: `${host}:${String(port)}` }
  const proxy = upstreamRequest({ host, port, method: req.method, path: req.url, headers }, upstream => {
    res.writeHead(upstream.statusCode ?? 502, upstream.headers)
    upstream.pipe(res)
  })
  proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Bad Gateway') })
  req.pipe(proxy)
}
