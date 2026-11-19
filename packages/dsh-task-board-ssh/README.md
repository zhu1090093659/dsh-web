# @linxin666/dsh-client-ui-task-board-ssh

English | [中文](README.zh.md)

A task-board provider extension that runs a pinned card as a headless agent session on a remote host reached through dsh-ssh, so the card's work happens on the machine that holds the code and survives the local host going offline.

## What it does

- Registers the `ssh` provider extension with the task board and intercepts the cards pinned to a remote target at the board's single launch gate.
- Starts dsh, Claude Code, Codex or a custom command on the host through one POSIX `sh` launcher, detached with `setsid nohup` so it outlives the connection.
- Keeps the run account in the card's own payload and the log on the remote host, read back by byte offset.

## Install

### From npm

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board-ssh@latest
```

### From the repository

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board-ssh
```

## Config

- `mode`: `direct` starts a headless agent on the host; `proxy` runs a local session told to drive the host.
- `host`: a dsh-ssh host alias.
- `agent`: `dsh`, `claude`, `codex` or `custom`, with the command templates a custom agent needs.
- `workspace`: `in-place` for an existing remote directory, or `git` for a per-run worktree whose source is a repository URL or the local workspace.

## Security model

- Every remote run is unattended: the launcher uses each CLI's own bypass flag and the dsh preset `danger-full-access`.
- Every value the provider sends to the host is quoted by one POSIX shell quoting function; no command line is assembled from raw text.
- dsh-ssh never hands this package a credential, a key path or a proxy command, and the card payload holds no log bytes.

## Known limitations

- This package currently ships the frozen core only: the host run engine, the workspace strategies and the browser surface land next, so mounting it today changes nothing.
- Codex support is written from the official documentation and has not been run against a real binary.
- The launcher needs a POSIX `sh` and `setsid` on the remote host; a host without them cannot run a direct card.

## License

Apache-2.0.
