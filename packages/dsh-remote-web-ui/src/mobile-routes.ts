/**
 * The mobile surface's page routes: /m canonicalizes to /m/, which serves the
 * standalone phone UI. The page and worker live in the /m/ scope so the PWA
 * can cache only its static shell; the paired-device data channel remains at
 * /m/api and is never handled by the worker.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

const MOBILE_ROOT = '/m/'
const MOBILE_BUNDLE_URL = '/m/mobile.js'
const MOBILE_MANIFEST_URL = '/m/manifest.webmanifest'
const MOBILE_WORKER_URL = '/m/service-worker.js'
const MOBILE_OFFLINE_URL = '/m/offline.html'

/** The standalone mobile bundle (built artifact, next to this file's own lib output). */
function mobileBundlePath(): string {
  return fileURLToPath(new URL('../lib/mobile.js', import.meta.url))
}

/** A package asset available to the host after a registry or git install. */
function mobileAssetPath(name: string): string {
  return fileURLToPath(new URL('../assets/' + name, import.meta.url))
}

/** The mobile page shell: self-contained, with no document-level user data. */
function pageHtml(bundleUrl: string): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
    '<meta name="theme-color" content="#f3f5f9">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-title" content="DSH Remote">',
    '<link rel="manifest" href="/m/manifest.webmanifest">',
    '<link rel="apple-touch-icon" href="/m/apple-touch-icon.png">',
    '<title>远程访问</title>',
    '</head>',
    '<body>',
    '<div id="root"></div>',
    '<script type="module" src="' + bundleUrl + '"></script>',
    '</body>',
    '</html>',
  ].join('')
}

/** The installable app identity and icon declarations for the /m scope. */
function manifestJson(): string {
  return JSON.stringify({
    id: MOBILE_ROOT,
    name: 'DSH Remote',
    short_name: 'DSH Remote',
    start_url: MOBILE_ROOT,
    scope: MOBILE_ROOT,
    display: 'standalone',
    background_color: '#151424',
    theme_color: '#f3f5f9',
    icons: [
      { src: '/m/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/m/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  }, null, 2)
}

/** A static fallback that contains no paired-device, session, or workspace data. */
function offlineHtml(): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="theme-color" content="#151424">',
    '<title>DSH Remote</title>',
    '<style>body{margin:0;background:#151424;color:#f3f5f9;font:16px system-ui,sans-serif}main{box-sizing:border-box;display:grid;min-height:100vh;place-content:center;padding:32px;text-align:center}h1{margin:0 0 12px;font-size:24px}p{margin:0;color:#c4c7d8;line-height:1.5}</style>',
    '</head>',
    '<body><main><h1>DSH Remote</h1><p>Cannot reach the running DSH host. Restore the connection and reopen the app.</p></main></body>',
    '</html>',
  ].join('')
}

/** Send a small static UTF-8 body with revalidation headers. */
function writeStatic(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'content-type': type + '; charset=utf-8',
    'cache-control': 'no-cache',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

/** Send the worker with the same scope it registers for, without HTTP caching. */
function writeServiceWorker(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-cache',
    'referrer-policy': 'no-referrer',
    'service-worker-allowed': MOBILE_ROOT,
  })
  res.end(body)
}

/** Send a PNG body without decoding it to UTF-8. */
function writePng(res: ServerResponse, status: number, body: Buffer): void {
  res.writeHead(status, {
    'content-type': 'image/png',
    'cache-control': 'public, max-age=31536000, immutable',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

/** Canonicalize the old /m route while retaining pair and workspace query parameters. */
function redirectToMobileRoot(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/m', 'http://x')
  res.writeHead(308, {
    location: MOBILE_ROOT + url.search,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end()
}

/**
 * Build the mobile page routes.
 * @returns Exact routes for the canonical page, static shell, and PWA assets.
 */
export function makeMobileRoutes(): WebRoute[] {
  const handlePage = (_req: IncomingMessage, res: ServerResponse): void => {
    writeStatic(res, 200, 'text/html', pageHtml(MOBILE_BUNDLE_URL))
  }
  const handleManifest = (_req: IncomingMessage, res: ServerResponse): void => {
    writeStatic(res, 200, 'application/manifest+json', manifestJson())
  }
  const handleOffline = (_req: IncomingMessage, res: ServerResponse): void => {
    writeStatic(res, 200, 'text/html', offlineHtml())
  }

  // The bundle is immutable for the process lifetime (a rebuild requires a
  // host restart), so the body is read from disk once, not per phone.
  let bundleBody: string | undefined
  const handleBundle = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (bundleBody === undefined) {
      const path = mobileBundlePath()
      if (!existsSync(path)) {
        writeStatic(res, 503, 'text/plain', 'mobile bundle not built: run pnpm --filter @linxin666/dsh-remote-web-ui build')
        return
      }
      try {
        bundleBody = await readFile(path, 'utf8')
      } catch {
        writeStatic(res, 500, 'text/plain', 'failed to read the mobile bundle')
        return
      }
    }
    writeStatic(res, 200, 'text/javascript', bundleBody)
  }

  let workerBody: string | undefined
  const handleWorker = async (_req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (workerBody === undefined) {
      const path = mobileAssetPath('mobile-service-worker.js')
      if (!existsSync(path)) {
        writeStatic(res, 503, 'text/plain', 'mobile service worker not found')
        return
      }
      try {
        workerBody = await readFile(path, 'utf8')
      } catch {
        writeStatic(res, 500, 'text/plain', 'failed to read the mobile service worker')
        return
      }
    }
    writeServiceWorker(res, workerBody)
  }

  const makeIconHandler = (asset: string): WebRoute['handler'] => async (_req, res) => {
    const path = mobileAssetPath(asset)
    if (!existsSync(path)) {
      writeStatic(res, 404, 'text/plain', asset + ' not found')
      return
    }
    try {
      writePng(res, 200, await readFile(path))
    } catch {
      writeStatic(res, 500, 'text/plain', 'failed to read ' + asset)
    }
  }

  return [
    { kind: 'exact', path: '/m', handler: redirectToMobileRoot },
    { kind: 'exact', path: MOBILE_ROOT, handler: handlePage },
    { kind: 'exact', path: MOBILE_BUNDLE_URL, handler: handleBundle },
    { kind: 'exact', path: MOBILE_MANIFEST_URL, handler: handleManifest },
    { kind: 'exact', path: MOBILE_WORKER_URL, handler: handleWorker },
    { kind: 'exact', path: MOBILE_OFFLINE_URL, handler: handleOffline },
    { kind: 'exact', path: '/m/apple-touch-icon.png', handler: makeIconHandler('apple-touch-icon.png') },
    { kind: 'exact', path: '/m/icon-192.png', handler: makeIconHandler('mobile-icon-192.png') },
    { kind: 'exact', path: '/m/icon-512.png', handler: makeIconHandler('mobile-icon-512.png') },
  ]
}
