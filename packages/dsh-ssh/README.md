# dsh-ssh — Remote SSH operations plugin for DSH

English | [中文](README.zh.md)

Built on the capability list of [badseal/ssh-skill](https://github.com/badseal/ssh-skill), a remote SSH plugin tailored for DeepSeek Harness (DSH): a persistent connection pool inside the Host process + a Web GUI host-management panel + a Web terminal + Agent tools, all implemented through the official NPM SDK without modifying DSH source.

## Capabilities

| Capability | Description |
| --- | --- |
| Host management | CRUD, search, connection test; collapsible grouping by environment / tags with per-group batch test; config stored in `~/.dsh/dsh-ssh.json`; supports key / password auth, passphrase keys, ProxyJump jump hosts (multi-level) |
| Config import | One-click parse of a standard `~/.ssh/config` (Host/HostName/User/Port/IdentityFile/ProxyJump etc.); existing aliases are skipped |
| Persistent connection pool | Reuses a long-lived connection per host (opposite of the ssh-skill daemon), automatically disconnects after 30 minutes idle, auto-reconnects on disconnect (up to 3 times) |
| Command execution | exec with a timeout (default 60s), stdout/stderr separated, output truncation guard (2MB) |
| Web terminal | xterm.js + WebSocket PTY terminal, auto-sizing, real-time output |
| File transfer | SFTP upload (browser file picker, NDJSON progress stream), download (progress bar + browser save); remote directory browsing |
| Port forwarding | Local port-forward tunnel (listens on 127.0.0.1 only) to reach a remote database / intranet service; list / stop supported |
| Cluster execution | One command run concurrently across many hosts (filter by alias / environment / tag, default concurrency 8) |
| Agent tools | `ssh_list` / `ssh_exec` / `ssh_upload` / `ssh_download` / `ssh_tunnel` / `ssh_cluster`; GUI and Agent share the same host config |

## Security model

- All `/api/dsh-ssh/*` routes are loopback-only (with same-origin checks) — the interfaces that execute commands against remote servers are not exposed to the LAN.
- Passwords / key passphrases are stored in plain text in `~/.dsh/dsh-ssh.json`, file mode 0600, directory 0700 (the same trust model as ssh-skill writing passwords into ssh-config comments).
- Tunnels only listen on `127.0.0.1`.
- Deleting a host or changing its connection fields (host / port / user / auth / proxyJump) immediately closes that alias's pooled connection and tunnels; later operations reconnect with the new configuration and never reuse a connection authenticated with the old credentials.
- Before the Agent uses a tool, the host must first be configured in the GUI (or imported from ~/.ssh/config).
- `ssh_upload` / `ssh_download` read/write arbitrary local paths on this machine with host-process privileges (not through the bash sandbox) — same host-local-path semantics as ssh-skill, be aware of that permission surface.
- The remote output of exec / cluster is returned verbatim (not sanitized); a command like `env` may bring secrets from the remote environment back into the conversation log.

## Install

Install the family aggregate package `@linxin666/dsh-web-ui-all` (all plugins and skins in one) or this plugin alone:

```sh
### 从 npm 安装（推荐）
dsh plugin --profile web add @linxin666/dsh-ssh

### 从仓库安装（开发调试）
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-ssh

```

After installing, **restart `dsh web`**: a "SSH" entry appears in the sidebar; the plugin description is injected into the Agent prompt automatically.

## Configuration

The settings panel (plugin config) toggles `announceToAgent` (whether to announce the plugin to the Agent) and `enabled` (master switch).

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
- Every hop of a ProxyJump jump host must be a host alias already configured in this plugin.
- Resume (broken-transfer continuation) is not implemented yet.
- The transfer of Agent tools is a host-machine local path (same semantics as ssh-skill).
