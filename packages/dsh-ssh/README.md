# dsh-ssh · Web SSH Terminal, SFTP Transfer & Remote Operations for DeepSeek Harness (DSH)

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/@linxin666/dsh-ssh?style=flat-square" alt="Version">
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.2-4c6ef5?style=flat-square&amp;labelColor=454a54" alt="DSH">
  &nbsp;
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>Remote Linux Server Operations & Web SSH Suite for DeepSeek Harness (DSH)</strong><br>
  <em>xterm.js Web Terminal · Visual SFTP Transfer · Port Forwarding Tunnels · Cluster Execution · 6 Agent Tools</em>
</p>

A dedicated remote Linux server operations and cluster management plugin for DeepSeek Harness (DSH) Web GUI and official desktop client: in-process persistent connection pool, Web GUI host inventory management, xterm.js terminal, visual SFTP file transfer, port forwarding tunnels, and 6 dedicated agent tools implemented on top of official NPM SDKs without modifying DSH core source code.

## Capabilities

| Capability | Description |
| --- | --- |
| Host management | CRUD, search, connection test; collapsible grouping by environment / tags with per-group batch test; config stored in `~/.dsh/dsh-ssh.json`; supports key / password / ssh-agent auth (OpenSSH agent, with Pageant still selectable on Windows), passphrase keys, ProxyJump jump hosts (multi-level) and OpenSSH `ProxyCommand` transports (bastion clients) |
| Config import | One-click parse of a standard `~/.ssh/config` (Host/HostName/User/Port/IdentityFile/IdentityAgent/ForwardAgent/ProxyJump/ProxyCommand, `Include` files, blocks without HostName); `ForwardAgent yes|true|on` imports as enabled and `no|false|off` (or no directive) as disabled; skipped blocks are listed with their reason (wildcard pattern, existing alias, Match block, invalid fields) |
| Persistent connection pool | Reuses a long-lived connection per host (opposite of the ssh-skill daemon), automatically disconnects after 30 minutes idle, auto-reconnects on disconnect (up to 3 times) |
| Agent forwarding | Opt-in per host through the `forwardAgent` flag (`ssh -A`); the form has an "Enable agent forwarding" checkbox, the host list shows an agent-forwarding badge for enabled hosts, and `ssh_list` reports `forwardAgent` with a forward column in its table. The endpoint is the host's configured agent path, otherwise `SSH_AUTH_SOCK`, otherwise the native OpenSSH named pipe (`\\.\pipe\openssh-ssh-agent`) on Windows; a host with no local endpoint fails with an explicit error instead of connecting without forwarding. A server that refuses the request (`AllowAgentForwarding no`) surfaces its own error and is never downgraded to a silent non-forwarded session. The flag never touches the stored profile when it is off |
| Command execution | exec with a timeout (default 60s), stdout/stderr separated, output truncation guard (2MB) |
| Web terminal | xterm.js + WebSocket PTY terminal, auto-sizing, real-time output |
| File transfer | SFTP upload (browser file picker, NDJSON progress stream), download (progress bar + browser save); remote directory browsing |
| Port forwarding | Local port-forward tunnel (listens on 127.0.0.1 only) to reach a remote database / intranet service; list / stop supported |
| Cluster execution | One command run concurrently across many hosts (filter by alias / environment / tag, default concurrency 8) |
| Agent tools | `ssh_list` / `ssh_exec` / `ssh_upload` / `ssh_download` / `ssh_tunnel` / `ssh_cluster`; GUI and Agent share the same host config |

The panel loads its contents on first open. Closing and reopening it preserves the selected tab, form drafts and terminal session. The tunnel list refreshes every five seconds while its tab, panel and browser page are visible; automatic reads pause when hidden, resume immediately on return, and do not overlap slow reads. Port forwarding itself continues in the Host.

## Security model

