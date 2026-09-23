# Agent Note: Windows CI lanes for the desktop payload

Status: implemented

## Problem

CI 此前从未在 Windows 上执行过任何东西：主 lane 跑在 ubuntu，桌面发布 job 在 macOS 交叉构建 Windows 安装包，win 载荷只能做存在性检查（脚本原话「it cannot execute on macOS」）。桌面辅助代码编码的 win32 语义（Path/PATH 大小写归一、NTFS junction、Windows 临时目录布局）与载荷的真实启动路径都没有自动化证据，Windows 兼容性靠人工运行兜底。

## Decision

- `desktop/tests/*.test.mjs` 通过新的根脚本 `pnpm test:desktop` 进入主 CI lane（只依赖 Node 内置模块——不需要 desktop 的 `npm install`）。
- `ci.yml` 新增 `desktop-windows` job 在 `windows-latest` 上跑同一套测试，真实创建 NTFS junction、走真实 Windows 路径语义（POSIX 上只是模拟）。其 `setup-node` 步骤固定 `package-manager-cache: false`：v5 默认自动启用仓库的包管理器缓存（从 pnpm-lock.yaml 探测），要求 PATH 上有 pnpm——这个只依赖 Node 内置模块的 job 从不需要该工具，首次真实运行恰好失败在这一步。
- `desktop-release.yml` 新增 `windows-smoke` job：在真实 Windows runner 上 stage 完整运行时载荷（`npm run prepare-runtime`）、用 staged win-x64 发行版冒烟 node/npm/pnpm、在空的临时 `DSH_HOME` 上启动 staged 宿主并探测 GUI（HTTP 状态 < 500 且排除 000，120 秒期限），打包 job `needs: windows-smoke`——Windows 启动失败会阻止安装包进入 release。启动流程（空 home 起 `dsh web`、探测循环）在落地前用 staged mac-arm64 载荷本地验证过：GUI 在 4 秒内应答 HTTP 401（认证门）并打印 token URL 行。

## Alternatives considered

- 在 Windows runner 上安装并启动打包后的安装器本身：最接近用户现实，但需要 runner 的 GUI 会话与安装器编排；staged 宿主启动已能证明载荷的关键主张（内置 node 可运行、宿主可服务 GUI），且没有那层脆弱性。安装器级别的验证保留为发布前人工检查。
- 每个 PR 都跑载荷启动冒烟：载荷由 registry 锁定版本、只在发布升级时变化，逐 PR 成本买不到多少东西；发布时门控覆盖每一个实际发布的载荷。

## Consequences

- 每次 push 桌面套件跑两遍（ubuntu + windows-latest，约 1 分钟）；每次桌面发布在打包前多付一次 windows-latest 的载荷 staging。
- 冒烟与桌面运行共享并发组并作为其门控；冒烟失败即该次运行不上传安装包。
- 与 [cloudflared 架构覆盖修复](../bug-fix/2026-09-06-desktop-cloudflared-arch-coverage.md) 合并看，Windows 发布路径现在具备构建期断言、真实启动门控与 win32 单测覆盖。

## Testing

- 本地 `pnpm test:desktop` 通过（16 项）；隧道插件套件（347 项）与仓库 typecheck 均绿。
- 首次真实运行（v0.3.17 tag 窗口）暴露两个 Windows 车道缺陷，均已修复：windows-smoke 的暂存步骤败于 Git-bash GNU tar 的盘符路径解析（[Windows 安全的 bsdtar 解压](../bug-fix/2026-09-07-desktop-tar-windows-bsdtar.md)），本 job 败于 setup-node 默认的包管理器缓存（即上文的 `package-manager-cache: false`）。携带修复的第一次 CI push 即其验收运行。
