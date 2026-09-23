# Agent Note: Doctor 胶囊 Windows 执行适配与命名隧道命令行参数时序修正

Status: implemented

## Problem

在本地运行与 cloudflared 执行中排查出两处具体问题：
1. 在 `dsh-doctor` 中，Windows 环境下胶囊预置失败并存在写并发问题：`store.ts` 与 `launch.ts` 错误引用了 `node:path/posix`，导致包含反斜杠的 Windows 绝对路径在提取 `dirname` 时被折叠为 `.`，并将盘符路径误判为相对路径，因而在写入前创建父级目录时遭遇 ENOENT；另外 `provisionCapsule` 内部裸调用了 `spawn`，在 Windows 上无法直接执行作为 `.cmd` 批处理的 `dsh` 命令并抛出 `spawn dsh ENOENT`。
2. 在 `dsh-remote-web-ui` 中，配置命名隧道启动时，cloudflared 进程立即退出并报错 `flag provided but not defined: -no-autoupdate`。上游 `cloudflared` npm 包的 `Tunnel.withToken` 错误地将选项拼装在子命令 `run` 之后，而 cloudflared CLI 要求 `--no-autoupdate` 与 `--protocol` 必须作为顶层选项置于子命令 `run` 之前。

## Decision

1. 在 `packages/dsh-doctor` 中：
   - 将 `store.ts` 与 `launch.ts` 中的 `node:path/posix` 替换为平台自适应的 `node:path`。
   - 增强 `dshSpawnSpec`，在 Windows 平台上将裸 `'dsh'` 命令包装为 `cmd.exe /d /s /c "dsh ..."`。
   - 将 `provisionCapsule` 中的进程执行器替换为 `spawnDsh`。
2. 在 `packages/dsh-remote-web-ui` 中：
   - 导出并使用 `namedTunnelArgs(token: string)`，生成正确的参数数组 `['tunnel', '--no-autoupdate', '--protocol', 'http2', 'run', '--token', token]`。
   - 在 `TunnelManager` 默认工厂中使用 `new Tunnel(namedTunnelArgs(target.token))` 替代 `Tunnel.withToken`。

## Consequences

- Doctor 胶囊预置在 Windows 和 POSIX 平台上均能正常创建目录并调用 dsh 执行。
- 命名 Cloudflare 隧道能正常拉起，不再因命令行参数位置不合规而崩溃退出。

## Testing

- `pnpm --filter @linxin666/dsh-doctor test`：43 个测试套件、397 个用例全部通过。
- `pnpm --filter @linxin666/dsh-remote-web-ui test`：32 个测试套件、350 个用例全部通过。
