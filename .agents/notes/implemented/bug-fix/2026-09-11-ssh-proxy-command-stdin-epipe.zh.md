# Agent Note: SSH ProxyCommand 子进程 stdin EPIPE 未捕获异常与上下文保留修复

Status: implemented

## Problem

在 Linux (Ubuntu runner) CI 环境下，`packages/dsh-ssh` 的测试用例 `surfaces a failing ProxyCommand instead of waiting for the handshake timeout` 发生失败：
1. `packages/dsh-ssh/src/engine/proxy-command.ts` 在写入已退出的子进程 stdin 时触发了 `Unhandled error: Error: write EPIPE`。原因在于 `proxy-command.ts` 仅对 `child.stdout` 和 `child` 监听了 `error` 事件，完全没有监听 `child.stdin` 上的 `error` 事件。在 Node.js 中，管道对端关闭后写入会触发 `stdin` 的 `EPIPE` 事件，无 listener 时直接升级为进程级未捕获异常。
2. 在 `Duplex` 的 `write` 实现中，直接把 `stdin.write` 抛出的裸系统错误 `Error: write EPIPE` 回传给回调，不仅缺少 `ProxyCommand` 错误前缀导致用例正则断言失败（`expected [Function] to throw error matching /ProxyCommand/ but got 'write EPIPE'`），而且掩盖了子进程真正的退出码与 stderr 详细原因（例如 `/bin/sh: 1: definitely-not-a-real-binary-xyz: not found`）。

## Decision

1. **为 `child.stdin` 绑定错误监听器**：
   - 监听 `child.stdin?.on('error')`，拦截并处理 `EPIPE` 等管道断开异常，防止在子进程提前退出时引发未捕获的 EventEmitter 异常。
   - 当捕获到错误且子进程已退出时，优先解析提取其退出码（code / signal）与 stderr 详情。

2. **优化 `Duplex.write` 与 `final` 的错误上下文包装与退出时序**：
   - 在 `write(chunk, _encoding, callback)` 中，如果 `stdin.write` 报错，优先检查子进程是否已有退出状态；若子进程正在退出过程中，短暂挂载 `child.once('exit')` 捕获其退出码和 stderr。若超时未退出，则安全包装为 `ProxyCommand transport write failed: <message>` 回传。
   - 在 `final(callback)` 中安全包装 `stdin.end` 的可能异常为 `ProxyCommand transport close failed: <message>`。
   - 在 `child.stdout?.on('error')` 中补齐 `ProxyCommand stdout error:` 前缀。

3. **补充单元测试**：
   - 在 `packages/dsh-ssh/tests/proxy-command.test.ts` 中新增针对向已终止进程的 ProxyCommand 写入数据时的异常捕获测试用例，确保不会产生未捕获异常且错误信息始终包含 `ProxyCommand`。

## Testing

- `pnpm --filter @linxin666/dsh-ssh test`：22 个测试文件全部通过（182 passed）。
- `pnpm typecheck`：全仓 22 个包通过。
- `pnpm test`：全仓单测套件通过。
- `pnpm docs:check && pnpm i18n:check && pnpm test:scripts`：通过。
- `pnpm skin-center:check && pnpm aggregate:check && pnpm runtime-deps:check`：通过。
