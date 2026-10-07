# Agent Note: A dsh-ssh port-forward tunnel retires with its SSH link

Status: implemented

## Problem

A local port-forward tunnel in `packages/dsh-ssh/src/engine/tunnel.ts` pinned one pooled ssh2 connection and kept its loopback listener alive until a user stopped it. Nothing checked whether that connection was still alive, so a tunnel could outlive its link: a network drop, a remote reboot or an ended `sshd` session left the pool record marked `broken` while the tunnel stayed in `engine.tunnels` with its local port still in `listen` state (#1839).

The next local connection to that port called `client.forwardOut(...)` on a client that was no longer connected. ssh2 1.17 does not report this through the callback: `forwardOut` throws `Error: Not connected` synchronously, from inside the `net.Server` connection handler, where nothing catches it. The exception escaped as an uncaught exception and terminated the DSH host process with exit code 1, dropping every live session; the reporter counted 7 such crashes in one week on a single machine, all with that stack. The trigger is ordinary — a long-lived tunnel plus any port probe.

## Decision

- **A tunnel never outlives its link.** `startTunnel` registers a `client.once('close')` hook once the tunnel is in the registry. When the pooled client closes, the hook runs the ordinary stop path, so the listener closes, live sockets are destroyed, the registry entry disappears and the pinned connection is released (a record shared with a sibling tunnel is released only by the last tunnel standing).
- **The hook is detached on stop** through the new optional `TunnelRecord.detachLink`, so a retired tunnel never keeps a listener on a pooled client that outlives it — the `ssh_tunnel` agent tool can create and stop many tunnels over one long-lived connection.
- **The connection handler refuses a dead link before opening a channel.** `record.broken` (the pool's own liveness flag) destroys the socket and retires the tunnel, which covers the window between taking the record and the local connection arriving, where the link can die while `startTunnel` is still running.
- **`forwardOut` is called inside try/catch.** Its synchronous throw is the reported crash; the catch destroys the socket and retires the tunnel through the same idempotent helper, so no exception can escape the `net` connection handler again. `abortTunnel` wraps `stopTunnel` so a teardown error stays contained too.
- **A remote channel error is not a dead link.** `forwardOut` calling back with an error (remote service refused, channels busy) still only destroys that one socket; the tunnel stays up, as before.
- **A link that dies while the listener binds is caught by a second flag check** right after registration, because that window emitted `close` before the hook existed. `startTunnel` still resolves — the tunnel simply never appears in the list, which is the behavior the reporter asked for.

## Testing

`packages/dsh-ssh/tests/tunnel-dead-link.test.ts` drives a fake ssh2 client through the real listener: a synchronous `Not connected` throw, a link already marked broken at connect time, a `close` after a healthy forward, sibling tunnels over one link, and a healthy forward followed by a manual stop. Against the pre-fix source the suite fails 4 of its 5 cases and reports the exact uncaught exception from the issue (`Error: Not connected` at `Server.<anonymous> src/engine/tunnel.ts`), so the regression coverage is the reproduction itself.

## Alternatives considered

- **Keep the tunnel and let every connection fail.** Rejected — it stops nothing: the crash stays reachable through any path the guards do not anticipate, and it leaves a listener that accepts connections it can never serve, which is what the reporter explicitly ruled out.
- **Reconnect on demand inside the connection handler (the `withClient` retry shape).** Rejected — a local TCP client of a port forward expects a stable listener, silently reconnecting adds latency and reconnection semantics the pool does not own there, and the documented trade-off of a reconnect (it may replay non-idempotent work) buys nothing for a forward. Tunnels are deliberately pinned, so retiring them and letting the user start a new one is the honest outcome.
- **A single try/catch around the connection handler body, without retiring the tunnel.** Rejected — it contains the crash but leaves the zombie tunnel and its dead pinned connection in the registry forever, so every later connection repeats the refusal and the pool keeps a corpse pinned.
- **A `process.on('uncaughtException')` guard.** Rejected — that belongs to DSH core, not to this plugin, and it would mask every other latent throw instead of fixing this path.
- **Retiring on the client's `error` event as well as `close`.** Rejected — `close` is the terminal event of a dead transport, and the `record.broken` checks already cover the error-first window at connect time; listening to `error` too would retire tunnels over a transient error the transport may survive.

## Consequences

- After a link drop, the tunnel leaves the registry at once and its local port stops accepting, so the operator sees it disappear on the next list refresh (five seconds) and starts a new one; the connection that arrived during the drop is closed with no traffic. Before this change the same connection terminated the host process.
- Host deletion and connection-field edits behave exactly as before: they close the alias's tunnels through the same stop path.
- The pinned connection of the last tunnel is still ended exactly once, and a shared record is ended by the last sibling tunnel that retires.
