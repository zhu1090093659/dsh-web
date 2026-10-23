# Agent Note: The SSH connection timeout is configurable and names the stalled phase (issue #1931)

Status: implemented

## Problem

dsh-ssh fixed `DEFAULTS.connectTimeoutMs` at 15000 ms and passed it to ssh2's `readyTimeout`, which covers the whole pre-ready sequence: TCP connect, SSH key exchange and user authentication. A host whose password authentication takes about 20 s — its banner and key exchange complete in well under a second — therefore failed at 15 s with ssh2's "Timed out while waiting for handshake", even though the server accepted the credentials shortly afterwards. `SshEngine` was constructed as `new SshEngine(store)`, so neither the plugin config nor a host entry could change the value, and `ssh_exec`'s `timeoutMs` only bounds the remote command once the connection is ready. The only remedy was editing the source.

The message compounded the diagnosis: ssh2 uses one text for a timeout in any of the three phases, so an authentication stall looked like a broken handshake or an unreachable port.

## Decision

`connectTimeoutMs` is one plugin config field, not a per-host override. It is `volatile()` like the other dsh-ssh settings, defaults to `DEFAULT_CONNECT_TIMEOUT_MS` (30000), and accepts 1000-600000 ms. `apply()` reads it through the live config reference for the engine constructor, and `loader/volatile-update` calls `SshEngine.setConnectTimeout()` so an edit reaches a running instance without a remount. The value lands in `engine.opts.connectTimeoutMs`, the single object every connection path already reads through `connectChain` / `buildConnectConfig`; exec, PTY, SFTP, tunnels and cluster runs share it by construction.

The default moves from 15 s to 30 s. The reported host needed about 20 s, and 30 s leaves headroom without making an unreachable host feel hung for a minute.

`connectClient` records whether ssh2 emitted `handshake` (key exchange complete) and, when the failure is ssh2's `client-timeout`, replaces the message with a phase-aware one that names the shared budget and the setting. Before the handshake the text names TCP connect or key exchange; after it, user authentication. TCP connect and key exchange are not split further because ssh2 exposes no public event between the TCP socket and the completed handshake — the only signal is the private `_sock`, and the decision rejects depending on it.

## Alternatives considered

- Per-host `connectTimeoutMs` in `dsh-ssh.json` plus a form field. Deferred, not rejected: it is more flexible for mixed inventories, but it adds a stored field, validation, PATCH semantics, projections and form/i18n surface for a problem the plugin-level ceiling already solves. The engine accepts the value per connect, so a host override can be added later without reworking this decision.
- Only raising the default to 30 s and keeping it fixed. Rejected: a host behind slower PAM / LDAP would hit the same wall at a different number, and the issue's whole point is that the operator cannot adapt the client.
- Reusing `ssh_exec`'s `timeoutMs` for the connection phase. Rejected: that argument is a per-command budget and its timer starts after the channel opens; stretching it to cover connect/auth would make a long command and a slow login indistinguishable and change an established tool contract.
- Splitting TCP connect, key exchange and authentication into three messages through `client._sock`. Rejected: it depends on an undocumented ssh2 field, and the two-phase split already removes the misdiagnosis the report suffered (an authentication stall labeled as a handshake).
- A per-connection `readyTimeout` override on the tool surface. Rejected: the Agent cannot configure hosts, and a per-call timeout would let a command silently wait far longer than the operator's setting expects.

## Consequences

- Existing hosts see a 30 s ceiling instead of 15 s. An unreachable host now takes twice as long to report its timeout, and the setting can be lowered to the old value.
- A settings edit applies to connections opened afterwards. A pooled connection keeps serving until it breaks or is dropped; the timeout governs only the connect path.
- The timeout message names the phase and the setting. Code or support material that matched the literal ssh2 string for this path no longer does.
- `ssh_exec` and `ssh_cluster` tool descriptions state that their `timeoutMs` starts after the connection is ready and does not extend `connectTimeoutMs`.
- README (both languages) owns the user-facing configuration contract; this note owns the rationale.

## Testing

- `tests/connection-pool.test.ts` pins the 30 s default, an authentication-stage timeout after `handshake`, a connection/key-exchange-stage timeout before it, and keeps non-timeout errors untouched.
- `tests/engine.test.ts` verifies `setConnectTimeout()` updates the options object later connections read.
- `tests/announce-default.spec.ts` and `tests/settings-surfaces.spec.ts` pin the schema default and the volatile (settings-page) status of `connectTimeoutMs`.
- The package suite (`pnpm --filter @linxin666/dsh-ssh test`), package `typecheck` and `build` pass on the change.
