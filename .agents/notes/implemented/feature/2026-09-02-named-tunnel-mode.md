# Agent Note: Named-Tunnel Mode So Paired Phones Never Re-Pair Across Restarts

Status: implemented

## Problem

Mobile remote access rode the plugin's auto quick tunnel, and Cloudflare mints a fresh `trycloudflare.com` hostname on every start. Each `dsh web` restart therefore changed the public origin: the phone's saved bookmark died, and the new hostname is a brand-new cookie context for the phone's browser, so the persisted device session (already restart-safe in `remote-web-ui-devices.json`) could never match — every restart forced a full re-pair. The outage on 2026-09-02 (a profile patch override that dropped `autoTunnel` while converting rows to the shell layout) made the cost visible: the phone was locked out until the config was repaired and the service restarted.

## Decision

- **New named-tunnel mode** in `dsh-remote-web-ui`: a `tunnelToken` setting (Cloudflare named-tunnel token) makes the plugin run `cloudflared tunnel run --token` itself, toward the fixed public hostname configured in the Cloudflare dashboard. The hostname never changes, so a phone pairs once and its bookmark + pairing cookie keep working across restarts.
- **Precedence and validation** live in a pure planner (`src/tunnel-plan.ts`, `tunnelPlanOf`): `autoTunnel` (quick) wins over `tunnelToken`; the named mode requires a token AND a valid `publicBaseUrl` naming the same fixed hostname (the token does not carry the hostname) — otherwise the mode is off with a warning that names the missing piece.
- **Lifecycle reuse**: the named process is wrapped by `namedTunnelHandle` (`src/tunnel.ts`), which reports the fixed URL through the same `url` event the quick tunnel emits, once, after the first registered edge connection — the manager's URL timeout, crash-restart backoff, stop semantics, phase listener, and posture probing stay fully mode-agnostic.
- **Secret handling**: `tunnelToken` is declared `role('secret')` in the section schema, so the settings surface stores it redacted; the card edits it via `secretField` and never reads the value back.
- **UI/copy**: the settings card gains the token field (between the auto-tunnel toggle and the LAN-bind status); zh/en copy in the package, ru mirrored in the dsh-i18n central pack. READMEs document the setup (dashboard ingress mapping, token, public base) and the security-model bullet about hostname churn now points at the mode.

## Alternatives considered

- **LAN bind only (0.0.0.0)**: zero code and already shipped, but the phone loses access off the home network; kept as a complementary option, not the answer for anywhere-access.
- **Zero-code standalone named tunnel** (`cloudflared service install` + manual `publicBaseUrl`): works today but leaves the tunnel lifecycle outside the plugin (no auto-start with `dsh web`, no backoff, no card status); the manual `publicBaseUrl` path remains supported for users who prefer it.
- **Deep-link carrying the device credential**: would soften re-pairing but cannot fix the dead hostname — the user would still need the new URL from the desktop after every restart.

## Consequences

- Paired-device sessions now realize their intended "no re-pairing after restart" behavior whenever the deployment uses a fixed hostname (named tunnel, or a LAN bind with a stable address).
- The tunnel target is a union (`quick`/`named`) end to end: `TunnelManager.start` accepts both, the factory seam grew its parameter type (existing injectors keep working), and the settings sync drives everything through one planner.
- A wrong token or unreachable Cloudflare edge surfaces as the standard tunnel failure state (phase `failed` + backoff), not a boot error; a token without a public base keeps the tunnel off by design.
- The quick tunnel remains the zero-account default; nothing changes for deployments that never set `tunnelToken`. The zero-config restart-stability story itself moved to the stable-hostname relay (2026-09-02-stable-hostname-relay.md), which pins a fixed dsh-market subdomain in front of the quick tunnel with no user setup; this mode remains the own-domain alternative.

## Testing

- `tests/tunnel.spec.ts`: named-mode manager flow (fixed URL surfaced, idempotence, restart on target change, crash backoff), bare-string quick compatibility, and the `namedTunnelHandle` adapter (first-registration-only URL reporting, exit passthrough, listener detachment on stop).
- `tests/tunnel-plan.spec.ts`: the precedence matrix — quick wins with the ignored-key list, named requires token + valid base, empty/malformed inputs stay off.
- Package `tsc -b` and the full vitest suite (321 tests, 29 files) pass.