- All `/api/dsh-ssh/*` routes are loopback-only (with same-origin checks) — the interfaces that execute commands against remote servers are not exposed to the LAN.
- Passwords / key passphrases are stored in plain text in `~/.dsh/dsh-ssh.json`, file mode 0600, directory 0700 (the same trust model as ssh-skill writing passwords into ssh-config comments).
- ssh-agent auth stores only the agent socket path (or the special value `pageant`); it never reads or stores private-key material. An empty agent path is not a secret and is always saved: it means auto-detect (`SSH_AUTH_SOCK`, then the native OpenSSH named pipe on Windows), so switching a host to SSH Agent takes effect even with the field left blank.
- Agent forwarding is opt-in per host and off by default. With `forwardAgent` enabled, every exec and PTY session on that host asks the server for `auth-agent-req@openssh.com`, which means the remote host can authenticate as this machine with your local keys. Enable it only for hosts you trust, and remember every session on such a host can use the forwarded agent. When no agent endpoint resolves (the configured agent path, `SSH_AUTH_SOCK`, the native OpenSSH named pipe on Windows) the connection fails instead of forwarding nothing, and a server that refuses the request surfaces its error exactly as it comes back.
- Tunnels only listen on `127.0.0.1`.
- Deleting a host or changing its connection fields (host / port / user / auth / proxyJump / proxyCommand / forwardAgent) immediately closes that alias's pooled connection and tunnels; later operations reconnect with the new configuration and never reuse a connection authenticated with the old credentials.
- When the SSH connection behind a tunnel drops, the tunnel retires itself: the local port stops accepting, the tunnel leaves the list, and the connection that arrives during the drop is closed without traffic instead of interrupting the host process.
- A `proxyCommand` value is a shell command executed by the DSH host process with its privileges — exactly the trust `ssh(1)` gives the same line in `~/.ssh/config`. It can only come from the user's own 0600 store file: the Agent cannot create or edit hosts, and `ssh_list` reports only whether a host has one, never the command text.
- Before the Agent uses a tool, the host must first be configured in the GUI (or imported from ~/.ssh/config).
- `ssh_upload` / `ssh_download` read/write arbitrary local paths on this machine with host-process privileges (not through the bash sandbox) — same host-local-path semantics as ssh-skill, be aware of that permission surface.
- Agent transfer tools move files only between this machine and a remote SSH host; local-file reads and writes must use the local file tools (read / write / edit / bash), never the `ssh_*` tools.
- The remote output of exec / cluster is returned verbatim (not sanitized); a command like `env` may bring secrets from the remote environment back into the conversation log.

## Install

Install the family aggregate package `@linxin666/dsh-web-all` (all plugins and skins in one) or this plugin alone:

```sh
### From npm (recommended)
dsh plugin --profile web add @linxin666/dsh-ssh@latest

### From the repository (development)
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-ssh

```

After installing, **restart `dsh web`**: a "SSH" entry appears in the sidebar; the plugin description is injected into the Agent prompt automatically.

## Configuration

The settings panel (plugin config) toggles `announceToAgent` (whether to announce the plugin to the Agent; off by default so system prompts stay clean) and `enabled` (master switch), sets `terminalFontFamily` (the web terminal font; empty defers to the CSS chain: `--dsh-ssh-terminal-font` → the official `--ds-font-family-code` token → the built-in monospace stack), and sets `connectTimeoutMs` (the shared ceiling for TCP connect, SSH key exchange and user authentication, default 30000 ms, allowed 1000-600000). Raise `connectTimeoutMs` on hosts whose authentication is slow (for example PAM or LDAP behind a distant directory service): every connection entry point — `ssh_exec`, the web terminal, SFTP transfers, tunnels and cluster runs — reads it, while the `timeoutMs` argument of `ssh_exec` / `ssh_cluster` only bounds the remote command once the connection is ready. The terminal font is fixed in the xterm constructor, so a plain stylesheet cannot override it; to render powerline / Nerd Font glyphs, enter a Nerd Font stack here (e.g. `"SauceCodePro Nerd Font", monospace`). Changes re-apply to open terminals live, no reconnect needed; a new `connectTimeoutMs` applies to connections opened afterwards, and pooled connections are unaffected until they reconnect.

## Data

- Host config: `~/.dsh/dsh-ssh.json` (versioned JSON, atomic write)
- Transfer staging: `os.tmpdir()/dsh-ssh-uploads/` (0700 directory, 0600 in-flight files)

## Development

```sh
pnpm install --filter @linxin666/dsh-ssh...
pnpm --filter @linxin666/dsh-ssh test    # unit tests: store + engine (embedded ssh2 Server + real sshd)
pnpm --filter @linxin666/dsh-ssh build   # tsc types + tsdown dual-half artifacts
```

## Known limitations

- The remote target path of an upload must be an absolute path (relative paths are rejected).
- Download does not support a whole directory yet (download files individually); upload supports recursive directories (walks the local directory and transfers file by file).
- exec auto-reconnect on disconnect (up to 3 times) may re-execute non-idempotent commands — watch out for side effects on long commands.
- A ProxyJump hop is either a host alias configured in this plugin or an OpenSSH `[user@]host[:port]` address; an address hop has no stored credentials, so it reuses the target host's authentication (configure a host entry when the hop needs its own).
- `proxyCommand` and `proxyJump` cannot be combined on one host (OpenSSH resolves them by "whichever appears first in the config"; a stored entry has no order, so the plugin rejects the pair), and only the first hop of a chain may declare a ProxyCommand.
- A ProxyCommand is executed through the user's shell, so it inherits the DSH process's `PATH` and environment. On Windows the shell is killed without its process group, so a client it spawned may outlive the transport.
- The ssh_config import expands `Include` (globs, `~`, several pathnames, relative to the config directory) but not environment variables or `%` tokens, and a multi-pattern `Host a b` line still imports only its first pattern.
- Resume (broken-transfer continuation) is not implemented yet.
- The transfer of Agent tools is a host-machine local path (same semantics as ssh-skill).

## Telemetry

The browser half sends one anonymous install heartbeat per UTC day to dsh-market.com: a random localStorage id plus this package's name, nothing else. The server stores only a salted hash of that id, never IP addresses, and exposes aggregate counts only. See [docs/telemetry.md](../../docs/telemetry.md) for the full contract.
