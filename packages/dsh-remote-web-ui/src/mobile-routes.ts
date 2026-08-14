/**
 * The mobile surface's page routes: `/m` serves the standalone phone UI
 * (an independent bundle, built to lib/mobile.js by the mobile tsdown
 * entry), `/m/mobile.js` serves the bundle itself. The page talks to the
 * host exclusively through the shared /api transport (paired-device cookie
 * already crosses the api/gate fence), so no host-side data plumbing is
 * needed here — only static serving, loopback+paired-fence via the normal
 * webserver route registration.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** The standalone mobile bundle (built artifact, next to this file's own lib output). */
function mobileBundlePath(): string {
  return fileURLToPath(new URL('../lib/mobile.js', import.meta.url))
}

/** The mobile page shell: minimal, offline-safe, no external assets. */
function pageHtml(bundleUrl: string): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
    '<meta name="theme-color" content="#f3f5f9">',
    '<meta name="referrer" content="no-referrer">',
    '<title>移动端远程控制</title>',
    '</head>',
    '<body>',
    '<div id="root"></div>',
    `<script type="module" src="${bundleUrl}"></script>`,
    '</body>',
    '</html>',
  ].join('')
}

/** Send a small static body with cache headers (the bundle is content-hashed by rebuild). */
function writeStatic(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-cache',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

/**
 * Build the mobile page routes.
 * @returns the two exact routes to register on webServer.
 */
export function makeMobileRoutes(): WebRoute[] {
  const handlePage = (_req: IncomingMessage, res: ServerResponse): void => {
    writeStatic(res, 200, 'text/html', pageHtml('/m/mobile.js'))
  }
  const handleBundle = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = mobileBundlePath()
    if (!existsSync(path)) {
      writeStatic(res, 503, 'text/plain', 'mobile bundle not built: run pnpm --filter @linxin666/dsh-remote-web-ui build')
      return
    }
    try {
      const body = await readFile(path, 'utf8')
      writeStatic(res, 200, 'text/javascript', body)
    } catch {
      writeStatic(res, 500, 'text/plain', 'failed to read the mobile bundle')
    }
  }
  return [
    { kind: 'exact', path: '/m', handler: handlePage },
    { kind: 'exact', path: '/m/mobile.js', handler: handleBundle },
  ]
}
