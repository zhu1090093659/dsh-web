# dsh-ssh — Remote SSH operations plugin for DSH

English | [中文](README.zh.md)

Built on the capability list of [badseal/ssh-skill](https://github.com/badseal/ssh-skill), a remote SSH plugin tailored for DeepSeek Harness (DSH): a persistent connection pool inside the Host process + a Web GUI host-management panel + a Web terminal + Agent tools, all implemented through the official NPM SDK without modifying DSH source.

## Capabilities

| Capability | Description |
| --- | --- |
| Host management | CRUD, search, connection test; collapsible grouping by environment / tags with per-group batch test; config stored in `~/.dsh/dsh-ssh.json`; supports key / password / ssh-agent auth (OpenSSH agent / Pageant), passphrase keys, ProxyJump jump hosts (multi-level) and OpenSSH `ProxyCommand` transports (bastion clients) |
| Config import | One-click parse of a standard `~/.ssh/config` (Host/HostName/User/Port/IdentityFile/IdentityAgent/ProxyJump/ProxyCommand, `Include` files, blocks without HostName); skipped blocks are listed with their reason (wildcard pattern, existing alias, Match block, invalid fields) |
| Persistent connection pool | Reuses a long-lived connection per host (opposite of the ssh-skill daemon), automatically disconnects after 30 minutes idle, auto-reconnects on disconnect (up to 3 times) |
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
- ssh-agent auth stores only the agent socket path (or the special value `pageant`); it never reads or stores private-key material.
- Tunnels only listen on `127.0.0.1`.
- Deleting a host or changing its connection fields (host / port / user / auth / proxyJump / proxyCommand) immediately closes that alias's pooled connection and tunnels; later operations reconnect with the new configuration and never reuse a connection authenticated with the old credentials.
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

The settings panel (plugin config) toggles `announceToAgent` (whether to announce the plugin to the Agent; off by default so system prompts stay clean) and `enabled` (master switch), and sets `terminalFontFamily` (the web terminal font; empty defers to the CSS chain: `--dsh-ssh-terminal-font` → the official `--ds-font-family-code` token → the built-in monospace stack). The terminal font is fixed in the xterm constructor, so a plain stylesheet cannot override it; to render powerline / Nerd Font glyphs, enter a Nerd Font stack here (e.g. `"SauceCodePro Nerd Font", monospace`). Changes re-apply to open terminals live, no reconnect needed.

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
