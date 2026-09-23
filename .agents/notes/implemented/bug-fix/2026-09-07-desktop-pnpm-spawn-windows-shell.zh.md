# Agent Note:运行时暂存中 pnpm install 在 Windows 上经由 shell 执行

Status: implemented

## 问题

承接 tar/bsdtar 修复(2026-09-07-desktop-tar-windows-bsdtar)。该修复解决了「Stage the bundled runtime payload」步骤里的压缩包解包问题,但同一步骤接下来会在 build-runtime.mjs 内再次失败:`spawnSync('pnpm', ['install'])` 依赖 PATH 解析 pnpm,而 windows-latest 上 pnpm/action-setup 装的是 `.cmd` shim。Node 的 spawn 不经 shell 无法执行 `.cmd`/`.bat`,于是每次尝试都以 ENOENT 失败(status 为 null、error 置位),3 次重试耗尽后步骤中止——冒烟检查与启动探针根本没有机会运行。该失败类别在 dsh-trading 的桌面运行时中有实证记录,此处采用完全相同的平台限定修法。

## 决策

- build-runtime.mjs `pnpmInstall()`:spawn 选项增加 `shell: process.platform === 'win32'`。所有参数都是常量字面量,经由 cmd.exe 不引入注入面;cwd/env/encoding/maxBuffer 不变,重试逻辑不动。

## 备选方案

- 显式解析 shim 路径(如 `pnpm.cmd`):重复 shell 已做的查找,且 setup action 更换 shim 布局后再次失效。
- 无条件改用 `cmd /c pnpm install`:无收益地改变 POSIX 错误面;macOS lane 必须保持现有行为。

## 后果

- windows-smoke 暂存步骤可以走到工具链冒烟检查与启动探针;pnpm-ENOENT 失败类别从桌面发版门禁中消除。
- 交叉关联:关闭 2026-09-07-desktop-tar-windows-bsdtar 背后的第二个暂存缺口。启动探针步骤仍将在下一次 dispatch 的发版 run 中首次于 windows-latest 执行;若再有失败需按新证据归因,不做推测。
- v0.3.17 重建按 bsdtar note 的同一策略 dispatch desktop-release.yml(tag=v0.3.17,ref=main),本修复与 bsdtar 修复同 run 生效;tag 保持在发版 commit 上,npm 家族不受影响。

## 测试

- `node --check desktop/scripts/build-runtime.mjs` 通过;desktop `npm test` 在 macOS 本地全绿(19/19,含上一修复引入的 tar-extract 测试)。win32 分支本身由 v0.3.17 的 dispatch windows-smoke run 实测。
