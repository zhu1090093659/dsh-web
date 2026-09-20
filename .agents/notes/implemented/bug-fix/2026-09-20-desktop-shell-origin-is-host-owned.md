# Agent Note: The Desktop application's own page is host-owned, never a pairing target

Status: implemented

## Problem

Starting the dsh Desktop application showed a full-page "需要设备配对 / 此设备未配对，无法访问工作区数据" block instead of the workspace: every same-origin call the GUI made was answered `403` with `error.code: "unpaired"`, so no session, workspace, or plugin data ever loaded and the application was unusable.

The block is this plugin's pairing fence (`client/FenceNotice.tsx`), raised when a gated call reports `unpaired`. It is correct for a genuinely remote browser, which is exactly what the plugin believed this page was.

The misclassification has one home: the local-machine test was hostname-only (`isLoopbackHostname`: `localhost`, `::1`, `127/8`). The official Desktop shell (Electron) does not serve its GUI over an HTTP loopback origin — it registers a custom scheme and loads the official Web GUI from `dsh-app://app/` (`const SCHEME = "dsh-app"`, `applicationUrl = `${SCHEME}://app/``; the preload asserts `location.protocol === 'dsh-app:' && location.hostname === 'app'`). That page's hostname literal is `app`, which is not a loopback name, so both halves of this plugin read the local Desktop as a remote origin:

- the browser half installed the gated `/remote` channel (`remoteChannelRequired`), rewriting `/api/*`, `/sidebar/*` and the stream sockets onto the pairing-gated prefix;
- the parse-time boot patch (`remote-channel-boot.ts`, injected into the served index) ran its non-loopback branch, installing the transport hook and the unpaired fence.

Pairing there is not merely unnecessary but impossible: the Desktop shell forwards same-origin requests itself (`forwardWebRequest` rewrites `Host`, drops `Origin`/`Cookie`/`Sec-Fetch-Site`, and deletes every `set-cookie` from the response), so the device cookie can never be stored, and the cookieless `x-dsh-remote-device` path expects a `/pair-app` navigation the shell never performs. The blocking page was terminal: 立即配对 could not succeed and 重新检测 only reloaded into the same fence.

The official client already treats the shell as the local machine — the shell sets `__DSH_TRANSPORT__ = { ownsHost: true }` before the boot injections run, and the connection package derives `isLoopback` from `transport.ownsHost === true || isLoopbackHostname(pageLocation.hostname)`. Only this plugin's own predicate disagreed, and the disagreement made the plugin fence off the one page it must always serve.

## Decision

The local-machine classification is **scheme-aware**, and its single source of truth is `isHostOwnedOrigin(hostname, scheme, desktopScheme)` in `src/remote-channel-rules.ts` — the module both halves already share so their decisions cannot drift. It returns true for a loopback hostname and for the Desktop shell's own page scheme `dsh-app` (`DESKTOP_SHELL_SCHEME`), publishing that literal into the JSON rule set as `desktopScheme` so the boot script, which is generated from the same table, decides identically.

Scheme comparison is case-insensitive and accepts either spelling (`dsh-app` or the `dsh-app:` that `location.protocol` carries) through `normalizeScheme`; an absent or empty scheme keeps the previous hostname-only semantics, so every existing caller and test double behaves as before.

Both call sites now pass the page scheme: `remoteChannelRequired(..., window.location.protocol)` and the host-policy probe gate in `src/client/index.ts`. The generated boot script mirrors the same test inline (`var s=(loc.protocol||"").replace(/:$/,"").toLowerCase()` before the skip `return`), keeping the two halves byte-consistent with the rule table that produced them.

## Alternatives considered

- **Add `app` to the loopback hostnames**: rejected. `isLoopbackHostname` answers a Host-header question for the *host* half too (`src/gate.ts`, the route fences), and a bare `app` there would treat any client able to send `Host: app` as loopback. The scheme is the fact that actually distinguishes the shell; the hostname is an accident of it.
- **Detect the shell through a page global (`dshDesktop` / `dshDesktopBoot`)**: rejected as the primary test. The boot script runs in `<head>` before any boot entry and may not rely on a preload-exposed surface, and the two halves must decide from JSON-serializable data. A scheme is readable at both points and in both halves.
- **Turn the fence off with `requirePairingForLan: false`**: rejected as a fix. It is a deployment-wide policy that also stops gating genuinely remote `/api` callers, which is the plugin's whole access control on a LAN-exposed bind. The defect is a misclassification of one local page, not the policy.
- **Special-case the shell only in the client half**: rejected — the boot patch is installed from the served index and runs first, so a client-only fix still leaves the shell rewritten onto the gated prefix and fenced before any boot entry executes.
- **Serve the Desktop over loopback HTTP instead**: rejected as out of this package's scope. The Desktop shell is an official product; this plugin must classify the page it is given.

## Consequences

- The Desktop application boots straight into the workspace: no pairing fence, no `/remote` rewrite, no transport hook, no upload hook. Its own authenticated host receives its calls unchanged, exactly like a browser page opened at 127.0.0.1.
- Pairing keeps its full meaning for every genuinely remote origin — LAN addresses, tunnels, and public base URLs are still gated and still must pair; the change removes no access control.
- A local-machine notion that used to live in two divergent forms now has one owner. The rule table is the only place the shell's scheme is written, and the boot script derives from it.
- A future Desktop release that renames the scheme, or a different shell that serves the GUI another way, degrades to an ordinary remote origin that must pair. The failure is then visible as the pairing fence, and the fix is one literal in `DESKTOP_SHELL_SCHEME`.
- `isLoopbackHostname` is re-exported from the shared rules module instead of being defined in `client/remote-channel.ts`; the browser half keeps its `module dependency-free` stance because the rules module imports nothing runtime-bearing.

## Testing

- `packages/dsh-remote-web-ui/tests/remote-channel.spec.ts` pins the classification (`dsh-app:`, bare `dsh-app`, `DSH-APP:` are host-owned; a LAN address, a tunnel hostname, and the decoy pair `app` over `http:` are not), the scheme normalization, and the decision itself: `remoteChannelRequired` answers false for the shell page with the pairing policy on and settings both unreadable and `ready`, while a LAN origin still answers true and loopback false. Reverting the decision to the old hostname-only test fails "user opening the Desktop shell is never asked to pair".
- `packages/dsh-remote-web-ui/tests/remote-channel-boot.spec.ts` runs the generated boot script against a fake window whose location mirrors `dsh-app://app/` (opaque `null` origin) and asserts nothing is patched, the boot seat and the upload hook stay absent, and a call resolves to the original `dsh-app://app/api/session.list`. Reverting the inline skip condition fails "user on the official Desktop shell page keeps the original paths".
- `pnpm --filter @linxin666/dsh-remote-web-ui test` passes 383 tests; the real-GUI Desktop boot that reproduced the defect (dsh Desktop on Windows, `session.list` answered 403 `unpaired`) now loads the workspace.