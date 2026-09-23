# Agent Note：桌面运行时暂存的 Windows 安全 tar 解压

Status: implemented

## Problem

desktop-release 的 windows-smoke 门禁首次随 v0.3.17 tag 运行，在 "Stage the bundled runtime payload" 一步失败：fetch-node.mjs 调用 `tar -xf C:\...`，Git-bash 的 GNU tar 把盘符路径解析成远程主机（`tar: Cannot connect to C: resolve failed`）。下一步的 fetch-pnpm.mjs 有同样缺陷。这里是两个独立问题：GNU tar 无法解析 `C:\...` 目标，也完全无法读取 win-x64 Node 的 `.zip`——只有 bsdtar 同时覆盖两种格式，macOS 的 `tar` 与 Windows System32 自带的都是它。

## Decision

- 新增共享助手 desktop/scripts/tar-extract.mjs：`tarBinary()` 在 win32 上优先选择 `%SystemRoot%\System32\tar.exe`（bsdtar 能解析盘符路径并自动识别 gzip 与 zip），其他平台回退到 PATH 上的 `tar`；`extractArchive(archive, destDir)` 执行 `tar -xf`，格式自动识别使显式 `-z` 成为多余。
- fetch-node.mjs 与 fetch-pnpm.mjs 改为通过助手解压，不再直接调用 `tar`；同时删除不再使用的 execFileSync 导入。
- desktop/tests/tar-extract.test.mjs 覆盖普通与 gzip 压缩包的解压以及当前平台上的二进制选择契约；它加入 `pnpm test:desktop`，因此 windows-latest CI 车道每次推送都会用真实的 System32 tar 验证 win32 分支。

## Alternatives considered

- 用 cygpath 转换路径后继续用 GNU tar：同样的保证要引入更多环节；System32 bsdtar 无需转换，且每个 GitHub windows runner 镜像都有。
- 打包 JS tar/zip 解压库：省掉子进程，但给零工具依赖的暂存路径增加依赖，而操作系统自带的二进制本已解决问题。

## Consequences

- windows-smoke 的暂存步骤在所有 runner 上走同一条代码路径；盘符路径与 zip 格式这两类失败从桌面发布门禁中消失。
- 交叉链接：本文 closes [Windows CI 车道笔记](../testing/2026-09-06-windows-ci-lanes-for-desktop.md) 记录的第一个真实执行缺口——该笔记的 smoke job 设计正确，但它运行的暂存脚本此前不满足 Windows 安全性。
- v0.3.17 的桌面安装包通过 dispatch desktop-release.yml（tag v0.3.17、ref main）重建；tag 本身保持在发布提交上，npm 家族不受影响。

## Testing

- `pnpm test:desktop`：本机 macOS 上 19 项测试全部通过，含新增的三项解压与二进制选择测试；`node desktop/scripts/fetch-node.mjs` 端到端验证改线后的导入（走暂存标记的跳过路径）。
- dispatch 的 v0.3.17 desktop-release 运行必须全绿（windows-smoke 暂存加启动，随后打包），安装包才会挂到 Release 上。
