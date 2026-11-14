# Agent Note: 暂存 secret 的文件权限断言只在 POSIX 上成立

Status: implemented

[English](2026-11-14-deploy-secret-mode-assertion.md) | 中文

## Problem

`scripts/deploy-market.test.mjs` 用子进程报告 `fs.statSync(file).mode & 0o777` 来证明部署车道把 secret 暂存在只有属主可读的文件里，并断言 `mode:600`。Windows 没有 POSIX 权限位：`statSync().mode` 对任何文件都报 `0o666`，写入时的 `{ mode: 0o600 }` 只是建议值，因此这条断言在每次 Windows 运行都失败，而 Linux CI 车道始终通过。此前的 cohort 运行把它记录为既有失败，并未放宽断言。

## Decision

断言在保证真实存在处保持严格，在无法观测处如实降级。POSIX 上子进程观察到的权限必须是 `600`；Windows 上只断言子进程报告了某个权限值并读到了确切的 secret，原有的清理断言继续证明确实文件在运行结束后被删除。断言旁的注释写明理由，避免有人把它重新收紧成依赖平台的红用例。

## Alternatives considered

- **保留失败断言并当作环境噪音报告**：否决。长期红的本地门禁会掩盖同一套件里的真实回归，也会训练大家忽略 `test:scripts`。
- **在 Windows 上跳过整条用例**：否决。读取与清理这两半与平台无关，且正是它们覆盖暂存机制；只有权限观察与平台有关。
- **在 Windows 上手工断言 ACL**：否决。解析 `icacls` 输出会给测试再塞进一个安全敏感的解析器，而实现并没有 Windows 专属的 ACL 路径可供验证。

## Consequences

`pnpm test:scripts` 在 Windows 与 Linux 上都恢复绿色。`0600` 写入模式仍在 Linux CI 车道上被真实检验——那正是该保证被定义的地方；Windows 车道覆盖读取与删除两条路径。
