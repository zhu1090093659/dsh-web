# Desktop shell SSE forwarding probe (2026-10-31)

Validation snapshot of whether the DeepSeek Harness desktop shell buffers `text/event-stream` while serving the `dsh-app:` scheme. Read-only inspection of the installed application (0.2.1-rc.5, Electron 44.7.0) plus one probe experiment in an isolated `DSH_HOME`.

## What the shell does

The shell registers its scheme with `stream` among the privileges, then serves every forwarded path through one function. `app.asar/lib/main.js`:

```js
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);
```

`protocol.handle(SCHEME, ...)` answers `/`, `/index.html`, `/assets/*`, `/favicon.svg` and `/manifest.webmanifest` from the packaged frontend and hands every other path to `forwardWebRequest`, which re-issues the request with Node `fetch` and returns the body stream unchanged:

```js
const response = await fetch(target, init);
const outgoing = new Headers(response.headers);
for (const name of WITHHELD_RESPONSE_HEADERS) outgoing.delete(name);
return new Response(response.body, { status: response.status, headers: outgoing });
```

Nothing awaits `arrayBuffer()` or `text()`, no `TransformStream` wraps the body, and no chunk buffer accumulates, so the undici stream reaches Electron as it arrives. `WITHHELD_RESPONSE_HEADERS` is `set-cookie`, `content-encoding`, `content-length`, `transfer-encoding`, `connection`, `keep-alive`, `te`, `trailer`, `upgrade`, `proxy-authenticate`, `proxy-authorization`: the renderer never sees a fixed length for a forwarded response, and the shell adds no compression of its own.

The Host neither compresses this content type: `dsh-host-webserver`'s gzip middleware returns false for any `content-type` whose lower-cased form starts with `text/event-stream`, so the `accept-encoding` the shell's `fetch` sends cannot turn a frame stream into a deflate buffer.

## Measured

A probe SSE server on `127.0.0.1` wrote one `data:` frame every 250 ms after an immediate `:` comment frame. Arm 1 subscribed over plain HTTP from Node with no shell in the path: time to first byte 14 ms, 13 chunks for 13 frames, arrival timestamps `...627728, ...627976, ...628227, ...628478, ...`, one chunk per frame, each in the same millisecond the server wrote it. The frame generator and the plain-HTTP path therefore coalesce nothing, which is the reference any shell measurement is compared against.

Arm 2, the same frames through `dsh-app://`, was not obtained. The packaged binary accepts no Chromium switch: `--user-data-dir` and `--remote-debugging-port` both fail with `bad option`, because the app's Node argument parser sees them as unknown options before a script path; a script path instead runs the binary in Node mode (`MODULE_NOT_FOUND`); `NODE_OPTIONS=--inspect` is refused with `Node.js environment variables are disabled because this process is invoked by other apps`. A LaunchServices launch (`open --args`) cannot carry the `DSH_HOME` override, so such an instance would share the real harness home and contend for the task board ledger that allows one writer. Wrapping the shipped `Electron Framework` in a minimal bundle of its own exits after 65 ms without loading its own app, so that route failed as well. The installed package stayed byte-identical: `codesign --verify --strict` exits 0 and the framework and `app.asar` mtimes are unchanged.

## Residual

What stays unmeasured is Electron's own `protocol.handle` transport, which sits between the shell's `Response` and the renderer. The runtime provides `stream: true` streaming for exactly this purpose, its `Protocol` binding exposes only `registerStreamProtocol` and `interceptStreamProtocol` (no `handle`), so `handle` is a wrapper over the per-chunk stream-protocol callback, and `net.fetch` carries an explicit `bypassCustomProtocolHandlers` opt-out, meaning custom handlers are in the default path and responses flow back as a body stream. Closing that gap needs a shell build that exposes a DevTools endpoint (a `--remote-debugging-port` the binary accepts) or a `DSH_HOME` channel a LaunchServices launch can carry; both are runtime facts rather than shell code.

## Consumer surface

`text/event-stream` reaches this path only for responses fetched document-relative from the application page, because the page origin is `dsh-app://app`. The task board subscribes exactly that way (`EventSource` on the document-relative `api/task-board/events`, served by `src/host-routes.ts`), and so does the client module channel `/plugins/events`. The GUI's own live stream does not: `DESKTOP_IPC.boot` returns `streamBaseUrl` as the Host's loopback origin, the frontend stores it in `__DSH_TRANSPORT__`, and the shell rewrites `origin` and `cookie` for `ws://127.0.0.1/*` so the Remote stream mux connects to the Host directly over WebSocket. A buffering shell layer would therefore stall pushed board revisions, not chat streaming, which is the case `src/client/pending-verify.ts` already bounds with a 15-second verification read.

The forwarding header behaviour recorded here matches [the desktop shell origin fence record](../../.agents/notes/rejected/bug-fix/2026-09-25-desktop-shell-origin-route-fence.md).
