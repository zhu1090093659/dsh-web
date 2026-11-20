# Agent Note: The SSH terminal dials the shell-owned Host on an application-delivered page

Status: implemented

## Problem

The `dsh-ssh` terminal tab could not be used at all inside the official DSH
Desktop application. Clicking "Connect" reported
`终端已退出（<alias>）当前页面不支持 WebSocket（应用外壳只转发 HTTP）…` on the
0.2.0-rc.2 desktop client, while every other surface of the same panel - host
list, exec, SFTP transfer, tunnels - worked. The user-visible expectation is
"can use the terminal to connect to a remote host", on the desktop client too.

The transport cause is real and unchanged: the desktop shell serves its Web GUI
from `dsh-app://app/`, and a custom scheme cannot carry a WebSocket upgrade. The
first pass therefore refused the socket on every application scheme and told
the operator to use a browser instead
([#1744 in the 1743-1751 batch](2026-09-29-open-issues-resolution-1743-1751.md)).
That was accurate about the page and wrong about the shell: it turned a working
local path into a dead end on the product's own client.

## Decision

The terminal socket is dialed at the Host authority the shell publishes, using
the official transport hook `__DSH_TRANSPORT__.streamBaseUrl`.

The shell owns the Host and already forwards every other request to it through
its protocol handler. It also rewrites the WebSocket handshake for that Host
(`onBeforeSendHeaders` over `ws://127.0.0.1/*`: it requires
`Origin: dsh-app://app`, then substitutes the Host origin, the shell's
authority-bound credential, and a synthetic `sec-fetch-site: same-origin`) and
hands the same value to the browser half through `streamBaseUrl`. This is how
the official gateway stream mux already reaches a shell-owned Host from a
`dsh-app://app` document. `terminalSocketUrl()` therefore:

- resolves a **web page** against its own origin, unchanged;
- resolves an **application-delivered page** against `streamBaseUrl`, with
  `ws`/`wss` derived from the base's own scheme, and only when the base is a
  parsable `http:`/`https:` origin with no userinfo and a non-empty authority;
- returns `undefined` for every other case, so the operator still gets the
  actionable message instead of a socket that can only fail.

The base is consulted **only** on an application-delivered page. A web page that
carries the hook keeps its own origin: the remote channel grants `ownsHost` to a
paired LAN or tunnel page, and that page must stay fenced behind its pairing
channel, so a web page must never be rerouted onto a host it is not entitled to
reach.

The upgrade route declares `auth: 'anonymous'` and applies the same Host
connection-admission-or-loopback fence as the other SSH APIs. The shell still
attaches the credential; the dial rules above do not themselves admit a request,
and a remote page remains subject to the Host decision or strict loopback checks. The `terminal.noWebSocket` copy in zh/en/ru now describes the
remaining case (a shell that published no Host address) rather than claiming a
shell can never carry a socket.

## Testing

`packages/dsh-ssh/tests/terminal-socket-url.test.ts` pins the resolver as a
pure function: the two web-origin cases, the desktop case dialing
`ws://127.0.0.1:3080/api/dsh-ssh/terminal?…` from the published base, a
`wss` variant for an https base, the refusal when a shell page publishes no
base, the refusal for unknown application schemes without a base, the refusal
for bases that are not network authorities (empty, unparsable, `dsh-app:`,
`ftp:`, no host, userinfo-bearing), the web page that carries a hook keeping
its own origin, and the network-minted documents staying on the web side. The
suite fails against the previous resolver and passes after it; the package
suite (24 files, 210 passing, 1 skipped), `pnpm typecheck`, `pnpm build`,
`pnpm docs:check`, `pnpm i18n:check` and `pnpm aggregate:check` are green.

## Alternatives considered

Keeping the refusal and improving its wording was rejected: it is correct about
the page's transport and still leaves the feature unusable on the client's own
shell, while the reachable fix is a documented, official hook rather than a new
capability.

Asking DSH to forward the WebSocket upgrade over `dsh-app://` was rejected as
out of this repository's hands - the same reasoning
[the desktop shell's browser-auth cookie note](2026-09-25-desktop-shell-browser-auth-marker.md)
used to decline a fence change. A host-side plugin cannot require a future shell
build, and the shell already ships the two things the dial needs.

Deriving the Host authority from the page's own requests (reading it back out of
a `fetch` response, or from the bundle base) was rejected: it would be a guess
at a value the shell publishes explicitly, and a guess that can silently resolve
to the wrong authority. The hook is the shell's own statement of where its Host
lives.

Accepting the base on a web page too was rejected on the remote channel's
behalf. `ownsHost` is granted to a paired LAN/tunnel page, and that page rides
a gated channel precisely because it is not local; honoring the base there would
pull its terminal socket off the fence.

## Consequences

The terminal works inside the DSH Desktop application against the same Host the
shell owns, and a shell that does not publish a base still reports the actionable
message. The web GUI path is byte-for-byte unchanged, so no browser-side
regression is possible from this change.

The rule this note encodes is general: an application-delivered page is not a
socket-less page, it is a page whose transport lives on another authority, and
the shell that owns that authority says where. A future shell that publishes a
different base shape needs `hostAuthorityOf` to accept it, not a new decision.

The superseded item 3 of the 1743-1751 batch keeps its own rationale (name the
web side rather than an allowlist of known shells); only the verdict "refuse on
an application scheme" is replaced. `WEB_PAGE_PROTOCOLS` still classifies the
page, it just no longer ends the story.
