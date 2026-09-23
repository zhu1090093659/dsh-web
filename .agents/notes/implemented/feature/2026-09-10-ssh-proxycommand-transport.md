# Agent Note: ProxyCommand as an SSH transport (issue #1448)

Status: implemented

## Problem

dsh-ssh could reach a host only by direct TCP or through a ProxyJump chain of aliases already configured in the plugin. Hosts reachable only through an OpenSSH `ProxyCommand` — enterprise bastions whose client proxies into the target (`corp-vpn proxy %h %p %r`), `ssh -W %h:%p jump`, `cloudflared access ssh`, `aws ssm start-session` — were unreachable, and the `~/.ssh/config` importer dropped the directive silently, so the import looked successful while the host could never connect. Three further importer gaps came with the same report: `Include` files were never read, a block without `HostName` (where OpenSSH uses the Host pattern itself as the hostname) was skipped, and an address-form `ProxyJump ops@bastion:2222` was stored but could never resolve. The import result only carried a count of skipped aliases, so none of this was visible.

## Decision

`proxyCommand` is a stored host field, and the command's stdio is the connection transport.

### Transport

`startProxyCommand()` spawns the command through the user's shell (POSIX `$SHELL -c`, Windows `cmd.exe /d /s /c` with Node's own verbatim-quoting recipe), expands the OpenSSH tokens (`%h` host, `%p` port, `%r` user, `%n` alias, `%%` literal), and bridges stdin/stdout into a `Duplex` handed to ssh2 as `sock`. ssh2 takes a supplied socket as already connected, so exec, the Web terminal, SFTP, tunnels, and cluster runs all inherit the transport without a second connection path.

Failure modes are owned by the transport, not by ssh2's `readyTimeout`: a spawn error, or an exit before the handshake (with the tail of the command's stderr), destroys the stream with the exit status, and destroying the stream kills the process — on POSIX the whole process group, so `ssh -W %h:%p bastion` does not leak its client. A clean EOF is only reported once the process exited successfully, otherwise ssh2's generic "connection lost before handshake" would hide the real reason.

### Combination rules

- `proxyCommand` and `proxyJump` are mutually exclusive per host, validated on create, on import, and on the merged view of a PATCH (a patch adding one transport to a host holding the other is rejected). OpenSSH resolves the pair by "whichever appears first in the config"; a stored entry has no order, so either choice would be arbitrary.
- In a chain, a hop's own `proxyCommand` is the transport that reaches that hop, and it is honored for the first hop only. A later hop declaring one is a hard error instead of a silent downgrade; chaining through a bastion therefore means configuring the bastion as a host entry with its own `proxyCommand` and jumping to it.
- A hop value that is not a configured alias is parsed as an OpenSSH `[user@]host[:port]` address (IPv6 bracketed) and reuses the target host's authentication, because an ad-hoc hop has no stored credentials. Hop connect and forward errors are prefixed with the hop spec and its resolved address so a typo stays diagnosable.

### Import

The parser moved to `src/ssh-config.ts`: `Include` expands in place (globs, `~`, several pathnames, relative to the imported config's directory, depth-capped with a realpath visited set that also makes a diamond include non-duplicating), `Match` blocks record a skip and end the block above them (previously their options merged into the previous Host block), a missing `HostName` falls back to the pattern, and `ProxyCommand none` is dropped. `ImportResult` now returns `skippedBlocks: { name, reason }[]` with reasons `wildcard | existing | match | invalid`, which the hosts tab renders under the import notice.

### Agent surface

`ssh_list` reports `proxyCommandConfigured: boolean` instead of the command text: the value may embed bastion credentials, and the model only needs to know that the host goes through a proxy. The Agent still cannot create or edit hosts, so it cannot introduce a command either.

## Alternatives considered

- Specifying both transports and layering them (a ProxyCommand seed plus a jump chain on top). Rejected: the token expansion of a seed command bound to the target host while connecting to the first hop has no defensible meaning, and OpenSSH itself never applies both.
- Materializing address-form hops into stored host entries at import time. Rejected: it pollutes the user's host list with machine-generated aliases and needs naming and collision rules for no gain.
- Ignoring a `proxyCommand` on a non-first hop. Rejected: silently dropping a configured transport is exactly the failure mode this issue reported.
- Falling back to the target host when a hop spec resolves to nothing (the previous behavior). Rejected: it hides a typo behind a connection to the wrong machine.
- Exposing the ProxyCommand string to `ssh_list`. Rejected for the credential-leak reason above.

## Consequences

- Changing `proxyCommand` through the API drops the pooled connection for that alias, like every other connection field.
- On Windows the shell is killed without its process group, so a client the command spawned may outlive the transport; documented as a known limitation.
- An address-form hop keeps using the target's credentials: a hop with its own key or user needs a configured host entry, which the README states.
- The GUI cannot clear `description` / `environment` / `location` (an omitted key means "leave unchanged" and the form sends `undefined`); `proxyCommand` avoids that by sending an explicit empty string. The sibling fields remain a separate, unfixed gap.

## Testing

- `tests/ssh-config.test.ts`: Include globs in lexical order, missing includes, Match reporting, case-insensitive keys, missing top-level file.
- `tests/proxy-command.test.ts`: token expansion table, bidirectional stdio bridge, child reaped on destroy, exit status and stderr on a command that dies, a command that cannot start.
- `tests/connection-pool.test.ts`: the entry's ProxyCommand arrives as the ssh2 `sock`, address hops parse and reuse the target credentials, hop errors name the hop, a non-first hop's ProxyCommand is refused, an entry with both transports is refused, `parseJumpSpec` table.
- `tests/engine.test.ts`: exec over a ProxyCommand bridging stdio to the embedded ssh2 server against a deliberately unreachable HostName, the pooled connection (and the command) dropped with `dropAlias`, and a failing command surfaced instead of a handshake timeout.
- `tests/store.test.ts` covers validation, PATCH merging, and the import reasons; `tests/routes.test.ts` covers the transport change dropping the pool.
